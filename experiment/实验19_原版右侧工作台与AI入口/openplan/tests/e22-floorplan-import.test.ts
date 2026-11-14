import { describe, expect, it } from 'vitest';
import { createProjectFromE22FloorPlan, validateE22FloorPlan } from '$lib/utils/e22FloorPlanImport';

const plan = () => ({
  schemaVersion: 1, kind: 'room-layout-plan', scanId: 'scan-test', roomIndex: 2,
  frame: 'room-local-m', units: 'm', transformHash: 'transform', convertedHash: 'converted',
  polygon: [[0, 0], [4, 0], [4, 3], [0, 3]],
  walls: [
    { a: [0, 0], b: [4, 0], length: 4, height: 2.8, openings: [{ kind: 'door', u0: 1, u1: 2, v0: 0, v1: 2.1 }] },
    { a: [4, 0], b: [4, 3], length: 3, height: 2.8, openings: [{ kind: 'window', u0: 1, u1: 2, v0: 0.9, v1: 2.1 }] },
    { a: [4, 3], b: [0, 3], length: 4, height: 2.8, openings: [] },
    { a: [0, 3], b: [0, 0], length: 3, height: 2.8, openings: [] },
  ],
  objects: [{ category: 'sofa', center: [1.5, 0.45, 1.5], size: [2, 0.9, 0.8], rotY: Math.PI / 2 }],
  objectRefs: [{ convertedIndex: 0, objectId: 'sofa-1', sourceIdentifier: 'original-sofa' }],
});

describe('E22 room-local floor plan import', () => {
  it('keeps the same room axes while converting metres to editable centimetres', () => {
    const project = createProjectFromE22FloorPlan(plan(), 'Living Room');
    const floor = project.floors[0];
    expect(project.name).toBe('Living Room');
    expect(floor.walls).toHaveLength(4);
    expect(floor.walls[0].end).toEqual({ x: 400, y: 0 });
    expect(floor.walls[0].thickness).toBe(10);
    expect(floor.doors[0]).toMatchObject({ wallId: 'e22-wall-0', position: 0.375, width: 100, height: 210 });
    expect(floor.windows[0]).toMatchObject({ wallId: 'e22-wall-1', position: 0.5, sillHeight: 90, width: 100 });
    expect(floor.furniture[0]).toMatchObject({ id: 'e22-furniture-0-sofa-1', position: { x: 150, y: 150 }, width: 200, depth: 80, height: 90 });
    expect(floor.furniture[0].rotation).toBeCloseTo(-90);
    expect(floor.rooms.length).toBeGreaterThan(0);
  });

  it('rejects wrong frame and malformed dimensions before changing projects', () => {
    const wrongFrame = { ...plan(), frame: 'capture-session-world-m' };
    expect(() => validateE22FloorPlan(wrongFrame)).toThrow(/Invalid Experiment 22/);
    const wrongOpening = plan();
    wrongOpening.walls[0].openings[0].u1 = 0;
    expect(() => createProjectFromE22FloorPlan(wrongOpening)).toThrow(/Invalid Experiment 22/);
  });
});
