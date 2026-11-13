import * as THREE from 'three';
import { OrbitControls } from '../shared/vendor/OrbitControls.js';
import { PLYLoader } from '../shared/vendor/PLYLoader.js';
import { drawPlan, metrics } from '../shared/common.js';
import { SCAN_ID, FRAME, LAYER_SPECS, KIND_TO_LAYER, createAssetAdapter, validateManifest, decodeGrid, sampledIndices } from './layer-contract.js';

const $ = id => document.getElementById(id);
if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embed-view');
const assets = createAssetAdapter(new URL('../.private/' + SCAN_ID + '/', location.href));
const canvas = $('scan-canvas'), display = $('scan-display'), status = $('scan-status');
const palette = ['#e7ad6a', '#92c7e1', '#d7ab88', '#a8d981', '#bfa5e6'];
const objectNames = { table: '桌子', chair: '椅子', storage: '储物柜', sofa: '沙发', bed: '床' };
const specs = Object.fromEntries(LAYER_SPECS.map(spec => [spec.id, spec]));
const state = Object.fromEntries(LAYER_SPECS.map(spec => [spec.id, { checked: !!spec.checked, available: false,
  opacity: spec.opacity, clipped: spec.clipped, recordCount: null, displayCount: null, reason: spec.derived ? '未生成；等待实验 9 派生文件' : '读取中', provenance: spec.source }]));
const groups = Object.fromEntries(LAYER_SPECS.map(spec => [spec.id, new THREE.Group()]));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#142b32');
scene.add(new THREE.HemisphereLight('#e7f6f2', '#698687', 2));
const sun = new THREE.DirectionalLight('#ffe6bd', 1.6); sun.position.set(-3, 7, 5); scene.add(sun);
Object.values(groups).forEach(group => scene.add(group));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.localClippingEnabled = true;
const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.5);
const camera = new THREE.PerspectiveCamera(49, 1, .03, 100);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true; orbit.dampingFactor = .1; orbit.minDistance = .35; orbit.maxDistance = 35;
const floorGrid = new THREE.GridHelper(12, 60, '#668c8b', '#35545b');
floorGrid.position.y = -.022; floorGrid.material.transparent = true; floorGrid.material.opacity = .34; scene.add(floorGrid);
const loader = new PLYLoader(), raycaster = new THREE.Raycaster(); raycaster.params.Line.threshold = .035;
let room, cache, report, selected = 0, bounds, rawMesh, fusionMesh, depthPoints, voxelMesh;
let segmentMeshes = [], boxLines = [], aabbLines = [], fusionPromise, manifest;
let convertedHash, transformHash, derivedEntries = [], derivedPayloads = new Map(), derivedLoadVersion = 0;
let classifiedReport = null, classifiedReportWarning = '';
const layerGenerations = {};
const objectIndexById = new Map();
const presets = {
  raw: ['raw', 'room', 'boxes'], segments: ['room', 'boxes', 'segments', 'aabbs'],
  voxels: ['voxels', 'room', 'boxes'], fusion: ['fusion', 'room', 'boxes'],
  depth: ['depth', 'room', 'boxes'], structure: ['room', 'boxes'],
  classified: ['structureGrid', 'furnitureGrid', 'conflict', 'room']
};
const titles = { raw: '原始 LiDAR 扫描', segments: '家具网格候选', voxels: '原始 PLY 表面格',
  fusion: 'TSDF 融合对照', depth: '全帧深度落点', structure: 'RoomPlan 结构', classified: '先切分后的分类体素' };

