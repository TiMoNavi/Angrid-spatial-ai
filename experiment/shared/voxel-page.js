import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { PLYLoader } from './vendor/PLYLoader.js';
import { asset, byId, loadRoom, loadSummary, metrics } from './common.js';
import { boxCell, boxGrid, decodeCell, makeGrid, pointsInsideBox, voxelizeSurface } from './voxel-core.mjs';

const canvas = document.getElementById('voxel-canvas');
const display = document.getElementById('voxel-display');
const status = document.getElementById('voxel-status');
const scanSelect = document.getElementById('scan-select');
const evidenceSelect = document.getElementById('evidence-select');
const stepSelect = document.getElementById('grid-step');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#142b32');
scene.add(new THREE.HemisphereLight('#e3f7ef', '#6e8581', 2.2));
const keyLight = new THREE.DirectionalLight('#ffe9bf', 2.1);
keyLight.position.set(-3, 7, 5);
scene.add(keyLight);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
const surfaceClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.1);
const camera = new THREE.PerspectiveCamera(47, 1, 0.03, 80);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.13;
orbit.minDistance = 0.8;
orbit.maxDistance = 30;
orbit.maxPolarAngle = Math.PI / 2.02;

const cube = new THREE.BoxGeometry(1, 1, 1);
const roomLayer = new THREE.Group();
const furnitureLayer = new THREE.Group();
scene.add(roomLayer, furnitureLayer);
const selectedOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: '#fff0ba', depthTest: false }),
);
selectedOutline.renderOrder = 5;
scene.add(selectedOutline);
let summary, data, sourceBoxes, sourcePoints, currentGrid, currentSurface;
let furnitureMeshes = [], selectedIndex = 0, request = 0, animation = 0;
let pointMode = false, furnitureVisible = true, roomVisible = true, loading = false;

function invalidate() {
  if (animation || document.hidden) return;
  animation = requestAnimationFrame(() => {
    animation = 0;
    orbit.update();
    renderer.render(scene, camera);
  });
}
orbit.addEventListener('change', invalidate);
document.addEventListener('visibilitychange', invalidate);
function resize() {
  const width = display.clientWidth, height = canvas.clientHeight;
  if (width < 2 || height < 2) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  invalidate();
}
new ResizeObserver(resize).observe(display);

function clearGroup(group) {
  group.traverse(child => {
    if (child === group) return;
    if (child.geometry && child.geometry !== cube) child.geometry.dispose();
    if (child.isInstancedMesh) child.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => material.dispose());
    }
  });
  group.clear();
}
function removeSource() {
  if (sourceBoxes) {
    scene.remove(sourceBoxes);
    sourceBoxes.material.dispose();
    sourceBoxes.dispose();
    sourceBoxes = undefined;
  }
  if (sourcePoints) {
    scene.remove(sourcePoints);
    sourcePoints.material.dispose();
    sourcePoints = undefined;
  }
}
function home() {
  if (!data) return;
  const xs = data.room.polygon.map(p => p[0]);
  const zs = data.room.polygon.map(p => p[1]);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const z = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  orbit.target.set(x, 1.1, z);
  camera.position.set(x + span * 1.4, span * 1.55, z + span * 1.55);
  orbit.maxDistance = Math.max(12, span * 6);
  orbit.update();
  resize();
}

