/**
 * Deterministic, room-local scan layers for the OpenPlan 3D viewer.
 *
 * `classifySurfaceGrid` only labels measured TSDF/PLY surface cells. Labels are
 * geometric associations, not a claim that the object has been segmented from
 * the scan. `buildCleanRoomGrid` creates an explicitly inferred planar editing
 * scaffold on the same lattice; it never replaces the measured evidence.
 */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface ScanGrid {
  origin: Vec3;
  counts: Vec3;
  step: number;
  keys: number[];
}

export interface ScanWall {
  a: Vec2;
  b: Vec2;
  height: number;
  origin?: Vec3;
  u?: Vec3;
  openings?: { u0: number; u1: number; v0: number; v1: number; kind?: string }[];
}

export interface ScanObject {
  category: string;
  center: Vec3;
  size: Vec3;
  rotY: number;
}

export interface ConvertedScanRoom {
  polygon: Vec2[];
  walls: ScanWall[];
  objects: ScanObject[];
}

export interface ScanVoxelGroups {
  floor: number[];
  /** Cells associated with explicit RoomPlan wall segments. */
  walls: number[];
  /** Only populated for the clean scaffold: polygon closure without a measured wall. */
  inferredWalls: number[];
  /** Keys are zero-based RoomPlan object indices; association is OBB-based. */
  objects: Record<string, number[]>;
  /** Measured cells which cannot safely be associated with another layer. */
  unclassified: number[];
}

export function decodeScanCell(grid: ScanGrid, key: number): Vec3 {
  const [, ny, nz] = grid.counts;
  const iz = key % nz;
  const rest = (key - iz) / nz;
  const iy = rest % ny;
  const ix = (rest - iy) / ny;
  return [ix, iy, iz];
}

export function cellCenter(grid: ScanGrid, key: number): Vec3 {
  const [ix, iy, iz] = decodeScanCell(grid, key);
  return [
    grid.origin[0] + (ix + 0.5) * grid.step,
    grid.origin[1] + (iy + 0.5) * grid.step,
    grid.origin[2] + (iz + 0.5) * grid.step
  ];
}

function keyOf(grid: ScanGrid, ix: number, iy: number, iz: number): number {
  return (ix * grid.counts[1] + iy) * grid.counts[2] + iz;
}

function inBounds(grid: ScanGrid, ix: number, iy: number, iz: number): boolean {
  return ix >= 0 && iy >= 0 && iz >= 0 &&
    ix < grid.counts[0] && iy < grid.counts[1] && iz < grid.counts[2];
}

function gridRange(grid: ScanGrid, axis: 0 | 1 | 2, lo: number, hi: number): [number, number] {
  return [
    Math.max(0, Math.floor((lo - grid.origin[axis]) / grid.step) - 1),
    Math.min(grid.counts[axis] - 1, Math.floor((hi - grid.origin[axis]) / grid.step) + 1)
  ];
}

function emptyGroups(): ScanVoxelGroups {
  return { floor: [], walls: [], inferredWalls: [], objects: {}, unclassified: [] };
}

function pointInPolygon(x: number, z: number, polygon: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segmentCoordinate(x: number, z: number, a: Vec2, b: Vec2): { u: number; distance: number } {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  if (length < 1e-8) return { u: 0, distance: Math.hypot(x - a[0], z - a[1]) };
  const u = ((x - a[0]) * dx + (z - a[1]) * dz) / length;
  const clamped = Math.max(0, Math.min(length, u));
  return { u, distance: Math.hypot(x - a[0] - clamped * dx / length, z - a[1] - clamped * dz / length) };
}

function openingAt(wall: ScanWall, x: number, y: number, z: number): boolean {
  if (!wall.openings?.length) return false;
  const [ox, , oz] = wall.origin ?? [wall.a[0], 0, wall.a[1]];
  const [ux, , uz] = wall.u ?? (() => {
    const dx = wall.b[0] - wall.a[0], dz = wall.b[1] - wall.a[1];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, 0, dz / len] as Vec3;
  })();
  const u = (x - ox) * ux + (z - oz) * uz;
  return wall.openings.some(o => u > o.u0 && u < o.u1 && y > o.v0 && y < o.v1);
}

function wallAt(x: number, y: number, z: number, wall: ScanWall, distance: number): boolean {
  if (y < -distance || y > wall.height + distance) return false;
  const { u, distance: fromWall } = segmentCoordinate(x, z, wall.a, wall.b);
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  return u >= -distance && u <= length + distance && fromWall <= distance &&
    !openingAt(wall, x, y, z);
}

function objectLocal(point: Vec3, item: ScanObject): Vec3 {
  const dx = point[0] - item.center[0], dz = point[2] - item.center[2];
  const c = Math.cos(item.rotY), s = Math.sin(item.rotY);
  return [c * dx - s * dz, point[1] - item.center[1], s * dx + c * dz];
}

function objectAt(point: Vec3, item: ScanObject, margin: number): boolean {
  const local = objectLocal(point, item);
  return local.every((value, axis) => Math.abs(value) <= item.size[axis] / 2 + margin);
}

function objectIndex(point: Vec3, room: ConvertedScanRoom, margin: number): number {
  let match = -1, smallest = Infinity;
  room.objects.forEach((item, index) => {
    if (!objectAt(point, item, margin)) return;
    const volume = item.size[0] * item.size[1] * item.size[2];
    if (volume < smallest) { smallest = volume; match = index; }
  });
  return match;
}

