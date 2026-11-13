import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import scan from '../../data/demos/office-v2/scan.json';
import { loadTextures, materials } from '../../packages/room-runtime/materials';
import { buildShell, CEILING, insideRoom, onWall, POT_LIGHTS, POT_LIGHTS_OFF, SOFFIT, SOFFITS, WALLS } from './shell';
import { loadOfficeTextures, officeMaterials } from './materials';
import type { RoomModule, BuiltRoom } from '../../packages/room-runtime/types';
import { batchStatic } from '../../packages/room-runtime/batch';
import type { PartContext, PartModule } from './parts/types';

/**
 * Office v2: rebuilt from the single-pass House Capture scan (2026-09-18 16.51).
 * The shell lives here; everything else is a "part" in ./parts/*.ts, each owning one
 * area of the room. `?parts=desk,wing` limits which parts are built (for fast checks).
 */
const partModules = import.meta.glob<PartModule>('./parts/*.ts');
/** High-detail replacements, one file per item (the old version is removed from its part) */
const itemModules = import.meta.glob<PartModule>('./items/*.ts');

/** debug overrides for A/B renders: ?tm=agx|neutral|aces&shadow=pcf|vsm&hemi=0.3&pot=14&env=0.6&exp=1.1 */
const dbg = new URLSearchParams(globalThis.location?.search ?? '');
const num = (k: string, d: number) => (dbg.has(k) ? Number(dbg.get(k)) : d);

/** pots whose shadows matter most (over the desk, the lounge chair, the wing bench, the built-ins, the doors) */
const SHADOWED = new Set([0, 2, 4, 8, 9]);
/** ?alllights: every pot + every item light (the full HD rig, ~4× slower) */
const ALL_LIGHTS = dbg.has('alllights');

function baseLights() {
  const lights = new THREE.Group();
  lights.name = 'office-v2-base-lights';
  // low neutral fill: the room's own environment capture does the bounce light
  // (dim sky, warm floor-colored ground: ceilings and soffit undersides get the floor's bounce, photos 0, 91)
  lights.add(new THREE.HemisphereLight('#9a9ea6', '#f0dcc0', num('hemi', 0.8)));
  POT_LIGHTS.forEach(([x, z], i) => {
    if (POT_LIGHTS_OFF.has(i) && !dbg.has('allpots')) return;
    // light budget: forward shading pays for every light on every lit pixel, and the HD materials
    // make each one expensive (21 lights ≈ 11 fps on an M1 Max, these 9 ≈ 43). The unshadowed pots
    // barely change the image (A/B against photos 0, 26, 62, 103, 110); ?alllights brings them back.
    if (!ALL_LIGHTS && !SHADOWED.has(i)) return;
    const y = SOFFITS.some(([a, b, c, d]) => x >= a && x <= b && z >= c && z <= d) ? SOFFIT : CEILING;
    // 4" LED wafer: a wide cone with full penumbra ≈ its Lambertian (cos θ) beam; the shadow
    // frustum is narrowed (focus) so the map's resolution goes where the light is strong
    const spot = new THREE.SpotLight('#fff0de', num('pot', 16), 0, THREE.MathUtils.degToRad(num('pang', 84)), num('pen', 1), 2);
    spot.position.set(x, y - 0.015, z);
    spot.target.position.set(x, 0, z);
    if (SHADOWED.has(i) && dbg.get('shadows') !== '0') {
      spot.castShadow = true;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.focus = 0.72;
      spot.shadow.camera.near = 0.05;
      spot.shadow.camera.far = 6;
      spot.shadow.bias = -0.0006;
      spot.shadow.normalBias = 0.015;
      spot.shadow.radius = num('srad', 10);
      spot.shadow.blurSamples = 16;
    }
    lights.add(spot, spot.target);
  });
  // daylight through the two east windows: soft area lights filling the window openings
  RectAreaLightUniformsLib.init();
  for (const o of dbg.has('norect') ? [] : scan.walls[0].openings) {
    const w = o.u1 - o.u0, h = Math.min(o.v1, CEILING - 0.02) - o.v0;
    const rect = new THREE.RectAreaLight('#e6efff', num('win', 3.5), w, h);
    rect.position.set(WALLS[0].origin.x - 0.02, o.v0 + h / 2, WALLS[0].origin.z + (o.u0 + o.u1) / 2);
    rect.lookAt(rect.position.x - 1, rect.position.y - 0.25, rect.position.z);
    lights.add(rect);
  }
  return lights;
}

