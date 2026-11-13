import * as THREE from 'three';
import type { PartContext } from './types';

/**
 * The north-west wing now lives in items/: printer-bench.ts, green-screen.ts, filament-rack.ts,
 * wing-floor.ts, door-corner.ts.
 * (Kept as an empty part so ?parts=wing still resolves; the HD pass moved every object into an item file.)
 */
export function build(_ctx: PartContext) {
  const g = new THREE.Group();
  g.name = 'wing';
  return g;
}
