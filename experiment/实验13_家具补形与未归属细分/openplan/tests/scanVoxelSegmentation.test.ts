import { describe, expect, it } from 'vitest';
import { buildCleanRoomGrid, classifySurfaceGrid, type ConvertedScanRoom, type ScanGrid } from '../src/lib/utils/scanVoxelSegmentation';

const grid: ScanGrid = { origin: [-0.1, -0.1, -0.1], counts: [12, 12, 12], step: 0.2, keys: [] };
const key = (x: number, y: number, z: number) => (x * grid.counts[1] + y) * grid.counts[2] + z;
const room: ConvertedScanRoom = {
  polygon: [[0, 0], [2, 0], [2, 2], [0, 2]],
  walls: [
    { a: [0, 0], b: [2, 0], height: 1.8 },
    { a: [2, 0], b: [2, 2], height: 1.8, origin: [2, 0, 0], u: [0, 0, 1],
      openings: [{ u0: 0.8, u1: 1.2, v0: 0.5, v1: 1.5 }] },
    { a: [2, 2], b: [0, 2], height: 1.8 }
  ],
  objects: [{ category: 'table', center: [1, 0.5, 1], size: [0.4, 0.4, 0.4], rotY: 0 }]
};

describe('scan voxel layers', () => {
  it('retains each scan surface cell while distinguishing geometric associations', () => {
    const source = { ...grid, keys: [key(5, 0, 5), key(5, 5, 0), key(5, 2, 5), key(5, 8, 5), key(10, 5, 5)] };
    const groups = classifySurfaceGrid(source, room);
    expect(groups.floor).toEqual([key(5, 0, 5)]);
    expect(groups.walls).toEqual([key(5, 5, 0)]);
    expect(groups.objects['0']).toEqual([key(5, 2, 5)]);
    expect(groups.unclassified).toEqual([key(5, 8, 5), key(10, 5, 5)]);
    expect(groups.floor.length + groups.walls.length + groups.unclassified.length +
      Object.values(groups.objects).flat().length).toBe(source.keys.length);
  });

  it('builds a planar scaffold while marking unobserved closure and preserving openings', () => {
    const groups = buildCleanRoomGrid(room, grid);
    expect(groups.floor.length).toBeGreaterThan(0);
    expect(groups.walls.length).toBeGreaterThan(0);
    expect(groups.inferredWalls.length).toBeGreaterThan(0);
    expect(groups.objects['0'].length).toBeGreaterThan(0);
    expect(groups.walls).not.toContain(key(10, 5, 5));
    const all = [...groups.floor, ...groups.walls, ...groups.inferredWalls, ...Object.values(groups.objects).flat()];
    expect(new Set(all).size).toBe(all.length);
  });
});
