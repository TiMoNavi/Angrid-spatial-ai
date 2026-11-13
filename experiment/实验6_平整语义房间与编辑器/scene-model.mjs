/**
 * Experiment 6's editable, metre-based scene state. Scan evidence is not geometry
 * input here: changing gridStep never changes an object's measured transform.
 * This module is deliberately independent of Three.js and the DOM.
 */
export const GRID_STEPS = Object.freeze([0.2, 0.1, 0.05, 0.025]);
export const LIMITS = Object.freeze({
  objects: 2000, id: 96, name: 120, category: 64, sourceId: 120,
  coordinate: 1000, dimension: 100, rotation: Math.PI * 100,
});

const SOURCES = new Set(['roomplan', 'user', 'ai']);
const OBJECT_KEYS = new Set(['id', 'name', 'category', 'source', 'center', 'size', 'rotY', 'anchorId', 'locked']);
const PATCH_KEYS = new Set(['name', 'category', 'center', 'size', 'rotY', 'anchorId', 'locked']);
const STATE_KEYS = new Set(['schemaVersion', 'sourceId', 'revision', 'gridStep', 'objects']);
const LABELS = { table: '桌子', chair: '椅子', storage: '柜子', sofa: '沙发', bed: '床', box: '方块组' };
const fail = message => { throw new Error(message); };
const record = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(`${label}必须是普通 JSON 对象`);
  return value;
};
function text(value, label, max, id = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label}必须是 1–${max} 字符的有效文本`);
  }
  if (id && !/^[\p{L}\p{N}_.:-]+$/u.test(value)) fail(`${label}含不支持的字符`);
  return value;
}
function number(value, label, max = LIMITS.coordinate) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max) fail(`${label}必须是有限且在范围内的数字`);
  return value;
}
function vector(value, label, positive = false) {
  if (!Array.isArray(value) || value.length !== 3) fail(`${label}必须包含三个数字`);
  return value.map((item, index) => {
    const result = number(item, `${label}[${index}]`, positive ? LIMITS.dimension : LIMITS.coordinate);
    if (positive && result <= 0) fail(`${label}的尺寸必须大于零`);
    return result;
  });
}
function step(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('格子边长无效');
  const found = GRID_STEPS.find(candidate => Math.abs(candidate - value) < 1e-10);
  if (found === undefined) fail('格子边长只支持 20、10、5、2.5 cm');
  return found;
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}包含不支持的字段：${key}`);
}
function object(value) {
  record(value, '物体');
  keys(value, OBJECT_KEYS, '物体');
  const id = text(value.id, '物体 ID', LIMITS.id, true);
  const source = text(value.source, '物体来源', 16);
  if (!SOURCES.has(source)) fail('物体来源只支持 roomplan、user、ai');
  if (typeof value.locked !== 'boolean') fail('locked 必须是布尔值');
  return {
    id,
    name: text(value.name, '物体名称', LIMITS.name),
    category: text(value.category, '物体语义', LIMITS.category),
    source,
    center: vector(value.center, '物体中心'),
    size: vector(value.size, '物体尺寸', true),
    rotY: number(value.rotY, '物体朝向', LIMITS.rotation),
    anchorId: text(value.anchorId, '承载面 ID', LIMITS.id + 8, true),
    locked: value.locked,
  };
}
function checkAnchors(objects, room) {
  const byId = new Map(objects.map(item => [item.id, item]));
  for (const item of objects) {
    const anchor = item.anchorId;
    if (anchor === 'floor') continue;
    if (/^wall-\d+$/u.test(anchor)) {
      if (room && (!Array.isArray(room.walls) || Number(anchor.slice(5)) >= room.walls.length)) fail(`承载面不存在：${anchor}`);
      continue;
    }
    if (!anchor.startsWith('top-')) fail(`不支持的承载面：${anchor}`);
    const support = byId.get(anchor.slice(4));
    if (!support || support.category !== 'table') fail(`桌面承载物不存在：${anchor}`);
    const seen = new Set([item.id]);
    let current = item;
    while (current.anchorId.startsWith('top-')) {
      const id = current.anchorId.slice(4);
      if (seen.has(id)) fail('物体的承载面不能循环引用');
      seen.add(id);
      current = byId.get(id);
      if (!current) fail(`桌面承载物不存在：top-${id}`);
    }
  }
}

