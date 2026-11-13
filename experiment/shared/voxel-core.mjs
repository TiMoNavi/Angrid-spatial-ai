// Pure, meter-based conversions shared by the browser experiment and its checks.
export function makeGrid(room, step) {
  if (!Number.isFinite(step) || step <= 0) throw new Error('格子边长必须大于零');
  const xs = room.polygon.map(point => point[0]);
  const zs = room.polygon.map(point => point[1]);
  const height = Math.max(...room.walls.map(wall => wall.height));
  const margin = 0.15;
  const origin = [Math.min(...xs) - margin, -margin, Math.min(...zs) - margin];
  const limits = [Math.max(...xs) + margin, height + margin, Math.max(...zs) + margin];
  const counts = limits.map((limit, axis) => Math.ceil((limit - origin[axis]) / step));
  return { origin, limits, counts, step, denseCount: counts[0] * counts[1] * counts[2] };
}

export function voxelizeSurface(positions, grid) {
  const [nx, ny, nz] = grid.counts;
  const [ox, oy, oz] = grid.origin;
  const keys = new Set();
  let includedPoints = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (!Number.isFinite(x + y + z)) continue;
    const ix = Math.floor((x - ox) / grid.step);
    const iy = Math.floor((y - oy) / grid.step);
    const iz = Math.floor((z - oz) / grid.step);
    if (ix < 0 || ix >= nx || iy < 0 || iy >= ny || iz < 0 || iz >= nz) continue;
    includedPoints++;
    keys.add((ix * ny + iy) * nz + iz);
  }
  return { keys: [...keys], includedPoints, totalPoints: positions.length / 3 };
}

export function decodeCell(key, grid) {
  const [,, nz] = grid.counts;
  const ny = grid.counts[1];
  const iz = key % nz;
  const rest = (key - iz) / nz;
  const iy = rest % ny;
  const ix = (rest - iy) / ny;
  return [ix, iy, iz];
}

export function boxGrid(size, step) {
  const counts = size.map(length => Math.max(1, Math.ceil(length / step)));
  const [nx, ny, nz] = counts;
  const occupiedCount = nx * ny * nz;
  const shellCount = occupiedCount - Math.max(0, nx - 2) * Math.max(0, ny - 2) * Math.max(0, nz - 2);
  return { counts, occupiedCount, shellCount };
}

export function boxCell(size, step, axis, index) {
  const start = Math.min(index * step, size[axis]);
  const end = Math.min((index + 1) * step, size[axis]);
  return { center: -size[axis] / 2 + (start + end) / 2, length: end - start };
}

export function pointsInsideBox(positions, item) {
  const [cx, cy, cz] = item.center;
  const [sx, sy, sz] = item.size;
  const c = Math.cos(item.rotY), s = Math.sin(item.rotY);
  let count = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - cx, dy = positions[i + 1] - cy, dz = positions[i + 2] - cz;
    const lx = c * dx - s * dz;
    const lz = s * dx + c * dz;
    if (Math.abs(lx) <= sx / 2 && Math.abs(dy) <= sy / 2 && Math.abs(lz) <= sz / 2) count++;
  }
  return count;
}
