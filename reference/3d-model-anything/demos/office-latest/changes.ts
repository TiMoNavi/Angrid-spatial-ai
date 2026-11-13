import * as THREE from 'three';
import type { BuiltRoom } from '../../packages/room-runtime/types';

/** October 7 photograph-confirmed changes. Applied to a fresh v2 build before static batching.
 * Historical geometry and its materials are never mutated: modified materials are cloned.
 * Photo audit: data/captures/office-2026-10-07/hd/photo-audit.md.
 */
export async function applyOctoberChanges(room: BuiltRoom) {
  const root = room.group;
  updateOctoberPaint(room);
  const chair = root.getObjectByName('aeron-chair');
  if (chair) { chair.position.set(1.2275, 0, 0.7289); chair.rotation.y = 0.8; }
  // Reuse the historical rectified pattern; neutralize its old blue material tint/sheens.
  // This does not invent an unoccluded new photograph of the whole carpet.
  for (const name of ['rug-pile', 'rug-binding']) {
    const mesh = root.getObjectByName(name);
    if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshPhysicalMaterial) {
      const mat = mesh.material.clone();
      mat.color.set(name === 'rug-pile' ? '#d4d1ca' : '#292b2b');
      mat.sheenColor.set('#686661'); mat.sheen = 0.18; mat.envMapIntensity = 0.35;
      mesh.material = mat;
    }
  }
  const remove = (name: string) => {
    const o = root.getObjectByName(name);
    if (o) o.removeFromParent();
  };
  // Photos 20/44/100: the floor in front of the shelves has been cleared.
  remove('builtins-floor-clutter');
  // Photo 60 has a small angular equipment pouch; the old large round backpack is absent.
  root.getObjectByName('floor-pile')?.getObjectByName('backpack')?.removeFromParent();
  // Broad floor photo116 supersedes occluded110: Calendar and closed laptop remain.
  // The old open laptop shapes and Dell/TRMNL cartons are absent from this exposed floor.
  for (const name of ['dell-box', 'trmnl-box', 'lego-car', 'lego-brick', 'surface-laptop', 'macbook-pro']) remove(name);
  await updateEastFloor(room);

  // Photos 0/65/70/110: both studio lights are off, while ceiling pots and shelf lighting are on.
  // These studio lights were registered separately from the softbox group by its old builder.
  room.lights.traverse((o) => {
    if (!(o instanceof THREE.SpotLight || o instanceof THREE.PointLight)) return;
    if (o.position.y < 1.9 && o.position.z < 0.6) o.intensity = 0;
  });
  const softboxes = root.getObjectByName('softboxes');
  softboxes?.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const update = (old: THREE.Material) => {
      if (!['grid-face', 'blue-face', 'blue-rim', 'grid-wall', 'cob-lens'].includes(old.name)) return old;
      const mat = old.clone();
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.emissiveIntensity = 0;
        mat.emissiveMap = null;
        mat.color.set(mat.name === 'grid-wall' ? '#101112' : mat.name === 'grid-face' ? '#94958f' : '#dddcd4');
      } else if (mat instanceof THREE.MeshBasicMaterial) mat.color.set('#deded5');
      return mat;
    };
    o.material = Array.isArray(o.material) ? o.material.map(update) : update(o.material);
  });

  // Photos 44/80: taxidermy display has moved from the rug to the center cabinet top shelf.
  const birds = root.getObjectByName('pheasant');
  if (birds) {
    birds.position.set(0.91, 1.61, 2.96);
    birds.rotation.y = Math.PI / 2;
  }
  // Photo 70: helmet is on the ottoman, and the lounge chair carries an open shipping carton.
  const helmet = root.getObjectByName('motorcycle-helmet');
  if (helmet) {
    helmet.position.set(1.46, 0.38, -2.13);
    helmet.rotation.set(0, -0.4, 0);
  }
  for (const name of ['chrome-pillow', 'green-cap', 'black-cap']) remove(name);
  root.add(loungeCarton());
  // Photo 55 identifies the rear round device as a cord reel, not a second robot vacuum.
  remove('roomba-1');
  root.add(cordReel());

  // Photo 95 shows an empty ballhead on the beam, not the old suspended box camera.
  remove('ceiling-camera');
  const mount = new THREE.Group();
  mount.name = 'oct7-empty-camera-ballhead';
  const black = new THREE.MeshStandardMaterial({ color: '#161719', roughness: 0.5, metalness: 0.35 });
  const part = (g: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(g, black); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; mount.add(m);
  };
  part(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 24), 0.5, 1.955, 0.77);
  part(new THREE.CylinderGeometry(0.017, 0.017, 0.045, 16), 0.5, 1.925, 0.77);
  part(new THREE.SphereGeometry(0.026, 16, 12), 0.5, 1.89, 0.77);
  part(new THREE.CylinderGeometry(0.027, 0.027, 0.012, 16), 0.5, 1.856, 0.77);
  part(new THREE.BoxGeometry(0.025, 0.015, 0.015), 0.536, 1.892, 0.77);
  // Registered photo 110 mount-plate ray intersected with the beam underside y=1.968.
  mount.position.set(0.65, 0, 0.244);
  part(new THREE.BoxGeometry(0.028, 0.012, 0.11), 0.5, 1.958, 0.715);
  mount.userData.physics = { type: 'static' };
  root.add(mount);
  root.add(ceilingSpeakers());
}

