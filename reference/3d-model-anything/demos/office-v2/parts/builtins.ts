import * as THREE from 'three';
import type { PartContext } from './types';

/**
 * The south-wall built-ins now live in items/: builtins-cabinetry.ts, shelf-props.ts, east-shelf-props.ts,
 * skateboards.ts, builtins-floor-clutter.ts, menu-signs.ts, plant.ts.
 * (Kept as an empty part so ?parts=builtins still resolves; the HD pass moved every object into an item file.)
 */
export function build(_ctx: PartContext) {
  const g = new THREE.Group();
  g.name = 'builtins';
  return g;
}
