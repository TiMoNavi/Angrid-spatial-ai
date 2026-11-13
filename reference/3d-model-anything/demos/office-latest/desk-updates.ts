import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BuiltRoom } from '../../packages/room-runtime/types';

/** Current desk inventory from October photographs 65, 110 and 120. */
export async function updateDesk(room: BuiltRoom) {
  const root = room.group;
  const gear = root.getObjectByName('desk-gear')!;
  const remove = (name: string) => gear.getObjectByName(name)?.removeFromParent();
  for (const name of ['nalgene', 'dewalt-drill', 'waveshare-box', 'focusrite-2i2', 'trimmer',
    'laptop-black', 'laptop-dock', 'water-bottle', 'white-cup', 'hydroflask', 'vitamins',
    'walnut-stand', 'desk-papers', 'desk-cables']) remove(name);
  const loader = new THREE.TextureLoader();
  const [wide, tall, packaging] = await Promise.all(['monitor-wide.jpg','monitor-tall.jpg','frame-package.jpg'].map(n => loader.loadAsync(`/textures/office-latest/${n}`)));
  for (const map of [wide,tall,packaging]) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; }
  root.getObjectByName('desk-monitors')?.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const update = (old: THREE.Material) => {
      if (old instanceof THREE.MeshStandardMaterial && old.name === 'monRim') { const m=old.clone();m.color.set('#34383c');return m; }
      if (!(old instanceof THREE.MeshStandardMaterial) || !['screenWide','screenTall'].includes(old.name)) return old;
      const m = old.clone(); m.emissiveMap = old.name === 'screenWide' ? wide : tall; m.emissiveIntensity = 0.9; return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(update) : update(o.material);
  });
  root.getObjectByName('desk-keyboard')?.position.set(1.126,.828,-.046);
  root.getObjectByName('desk-mouse')?.position.set(1.376,.828,-.035);
  // Camera and its support moved left; keep their internal measured geometry together.
  for (const name of ['travel-tripod','sony-fx3']) { const o=root.getObjectByName(name); if(o) o.position.x-=.161; }
  const cameraCables=root.getObjectByName('camera-cables');if(cameraCables) cameraCables.position.x-=.161;
  const headphones=gear.getObjectByName('headphones');if(headphones) headphones.position.set(1.35,.826,-.22);
  const desk = new THREE.Group(); desk.name = 'october-desk-props'; root.add(desk);
  const Y = 0.826;
  const white = new THREE.MeshStandardMaterial({color:'#e9e6dd',roughness:.65});
  const black = new THREE.MeshPhysicalMaterial({color:'#111215',roughness:.42,clearcoat:.18,clearcoatRoughness:.2});
  const steel = new THREE.MeshStandardMaterial({color:'#b0b1b2',metalness:.8,roughness:.28});
  const navy = new THREE.MeshStandardMaterial({color:'#172b45',roughness:.48,metalness:.15});
  const add = (parent:THREE.Object3D, geo:THREE.BufferGeometry, mat:THREE.Material, x=0,y=0,z=0) => {
    const m = new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.castShadow=m.receiveShadow=true;parent.add(m);return m;
  };
  const rounded = (w:number,h:number,d:number,r=.003) => new RoundedBoxGeometry(w,h,d,2,r);
  const item = (name:string,x:number,z:number,y=Y) => {
    const g = new THREE.Group();g.name=name;g.position.set(x,y,z);g.userData.physics={type:'dynamic',mass:.4,shape:'box'};desk.add(g);return g;
  };
  // Two flat devices on a white packaging tray, seen at the front right in photo120.
  const tablets = item('oct7-tablets',1.846,.075);
  tablets.rotation.y=-.10;
  add(tablets,rounded(.34,.023,.255),white,0,.0115,0);
  add(tablets,rounded(.305,.004,.22),black,0,.025,0);
  add(tablets,rounded(.282,.011,.21),steel,-.024,.034,-.024);
  add(tablets,rounded(.276,.003,.204),black,-.024,.041,-.024);
  const covered = add(tablets,rounded(.255,.008,.186),black,-.045,.049,-.045); covered.rotation.y=.08;
  // The gray rear of a small display lies beside it, with a circular kickstand.
  const display = item('oct7-display-back',1.59,-.06);
  display.rotation.y=.1;
  const gray = new THREE.MeshStandardMaterial({color:'#b5b8ac',roughness:.66});
  add(display,rounded(.235,.012,.185),gray,0,.007,0);
  add(display,new THREE.CylinderGeometry(.039,.041,.008,40),gray,.026,.017,.003);
  add(display,rounded(.037,.014,.08,.002),gray,.026,.019,-.026).rotation.z=.18;
  // Shallow white plate/charging dish: raised rim and recessed center, no solid cylinder silhouette.
  const plate = item('oct7-white-dish',1.811,-.244);
  add(plate,new THREE.LatheGeometry([[0,.003],[.074,.003],[.09,.009],[.096,.016],[.095,.019],[.088,.02],[.077,.009],[0,.008]].map(p=>new THREE.Vector2(...p as [number,number])),64),white);
  const pack = item('oct7-frame-retail-box',1.905,-.497);
  pack.rotation.y=-.06;
  add(pack,rounded(.19,.054,.27,.003),white,0,.027,0);
  const lid = add(pack,new THREE.PlaneGeometry(.187,.266),new THREE.MeshStandardMaterial({map:packaging,color:'#adadad',roughness:1,envMapIntensity:.3}),0,.0545,0);lid.rotation.x=-Math.PI/2;
  // Navy insulated tumbler with rolled stainless base/rim and dark clear lid.
  remove('syntax-tumbler');
  const cup = item('oct7-navy-tumbler',1.158,.134);
  add(cup,new THREE.LatheGeometry([[0,0],[.03,0],[.032,.012],[.038,.165],[.037,.171],[.033,.171],[.029,.02],[0,.02]].map(p=>new THREE.Vector2(...p as [number,number])),48),navy);
  add(cup,new THREE.CylinderGeometry(.033,.031,.013,48),steel,0,.009,0);
  add(cup,new THREE.TorusGeometry(.036,.003,8,48),steel,0,.17,0).rotation.x=Math.PI/2;
  add(cup,new THREE.CylinderGeometry(.033,.033,.004,48),new THREE.MeshPhysicalMaterial({color:'#343c41',roughness:.2,clearcoat:.6,clearcoatRoughness:.1}),0,.17,0);
  add(cup,rounded(.024,.004,.009,.002),black,.007,.173,0);
  // Separate narrow camera post behind the portrait screen (110/121).
  const post=item('oct7-rear-camera-post',.724,-.633);
  add(post,new THREE.CylinderGeometry(.01,.012,.815,20),black,0,.4075,0);
  add(post,new THREE.CylinderGeometry(.024,.021,.025,20),black,0,.833,0);
  add(post,new THREE.SphereGeometry(.021,20,12),black,0,.858,0);
  add(post,rounded(.066,.014,.034),black,0,.883,0);
  add(post,new THREE.CylinderGeometry(.01,.01,.02,14),steel,.023,.852,0).rotation.z=Math.PI/2;
  // Same detailed small travel tripod, now a second empty one at the keyboard's left.
  const oldTripod = root.getObjectByName('travel-tripod');
  if(oldTripod){const t=oldTripod.clone(true);t.name='oct7-empty-mini-tripod';t.position.set(.701,Y,-.041);t.scale.setScalar(.75);desk.add(t);}
  // Compact desk phone clamp visible directly in front of the camera tripod (photo120).
  const phone = item('oct7-phone-holder',1.531,-.229);
  const olive = new THREE.MeshStandardMaterial({color:'#626951',roughness:.8});
  add(phone,new THREE.CylinderGeometry(.037,.042,.009,40),olive,0,.0045,0);
  add(phone,new THREE.CylinderGeometry(.01,.013,.12,16),black,0,.07,0);
  add(phone,new THREE.SphereGeometry(.015,16,12),black,0,.139,0);
  add(phone,rounded(.059,.074,.018),black,0,.173,0).rotation.x=-.15;
  for (const x of [-.035,.035]) add(phone,rounded(.009,.07,.027),black,x,.173,.003);
  // Yellow USB lead loops over the gray display then runs to the desk camera.
  const cableMat=new THREE.MeshStandardMaterial({color:'#f8c918',roughness:.48});
  const pts=[[1.72,Y+.004,-.54],[1.79,Y+.08,-.39],[1.7,Y+.02,-.23],[1.45,Y+.03,-.05],[1.45,Y+.035,.08],[1.69,Y+.04,.095],[1.79,Y+.055,-.06],[1.64,Y+.03,-.12],[1.59,Y+.025,-.055]];
  const wire=add(desk,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),100,.0035,8),cableMat);wire.userData.physics={type:'none'};
  const cord=add(desk,new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[1.96,Y+.02,.06],[2.04,Y,.11],[2.05,.55,.13],[2.11,.2,.12],[2.32,.018,.03]].map(p=>new THREE.Vector3(...p))),50,.0025,6),white);cord.userData.physics={type:'none'};
}
