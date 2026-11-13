import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BuiltRoom } from '../../packages/room-runtime/types';

type V3 = [number, number, number];
const Y = .826;
const rounded = (w: number, h: number, d: number, r = .003) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - .0001, h / 2 - .0001, d / 2 - .0001));
function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function wire(parent: THREE.Object3D, points: V3[], mat: THREE.Material, radius = .0025) {
  const mesh = put(parent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), Math.max(32, points.length * 8), radius, 8), mat);
  mesh.userData.physics = { type: 'none' }; return mesh;
}
function box(parent: THREE.Object3D, mat: THREE.Material, size: V3, at: V3, radius = .003) { return put(parent, rounded(...size, radius), mat, ...at); }
function omitTriangles(geometry:THREE.BufferGeometry, omit:(p:THREE.BufferAttribute,i:number)=>boolean) {
  const source=geometry.index?geometry.toNonIndexed():geometry;
  const p=source.getAttribute('position') as THREE.BufferAttribute, keep:number[]=[];
  for(let i=0;i<p.count;i+=3)if(!omit(p,i))keep.push(i,i+1,i+2);
  const out=new THREE.BufferGeometry();
  for(const [name,attr] of Object.entries(source.attributes) as [string,THREE.BufferAttribute][]) {
    const data=new Float32Array(keep.length*attr.itemSize);
    keep.forEach((v,i)=>{for(let c=0;c<attr.itemSize;c++)data[i*attr.itemSize+c]=attr.array[v*attr.itemSize+c];});
    out.setAttribute(name,new THREE.BufferAttribute(data,attr.itemSize));
  }
  return out;
}

/** October 9 photo audit: 22–30, 37–39, 67–81 and 119–121.
 * Photo rays are intersected with the measured .826m desktop in the registered v2 frame.
 * Historical item builders stay untouched; all retained meshes keep their original detail.
 */
