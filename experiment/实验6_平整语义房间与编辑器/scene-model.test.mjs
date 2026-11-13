import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createInitialState, applyCommand, getAnchors, validateState, serializeState, pointInPolygon, rectangleInPolygon, snapValue, GRID_STEPS, LIMITS } from './scene-model.mjs';

const room = {
  polygon: [[-2, -1], [2, -1], [2, 1], [-2, 1]],
  walls: [{ origin: [-2, 0, -1], u: [1, 0, 0], n: [0, 0, 1], length: 4, height: 3, openings: [] }],
  objects: [{ category: 'table', center: [0.1, 0.4, -0.2], size: [1.31, 0.8, 0.77], rotY: Math.PI / 2 }],
};
const initial = () => createInitialState(room, 'fixture');
const newBox = (id = 'user-1', extra = {}) => ({ id, name: '台灯底座', center: [0.1, 0.9, -0.2], size: [0.3, 0.2, 0.2], ...extra });

test('RoomPlan initial state preserves metre-space transforms and has stable semantic IDs', () => {
  const state = initial();
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.gridStep, 0.2);
  assert.equal(state.revision, 0);
  assert.equal(state.objects[0].id, 'roomplan-0');
  assert.equal(state.objects[0].name, '桌子 1');
  assert.equal(state.objects[0].source, 'roomplan');
  assert.deepEqual(state.objects[0].center, room.objects[0].center);
  state.objects[0].center[0] = 99;
  assert.equal(room.objects[0].center[0], 0.1);
});

test('floor, wall and rotated tabletop anchors have metre-space bases', () => {
  const anchors = getAnchors(room, initial());
  assert.deepEqual(anchors.map(anchor => anchor.id), ['floor', 'wall-0', 'top-roomplan-0']);
  assert.deepEqual(anchors[0].bounds, [-2, 2, -1, 1]);
  assert.deepEqual(anchors[1].bounds, [0, 4, 0, 3]);
  const top = anchors[2];
  assert.deepEqual(top.origin, [0.1, 0.8, -0.2]);
  assert.deepEqual(top.bounds, [-0.655, 0.655, -0.385, 0.385]);
  assert.ok(Math.abs(top.u[0]) < 1e-10);
  assert.equal(top.u[2], -1);
  assert.equal(top.v[0], 1);
  assert.equal(top.name, '桌子 1 · 推断顶面');
});

test('commands produce independent states with exactly one revision increment', () => {
  const before = initial();
  const saved = serializeState(before);
  const added = applyCommand(before, { type: 'add', object: newBox() });
  assert.equal(serializeState(before), saved);
  assert.equal(added.revision, 1);
  assert.equal(added.objects.length, 2);
  assert.equal(added.objects[1].source, 'user');
  assert.notEqual(added.objects[0].center, before.objects[0].center);
  const updated = applyCommand(added, { type: 'update', id: 'user-1', patch: { name: '灯座', center: [0.5, 0.9, -0.2] } });
  assert.equal(updated.revision, 2);
  assert.equal(added.objects[1].name, '台灯底座');
  const deleted = applyCommand(updated, { type: 'delete', id: 'user-1' });
  assert.equal(deleted.revision, 3);
  assert.equal(deleted.objects.length, 1);
});

test('locked objects cannot move or be deleted, but may be unlocked', () => {
  const locked = applyCommand(initial(), { type: 'update', id: 'roomplan-0', patch: { locked: true } });
  assert.throws(() => applyCommand(locked, { type: 'update', id: 'roomplan-0', patch: { center: [0, 1, 0] } }), /锁定/u);
  assert.throws(() => applyCommand(locked, { type: 'delete', id: 'roomplan-0' }), /锁定/u);
  const unlocked = applyCommand(locked, { type: 'update', id: 'roomplan-0', patch: { locked: false } });
  assert.equal(unlocked.objects[0].locked, false);
});

test('clear furniture retains locks and required supports, then can be undone by retaining the prior state', () => {
  let state = applyCommand(initial(), { type: 'add', object: newBox('lamp', { anchorId: 'top-roomplan-0', locked: true }) });
  state = applyCommand(state, { type: 'add', object: newBox('spare') });
  const clear = applyCommand(state, { type: 'clearFurniture' });
  assert.deepEqual(clear.objects.map(item => item.id), ['roomplan-0', 'lamp']);
  assert.equal(state.objects.length, 3);
  const empty = applyCommand(initial(), { type: 'clearFurniture' });
  assert.equal(empty.objects.length, 0);
});

