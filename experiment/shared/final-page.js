import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { byId, drawPlan, loadRoom, loadSummary, metrics } from './common.js';

const canvas = document.getElementById('final-canvas');
const sceneDisplay = document.getElementById('scene-display');
const planDisplay = document.getElementById('plan-display');
const status = document.getElementById('scene-status');
const select = document.getElementById('scan-select');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#152d33');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

const camera = new THREE.PerspectiveCamera(46, 1, 0.03, 100);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.13;
orbit.minDistance = 1.8;
orbit.maxDistance = 25;
orbit.maxPolarAngle = Math.PI / 2.03;

const fill = new THREE.HemisphereLight('#f9f2df', '#7c9291', 2.5);
scene.add(fill);
const sun = new THREE.DirectionalLight('#fff2d7', 3.0);
sun.position.set(-3, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(512, 512);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

const materials = {
  floor: new THREE.MeshStandardMaterial({ color: '#b7beb2', roughness: 0.94, side: THREE.DoubleSide }),
  wall: new THREE.MeshStandardMaterial({ color: '#e9ede6', roughness: 0.86 }),
  trim: new THREE.MeshStandardMaterial({ color: '#4f746f', roughness: 0.68 }),
  glass: new THREE.MeshStandardMaterial({ color: '#9dd5cf', roughness: 0.22, metalness: 0.15, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }),
  wood: new THREE.MeshStandardMaterial({ color: '#a87950', roughness: 0.76 }),
  woodSide: new THREE.MeshStandardMaterial({ color: '#7c5940', roughness: 0.85 }),
  seat: new THREE.MeshStandardMaterial({ color: '#477e7d', roughness: 0.9 }),
  cabinet: new THREE.MeshStandardMaterial({ color: '#8a9b93', roughness: 0.82 }),
  cabinetDoor: new THREE.MeshStandardMaterial({ color: '#aab8ae', roughness: 0.82 }),
};
const model = new THREE.Group();
scene.add(model);
const wallGroups = [];
let currentRoom, currentScan, showingPlan = false, daylight = true, wireframe = false;
let homeTarget = new THREE.Vector3(), homePosition = new THREE.Vector3(5, 7, 6);
let request = 0, frame = 0;

function invalidate() {
  if (frame || document.hidden || showingPlan) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    orbit.update();
    for (const wall of wallGroups) {
      // A dollhouse cutaway exposes the interior without changing the measured wall geometry.
      wall.group.visible = camera.position.clone().sub(wall.midpoint).dot(wall.normal) >= 0;
    }
    renderer.render(scene, camera);
  });
}
orbit.addEventListener('change', invalidate);
document.addEventListener('visibilitychange', invalidate);

function resize() {
  if (showingPlan) return;
  const width = sceneDisplay.clientWidth;
  const height = canvas.clientHeight;
  if (width < 2 || height < 2) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  invalidate();
}
new ResizeObserver(resize).observe(sceneDisplay);