export async function updateDesk(room: BuiltRoom): Promise<void> {
  const root = room.group;
  const gear = root.getObjectByName('desk-gear');
  const remove = (name: string) => (gear?.getObjectByName(name) ?? root.getObjectByName(name))?.removeFromParent();
  remove('october-desk-props');
  for (const name of ['spray-can', 'headphones', 'hdmi-switch', 'samsung-t7', 'clear-case', 'scissors', 'cap-trucker', 'cap-syntax', 'camera-cables']) remove(name);
  // The October 9 scan puts the ends of the same slab 7 cm east of the historical frame.
  // These named roots are siblings: the first desk is under-table equipment, the other HD furniture.
  const desks: THREE.Object3D[] = [];
  root.traverse(o => { if (o.name === 'desk') desks.push(o); });
  for (const desk of desks) desk.position.x += .07;
  // The loose NEEWER rod and cube no longer lie along the back edge in 67–71.
  for(const desk of desks) for(const child of desk.children) {
    if(!(child instanceof THREE.Mesh)||!['desk:frame','desk:steel'].includes(child.name))continue;
    child.geometry=omitTriangles(child.geometry,(p,i)=>[i,i+1,i+2].every(v=>p.getY(v)>.8&&p.getY(v)<.88&&p.getX(v)>.61&&p.getX(v)<1.21&&p.getZ(v)>-.79&&p.getZ(v)<-.6));
  }
  for(const desk of desks) if(desk.children.some(c=>c.name==='desk:frame')) {
    for(const child of [...desk.children]) if(['desk:plasticBlack','desk:mat'].includes(child.name))child.removeFromParent();
  }
  const position = (name: string, p: V3, yaw?: number) => {
    const o = root.getObjectByName(name); if (!o) return;
    // Items of the HD desk have a shifted parent; their local positions compensate that shift.
    o.position.set(...p);
    if (o.parent && desks.includes(o.parent)) o.position.x -= .07;
    if (yaw !== undefined) o.rotation.y = yaw;
    return o;
  };
  position('desk-keyboard', [1.225, Y + .003, -.064], .012);
  position('desk-mouse', [1.515, Y + .002, -.105], Math.PI + .40);
  position('lacie-rugged', [1.885, Y, -.641], -.20);
  position('travel-tripod', [1.679, Y, -.365], .2);
  const camera = position('sony-fx3', [1.675, Y + .402, -.365], -.25);
  camera?.traverse(o => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    if (o.material.name==='camBody') { const m=o.material.clone();m.color.set('#222526');m.roughness=.63;m.normalScale.set(.55,.55);o.material=m; }
    if (['lensBody','lensGlass','rubber','redAnod'].includes(o.material.name)) {
      const geo=o.geometry.clone(),p=geo.getAttribute('position');
      for(let i=0;i<p.count;i++) if(p.getZ(i)>.028)p.setZ(i,.028+(p.getZ(i)-.028)*.61);
      geo.computeVertexNormals();o.geometry=geo;
    }
  });
  position('airpods', [.88, Y, -.43], .15);
  const chair = position('aeron-chair', [1.231, 0, .891], 1.485);
  if (chair) chair.userData.reference = 'Office v4 measured chair footprint; photos 38, 79 and 121';
  chair?.traverse(o=>{
    if(!(o instanceof THREE.Mesh)||!(o.material instanceof THREE.MeshPhysicalMaterial))return;
    const old=o.material;
    if(!['pellicleBack','pellicleSeat','polishedAlu'].includes(old.name))return;
    const m=old.clone();m.onBeforeCompile=old.onBeforeCompile;m.customProgramCacheKey=old.customProgramCacheKey;
    if(old.name==='polishedAlu')m.roughness=.15;
    else {
      for(const key of ['map','normalMap','roughnessMap'] as const) if(m[key]) {m[key]=m[key]!.clone();m[key]!.repeat.x*=1.3;}
      m.normalScale.multiplyScalar(.64);m.specularIntensity=.5;
    }
    o.material=m;
  });
  root.getObjectByName('desk-keyboard')?.traverse(o=>{
    if(!(o instanceof THREE.Mesh)||!(o.material instanceof THREE.MeshStandardMaterial))return;
    const m=o.material.clone();
    if(m.name==='kbKeys'){m.color.set('#9da09d');m.roughness=.84;}
    if(m.name==='kbAlu')m.color.set('#969b9d');
    o.material=m;
  });
  const micBoom=root.getObjectByName('desk-mic-boom');
  if(micBoom) {
    const A=new THREE.Vector3(.31,.91,.09),B=new THREE.Vector3(.4,1.38,.17),C=new THREE.Vector3(.58,.935,.25);
    const a=A.clone(),b=new THREE.Vector3(.345,1.38,-.185),c=new THREE.Vector3(.40,.935,.22);
    const segments=[[A,B,a,b],[B,C,b,c]].map(([p,q,P,Q])=>{
      const d=q.clone().sub(p),D=Q.clone().sub(P),length=d.length();d.normalize();
      return {p,P,D,d,length,rotation:new THREE.Quaternion().setFromUnitVectors(d,D.clone().normalize())};
    });
    micBoom.traverse(o=>{
      if(!(o instanceof THREE.Mesh)||Array.isArray(o.material))return;
      if(o.material.name==='redCable'){o.visible=false;return;}
      const geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone(),p=geo.getAttribute('position');
      // Repose complete connected pieces, so a spring or cage ring never stretches
      // across two articulation transforms at a triangle boundary.
      const count=p.count/3,parents=Array.from({length:count},(_,i)=>i),owner=new Map<string,number>();
      const find=(i:number):number=>parents[i]===i?i:(parents[i]=find(parents[i]));
      for(let i=0;i<p.count;i++) {
        const tri=Math.floor(i/3),key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
        const other=owner.get(key);if(other===undefined)owner.set(key,tri);else parents[find(tri)]=find(other);
      }
      const parts=new Map<number,number[]>();
      for(let i=0;i<p.count;i++){const k=find(Math.floor(i/3));if(!parts.has(k))parts.set(k,[]);parts.get(k)!.push(i);}
      const discard=new Set<number>();
      for(const ids of parts.values()) {
        const centre=new THREE.Vector3();ids.forEach(i=>centre.add(new THREE.Vector3().fromBufferAttribute(p,i)));centre.multiplyScalar(1/ids.length);
        // The historical bent connector uses the old end pose. Its replacement is
        // the short round connector rebuilt below, terminating at the current yoke.
        if(o.material.name==='steel'&&centre.x>.5&&centre.y<1.04) {
          ids.forEach(i=>discard.add(i));continue;
        }
        const microphone=o.material.name.startsWith('mic')||(centre.x>.58&&centre.y<1.00);
        const fixed=centre.y<.91&&centre.x<.45;
        const s=segments.map(s=>{const t=THREE.MathUtils.clamp(centre.clone().sub(s.p).dot(s.d)/s.length,0,1);return {s,d:centre.distanceToSquared(s.p.clone().addScaledVector(s.d,t*s.length))};}).sort((a,b)=>a.d-b.d)[0].s;
        for(const i of ids) {
          const v=new THREE.Vector3().fromBufferAttribute(p,i);
          if(microphone)v.add(new THREE.Vector3(-.289,0,-.031));
          else if(!fixed) {
            const t=v.clone().sub(s.p).dot(s.d)/s.length,off=v.clone().sub(s.p).addScaledVector(s.d,-t*s.length);
            v.copy(s.P).addScaledVector(s.D,t).add(off.applyQuaternion(s.rotation));
          }
          p.setXYZ(i,v.x,v.y,v.z);
        }
      }
      const result=discard.size?omitTriangles(geo,(_p,i)=>discard.has(i)):geo;
      result.computeVertexNormals();o.geometry=result;
    });
  }

  const loader = new THREE.TextureLoader();
  const [wide, tall, keys, lid, hp, weave, rear, endGrain, desktop, braid, rackUpper, rackLower, liveEdge] = await Promise.all([
    '/office-v4/desk/monitor-wide.jpg', '/office-v4/desk/monitor-tall.jpg', '/office-v4/desk/stream-deck.jpg',
    '/office-v4/desk/elgato-lid.jpg', '/office-v4/desk/headphone-pattern.jpg', '/textures/office-v2/desk-gear-nylon_nor.jpg', '/office-v4/desk/monitor-rear-stickers.jpg', '/office-v4/desk/end-grain-v4.jpg', '/office-v4/desk/desk-top-v4.jpg', '/office-v4/desk/braided-sleeve.jpg', '/office-v4/desk/rack-upper-face.jpg', '/office-v4/desk/rack-lower-face.jpg', '/office-v4/desk/desk-live-edge-v4.jpg',
  ].map(path => loader.loadAsync(path)));
  for (const map of [wide, tall, keys, lid, hp, rear, endGrain, desktop, braid, rackUpper, rackLower, liveEdge]) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; }
  braid.wrapS=braid.wrapT=THREE.RepeatWrapping;braid.repeat.set(8,1);
  hp.wrapS=THREE.RepeatWrapping; hp.repeat.set(4,1);
  const slab = root.getObjectByName('desk-slab');
  if (slab instanceof THREE.Mesh && Array.isArray(slab.material)) {
    slab.material=slab.material.map(original=>{
      if(!(original instanceof THREE.MeshStandardMaterial))return original;
      const m=original.clone();
      if(m.name==='walnutTop'){m.map=desktop;m.color.set('#c6beb4');m.normalScale.set(.10,.10);m.roughnessMap=null;m.roughness=.56;}
      if(m.name==='walnutLive'){m.map=liveEdge;m.color.set('#c4b8a8');m.normalScale.set(.13,.13);m.roughness=.64;}
      if(m.name==='walnutEnd'){m.color.set('#d9c7b6');m.normalScale.set(.085,.085);m.roughness=.64;}
      return m;
    });
    slab.material.push(new THREE.MeshPhysicalMaterial({name:'v4-walnut-east-end',map:endGrain,roughness:.65,clearcoat:.18}));
    const geo=slab.geometry.clone(),p=geo.getAttribute('position'),uv=geo.getAttribute('uv');
    for(const g of geo.groups) if(g.materialIndex===2) {
      const first=geo.index?.getX(g.start)??g.start;
      if(p.getX(first)<1.9)continue;
      g.materialIndex=4;
      for(let j=g.start;j<g.start+g.count;j++) {const i=geo.index?.getX(j)??j;uv.setXY(i,(.17-p.getZ(i))/1.035,(p.getY(i)-.773)/.052);}
    }
    slab.geometry=geo;
  }
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping; weave.repeat.set(3, 3);
  root.getObjectByName('desk-monitors')?.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const replace = (old: THREE.Material) => {
      if (!(old instanceof THREE.MeshStandardMaterial)) return old;
      if (['monShell', 'monShellStickers'].includes(old.name)) {
        const m = old.clone(); m.color.set(old.name === 'monShellStickers' ? '#b5b8b8' : '#787c7f');
        if (old.name === 'monShellStickers') m.map = rear;
        m.roughness = .65; m.normalScale.set(.085,.085);
        if (m instanceof THREE.MeshPhysicalMaterial) { m.clearcoat = .08; m.metalness = .15; }
        return m;
      }
      if (!['screenWide', 'screenTall'].includes(old.name)) return old;
      const m = old.clone(); m.emissiveMap = old.name === 'screenWide' ? wide : tall; m.emissiveIntensity = .9; return m;
    };
    o.material = Array.isArray(o.material) ? o.material.map(replace) : replace(o.material);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (['armBlack', 'plasticBlack', 'steel', 'rubber'].includes(mat.name)) {
      const original=o.geometry.index?o.geometry.toNonIndexed():o.geometry;
      const p=original.getAttribute('position'), keep:number[]=[];
      for(let i=0;i<p.count;i+=3) {
        const xs=[p.getX(i),p.getX(i+1),p.getX(i+2)], ys=[p.getY(i),p.getY(i+1),p.getY(i+2)], zs=[p.getZ(i),p.getZ(i+1),p.getZ(i+2)];
        const lo=Math.min(...ys),hi=Math.max(...ys);
        const inArm=Math.min(...xs)>.5 && Math.max(...xs)<1.315 && Math.min(...zs)>-.75 && Math.max(...zs)<-.2;
        const oldLower=inArm && lo>.90 && hi<1.105;
        const oldRiser=inArm && Math.max(...xs)<.83 && Math.min(...zs)>-.43 && lo>.9 && lo<1.01 && hi<1.24;
        if(!oldLower&&!oldRiser)keep.push(i,i+1,i+2);
      }
      const geo=new THREE.BufferGeometry();
      for(const [name,attribute] of Object.entries(original.attributes) as [string, THREE.BufferAttribute][]) {
        const out=new Float32Array(keep.length*attribute.itemSize);
        keep.forEach((v,i)=>{for(let c=0;c<attribute.itemSize;c++)out[i*attribute.itemSize+c]=attribute.array[v*attribute.itemSize+c];});
        geo.setAttribute(name,new THREE.BufferAttribute(out,attribute.itemSize));
      }
      const points=geo.getAttribute('position');
      // The free vertical post is visibly lower/narrower in photo28, with its original slim cap.
      for(let i=0;i<points.count;i++) {
        const x=points.getX(i),y=points.getY(i),z=points.getZ(i);
        if(x>1.395 && x<1.505 && z>-.58 && z<-.46 && y>.83) {
          const r=mat.name==='rubber'&&y>1.65?.52:1;
          points.setXYZ(i,1.335+(x-1.45)*r,Y+(y-Y)*.90,-.54+(z+.52)*r);
        }
      }
      geo.computeVertexNormals();o.geometry=geo;
    }
    if (mat.name==='moonHalo') {
      const geo=o.geometry.clone(),p=geo.getAttribute('position'),n=geo.getAttribute('normal');
      for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)+n.getX(i)*.006,p.getY(i)+n.getY(i)*.006,p.getZ(i)+n.getZ(i)*.006);
      o.geometry=geo;
    }
  });
  const group = new THREE.Group(); group.name = 'office-v4-desk-props'; root.add(group);
  const black = new THREE.MeshPhysicalMaterial({ name: 'v4-desk-black', color: '#15171a', roughness: .48, clearcoat: .14, clearcoatRoughness: .25 });
  const rubber = new THREE.MeshStandardMaterial({ name: 'v4-desk-rubber', color: '#0c0d0f', roughness: .86 });
  const cable = new THREE.MeshStandardMaterial({ name: 'v4-desk-cable', color: '#141518', roughness: .56 });
  const grayCord = new THREE.MeshStandardMaterial({ name: 'v4-desk-gray-cord', color: '#575a5d', roughness: .52 });
  const white = new THREE.MeshStandardMaterial({ name: 'v4-desk-white', color: '#e3e3d9', roughness: .52 });
  const aluminum = new THREE.MeshStandardMaterial({ name: 'v4-desk-aluminum', color: '#b6b8b4', metalness: .8, roughness: .32 });
  const fabric = new THREE.MeshStandardMaterial({ name: 'v4-desk-nylon', color: '#222427', roughness: .89, normalMap: weave, normalScale: new THREE.Vector2(.3, .3) });
  const yellow = new THREE.MeshStandardMaterial({ name: 'v4-desk-yellow-lead', color: '#f3c617', roughness: .58 });
  const orange = new THREE.MeshStandardMaterial({ name: 'v4-desk-orange-lead', color: '#ee682f', roughness: .63 });
  wire(group,[[.43,.735,.275],[.447,.842,.286],[.47,.948,.22],[.44,1.16,.05],[.415,1.40,-.185],[.40,1.16,-.03],[.38,.91,.09],[.34,.82,.13],[.34,.36,.19],[.38,.014,.12]],new THREE.MeshStandardMaterial({color:'#ab1524',roughness:.6}),.0032);
  wire(group,[[.47,.935,.22],[.46,.912,.24],[.446,.899,.257]],black,.005);
  const rack=new THREE.Group();rack.name='v4-underdesk-power-rack';rack.position.set(1.83,.705,.025);rack.scale.x=.9;rack.userData.physics={type:'static'};group.add(rack);
  box(rack,black,[.466,.045,.19],[0,.011,0],.002);
  box(rack,black,[.226,.035,.175],[.112,-.034,.001],.002);
  for(const x of [-.24,.24])box(rack,black,[.014,.111,.203],[x,-.012,-.005],.001);
  for(const y of [.044,-.064])box(rack,black,[.49,.009,.195],[0,y,-.01],.001);
  put(rack,new THREE.PlaneGeometry(.448,.035),new THREE.MeshStandardMaterial({map:rackUpper,roughness:.68}),0,.011,.0953);
  put(rack,new THREE.PlaneGeometry(.212,.027),new THREE.MeshStandardMaterial({map:rackLower,roughness:.7}),.112,-.034,.089);
  for(const x of [-.235,.235])for(const y of [.024,-.035]){
    const screw=put(rack,new THREE.CylinderGeometry(.0032,.0032,.002,16),aluminum,x,y,.099);screw.rotation.x=Math.PI/2;
  }
  for(const [x,y,c] of [[-.14,.012,'#82b431'],[.159,.012,'#d65157'],[.178,-.034,'#38a0ce']] as [number,number,string][])put(rack,new THREE.CircleGeometry(.0024,16),new THREE.MeshBasicMaterial({color:c,toneMapped:false}),x,y,.1005);
  if(camera) {
    // Fill the optical stack across the full lens opening. The inherited spherical
    // cap covered only its centre, leaving the body visible through the barrel.
    put(camera,new THREE.CircleGeometry(.032,64),new THREE.MeshPhysicalMaterial({name:'v4-lens-coating',color:'#10141f',metalness:.25,roughness:.055,clearcoat:1}),.012,.041,.0982);
    put(camera,new THREE.RingGeometry(.021,.032,64),rubber,.012,.041,.0985);
    put(camera,new THREE.CircleGeometry(.009,40),new THREE.MeshStandardMaterial({color:'#030406',roughness:.16}),.012,.041,.0988);
    const ring=put(camera,new THREE.RingGeometry(.0238,.0245,64),new THREE.MeshStandardMaterial({color:'#343c41',metalness:.55,roughness:.29}),.012,.041,.0987);
    ring.name='v4-lens-inner-retainer';
    box(camera,black,[.026,.005,.018],[0,.0805,-.012],.001);
    for(const x of [-.038,.037])put(camera,new THREE.CylinderGeometry(.006,.006,.004,20),black,x,.082,-.012);
    const gripMat=new THREE.MeshStandardMaterial({color:'#0d1012',roughness:.84,normalMap:weave,normalScale:new THREE.Vector2(.5,.5)});
    box(camera,gripMat,[.03,.061,.024],[-.052,.039,.030],.006);
    for(const y of [.029,.039,.049])box(camera,black,[.006,.005,.002],[.051,y,.020],.001);
  }
  const mouse=root.getObjectByName('desk-mouse');
  const shell=mouse?.getObjectByName('desk-mouse:mouseShell');
  if(mouse && shell instanceof THREE.Mesh) {
    const probe=new THREE.Mesh(shell.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    const ray=new THREE.Raycaster();
    const surface=(x:number,z:number)=>{ray.set(new THREE.Vector3(x,.2,z),new THREE.Vector3(0,-1,0));return ray.intersectObject(probe,false)[0]?.point.y??.02;};
    const detail=(points:[number,number][])=>wire(mouse,points.map(([x,z])=>[x,surface(x,z)+.0005,z]),rubber,.00065);
    for(const side of [-1,1])detail([[side*.003,.013],[side*.011,.016],[side*.020,.024],[side*.022,.040],[side*.014,.052]]);
    detail([[0,.048],[0,.051],[0,.054]]);
    mouse.getObjectByName('desk-mouse:steel')?.removeFromParent();
    const wheelY=surface(0,.034)-.0055;
    const wheel=put(mouse,new THREE.CylinderGeometry(.009,.009,.0078,36),aluminum,0,wheelY,.034);wheel.rotation.z=Math.PI/2;
    for(let i=0;i<24;i++){
      const a=i/24*Math.PI*2;const groove=box(mouse,rubber,[.0081,.0003,.0005],[0,wheelY+Math.cos(a)*.0091,.034+Math.sin(a)*.0091],.0001);groove.rotation.x=a;
    }
    // The pronounced low thumb rest is a separate moulding below the curved click shell.
    const rest=put(mouse,new THREE.SphereGeometry(1,32,14),rubber,.032,.006,-.009);rest.scale.set(.019,.005,.036);
  }
  // Photos80–81 resolve a four-column lifting frame, with a pair of columns at
  // either end. The previous two-column frame cannot match the exposed side view.
  const oldFrame = root.getObjectByName('desk-slab-frame');
  const oldPowder = oldFrame?.getObjectByName('desk-frame:powder');
  const powder = oldPowder instanceof THREE.Mesh && oldPowder.material instanceof THREE.Material ? oldPowder.material.clone() : black.clone();
  powder.name = 'v4-desk-powder';
  if (oldFrame) for (const child of [...oldFrame.children]) {
    if (child.name.startsWith('desk-frame:') && !['desk-frame:cable', 'desk-frame:deskDisplay'].includes(child.name)) child.removeFromParent();
  }
  const frame = new THREE.Group(); frame.name = 'v4-four-column-frame'; frame.userData.physics = { type: 'static' }; group.add(frame);
  for (const x of [.42, 2.05]) {
    const shape = new THREE.Shape([[-.401,0],[.401,0],[.413,.008],[.407,.02],[.305,.034],[-.305,.034],[-.407,.02],[-.413,.008]].map(p => new THREE.Vector2(...p as [number,number])));
    const foot = new THREE.ExtrudeGeometry(shape,{depth:.073,bevelEnabled:true,bevelThickness:.002,bevelSize:.002,bevelSegments:2});foot.translate(0,0,-.0365);foot.rotateY(Math.PI/2);
    put(frame,foot,powder,x,.014,-.35);
    for(const z of [-.69,-.01]) put(frame,new THREE.CylinderGeometry(.021,.022,.011,24),rubber,x,.008,z);
    for(const z of [-.59,-.115]) {
      for(const [w,d,y0,y1] of [[.074,.104,.045,.392],[.068,.096,.382,.587],[.061,.087,.577,.74]]) {
        box(frame,powder,[w,y1-y0,d],[x,(y1+y0)/2,z],.0025);
        box(frame,rubber,[w+.0025,.008,d+.0025],[x,y1-.002,z],.0018);
      }
      box(frame,powder,[.081,.009,.118],[x,.047,z],.002);
      box(frame,black,[.078,.033,.119],[x,.744,z],.005);
    }
    // Mid-height side brace, upper C-channel and countersunk bolts on the outer web.
    box(frame,powder,[.066,.086,.478],[x,.387,-.352],.002);
    box(frame,powder,[.094,.045,.901],[x,.746,-.345],.003);
    box(frame,powder,[.10,.004,.905],[x,.771,-.345],.001);
    for(const z of [-.635,-.563,-.16,-.088]) {
      const bolt=put(frame,new THREE.SphereGeometry(.005,14,8),black,x+(x>1?.049:-.049),.749,z);bolt.scale.set(.3,1,1);
    }
  }
  for(const z of [-.59,-.115]) box(frame,powder,[1.56,.043,.065],[1.235,.72,z],.003);
  box(frame,black,[.19,.036,.085],[1.37,.676,-.35],.006);
  // Preserve the original luminous numeric display and restore its keyed handset housing.
  box(frame,black,[.13,.022,.055],[1.97,.761,.121],.007);
  for(let k=0;k<4;k++) { const b=put(frame,new THREE.CylinderGeometry(.005,.005,.003,12),rubber,1.975+k*.014,.761,.149);b.rotation.x=Math.PI/2; }
  const item = (name: string, x: number, z: number, y = Y, yaw = 0) => {
    const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); g.rotation.y = yaw; g.userData.physics = { type: 'dynamic', mass: .3, shape: 'box' }; group.add(g); return g;
  };
  // Photo67: the portrait gas-spring arm routes behind the landscape panel. The old
  // forward elbow crossed its front face. Preserve the old VESA plate and upper monitor arm.
  const arm=item('v4-portrait-gas-spring-arm',0,0,0);arm.userData.physics={type:'static'};
  const beam=(a:V3,b:V3,w:number,h:number,mat:THREE.Material=black)=>{
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b);
    const m=put(arm,rounded(w,h,A.distanceTo(B),.008),mat);
    m.position.copy(A.clone().add(B).multiplyScalar(.5));m.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(B,A,new THREE.Vector3(0,1,0)));return m;
  };
  const base:V3=[1.34,.975,-.58],elbow:V3=[1.078,1.03,-.774],head:V3=[.751,1.194,-.355];
  beam(base,[elbow[0],.975,elbow[2]],.058,.038);
  beam([1.34,.995,-.58],[elbow[0],.995,elbow[2]],.052,.007,grayCord);
  put(arm,new THREE.CylinderGeometry(.037,.037,.116,32),black,...elbow);
  put(arm,new THREE.CylinderGeometry(.023,.023,.008,24),rubber,elbow[0],1.092,elbow[2]);
  beam([elbow[0],1.064,elbow[2]],head,.054,.076);
  beam([elbow[0],1.1,elbow[2]],[head[0],head[1]+.036,head[2]],.047,.005,grayCord);
  put(arm,new THREE.CylinderGeometry(.023,.023,.079,28),black,...head);
  beam(head,[.716,1.202,-.320],.037,.042);
  // Black side plates and silver pivot screws, matched to the visible machined construction.
  for(const pt of [[1.07,1.065,-.763],[.78,1.183,-.391]] as V3[]) {
    for(const dx of [-.028,.028]) {
      const screw=put(arm,new THREE.CylinderGeometry(.004,.004,.003,16),aluminum,pt[0]+dx,pt[1],pt[2]);screw.rotation.z=Math.PI/2;
    }
  }
  // The formerly flat stickered MacBook is upright in a two-cheek walnut cradle.
  const laptop = position('laptop-stickers', [1.555, Y + .123, -.680]);
  if (laptop) laptop.rotation.set(Math.PI / 2, 0, .04);
  const walnut = new THREE.MeshStandardMaterial({ color: '#67432d', roughness: .62 });
  const walnutSlab = root.getObjectByName('desk-slab');
  if (walnutSlab instanceof THREE.Mesh && Array.isArray(walnutSlab.material)) {
    const original = walnutSlab.material[0];
    if (original instanceof THREE.MeshStandardMaterial && original.map) { walnut.map = original.map; walnut.color.set('#958376'); }
  }
  const cradle = item('v4-laptop-walnut-cradle', 1.555, -.680, Y, .04);
  box(cradle, walnut, [.17, .016, .09], [0, .008, 0], .004);
  for (const z of [-.022, .022]) {
    box(cradle, walnut, [.158, .066, .022], [0, .043, z], .004);
    box(cradle, rubber, [.145, .054, .002], [0, .045, z + (z < 0 ? .012 : -.012)], .0005);
  }
  // Closed silver device lying behind the keyboard: rounded alloy rim, inset face, USB edge.
  const device = item('v4-silver-desktop-device', 1.32, -.247, Y, -.02);
  box(device, aluminum, [.113, .017, .073], [0, .0085, 0], .008);
  box(device, new THREE.MeshStandardMaterial({ color: '#777e78', roughness: .64 }), [.097, .0014, .057], [0, .0175, 0], .004);
  box(device, white, [.093, .0008, .045], [0, .0184, -.002], .002);
  box(device, black, [.012, .004, .002], [.034, .009, .037], .001);
  box(device, aluminum, [.008, .003, .001], [.034, .009, .038], .0007);
  // Small observed olive printed part: broad circular foot and tapering square, open throat.
  const olive = new THREE.MeshStandardMaterial({ color: '#424c31', roughness: .88 });
  const funnel = item('v4-olive-printed-part', 1.625, .083);
  const rings: [number, number, number][] = [[.051, .001, 0], [.054, .004, 0], [.05, .007, 0], [.023, .028, 1], [.019, .028, 1], [.019, .006, 1]];
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = []; const N = 64;
  for (const [radius, y, square] of rings) for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, co = Math.cos(a), si = Math.sin(a);
    const r = radius / (1 - square + square * Math.max(Math.abs(co), Math.abs(si)));
    vertices.push(co * r, y, si * r); uvs.push(i / N, y / .03);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
  const funnelGeo = new THREE.BufferGeometry(); funnelGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); funnelGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); funnelGeo.setIndex(indices); funnelGeo.computeVertexNormals();
  olive.side = THREE.DoubleSide; put(funnel, funnelGeo, olive);
  put(funnel, new THREE.CircleGeometry(.051, 64), olive, 0, .001, 0).rotation.x = -Math.PI / 2;
  // White wedge-supported Stream Deck with the photographed artwork on fifteen raised keys.
  const deck = item('v4-stream-deck', 1.155, -.451, Y, .05);
  const face = new THREE.Group(); face.position.set(0, .044, .006); face.rotation.x = -.7; deck.add(face);
  box(face, white, [.121, .084, .016], [0, 0, 0], .006);
  box(face, black, [.112, .075, .003], [0, 0, .009], .004);
  const deckKeyMaterial=new THREE.MeshStandardMaterial({map:keys,emissive:'#ffffff',emissiveMap:keys,emissiveIntensity:.3,roughness:.43});
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const x = (col - 2) * .021, y = (1 - row) * .023;
    box(face, black, [.019, .020, .004], [x, y, .013], .003);
    const plane=new THREE.PlaneGeometry(.016,.017),uv=plane.getAttribute('uv');
    for(let i=0;i<uv.count;i++)uv.setXY(i,(uv.getX(i)+col)/5,(uv.getY(i)+2-row)/3);
    put(face,plane,deckKeyMaterial,x,y,.0151);
  }
  const wedge = new THREE.Shape([new THREE.Vector2(.04, 0), new THREE.Vector2(-.03, 0), new THREE.Vector2(.04, .062)]);
  const wedgeGeo = new THREE.ExtrudeGeometry(wedge, { depth: .102, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 2 }); wedgeGeo.rotateY(Math.PI / 2); wedgeGeo.translate(-.051, 0, 0); put(deck, wedgeGeo, white);
  // Narrow black zip pouch and the separate folded phone/camera clamp beside it (22/120).
  const pouch = item('v4-small-zip-pouch', .72, -.015, Y, -.10);
  box(pouch, fabric, [.17, .068, .094], [0, .034, 0], .018);
  box(pouch, rubber, [.171, .003, .095], [0, .03, 0], .014);
  const pull = box(pouch, aluminum, [.006, .002, .019], [.078, .03, .046], .002); pull.rotation.y = .25;
  box(pouch, white, [.019, .005, .0004], [.055, .051, .0457], .0002);
  const clamp = item('v4-folded-clamp', .833, -.063, Y, .14);
  box(clamp, black, [.036, .010, .10], [0, .005, 0], .004);
  box(clamp, rubber, [.023, .007, .054], [0, .013, .010], .003);
  put(clamp, new THREE.CylinderGeometry(.016, .016, .03, 28), black, 0, .024, -.03).rotation.z = Math.PI / 2;
  for (const x of [-.021, .021]) box(clamp, black, [.007, .026, .021], [x, .026, -.015], .002);
  // Open Elgato clamshell case: preserve a genuinely empty lid with visible zipper and cable bay.
  remove('elgato-case');
  const caseG = item('v4-open-elgato-case', .492, -.096, Y, .10);
  box(caseG, fabric, [.239, .039, .169], [0, .0195, 0], .023);
  box(caseG, rubber, [.222, .003, .151], [0, .04, 0], .019);
  const lidHinge = new THREE.Group(); lidHinge.position.set(0, .041, -.073); lidHinge.rotation.x = -.25; caseG.add(lidHinge);
  box(lidHinge, fabric, [.238, .018, .165], [0, .014, .073], .015);
  put(lidHinge, new THREE.PlaneGeometry(.178, .139), new THREE.MeshStandardMaterial({ map: lid, roughness: .92 }), 0, .024, .073).rotation.x = -Math.PI / 2;
  for (let k = 0; k < 2; k++) {
    const points: V3[] = [];
    for (let j = 0; j <= 48; j++) { const a = j / 48 * Math.PI * 4; points.push([Math.cos(a) * .06 + k * .012, .046, Math.sin(a) * .043]); }
    wire(caseG, points, k ? white : cable, .0018);
  }
  box(caseG, aluminum, [.01, .003, .016], [.113, .038, .057], .002);
  // Current cables, traced as distinct plug-to-device runs from the exposed tabletop.
  wire(group, [[1.66,Y+.11,-.68],[1.7,Y+.045,-.59],[1.8,Y+.014,-.46],[1.79,Y+.006,-.29],[1.63,Y+.005,-.23],[1.4,Y+.009,-.245],[1.27,Y+.009,-.28],[1.31,Y+.01,-.39],[1.43,Y+.01,-.39],[1.46,Y+.008,-.33],[1.34,Y+.008,-.30],[1.29,Y+.009,-.35],[1.37,Y+.01,-.395],[1.45,Y+.012,-.36]], yellow, .0032);
  for (const dx of [0, .007]) wire(group, [[1.72+dx,1.295,-.402],[1.75+dx,1.29,-.43],[1.8+dx,1.16,-.43],[1.78+dx,.99,-.36],[1.7+dx,Y+.03,-.25],[1.56+dx,Y+.009,-.26],[1.42+dx,Y+.011,-.31],[1.38+dx,Y+.04,-.48]], grayCord, .0028);
  wire(group, [[1.51,Y+.01,-.14],[1.50,Y+.01,-.26],[1.42,Y+.009,-.33],[1.25,Y+.008,-.35],[1.05,Y+.005,-.29],[.94,Y+.006,-.24],[.96,Y+.006,-.18],[1.11,Y+.006,-.18],[1.14,Y+.006,-.29],[1.06,Y+.006,-.35],[.98,Y+.006,-.29],[1.14,Y+.004,-.31],[1.27,Y+.012,-.48]], cable, .0021);
  wire(group, [[.88,Y+.009,-.43],[.92,Y+.006,-.40],[1.06,Y+.006,-.41],[1.21,Y+.006,-.38],[1.29,Y+.012,-.46]], white, .0016);
  wire(group, [[1.32,Y+.018,-.28],[1.31,Y+.007,-.32],[1.16,Y+.005,-.36],[1.10,Y+.005,-.31],[1.19,Y+.005,-.29],[1.27,Y+.005,-.37]], cable, .0018);
  wire(group, [[1.90,Y+.009,-.705],[2.03,Y+.004,-.58],[2.04,Y+.004,-.44],[1.91,Y+.004,-.46],[1.9,Y+.004,-.52],[2.005,Y+.004,-.54],[2.055,Y+.005,-.50]], orange, .0027);
  const usb = item('v4-orange-usb-end', 2.055, -.50, Y, -.6); box(usb, orange, [.012,.007,.025], [0,.005,0], .002); box(usb, aluminum, [.008,.003,.007], [0,.005,.016], .001);
  // Rear draped bundles reach the floor behind the frame, matching the cleared floor in 69/71.
  for (let k = 0; k < 4; k++) wire(group, [[1.3+k*.038,Y+.009,-.57],[1.45+k*.04,Y+.007,-.73],[1.5+k*.04,Y-.012,-.887],[1.52+k*.04,.54,-.90],[1.49+k*.06,.22,-.87],[1.55+k*.07,.017,-.64],[1.67+k*.045,.015,-.47]], cable, .0025);
  // Braided sleeving runs around the east leg, with a black/white patterned headset hanging below.
  const sleeve = new THREE.MeshStandardMaterial({ color: '#aaaeb3', map:braid, roughness: .85, normalMap: weave, normalScale: new THREE.Vector2(.7,.7) });
  wire(group, [[2.075,.66,-.72],[2.10,.50,-.66],[2.10,.48,-.3],[2.1,.53,.08]], sleeve, .012);
  const headphones = item('v4-hanging-headphones', 2.117, .064, .555, Math.PI / 2);headphones.scale.setScalar(.82);
  const arc: V3[] = []; for(let j=0;j<=32;j++){const a=j/32*Math.PI;arc.push([Math.cos(a)*.075,Math.sin(a)*.085,0]);}
  wire(headphones, arc, fabric, .009);
  const pad = new THREE.MeshStandardMaterial({ map: hp, roughness: .87 });
  for(const s of [-1,1]) {
    const ear = put(headphones,new THREE.SphereGeometry(1,32,20),black,s*.071,-.025,0); ear.scale.set(.025,.059,.044);
    const ring = put(headphones,new THREE.TorusGeometry(.035,.012,12,36),pad,s*.05,-.025,0);ring.rotation.y=Math.PI/2;ring.scale.set(1,1.35,1);
    box(headphones, aluminum, [.008,.028,.012],[s*.076,.035,0],.002);
  }
  wire(group,[[2.12,.51,.07],[2.1,.33,.13],[2.09,.018,.17],[1.99,.012,.36],[1.86,.012,.49]],cable,.002);
  // Adhesive three-slot cord keeper on the exposed east end grain (80), including parked USB plug.
  const keeper = item('v4-desk-edge-cord-keeper', 2.141, .054, .801, Math.PI/2);
  box(keeper,rubber,[.064,.018,.007],[0,0,0],.007);
  for(const x of [-.02,0,.02]) put(keeper,new THREE.CircleGeometry(.004,16),black,x,0,.004);
  box(keeper,yellow,[.012,.009,.008],[.007,.006,.005],.003);
  const connector=box(keeper,aluminum,[.009,.027,.006],[.007,.024,.004],.002);connector.rotation.z=-.18;
}