test('a duplicated floor object stays locked through a full inspector patch and furniture clearing', () => {
  let state = applyCommand(initial(), { type: 'add', object: newBox('original') });
  const original = state.objects.at(-1);
  state = applyCommand(state, { type: 'add', object: {
    ...structuredClone(original), id: 'copy', name: `${original.name} 副本`,
    center: [original.center[0] + state.gridStep, original.center[1], original.center[2] + state.gridStep],
  } });
  const copy = state.objects.at(-1);
  state = applyCommand(state, { type: 'update', id: copy.id, patch: {
    name: copy.name, category: copy.category, center: [...copy.center], size: [...copy.size], rotY: copy.rotY, locked: true,
  } });
  const locked = structuredClone(state.objects.at(-1));
  assert.equal(locked.locked, true);
  const cleared = applyCommand(state, { type: 'clearFurniture' });
  assert.deepEqual(cleared.objects, [locked]);
  assert.equal(state.objects.length, 3);
});

test('deleting a support detaches unlocked children in place and protects locked children', () => {
  const attached = applyCommand(initial(), { type: 'add', object: newBox('lamp', { anchorId: 'top-roomplan-0' }) });
  const removed = applyCommand(attached, { type: 'delete', id: 'roomplan-0' });
  assert.equal(removed.objects[0].anchorId, 'floor');
  assert.deepEqual(removed.objects[0].center, attached.objects[1].center);
  const locked = applyCommand(attached, { type: 'update', id: 'lamp', patch: { locked: true } });
  assert.throws(() => applyCommand(locked, { type: 'delete', id: 'roomplan-0' }), /锁定/u);
});

function stackedState() {
  const table = applyCommand(initial(), { type: 'add', object: newBox('small-table', {
    name: '桌上小台', category: 'table', center: [0.3, 1, -0.3], size: [0.6, 0.4, 0.4], rotY: 0.2, anchorId: 'top-roomplan-0',
  }) });
  return applyCommand(table, { type: 'add', object: newBox('lamp', {
    center: [0.4, 1.3, -0.4], anchorId: 'top-small-table',
  }) });
}
const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-10, `${value} ≈ ${expected[index]}`));
};

test('translating a table carries its supported objects and descendants without mutation or scaling', () => {
  const state = stackedState(), snapshot = serializeState(state);
  const moved = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { center: [1.1, 0.9, -0.6] } });
  near(moved.objects[1].center, [1.3, 1.5, -0.7]);
  near(moved.objects[2].center, [1.4, 1.8, -0.8]);
  assert.deepEqual(moved.objects[1].size, state.objects[1].size);
  assert.deepEqual(moved.objects[2].size, state.objects[2].size);
  assert.equal(moved.objects[1].rotY, 0.2);
  assert.equal(moved.objects[2].rotY, 0);
  assert.equal(moved.revision, state.revision + 1);
  assert.equal(serializeState(state), snapshot);
});

test('a 90-degree table rotation preserves local offsets and carries descendant orientations', () => {
  const state = stackedState(), snapshot = serializeState(state);
  const rotated = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { rotY: Math.PI } });
  near(rotated.objects[1].center, [0, 1, -0.4]);
  near(rotated.objects[2].center, [-0.1, 1.3, -0.5]);
  near([rotated.objects[1].rotY, rotated.objects[2].rotY], [0.2 + Math.PI / 2, Math.PI / 2]);
  assert.deepEqual(rotated.objects[1].size, state.objects[1].size);
  assert.deepEqual(rotated.objects[2].size, state.objects[2].size);
  assert.equal(serializeState(state), snapshot);
});

