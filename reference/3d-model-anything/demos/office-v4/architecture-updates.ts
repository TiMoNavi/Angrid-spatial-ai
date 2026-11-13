import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, boxSpan, boxUV, sweep } from '../../packages/room-runtime/helpers';
import type { BuiltRoom } from '../../packages/room-runtime/types';

const V = (p: number[]) => new THREE.Vector3(...p);
function frame(position: number[], direction: number[], roll = 0) {
  const o = new THREE.Object3D(); o.position.copy(V(position)); o.lookAt(o.position.clone().add(V(direction).normalize()));
  o.rotateZ(roll); o.updateMatrix(); return o.matrix.clone();
}
const baseboard: [number, number][] = [[0,0],[.013,0],[.013,.088],[.0127,.094],[.0118,.099],[.0102,.1035],[.0082,.1075],[.006,.1105],[.0036,.1128],[.0015,.1142],[0,.1148]];

/** V4 photos84–89: the detected north-wall “window” is an acoustic panel.
 * The jog is real. Mesh/photo89 painted wall samples put its back at z≈-3.00;
 * RoomPlan's -3.06 plane lies ~6 cm behind that measured surface. Keep it solid. */
function alcove(room: BuiltRoom) {
  const wall = room.walls[5], oldSlab = wall.group.getObjectByName('slab') as THREE.Mesh;
  if (!oldSlab) return;
  const paint = (Array.isArray(oldSlab.material) ? oldSlab.material[0] : oldSlab.material).clone();
  const trimMesh = wall.group.getObjectByName('trim') as THREE.Mesh;
  const trim = (Array.isArray(trimMesh.material) ? trimMesh.material[0] : trimMesh.material).clone();
  oldSlab.removeFromParent(); trimMesh.removeFromParent();
  const x0 = .8284, jog = 1.557, x1 = 2.8773, front = -2.90, back = -3.005;
  const body = new THREE.Group(); body.name = 'oct9-solid-acoustic-alcove';
  body.add(boxSpan([x0,0,front-.15],[jog,2.2,front],paint));
  body.add(boxSpan([jog,0,back-.15],[x1+.15,2.2,back],paint));
  body.add(boxSpan([jog-.015,0,back],[jog,2.2,front],paint));
  const profile = new THREE.Mesh(sweep(baseboard,[V([x1,0,back]),V([jog,0,back]),V([jog,0,front]),V([x0,0,front])],V([0,1,0])),trim);
  profile.name = 'oct9-alcove-colonial-baseboard'; profile.castShadow = profile.receiveShadow = true; body.add(profile);
  wall.group.add(body);
  const panel = wall.group.getObjectByName('acoustic-panel-5-1.23');
  if (panel) { panel.position.z += back - (-2.9184); panel.position.x=2.25; panel.position.y=1.1425; panel.scale.y=1.274/1.24; }
  // The print and coat remain on the front pier; move that existing detailed work by 18 mm.
  for (const child of wall.group.children) if (child !== body && child !== panel) child.position.z += front - (-2.9184);
  const east = room.walls[0];
  east.group.add(boxSpan([x1,0,back-.01],[x1+.15,2.2,-2.9184],paint));
  const returnTrim = new THREE.Mesh(sweep(baseboard,[V([x1,0,back]),V([x1,0,-2.9184])],V([0,1,0])),trim);
  returnTrim.castShadow = returnTrim.receiveShadow = true; east.group.add(returnTrim);
  const floor = room.group.getObjectByName('floor') as THREE.Mesh;
  if (floor) {
    const fill = boxSpan([jog,-.018,back],[x1,0,-2.9184],floor.material as THREE.Material);
    fill.name = 'oct9-alcove-floor-extension'; fill.castShadow = false; room.group.add(fill);
  }
  const ceiling = room.ceiling[0];
  const ceilingMat = (ceiling.children.find(o => o instanceof THREE.Mesh) as THREE.Mesh)?.material;
  if (ceilingMat && !Array.isArray(ceilingMat)) {
    const fill=boxSpan([jog,1.97,back],[x1,2.21,-2.9184],ceilingMat); fill.castShadow=false; ceiling.add(fill);
  }
  body.userData.evidence='V4 photos84–89; mesh wall-plane samples z=-3.003/-3.002; no window opening';
}

