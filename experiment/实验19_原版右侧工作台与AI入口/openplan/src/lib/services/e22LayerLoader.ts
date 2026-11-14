import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { E22Layer, E22ScanLink } from '$lib/stores/e22Scan';
import { E22_MAX_RENDER_CELLS } from '$lib/utils/e22VoxelDisplay';

export const E22_RENDERABLE_KINDS = new Set([
  'triangle-mesh', 'point-cloud', 'roomplan-structure', 'oriented-boxes', 'packed-surface-grid',
  'clean-structure-grid', 'furniture-classified-grid', 'furniture-corrected-grid',
  'conflict-grid', 'unknown-grid', 'clutter-candidate-grid', 'mesh-collection',
  'axis-aligned-boxes', 'named-glb', 'instance-voxel-grid', 'voxel-evidence-overlay',
]);

/** Only these assets depend on the scan-display resolution selector. */
export const E22_RESOLUTION_GRID_KINDS = new Set([
  'packed-surface-grid', 'clean-structure-grid', 'furniture-classified-grid',
  'furniture-corrected-grid', 'conflict-grid', 'unknown-grid', 'clutter-candidate-grid',
]);
/** These layers contain countable voxel instances; PLY/TSDF meshes and GLB do not. */
export const E22_VOXEL_GRID_KINDS = new Set([
  ...E22_RESOLUTION_GRID_KINDS, 'instance-voxel-grid', 'voxel-evidence-overlay',
]);

const MAX_SOURCE_CELLS = 1_000_000;
const MAX_MESHES = 40;
type Cell = [number, number, number];
type Grid = { stepM: number; originM: number[]; cells: Cell[] };

export interface LoadedE22Layer {
  object: THREE.Object3D;
  totalCells?: number;
  setVoxelFraction?(fraction: number): number;
  setOpacity(value: number): void;
  setClipping(enabled: boolean, heightM: number): void;
  dispose(): void;
}

/** A nested, deterministic prefix spread across the source grid's index order. */
export function spreadVoxelOrder(count: number, limit = count): number[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_SOURCE_CELLS ||
      !Number.isSafeInteger(limit) || limit < 0 || limit > count) throw new Error('Invalid E22 voxel count.');
  const bits = count <= 1 ? 0 : Math.ceil(Math.log2(count));
  const order: number[] = [];
  for (let i = 0; order.length < limit; i++) {
    let value = i, reversed = 0;
    for (let bit = 0; bit < bits; bit++) { reversed = (reversed << 1) | (value & 1); value >>>= 1; }
    if (reversed < count) order.push(reversed);
  }
  return order;
}

function safeAssetUrl(link: E22ScanLink, uri: string): string {
  const parts = uri.split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || !/^[\w.-]+$/.test(part))) {
    throw new Error('Unsafe E22 asset path.');
  }
  const base = link.manifestUrl.slice(0, link.manifestUrl.lastIndexOf('/') + 1);
  return base + parts.map(encodeURIComponent).join('/');
}

async function assetBytes(link: E22ScanLink, uri: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(safeAssetUrl(link, uri), { signal });
  if (!response.ok) throw new Error('Could not load E22 asset ' + uri + ' (' + response.status + ').');
  return response.arrayBuffer();
}

async function assetJson(link: E22ScanLink, uri: string, signal: AbortSignal): Promise<any> {
  const response = await fetch(safeAssetUrl(link, uri), { signal });
  if (!response.ok) throw new Error('Could not load E22 asset ' + uri + ' (' + response.status + ').');
  return response.json();
}