function layerOn(id) { return state[id].checked && state[id].available; }
function make(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function buildLayerControls() {
  for (const spec of LAYER_SPECS) {
    const item = make('div', 'layer-item'); item.dataset.layerItem = spec.id;
    const label = make('label', 'layer-row'), input = make('input'); input.type = 'checkbox'; input.dataset.layer = spec.id;
    input.checked = state[spec.id].checked; input.disabled = true;
    const swatch = make('span', 'swatch'); swatch.style.background = spec.color;
    const copy = make('span'); copy.append(make('strong', '', spec.title), make('small', '', spec.note));
    label.append(input, swatch, copy);
    const meta = make('div', 'layer-meta'); meta.id = 'layer-meta-' + spec.id; meta.setAttribute('aria-live', 'polite');
    const details = make('details', 'layer-options'), summary = make('summary', '', '显示');
    const rangeLabel = make('label', '', '透明度 '), output = make('output', '', Math.round(spec.opacity * 100) + '%'); output.id = 'opacity-' + spec.id;
    const range = make('input'); range.type = 'range'; range.min = '5'; range.max = '100'; range.value = String(spec.opacity * 100); range.dataset.opacity = spec.id;
    range.setAttribute('aria-label', spec.title + '透明度'); rangeLabel.append(output, range);
    const cutLabel = make('label', 'layer-cut'), cutInput = make('input'); cutInput.type = 'checkbox'; cutInput.checked = spec.clipped; cutInput.dataset.clip = spec.id;
    cutLabel.append(cutInput, document.createTextNode('受水平剖切影响'));
    const source = make('p', 'layer-source', '来源：' + spec.source); source.id = 'layer-source-' + spec.id;
    details.append(summary, rangeLabel, cutLabel, source); item.append(label, meta, details);
    $(spec.derived ? 'derived-layer-controls' : 'base-layer-controls').append(item);
    input.addEventListener('change', () => { state[spec.id].checked = input.checked; customView(); syncLayers(); });
    range.addEventListener('input', () => { state[spec.id].opacity = Number(range.value) / 100; applyLayerStyle(spec.id); });
    cutInput.addEventListener('change', () => { state[spec.id].clipped = cutInput.checked; applyLayerStyle(spec.id); });
    refreshLayerRow(spec.id);
  }
}
function refreshLayerRow(id) {
  const row = state[id], input = document.querySelector('[data-layer="' + id + '"]');
  input.disabled = !row.available; input.checked = row.checked;
  const host = document.querySelector('[data-layer-item="' + id + '"]'); host.classList.toggle('unavailable', !row.available);
  const counts = row.recordCount === null ? '' : Number(row.recordCount).toLocaleString() + ' 全量 / ' + Number(row.displayCount ?? row.recordCount).toLocaleString() + ' 显示';
  $('layer-meta-' + id).textContent = [row.reason, counts].filter(Boolean).join(' · ');
  $('layer-source-' + id).textContent = '来源：' + row.provenance;
  document.querySelector('[data-opacity="' + id + '"]').disabled = !row.available;
  document.querySelector('[data-clip="' + id + '"]').disabled = !row.available;
}
function setAvailable(id, available, reason = '', counts = {}) {
  Object.assign(state[id], { available, reason }, counts);
  if (!available) state[id].checked = false;
  refreshLayerRow(id);
}
function applyLayerStyle(id) {
  const row = state[id]; $('opacity-' + id).textContent = Math.round(row.opacity * 100) + '%';
  document.querySelector('[data-opacity="' + id + '"]').value = String(row.opacity * 100);
  groups[id].traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      material.opacity = row.opacity * (material.userData.opacityScale ?? 1);
      material.clippingPlanes = row.clipped ? [clip] : []; material.needsUpdate = true;
    }
  });
}
function customView() {
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  $('view-title').textContent = '自定义图层';
}
function resize() { const w = display.clientWidth, h = canvas.clientHeight; if (w < 2 || h < 2) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(display);
function render() { requestAnimationFrame(render); if (document.hidden) return; orbit.update(); renderer.render(scene, camera); }
render(); buildLayerControls();

async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join(''); }
async function fetchBytes(url) { const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error('文件未准备：' + new URL(url).pathname.split('/').pop()); return response.arrayBuffer(); }
async function jsonAsset(file) { const bytes = await fetchBytes(assets.url(file)); return { data: JSON.parse(new TextDecoder().decode(bytes)), bytes }; }
async function loadGeometry(file, derived = false, descriptor) {
  const url = derived ? assets.derivedUrl(file) : assets.url(file);
  let geometry;
  if (descriptor) { const bytes = await verifiedBytes(url, descriptor); geometry = loader.parse(bytes); }
  else geometry = await loader.loadAsync(url);
  for (const [name, attr] of Object.entries(geometry.attributes)) if (attr.array instanceof Float64Array)
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(attr.array, attr.itemSize, attr.normalized));
  if (geometry.index && !geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}