const TRANSFORM_EPSILON = 1e-10;
const topOrigin = item => [item.center[0], item.center[1] + item.size[1] / 2, item.center[2]];
function carrySupportedObjects(objects, previousSupport, updatedSupport) {
  const children = new Map();
  for (const item of objects) {
    if (!children.has(item.anchorId)) children.set(item.anchorId, []);
    children.get(item.anchorId).push(item);
  }
  // The anchor graph has been checked for cycles. A queue also avoids exhausting
  // the JavaScript call stack for a deeply nested, but valid, assembly.
  const queue = [{ before: previousSupport, after: updatedSupport }];
  for (let index = 0; index < queue.length; index++) {
    const { before, after } = queue[index];
    const oldOrigin = topOrigin(before), newOrigin = topOrigin(after);
    const rawAngle = after.rotY - before.rotY;
    const wrappedAngle = Math.atan2(Math.sin(rawAngle), Math.cos(rawAngle));
    const angle = Math.abs(wrappedAngle) < TRANSFORM_EPSILON ? 0 : wrappedAngle;
    const translated = newOrigin.some((value, axis) => Math.abs(value - oldOrigin[axis]) > TRANSFORM_EPSILON);
    if (!translated && angle === 0) continue;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const child of children.get(`top-${before.id}`) || []) {
      const previousChild = object(child);
      const dx = child.center[0] - oldOrigin[0], dz = child.center[2] - oldOrigin[2];
      const proposedCenter = [
        newOrigin[0] + c * dx + s * dz,
        newOrigin[1] + child.center[1] - oldOrigin[1],
        newOrigin[2] - s * dx + c * dz,
      ].map((value, axis) => Math.abs(value - child.center[axis]) <= TRANSFORM_EPSILON ? child.center[axis] : value);
      const moved = proposedCenter.some((value, axis) => value !== child.center[axis]) || angle !== 0;
      if (!moved) continue;
      if (child.locked) fail('锁定物体依附在此桌面或其后代上，不能间接移动或旋转，请先解锁');
      child.center = proposedCenter;
      child.rotY += angle;
      // Dimensions intentionally remain unchanged: support resizing does not
      // scale the objects already arranged on it.
      if (child.category === 'table') queue.push({ before: previousChild, after: child });
    }
  }
}

/** Validate and return a detached, sanitised state; never mutate the input. */
export function validateState(input, room, sourceId = input?.sourceId) {
  record(input, '场景');
  keys(input, STATE_KEYS, '场景');
  if (input.schemaVersion !== 1) fail('不支持的场景 schemaVersion');
  const actualSource = text(input.sourceId, '扫描会话 ID', LIMITS.sourceId, true);
  text(sourceId, '预期扫描会话 ID', LIMITS.sourceId, true);
  if (actualSource !== sourceId) fail('导入场景与当前扫描会话不匹配');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail('场景 revision 必须是非负安全整数');
  if (!Array.isArray(input.objects) || input.objects.length > LIMITS.objects) fail(`场景最多支持 ${LIMITS.objects} 件物体`);
  const objects = input.objects.map(object);
  if (new Set(objects.map(item => item.id)).size !== objects.length) fail('物体 ID 不能重复');
  checkAnchors(objects, room);
  return { schemaVersion: 1, sourceId: actualSource, revision: input.revision, gridStep: step(input.gridStep), objects };
}