function finiteTriple(value: unknown): value is Cell {
  return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

export function unpackSurfaceKeys(keys: number[], counts: number[]): Cell[] {
  if (!finiteTriple(counts) || counts.some(n => !Number.isInteger(n) || n <= 0)) throw new Error('Invalid packed E22 grid dimensions.');
  const [, ny, nz] = counts;
  const total = counts[0] * ny * nz;
  return keys.map(key => {
    if (!Number.isSafeInteger(key) || key < 0 || key >= total) throw new Error('Packed E22 grid key is outside its bounds.');
    const x = Math.floor(key / (ny * nz)), remainder = key % (ny * nz);
    return [x, Math.floor(remainder / nz), remainder % nz];
  });
}

function chooseGrid(data: any, stepM: number, packed = false): Grid {
  const grids = packed ? data?.sources?.ply?.grids : data?.grids;
  if (!grids || typeof grids !== 'object') throw new Error('E22 grid has no resolution levels.');
  const entry = grids[String(stepM)];
  if (!entry) throw new Error('Requested E22 grid resolution is unavailable.');
  const step = packed ? entry.step : entry.stepM;
  const origin = packed ? entry.origin : entry.originM;
  if (!Number.isFinite(step) || step <= 0 || Math.abs(step - stepM) > 1e-9 || !finiteTriple(origin))
    throw new Error('Invalid or mismatched E22 grid coordinates.');
  const cells = packed ? unpackSurfaceKeys(entry.keys, entry.counts) : entry.cells;
  if (!Array.isArray(cells) || cells.length > MAX_SOURCE_CELLS || cells.some(cell => !finiteTriple(cell))) {
    throw new Error('E22 grid exceeds the source safety limit or contains invalid cells. Select a coarser level.');
  }
  return { stepM: step, originM: origin, cells };
}

function instanceGrid(data: any): Grid {
  if (!Array.isArray(data?.cells) || data.cells.length > MAX_SOURCE_CELLS ||
      !finiteTriple(data?.grid?.originM) || !Number.isFinite(data?.grid?.stepM) || data.grid.stepM <= 0) {
    throw new Error('Invalid E22 model voxel grid.');
  }
  const cells = data.cells.map((row: any) => row?.indexXYZ);
  if (cells.some((cell: unknown) => !finiteTriple(cell))) throw new Error('Invalid E22 model voxel index.');
  return { stepM: data.grid.stepM, originM: data.grid.originM, cells };
}

/** Twelve axis-aligned cube edges, shared by every voxel instance. */
function cubeEdgePositions(): number[] {
  const positions: number[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const other = [0, 1, 2].filter(value => value !== axis);
    for (const first of [-.5, .5]) for (const second of [-.5, .5]) {
      const a = [0, 0, 0], b = [0, 0, 0];
      a[axis] = -.5; b[axis] = .5;
      a[other[0]] = b[other[0]] = first;
      a[other[1]] = b[other[1]] = second;
      positions.push(...a, ...b);
    }
  }
  return positions;
}

function makeVoxelInstances(grid: Grid, color: string, order: number, evidence?: any[]): THREE.Group {
  const group = new THREE.Group();
  group.userData.totalCells = grid.cells.length;
  const capacity = Math.min(grid.cells.length, E22_MAX_RENDER_CELLS);
  const sampledOrder = spreadVoxelOrder(grid.cells.length, capacity);
  const fill = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, depthTest: true, polygonOffset: true, polygonOffsetFactor: -1 }),
    capacity);
  fill.name = 'E22 voxel faces';
  fill.renderOrder = order;
  // MeshBasicMaterial.wireframe exposes each BoxGeometry face's triangle diagonal.
  // Instanced line geometry keeps only the twelve physical cube edges in one draw call.
  const edgeGeometry = new THREE.InstancedBufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cubeEdgePositions(), 3));
  const offsets = new Float32Array(capacity * 3);
  edgeGeometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  edgeGeometry.instanceCount = capacity;
  const outline = new THREE.LineSegments(edgeGeometry, new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
      uCellSize: { value: grid.stepM * .985 },
      uClipEnabled: { value: 0 },
      uClipHeightWorld: { value: 150 },
    },
    vertexShader: 'attribute vec3 instanceOffset; uniform float uCellSize; varying float vWorldY; void main() { vec3 cellPosition = instanceOffset + position * uCellSize; vWorldY = (modelMatrix * vec4(cellPosition, 1.0)).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(cellPosition, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; uniform float uClipEnabled; uniform float uClipHeightWorld; varying float vWorldY; void main() { if (uClipEnabled > 0.5 && vWorldY > uClipHeightWorld) discard; gl_FragColor = vec4(uColor, uOpacity); }',
    transparent: true, depthWrite: false, depthTest: true,
  }));
  outline.name = 'E22 voxel lines';
  outline.userData.e22Outline = true;
  outline.renderOrder = order + 1;
  // The shared unit cube bounds cannot include all per-instance offsets.
  outline.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < capacity; i++) {
    const sourceIndex = sampledOrder[i];
    const c = grid.cells[sourceIndex];
    dummy.position.set(grid.originM[0] + (c[0] + .5) * grid.stepM,
      grid.originM[1] + (c[1] + .5) * grid.stepM,
      grid.originM[2] + (c[2] + .5) * grid.stepM);
    dummy.scale.setScalar(grid.stepM * .985);
    dummy.updateMatrix();
    fill.setMatrixAt(i, dummy.matrix);
    offsets.set(dummy.position.toArray(), i * 3);
    if (evidence) {
      const row = evidence[sourceIndex];
      const conflicts = row?.instanceEvidence?.some((item: any) => item.sameCellConflictFaceIds?.length);
      const support = row?.instanceEvidence?.some((item: any) => item.sameCellSourceFaceIds?.length);
      tint.set(conflicts ? '#f68b9d' : support ? '#87dec4' : '#d9a5c0');
      fill.setColorAt(i, tint);
    }
  }
  fill.instanceMatrix.needsUpdate = true;
  edgeGeometry.getAttribute('instanceOffset').needsUpdate = true;
  if (fill.instanceColor) fill.instanceColor.needsUpdate = true;
  group.add(fill, outline);
  return group;
}