function buildRoom() {
  clearGroup(roomLayer);
  const outline = new THREE.Shape();
  data.room.polygon.forEach(([x, z], i) => i ? outline.lineTo(x, -z) : outline.moveTo(x, -z));
  outline.closePath();
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(outline),
    new THREE.MeshBasicMaterial({ color: '#8fa9a2', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.018;
  roomLayer.add(floor);
  const lines = [];
  const segment = (a, b) => lines.push(...a, ...b);
  for (const wall of data.room.walls) {
    const a = [wall.a[0], 0, wall.a[1]], b = [wall.b[0], 0, wall.b[1]];
    const topA = [a[0], wall.height, a[2]], topB = [b[0], wall.height, b[2]];
    segment(a, b); segment(topA, topB); segment(a, topA); segment(b, topB);
    for (const opening of wall.openings) {
      const pt = (u, v) => [wall.origin[0] + wall.u[0] * u, v, wall.origin[2] + wall.u[2] * u];
      const p0 = pt(opening.u0, opening.v0), p1 = pt(opening.u1, opening.v0);
      const p2 = pt(opening.u1, opening.v1), p3 = pt(opening.u0, opening.v1);
      segment(p0, p1); segment(p1, p2); segment(p2, p3); segment(p3, p0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  roomLayer.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#c9ddd7', transparent: true, opacity: 0.65 })));
  roomLayer.visible = roomVisible;
}

const categoryNames = { table: '桌子', chair: '椅子', storage: '储物柜', bed: '床', sofa: '沙发' };
const categoryColors = { table: '#d39b5d', chair: '#85b5c8', storage: '#b8a1cb' };
function buildFurniture() {
  clearGroup(furnitureLayer);
  furnitureMeshes = [];
  const step = currentGrid.step;
  const dummy = new THREE.Object3D();
  for (const [index, item] of data.room.objects.entries()) {
    const dimensions = boxGrid(item.size, step);
    const [nx, ny, nz] = dimensions.counts;
    const group = new THREE.Group();
    group.position.set(...item.center);
    group.rotation.y = item.rotY;
    const material = new THREE.MeshLambertMaterial({ color: categoryColors[item.category] || '#cdb789', side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(cube, material, dimensions.shellCount);
    mesh.frustumCulled = false;
    mesh.userData.itemIndex = index;
    let j = 0;
    for (let ix = 0; ix < nx; ix++) {
      const x = boxCell(item.size, step, 0, ix);
      for (let iy = 0; iy < ny; iy++) {
        const y = boxCell(item.size, step, 1, iy);
        for (let iz = 0; iz < nz; iz++) {
          if (ix && ix < nx - 1 && iy && iy < ny - 1 && iz && iz < nz - 1) continue;
          const z = boxCell(item.size, step, 2, iz);
          dummy.position.set(x.center, y.center, z.center);
          dummy.scale.set(x.length * 0.94, y.length * 0.94, z.length * 0.94);
          dummy.updateMatrix();
          mesh.setMatrixAt(j++, dummy.matrix);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    furnitureLayer.add(group);
    furnitureMeshes.push({ mesh, dimensions });
  }
  furnitureLayer.visible = furnitureVisible;
  showSelection();
}

function sourceGeometry() {
  if (evidenceSelect.value === 'ply' && data.ply) return data.ply;
  if (evidenceSelect.value === 'fusion' && data.fusion) return data.fusion;
  return data.depth;
}
function sourceName() {
  if (evidenceSelect.value === 'ply') return '原包 LiDAR 网格（inroom）';
  if (evidenceSelect.value === 'fusion') return '官方 TSDF 融合网格';
  return '全帧深度归并点';
}
function setPointMode(showPoints) {
  pointMode = showPoints;
  document.getElementById('show-voxels').setAttribute('aria-pressed', String(!showPoints));
  document.getElementById('show-points').setAttribute('aria-pressed', String(showPoints));
  if (sourceBoxes) sourceBoxes.visible = !showPoints;
  if (sourcePoints) sourcePoints.visible = showPoints;
  document.getElementById('show-points').textContent = evidenceSelect.value === 'depth' ? '深度归并点原貌' : '三角网格原貌';
  if (currentSurface) {
    const count = currentSurface.keys.length;
    status.textContent = sourceName() + (showPoints ? ' · 原貌对照；对应 ' : ' → ') +
      count.toLocaleString() + ' 个表面格' +
      (!showPoints && count > 70000 ? '；交互抽显 70,000 格' : '');
  }
  invalidate();
}
function buildSource() {
  removeSource();
  const geometry = sourceGeometry();
  const positions = geometry.getAttribute('position').array;
  const sampled = voxelizeSurface(positions, currentGrid);
  const meshGrid = data.meshCache?.sources[evidenceSelect.value]?.grids[String(currentGrid.step)];
  if (meshGrid && (meshGrid.counts.some((count, i) => count !== currentGrid.counts[i]) ||
      meshGrid.origin.some((value, i) => Math.abs(value - currentGrid.origin[i]) > 1e-8))) {
    throw new Error('网格缓存与房间坐标不一致，请重新运行 prepare_mesh_voxels.py');
  }
  currentSurface = meshGrid ? { ...sampled, keys: meshGrid.keys } : sampled;
  const { keys } = currentSurface;
  const cap = 70000;
  const shown = Math.min(keys.length, cap);
  const [ox, oy, oz] = currentGrid.origin;
  const [nx, ny, nz] = currentGrid.counts;
  const planes = [surfaceClip,
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -ox),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), ox + nx * currentGrid.step),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -oy),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), oy + ny * currentGrid.step),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -oz),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), oz + nz * currentGrid.step)];
  const dummy = new THREE.Object3D();
  sourceBoxes = new THREE.InstancedMesh(cube,
    new THREE.MeshLambertMaterial({ color: '#70bfb8', side: THREE.DoubleSide, clippingPlanes: planes }), shown);
  sourceBoxes.frustumCulled = false;
  for (let i = 0; i < shown; i++) {
    const key = keys[Math.floor(i * keys.length / shown)];
    const [ix, iy, iz] = decodeCell(key, currentGrid);
    dummy.position.set(currentGrid.origin[0] + (ix + 0.5) * currentGrid.step,
      currentGrid.origin[1] + (iy + 0.5) * currentGrid.step,
      currentGrid.origin[2] + (iz + 0.5) * currentGrid.step);
    dummy.scale.setScalar(currentGrid.step * 0.86);
    dummy.updateMatrix();
    sourceBoxes.setMatrixAt(i, dummy.matrix);
  }
  sourceBoxes.instanceMatrix.needsUpdate = true;
  scene.add(sourceBoxes);
  const colored = !!geometry.getAttribute('color');
  sourcePoints = evidenceSelect.value === 'depth' ? new THREE.Points(geometry,
    new THREE.PointsMaterial({ color: colored ? '#ffffff' : '#7fd5c7', vertexColors: colored,
      size: 0.018, sizeAttenuation: true, clippingPlanes: planes })) : new THREE.Mesh(geometry,
    new THREE.MeshBasicMaterial({ color: colored ? '#ffffff' : '#a9c2bd', vertexColors: colored,
      side: THREE.DoubleSide, clippingPlanes: planes }));
  scene.add(sourcePoints);
  setPointMode(pointMode);
  const sourceLabel = sourceName();
  document.getElementById('grid-note').textContent = '候选房间外接盒 ' + currentGrid.counts.join(' × ') + ' 格；' +
    (meshGrid ? '按三角面与格子相交生成表面格，保留网格拓扑；' : '按全帧深度归并点落格；') +
    '原貌与表面格均显示候选范围；统计包含完整高度，截面仅影响观察。未标记格不能当作净空。';
  metrics(document.getElementById('metrics'), [
    [data.report.depthFramesProcessed, '已处理深度帧'],
    [keys.length.toLocaleString(), '当前表面格'],
    [data.room.objects.length, 'RoomPlan 家具框'],
    [currentGrid.denseCount.toLocaleString(), '外接盒理论密集格'],
  ]);
  document.getElementById('viewer-caption').textContent = sourceLabel + ' · ' +
    (currentGrid.step * 100) + ' cm · XZ 地面 / Y 向上 · 单位米';
  showSelection();
  invalidate();
}

function addDetailRow(host, name, value) {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = name; dd.textContent = value;
  host.append(dt, dd);
}
function showSelection() {
  if (!data) return;
  const item = data.room.objects[selectedIndex];
  if (!item) return;
  const name = categoryNames[item.category] || item.category;
  document.querySelectorAll('#object-list button').forEach((button, i) =>
    button.setAttribute('aria-pressed', String(i === selectedIndex)));
  furnitureMeshes.forEach(({ mesh }, i) => mesh.material.emissive.set(i === selectedIndex ? '#604729' : '#000000'));
  selectedOutline.position.set(...item.center);
  selectedOutline.rotation.y = item.rotY;
  selectedOutline.scale.set(...item.size);
  selectedOutline.visible = furnitureVisible;
  const host = document.getElementById('object-detail');
  host.replaceChildren();
  const heading = document.createElement('strong'); heading.textContent = name + ' ' + (selectedIndex + 1);
  const description = document.createElement('div');
  description.textContent = '来源：RoomPlan 识别框；方块形状不是从深度或 PLY 自动分割出的家具。';
  const list = document.createElement('dl');
  addDetailRow(list, '米制尺寸', item.size.map(n => n.toFixed(3)).join(' × ') + ' m');
  addDetailRow(list, '米制中心', item.center.map(n => n.toFixed(3)).join(', '));
  addDetailRow(list, '朝向', (item.rotY * 180 / Math.PI).toFixed(1) + '°');
  if (furnitureMeshes[selectedIndex]) {
    addDetailRow(list, '粗框占位格', furnitureMeshes[selectedIndex].dimensions.occupiedCount.toLocaleString());
    const count = pointsInsideBox(sourceGeometry().getAttribute('position').array, item);
    addDetailRow(list, '框内表面点位', count.toLocaleString());
  }
  host.append(heading, description, list);
  invalidate();
}
function buildObjectList() {
  const host = document.getElementById('object-list');
  host.replaceChildren();
  data.room.objects.forEach((item, index) => {
    const button = document.createElement('button'); button.type = 'button';
    const name = document.createElement('span');
    name.textContent = (categoryNames[item.category] || item.category) + ' ' + (index + 1);
    const size = document.createElement('small'); size.textContent = item.size.map(v => v.toFixed(2)).join(' × ') + ' m';
    button.append(name, size);
    button.addEventListener('click', () => { selectedIndex = index; showSelection(); });
    host.append(button);
  });
}
function rebuild() {
  if (!data) return;
  currentGrid = makeGrid(data.room, Number(stepSelect.value));
  buildFurniture();
  buildSource();
}

async function switchScan(id) {
  const token = ++request;
  const scan = byId(summary, id);
  scanSelect.value = scan.id;
  loading = true;
  display.setAttribute('aria-busy', 'true');
  document.querySelectorAll('.voxel-panel select:not(#scan-select), .voxel-panel button, #surface-height')
    .forEach(control => { control.disabled = true; });
  status.textContent = '读取 ' + scan.archive + ' 的扫描与网格证据…';
  const owned = [];
  let committed = false, finished = false;
  try {
    const loader = new PLYLoader();
    const loadGeometry = async file => {
      const geometry = await loader.loadAsync(asset(scan.id, file));
      // Open3D writes double-precision PLY attributes; WebGL vertex buffers need
      // float32. Keep the disk geometry untouched and convert only the preview.
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        if (attribute.array instanceof Float64Array) {
          geometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
        }
      }
      if (finished && !committed) geometry.dispose();
      else owned.push(geometry);
      return geometry;
    };
    const [room, report, depth] = await Promise.all([
      loadRoom(scan.id),
      fetch(asset(scan.id, 'full-depth-surface-report.json')).then(response => {
        if (!response.ok) throw new Error('先运行实验4的 prepare_voxel_evidence.py');
        return response.json();
      }),
      loadGeometry('full-depth-surface-025.ply'),
    ]);
    if (token !== request) return;
    const meshCache = report.meshSurfaceCacheAvailable ? await fetch(asset(scan.id, 'mesh-surface-grids.json'))
      .then(response => {
        if (!response.ok) throw new Error('网格缓存不存在，请运行 prepare_mesh_voxels.py');
        return response.json();
      }) : null;
    const [fusion, roomPly] = await Promise.all(['fusion', 'ply'].map(name =>
      meshCache?.sources[name] ? loadGeometry(meshCache.sources[name].geometry) : null));
    // All these prepared assets are already room-local. Never transform them twice.
    if (token !== request) return;
    evidenceSelect.querySelector('option[value="fusion"]').disabled = !fusion;
    evidenceSelect.querySelector('option[value="ply"]').disabled = !roomPly;
    evidenceSelect.value = fusion ? 'fusion' : 'depth';
    removeSource();
    clearGroup(furnitureLayer);
    data?.depth.dispose(); data?.ply?.dispose(); data?.fusion?.dispose();
    data = { room, report, depth, ply: roomPly, fusion, scan, meshCache };
    committed = true;
    selectedIndex = 0;
    const url = new URL(location.href);
    url.searchParams.set('scan', scan.id);
    history.replaceState(null, '', url);
    document.getElementById('source-note').textContent = scan.archive + '：处理全部 ' + report.depthFramesProcessed +
      ' 帧深度，每帧每 4 像素取一个有效样本，合计 ' + report.insideCandidateBounds.toLocaleString() +
      ' 个候选房间内落点（置信度 ≥1，深度 <3.5 m）；先归并到 2.5 cm 基本网格。' +
      (fusion ? '已准备官方 TSDF 输出，可切换对照。' : '官方 TSDF 对照尚未准备。') +
      (roomPly ? '原包 PLY 按 inroom 筛出当前房间，并保留三角面。' : '没有导出 PLY，仍可从深度帧完整重建。');
    buildRoom();
    buildObjectList();
    rebuild();
    home();
  } catch (error) {
    if (token === request) {
      status.textContent = '无法载入：' + error.message;
      console.error(error);
    }
  } finally {
    finished = true;
    if (!committed) owned.forEach(geometry => geometry.dispose());
    if (token === request) {
      loading = false;
      display.setAttribute('aria-busy', 'false');
      document.querySelectorAll('.voxel-panel select:not(#scan-select), .voxel-panel button, #surface-height')
        .forEach(control => { control.disabled = !data; });
    }
  }
}

