// Room-local metres only. This module never transforms or writes scan evidence.
export const SCAN_ID = 'office-2';
export const FRAME = 'room-local-m';
export const MAX_DISPLAY_CELLS = 50000;
export const LAYER_SPECS = [
  { id: 'raw', kind: 'raw-lidar', title: '原始 LiDAR PLY', note: '当前房间三角面；PLY 自带颜色', source: 'measured', color: '#77c9bf', opacity: .68, clipped: true, checked: true },
  { id: 'fusion', kind: 'fused-tsdf', title: 'TSDF 融合网格', note: '多帧深度融合的对照结果', source: 'measured · fused', color: '#a8b9ed', opacity: .68, clipped: true },
  { id: 'depth', kind: 'projected-depth', title: '深度投影点', note: '抽样归并点；没有三角面', source: 'measured', color: '#e6b785', opacity: .68, clipped: true },
  { id: 'voxels', kind: 'raw-surface-cells', title: '原始 PLY 表面格', note: '三角面经过的格子；不是实心家具', source: 'measured · surface', color: '#75c1d5', opacity: .78, clipped: true },
  { id: 'room', kind: 'roomplan-structure', title: 'RoomPlan 房间', note: '地面轮廓、墙线和门窗开口', source: 'RoomPlan prior', color: '#c5e0d7', opacity: .74, clipped: false, checked: true },
  { id: 'boxes', kind: 'furniture-obb', title: '家具朝向框 OBB', note: '识别的米制尺寸先验', source: 'RoomPlan prior', color: '#e7a56b', opacity: .84, clipped: false, checked: true },
  { id: 'segments', kind: 'furniture-slice', title: '家具网格候选（原裁片）', note: '沿用旧排他裁剪；五件均非水密', source: 'measured · legacy candidate', color: '#b7d97a', opacity: .96, clipped: true },
  { id: 'aabbs', kind: 'furniture-aabb', title: '切片实际 AABB', note: '留下的观察片段的轴对齐范围', source: 'measured · bounds', color: '#f2c863', opacity: .84, clipped: false },
  { id: 'splat', kind: 'gaussian-splat', title: '高斯泼溅', note: '当前扫描没有可用的 splat 产物', source: 'not generated', color: '#a9adc8', opacity: .8, clipped: true },
  { id: 'structureGrid', kind: 'clean-structure-grid', title: '平整结构格', note: '墙地分开修正；可视薄壳', source: 'inferred', color: '#d6e7b1', opacity: .9, clipped: true, derived: true },
  { id: 'furnitureGrid', kind: 'furniture-classified-grid', title: '分类家具表面格', note: '先切分再体素化；按实例显示', source: 'measured · candidate', color: '#e7b16c', opacity: .92, clipped: true, derived: true },
  { id: 'furnitureCorrected', kind: 'furniture-corrected-grid', title: '家具几何修正格', note: '修正候选另存；不替换测量层', source: 'inferred · candidate', color: '#f0d18a', opacity: .9, clipped: true, derived: true },
  { id: 'conflict', kind: 'conflict-grid', title: '归属冲突格', note: '保留多个候选 owner，等待裁决', source: 'conflict', color: '#ee8cb8', opacity: .9, clipped: true, derived: true },
  { id: 'unknown', kind: 'unknown-grid', title: '未归属观察格', note: '未知不等于净空，也不等于杂物', source: 'unknown', color: '#9aa4b5', opacity: .5, clipped: true, derived: true },
  { id: 'clutterGrid', kind: 'clutter-candidate-grid', title: '杂物候选格', note: '单独离线计算；默认不计算', source: 'candidate', color: '#dc9aef', opacity: .8, clipped: true, derived: true },
  { id: 'userBoxes', kind: 'user-voxel-box', title: '用户体素盒', note: '设计占据；独立于扫描证据', source: 'user', color: '#75ddc3', opacity: .9, clipped: true, derived: true }
];

export const KIND_TO_LAYER = Object.fromEntries(LAYER_SPECS.map(spec => [spec.kind, spec.id]));
Object.assign(KIND_TO_LAYER, { 'assignment-conflict-grid': 'conflict', 'unassigned-grid': 'unknown', 'unknown-surface-grid': 'unknown' });