test('changing table height lifts dependants by the top-plane delta; width/depth do not scale them', () => {
  const state = stackedState();
  const taller = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { size: [2.62, 1.2, 1.54] } });
  near(taller.objects[1].center, [0.3, 1.2, -0.3]);
  near(taller.objects[2].center, [0.4, 1.5, -0.4]);
  for (const index of [1, 2]) {
    assert.deepEqual(taller.objects[index].size, state.objects[index].size);
    assert.equal(taller.objects[index].rotY, state.objects[index].rotY);
  }
  const wider = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { size: [2.62, 0.8, 1.54] } });
  assert.deepEqual(wider.objects.slice(1), state.objects.slice(1));
  const renamed = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { name: '改名后的桌子' } });
  assert.deepEqual(renamed.objects.slice(1), state.objects.slice(1));
});

test('locked descendants prevent indirect movement/rotation but allow edits that do not transform them', () => {
  const state = applyCommand(stackedState(), { type: 'update', id: 'lamp', patch: { locked: true } });
  const snapshot = serializeState(state);
  for (const patch of [{ center: [0.3, 0.4, -0.2] }, { rotY: Math.PI }, { size: [1.31, 1, 0.77] }]) {
    assert.throws(() => applyCommand(state, { type: 'update', id: 'roomplan-0', patch }), /锁定/u);
    assert.equal(serializeState(state), snapshot);
  }
  const wider = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { size: [2, 0.8, 1] } });
  assert.deepEqual(wider.objects.slice(1), state.objects.slice(1));
  const renamed = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { name: '新桌名' } });
  assert.deepEqual(renamed.objects.slice(1), state.objects.slice(1));
  const fullTurn = applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { rotY: state.objects[0].rotY + Math.PI * 2 } });
  assert.deepEqual(fullTurn.objects.slice(1), state.objects.slice(1));
});

test('all grid densities preserve exact continuous transforms, dimensions and semantic data', () => {
  let state = applyCommand(initial(), { type: 'add', object: newBox('lamp', { anchorId: 'top-roomplan-0' }) });
  const objects = JSON.stringify(state.objects), anchors = JSON.stringify(getAnchors(room, state));
  for (const step of [...GRID_STEPS, ...GRID_STEPS.toReversed()]) {
    state = applyCommand(state, { type: 'setGrid', step });
    assert.equal(JSON.stringify(state.objects), objects);
    assert.equal(JSON.stringify(getAnchors(room, state)), anchors);
  }
});

test('validation rejects non-finite values, invalid dimensions, IDs, grid steps and sessions', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const state = initial(); state.objects[0].center[0] = bad;
    assert.throws(() => validateState(state, room, 'fixture'), /有限/u);
  }
  for (const bad of [0, -0.01, LIMITS.dimension + 1]) {
    const state = initial(); state.objects[0].size[0] = bad;
    assert.throws(() => validateState(state, room, 'fixture'));
  }
  const duplicate = initial(); duplicate.objects.push({ ...duplicate.objects[0] });
  assert.throws(() => validateState(duplicate, room, 'fixture'), /重复/u);
  assert.throws(() => validateState(initial(), room, 'other'), /会话/u);
  assert.throws(() => validateState({ ...initial(), gridStep: 0.03 }, room, 'fixture'), /格子/u);
  assert.throws(() => validateState({ ...initial(), revision: -1 }, room, 'fixture'), /revision/u);
  const long = initial(); long.objects[0].name = '字'.repeat(LIMITS.name + 1);
  assert.throws(() => validateState(long, room, 'fixture'), /名称/u);
  assert.throws(() => validateState({ ...initial(), objects: Array(LIMITS.objects + 1).fill(initial().objects[0]) }, room, 'fixture'), /最多/u);
});

test('invalid anchors, unsafe patch fields and unsupported commands are rejected without mutation', () => {
  const state = initial(), before = serializeState(state);
  assert.throws(() => applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { id: 'changed' } }), /不支持/u);
  assert.throws(() => applyCommand(state, { type: 'add', object: newBox('bad', { anchorId: 'top-missing' }) }), /不存在/u);
  assert.throws(() => applyCommand(state, { type: 'update', id: 'roomplan-0', patch: { anchorId: 'top-roomplan-0' } }), /循环/u);
  const wall = initial(); wall.objects[0].anchorId = 'wall-1';
  assert.throws(() => validateState(wall, room, 'fixture'), /不存在/u);
  assert.throws(() => applyCommand(state, { type: 'runJavascript', code: 'bad' }), /不支持/u);
  assert.equal(serializeState(state), before);
});