export function createInitialState(room, sourceId) {
  record(room, 'RoomPlan 房间');
  if (!Array.isArray(room.polygon) || room.polygon.length < 3 || !Array.isArray(room.walls) || !Array.isArray(room.objects)) fail('RoomPlan 缺少 polygon、walls 或 objects');
  const counts = new Map();
  const objects = room.objects.map((item, index) => {
    record(item, 'RoomPlan 物体');
    const category = text(item.category, '物体语义', LIMITS.category);
    const count = (counts.get(category) || 0) + 1;
    counts.set(category, count);
    return {
      id: `roomplan-${index}`, name: `${LABELS[category] || category} ${count}`, category,
      source: 'roomplan', center: item.center, size: item.size, rotY: item.rotY,
      anchorId: 'floor', locked: false,
    };
  });
  return validateState({ schemaVersion: 1, sourceId, revision: 0, gridStep: 0.2, objects }, room, sourceId);
}

/**
 * Commands use `type`. Deleting a support detaches unlocked dependants in place;
 * a locked dependant prevents deleting its support. clearFurniture retains the
 * supports required by locked objects as well as the locked objects themselves.
 * Table transforms carry supported objects in their local metre-space positions,
 * recursively; any transform that would move a locked descendant is rejected.
 */
export function applyCommand(state, command) {
  const next = validateState(state);
  record(command, '编辑命令');
  if (state.revision === Number.MAX_SAFE_INTEGER) fail('场景 revision 已达上限');
  const find = id => {
    text(id, '物体 ID', LIMITS.id, true);
    const result = next.objects.find(item => item.id === id);
    if (!result) fail(`找不到物体：${id}`);
    return result;
  };
  switch (command.type) {
    case 'add': {
      record(command.object, '新增物体');
      const item = object({ category: 'box', source: 'user', rotY: 0, anchorId: 'floor', locked: false, ...command.object });
      if (next.objects.some(existing => existing.id === item.id)) fail('物体 ID 不能重复');
      next.objects.push(item);
      break;
    }
    case 'update': {
      const item = find(command.id);
      record(command.patch, '物体修改');
      keys(command.patch, PATCH_KEYS, '物体修改');
      const changedKeys = Object.keys(command.patch);
      if (!changedKeys.length) fail('物体修改不能为空');
      if (item.locked && !(changedKeys.length === 1 && changedKeys[0] === 'locked')) fail('物体已锁定，请先解锁');
      const previous = object(item);
      Object.assign(item, object({ ...item, ...command.patch }));
      checkAnchors(next.objects);
      if (previous.category === 'table' && item.category === 'table') carrySupportedObjects(next.objects, previous, item);
      break;
    }
    case 'delete': {
      const item = find(command.id);
      if (item.locked) fail('物体已锁定，请先解锁');
      const children = next.objects.filter(child => child.anchorId === `top-${item.id}`);
      if (children.some(child => child.locked)) fail('锁定物体仍依附在此桌面上，请先解锁或移走');
      for (const child of children) child.anchorId = 'floor';
      next.objects = next.objects.filter(existing => existing.id !== item.id);
      break;
    }
    case 'clearFurniture': {
      const keep = new Set(next.objects.filter(item => item.locked).map(item => item.id));
      const byId = new Map(next.objects.map(item => [item.id, item]));
      for (const id of keep) {
        let current = byId.get(id);
        while (current?.anchorId.startsWith('top-')) {
          const supportId = current.anchorId.slice(4);
          keep.add(supportId);
          current = byId.get(supportId);
        }
      }
      next.objects = next.objects.filter(item => keep.has(item.id));
      break;
    }
    case 'setGrid': next.gridStep = step(command.step); break;
    default: fail(`不支持的编辑命令：${String(command.type)}`);
  }
  next.revision++;
  return validateState(next);
}