/** Partition measured surface keys, preserving every valid key exactly once. */
export function classifySurfaceGrid(grid: ScanGrid, room: ConvertedScanRoom): ScanVoxelGroups {
  const groups = emptyGroups();
  const validCount = grid.counts[0] * grid.counts[1] * grid.counts[2];
  for (const key of grid.keys) {
    if (!Number.isInteger(key) || key < 0 || key >= validCount) continue;
    const point = cellCenter(grid, key);
    const object = objectIndex(point, room, grid.step * 0.4);
    if (object >= 0) (groups.objects[String(object)] ??= []).push(key);
    else if (room.walls.some(w => wallAt(...point, w, grid.step * 0.7 + 0.04))) groups.walls.push(key);
    else if (Math.abs(point[1]) <= grid.step * 0.7 + 0.04 &&
      pointInPolygon(point[0], point[2], room.polygon)) groups.floor.push(key);
    else groups.unclassified.push(key);
  }
  return groups;
}

function samePoint(a: Vec2, b: Vec2, tolerance: number): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
}

function matchingWall(a: Vec2, b: Vec2, room: ConvertedScanRoom): ScanWall | undefined {
  return room.walls.find(w =>
    (samePoint(a, w.a, 0.035) && samePoint(b, w.b, 0.035)) ||
    (samePoint(a, w.b, 0.035) && samePoint(b, w.a, 0.035))
  );
}

/**
 * Generate the coarse, planar editing scaffold, snapped to the supplied grid.
 * Polygon edges with no corresponding RoomPlan wall are marked inferredWalls.
 * Objects are oriented bounding-box shells, not extracted object boundaries.
 */
export function buildCleanRoomGrid(room: ConvertedScanRoom, grid: ScanGrid): ScanVoxelGroups {
  const groups = emptyGroups();
  const floor = new Set<number>(), walls = new Set<number>(), inferredWalls = new Set<number>();
  const objects = new Map<number, number>();
  const floorIy = Math.floor(-grid.origin[1] / grid.step);
  if (floorIy >= 0 && floorIy < grid.counts[1]) {
    for (let ix = 0; ix < grid.counts[0]; ix++) for (let iz = 0; iz < grid.counts[2]; iz++) {
      const key = keyOf(grid, ix, floorIy, iz), [x, , z] = cellCenter(grid, key);
      if (pointInPolygon(x, z, room.polygon)) floor.add(key);
    }
  }

  const height = Math.max(...room.walls.map(w => w.height), 2.4);
  for (let i = 0; i < room.polygon.length; i++) {
    const a = room.polygon[i], b = room.polygon[(i + 1) % room.polygon.length];
    const source = matchingWall(a, b, room);
    const target = source ? walls : inferredWalls;
    const [minX, maxX] = gridRange(grid, 0, Math.min(a[0], b[0]), Math.max(a[0], b[0]));
    const [minZ, maxZ] = gridRange(grid, 2, Math.min(a[1], b[1]), Math.max(a[1], b[1]));
    const [minY, maxY] = gridRange(grid, 1, 0, source?.height ?? height);
    for (let ix = minX; ix <= maxX; ix++) for (let iz = minZ; iz <= maxZ; iz++) {
      const sample = cellCenter(grid, keyOf(grid, ix, Math.max(0, minY), iz));
      const { u, distance } = segmentCoordinate(sample[0], sample[2], a, b);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (u < -grid.step / 2 || u > length + grid.step / 2 || distance > grid.step * 0.63) continue;
      for (let iy = minY; iy <= maxY; iy++) {
        const key = keyOf(grid, ix, iy, iz), [x, y, z] = cellCenter(grid, key);
        if (y < -grid.step / 2 || y > (source?.height ?? height) + grid.step / 2) continue;
        if (source && openingAt(source, x, y, z)) continue;
        target.add(key);
      }
    }
  }

  room.objects.forEach((item, index) => {
    const c = Math.cos(item.rotY), s = Math.sin(item.rotY);
    const halfX = (Math.abs(c) * item.size[0] + Math.abs(s) * item.size[2]) / 2;
    const halfZ = (Math.abs(s) * item.size[0] + Math.abs(c) * item.size[2]) / 2;
    const [minX, maxX] = gridRange(grid, 0, item.center[0] - halfX, item.center[0] + halfX);
    const [minY, maxY] = gridRange(grid, 1, item.center[1] - item.size[1] / 2, item.center[1] + item.size[1] / 2);
    const [minZ, maxZ] = gridRange(grid, 2, item.center[2] - halfZ, item.center[2] + halfZ);
    for (let ix = minX; ix <= maxX; ix++) for (let iy = minY; iy <= maxY; iy++) for (let iz = minZ; iz <= maxZ; iz++) {
      if (!inBounds(grid, ix, iy, iz)) continue;
      const key = keyOf(grid, ix, iy, iz), point = cellCenter(grid, key);
      const local = objectLocal(point, item);
      if (!local.every((value, axis) => Math.abs(value) <= item.size[axis] / 2 + grid.step * 0.4)) continue;
      const shell = local.some((value, axis) =>
        Math.abs(value) >= item.size[axis] / 2 - grid.step * 0.6 || item.size[axis] <= grid.step * 1.2);
      if (!shell) continue;
      const existing = objects.get(key);
      if (existing === undefined || item.size[0] * item.size[1] * item.size[2] <
        room.objects[existing].size[0] * room.objects[existing].size[1] * room.objects[existing].size[2]) objects.set(key, index);
    }
  });

  for (const [key, index] of objects) (groups.objects[String(index)] ??= []).push(key);
  for (const key of walls) if (!objects.has(key)) groups.walls.push(key);
  for (const key of inferredWalls) if (!objects.has(key) && !walls.has(key)) groups.inferredWalls.push(key);
  for (const key of floor) if (!objects.has(key) && !walls.has(key) && !inferredWalls.has(key)) groups.floor.push(key);
  return groups;
}