test('serialised state round-trips and polygon/snap helpers handle boundaries', () => {
  assert.deepEqual(validateState(JSON.parse(serializeState(initial())), room, 'fixture'), initial());
  assert.equal(pointInPolygon(0, 0, room.polygon), true);
  assert.equal(pointInPolygon(2, 0, room.polygon), true);
  assert.equal(pointInPolygon(2.01, 0, room.polygon), false);
  assert.equal(pointInPolygon(NaN, 0, room.polygon), false);
  assert.equal(snapValue(0.35, 0.1), 0.4);
  assert.equal(snapValue(-0.35, 0.1), -0.4);
  assert.equal(snapValue(-0.001, 0.1), 0);
  assert.throws(() => snapValue(1, 0));
});

test('rectangle containment rejects a narrow concave notch missed by grid sampling', () => {
  const polygon = [[0, 0], [2, 0], [2, 2], [1.06, 2], [1.06, 0.98], [1.04, 0.98], [1.04, 2], [0, 2]];
  // Every old 10 cm sample passes, despite an unobserved 2 cm-wide notch.
  for (let i = 8; i <= 12; i++) for (let j = 8; j <= 12; j++) assert.equal(pointInPolygon(i / 10, j / 10, polygon), true);
  assert.equal(pointInPolygon(1.05, 1.1, polygon), false);
  assert.equal(rectangleInPolygon(0.8, 0.8, 1.2, 1.2, polygon), false);
  assert.equal(rectangleInPolygon(0.8, 0.8, 1.04, 1.2, polygon), true);
  assert.equal(rectangleInPolygon(1.06, 0.8, 1.3, 1.2, polygon), true);
});

test('rectangle containment accepts coincident edges, collinear polygon points and boundary contact', () => {
  const polygon = [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]];
  assert.equal(rectangleInPolygon(0, 0, 2, 2, polygon), true);
  assert.equal(rectangleInPolygon(0, 0.3, 1, 1.7, polygon), true);
  assert.equal(rectangleInPolygon(0.5, 0.5, 1.5, 1.5, polygon.toReversed()), true);
  const lShape = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]];
  assert.equal(rectangleInPolygon(0, 0, 1, 1, lShape), true);
  assert.equal(rectangleInPolygon(0.2, 0.2, 0.8, 2.8, lShape), true);
  assert.equal(rectangleInPolygon(0.5, 0.5, 2.5, 2.5, lShape), false);
});

test('rectangle containment rejects degenerate, inverted, malformed and non-finite input', () => {
  assert.equal(rectangleInPolygon(0, 0, 0, 1, room.polygon), false);
  assert.equal(rectangleInPolygon(0, 0, 1, 0, room.polygon), false);
  assert.equal(rectangleInPolygon(1, 0, 0, 1, room.polygon), false);
  assert.equal(rectangleInPolygon(0, 1, 1, 0, room.polygon), false);
  assert.equal(rectangleInPolygon(NaN, 0, 1, 1, room.polygon), false);
  assert.equal(rectangleInPolygon(0, 0, Infinity, 1, room.polygon), false);
  assert.equal(rectangleInPolygon(0, 0, 1, 1, [[0, 0], [2, 0], [2, NaN]]), false);
  assert.equal(rectangleInPolygon(0, 0, 1, 1, []), false);
  assert.equal(rectangleInPolygon(-3, 0, 1, 1, room.polygon), false);
});

for (const sourceId of ['office-1', 'office-2']) {
  const path = new URL(`../.private/${sourceId}/converted.json`, import.meta.url);
  test(`real ${sourceId} can initialise and change density without PLY input`, { skip: !existsSync(path) && 'private capture not present in this checkout' }, () => {
    const capture = JSON.parse(readFileSync(path, 'utf8'));
    const state = createInitialState(capture, sourceId);
    assert.equal(state.objects.length, capture.objects.length);
    assert.equal(getAnchors(capture, state).length, 1 + capture.walls.length + capture.objects.filter(item => item.category === 'table').length);
    const fine = applyCommand(state, { type: 'setGrid', step: 0.025 });
    assert.deepEqual(fine.objects, state.objects);
    assert.equal(validateState(JSON.parse(serializeState(fine)), capture, sourceId).sourceId, sourceId);
  });
}