function makePly(bytes: ArrayBuffer, color: string, order: number): THREE.Mesh {
  const geometry = new PLYLoader().parse(bytes);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: geometry.getAttribute('color') ? '#ffffff' : color,
    vertexColors: !!geometry.getAttribute('color'), side: THREE.DoubleSide,
    transparent: true, opacity: 1, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: 1,
  }));
  // Scan PLY and TSDF are comparison evidence. At 100% opacity they must not
  // become a depth mask that hides the later voxel faces and cube outlines.
  mesh.userData.e22NonOccludingEvidence = true;
  mesh.renderOrder = order;
  return mesh;
}

function makePointCloud(bytes: ArrayBuffer, color: string, order: number): THREE.Points {
  const geometry = new PLYLoader().parse(bytes);
  if (!geometry.getAttribute('position')) throw new Error('E22 point cloud has no positions.');
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: geometry.getAttribute('color') ? '#ffffff' : color,
    vertexColors: !!geometry.getAttribute('color'), size: 1.8, sizeAttenuation: true,
    transparent: true, opacity: 1, depthWrite: false, depthTest: true,
  }));
  points.renderOrder = order;
  return points;
}

function makeBoxLines(center: number[], size: number[], rotY: number, color: string, order: number): THREE.Object3D {
  if (!finiteTriple(center) || !finiteTriple(size) || size.some(n => n < 0)) throw new Error('Invalid E22 box geometry.');
  const box = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const edges = new THREE.EdgesGeometry(box);
  box.dispose();
  const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }));
  lines.position.set(...center);
  lines.rotation.y = Number.isFinite(rotY) ? rotY : 0;
  lines.renderOrder = order;
  return lines;
}

function makeRoomLines(data: any, color: string, order: number): THREE.Object3D {
  if (!Array.isArray(data?.walls)) throw new Error('Invalid E22 RoomPlan structure.');
  const coordinates: number[] = [];
  const line = (a: number[], b: number[]) => coordinates.push(...a, ...b);
  for (const wall of data.walls) {
    if (!Array.isArray(wall.a) || !Array.isArray(wall.b)) continue;
    const h = Number.isFinite(wall.height) ? wall.height : 2.5;
    const a = [wall.a[0], 0, wall.a[1]], b = [wall.b[0], 0, wall.b[1]];
    if (!finiteTriple(a) || !finiteTriple(b)) continue;
    const topA = [a[0], h, a[2]], topB = [b[0], h, b[2]];
    line(a, b); line(topA, topB); line(a, topA); line(b, topB);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }));
  lines.renderOrder = order;
  return lines;
}