/** Metre-space anchors, independent of grid density and scan surface noise. */
export function getAnchors(room, state) {
  record(room, 'RoomPlan 房间');
  if (!Array.isArray(room.polygon) || room.polygon.length < 3 || !Array.isArray(room.walls)) fail('房间锚面数据不完整');
  const points = room.polygon.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) fail(`地面顶点 ${index} 无效`);
    return [number(point[0], '地面 X'), number(point[1], '地面 Z')];
  });
  const xs = points.map(point => point[0]), zs = points.map(point => point[1]);
  const anchors = [{
    id: 'floor', name: '地面', kind: 'floor', origin: [0, 0, 0],
    u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0],
    bounds: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)],
  }];
  room.walls.forEach((wall, index) => {
    const length = number(wall.length, '墙面长度', LIMITS.dimension), height = number(wall.height, '墙面高度', LIMITS.dimension);
    if (length <= 0 || height <= 0) fail('墙面尺寸必须大于零');
    anchors.push({ id: `wall-${index}`, name: `墙面 ${index + 1}`, kind: 'wall', origin: vector(wall.origin, '墙面原点'), u: vector(wall.u, '墙面横轴'), v: [0, 1, 0], normal: vector(wall.n, '墙面法向'), bounds: [0, length, 0, height] });
  });
  for (const item of validateState(state, room).objects) {
    if (item.category !== 'table') continue;
    const [width, , depth] = item.size;
    const c = Math.cos(item.rotY), s = Math.sin(item.rotY);
    anchors.push({ id: `top-${item.id}`, name: `${item.name} · 推断顶面`, kind: 'top', objectId: item.id,
      origin: topOrigin(item),
      u: [c, 0, -s], v: [s, 0, c], normal: [0, 1, 0], bounds: [-width / 2, width / 2, -depth / 2, depth / 2] });
  }
  return anchors;
}

export function serializeState(state) { return JSON.stringify(validateState(state), null, 2); }

export function snapValue(value, gridStep) {
  number(value, '吸附坐标');
  if (typeof gridStep !== 'number' || !Number.isFinite(gridStep) || gridStep <= 0 || gridStep > LIMITS.dimension) fail('吸附步长必须大于零');
  const snapped = Math.sign(value) * Math.round(Math.abs(value) / gridStep + 1e-10) * gridStep;
  return Number(snapped.toFixed(12));
}

/** Includes the polygon boundary. Unknown/invalid points are never inside. */
export function pointInPolygon(x, z, polygon) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Array.isArray(polygon) || polygon.length < 3) return false;
  if (polygon.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value)))) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    const dx = xj - xi, dz = zj - zi, length = Math.hypot(dx, dz);
    if (length > 0 && Math.abs((x - xi) * dz - (z - zi) * dx) <= 1e-8 * length && x >= Math.min(xi, xj) - 1e-8 && x <= Math.max(xi, xj) + 1e-8 && z >= Math.min(zi, zj) - 1e-8 && z <= Math.max(zi, zj) + 1e-8) return true;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Tests the entire positive-area axis-aligned rectangle, not a sample of its
 * interior. Polygon edges may touch or coincide with the rectangle boundary.
 * A boundary entering its interior reveals a notch even when all four corners
 * are inside the room. This assumes the RoomPlan polygon is a simple outline.
 */
export function rectangleInPolygon(minX, minZ, maxX, maxZ, polygon) {
  if (![minX, minZ, maxX, maxZ].every(Number.isFinite) || minX >= maxX || minZ >= maxZ) return false;
  const corners = [[minX, minZ], [minX, maxZ], [maxX, minZ], [maxX, maxZ]];
  if (corners.some(([x, z]) => !pointInPolygon(x, z, polygon))) return false;
  // Shrinking the clipping window makes a coincident/touching boundary legal,
  // with the same metre-space tolerance as pointInPolygon.
  const inset = Math.min(1e-8, (maxX - minX) / 4, (maxZ - minZ) / 4);
  const low = [minX + inset, minZ + inset], high = [maxX - inset, maxZ - inset];
  const entersInterior = (a, b) => {
    let first = 0, last = 1;
    for (let axis = 0; axis < 2; axis++) {
      const delta = b[axis] - a[axis];
      if (delta === 0) {
        if (a[axis] < low[axis] || a[axis] > high[axis]) return false;
      } else {
        const t0 = (low[axis] - a[axis]) / delta, t1 = (high[axis] - a[axis]) / delta;
        first = Math.max(first, Math.min(t0, t1));
        last = Math.min(last, Math.max(t0, t1));
        if (first > last) return false;
      }
    }
    return true;
  };
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (entersInterior(polygon[j], polygon[i])) return false;
  }
  return true;
}
