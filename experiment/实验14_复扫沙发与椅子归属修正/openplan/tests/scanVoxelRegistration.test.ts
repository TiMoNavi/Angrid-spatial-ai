import { expect, it } from 'vitest';
import { scanRegistration, type RegisteredScanRoom } from '../src/lib/components/viewer3d/scanVoxelLayer';

it('registers room-local scan cells to the unrotated RoomPlan project in centimetres', () => {
  const scan = {
    transform: { worldToRoom: [
      0, 0, -1, 0,
      0, 1, 0, 0,
      1, 0, 0, 0,
      2, 1.4, 3, 1
    ] },
    polygon: [], walls: [], objects: []
  } satisfies RegisteredScanRoom;
  const registration = scanRegistration(scan);
  const world = registration.point(3, 0, 1);
  expect(world.x).toBeCloseTo(200);
  expect(world.y).toBeCloseTo(0); // OpenPlan3D's imported floor is y=0.
  expect(world.z).toBeCloseTo(100);
  const room = registration.roomPoint(world.x, world.y, world.z);
  expect(room.x).toBeCloseTo(3);
  expect(room.y).toBeCloseTo(0);
  expect(room.z).toBeCloseTo(1);
});
