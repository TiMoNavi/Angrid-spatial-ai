import type { Floor, Point, Project } from '$lib/models/types';
import { getCatalogItem, getFurnitureSize } from '$lib/utils/furnitureCatalog';
import { resolveRoomGeometry } from '$lib/utils/roomDetection';
import { roomHoles } from '$lib/utils/roomNesting';
import type { AgentOp } from '$lib/utils/agentOps';
import { layoutRecipes } from '$lib/ai/layouts';

export type LayoutPreset = string;
export interface LayoutRequest {
  floorId?: string;
  preset: LayoutPreset;
  catalogId?: string;
  clearanceCm?: number;
}
export interface LayoutPlacement {
  catalogId: string;
  name: string;
  position: Point;
  rotation: number;
  width: number;
  depth: number;
}
export interface LayoutProposal {
  projectId: string;
  floorId: string;
  roomId: string;
  revision: string;
  preset: LayoutPreset;
  clearanceCm: number;
  placements: LayoutPlacement[];
  limitation: string;
}

const LIMITATION = '2D design draft only: room polygons and furniture, stair and column footprints are approximations. Door swing, walking routes, 3D height and scan clearance are not verified.';
/** Fingerprint the geometry that a proposal depends on; a stale preview must not be applied. */
export function layoutRevision(project: Project, floorId: string): string {
  const floor = project.floors.find(item => item.id === floorId);
  if (!floor) throw new Error('The chosen floor is no longer in this project.');
  const data = JSON.stringify({ walls: floor.walls, rooms: floor.rooms, doors: floor.doors, windows: floor.windows,
    furniture: floor.furniture, stairs: floor.stairs, columns: floor.columns });
  let hash = 2166136261;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36) + '-' + data.length;
}

function pointInside(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function boundaryDistance(point: Point, ring: Point[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}

interface Box { position: Point; width: number; depth: number }
function rotatedBox(position: Point, width: number, depth: number, rotation: number): Box {
  const angle = rotation * Math.PI / 180;
  return { position, width: Math.abs(width * Math.cos(angle)) + Math.abs(depth * Math.sin(angle)),
    depth: Math.abs(width * Math.sin(angle)) + Math.abs(depth * Math.cos(angle)) };
}
function collides(a: Box, b: Box, clearance: number): boolean {
  return Math.abs(a.position.x - b.position.x) < (a.width + b.width) / 2 + clearance &&
    Math.abs(a.position.y - b.position.y) < (a.depth + b.depth) / 2 + clearance;
}

function existingBoxes(floor: Floor): Box[] {
  return [
    ...floor.furniture.map(item => { const size = getFurnitureSize(item); return rotatedBox(item.position, size.width, size.depth, item.rotation); }),
    ...floor.stairs.map(item => rotatedBox(item.position, item.width, item.depth, item.rotation)),
    ...floor.columns.map(item => rotatedBox(item.position, item.diameter, item.diameter, item.rotation)),
  ];
}

/** Preview a small, deterministic layout. No project mutation and no claim of physical safety. */
export function previewLayout(project: Project, request: LayoutRequest): LayoutProposal {
  const recipe = layoutRecipes.find(item => item.id === request.preset);
  if (request.preset !== 'single' && !recipe) throw new Error('Choose a known layout recipe or single object.');
  const floorId = request.floorId ?? project.activeFloorId;
  const floor = project.floors.find(item => item.id === floorId);
  if (!floor) throw new Error('The chosen floor does not exist.');
  const clearance = request.clearanceCm ?? 15;
  if (!Number.isFinite(clearance) || clearance < 0 || clearance > 80) throw new Error('Clearance must be between 0 and 80 cm.');
  const specs = request.preset === 'single'
    ? [{ catalogId: request.catalogId, target: { x: 0.5, y: 0.5 }, rotations: [0, 90] }]
    : recipe!.items;
  if (specs.some(item => !item.catalogId || !Number.isFinite(item.target?.x) || !Number.isFinite(item.target?.y) ||
    item.target.x < 0 || item.target.x > 1 || item.target.y < 0 || item.target.y > 1 ||
    (item.rotations && (!item.rotations.length || item.rotations.some(angle => angle !== 0 && angle !== 90)))))
    throw new Error('The layout recipe has invalid catalog items, targets or rotations.');
  const defs = specs.map(item => item.catalogId && getCatalogItem(item.catalogId));
  if (defs.some(def => !def || def.symbol)) throw new Error('Choose a 3D furniture item from the catalog.');
  const rooms = resolveRoomGeometry(floor).filter(item => !item.room.floorOpening && item.polygon.length >= 3);
  if (!rooms.length) throw new Error('Draw or import a closed room before previewing a layout.');
  const room = rooms.reduce((best, item) => item.room.area > best.room.area ? item : best);
  const roomIndex = rooms.indexOf(room);
  const holes = roomHoles(rooms.map(item => item.polygon))[roomIndex] ?? [];
  const xs = room.polygon.map(p => p.x), ys = room.polygon.map(p => p.y);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  if (bounds.maxX - bounds.minX > 3000 || bounds.maxY - bounds.minY > 3000) throw new Error('Room is larger than the 30 m preview limit.');
  const occupied = existingBoxes(floor);
  const placements: LayoutPlacement[] = [];

  for (const [index, def] of defs.entries()) {
    if (!def) continue;
    const radius = Math.hypot(def.width, def.depth) / 2 + clearance;
    const target = { x: bounds.minX + specs[index].target.x * (bounds.maxX - bounds.minX),
      y: bounds.minY + specs[index].target.y * (bounds.maxY - bounds.minY) };
    let best: { box: Box; rotation: number; score: number } | null = null;
    for (let x = bounds.minX + radius; x <= bounds.maxX - radius + 0.01; x += 25) {
      for (let y = bounds.minY + radius; y <= bounds.maxY - radius + 0.01; y += 25) {
        const position = { x: Math.round(x), y: Math.round(y) };
        if (!pointInside(position, room.polygon) || holes.some(hole => pointInside(position, hole))) continue;
        if ([room.polygon, ...holes].some(ring => boundaryDistance(position, ring) < radius)) continue;
        for (const rotation of specs[index].rotations ?? [0, 90]) {
          const box = { position, width: rotation ? def.depth : def.width, depth: rotation ? def.width : def.depth };
          if (occupied.some(other => collides(box, other, clearance))) continue;
          const score = Math.hypot(position.x - target.x, position.y - target.y) + (rotation ? 8 : 0);
          if (!best || score < best.score) best = { box, rotation, score };
        }
      }
    }
    if (!best) throw new Error('No simple placement found for ' + def.name + '. Try a larger closed room or move existing furniture.');
    occupied.push(best.box);
    placements.push({ catalogId: def.id, name: def.name, position: best.box.position,
      rotation: best.rotation, width: def.width, depth: def.depth });
  }
  return { projectId: project.id, floorId, roomId: room.room.id, revision: layoutRevision(project, floorId),
    preset: request.preset, clearanceCm: clearance, placements, limitation: LIMITATION };
}

/** Convert a reviewed preview to the bridge's atomic edit format. */
export function layoutToAgentOps(proposal: LayoutProposal): AgentOp[] {
  return proposal.placements.map((placement, index) => ({
    op: 'add', floorId: proposal.floorId, collection: 'furniture',
    item: { id: 'layout-' + Date.now().toString(36) + '-' + index + '-' + Math.random().toString(36).slice(2, 7),
      catalogId: placement.catalogId, position: { x: placement.position.x, y: placement.position.y }, rotation: placement.rotation,
      scale: { x: 1, y: 1, z: 1 } },
  }));
}