/** Photos64–68/118: charcoal felt continues across the sloped beam cover and
 * a 61cm ceiling rectangle. Registered photo66 corners meet y=2.19 at
 * x=.81/1.42,z=-.33; the far edge runs behind the beam's acoustic wedge. */
function ceilingTreatment(room:BuiltRoom){
  const reference=room.group.getObjectByName('bass-trap-0');
  if(!(reference instanceof THREE.Mesh)||!(reference.material instanceof THREE.MeshPhysicalMaterial))return;
  const felt=reference.material.clone();felt.name='oct9-charcoal-ceiling-felt';felt.color.set('#343c46');felt.normalScale.set(.9,.9);felt.sheen=.32;
  reference.material=felt;
  const ceiling=room.ceiling[0];
  const oldFascia:THREE.Object3D[]=[];ceiling.traverse(o=>{if(o.name==='oct7-charcoal-beam-fascia')oldFascia.push(o);});oldFascia.forEach(o=>o.removeFromParent());
  const cover=new THREE.Group();cover.name='oct9-ceiling-felt-treatment';ceiling.add(cover);
  const panelGeo=boxUV(new RoundedBoxGeometry(.61,.009,.96,3,.0014));
  const panel=new THREE.Mesh(panelGeo,felt);panel.name='oct9-ceiling-felt-panel';panel.position.set(1.116,2.1945,.153);panel.castShadow=panel.receiveShadow=true;cover.add(panel);
  // Raw mesh face samples run z≈.60 at y=2.02 to z≈.45 at y=2.19.
  // The solid white structural beam remains intact behind this felt-lined wedge.
  for(const [x0,x1,z] of [[-.51,1.65,.619],[1.65,2.88,.599]]){
    const section=new THREE.Shape();section.moveTo(-z,1.969);section.lineTo(-z,2.2);section.lineTo(-(z-.17),2.2);section.closePath();
    const geometry=new THREE.ExtrudeGeometry(section,{depth:x1-x0,bevelEnabled:false,curveSegments:1});geometry.rotateY(Math.PI/2);geometry.translate(x0,0,0);boxUV(geometry);
    const mesh=new THREE.Mesh(geometry,felt);mesh.name='oct9-sloped-felt-beam-cover';mesh.castShadow=mesh.receiveShadow=true;cover.add(mesh);
  }
  cover.userData.evidence='Ceiling corners photo66/68, plane y2.19; sloped felt beam mesh/photos64–68/118';
  // Photo66 resolves the nearby wafers independently of the felt rectangle.
  // Move the complete trim/lens/halo with its corresponding downward light.
  const pots=[[.82,.07,.73236,.11090],[2.11,.07,1.97111,.12460]];
  for(const name of ['pot-trims','pot-lenses']){
    const mesh=ceiling.getObjectByName(name);if(!(mesh instanceof THREE.Mesh))continue;
    const geometry=mesh.geometry.clone(),p=geometry.getAttribute('position');
    for(let i=0;i<p.count;i++)for(const [x,z,nx,nz] of pots){
      if(p.getY(i)>2.18&&Math.hypot(p.getX(i)-x,p.getZ(i)-z)<.09){p.setX(i,p.getX(i)+nx-x);p.setZ(i,p.getZ(i)+nz-z);break;}
    }
    geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.geometry=geometry;
  }
  ceiling.traverse(o=>{
    if(!(o instanceof THREE.Mesh)||!(o.material instanceof THREE.MeshBasicMaterial)||o.material.blending!==THREE.AdditiveBlending)return;
    for(const [x,z,nx,nz] of pots)if(Math.abs(o.position.x-x)<.001&&Math.abs(o.position.z-z)<.001){o.position.x=nx;o.position.z=nz;break;}
  });
  room.lights.traverse(o=>{
    if(!(o instanceof THREE.SpotLight)||o.position.y<2.15)return;
    for(const [x,z,nx,nz] of pots)if(Math.abs(o.position.x-x)<.001&&Math.abs(o.position.z-z)<.001){
      if(o.target.parent!==o){o.target.position.x+=nx-x;o.target.position.z+=nz-z;}
      o.position.x=nx;o.position.z=nz;break;
    }
  });
}

/** Keep complete triangles and all their UVs when separating the old floor support
 * from the detailed light head. These are fresh geometries; historic rooms are untouched. */
