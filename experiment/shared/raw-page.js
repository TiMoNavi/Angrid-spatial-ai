import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { PLYLoader } from './vendor/PLYLoader.js';
import { asset, byId, formatBytes, loadRawRoom, loadSummary, metrics } from './common.js';

const canvas = document.getElementById('raw-canvas');
const display = canvas.parentElement;
const status = document.getElementById('raw-status');
const select = document.getElementById('scan-select');
const meshButton = document.getElementById('mode-mesh');
const pointsButton = document.getElementById('mode-points');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#13272e');
const camera = new THREE.PerspectiveCamera(52, 1, 0.02, 200);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.15;
orbit.minDistance = 0.35;
orbit.maxDistance = 45;
const grid = new THREE.GridHelper(8, 16, '#627b80', '#35535b');
scene.add(grid);
let geometry, object, summary, current, mode = 'points', center = new THREE.Vector3(), distance = 6, request = 0, frame = 0;

function invalidate() {
  if (frame || document.hidden) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    orbit.update();
    renderer.render(scene, camera);
  });
}
orbit.addEventListener('change', invalidate);
document.addEventListener('visibilitychange', invalidate);
new ResizeObserver(() => {
  const width = display.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  invalidate();
}).observe(display);

function home() {
  orbit.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(distance * 0.85, distance * 0.55, distance * 0.85));
  camera.near = Math.max(0.015, distance / 500);
  camera.far = Math.max(50, distance * 30);
  camera.updateProjectionMatrix();
  orbit.update();
  invalidate();
}

function showMode(next) {
  mode = current && current.hasMesh ? next : 'points';
  meshButton.setAttribute('aria-pressed', String(mode === 'mesh'));
  pointsButton.setAttribute('aria-pressed', String(mode === 'points'));
  if (object) {
    scene.remove(object);
    object.material.dispose();
  }
  if (!geometry) return;
  const colored = !!geometry.getAttribute('color');
  if (mode === 'mesh' && geometry.index) {
    object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: colored ? '#ffffff' : '#83c7bb', vertexColors: colored, side: THREE.DoubleSide }));
  } else {
    object = new THREE.Points(geometry, new THREE.PointsMaterial({ color: colored ? '#ffffff' : '#71d7c5', vertexColors: colored, size: current.hasMesh ? 0.018 : 0.026, sizeAttenuation: true }));
  }
  scene.add(object);
  document.getElementById('viewer-caption').textContent = current.hasMesh
    ? (mode === 'mesh' ? 'ZIP 内原始 PLY 面片 · 颜色为采集诊断色' : '同一原始 PLY 的顶点显示 · 并非高斯泼溅')
    : '12 帧深度样本的稀疏投影 · 原包没有完整 PLY 网格';
  invalidate();
}

function showDetails(scan) {
  metrics(document.getElementById('metrics'), [
    [scan.fileCount, 'ZIP 文件项'], [scan.photoCount, '原始照片'],
    [scan.depthFrameCount, '采样深度帧'],
    [scan.hasMesh ? scan.mesh.vertices.toLocaleString() : '无', '原始 PLY 顶点'],
  ]);
  document.getElementById('archive-note').textContent = scan.archive + ' · ' + formatBytes(scan.archiveBytes) + ' · ' + scan.format + '。' +
    (scan.hasMesh ? '包含可直接查看的 LiDAR 三角网格。' : '未导出 PLY；页面点图是从采样深度帧作数学投影。');
  const list = document.getElementById('file-list');
  list.replaceChildren();
  for (const file of scan.files) {
    const row = document.createElement('li');
    const name = document.createElement('code'); name.textContent = file.name;
    const size = document.createElement('span'); size.textContent = formatBytes(file.bytes);
    row.append(name, size); list.append(row);
  }
  document.getElementById('depth-rgb').src = asset(scan.id, 'depth-rgb.jpg');
  document.getElementById('depth-heat').src = asset(scan.id, 'depth-heat.png');
  document.getElementById('rgb-caption').textContent = '深度记录第 ' + scan.depthSampleIndex + ' 帧 · 配套的 640 × 480 RGB';
  document.getElementById('depth-caption').textContent = '同一帧的 256 × 192 Float16 深度伪彩色；仅显示数值，暗色为无效像素。';
  const gallery = document.getElementById('photo-gallery');
  gallery.replaceChildren();
  for (const photo of scan.samples) {
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.src = asset('', photo.file); image.loading = 'lazy'; image.alt = '扫描照片编号 ' + photo.index;
    const caption = document.createElement('figcaption');
    caption.textContent = '照片 ' + String(photo.index).padStart(2, '0') + ' · 模糊指标 ' + (photo.blur == null ? '无' : photo.blur.toFixed(1));
    figure.append(image, caption); gallery.append(figure);
  }
}

async function switchScan(id) {
  const token = ++request;
  current = byId(summary, id);
  select.value = current.id;
  const url = new URL(location.href); url.searchParams.set('scan', current.id); history.replaceState(null, '', url);
  status.textContent = '读取 ' + current.archive + ' 的显示证据…';
  meshButton.disabled = !current.hasMesh;
  showDetails(current);
  try {
    const [loaded, raw] = await Promise.all([
      new PLYLoader().loadAsync(asset(current.id, current.hasMesh ? 'raw-mesh.ply' : 'depth-cloud.ply')),
      loadRawRoom(current.id),
    ]);
    if (token !== request) { loaded.dispose(); return; }
    if (object) { scene.remove(object); object.material.dispose(); object = undefined; }
    geometry?.dispose();
    geometry = loaded;
    geometry.computeBoundingBox();
    geometry.boundingBox.getCenter(center);
    distance = Math.max(2, geometry.boundingBox.getSize(new THREE.Vector3()).length() * 0.85);
    grid.position.set(center.x, geometry.boundingBox.min.y - 0.06, center.z);
    grid.scale.setScalar(Math.max(0.5, distance / 6));
    const sample = { wall: raw.walls?.[0] && { category: raw.walls[0].category, dimensions: raw.walls[0].dimensions,
      confidence: raw.walls[0].confidence, transform: raw.walls[0].transform },
      object: raw.objects?.[0] && { category: raw.objects[0].category, dimensions: raw.objects[0].dimensions } };
    document.getElementById('raw-json').textContent = JSON.stringify(sample, null, 2);
    showMode(current.hasMesh ? 'mesh' : 'points');
    home();
    status.textContent = current.hasMesh ? '原包网格 mesh/room-0.ply' : '原始深度帧 → 稀疏投影点';
  } catch (error) {
    status.textContent = '显示失败：' + error.message;
    console.error(error);
  }
}

meshButton.addEventListener('click', () => showMode('mesh'));
pointsButton.addEventListener('click', () => showMode('points'));
document.getElementById('reset-view').addEventListener('click', home);
select.addEventListener('change', () => switchScan(select.value));
try {
  summary = await loadSummary();
  await switchScan(new URLSearchParams(location.search).get('scan') || 'office-2');
} catch (error) {
  status.textContent = error.message;
  console.error(error);
}