function addMesh(id, geometry, color, vertexColors = false) {
  const material = new THREE.MeshStandardMaterial({ color, vertexColors, side: THREE.DoubleSide, transparent: true, depthWrite: false, roughness: .9 });
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; groups[id].add(mesh); applyLayerStyle(id); return mesh;
}
function addBox(id, center, size, yaw, color, index) {
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false }));
  line.position.set(...center); line.scale.set(...size); line.rotation.y = yaw; line.renderOrder = 5;
  line.userData = { objectIndex: index, layerId: id }; groups[id].add(line); return line;
}
function buildRoom() {
  const shape = new THREE.Shape(); room.polygon.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)); shape.closePath();
  const floorMaterial = new THREE.MeshBasicMaterial({ color: '#8fa9a2', side: THREE.DoubleSide, transparent: true, depthWrite: false }); floorMaterial.userData.opacityScale = .22;
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -.026; groups.room.add(floor);
  const lines = [], line = (a, b) => lines.push(...a, ...b);
  for (const wall of room.walls) {
    const a = [wall.a[0], 0, wall.a[1]], b = [wall.b[0], 0, wall.b[1]], c = [a[0], wall.height, a[2]], d = [b[0], wall.height, b[2]];
    line(a, b); line(c, d); line(a, c); line(b, d);
    for (const opening of wall.openings || []) {
      const at = (u, y) => [wall.origin[0] + wall.u[0] * u, y, wall.origin[2] + wall.u[2] * u];
      const corners = [at(opening.u0, opening.v0), at(opening.u1, opening.v0), at(opening.u1, opening.v1), at(opening.u0, opening.v1)];
      for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4]);
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  groups.room.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#d8ece5', transparent: true })));
  setAvailable('room', true, '米制结构先验', { recordCount: room.walls.length, displayCount: room.walls.length }); applyLayerStyle('room');
}
function buildBoxes() {
  boxLines = room.objects.map((item, i) => addBox('boxes', item.center, item.size, item.rotY, palette[i % palette.length], i));
  aabbLines = (report?.objects || []).map((row, i) => {
    if (!row.meshAabb) return null; const lo = row.meshAabb.min, hi = row.meshAabb.max;
    return addBox('aabbs', lo.map((v, j) => (v + hi[j]) / 2), lo.map((v, j) => hi[j] - v), 0, '#ffe189', i);
  });
  setAvailable('boxes', true, '粗尺寸，不代表完整扫描', { recordCount: boxLines.length, displayCount: boxLines.length });
  setAvailable('aabbs', !!aabbLines.length, aabbLines.length ? '候选片段边界' : '缺少候选切片报告', { recordCount: aabbLines.filter(Boolean).length, displayCount: aabbLines.filter(Boolean).length });
  applyLayerStyle('boxes'); applyLayerStyle('aabbs');
}
function disposeChildren(group) { for (const child of [...group.children]) { group.remove(child); child.traverse(object => { object.geometry?.dispose(); for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) material.dispose(); object.dispose?.(); }); } }
function disposeGroup(id) { disposeChildren(groups[id]); }
function instanceCells(id, records, stepM, descriptor = {}, targetGroup = groups[id]) {
  const shown = sampledIndices(records.length), dummy = new THREE.Object3D();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: specs[id].color, transparent: true, depthWrite: false }), shown.length);
  mesh.frustumCulled = false; mesh.userData.layerId = id; mesh.userData.stepM = stepM;
  const objectIndex = descriptor.convertedIndex ?? objectIndexById.get(descriptor.objectId);
  if (Number.isInteger(objectIndex)) mesh.userData.objectIndex = objectIndex;
  mesh.userData.cells = shown.map(index => records[index]);
  for (let i = 0; i < shown.length; i++) {
    const cell = records[shown[i]]; dummy.position.set(...cell.center); dummy.scale.setScalar(stepM * .88); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    const index = cell.convertedIndices?.length === 1 ? cell.convertedIndices[0] : objectIndexById.get(cell.objectId);
    if (Number.isInteger(index) && ['furnitureGrid', 'furnitureCorrected'].includes(id)) mesh.setColorAt(i, new THREE.Color(palette[index % palette.length]));
  }
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  targetGroup.add(mesh); if (targetGroup === groups[id]) applyLayerStyle(id); return shown.length;
}
function makeVoxelMesh() {
  if (!cache?.sources?.ply) return;
  disposeGroup('voxels'); voxelMesh = null;
  try {
    const stepM = Number($('voxel-step').value), source = cache.sources.ply.grids[String(stepM)];
    if (!source) throw new Error('未准备该尺度的 PLY 表面格');
    const decoded = decodeGrid({ ...source, stepM }, stepM), shown = instanceCells('voxels', decoded.cells, stepM);
    voxelMesh = groups.voxels.children[0]; setAvailable('voxels', true, stepM * 100 + ' cm · 仅观察表面', { recordCount: decoded.cells.length, displayCount: shown });
    $('layer-caption').textContent = stepM * 100 + ' cm 显示格距；更细不提高测量精度 · 米 / Y 向上';
  } catch (error) { setAvailable('voxels', false, error.message); }
}
function setOpacity() { const value = Number($('scan-opacity').value) / 100; $('opacity-value').textContent = Math.round(value * 100) + '%'; for (const id of ['raw', 'fusion', 'depth']) { state[id].opacity = value; applyLayerStyle(id); } }
function setCut() { clip.constant = $('cut-enabled').checked ? Number($('cut-height').value) : 1000; $('height-value').textContent = Number($('cut-height').value).toFixed(1) + ' m'; }
async function ensureFusion() {
  if (fusionMesh) return; if (!fusionPromise) fusionPromise = loadGeometry('reference-depth/scan_room.ply').then(geometry => { fusionMesh = addMesh('fusion', geometry, '#ffffff', !!geometry.getAttribute('color')); fusionMesh.renderOrder = 2; const count = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count; setAvailable('fusion', true, '融合观察网格；非 Gaussian splat', { recordCount: count, displayCount: count }); });
  await fusionPromise;
}
async function syncLayers() {
  if (layerOn('fusion') && !fusionMesh) { status.textContent = '载入全帧深度融合网格…'; try { await ensureFusion(); } catch (error) { setAvailable('fusion', false, error.message); } }
  for (const spec of LAYER_SPECS) groups[spec.id].visible = layerOn(spec.id);
  updateSelection(); status.textContent = LAYER_SPECS.filter(spec => layerOn(spec.id)).length + ' 个图层可见 · Office 2' + ($('cut-enabled').checked ? ' · 观察剖切 ' + Number($('cut-height').value).toFixed(1) + ' m' : ' · 全高显示');
}
function setPreset(name) {
  if (!presets[name]) name = 'raw';
  for (const spec of LAYER_SPECS) { state[spec.id].checked = state[spec.id].available && presets[name].includes(spec.id); refreshLayerRow(spec.id); }
  document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === name)));
  $('view-title').textContent = titles[name]; syncLayers();
}
function selectedIndexForCell(cell, fallback) { if (cell?.convertedIndices?.length === 1) return cell.convertedIndices[0]; return objectIndexById.get(cell?.objectId) ?? fallback; }
function cellBelongsTo(cell, index, fallback) { return cell.convertedIndices?.includes(index) || cell.ownerIds?.some(id => objectIndexById.get(id) === index) || selectedIndexForCell(cell, fallback) === index; }
function updateSelection() {
  if (!room) return;
  document.querySelectorAll('#object-list button').forEach((button, i) => button.setAttribute('aria-pressed', String(i === selected)));
  const only = $('only-selected').checked;
  segmentMeshes.forEach((mesh, i) => { if (mesh) mesh.visible = !only || i === selected; });
  aabbLines.forEach((line, i) => { if (line) line.visible = !only || i === selected; });
  boxLines.forEach((line, i) => line.material.color.set(i === selected ? '#ffffff' : palette[i % palette.length]));
  // Furniture isolation is rebuilt from original CPU records, including shared coarse cells.
  for (const id of ['furnitureGrid', 'furnitureCorrected']) for (const mesh of groups[id].children) mesh.visible = true;
  const item = room.objects[selected], row = report?.objects?.[selected], host = $('object-detail'); host.replaceChildren();
  host.append(make('h3', '', (objectNames[item.category] || item.category) + ' ' + (selected + 1)), make('p', '', '下表是原裁片统计。识别 OBB 是尺寸先验，AABB 只是该观察片段。'));
  const dl = make('dl'), add = (key, value) => dl.append(make('dt', '', key), make('dd', '', value));
  add('RoomPlan 尺寸', item.size.map(v => v.toFixed(2)).join(' × ') + ' m');
  if (row) { add('切片保留', row.keptFaces.toLocaleString() + ' 面'); add('剔除小碎片', row.removedFaces.toLocaleString() + ' 面'); add('保留连通片', row.componentsAfterCleanup.toLocaleString()); add('封闭水密', row.watertight ? '是' : '否');
    if (row.meshAabb) add('观察 AABB', row.meshAabb.max.map((v, i) => (v - row.meshAabb.min[i]).toFixed(3)).join(' × ') + ' m'); }
  else add('候选切片', '缺少报告');
  host.append(dl); const download = $('download-segment'); download.href = row?.file ? assets.url('segments/' + row.file) : '#'; download.setAttribute('aria-disabled', String(!row?.file));
  const mapping = manifest?.objectMappings?.find(entry => (entry.convertedIndex ?? entry.index) === selected);
  const classified = $('classified-object-detail'); classified.replaceChildren();
  if (mapping) {
    classified.append(make('strong', '', '实验 9 分类实例'), make('p', 'object-id', mapping.objectId), make('p', '', '匹配状态：' + (mapping.mappingState || mapping.status || mapping.matchStatus || '见分类报告')));
    const classification = classifiedReport?.objects?.find(entry => entry.objectId === mapping.objectId);
    if (classification) {
      const stats = make('dl'), append = (key, value) => stats.append(make('dt', '', key), make('dd', '', value));
      append('单一归属面', classification.faceCount.toLocaleString()); append('涉及冲突面', classification.conflictFaceCount.toLocaleString());
      append('候选关联面', classification.candidateFaceCount.toLocaleString()); append('封闭水密', classification.watertight ? '是' : '否'); classified.append(stats);
      classified.append(make('p', '', '面冲突与共享粗格分开记录；非水密候选不当作实心。'));
    } else classified.append(make('p', '', classifiedReportWarning || '分类报表尚未准备，暂不显示统计。'));
  }
  else classified.append(make('p', '', '分类实例身份尚未验证；不按外观猜测绑定。'));
}
function buildObjectList() { const host = $('object-list'); host.replaceChildren(); room.objects.forEach((item, i) => { const button = make('button'); button.type = 'button'; button.append(make('span', '', (objectNames[item.category] || item.category) + ' ' + (i + 1)), make('small', '', report?.objects?.[i] ? report.objects[i].keptFaces.toLocaleString() + ' 面' : '无切片')); button.addEventListener('click', () => { selected = i; rebuildIsolatedFurniture(); updateSelection(); }); host.append(button); }); updateSelection(); }
function home(view = 'iso', object = false) { if (!bounds) return; const target = object ? new THREE.Vector3(...room.objects[selected].center) : bounds.center, span = object ? Math.max(...room.objects[selected].size) * 2.7 : bounds.span * 1.65; orbit.target.copy(target); if (view === 'top') camera.position.set(target.x, target.y + span, target.z + .001); else if (view === 'front') camera.position.set(target.x, target.y + .15, target.z + span); else if (view === 'side') camera.position.set(target.x + span, target.y + .15, target.z); else camera.position.set(target.x + span * .77, target.y + span * .65, target.z + span * .77); orbit.update(); camera.updateMatrixWorld(true); }

