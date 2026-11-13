import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BuiltRoom } from '../../packages/room-runtime/types';

/** October 7 tabletop, checked against photos 34–35. Furniture and printer stay intact.
 * Positions back-projected from photo 34 onto the measured 0.98m bench plane.
 * Small printed prototypes are approximate silhouettes, rather than old colored toy blocks. */
export async function updateBench(room: BuiltRoom) {
  // Floor audited across October photos 25–32, including clear downward views 27–32.
  // The drink cases did not all disappear: Pepsi moved beside the fridge, while the
  // white bin moved behind the lamp stand (photo29). The yellow rag remains (31/32).
  const wing=room.group.getObjectByName('wing-floor');
  if(wing) {
    for(const name of ['drpepper-flat','kirkland-water','wing-cords']) wing.getObjectByName(name)?.removeFromParent();
    const pepsi=wing.getObjectByName('pepsi-flat');
    if(pepsi) {pepsi.position.set(-2.23,0,-1.42);pepsi.rotation.y=-.18;}
    const bin=wing.getObjectByName('white-bin');
    if(bin) {bin.position.set(-.91,0,.45);bin.rotation.y=0;}
    wing.getObjectByName('tape-roll')?.position.set(-.33,0,-2.49);
    // Preserve navy bag, DeWalt organizer and open parts carton: all are visible25–28.
  }
  const bench = room.group.getObjectByName('printer-bench');
  if (!bench) return;
  // These objects occupy clearly visible tabletop in both current views and have changed.
  for (const name of ['clear-bin-0','clear-bin-1','cream-tub','tall-clear-box','black-mug',
    'pen-cup-black','white-box','parts-plate','printed-chassis','orange-coil','tape-measure',
    'drill-battery','teal-spool', ...Array.from({length:6},(_,i)=>`printed-part-${i}`)])
    bench.getObjectByName(name)?.removeFromParent();
  const mat = bench.getObjectByName('cutting-mat');
  if (mat) { mat.scale.set(1.57,1,1.55); mat.position.set(-2.39,.9815,-1.98); }
  const amber=bench.getObjectByName('amber-bottle');
  if(amber) { amber.position.set(-2.36,.98,-1.58); amber.scale.set(.86,.59,.86); }
  const tablet=bench.getObjectByName('tablet-stand');if(tablet) {tablet.position.set(-2.71,.98,-1.60);tablet.scale.setScalar(.82);}

  const root=new THREE.Group();root.name='october-printer-bench-props';bench.add(root);
  const std=(color:string,roughness=.55,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const white=std('#eeece4'),gray=std('#9eaaa5',.9),black=std('#191c1c'),steel=std('#aeb5b5',.3,.75);
  const clear=new THREE.MeshPhysicalMaterial({color:'#b9c7cd',transparent:true,opacity:.095,roughness:.36,depthWrite:false,side:THREE.DoubleSide});
  const rim=new THREE.MeshStandardMaterial({color:'#cbd4d4',transparent:true,opacity:.5,roughness:.5,depthWrite:false});
  const add=(g:THREE.Object3D,geo:THREE.BufferGeometry,m:THREE.Material,x=0,y=0,z=0)=>{
    const mesh=new THREE.Mesh(geo,m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=!(m as THREE.MeshStandardMaterial).transparent;g.add(mesh);return mesh;
  };
  const box=(g:THREE.Object3D,w:number,h:number,d:number,m:THREE.Material,x=0,y=0,z=0,r=.002)=>add(g,new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)),m,x,y,z);
  const item=(name:string,x:number,z:number,y=.984)=>{const g=new THREE.Group();g.name=name;g.position.set(x,y,z);g.userData.physics={type:'dynamic',mass:.4,shape:'box'};root.add(g);return g;};
  const cyl=(g:THREE.Object3D,r:number,h:number,m:THREE.Material,x=0,y=h/2,z=0)=>add(g,new THREE.CylinderGeometry(r,r,h,32),m,x,y,z);
  const lathe=(g:THREE.Object3D,p:number[][],m:THREE.Material)=>add(g,new THREE.LatheGeometry(p.map(v=>new THREE.Vector2(v[0],v[1])),40),m);
  const tube=(g:THREE.Object3D,p:number[][],r:number,m:THREE.Material)=>add(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p.map(v=>new THREE.Vector3(...v))),24,r,6,false),m);
  // Open, tapered translucent storage bins: the front stack is empty in both views.
  const bin=(g:THREE.Object3D,w:number,h:number,d:number)=>{
    const outline=(width:number,depth:number,r:number)=>{
      const p=new THREE.Shape(),x=-width/2,z=-depth/2;
      p.moveTo(x+r,z);p.lineTo(x+width-r,z);p.quadraticCurveTo(x+width,z,x+width,z+r);
      p.lineTo(x+width,z+depth-r);p.quadraticCurveTo(x+width,z+depth,x+width-r,z+depth);
      p.lineTo(x+r,z+depth);p.quadraticCurveTo(x,z+depth,x,z+depth-r);
      p.lineTo(x,z+r);p.quadraticCurveTo(x,z,x+r,z);return p;
    };
    const ring=(width:number,depth:number,height:number,y:number,m:THREE.Material,t=.002)=>{
      const shape=outline(width,depth,.017);shape.holes.push(outline(width-2*t,depth-2*t,.017-t));
      const geo=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,curveSegments:5});geo.rotateX(-Math.PI/2);add(g,geo,m,0,y,0);
    };
    box(g,w-.008,.002,d-.008,clear,0,.001,0,.014);
    ring(w,d,h,0,clear);
    for(const y of [.004,h])ring(w+.006,d+.006,.005,y,rim,.004);
    // Molded ribs, low-opacity edge highlights, and two snap catches.
    for(const s of [-1,1]) for(let i=-2;i<=2;i++) box(g,.0018,h*.62,.002,rim,s*w/2,h*.36,i*d/7);
    for(const s of [-1,1]) box(g,.004,.025,.036,rim,s*(w/2+.003),h-.014,0);
  };
  for(let i=0;i<2;i++) {const b=item(`oct7-empty-bin-${i}`,-2.57,-1.81,.984+i*.161);bin(b,.195,.198,.205);b.scale.y=.82;}
  const filament=item('oct7-filament-container',-2.53,-2.12);bin(filament,.22,.24,.245);
  for(const z of [-.06,.01,.065]) {
    const spool=new THREE.Group();spool.position.set(0,.105,z);filament.add(spool);
    for(const s of [-1,1]) {const disk=cyl(spool,.099,.005,std('#b19b76',.9),0,0,s*.027);disk.rotation.x=Math.PI/2;}
    const winding=cyl(spool,.083,.048,std(z<0?'#a2947a':'#edab36',.5),0,0,0);winding.rotation.x=Math.PI/2;
    const hub=cyl(spool,.021,.058,black,0,0,0);hub.rotation.x=Math.PI/2;
  }
  const lid=item('oct7-bin-lid',-2.46,-1.985);box(lid,.19,.008,.2,rim,0,.004,0);lid.rotation.y=.1;
  const packageG=item('oct7-open-filament-carton',-2.53,-2.12,1.23);packageG.rotation.y=-.12;
  box(packageG,.245,.003,.25,white,0,0,0);
  for(const s of [-1,1]) {box(packageG,.003,.065,.25,white,s*.122,.032,0);box(packageG,.245,.065,.003,white,0,.032,s*.123);}
  const flap=box(packageG,.24,.002,.21,white,0,.1,-.025);flap.rotation.x=-.36;
  // A thin printed blue border replaces the previous featureless solid lid.
  const blue=std('#2f91b5');for(const s of [-1,1]) box(packageG,.002,.028,.218,blue,s*.124,.035,0);
  const ipa=item('oct7-isopropyl-alcohol',-2.55,-1.62);
  lathe(ipa,[[0,0],[.034,0],[.037,.009],[.037,.135],[.028,.155],[.017,.162],[.017,.187],[0,.187]],white);
  cyl(ipa,.019,.025,white,0,.198);
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=384;const c=canvas.getContext('2d')!;
  c.fillStyle='#f3f3e9';c.fillRect(0,0,256,384);c.fillStyle='#477c70';c.font='20px Arial';c.fillText('Equate',15,30);c.fillStyle='#333';c.textAlign='center';c.font='bold 24px Arial';['Isopropyl','ALCOHOL','99%'].forEach((s,i)=>c.fillText(s,128,115+i*35));c.fillStyle='#c33935';c.fillRect(8,242,240,30);c.fillStyle='#fff';c.font='17px Arial';c.fillText('ANTISEPTIC',128,263);c.fillStyle='#555';c.font='12px Arial';c.fillText('500 mL',128,350);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const label=add(ipa,new THREE.CylinderGeometry(.0375,.0375,.126,32,1,true,-Math.PI*.62,Math.PI*1.25),new THREE.MeshStandardMaterial({map:tex,roughness:.7}),0,.079);label.rotation.y=Math.PI/2;
  // Google Home: white sloping shell on woven gray foot, clearly visible at front right.
  const speaker=item('oct7-google-home',-2.18,-2.12);
  lathe(speaker,[[0,0],[.046,0],[.048,.008],[.047,.056],[0,.056]],gray);
  const shell=new THREE.CylinderGeometry(.044,.047,.098,48);const a=shell.getAttribute('position');for(let i=0;i<a.count;i++)if(a.getY(i)>0)a.setY(i,a.getY(i)-a.getX(i)*.3);shell.computeVertexNormals();add(speaker,shell,white,0,.105);
  // Print plate with today's white prototype parts and empty organizer packaging.
  const plate=item('oct7-print-plate',-2.23,-1.86);plate.rotation.y=.06;
  box(plate,.255,.005,.28,std('#776f63',.7),0,.003,0);
  for(const s of [-1,1]) box(plate,.009,.007,.25,steel,s*.125,.006,0);
  for(let i=0;i<3;i++) {
    const p=new THREE.Group();p.position.set((i-1)*.07,.009,(i%2-.5)*.12);p.rotation.y=i*.7;plate.add(p);
    box(p,.054,.009,.042,white,0,.005,0);box(p,.011,.048,.035,white,-.02,.03,0);box(p,.046,.012,.015,white,.008,.05,0);
    cyl(p,.01,.034,white,.012,.025,.008);
  }
  const tall= new THREE.Group();plate.add(tall);tall.position.set(-.075,.006,-.095);
  tube(tall,[[0,0,0],[.02,.045,0],[-.004,.08,.01],[.011,.122,0]],.007,white);
  for(let i=0;i<3;i++) box(tall,.034,.008,.018,white,.012,.033+i*.03,.003);
  const tray=item('oct7-open-white-parts-tray',-2.20,-1.66);box(tray,.082,.002,.085,white,0,.001,0);for(const s of [-1,1]){box(tray,.002,.042,.085,white,s*.04,.021,0);box(tray,.082,.042,.002,white,0,.021,s*.041);}
  const bits=item('oct7-driver-bit-set',-2.42,-1.66);box(bits,.043,.012,.13,black,0,.006,0);for(let i=0;i<10;i++) {cyl(bits,.003,.024,steel,0,.024,-.056+i*.012);box(bits,.009,.014,.007,std('#c7aa38'),0,.015,-.056+i*.012);}
  const cablebox=item('oct7-cable-adapter-bin',-2.24,-2.27);box(cablebox,.085,.068,.125,black,0,.034,0);
  for(let i=0;i<4;i++) tube(cablebox,[[-.08,.10,-.025],[.03,.12,-.11],[.07,.105,.015],[-.04,.085,.085],[-.09,.09,.01]],.0022,white);
  box(cablebox,.07,.016,.03,white,0,.086,0);
  const glass=item('oct7-drinking-glass',-2.68,-1.69);lathe(glass,[[0,0],[.026,0],[.03,.094],[.027,.094],[.023,.007],[0,.007]],clear);
}
