import { expect, it } from 'vitest';
import { classifyScanZipEntries } from '$lib/utils/scanZipKind';

it('routes an indexed House Capture ZIP to the E22 pipeline', () => {
  expect(classifyScanZipEntries([
    'Room/manifest.json', 'Room/rooms/room-0.json', 'Room/mesh/room-0.ply',
    'Room/depth/00001.f16z',
  ])).toBe('house-capture');
});

it('keeps a traditional single room.json ZIP on the RoomPlan options path', () => {
  expect(classifyScanZipEntries(['room.json', 'assets/image.jpg'])).toBe('roomplan');
  expect(classifyScanZipEntries(['manifest.json', 'Room/room.json'])).toBe('roomplan');
});

it('rejects unrelated ZIP contents instead of showing the old room.json error', () => {
  expect(classifyScanZipEntries(['manifest.json', 'plan.json'])).toBe('unsupported');
});