function box(parent, material, width, height, depth, x, y, z, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addFloor(room) {
  const outline = new THREE.Shape();
  room.polygon.forEach(([x, z], index) => index ? outline.lineTo(x, -z) : outline.moveTo(x, -z));
  outline.closePath();
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(outline), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  model.add(floor);
}

function addWall(roomWall) {
  const { origin, u, length, height, openings } = roomWall;
  const local = new THREE.Group();
  local.position.set(origin[0], 0, origin[2]);
  local.rotation.y = -Math.atan2(u[2], u[0]);
  model.add(local);
  wallGroups.push({
    group: local,
    midpoint: new THREE.Vector3(origin[0] + u[0] * length / 2, height / 2, origin[2] + u[2] * length / 2),
    normal: new THREE.Vector3(...roomWall.n),
  });

  // Split at every opening boundary; cells lying inside an opening are omitted.
  const cutsU = [...new Set([0, length, ...openings.flatMap(o => [o.u0, o.u1])].map(v => Math.min(length, Math.max(0, v))))].sort((a, b) => a - b);
  const cutsV = [...new Set([0, height, ...openings.flatMap(o => [o.v0, o.v1])].map(v => Math.min(height, Math.max(0, v))))].sort((a, b) => a - b);
  for (let i = 0; i < cutsU.length - 1; i++) {
    for (let j = 0; j < cutsV.length - 1; j++) {
      const u0 = cutsU[i], u1 = cutsU[i + 1], v0 = cutsV[j], v1 = cutsV[j + 1];
      if (u1 - u0 < 0.002 || v1 - v0 < 0.002) continue;
      const midU = (u0 + u1) / 2, midV = (v0 + v1) / 2;
      if (openings.some(o => midU > o.u0 && midU < o.u1 && midV > o.v0 && midV < o.v1)) continue;
      box(local, materials.wall, u1 - u0, v1 - v0, 0.065, midU, midV, 0);
    }
  }
  for (const opening of openings) {
    if (opening.kind !== 'window') continue;
    const left = Math.max(0, opening.u0), right = Math.min(length, opening.u1);
    const bottom = Math.max(0, opening.v0), top = Math.min(height, opening.v1);
    const w = right - left, h = top - bottom;
    if (w <= 0 || h <= 0) continue;
    box(local, materials.glass, w, h, 0.012, (left + right) / 2, (bottom + top) / 2, 0, false);
    const t = 0.035;
    box(local, materials.trim, w, t, 0.09, (left + right) / 2, bottom, 0);
    box(local, materials.trim, w, t, 0.09, (left + right) / 2, top, 0);
    box(local, materials.trim, t, h, 0.09, left, (bottom + top) / 2, 0);
    box(local, materials.trim, t, h, 0.09, right, (bottom + top) / 2, 0);
    box(local, materials.trim, t * 0.75, h, 0.065, (left + right) / 2, (bottom + top) / 2, 0);
  }
}

function addFurniture(item) {
  const [width, height, depth] = item.size.map(v => Math.max(0.05, v));
  const [x, y, z] = item.center;
  const bottom = Math.max(0, y - height / 2);
  const group = new THREE.Group();
  group.position.set(x, bottom, z);
  group.rotation.y = item.rotY;
  model.add(group);
  if (item.category === 'table') {
    const top = Math.max(0.045, Math.min(0.09, height * 0.12));
    box(group, materials.wood, width, top, depth, 0, height - top / 2, 0);
    const leg = Math.min(0.065, width * 0.1, depth * 0.11);
    const insetX = Math.max(0, width / 2 - leg * 1.6), insetZ = Math.max(0, depth / 2 - leg * 1.6);
    for (const dx of [-insetX, insetX]) for (const dz of [-insetZ, insetZ])
      box(group, materials.woodSide, leg, height - top, leg, dx, (height - top) / 2, dz);
  } else if (item.category === 'chair') {
    const seatY = height * 0.42;
    box(group, materials.seat, width * 0.93, 0.075, depth * 0.88, 0, seatY, 0);
    box(group, materials.seat, width * 0.9, Math.max(0.08, height - seatY), 0.07,
      0, (height + seatY) / 2, -depth * 0.43);
    for (const dx of [-width * 0.35, width * 0.35]) for (const dz of [-depth * 0.32, depth * 0.32])
      box(group, materials.woodSide, 0.045, seatY, 0.045, dx, seatY / 2, dz);
  } else {
    box(group, materials.cabinet, width, height, depth, 0, height / 2, 0);
    const doorDepth = Math.min(0.024, depth * 0.06);
    for (const dx of [-width * 0.245, width * 0.245]) {
      box(group, materials.cabinetDoor, width * 0.48, height * 0.94, doorDepth,
        dx, height / 2, depth / 2 + doorDepth / 2);
      box(group, materials.trim, 0.018, Math.min(0.11, height * 0.14), 0.023,
        dx + (dx < 0 ? width * 0.16 : -width * 0.16), height * 0.55, depth / 2 + doorDepth + 0.012, false);
    }
  }
}

function clearModel() {
  model.traverse(child => { if (child.geometry) child.geometry.dispose(); });
  model.clear();
  wallGroups.length = 0;
}

function updateSun(room) {
  const xs = room.polygon.map(p => p[0]), zs = room.polygon.map(p => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const span = Math.max(5, size * 1.5);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 32 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
  sun.position.copy(sun.target.position).add(new THREE.Vector3(-size * 0.8, size * 2.1, size * 0.9));
}

function home() {
  orbit.target.copy(homeTarget);
  camera.position.copy(homePosition);
  camera.updateProjectionMatrix();
  orbit.update();
  resize();
}

function setView(plan) {
  showingPlan = plan;
  sceneDisplay.classList.toggle('hidden', plan);
  planDisplay.classList.toggle('active', plan);
  document.getElementById('view-3d').setAttribute('aria-pressed', String(!plan));
  document.getElementById('view-plan').setAttribute('aria-pressed', String(plan));
  document.getElementById('viewer-caption').textContent = plan
    ? 'SVG = RoomPlan 米制坐标 → 2D 墙、窗和物体边界'
    : '3D = 结构几何 × 示意材质 × 灯光 × 相机';
  if (!plan) requestAnimationFrame(resize);
}

function setLight(on) {
  daylight = on;
  sun.visible = on;
  fill.intensity = on ? 2.5 : 0.95;
  renderer.toneMappingExposure = on ? 1.45 : 1.7;
  document.getElementById('toggle-light').setAttribute('aria-pressed', String(on));
  invalidate();
}

function setWire(on) {
  wireframe = on;
  for (const material of Object.values(materials)) material.wireframe = on;
  document.getElementById('toggle-wire').setAttribute('aria-pressed', String(on));
  invalidate();
}

async function switchScan(id) {
  const token = ++request;
  const scan = byId(windowSummary, id);
  select.value = scan.id;
  status.textContent = '读取 ' + scan.archive + ' 的结构房间…';
  try {
    const room = await loadRoom(scan.id);
    if (token !== request) return;
    currentScan = scan; currentRoom = room;
    const url = new URL(location.href); url.searchParams.set('scan', scan.id); history.replaceState(null, '', url);
    clearModel();
    addFloor(room);
    room.walls.forEach(addWall);
    room.objects.forEach(addFurniture);
    updateSun(room);
    drawPlan(document.getElementById('plan-svg'), room);
    metrics(document.getElementById('metrics'), [
      [room.walls.length, '结构墙段'],
      [room.walls.reduce((n, w) => n + w.openings.filter(o => o.kind === 'window').length, 0), '窗洞'],
      [room.objects.length, '家具边界框'],
      [scan.polygonBounds.map(n => n.toFixed(1)).join(' × ') + ' m', '平面外接范围'],
    ]);
    document.getElementById('room-note').textContent = scan.archive + ' 的结构已载入。' +
      (scan.hasMesh ? '原始 PLY 保留在实验 1；这里用 RoomPlan JSON 生成可编辑粗模。' : '原始包没有 PLY；这里依据 RoomPlan JSON 生成可编辑粗模。');
    const xs = room.polygon.map(p => p[0]), zs = room.polygon.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    homeTarget.set(cx, 1.05, cz);
    homePosition.set(cx + span * 1.45, span * 1.9, cz + span * 1.5);
    orbit.maxDistance = Math.max(15, span * 6);
    status.textContent = 'RoomPlan → Three.js 初稿 · 前景墙随视角剖开';
    home();
  } catch (error) {
    status.textContent = '场景载入失败：' + error.message;
    console.error(error);
  }
}

document.getElementById('view-3d').addEventListener('click', () => setView(false));
document.getElementById('view-plan').addEventListener('click', () => setView(true));
document.getElementById('toggle-light').addEventListener('click', () => setLight(!daylight));
document.getElementById('toggle-wire').addEventListener('click', () => setWire(!wireframe));
document.getElementById('reset-view').addEventListener('click', home);
select.addEventListener('change', () => switchScan(select.value));

let windowSummary;
try {
  windowSummary = await loadSummary();
  await switchScan(new URLSearchParams(location.search).get('scan') || 'office-2');
} catch (error) {
  status.textContent = error.message;
  console.error(error);
}
