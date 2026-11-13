import type * as THREE from 'three';
import type { WallDef } from '../../../packages/room-runtime/walls';
import type { Palette } from '../../../packages/room-runtime/materials';
import type { officeMaterials } from '../materials';

/** Everything a part needs from the room. All coordinates are room coordinates (meters, floor y=0). */
export interface PartContext {
  /** Historical build is default; revisions may override measured item configurations. */
  revision?: 'october-7';
  /** walls by index (see scan.json / the plan): origin = interior face, left end; u along; n into room */
  walls: WallDef[];
  /** place obj on wall `wall` (local +x along the wall, +y up, +z into the room) and attach it to that wall's group */
  onWall<T extends THREE.Object3D>(wall: number, obj: T, u: number, v: number, out?: number): T;
  /** attach something already positioned in room coords to a wall's group (hides with the wall in cutaway) */
  attachToWall<T extends THREE.Object3D>(wall: number, obj: T): T;
  /** shared palettes: generic (brass, silver, darkWood, oak, glass, mirror, …) and office (wall, trim, walnut, …) */
  materials: Palette;
  office: ReturnType<typeof officeMaterials>;
  ceiling: number;
  soffit: number;
  soffits: [number, number, number, number][];
  insideRoom(x: number, z: number): boolean;
  /** add a light (lamps, softboxes, LED strips); keep it cheap: point/spot lights, no shadows */
  addLight(light: THREE.Light): void;
}

export interface PartModule {
  /** return a group in room coordinates (floor-standing things) — wall-mounted things go through ctx.onWall */
  build(ctx: PartContext): THREE.Object3D | Promise<THREE.Object3D>;
}