function selectTriangles(source: THREE.BufferGeometry, keep: (center: THREE.Vector3) => boolean) {
  const input=source.index?source.toNonIndexed():source;
  const p=input.getAttribute('position'), selected:number[]=[];
  for(let i=0;i<p.count;i+=3){
    const c=new THREE.Vector3();for(let j=0;j<3;j++)c.add(new THREE.Vector3().fromBufferAttribute(p,i+j));c.multiplyScalar(1/3);
    if(keep(c))selected.push(i,i+1,i+2);
  }
  const result=new THREE.BufferGeometry();
  for(const [name,a] of Object.entries(input.attributes)){
    const values=new Float32Array(selected.length*a.itemSize);
    selected.forEach((src,dst)=>{for(let k=0;k<a.itemSize;k++)values[dst*a.itemSize+k]=(a.array as ArrayLike<number>)[src*a.itemSize+k];});
    result.setAttribute(name,new THREE.BufferAttribute(values,a.itemSize));
  }
  result.computeBoundingBox();result.computeBoundingSphere();return result;
}

function clothDisc(radius:number, sides:number){
  const g=new THREE.BufferGeometry(), pos:number[]=[], uv:number[]=[], idx:number[]=[];
  const radial=32, angular=sides*12;
  for(let j=0;j<=radial;j++)for(let i=0;i<=angular;i++){
    const a=i/angular*Math.PI*2, t=j/radial;
    const sector=Math.PI*2/sides, local=((a+sector/2)%sector)-sector/2;
    const edge=radius*Math.cos(Math.PI/sides)/Math.cos(local),r=edge*t;
    // Tension folds gather at the sewn binding; the broad diffuser remains taut.
    const fold=.0013*Math.sin(a*7+t*11)*t*t+.0038*Math.sin(a*sides*2+t*19)*Math.pow(t,7)+.0015*Math.cos(a*31-t*26)*Math.pow(t,10);
    pos.push(Math.cos(a)*r,Math.sin(a)*r,-.012+fold);uv.push(.5+Math.cos(a)*t*.5,.5+Math.sin(a)*t*.5);
    if(i<angular&&j<radial){const k=j*(angular+1)+i;idx.push(k,k+angular+1,k+1,k+1,k+angular+1,k+angular+2);}
  }
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}