async function verifiedBytes(url, descriptor) {
  const expected = descriptor.geometryHash || descriptor.sha256 || descriptor.hash;
  if (!expected) throw new Error('派生几何缺少 SHA256，未通过来源验证');
  const bytes = await fetchBytes(url), actual = await sha256(bytes);
  if (actual !== expected.replace(/^sha256:/, '')) throw new Error('派生几何 SHA256 不匹配，请重新生成');
  return bytes;
}
async function loadDerivedPayload(entry) {
  const key = entry.id + ':' + (entry.geometryHash || entry.sha256 || entry.hash);
  if (derivedPayloads.has(key)) return derivedPayloads.get(key);
  if (!entry.geometryUri?.endsWith('.json')) throw new Error('本页分类格需要 JSON 网格资产；不把网格或点云冒充体素');
  const pending = (async () => {
    const bytes = await verifiedBytes(assets.derivedUrl(entry.geometryUri), entry), data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.scanId && data.scanId !== SCAN_ID) throw new Error('派生格 scanId 不符');
    if (data.frame && data.frame !== FRAME) throw new Error('派生格 frame 不符');
    if (data.transformHash && data.transformHash !== entry.transformHash) throw new Error('派生格坐标哈希不符');
    return data;
  })();
  derivedPayloads.set(key, pending); return pending;
}
async function rebuildDerived(id) {
  const generation = layerGenerations[id] = (layerGenerations[id] || 0) + 1, manifestVersion = derivedLoadVersion;
  const current = () => generation === layerGenerations[id] && manifestVersion === derivedLoadVersion;
  const entries = derivedEntries.filter(entry => KIND_TO_LAYER[entry.kind] === id), stepM = Number($('voxel-step').value), isolated = $('only-selected').checked, selectedAtStart = selected;
  const replacement = new THREE.Group();
  if (!entries.length) { setAvailable(id, false, id === 'userBoxes' ? '尚无用户设计体素文件' : id === 'clutterGrid' ? '未计算；离线计算默认关闭' : '未生成该分类层'); return; }
  const available = entries.filter(entry => entry.available);
  if (!available.length) { setAvailable(id, false, entries.map(entry => entry.warning || '未生成').join('；')); return; }
  let total = 0, shown = 0; const warnings = [];
  for (const entry of available) {
    try { const payload = await loadDerivedPayload(entry), decoded = decodeGrid(payload, stepM, entry); total += decoded.recordCount;
      if (!current()) { disposeChildren(replacement); return; }
      let records = decoded.cells;
      if (isolated && ['furnitureGrid', 'furnitureCorrected'].includes(id)) records = records.filter(cell => cellBelongsTo(cell, selectedAtStart, entry.convertedIndex ?? objectIndexById.get(entry.objectId)));
      if (records.length) shown += instanceCells(id, records, decoded.stepM, entry, replacement);
      if (entry.warning) warnings.push(entry.warning);
    } catch (error) { warnings.push(entry.id + '：' + error.message); }
  }
  if (!current()) { disposeChildren(replacement); return; }
  const successful = replacement.children.length > 0 || total === 0 && warnings.length === 0 || isolated && total > 0 && !warnings.some(warning => /SHA256|无效|缺少/.test(warning));
  disposeGroup(id); while (replacement.children.length) groups[id].add(replacement.children[0]);
  setAvailable(id, successful, stepM * 100 + ' cm · SHA256 已验证' + (warnings.length ? '；' + warnings.join('；') : ''), { recordCount: total, displayCount: shown, provenance: [...new Set(available.map(entry => entry.provenance || specs[id].source))].join(' / ') });
  applyLayerStyle(id);
}
async function rebuildIsolatedFurniture() { if (!manifest) return; await Promise.all(['furnitureGrid', 'furnitureCorrected'].map(rebuildDerived)); syncLayers(); }
async function loadDerived() {
  const version = ++derivedLoadVersion; $('reload-derived').disabled = true;
  try {
    const bytes = await fetchBytes(assets.derivedUrl('layer-manifest.json'));
    const next = validateManifest(JSON.parse(new TextDecoder().decode(bytes)), { scanId: SCAN_ID, convertedHash, transformHash });
    if (version !== derivedLoadVersion) return;
    manifest = next; objectIndexById.clear();
    for (const mapping of next.objectMappings || []) { const index = mapping.convertedIndex; if (Number.isInteger(index) && index >= 0 && index < room.objects.length && mapping.objectId && !/conflict|ambiguous|unmatched/.test(mapping.mappingState || mapping.status || mapping.matchStatus || '')) objectIndexById.set(mapping.objectId, index); }
    derivedEntries = next.layers.filter(entry => specs[KIND_TO_LAYER[entry.kind]]?.derived); derivedPayloads = new Map();
    classifiedReport = null; classifiedReportWarning = '';
    if (next.reportUri) {
      try {
        const reportBytes = await verifiedBytes(assets.derivedUrl(next.reportUri), { sha256: next.reportHash || next.reportSha256 });
        const result = JSON.parse(new TextDecoder().decode(reportBytes));
        if (result.scanId !== SCAN_ID || result.frame !== FRAME || result.transformHash !== next.transformHash) throw new Error('分类报表房间或坐标不符');
        classifiedReport = result;
      } catch (error) { classifiedReportWarning = '分类报表未验证：' + error.message; }
    }
    await Promise.all(LAYER_SPECS.filter(spec => spec.derived).map(spec => rebuildDerived(spec.id)));
    $('manifest-title').textContent = '已读取实验 9 分类清单';
    $('manifest-status').textContent = 'room-local-m；converted.json 与坐标 SHA256 已验证。杂物计算：' + (next.skipClutter === false || next.clutter?.computed ? '已运行，仍为候选' : '关闭或未生成') + '。生成：' + (next.generatedAt || '未注明');
    const preset = document.querySelector('[data-preset="classified"]'); preset.disabled = !state.structureGrid.available && !state.furnitureGrid.available; preset.querySelector('small').textContent = preset.disabled ? '分类格不可用，检查各层原因' : '结构 + 每件家具 + 冲突';
    if (new URLSearchParams(location.search).get('preset') === 'classified') setPreset('classified');
  } catch (error) {
    manifest = undefined; classifiedReport = null; derivedEntries = []; derivedPayloads.clear();
    for (const spec of LAYER_SPECS.filter(spec => spec.derived)) { disposeGroup(spec.id); setAvailable(spec.id, false, error.message); }
    $('manifest-title').textContent = '分类结果尚不可用'; $('manifest-status').textContent = error.message + '。保留原始八层；请先运行实验 9，再点重新读取。';
    document.querySelector('[data-preset="classified"]').disabled = true;
  } finally { $('reload-derived').disabled = false; updateSelection(); syncLayers(); }
}