function loungeCarton() {
  const group = new THREE.Group();
  group.name = 'oct7-open-carton-on-lounge';
  const brown = new THREE.MeshStandardMaterial({ color: '#a7804e', roughness: 0.94, side: THREE.DoubleSide });
  const inside = new THREE.MeshStandardMaterial({ color: '#b89764', roughness: 1, side: THREE.DoubleSide });
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, mat = brown) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; group.add(m); return m;
  };
  const W = 0.42, D = 0.33, H = 0.26, t = 0.004;
  add(W, t, D, 0, 0, 0, inside);
  add(W, H, t, 0, H / 2, -D / 2);
  add(W, H, t, 0, H / 2, D / 2);
  add(t, H, D, -W / 2, H / 2, 0);
  add(t, H, D, W / 2, H / 2, 0);
  // Four hinged flaps: the front flap hangs outside, rear and sides spread open.
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(0, H, s * D / 2);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(W, t, D * 0.53), brown);
    flap.position.z = s * D * 0.265; flap.castShadow = flap.receiveShadow = true;
    hinge.add(flap); hinge.rotation.x = s > 0 ? 1.08 : 0.3; group.add(hinge);
  }
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(s * W / 2, H, 0);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(W * 0.42, t, D), inside);
    flap.position.x = s * W * 0.21; flap.castShadow = flap.receiveShadow = true;
    hinge.add(flap); hinge.rotation.z = s * 0.42; group.add(hinge);
  }
  group.position.set(2.08, 0.42, -2.42);
  group.rotation.y = -0.4;
  group.userData.physics = { type: 'dynamic', mass: 0.7, shape: 'box' };
  return group;
}


function cordReel() {
  const g = new THREE.Group();
  g.name = 'oct7-illuminated-cord-reel';
  const gray = new THREE.MeshStandardMaterial({ color: '#999b9f', roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#343639', roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: '#e1e1dc', roughness: 0.55 });
  const blue = new THREE.MeshStandardMaterial({ color: '#328cfb', emissive: '#008fff', emissiveIntensity: 2, roughness: 0.45 });
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  };
  put(new THREE.CylinderGeometry(0.172, 0.164, 0.06, 48), dark, 0, 0.03, 0);
  put(new THREE.CylinderGeometry(0.178, 0.178, 0.014, 48), gray, 0, 0.067, 0);
  put(new THREE.CylinderGeometry(0.094, 0.094, 0.006, 40), dark, 0, 0.077, 0);
  const ring = new THREE.TorusGeometry(0.095, 0.004, 6, 48); ring.rotateX(Math.PI / 2);
  put(ring, blue, 0, 0.081, 0);
  put(new THREE.BoxGeometry(0.05, 0.036, 0.057), white, 0.02, 0.093, 0);
  for (const a of [0, 2.1, 4.2]) {
    const slot = put(new THREE.CapsuleGeometry(0.008, 0.052, 3, 8), dark, Math.cos(a) * 0.134, 0.075, Math.sin(a) * 0.134);
    slot.rotation.set(Math.PI / 2, 0, -a);
  }
  const orange = new THREE.MeshStandardMaterial({ color: '#e74d18', roughness: 0.54 });
  const points = [[0.015,0.115,0],[0.13,0.045,-0.07],[0.15,0.02,0.13],[-0.15,0.02,0.11],[-0.12,0.015,-0.18],[0.13,0.025,-0.24],[0.23,0.12,-0.44],[0.25,0.3,-0.59]];
  const cable = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))), 48, 0.006, 6);
  put(cable, orange, 0, 0, 0);
  g.position.set(2.62, 0, -1.91);
  g.userData.physics = { type: 'dynamic', mass: 2.5, shape: 'cylinder' };
  return g;
}