/** Current cloth lattice: 32mm cells, soft bowed webbing seen in30/31/120. */
function currentGrid(){
  const radius=.40612*.955,cell=.032,pos:number[]=[],uv:number[]=[],extent=Math.ceil(radius/cell);
  const inside=(x:number,y:number)=>{const a=Math.atan2(y,x),sector=Math.PI*2/16,local=((a+Math.PI*2+sector/2)%sector)-sector/2;return Math.hypot(x,y)*Math.cos(local)<radius*Math.cos(Math.PI/16);};
  for(let family=0;family<2;family++)for(let k=-extent;k<=extent;k++)for(let j=-extent;j<extent;j++)for(let q=0;q<7;q++){
    const end=(t:number)=>{const along=(j+t)*cell,cross=k*cell+.0014*Math.sin(Math.PI*t)*Math.sin(k*1.71+j*.7);return family?[cross,along]:[along,cross];};
    const a=end(q/7),b=end((q+1)/7);if(!inside(a[0],a[1])||!inside(b[0],b[1]))continue;
    const za=.034-.009*Math.sin(Math.PI*q/7)+.003*Math.sin(k*.8+j*1.6),zb=.034-.009*Math.sin(Math.PI*(q+1)/7)+.003*Math.sin(k*.8+j*1.6);
    pos.push(a[0],a[1],-.011,b[0],b[1],-.011,a[0],a[1],za,b[0],b[1],-.011,b[0],b[1],zb,a[0],a[1],za);uv.push(0,0,1,0,0,1,1,0,1,1,0,1);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();return geo;
}

/** Coated nylon gores sag between the supporting ribs. Photo72 also shows narrow
 * tension creases across each gore, rather than an uninterrupted molded bowl. */
function wrinkledGridShell(){
  const sides=16,depth=.29,radius=.40612,nt=64,np=24,pos:number[]=[],uv:number[]=[],idx:number[]=[];
  for(let k=0;k<sides;k++){
    const base=pos.length/3,a=(k+.5)/sides*Math.PI*2,b=(k+1.5)/sides*Math.PI*2;
    for(let i=0;i<=nt;i++)for(let j=0;j<=np;j++){
      const t=i/nt,f=j/np,r=(.085+(.45-.085)*Math.sqrt(t))*(1-(1-radius/.45)*t);
      const x=r*THREE.MathUtils.lerp(Math.cos(a),Math.cos(b),f),y=r*THREE.MathUtils.lerp(Math.sin(a),Math.sin(b),f);
      const edge=Math.sin(Math.PI*f),long=Math.pow(Math.sin(Math.PI*t),.65);
      const sag=.0105*edge*Math.pow(Math.sin(Math.PI*Math.min(1,t*1.15)),.6);
      const phase=k*1.37;
      const crease=.0017*edge*long*(Math.sin(t*42+f*5+Math.sin(f*9)*.8+phase)*.68+Math.sin(t*73-f*10+phase*.5)*.32);
      const diagonal=.0011*edge*long*Math.sin(f*17-t*23+phase);
      const length=Math.hypot(x,y),scale=(length-sag+crease+diagonal)/length;
      pos.push(x*scale,y*scale,-depth*(1-t));
      uv.push(k%2?1-f:f,t);
      if(i<nt&&j<np){const n=base+i*(np+1)+j;idx.push(n,n+1,n+np+1,n+1,n+np+2,n+np+1);}
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(idx);geometry.computeVertexNormals();
  return geometry;
}

function lights(room:BuiltRoom, diffuser:THREE.Texture, diffuserNormal:THREE.Texture, nylon:THREE.Texture, nylonNormal:THREE.Texture){
  const neewer=room.group.getObjectByName('neewer-softbox-stand');
  const grid=room.group.getObjectByName('grid-softbox-stand');
  const oldN=new THREE.Vector3(1,-.1,.03).normalize();
  const oldNF=new THREE.Vector3(-.679,1.491,.046).addScaledVector(oldN,.315);
  const oldNFrame=frame(oldNF.toArray(),oldN.toArray()), invN=oldNFrame.clone().invert();
  // Two-view rim fit44/46: 5.3mm radial RMS. Hub61/62 triangulation differs 0.1mm.
  const newNF=[-.419,1.413,.040],newND=[.93573,-.25884,.23960];
  const newNFrame=frame(newNF,newND);
  if(neewer){
    const targetPole=new THREE.Vector3(-.860,0,-.074), oldPole=new THREE.Vector3(-.826,0,.0416);
    const shift=targetPole.clone().sub(oldPole);
    neewer.position.set(0,0,0); // discard Oct7's independently measured .30m move
    const parts:THREE.Mesh[]=[];neewer.traverse(o=>{if(o instanceof THREE.Mesh)parts.push(o);});
    parts.forEach(o=>{
      if(!(o instanceof THREE.Mesh)||Array.isArray(o.material))return;
      const name=o.material.name;
      if(name==='blue-rim'){o.removeFromParent();return;}
      if(name==='blue-face'){
        o.geometry=clothDisc(.3188*.98,12).applyMatrix4(newNFrame);
        const mat=o.material.clone();if(mat instanceof THREE.MeshStandardMaterial){mat.color.set('#f3f2e9');mat.map=diffuser;mat.normalMap=diffuserNormal;mat.normalScale.set(.6,.6);mat.roughness=.96;mat.emissiveIntensity=0;mat.emissiveMap=null;}o.material=mat;return;
      }
      const g=o.geometry.clone(),p=g.getAttribute('position');
      for(let i=0;i<p.count;i++){
        const pt=new THREE.Vector3().fromBufferAttribute(p,i);
        if(pt.y>1.1&&name!=='stand-alu'){
          pt.applyMatrix4(invN);
          if(['softbox-fabric','softbox-silver','softbox-piping','rubber','blue-rim'].includes(name)){
            const taper=THREE.MathUtils.clamp((pt.z+.27)/.27,0,1);const scale=1-(1-.3188/.33)*taper;pt.x*=scale;pt.y*=scale;
          }
          pt.applyMatrix4(newNFrame);
        }else pt.add(shift);
        p.setXYZ(i,pt.x,pt.y,pt.z);
      }
      g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();o.geometry=g;
    });
    neewer.name='neewer-softbox-stand';neewer.userData.october9Pose='Rim fit44/46; stand hub triangulated61/62 (-.860,.371,-.074)';
  }
  const newGF=[1.81197,1.76047,-.60759],newGD=[-.45399,-.152953,.87778];
  const oldGFrame=frame([1.93,1.68,-.86],[-.62,-.2,.76]);
  const invG=oldGFrame.clone().invert(),newGFrame=frame(newGF,newGD,Math.PI);
  if(grid){
    for(const o of [...grid.children]){
      if(!(o instanceof THREE.Mesh)||Array.isArray(o.material))continue;
      const name=o.material.name;
      if(name==='stand-alu'){o.removeFromParent();continue;}
      if(name==='softbox-fabric'||name==='softbox-silver'){
        const shell=wrinkledGridShell().toNonIndexed().applyMatrix4(newGFrame);
        if(name==='softbox-fabric'){
          const binding=selectTriangles(o.geometry,c=>c.applyMatrix4(invG).z>-.004),p=binding.getAttribute('position');
          for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(invG);v.x*=.40612/.45;v.y*=.40612/.45;v.applyMatrix4(newGFrame);p.setXYZ(i,v.x,v.y,v.z);}
          binding.computeVertexNormals();o.geometry=mergeGeometries([shell,binding],false)!;
          const mat=o.material.clone();if(mat instanceof THREE.MeshPhysicalMaterial){mat.map=nylon;mat.normalMap=nylonNormal;mat.normalScale.set(.9,.9);mat.color.set('#191c20');mat.roughness=.59;mat.sheen=.38;mat.sheenRoughness=.45;}o.material=mat;
        }else o.geometry=shell;
        continue;
      }
      if(name==='grid-wall'){o.geometry=currentGrid().rotateZ(.24).applyMatrix4(newGFrame);continue;}
      if(name==='grid-face'){o.geometry=clothDisc(.40612*.96,16).applyMatrix4(newGFrame);const mat=o.material.clone();if(mat instanceof THREE.MeshStandardMaterial){mat.color.set('#c4c3b2');mat.emissiveIntensity=0;mat.emissiveMap=null;}o.material=mat;continue;}
      const geometry=selectTriangles(o.geometry,c=>name==='stand-knob'?c.y>1.51:name==='rubber'?c.y>1.2:true);
      if(!geometry.getAttribute('position').count){o.removeFromParent();continue;}
      const p=geometry.getAttribute('position');
      for(let i=0;i<p.count;i++){
        const pt=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(invG);
        if(['softbox-fabric','softbox-silver','softbox-piping','rubber','grid-face','grid-wall'].includes(name)){
          const taper=THREE.MathUtils.clamp((pt.z+.34)/.34,0,1),scale=1-(1-.40612/.45)*taper;pt.x*=scale;pt.y*=scale;
        }
        // Side photo72 resolves the current 29cm bowl depth; keep the Amaran body unscaled.
        pt.z = pt.z > -.34 ? pt.z * (.29/.34) : pt.z + .05;
        pt.applyMatrix4(newGFrame);p.setXYZ(i,pt.x,pt.y,pt.z);
      }
      geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();o.geometry=geometry;
    }
    grid.name='grid-softbox-wall-boom';grid.userData.physics={type:'static'};
    grid.userData.october9Pose='Rim36/72/120 reprojection fit (7.5px RMS); inverted Amaran and wall boom verified33/36/72';
    // Attach the whole head to its actual support so the wall cutaway never leaves it floating.
    room.walls[0].group.attach(grid);
  }
  // The old merged cord geometry included a floor-fed grid stand and a removed camera.
  // Current cords are routed along the visible boom and the relocated Neewer pole.
  room.group.getObjectByName('light-cables')?.removeFromParent();
  const metal=new THREE.MeshStandardMaterial({color:'#151718',metalness:.55,roughness:.55});
  const hardware=new THREE.MeshStandardMaterial({color:'#4a4d4d',metalness:.7,roughness:.5});
  const rubber=new THREE.MeshStandardMaterial({color:'#101112',roughness:.94});
  const red=new THREE.MeshStandardMaterial({color:'#8a2030',roughness:.9});
  const boom=new THREE.Group();boom.name='oct9-grid-wall-boom';room.walls[0].group.add(boom);
  const rod=(a:number[],b:number[],r:number,mat:THREE.Material,parent:THREE.Object3D=boom)=>{
    const A=V(a),B=V(b),g=new THREE.CylinderGeometry(r,r,A.distanceTo(B),20);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V([0,1,0]),B.clone().sub(A).normalize()));g.translate(...A.clone().add(B).multiplyScalar(.5).toArray());
    const m=new THREE.Mesh(g,mat);m.castShadow=m.receiveShadow=true;parent.add(m);return m;
  };
  const cable=(points:number[][],parent:THREE.Object3D,r=.0032)=>{
    const c=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(V)),Math.max(32,points.length*9),r,7),rubber);c.castShadow=true;c.userData.physics={type:'none'};parent.add(c);return c;
  };
  // Photo33 rectangular four-bolt plate, twin hinge sockets, two nested black tubes.
  const anchor: [number,number,number]=[2.845,2.017,-1.478];
  const plate=box([.025,.155,.075],anchor,metal);boom.add(plate);
  for(const y of [-.055,.055])for(const z of [-.022,.022]){
    rod([2.833,anchor[1]+y,anchor[2]+z],[2.853,anchor[1]+y,anchor[2]+z],.006,hardware);
  }
  rod([2.81,1.958,-1.478],[2.81,2.09,-1.478],.018,hardware);
  const receiver=V([0,-.15,-.468]).applyMatrix4(newGFrame);
  const elbow=[receiver.x,2.060,receiver.z];
  const joint=V(anchor).lerp(V(elbow),.47);joint.y=2.074;
  rod([2.81,2.074,-1.478],joint.toArray(),.0215,metal);
  rod(joint.toArray(),elbow,.017,metal);
  rod(joint.clone().add(V([.034,0,0])).toArray(),joint.clone().add(V([-.034,0,0])).toArray(),.026,rubber);
  rod([joint.x,joint.y-.007,joint.z],[joint.x,joint.y-.053,joint.z],.006,hardware);
  boom.add(box([.033,.015,.043],[joint.x,joint.y-.055,joint.z],rubber));
  rod(elbow,[receiver.x,receiver.y,receiver.z],.009,hardware);
  rod([receiver.x-.016,2.060,receiver.z],[receiver.x+.016,2.060,receiver.z],.025,hardware);
  // Thin tension rod joins the nested arm; split collar/hinge are visible in33/72.
  rod([2.816,2.012,-1.478],[joint.x,joint.y-.031,joint.z],.0038,hardware);
  boom.add(box([.025,.012,.025],[2.747,2.074,-1.46],red));
  const cG=V([.035,.084,-.533]).applyMatrix4(newGFrame);
  cable([cG.toArray(),[cG.x-.025,2.07,cG.z],[joint.x,2.06,joint.z-.015],[2.8,2.055,-1.49],[2.827,1.91,-1.475],[2.86,1.86,-1.475]],boom);
  const cords=new THREE.Group();cords.name='oct9-neewer-power-cords';room.group.add(cords);
  const cN=V([.035,-.084,-.513]).applyMatrix4(newNFrame);
  cable([cN.toArray(),[-.843,1.15,-.083],[-.878,.8,-.057],[-.91,.4,-.043],[-1.0,.06,-.06],[-1.052,.28,.07]],cords);
  cable([[-.77,.87,.055],[-.795,.64,.085],[-.872,.32,.048],[-.99,.045,.10],[-.965,.06,-.06],[-1.05,.3,.10]],cords);
  for(let i=0;i<3;i++)cable([[-.94,.18,.06+i*.013],[-.965,.05,-.05+i*.027],[-.83,.025,-.03+i*.04],[-.87,.1,.13+i*.013],[-1.025,.27,.09]],cords,.0025);
}

export async function updateArchitecture(room:BuiltRoom):Promise<void>{
  const loader=new THREE.TextureLoader();
  const [diffuser,normal,nylon,nylonNormal]=await Promise.all([loader.loadAsync('/office-v4/textures/neewer-diffuser-color.jpg'),loader.loadAsync('/office-v4/textures/neewer-diffuser-normal.png'),loader.loadAsync('/office-v4/textures/softbox-nylon-color.jpg'),loader.loadAsync('/office-v4/textures/softbox-nylon-normal.png')]);
  diffuser.colorSpace=nylon.colorSpace=THREE.SRGBColorSpace;for(const t of [diffuser,normal,nylon,nylonNormal])t.anisotropy=8;
  alcove(room);
  ceilingTreatment(room);
  lights(room,diffuser,normal,nylon,nylonNormal);
}
