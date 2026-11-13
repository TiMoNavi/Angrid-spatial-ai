import * as THREE from 'three';
import type { BuiltRoom } from '../../packages/room-runtime/types';

export function updateRoom(room: BuiltRoom) {
  // The old studio rig used polished metal. Today's photos show much softer satin
  // finishes. Clone shared materials so this correction cannot change Office v2.
  const metals = new Map<THREE.Material, THREE.Material>();
  const satinMetal = (original: THREE.Material): THREE.Material => {
    if (!(original instanceof THREE.MeshStandardMaterial)
      || original.metalness < 0.5 || original.transparent
      || original === room.environment.mirror) return original;
    const cached = metals.get(original);
    if (cached) return cached;
    const material = original.clone();
    // Roughness maps multiply the scalar; the inherited dark maps made even
    // nominally brushed aluminium behave like polished chrome.
    material.roughnessMap = null;
    material.roughness = Math.max(original.roughness, 0.65);
    material.envMapIntensity = Math.min(original.envMapIntensity, 0.35);
    if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoat = 0;
    metals.set(original, material);
    return material;
  };
  room.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(satinMetal) : satinMetal(object.material);
  });
  // Current neutral paint under daylight, compared in photos20/35/70/110.
  for (const [i,wall] of room.walls.entries()) {
    if (i===8) continue;
    const slab=wall.group.children.find(o=>o.name==='slab');
    if(slab instanceof THREE.Mesh && Array.isArray(slab.material)) {
      const paint=slab.material[0].clone();
      if(paint instanceof THREE.MeshStandardMaterial) paint.color.set('#4a4e53');
      slab.material=[paint,...slab.material.slice(1)];
    }
  }
  const gray=new THREE.MeshStandardMaterial({color:'#41454a',roughness:.93});
  // The desk-facing fascia of the cross beam is charcoal; its reverse remains white (20/110).
  for(const [x0,x1,z] of [[-.51,1.65,.618],[1.65,2.88,.598]]) {
    const face=new THREE.Mesh(new THREE.PlaneGeometry(x1-x0,.23),gray);
    face.position.set((x0+x1)/2,2.085,z);face.rotation.y=Math.PI;
    face.receiveShadow=true;face.name='oct7-charcoal-beam-fascia';room.ceiling[0].add(face);
  }
  // Beam mount size from photo110; scale about the mounting plate rather than room origin.
  const mount=room.group.getObjectByName('oct7-empty-camera-ballhead');
  if(mount){mount.scale.setScalar(.72);mount.position.set(1.15-.5*.72,1.96-1.96*.72,1.014-.77*.72);}
  // Shelf-mounted display and ceiling fixtures must hide with their supporting surfaces
  // in Dollhouse mode; otherwise cutaway leaves them floating in midair.
  const bird=room.group.getObjectByName('pheasant');if(bird)room.walls[2].group.attach(bird);
  for(const name of ['oct7-empty-camera-ballhead','oct7-ceiling-speakers']) {
    const obj=room.group.getObjectByName(name);if(obj)room.ceiling[0].attach(obj);
  }
  // Current trash-can footprint from the unobstructed entrance photograph29.
  room.group.getObjectByName('wing-floor')?.getObjectByName('trash-can')?.position.set(-1.09,0,-1.02);
  // Jacket is hanging on the wall today; the ottoman carries a gray loose cloth and helmet.
  room.group.getObjectByName('github-varsity-jacket')?.traverse(o=>{
    if(!(o instanceof THREE.Mesh))return;
    const remap=(old:THREE.Material)=>{const m=old.clone();if(m instanceof THREE.MeshStandardMaterial){m.color.set('#565657');m.roughness=.98;if(m instanceof THREE.MeshPhysicalMaterial){m.sheenColor.set('#555');m.clearcoat=0;}}return m;};
    o.material=Array.isArray(o.material)?o.material.map(remap):remap(o.material);
  });
}