function ceilingSpeakers() {
  const group = new THREE.Group(); group.name = 'oct7-ceiling-speakers';
  const body = new THREE.MeshStandardMaterial({ color: '#25262a', roughness: 0.72 });
  const grille = new THREE.MeshStandardMaterial({ color: '#101113', roughness: 0.95 });
  const silver = new THREE.MeshStandardMaterial({ color: '#bcbec2', roughness: 0.4, metalness: 0.65 });
  const put = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  };
  // Photo 110: rays through the mount plates intersect the measured ceiling y=2.19.
  for (const [x,z,yaw] of [[0.297,-0.795,0.25],[2.122,-0.601,-0.18]]) {
    const g = new THREE.Group(); g.position.set(x,2.19,z); group.add(g);
    put(g,new THREE.CylinderGeometry(0.035,0.035,0.012,20),body,0,0,0);
    put(g,new THREE.CylinderGeometry(0.007,0.008,0.065,12),silver,0,-0.036,0);
    put(g,new THREE.SphereGeometry(0.016,12,8),body,0,-0.07,0);
    const cab = new THREE.Group(); cab.position.y=-0.19; cab.rotation.set(0.1,yaw,0); g.add(cab);
    put(cab,new THREE.BoxGeometry(0.155,0.225,0.135),body,0,0,0);
    put(cab,new THREE.BoxGeometry(0.14,0.211,0.007),grille,0,0,0.072);
    // Fine horizontal grille channels catch the overhead highlights without an emissive face.
    for(let i=0;i<37;i++) put(cab,new THREE.BoxGeometry(0.134,0.0007,0.001),body,0,-0.101+i*0.0055,0.076);
    put(cab,new THREE.BoxGeometry(0.02,0.006,0.0015),silver,0,-0.094,0.077);
    g.userData.physics={type:'static'};
  }
  return group;
}


function updateOctoberPaint(room: BuiltRoom) {
  // Source 20: this short wall is cream, not charcoal lit by the now-disabled low studio lamp.
  // Keep all trim and mounted frames intact; only the slab's paint slot is changed.
  const slab = room.walls[8]?.group.children.find(o => o.name === 'slab');
  if (slab instanceof THREE.Mesh && Array.isArray(slab.material)) {
    const first = slab.material[0].clone();
    if (first instanceof THREE.MeshStandardMaterial) first.color.set('#d8d4c8');
    slab.material = [first, ...slab.material.slice(1)];
  }
  const cache = new Map<THREE.Material, THREE.Material>();
  room.group.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const recolor = (mat: THREE.Material) => {
      if (!['cabinet-paint','cabinet-paint-mold','cabinet-paint-inside'].includes(mat.name)) return mat;
      if (cache.has(mat)) return cache.get(mat)!;
      const clone = mat.clone();
      if (clone instanceof THREE.MeshStandardMaterial) clone.color.set(mat.name === 'cabinet-paint-inside' ? '#353739' : '#414347');
      cache.set(mat,clone); return clone;
    };
    o.material = Array.isArray(o.material) ? o.material.map(recolor) : recolor(o.material);
  });
  // Crown strip only, identified by geometry height: leave yellow-green cubby/neon untouched.
  const glows = room.group.getObjectByName('builtins-cabinetry-glow');
  glows?.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshBasicMaterial)) return;
    o.geometry.computeBoundingBox();
    if (!o.geometry.boundingBox || o.geometry.boundingBox.min.y < 2.18) return;
    const mat = o.material.clone();
    if (mat.map) {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 128;
      const c = canvas.getContext('2d')!;
      const fade = c.createLinearGradient(0,128,0,0);
      fade.addColorStop(0,'rgba(255,241,217,1)');
      fade.addColorStop(.25,'rgba(255,241,217,.55)');
      fade.addColorStop(.6,'rgba(255,241,217,.15)');
      fade.addColorStop(1,'rgba(255,241,217,0)');
      c.fillStyle=fade; c.fillRect(0,0,32,128);
      mat.map = new THREE.CanvasTexture(canvas); mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.color.set('#ffffff'); mat.opacity=.2;
    } else mat.color.set('#eee5d7');
    o.material=mat;
  });
}