const photoIndices = [0, 5, 10, 15, 20, 25, 30, 36]; let photoIndex = 0;
function updatePhoto() { const frame = photoIndices[photoIndex]; $('photo-preview').src = assets.url('photo-' + String(frame).padStart(3, '0') + '.jpg'); $('photo-preview').alt = 'Office 2 原始扫描照片第 ' + (frame + 1) + ' 张；未用作家具纹理'; $('photo-count').textContent = photoIndex + 1 + ' / ' + photoIndices.length + ' · 原始序列 ' + (frame + 1) + '/37'; }
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => setPreset(button.dataset.preset)));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(button === other))); home(button.dataset.view); }));
$('voxel-step').addEventListener('change', async () => { makeVoxelMesh(); if (manifest) await Promise.all(LAYER_SPECS.filter(spec => spec.derived).map(spec => rebuildDerived(spec.id))); syncLayers(); });
$('scan-opacity').addEventListener('input', setOpacity);
$('cut-enabled').addEventListener('change', () => { setCut(); syncLayers(); }); $('cut-height').addEventListener('input', () => { setCut(); syncLayers(); });
$('only-selected').addEventListener('change', async () => { await rebuildIsolatedFurniture(); updateSelection(); });
$('focus-object').addEventListener('click', () => home('iso', true));
$('reload-derived').addEventListener('click', loadDerived);
$('photo-prev').addEventListener('click', () => { photoIndex = (photoIndex + photoIndices.length - 1) % photoIndices.length; updatePhoto(); });
$('photo-next').addEventListener('click', () => { photoIndex = (photoIndex + 1) % photoIndices.length; updatePhoto(); });
$('download-segment').addEventListener('click', event => { if (event.currentTarget.getAttribute('aria-disabled') === 'true') event.preventDefault(); });
let pointerDown;
canvas.addEventListener('pointerdown', event => { pointerDown = [event.clientX, event.clientY]; });
canvas.addEventListener('pointerup', async event => {
  if (!pointerDown || Math.hypot(event.clientX - pointerDown[0], event.clientY - pointerDown[1]) > 5 || event.button !== 0) return;
  const rect = canvas.getBoundingClientRect(); raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const pickable = ['segments', 'boxes', 'aabbs', 'furnitureGrid', 'furnitureCorrected'].filter(layerOn).flatMap(id => groups[id].children.filter(object => object.visible));
  const hits = raycaster.intersectObjects(pickable, false).filter(hit => { const id = hit.object.userData.layerId || 'segments'; return !state[id].clipped || !$('cut-enabled').checked || hit.point.y <= clip.constant; });
  // Visible wireframes render over mesh evidence, so give a close wireframe hit the same interaction priority.
  const lines = hits.filter(hit => hit.object.isLineSegments).map(hit => { const point = hit.point.clone().project(camera); return { hit, pixels: Math.hypot(rect.left + (point.x + 1) * rect.width / 2 - event.clientX, rect.top + (1 - point.y) * rect.height / 2 - event.clientY) }; }).filter(row => row.pixels <= 7).sort((a, b) => a.pixels - b.pixels);
  const hit = lines[0]?.hit || hits[0];
  if (!hit) return;
  const cell = hit.object.userData.cells?.[hit.instanceId];
  if (cell?.convertedIndices?.length > 1) { status.textContent = '这个粗格覆盖多个实例：' + cell.convertedIndices.map(index => (objectNames[room.objects[index].category] || room.objects[index].category) + ' ' + (index + 1)).join('、') + '。请从右侧列表选择；共享粗格不自动视为原始面冲突。'; return; }
  const index = selectedIndexForCell(cell, hit.object.userData.objectIndex);
  if (Number.isInteger(index) && index >= 0 && index < room.objects.length) { selected = index; await rebuildIsolatedFurniture(); updateSelection(); }
});