export function createAssetAdapter(baseUrl) {
  const root = new URL(baseUrl);
  if (!['http:', 'https:'].includes(root.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(root.hostname))
    throw new Error('私有扫描只允许从本机 HTTP 服务读取');
  if (!root.pathname.endsWith('/')) throw new Error('私有资产根路径必须以 / 结尾');
  return Object.freeze({
    root: root.href,
    url(path) {
      if (typeof path !== 'string' || !path || /[\\?#]/.test(path)) throw new Error('无效的本机资产路径');
      let decoded;
      try { decoded = decodeURIComponent(path); } catch { throw new Error('无效的资产路径编码'); }
      if (/^(?:[a-z]+:|\/)/i.test(decoded) || decoded.split('/').some(part => part === '..' || part === '.'))
        throw new Error('资产路径不得越出当前扫描目录');
      const result = new URL(path, root);
      if (result.origin !== root.origin || !result.pathname.startsWith(root.pathname)) throw new Error('资产路径越界');
      return result.href;
    },
    derivedUrl(path) { return this.url(path.startsWith('derived-v1/') ? path : 'derived-v1/' + path); }
  });
}

export function validateManifest(value, expected = {}) {
  if (!value || value.schemaVersion !== 1) throw new Error('分类清单 schemaVersion 必须为 1');
  if (value.scanId !== (expected.scanId || SCAN_ID)) throw new Error('分类清单不是 Office 2，拒绝混用房间');
  if (value.frame !== FRAME) throw new Error('分类结果必须使用 room-local-m，不再二次变换');
  if (!Array.isArray(value.layers)) throw new Error('分类清单缺少 layers');
  if (!value.transformHash) throw new Error('分类清单缺少 transformHash，无法确认坐标');
  if (expected.transformHash && value.transformHash !== expected.transformHash) throw new Error('分类结果 transformHash 与当前房间不符');
  const sources = Array.isArray(value.sourceFiles) ? value.sourceFiles : Object.entries(value.sourceFiles || {}).map(([uri, row]) => typeof row === 'string' ? { uri, sha256: row } : { uri, ...row });
  const converted = sources.find(row => /(?:^|\/)converted\.json$/.test(row.uri || row.path || row.file || ''));
  if (expected.convertedHash) {
    if (!converted || !(converted.sha256 || converted.hash)) throw new Error('分类清单缺少 converted.json 来源哈希，尚不能验证房间匹配');
    const hash = converted.sha256 || converted.hash;
    if (hash && hash.replace(/^sha256:/, '') !== expected.convertedHash) throw new Error('converted.json 已改变，分类结果需要重新生成');
  }
  const seen = new Set();
  const layers = value.layers.map(layer => {
    if (!layer.id || seen.has(layer.id)) throw new Error('分类清单存在缺失或重复的 layer id');
    seen.add(layer.id);
    let issue = '';
    if (!['m', 'metres', 'meters'].includes(layer.units)) issue = '该层不是米制数据';
    else if (layer.available && layer.transformHash !== value.transformHash) issue = '该层坐标哈希缺失或与清单不符';
    else if (layer.available && !layer.geometryUri) issue = '该层已标可用，但缺少 geometryUri';
    return { ...layer, available: !!layer.available && !issue, warning: issue || layer.warning || '' };
  });
  return { ...value, layers, sourceFiles: sources };
}

export function selectGrid(payload, stepM) {
  if (payload.grids) {
    const grid = payload.grids[String(stepM)];
    if (!grid) throw new Error('该派生层没有 ' + stepM * 100 + ' cm 网格，未用其他尺度替代');
    return { ...payload, ...grid, grids: undefined, stepM: grid.stepM || grid.step || stepM };
  }
  const actual = payload.stepM ?? payload.cellStepM ?? payload.step;
  if (actual && Math.abs(actual - stepM) > 1e-9) throw new Error('该派生层仅有 ' + actual * 100 + ' cm 网格');
  return payload;
}

export function decodeGrid(payload, requestedStepM, layer = {}) {
  const grid = selectGrid(payload, requestedStepM);
  const stepM = Number(grid.stepM ?? grid.cellStepM ?? grid.step ?? layer.cellStepM);
  if (!(stepM > 0) || !Number.isFinite(stepM)) throw new Error('派生格缺少有效 stepM');
  const origin = grid.originM || grid.origin || [0, 0, 0];
  if (origin.length !== 3 || origin.some(n => !Number.isFinite(n))) throw new Error('派生格 originM 无效');
  const cells = [];
  const add = (center, extra = {}) => {
    if (!Array.isArray(center) || center.length !== 3 || center.some(n => !Number.isFinite(n))) throw new Error('派生格坐标无效');
    cells.push({ center, ...extra });
  };
  const indexCenter = index => {
    if (!Array.isArray(index) || index.length !== 3 || index.some(n => !Number.isSafeInteger(n))) throw new Error('index-xyz 必须是三个安全整数');
    return index.map((n, i) => origin[i] + (n + .5) * stepM);
  };
  if (Array.isArray(grid.keys)) {
    const counts = grid.counts;
    if (!counts || counts.length !== 3 || counts.some(n => !Number.isInteger(n) || n < 1)) throw new Error('压缩格缺少有效 counts');
    const [, ny, nz] = counts;
    for (const key of grid.keys) {
      if (!Number.isSafeInteger(key) || key < 0 || key >= counts[0] * ny * nz) throw new Error('压缩格 key 越界');
      const z = key % nz, rest = (key - z) / nz, y = rest % ny, x = (rest - y) / ny;
      add(indexCenter([x, y, z]));
    }
  } else if (Array.isArray(grid.centersM || grid.centers)) {
    for (const center of grid.centersM || grid.centers) add(center);
  } else if (Array.isArray(grid.cells || grid.indices)) {
    for (const row of grid.cells || grid.indices) {
      if (Array.isArray(row)) {
        if (grid.cellEncoding === 'center-m' || grid.coordinates === 'centers-m') add(row);
        else if (grid.cellEncoding === 'index-xyz' || grid.indices) add(indexCenter(row));
        else throw new Error('三元组格坐标需显式声明 cellEncoding');
      } else if (row.centerM || row.center) add(row.centerM || row.center, row);
      else if (row.index || row.ijk) add(indexCenter(row.index || row.ijk), row);
      else throw new Error('派生格既没有 centerM 也没有 index');
    }
  } else if (Array.isArray(grid.objects)) {
    for (const object of grid.objects) {
      const decoded = decodeGrid({ ...grid, ...object, objects: undefined }, requestedStepM, layer);
      cells.push(...decoded.cells.map(row => ({ ...row, objectId: object.objectId || object.id || row.objectId })));
    }
  } else throw new Error('派生资产没有可识别的格数据');
  for (const group of grid.groups || []) {
    for (const index of group.cellIndices || []) {
      if (!Number.isInteger(index) || index < 0 || index >= cells.length) throw new Error('对象分组 cellIndices 越界');
      const cell = cells[index];
      cell.ownerIds = [...new Set([...(cell.ownerIds || []), group.objectId].filter(Boolean))];
      if (cell.ownerIds.length === 1) cell.objectId = cell.ownerIds[0];
      else delete cell.objectId;
      if (group.convertedIndex !== undefined) cell.convertedIndices = [...new Set([...(cell.convertedIndices || []), group.convertedIndex])];
    }
  }
  const recordCount = grid.recordCount ?? grid.totalCount ?? grid.counts?.total ?? grid.count ?? cells.length;
  if (!Number.isSafeInteger(recordCount) || recordCount < cells.length) throw new Error('recordCount 必须为不小于已载格数的非负安全整数');
  return { stepM, originM: origin, cells, groups: grid.groups || [], recordCount };
}

export function sampledIndices(total, limit = MAX_DISPLAY_CELLS) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('抽显数量无效');
  const shown = Math.min(total, limit);
  return Array.from({ length: shown }, (_, i) => Math.floor(i * total / shown));
}