scanSelect.addEventListener('change', () => switchScan(scanSelect.value));
evidenceSelect.addEventListener('change', () => { if (data) buildSource(); });
stepSelect.addEventListener('change', rebuild);
document.getElementById('show-voxels').addEventListener('click', () => setPointMode(false));
document.getElementById('show-points').addEventListener('click', () => setPointMode(true));
document.getElementById('toggle-furniture').addEventListener('click', event => {
  furnitureVisible = !furnitureVisible;
  furnitureLayer.visible = selectedOutline.visible = furnitureVisible;
  event.currentTarget.setAttribute('aria-pressed', String(furnitureVisible)); invalidate();
});
document.getElementById('toggle-room').addEventListener('click', event => {
  roomVisible = !roomVisible;
  roomLayer.visible = roomVisible;
  event.currentTarget.setAttribute('aria-pressed', String(roomVisible)); invalidate();
});
document.getElementById('reset-view').addEventListener('click', home);
document.getElementById('surface-height').addEventListener('input', event => {
  surfaceClip.constant = Number(event.target.value);
  document.getElementById('surface-height-value').textContent = surfaceClip.constant.toFixed(1) + ' m';
  invalidate();
});
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerDown;
canvas.addEventListener('pointerdown', event => { pointerDown = [event.clientX, event.clientY]; });
canvas.addEventListener('pointerup', event => {
  if (loading || !data || !furnitureVisible || !pointerDown || Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 5) return;
  const bounds = canvas.getBoundingClientRect();
  pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
    -(event.clientY - bounds.top) / bounds.height * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(furnitureMeshes.map(entry => entry.mesh), false)[0];
  if (hit) { selectedIndex = hit.object.userData.itemIndex; showSelection(); }
});

try {
  summary = await loadSummary();
  await switchScan(new URLSearchParams(location.search).get('scan') || 'office-2');
} catch (error) {
  status.textContent = '无法载入：' + error.message;
  console.error(error);
}