async function updateEastFloor(room: BuiltRoom) {
  const floor = room.group.getObjectByName('floor-pile');
  if (!floor) return;
  for (const name of ['parts-bag-1','parts-bag-2']) floor.getObjectByName(name)?.removeFromParent();
  const [calendarMap,displayMap] = await Promise.all(['calendar-top.jpg','floor-display.jpg'].map(n => new THREE.TextureLoader().loadAsync(`/textures/office-latest/${n}`)));
  for(const map of [calendarMap,displayMap]) { map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8; }
  // Centers/rays measured in photo116 at the object top plane; historical geometry preserved.
  const calendar = floor.getObjectByName('calendar-box');
  if (calendar) {
    calendar.position.set(2.126, .009, 1.048); calendar.rotation.y=-.732;
    calendar.scale.set(1.14,1.8,1.06);
    calendar.traverse(o => {
      if(o instanceof THREE.Mesh && !Array.isArray(o.material) && o.material.name==='calendarCover' && o.material instanceof THREE.MeshStandardMaterial) {
        const mat=o.material.clone();mat.map=calendarMap;mat.color.set('#dededb');mat.roughness=.87;
        if(mat instanceof THREE.MeshPhysicalMaterial) mat.clearcoat=0;
        o.material=mat;
      }
    });
  }
  const original = room.group.getObjectByName('desk-gear')?.getObjectByName('laptop-stickers');
  if (original) {
    const closed = original.clone(true); closed.name='oct7-closed-floor-laptop';
    closed.position.set(2.577,.012,1.175); closed.rotation.set(0,-1.263,0); floor.add(closed);
  }
  const prompter = floor.getObjectByName('prompter-bin');
  if (prompter) {
    // Photo116 separates the clear equipment bin from the hooded prompter on the right.
    const bin = new THREE.Group(); bin.name='oct7-clear-equipment-bin';
    for(const child of [...prompter.children]) {
      if(child instanceof THREE.Mesh && !Array.isArray(child.material) && child.material.name==='binClear') bin.add(child);
    }
    bin.traverse(o => { if(o instanceof THREE.Mesh && o.material instanceof THREE.MeshPhysicalMaterial) { const mat=o.material.clone();mat.opacity=.11;mat.color.set('#a6b5af');mat.clearcoat=0;mat.roughness=.38;o.material=mat; } });
    bin.position.set(2.521,.009,.308); bin.rotation.y=-.6; floor.add(bin);
    prompter.position.set(2.44,.009,.902); prompter.rotation.y=-.6;prompter.scale.set(.76,.6,.76);
    const rubber=new THREE.MeshStandardMaterial({color:'#16191b',roughness:.8});
    const steel=new THREE.MeshStandardMaterial({color:'#c6c9c8',metalness:.75,roughness:.35});
    // Visible collapsed articulated tripods and metal adapters within the clear bin.
    for(let i=0;i<4;i++) {
      const leg=new THREE.Group();leg.position.set(-.12+i*.073,.025,-.04+(i%2)*.075);leg.rotation.set(1.0,-.3+i*.4,1.05);
      for(let k=0;k<8;k++) {const bead=new THREE.Mesh(new THREE.SphereGeometry(.012,8,6),k%2?rubber:steel);bead.position.y=k*.024;bead.castShadow=true;leg.add(bead)}
      bin.add(leg);
    }
  }
  const device = new THREE.Group();device.name='oct7-white-floor-display';
  device.position.set(2.192,.022,.506);device.rotation.y=-.634;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(.274,.025,.195),new THREE.MeshStandardMaterial({color:'#e4e3d9',roughness:.55}));device.add(shell);
  // Actual observed display content, perspective-rectified from photo116.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.237,.157),new THREE.MeshBasicMaterial({map:displayMap,color:'#d9d9d9',toneMapped:false}));
  screen.rotation.x=-Math.PI/2;screen.position.y=.013;device.add(screen);
  floor.add(device);
}
