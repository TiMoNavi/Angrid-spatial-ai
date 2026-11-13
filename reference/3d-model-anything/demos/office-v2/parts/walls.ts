import * as THREE from 'three';
import type { PartContext } from './types';

/**
 * Wall treatments, photo lights and the lounge corner now live in items/: acoustic-panels.ts, wall-decor.ts,
 * softboxes.ts, lounge.ts.
 * (Kept as an empty part so ?parts=walls still resolves; the HD pass moved every object into an item file.)
 */
export function build(_ctx: PartContext) {
  const g = new THREE.Group();
  g.name = 'walls';
  return g;
}