try {
  const converted = await jsonAsset('converted.json'); room = converted.data; convertedHash = await sha256(converted.bytes); transformHash = await sha256(new TextEncoder().encode(JSON.stringify(room.transform.worldToRoom)));
  const metadata = await Promise.allSettled([jsonAsset('mesh-surface-grids.json'), jsonAsset('segments/segments.json')]);
  cache = metadata[0].status === 'fulfilled' ? metadata[0].value.data : null; report = metadata[1].status === 'fulfilled' ? metadata[1].value.data : null;
  if (report?.objects?.length !== room.objects.length) report = null;
  buildRoom(); buildBoxes(); makeVoxelMesh(); buildObjectList(); drawPlan($('plan-svg'), room);
  const xs = room.polygon.map(p => p[0]), zs = room.polygon.map(p => p[1]);
  bounds = { center: new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, 1.1, (Math.min(...zs) + Math.max(...zs)) / 2), span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) };
  setCut(); updatePhoto(); home(); resize();
  setAvailable('splat', false, '未生成 .splat/.ksplat/.spz；PLY、TSDF 和表面格均不是高斯泼溅');
  if (!cache?.sources?.ply) setAvailable('voxels', false, '缺少原始 PLY 表面格缓存');
  const loaded = await Promise.allSettled([loadGeometry('mesh-voxels/raw-room.ply'), loadGeometry('full-depth-surface-025.ply'), ...((report?.objects || []).map(row => row.file ? loadGeometry('segments/' + row.file) : Promise.resolve(null)))]);
  if (loaded[0].status === 'fulfilled') { const geometry = loaded[0].value; rawMesh = addMesh('raw', geometry, '#ffffff', !!geometry.getAttribute('color')); const n = geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3; setAvailable('raw', true, '原始面颜色；不是照片纹理', { recordCount: n, displayCount: n }); } else setAvailable('raw', false, loaded[0].reason.message);
  if (loaded[1].status === 'fulfilled') { const geometry = loaded[1].value; depthPoints = new THREE.Points(geometry, new THREE.PointsMaterial({ color: specs.depth.color, size: .021, sizeAttenuation: true, transparent: true, depthWrite: false })); groups.depth.add(depthPoints); const n = geometry.getAttribute('position').count; setAvailable('depth', true, '多帧抽样归并的深度证据', { recordCount: n, displayCount: n }); applyLayerStyle('depth'); } else setAvailable('depth', false, loaded[1].reason.message);
  segmentMeshes = loaded.slice(2).map((result, i) => { if (result.status !== 'fulfilled' || !result.value) return null; const mesh = addMesh('segments', result.value, palette[i % palette.length]); mesh.userData = { objectIndex: i, layerId: 'segments' }; return mesh; });
  const candidateFaces = report?.objects.reduce((sum, row) => sum + row.keptFaces, 0) || 0;
  setAvailable('segments', segmentMeshes.some(Boolean), segmentMeshes.filter(Boolean).length + ' / ' + room.objects.length + ' 候选已加载；均不保证封闭', { recordCount: candidateFaces, displayCount: segmentMeshes.reduce((sum, mesh) => sum + (mesh?.geometry.index?.count || 0) / 3, 0) });
  try { const response = await fetch(assets.url('reference-depth/scan_room.ply'), { method: 'HEAD' }); setAvailable('fusion', response.ok, response.ok ? '按需加载；全帧融合观察结果' : '缺少 TSDF 融合文件'); } catch { setAvailable('fusion', false, '无法检查 TSDF 文件'); }
  metrics($('scan-metrics'), [[cache?.sources?.ply?.inroomVertices?.toLocaleString() || '—', '本房间 PLY 顶点'], [cache?.sources?.ply?.triangles?.toLocaleString() || '—', '本房间原始三角面'], [room.objects.length, 'RoomPlan 家具框'], [candidateFaces.toLocaleString(), '原家具候选面；非水密']]);
  $('download-report').href = assets.url('segments/segments.json'); setOpacity();
  const requested = new URLSearchParams(location.search).get('preset'); setPreset(requested && requested !== 'classified' ? requested : 'raw');
  display.setAttribute('aria-busy', 'false'); await loadDerived();
  window.__ANGRID_LAYERS__ = { snapshot: () => ({ scanId: SCAN_ID, frame: FRAME, selected, stepM: Number($('voxel-step').value), clipHeightM: clip.constant, layers: structuredClone(state), manifestLoaded: !!manifest, roomObjectCount: room.objects.length, rendered: Object.fromEntries(LAYER_SPECS.filter(spec => spec.derived).map(spec => [spec.id, { count: groups[spec.id].children.reduce((sum, mesh) => sum + (mesh.count || 0), 0), steps: groups[spec.id].children.map(mesh => mesh.userData.stepM) }])) }),
    projectObject: (index, id = 'boxes', corner = false) => { const object = id === 'segments' ? segmentMeshes[index] : id === 'aabbs' ? aabbLines[index] : boxLines[index]; if (!object) return null; object.updateMatrixWorld(true); camera.updateMatrixWorld(true); const world = corner && id !== 'segments' ? object.localToWorld(new THREE.Vector3(.5, -.5, .5)) : new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()); const point = world.project(camera), rect = canvas.getBoundingClientRect(); return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 }; },
    projectSharedCells: () => { camera.updateMatrixWorld(true); const rect = canvas.getBoundingClientRect(); return groups.furnitureGrid.children.flatMap(mesh => (mesh.userData.cells || []).filter(cell => cell.convertedIndices?.length > 1).map(cell => { const point = new THREE.Vector3(...cell.center).project(camera); return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2, owners: cell.convertedIndices }; })); } };
} catch (error) { status.textContent = '无法载入房间：' + error.message; display.setAttribute('aria-busy', 'false'); console.error(error); }
