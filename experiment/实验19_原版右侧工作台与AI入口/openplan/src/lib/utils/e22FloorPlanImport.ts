/** Project an E22 room-local plan onto OpenPlan's editable centimetre floor. */
import type { Door, FurnitureItem, Point, Project, Wall, Window as PlanWindow } from '$lib/models/types';
import { createDefaultProject } from '$lib/stores/project';
import { detectRooms } from '$lib/utils/roomDetection';
import { importedFurnitureCategory } from '$lib/utils/furnitureCategories';
import { readProject } from '$lib/utils/projectValidation';

type Opening = { kind: string; u0: number; u1: number; v0: number; v1: number };
type PlanWall = { a: number[]; b: number[]; length: number; height: number; openings: Opening[] };
type PlanObject = { category: string; center: number[]; size: number[]; rotY: number };
type ObjectRef = { convertedIndex: number; objectId: string; sourceIdentifier?: string };
export type E22FloorPlan = {
  schemaVersion: 1; kind: 'room-layout-plan'; scanId: string; roomIndex: number;
  frame: 'room-local-m'; units: 'm'; transformHash: string; convertedHash: string;
  polygon: number[][]; walls: PlanWall[]; objects: PlanObject[]; objectRefs?: ObjectRef[];
};

const cm = (meters: number) => meters * 100;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const point = (value: unknown): value is number[] => Array.isArray(value) && value.length === 2 && value.every(finite);
const pointCm = (value: number[]): Point => ({ x: cm(value[0]), y: cm(value[1]) });
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Reject a wrong or malformed asset before the editor opens a new project. */
export function validateE22FloorPlan(value: unknown): asserts value is E22FloorPlan {
  const data = value as E22FloorPlan;
  const invalid = () => { throw new Error('Invalid Experiment 22 floor plan; the current project was not changed.'); };
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || data.kind !== 'room-layout-plan' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(data.scanId) || !Number.isSafeInteger(data.roomIndex) ||
      data.frame !== 'room-local-m' || data.units !== 'm' ||
      typeof data.transformHash !== 'string' || !data.transformHash ||
      typeof data.convertedHash !== 'string' || !data.convertedHash ||
      !Array.isArray(data.polygon) || data.polygon.length < 3 || data.polygon.length > 10000 ||
      !data.polygon.every(point) || !Array.isArray(data.walls) || data.walls.length > 10000 ||
      !Array.isArray(data.objects) || data.objects.length > 10000) invalid();
  for (const wall of data.walls) {
    if (!wall || !point(wall.a) || !point(wall.b) || !finite(wall.length) || wall.length <= 0 ||
        !finite(wall.height) || wall.height <= 0 || !Array.isArray(wall.openings)) invalid();
    for (const opening of wall.openings) {
      if (!opening || typeof opening.kind !== 'string' ||
          ![opening.u0, opening.u1, opening.v0, opening.v1].every(finite) ||
          opening.u1 <= opening.u0 || opening.v1 <= opening.v0) invalid();
    }
  }
  for (const object of data.objects) {
    if (!object || typeof object.category !== 'string' ||
        !Array.isArray(object.center) || object.center.length !== 3 || !object.center.every(finite) ||
        !Array.isArray(object.size) || object.size.length !== 3 ||
        !object.size.every((n) => finite(n) && n > 0) || !finite(object.rotY)) invalid();
  }
  if (data.objectRefs !== undefined && (!Array.isArray(data.objectRefs) ||
      data.objectRefs.some(ref => !ref || !Number.isSafeInteger(ref.convertedIndex) ||
        ref.convertedIndex < 0 || ref.convertedIndex >= data.objects.length ||
        typeof ref.objectId !== 'string' || !ref.objectId))) invalid();
}

export function createProjectFromE22FloorPlan(value: unknown, name = 'iPhone Scan'): Project {
  validateE22FloorPlan(value);
  const plan = value;
  const project = createDefaultProject(name);
  const floor = project.floors[0];
  floor.name = 'Scanned Room';
  const walls: Wall[] = [];
  const doors: Door[] = [];
  const windows: PlanWindow[] = [];
  for (const [wi, source] of plan.walls.entries()) {
    const wallId = 'e22-wall-' + wi;
    walls.push({
      id: wallId, start: pointCm(source.a), end: pointCm(source.b),
      thickness: 10, // E22's layout proxy; actual wall thickness is not measured.
      height: cm(source.height), color: '#444444',
      details: { note: 'RoomPlan wall; 10 cm display thickness is an unmeasured proxy.' },
    });
    for (const [oi, opening] of source.openings.entries()) {
      const width = cm(opening.u1 - opening.u0);
      const height = cm(opening.v1 - opening.v0);
      const position = clamp01((opening.u0 + opening.u1) / (2 * source.length));
      if (opening.kind === 'window') {
        windows.push({ id: 'e22-window-' + wi + '-' + oi, wallId, position, width, height,
          sillHeight: cm(Math.max(0, opening.v0)), type: 'standard' });
      } else {
        doors.push({ id: 'e22-door-' + wi + '-' + oi, wallId, position, width, height,
          type: opening.kind === 'door' ? 'single' : 'opening',
          swingDirection: 'left', flipSide: false });
      }
    }
  }
  floor.walls = walls;
  floor.doors = doors;
  floor.windows = windows;
  floor.rooms = detectRooms(walls);
  if (floor.rooms.length === 1) floor.rooms[0].name = 'Scanned Room';
  const refs = new Map(plan.objectRefs?.map(ref => [ref.convertedIndex, ref]) ?? []);
  floor.furniture = plan.objects.map((source, index): FurnitureItem => {
    const ref = refs.get(index);
    const width = cm(source.size[0]);
    const elevation = cm(source.center[1] - source.size[1] / 2);
    return {
      id: 'e22-furniture-' + index + '-' + (ref?.objectId ?? index),
      ...importedFurnitureCategory(source.category, width),
      position: { x: cm(source.center[0]), y: cm(source.center[2]) },
      rotation: -source.rotY * 180 / Math.PI, scale: { x: 1, y: 1, z: 1 },
      width, height: cm(source.size[1]), depth: cm(source.size[2]),
      ...(elevation >= 0.5 ? { elevation } : {}),
      details: { note: 'RoomPlan ' + source.category + ' hypothesis' +
        (ref?.sourceIdentifier ? '; source ' + ref.sourceIdentifier : '') + '.' },
    };
  });
  project.description = 'Experiment 22 scan ' + plan.scanId + '; room-local metres projected to editable centimetres. Furniture bounds are RoomPlan hypotheses.';
  return readProject(project);
}