export async function buildDetailedOffice(options: { revision?: 'october-7' } = {}): Promise<BuiltRoom> {
    await Promise.all([loadTextures(), loadOfficeTextures()]);
    const group = new THREE.Group();
    group.name = 'office-v2';
    const shell = buildShell();
    group.add(shell.floor, shell.ceiling, ...shell.walls.map((w) => w.group));
    const lights = baseLights();

    const ctx: PartContext = {
      revision: options.revision,
      walls: WALLS,
      onWall: (wall, obj, u, v, out = 0) => {
        onWall(obj, WALLS[wall], u, v, out);
        shell.walls[wall].group.add(obj); // hides with its wall in the dollhouse cutaway
        return obj;
      },
      attachToWall: (wall, obj) => {
        shell.walls[wall].group.add(obj);
        return obj;
      },
      materials: materials(),
      office: officeMaterials(),
      ceiling: CEILING,
      soffit: SOFFIT,
      soffits: SOFFITS,
      insideRoom,
      // item lights only survive the budget when tagged userData.keep (the cubby wash, the blue softbox)
      addLight: (light) => (dbg.has('nopartlights') || (!ALL_LIGHTS && !light.userData.keep) ? undefined : lights.add(light)),
    };

    const q = new URLSearchParams(globalThis.location?.search ?? '');
    const only = q.get('parts')?.split(','); // ?parts=desk,wing   (parts=none → shell only)
    const onlyItems = q.get('items')?.split(','); // ?items=aeron-chair
    const hideItems = q.get('hideItems')?.split(','); // ?hideItems=aeron-chair (compare against the old version)
    const modules = [
      ...Object.entries(partModules).map(([p, l]) => [p.replace('./parts/', '').replace('.ts', ''), l, 'part'] as const),
      ...Object.entries(itemModules).map(([p, l]) => [p.replace('./items/', '').replace('.ts', ''), l, 'item'] as const),
    ];
    for (const [name, load, kind] of modules) {
      if (name === 'types' || name.startsWith('_')) continue;
      if (kind === 'part' && only && !only.includes(name)) continue;
      if (kind === 'item' && ((onlyItems && !onlyItems.includes(name)) || hideItems?.includes(name))) continue;
      try {
        const mod = await load();
        const obj = await mod.build(ctx);
        obj.name ||= name;
        group.add(obj);
      } catch (e) {
        console.error(`office-v2 part "${name}" failed`, e); // one broken part shouldn't take the room down
      }
    }

    // anisotropy needs tangents (or at least UVs): without them the shader produces NaNs
    group.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (!mm.isMesh) return;
      for (const mat of Array.isArray(mm.material) ? mm.material : [mm.material]) {
        const p = mat as THREE.MeshPhysicalMaterial;
        // a mirror-smooth clearcoat under the spots overflows half floats (black frames): floor it
        if (p.isMeshPhysicalMaterial && p.clearcoat > 0) p.clearcoatRoughness = Math.max(0.05, p.clearcoatRoughness);
        if (p.isMeshPhysicalMaterial && p.anisotropy > 0 && !mm.geometry.getAttribute('tangent')) {
          if (!mm.geometry.getAttribute('uv') || !mm.geometry.getAttribute('normal')) p.anisotropy = 0;
          else {
            try {
              if (mm.geometry.index) mm.geometry.computeTangents();
              else p.anisotropy = 0;
            } catch {
              p.anisotropy = 0;
            }
          }
        }
      }
    });
    let optimized: ReturnType<typeof batchStatic> | undefined;
    return {
      layout: scan,
      group,
      lights,
      optimize(opts) {
        if (!optimized && !q.has('nobatch')) optimized = batchStatic(group, [...shell.walls.map((w) => w.group), shell.ceiling], { mergeDynamic: !!opts?.static });
        return optimized;
      },
      walls: shell.walls,
      ceiling: [shell.ceiling],
      wallTop: CEILING,
      exposure: num('exp', 1.0),
      bloom: dbg.has('nobloom') ? undefined : { strength: 0.25, radius: 0.3, threshold: 4.5 },
      render: {
        toneMapping: ({ agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping } as Record<string, THREE.ToneMapping>)[dbg.get('tm') ?? 'neutral'],
        shadowType: dbg.get('shadow') === 'pcf' ? THREE.PCFShadowMap : THREE.VSMShadowMap,
        ao: { radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.15, samples: 16, intensity: 0.9, halfRes: !dbg.has('fullao') },
        envSize: 512,
        envBounces: 2,
        envNeutral: true,
      },
      walkable: (x, z) => insideRoom(x, z) && insideRoom(x + 0.2, z) && insideRoom(x - 0.2, z) && insideRoom(x, z + 0.2) && insideRoom(x, z - 0.2),
      camera: { orbit: [5.5, 6.5, 6], target: [0, 0.8, 0], walk: [-0.3, 1.6, -1.1], walkLook: [1.2, 1.3, 2.5] },
      environment: { center: [0.8, 1.2, 0.2], intensity: num('env', 1.0) },
      loadReference: async () => { throw new Error("Reference scan not distributed with this demo."); },
      referenceAvailable: false,
      referenceKind: 'scan',
      photos: [],
    };
}

export const officeV2: RoomModule = { id: 'office-v2', label: 'Office v2', build: () => buildDetailedOffice() };