function own(object: THREE.Object3D, totalCells?: number): LoadedE22Layer {
  let disposed = false;
  let displayOpacity: number | undefined;
  let clipEnabled = false;
  let clipHeightWorld = 150;
  // E22 geometry is in metres, but its viewer parent scales it to centimetres.
  // Three's material clipping planes and the outline shader both use world space.
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), clipHeightWorld);
  const materials = new Set<THREE.Material>();
  object.traverse(child => {
    const renderable = child as THREE.Mesh;
    if (renderable.material) {
      for (const material of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) materials.add(material);
    }
  });
  const baseOpacity = new Map([...materials].map(material => [material, material.opacity]));
  return {
    object,
    totalCells,
    setVoxelFraction: totalCells === undefined ? undefined : (fraction) => {
      const capacity = Math.min(totalCells, E22_MAX_RENDER_CELLS);
      const count = Number.isFinite(fraction)
        ? Math.max(0, Math.min(capacity, Math.round(totalCells * THREE.MathUtils.clamp(fraction, 0, 1)))) : 0;
      const fill = object.children[0] as THREE.InstancedMesh;
      const outlines = object.children[1] as THREE.LineSegments<THREE.InstancedBufferGeometry>;
      fill.count = count;
      outlines.geometry.instanceCount = count;
      return count;
    },
    setOpacity(value) {
      const opacity = Math.max(0, Math.min(1, value));
      if (displayOpacity === opacity) return;
      displayOpacity = opacity;
      object.traverse(child => {
        const renderable = child as THREE.Mesh;
        if (!renderable.material) return;
        const list = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const material of list) {
          material.opacity = child.userData.e22Outline && opacity > 0 ? Math.min(.65, Math.max(.18, opacity * 2.8)) : opacity * (baseOpacity.get(material) ?? 1);
          if (material instanceof THREE.ShaderMaterial && material.uniforms.uOpacity) {
            material.uniforms.uOpacity.value = material.opacity;
          }
          material.transparent = material.opacity < 1;
          material.depthWrite = material.opacity >= 1 && !child.userData.e22Outline && !child.userData.e22NonOccludingEvidence;
          material.needsUpdate = true;
        }
      });
    },
    setClipping(enabled, heightM) {
      if (!Number.isFinite(heightM)) return;
      const nextHeightWorld = heightM * 100;
      if (clipEnabled === enabled && clipHeightWorld === nextHeightWorld) return;
      const toggled = clipEnabled !== enabled;
      clipEnabled = enabled;
      clipHeightWorld = nextHeightWorld;
      clipPlane.constant = nextHeightWorld;
      object.traverse(child => {
        const renderable = child as THREE.Mesh;
        if (!renderable.material) return;
        for (const material of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) {
          if (child.userData.e22Outline && material instanceof THREE.ShaderMaterial) {
            material.uniforms.uClipEnabled.value = enabled ? 1 : 0;
            material.uniforms.uClipHeightWorld.value = nextHeightWorld;
          } else if (toggled) {
            material.clippingPlanes = enabled ? [clipPlane] : [];
            material.needsUpdate = true;
          }
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.parent?.remove(object);
      const geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>();
      object.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
      for (const texture of textures) texture.dispose();
    },
  };
}

/** Geometry arrives in room-local metres. The viewer scales the returned root by 100 once. */
export async function loadE22Layer(link: E22ScanLink, layer: E22Layer, stepM: number, signal: AbortSignal): Promise<LoadedE22Layer> {
  if (!layer.available || !layer.renderable || !layer.geometryUri || !E22_RENDERABLE_KINDS.has(layer.kind)) {
    throw new Error('E22 layer has no supported display asset.');
  }
  const color = layer.visual.color || '#b8d8d4', order = layer.renderOrder || 50;
  let object: THREE.Object3D;
  switch (layer.kind) {
    case 'triangle-mesh':
      object = makePly(await assetBytes(link, layer.geometryUri, signal), color, order); break;
    case 'point-cloud':
      object = makePointCloud(await assetBytes(link, layer.geometryUri, signal), color, order); break;
    case 'named-glb': {
      const bytes = await assetBytes(link, layer.geometryUri, signal);
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(() => { throw new Error('E22 GLB may not load external resources.'); });
      object = (await new GLTFLoader(manager).parseAsync(bytes, '')).scene;
      object.traverse(child => { child.renderOrder = order; });
      break;
    }
    case 'roomplan-structure':
      object = makeRoomLines(await assetJson(link, layer.geometryUri, signal), color, order); break;
    case 'oriented-boxes': {
      const data = await assetJson(link, layer.geometryUri, signal);
      const group = new THREE.Group();
      for (const item of data.objects ?? []) {
        const box = item.roomPlanObb;
        if (box) group.add(makeBoxLines(box.center, box.size, box.rotY, color, order));
      }
      object = group; break;
    }
    case 'axis-aligned-boxes': {
      const data = await assetJson(link, layer.geometryUri, signal);
      const group = new THREE.Group();
      for (const item of data.objects ?? []) {
        const min = item.aabb?.min, max = item.aabb?.max;
        if (!finiteTriple(min) || !finiteTriple(max)) continue;
        group.add(makeBoxLines(min.map((n, i) => (n + max[i]) / 2), min.map((n, i) => max[i] - n), 0, color, order));
      }
      object = group; break;
    }
    case 'mesh-collection': {
      const data = await assetJson(link, layer.geometryUri, signal);
      if (!Array.isArray(data.meshes) || data.meshes.length > MAX_MESHES) throw new Error('Invalid E22 furniture slice collection.');
      const group = new THREE.Group();
      try {
        for (const item of data.meshes) group.add(makePly(await assetBytes(link, item.geometryUri, signal), color, order));
      } catch (error) { own(group).dispose(); throw error; }
      object = group; break;
    }
    case 'instance-voxel-grid': {
      const data = await assetJson(link, layer.geometryUri, signal);
      object = makeVoxelInstances(instanceGrid(data), color, order); break;
    }
    case 'voxel-evidence-overlay': {
      const data = await assetJson(link, layer.geometryUri, signal);
      object = makeVoxelInstances(instanceGrid(data), color, order, data.cells); break;
    }
    default: {
      const data = await assetJson(link, layer.geometryUri, signal);
      object = makeVoxelInstances(chooseGrid(data, stepM, layer.kind === 'packed-surface-grid'), color, order);
    }
  }
  const result = own(object, E22_VOXEL_GRID_KINDS.has(layer.kind) ? (object.userData.totalCells as number) : undefined);
  result.setOpacity(layer.visual.opacity);
  return result;
}
