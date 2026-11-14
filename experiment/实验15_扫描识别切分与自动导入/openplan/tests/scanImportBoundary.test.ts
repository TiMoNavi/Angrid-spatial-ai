import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractRoomJsonFromZip } from '$lib/utils/roomplanImport';
import { translate, type Locale } from '$lib/i18n';

async function zipFile(entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(entries)) zip.file(name, contents);
  return new File([await zip.generateAsync({ type: 'blob' })], 'capture.zip', { type: 'application/zip' });
}

describe('experiment 14 scan import boundary', () => {
  it('does not silently reduce a full HouseCapture scan to a floor plan', async () => {
    const file = await zipFile({
      'Room/manifest.json': '{}',
      'Room/rooms/room-0.json': '{"walls":[]}',
      'Room/mesh/room-0.ply': 'ply',
      'room.json': '{"walls":[]}'
    });
    await expect(extractRoomJsonFromZip(file)).rejects.toThrow(/full 3D Model Anything iPhone scan ZIP/);
  });

  it('still accepts the existing single-room plan ZIP format', async () => {
    const file = await zipFile({ 'room.json': '{"walls":[]}' });
    await expect(extractRoomJsonFromZip(file)).resolves.toEqual({ walls: [] });
  });

  it('labels the sidebar and toolbar imports as plan-only in supported locales', () => {
    for (const language of ['en', 'pt'] as Locale[]) {
      expect(translate(language, 'buildTools.roomplanHelp')).toContain('room.json');
      expect(translate(language, 'buildTools.roomplanHelp')).not.toMatch(/LiDAR/i);
      expect(translate(language, 'exportMenu.import')).toContain('RoomPlan');
      expect(translate(language, 'exportMenu.importScanHelp')).toMatch(/PLY/);
    }
  });
});
