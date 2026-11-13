import * as THREE from 'three';
import { OrbitControls } from '../shared/vendor/OrbitControls.js';
import { PLYLoader } from '../shared/vendor/PLYLoader.js';
import { TransformControls } from './vendor/TransformControls.js';
import { createInitialState, applyCommand, validateState, serializeState, getAnchors, snapValue, pointInPolygon, rectangleInPolygon } from './scene-model.mjs';
import sampleRoom from './sample-room.mjs';

const $=id=>document.getElementById(id), all=query=>[...document.querySelectorAll(query)];
const viewport=$('viewport'), canvas=$('scene'), svg=$('plan-svg');
const scene=new THREE.Scene(); scene.background=new THREE.Color('#111');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7)); renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.1;
const camera=new THREE.PerspectiveCamera(48,1,0.02,100);
const orbit=new OrbitControls(camera,canvas); orbit.enableDamping=true; orbit.dampingFactor=.25;
orbit.maxPolarAngle=Math.PI/2+.08; orbit.minDistance=.4; orbit.maxDistance=30; orbit.zoomToCursor=true;
const transform=new TransformControls(camera,canvas); transform.setSize(.85); transform.setSpace('world');
scene.add(transform.getHelper());
scene.add(new THREE.HemisphereLight('#fffaf0','#839081',2.5));
const sun=new THREE.DirectionalLight('#fff7e7',2.3); sun.position.set(-3,8,5); scene.add(sun);
const structure=new THREE.Group(), objectsGroup=new THREE.Group(), previewGroup=new THREE.Group(), anchorGroup=new THREE.Group();
scene.add(structure,objectsGroup,previewGroup,anchorGroup);
const meshes=new Map(), walls=[]; const raycaster=new THREE.Raycaster();
const color={floor:'#8c9386',wall:'#c4cac0',roomplan:'#b8996e',user:'#b8d5a1',selected:'#edf4da',grid:'#50604f',scan:'#729c9a'};
let room,state,roomId='office-2',selection=null,tool='select',viewMode='scene',source='model',scanObject=null;
let anchors=[],draft=null,past=[],future=[],frame=0,loadEpoch=0,scanEpoch=0,dragging=false,mouseStart=null;
let homeTarget=new THREE.Vector3(),homePosition=new THREE.Vector3(6,6,6),lastTransform=null;
let activePointer=null,savedRevision=0,loading=false;
let planBox=null,initialPlanBox=null,planDrag=null;
const storageKey=id=>`angrid-experiment6-scene-v1:${id}`;
const message=(text,error=false)=>{$('viewer-status').textContent=text;$('viewer-status').style.color=error?'#e6b49b':'';};
const finiteRound=value=>Number(value.toFixed(5));
function showNumber(id,raw,factor=1){const input=$(id);input.value=finiteRound(raw*factor);input.dataset.raw=String(raw);input.dataset.shown=input.value;input.dataset.factor=String(factor);input.title=String(raw*factor);}
function readNumber(id){const input=$(id);return input.value===input.dataset.shown?Number(input.dataset.raw):Number(input.value)/Number(input.dataset.factor);}

function invalidate(){if(!frame&&!document.hidden)frame=requestAnimationFrame(render);}
function render(){frame=0;orbit.update();
  for(const wall of walls) wall.group.visible=(draft?.anchor.id===wall.id)||camera.position.clone().sub(wall.midpoint).dot(wall.normal)>=0;
  if(selection&&meshes.has(selection)&&viewMode==='scene'){
    const item=state.objects.find(o=>o.id===selection), p=new THREE.Vector3(...item.center); p.y+=item.size[1]/2+.12;p.project(camera);
    $('selection-label').hidden=p.z>1||Math.abs(p.x)>1.1||Math.abs(p.y)>1.1;
    $('selection-label').style.left=`${(p.x*.5+.5)*viewport.clientWidth}px`;$('selection-label').style.top=`${(-p.y*.5+.5)*viewport.clientHeight}px`;
  }else $('selection-label').hidden=true;
  renderer.render(scene,camera);
}
orbit.addEventListener('change',invalidate); transform.addEventListener('change',invalidate);
transform.addEventListener('dragging-changed',event=>{dragging=event.value;orbit.enabled=!event.value&&tool!=='create';});
transform.addEventListener('mouseDown',()=>{lastTransform=selection?structuredClone(state.objects.find(o=>o.id===selection)):null;});
transform.addEventListener('mouseUp',()=>{
  if(!lastTransform||!selection)return;
  const node=meshes.get(selection);if(!node)return;
  // Editing one property must preserve every untouched measured value exactly.
  const patch=tool==='translate'?{center:node.position.toArray().map((n,i)=>Math.abs(n-lastTransform.center[i])<1e-7?lastTransform.center[i]:finiteRound(n))}
    :tool==='scale'?{size:lastTransform.size.map((s,i)=>{const factor=Math.abs(node.scale.getComponent(i));if(Math.abs(factor-1)<1e-7)return s;const size=Math.max(.025,s*factor);return finiteRound($('snap').checked?Math.max(state.gridStep,snapValue(size,state.gridStep)):size);})}
    :{rotY:Math.abs(node.rotation.y-lastTransform.rotY)<1e-7?lastTransform.rotY:node.rotation.y};
  const changed=Object.entries(patch).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(lastTransform[key]));
  lastTransform=null;if(changed)commit({type:'update',id:selection,patch},'已更新物体');else renderObjects();
});
function resize(){if(!viewport.clientWidth||!viewport.clientHeight)return;renderer.setSize(viewport.clientWidth,viewport.clientHeight,false);camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();invalidate();}
new ResizeObserver(resize).observe(viewport);document.addEventListener('visibilitychange',invalidate);
function disposeGroup(group){for(const node of [...group.children]){group.remove(node);node.traverse(o=>{o.geometry?.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.dispose());});}}
function material(c,opacity=1){return new THREE.MeshStandardMaterial({color:c,roughness:.85,transparent:opacity<1,opacity,side:THREE.DoubleSide,depthWrite:opacity>=1});}
function addBox(parent,size,center,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);mesh.position.set(...center);parent.add(mesh);return mesh;}
function addLines(parent,points,c,opacity=.5){if(!points.length)return;const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:c,transparent:true,opacity}));parent.add(line);return line;}
function shapeGeometry(points){const shape=new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();const g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);return g;}
function cutSegments(min,max,openings,axis,constant){
  const cuts=[min,max,...openings.flatMap(o=>axis==='u'?[o.u0,o.u1]:[o.v0,o.v1])].filter(v=>v>=min&&v<=max).sort((a,b)=>a-b);
  const result=[];for(let i=0;i<cuts.length-1;i++){const mid=(cuts[i]+cuts[i+1])/2;const covered=openings.some(o=>axis==='u'?mid>o.u0&&mid<o.u1&&constant>o.v0&&constant<o.v1:mid>o.v0&&mid<o.v1&&constant>o.u0&&constant<o.u1);if(!covered&&cuts[i+1]-cuts[i]>1e-6)result.push([cuts[i],cuts[i+1]]);}return result;
}
function renderStructure(){disposeGroup(structure);walls.length=0;
  const floor=new THREE.Mesh(shapeGeometry(room.polygon),material(color.floor));floor.position.y=-.015;structure.add(floor);
  if($('show-grid').checked){
    const p=[],bounds=anchors[0].bounds,step=state.gridStep;
    for(let axis=0;axis<2;axis++){const other=1-axis,min=bounds[axis*2],max=bounds[axis*2+1];
      for(let line=Math.ceil(min/step)*step;line<max;line+=step){const intersections=[];
        for(let i=0,j=room.polygon.length-1;i<room.polygon.length;j=i++){const a=room.polygon[j],b=room.polygon[i];if((a[axis]<=line&&b[axis]>line)||(b[axis]<=line&&a[axis]>line))intersections.push(a[other]+(line-a[axis])*(b[other]-a[other])/(b[axis]-a[axis]));}
        intersections.sort((a,b)=>a-b);for(let i=0;i+1<intersections.length;i+=2){const a=[],b=[];a[axis]=b[axis]=line;a[other]=intersections[i];b[other]=intersections[i+1];p.push([a[0],.002,a[1]],[b[0],.002,b[1]]);}
      }
    }addLines(structure,p,color.grid,.46);
  }
  room.walls.forEach((w,index)=>{
    const group=new THREE.Group();group.position.set(...w.origin);group.rotation.y=-Math.atan2(w.u[2],w.u[0]);structure.add(group);
    const cutsU=[...new Set([0,w.length,...w.openings.flatMap(o=>[Math.max(0,o.u0),Math.min(w.length,o.u1)])])].sort((a,b)=>a-b);
    const cutsV=[...new Set([0,w.height,...w.openings.flatMap(o=>[Math.max(0,o.v0),Math.min(w.height,o.v1)])])].sort((a,b)=>a-b);
    for(let i=0;i<cutsU.length-1;i++)for(let j=0;j<cutsV.length-1;j++){
      const u=(cutsU[i]+cutsU[i+1])/2,v=(cutsV[j]+cutsV[j+1])/2;
      if(w.openings.some(o=>u>o.u0&&u<o.u1&&v>o.v0&&v<o.v1))continue;
      if(cutsU[i+1]-cutsU[i]<.001||cutsV[j+1]-cutsV[j]<.001)continue;
      // n points inwards in converted RoomPlan; the wall slab stays outside its plane.
      const sign=new THREE.Vector3(-w.u[2],0,w.u[0]).dot(new THREE.Vector3(...w.n));
      addBox(group,[cutsU[i+1]-cutsU[i],cutsV[j+1]-cutsV[j],.06],[u,v,-sign*.03],material(color.wall));
    }
    for(const o of w.openings){
      const c=o.kind==='window'?'#749a9e':'#a4b48f';
      addLines(group,[[o.u0,o.v0,.003],[o.u1,o.v0,.003],[o.u1,o.v0,.003],[o.u1,o.v1,.003],[o.u1,o.v1,.003],[o.u0,o.v1,.003],[o.u0,o.v1,.003],[o.u0,o.v0,.003]],c,.9);
    }
    if($('show-grid').checked){const p=[];for(let v=state.gridStep;v<w.height;v+=state.gridStep)for(const [u0,u1]of cutSegments(0,w.length,w.openings,'u',v))p.push([u0,v,.004],[u1,v,.004]);for(let u=state.gridStep;u<w.length;u+=state.gridStep)for(const [v0,v1]of cutSegments(0,w.height,w.openings,'v',u))p.push([u,v0,.004],[u,v1,.004]);addLines(group,p,'#71806c',.2);}
    walls.push({id:`wall-${index}`,group,normal:new THREE.Vector3(...w.n),midpoint:new THREE.Vector3(...w.origin).addScaledVector(new THREE.Vector3(...w.u),w.length/2)});
  });
}
function boxGridLines(size,step){const [w,h,d]=size,p=[];
  const line=(a,b)=>p.push(a,b);
  // Keep a hostile/oversized import from allocating millions of decorative lines.
  const [sx,sy,sz]=size.map(length=>Math.max(1,Math.ceil(length/step/120))*step);
  for(let x=-w/2+sx;x<w/2-1e-6;x+=sx){for(const y of [-h/2,h/2])line([x,y,-d/2],[x,y,d/2]);for(const z of [-d/2,d/2])line([x,-h/2,z],[x,h/2,z]);}
  for(let y=-h/2+sy;y<h/2-1e-6;y+=sy){for(const x of [-w/2,w/2])line([x,y,-d/2],[x,y,d/2]);for(const z of [-d/2,d/2])line([-w/2,y,z],[w/2,y,z]);}
  for(let z=-d/2+sz;z<d/2-1e-6;z+=sz){for(const x of [-w/2,w/2])line([x,-h/2,z],[x,h/2,z]);for(const y of [-h/2,h/2])line([-w/2,y,z],[w/2,y,z]);}return p;
}
function makeObject(item,preview=false,valid=true){const group=new THREE.Group();group.position.set(...item.center);group.rotation.y=item.rotY;group.userData.objectId=item.id;
  const c=preview?(valid?'#b8d5a1':'#d98f76'):(item.id===selection?color.selected:color[item.source]||color.user);
  const mesh=addBox(group,item.size,[0,0,0],material(c,preview?.3:item.source==='roomplan'?.35:.85));mesh.userData.objectId=item.id;
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:c,transparent:true,opacity:.9}));group.add(edges);
  if($('show-grid').checked)addLines(group,boxGridLines(item.size,state.gridStep),c,preview?.7:.36);
  return group;
}
function renderObjects(){transform.detach();disposeGroup(objectsGroup);meshes.clear();
  for(const item of state.objects){const node=makeObject(item);meshes.set(item.id,node);objectsGroup.add(node);}attachTransform();invalidate();
}
function attachTransform(){const item=state?.objects.find(o=>o.id===selection);const enabled=item&&!item.locked&&['translate','scale','rotate'].includes(tool)&&viewMode==='scene';
  transform.enabled=!!enabled;transform.visible=!!enabled;if(enabled){transform.setMode(tool);transform.showX=tool!=='rotate';transform.showY=true;transform.showZ=tool!=='rotate';transform.setTranslationSnap($('snap').checked?state.gridStep:null);transform.setRotationSnap($('snap').checked?Math.PI/12:null);transform.setScaleSnap(null);transform.attach(meshes.get(selection));}else transform.detach();
}
function refresh(){anchors=getAnchors(room,state);if(selection&&!state.objects.some(o=>o.id===selection))selection=null;
  const previous=$('anchor-select').value;$('anchor-select').replaceChildren(...anchors.map(a=>{const option=document.createElement('option');option.value=a.id;option.textContent=a.name;return option;}));$('anchor-select').value=anchors.some(a=>a.id===previous)?previous:'floor';
  $('grid-step').value=state.gridStep;$('grid-label').textContent=`${state.gridStep*100} cm 格`;$('object-count').textContent=`${state.objects.length} 件`;
  $('undo').disabled=!past.length;$('redo').disabled=!future.length;renderStructure();renderObjects();renderList();renderInspector();renderPlan();renderAnchor();updateHint();
}
function renderList(){const host=$('object-list');host.replaceChildren();
  for(const item of state.objects){const b=document.createElement('button');b.className=`object-row ${item.source==='roomplan'?'measured':'user'} ${item.id===selection?'active':''}`;b.dataset.objectId=item.id;b.setAttribute('aria-pressed',String(item.id===selection));
    const dot=document.createElement('span');dot.className='object-dot';const name=document.createElement('span');name.textContent=item.name;const meta=document.createElement('small');meta.textContent=item.locked?'已锁定':item.source==='roomplan'?'粗框':'方块';b.append(dot,name,meta);b.onclick=()=>selectObject(item.id);host.append(b);}
  if(!state.objects.length){const p=document.createElement('p');p.className='object-empty';p.textContent='房间已清空。选择一个承载面，画出第一件物体。';host.append(p);}
}
function renderInspector(){const item=state?.objects.find(o=>o.id===selection);$('draft-form').hidden=!draft;$('object-form').hidden=!!draft||!item;$('inspector-empty').hidden=!!draft||!!item;
  if(!item||draft)return;$('object-source').textContent=item.source==='roomplan'?'RoomPlan 粗框':item.source==='ai'?'AI 来源（导入）':'用户创建';$('object-name').value=item.name;$('object-category').value=item.category;
  for(const [i,axis]of ['x','y','z'].entries()){showNumber(`size-${axis}`,item.size[i]);showNumber(`center-${axis}`,item.center[i]);}
  showNumber('rotation-y',item.rotY,180/Math.PI);$('object-locked').checked=item.locked;$('object-anchor').textContent=`承载面：${anchors.find(a=>a.id===item.anchorId)?.name||item.anchorId}`;
  for(const input of all('#object-form input'))if(input.id!=='object-locked')input.disabled=item.locked;
  $('duplicate-object').disabled=item.locked;$('delete-object').disabled=item.locked;
  const warning=placementWarning(item);$('object-warning').textContent=warning;$('object-warning').hidden=!warning;
  $('selection-label').textContent=`${item.name}${item.locked?' · 已锁定':''}\n${item.size.map(n=>n.toFixed(2)).join(' × ')} m`;
}
function placementWarning(item){
  const [x,y,z]=item.center,[w,h,d]=item.size;if(y-h/2<-.015)return'物体有一部分低于地面，请核对高度。';if(y+h/2>Math.max(...room.walls.map(w=>w.height))+.015)return'物体超过已测墙高，请核对高度；当前不自动约束天花板。';
  const corners=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([a,b])=>[x+Math.cos(item.rotY)*a*w/2+Math.sin(item.rotY)*b*d/2,z-Math.sin(item.rotY)*a*w/2+Math.cos(item.rotY)*b*d/2]);
  if(corners.some(p=>!pointInPolygon(...p,room.polygon)))return'物体范围超出房间轮廓。粗测量范围可能重叠，请人工核对。';
  return item.source==='roomplan'?'这是识别包围盒，不代表物体的实心外形。桌面锚面也是由粗框推断。':'';
}
function selectObject(id){const hadDraft=!!draft;selection=id;cancelDraft(false);renderObjects();renderList();renderInspector();
  // Keep SVG nodes during selection so the browser can deliver click/dblclick.
  if(hadDraft)renderPlan();else for(const g of svg.querySelectorAll('[data-object-id]')){const selected=g.dataset.objectId===selection,r=g.querySelector('rect');if(r){r.setAttribute('stroke',selected?'#284e36':'#8a947c');r.setAttribute('stroke-width',selected?'.035':'.015');}}
  updateHint();}
function persist(){try{localStorage.setItem(storageKey(roomId),serializeState(state));savedRevision=state.revision;$('save-status').textContent='已存本机';}catch{$('save-status').textContent='保存失败，请导出';}}
function commit(cmd,label){if(!state||loading)return false;try{const next=validateState(applyCommand(state,cmd),room,roomId);past.push(state);if(past.length>100)past.shift();future=[];state=next;persist();refresh();message(label);return true;}catch(e){message(e.message,true);renderObjects();return false;}}
function historyMove(back){cancelDraft(false);const from=back?past:future,to=back?future:past;if(!from.length)return;to.push(state);state={...from.pop(),revision:state.revision+1};persist();refresh();message(back?'已撤销':'已重做');}
function setTool(next){cancelDraft(false);tool=next;all('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});orbit.enabled=tool!=='create';canvas.classList.toggle('creating',tool==='create');attachTransform();renderInspector();renderAnchor();updateHint();}
function setView(mode){cancelDraft(false);viewMode=mode;$('plan').hidden=mode!=='plan';canvas.hidden=mode==='plan';document.body.classList.toggle('plan-active',mode==='plan');all('[data-viewmode]').forEach(b=>{b.classList.toggle('active',b.dataset.viewmode===mode);b.setAttribute('aria-pressed',String(b.dataset.viewmode===mode));});attachTransform();renderPlan();updateHint();invalidate();}
function cameraView(view){if(!room)return;setView('scene');const bounds=anchors[0].bounds,span=Math.max(bounds[1]-bounds[0],bounds[3]-bounds[2]),target=homeTarget.clone();camera.up.set(0,1,0);
  if(view==='home')camera.position.copy(homePosition);if(view==='top'){target.y=0;camera.position.copy(target).add(new THREE.Vector3(0,span*1.9,.001));}if(view==='front')camera.position.copy(target).add(new THREE.Vector3(0,.4,span*2.1));if(view==='side')camera.position.copy(target).add(new THREE.Vector3(span*2.1,.4,0));orbit.target.copy(target);orbit.update();invalidate();}
function activeAnchor(){return anchors.find(a=>a.id===$('anchor-select').value)||anchors[0];}
function renderAnchor(){disposeGroup(anchorGroup);if(!room||tool!=='create')return;const a=activeAnchor(),[u0,u1,v0,v1]=a.bounds;const point=(u,v)=>a.origin.map((n,i)=>n+a.u[i]*u+a.v[i]*v+a.normal[i]*.009);addLines(anchorGroup,[point(u0,v0),point(u1,v0),point(u1,v0),point(u1,v1),point(u1,v1),point(u0,v1),point(u0,v1),point(u0,v0)],'#bed9a7',.95);invalidate();}
function eventRay(event){const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);return raycaster;}
function rayUv(event,anchor){const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...anchor.normal),new THREE.Vector3(...anchor.origin));const p=eventRay(event).ray.intersectPlane(plane,new THREE.Vector3());if(!p)return null;p.sub(new THREE.Vector3(...anchor.origin));return[p.dot(new THREE.Vector3(...anchor.u)),p.dot(new THREE.Vector3(...anchor.v))];}
function planUv(event,anchor){if(anchor.kind==='wall')return null;const pt=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());const p=new THREE.Vector3(pt.x-anchor.origin[0],0,-pt.y-anchor.origin[2]);return[p.dot(new THREE.Vector3(...anchor.u)),p.dot(new THREE.Vector3(...anchor.v))];}
function snapUv(uv){return uv.map(v=>snapValue(v,state.gridStep));}
function beginDraft(event,isPlan=false){const a=activeAnchor(),uv=isPlan?planUv(event,a):rayUv(event,a);if(!uv){message(isPlan?'墙面创建请切换到 3D 视图':'当前视角与承载面平行，请换一个视角',true);return;}
  const start=snapUv(uv);draft={anchor:a,start,end:[start[0]+state.gridStep,start[1]+state.gridStep],counts:[1,1,1],phase:'base',pointerY:event.clientY};$('draft-name').value='新方块';$('draft-category').value='box';selection=null;renderObjects();renderList();renderInspector();renderDraft();
}
function draftObject(){if(!draft)return null;const {anchor:a,start,end,counts}=draft,step=state.gridStep;const u=Math.min(start[0],end[0])+counts[0]*step/2,v=Math.min(start[1],end[1])+counts[1]*step/2,depth=counts[2]*step;
  const center=a.origin.map((n,i)=>finiteRound(n+a.u[i]*u+a.v[i]*v+a.normal[i]*depth/2));
  return{id:'draft',name:$('draft-name').value.trim()||'新方块',category:$('draft-category').value.trim()||'box',source:'user',center,size:a.kind==='wall'?[counts[0]*step,counts[1]*step,depth]:[counts[0]*step,depth,counts[1]*step],rotY:-Math.atan2(a.u[2],a.u[0]),anchorId:a.id,locked:false};
}
function draftIssue(){if(!draft)return'';const {anchor:a,start,end,counts}=draft,step=state.gridStep,minU=Math.min(start[0],end[0]),minV=Math.min(start[1],end[1]),maxU=minU+counts[0]*step,maxV=minV+counts[1]*step,[u0,u1,v0,v1]=a.bounds,eps=1e-6;
  if(minU<u0-eps||maxU>u1+eps||minV<v0-eps||maxV>v1+eps)return'矩形超出承载面范围。缩小格数，或重新画一个矩形。';
  if(a.kind==='floor'&&!rectangleInPolygon(minU,minV,maxU,maxV,room.polygon))return'矩形经过房间外侧或凹进轮廓，请在地面内重新框选。';
  if(a.kind==='wall'){const w=room.walls[Number(a.id.slice(5))];if(w.openings.some(o=>minU<o.u1-eps&&maxU>o.u0+eps&&minV<o.v1-eps&&maxV>o.v0+eps))return'矩形覆盖了门窗开口，请调整位置或大小。';}
  return'';
}
function renderDraft(){disposeGroup(previewGroup);if(!draft){$('draft-form').hidden=true;return;}const item=draftObject(),issue=draftIssue();previewGroup.add(makeObject(item,true,!issue));
  for(const [i,k]of ['a','b','c'].entries())$(`draft-${k}`).value=draft.counts[i];$('draft-dimensions').textContent=item.size.map(v=>`${finiteRound(v)} m`).join(' × ');
  $('draft-warning').hidden=!issue;$('draft-warning').textContent=issue;$('confirm-create').disabled=!!issue||draft.phase==='base';
  $('draft-phase').textContent={base:'画矩形',height:'拉伸',ready:'命名并创建'}[draft.phase];$('draft-description').textContent=draft.phase==='base'?'拖出矩形，松开鼠标后设置深度。':viewMode==='plan'?'占地已确定。设置 c 格高度，再命名创建。':draft.phase==='height'?'上下移动鼠标拉伸，单击固定。也可直接输入格数。':'格数和名称都可以再改。确认后成为一件可编辑物体。';renderPlan();updateHint();invalidate();
}
function cancelDraft(refreshInspector=true){if(!draft)return;draft=null;activePointer=null;disposeGroup(previewGroup);$('draft-form').hidden=true;if(refreshInspector){renderInspector();renderPlan();updateHint();}invalidate();}
function createDraft(){if(!draft||draftIssue()||draft.phase==='base')return;const item=draftObject();item.id=`user-${crypto.randomUUID()}`;if(commit({type:'add',object:item},`已创建 ${item.name}`)){draft=null;disposeGroup(previewGroup);selection=item.id;setTool('select');refresh();}}
function updateHint(){$('interaction-hint').textContent=draft?(draft.phase==='base'?'拖动确定矩形 · Esc 取消':draft.phase==='height'&&viewMode!=='plan'?'上下移动拉伸 · 单击固定 · Enter 创建 · Esc 取消':'调整格数与名称 · Enter 创建 · Esc 取消'):tool==='create'?'在承载面拖出矩形，松开后拉伸。Esc 取消':tool==='select'?(viewMode==='plan'?'点击选物体 · 与 3D 同步编辑':'拖动旋转 · 滚轮缩放 · 点击粗框选择'):selection?'拖动手柄编辑 · Esc 复位本次变换':'先点击一个物体，再使用变换手柄';}

canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!state)return;mouseStart=[event.clientX,event.clientY];if(tool!=='create')return;event.preventDefault();
  if(draft?.phase==='height'){draft.phase='ready';renderDraft();$('draft-name').focus();return;}if(draft)return;beginDraft(event);if(draft){activePointer=event.pointerId;canvas.setPointerCapture(event.pointerId);}
});
canvas.addEventListener('pointermove',event=>{if(tool!=='create'||!draft)return;
  if(draft.phase==='base'&&activePointer===event.pointerId){const uv=rayUv(event,draft.anchor);if(uv){draft.end=snapUv(uv);draft.counts[0]=Math.min(200,Math.max(1,Math.round(Math.abs(draft.end[0]-draft.start[0])/state.gridStep)));draft.counts[1]=Math.min(200,Math.max(1,Math.round(Math.abs(draft.end[1]-draft.start[1])/state.gridStep)));renderDraft();}}
  else if(draft.phase==='height'){draft.counts[2]=Math.max(1,Math.min(200,1+Math.round((draft.pointerY-event.clientY)/12)));renderDraft();}
});
canvas.addEventListener('pointerup',event=>{if(tool==='create'&&draft?.phase==='base'){draft.phase='height';draft.pointerY=event.clientY;activePointer=null;renderDraft();return;}if(tool==='create'||dragging||!mouseStart||Math.hypot(event.clientX-mouseStart[0],event.clientY-mouseStart[1])>5)return;
  if(transform.axis)return;const hits=eventRay(event).intersectObjects(objectsGroup.children,true);selectObject(hits.find(h=>h.object.userData.objectId)?.object.userData.objectId||null);
});
canvas.addEventListener('pointercancel',()=>{cancelDraft();});
function svgNode(tag,attrs={},text){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el;}
// Adapted from the baseline viewer's src/layout.ts; see LICENSE.baseline.
function fitPlan(){if(initialPlanBox){planBox=[...initialPlanBox];svg.setAttribute('viewBox',planBox.join(' '));}}
function renderPlan(){if(!room||!state)return;svg.replaceChildren();const [x0,x1,z0,z1]=anchors[0].bounds,pad=.45;initialPlanBox=[x0-pad,-z1-pad,x1-x0+pad*2,z1-z0+pad*2];if(!planBox)planBox=[...initialPlanBox];svg.setAttribute('viewBox',planBox.join(' '));
  const area=Math.abs(room.polygon.reduce((sum,a,i)=>{const b=room.polygon[(i+1)%room.polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
  $('plan-summary').textContent=`总体 ${(x1-x0).toFixed(2)} × ${(z1-z0).toFixed(2)} m · 约 ${area.toFixed(1)} m² · 点击选物体，拖动空白平移，滚轮缩放`;
  const defs=svgNode('defs'),clip=svgNode('clipPath',{id:'floor-clip'});clip.append(svgNode('polygon',{points:room.polygon.map(([x,z])=>`${x},${-z}`).join(' ')}));defs.append(clip);svg.append(defs);
  svg.append(svgNode('polygon',{points:room.polygon.map(([x,z])=>`${x},${-z}`).join(' '),fill:'#e2e6dc',stroke:'#7f927d','stroke-width':.015}));
  if($('show-grid').checked){const grid=svgNode('g',{'clip-path':'url(#floor-clip)',stroke:'#bdc9b9','stroke-width':.005});for(let x=Math.ceil(x0/state.gridStep)*state.gridStep;x<x1;x+=state.gridStep)grid.append(svgNode('line',{x1:x,x2:x,y1:-z1,y2:-z0}));for(let z=Math.ceil(z0/state.gridStep)*state.gridStep;z<z1;z+=state.gridStep)grid.append(svgNode('line',{x1:x0,x2:x1,y1:-z,y2:-z}));svg.append(grid);}
  room.walls.forEach(w=>{svg.append(svgNode('line',{x1:w.a[0],y1:-w.a[1],x2:w.b[0],y2:-w.b[1],stroke:'#405747','stroke-width':.06}));for(const o of w.openings)svg.append(svgNode('line',{x1:w.origin[0]+w.u[0]*o.u0,y1:-(w.origin[2]+w.u[2]*o.u0),x2:w.origin[0]+w.u[0]*o.u1,y2:-(w.origin[2]+w.u[2]*o.u1),stroke:o.kind==='window'?'#82afb5':'#f7f6f2','stroke-width':.075}));});
  for(const item of [...state.objects,...(draft?[draftObject()]:[])]){const g=svgNode('g',{transform:`translate(${item.center[0]} ${-item.center[2]}) rotate(${item.rotY*180/Math.PI})`,'data-object-id':item.id});g.append(svgNode('rect',{x:-item.size[0]/2,y:-item.size[2]/2,width:item.size[0],height:item.size[2],fill:item.source==='roomplan'?'#c7b28a':'#9fb88a','fill-opacity':item.id==='draft'?.5:.8,stroke:item.id===selection?'#284e36':item.id==='draft'?'#67974d':'#8a947c','stroke-width':item.id===selection?.035:.015}));g.append(svgNode('text',{'text-anchor':'middle',y:.035,fill:'#344d3c','font-size':Math.min(.105,item.size[0]/Math.max(3,item.name.length)),'font-family':'sans-serif',transform:`rotate(${-item.rotY*180/Math.PI})`},item.name));g.append(svgNode('title',{},`${item.name} ${item.size.map(v=>v.toFixed(2)).join(' × ')} 米`));svg.append(g);}
  const scale=Math.min(1,x1-x0);svg.append(svgNode('path',{d:`M ${x0} ${-z0+.2} h ${scale} m ${-scale} -.03 v .06 m ${scale} -.06 v .06`,fill:'none',stroke:'#455e4b','stroke-width':.015}));svg.append(svgNode('text',{x:x0+scale/2,y:-z0+.36,'text-anchor':'middle',fill:'#506c57','font-size':.1},`${scale} m`));
  svg.append(svgNode('text',{x:x1,y:-z0+.36,'text-anchor':'end','font-size':.1,fill:'#506c57'},`约 ${area.toFixed(1)} m² · 布局草图`));
  svg.append(svgNode('text',{x:(x0+x1)/2,y:-z1-.18,'text-anchor':'middle','font-size':.12,fill:'#506c57'},`${(x1-x0).toFixed(2)} m`));
  svg.append(svgNode('text',{x:x1+.2,y:-(z0+z1)/2,transform:`rotate(90 ${x1+.2} ${-(z0+z1)/2})`,'text-anchor':'middle','font-size':.12,fill:'#506c57'},`${(z1-z0).toFixed(2)} m`));
}
svg.addEventListener('pointerdown',event=>{if(!state||![0,1].includes(event.button))return;
  if(tool!=='create'||event.button===1){event.preventDefault();const rect=svg.getBoundingClientRect();planDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,box:[...planBox],scale:Math.max(planBox[2]/rect.width,planBox[3]/rect.height),id:event.button===0?event.target.closest('[data-object-id]')?.dataset.objectId:undefined,moved:false};svg.setPointerCapture(event.pointerId);return;}
  if(draft)return;beginDraft(event,true);if(draft){activePointer=event.pointerId;svg.setPointerCapture(event.pointerId);}});
svg.addEventListener('pointermove',event=>{if(planDrag&&planDrag.pointerId===event.pointerId){const dx=event.clientX-planDrag.x,dy=event.clientY-planDrag.y;if(Math.hypot(dx,dy)>4)planDrag.moved=true;if(planDrag.moved){planBox=[planDrag.box[0]-dx*planDrag.scale,planDrag.box[1]-dy*planDrag.scale,...planDrag.box.slice(2)];svg.setAttribute('viewBox',planBox.join(' '));}return;}
  if(!draft||draft.phase!=='base'||activePointer!==event.pointerId)return;const uv=planUv(event,draft.anchor);if(uv){draft.end=snapUv(uv);draft.counts[0]=Math.min(200,Math.max(1,Math.round(Math.abs(draft.end[0]-draft.start[0])/state.gridStep)));draft.counts[1]=Math.min(200,Math.max(1,Math.round(Math.abs(draft.end[1]-draft.start[1])/state.gridStep)));renderDraft();}});
svg.addEventListener('pointerup',()=>{if(planDrag){const pan=planDrag;planDrag=null;if(!pan.moved)selectObject(pan.id||null);return;}if(draft?.phase==='base'){draft.phase='ready';activePointer=null;renderDraft();$('draft-c').focus();}});svg.addEventListener('pointercancel',()=>{planDrag=null;cancelDraft();});
svg.addEventListener('dblclick',fitPlan);$('fit-plan').onclick=fitPlan;
svg.addEventListener('wheel',event=>{event.preventDefault();if(!planBox||draft?.phase==='base')return;const factor=Math.exp(Math.max(-.2,Math.min(.2,event.deltaY*.001)));if(planBox[2]*factor<initialPlanBox[2]*.25||planBox[2]*factor>initialPlanBox[2]*4)return;planBox=[planBox[0]+planBox[2]*(1-factor)/2,planBox[1]+planBox[3]*(1-factor)/2,planBox[2]*factor,planBox[3]*factor];svg.setAttribute('viewBox',planBox.join(' '));},{passive:false});
async function setSource(next){source=next;all('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===next);b.setAttribute('aria-pressed',String(b.dataset.source===next));});if(scanObject)scanObject.visible=next==='overlay';
  if(next==='model'){invalidate();return;}if(roomId==='sample'){message('公开示例没有扫描证据');return;}if(scanObject){invalidate();return;}const epoch=++scanEpoch,owner=roomId;message('正在载入扫描对照，仅用于核对…');
  try{const geometry=await new PLYLoader().loadAsync(new URL(`../.private/${owner}/reference-depth/scan_room.ply`,location.href).href);if(epoch!==scanEpoch||owner!==roomId){geometry.dispose();return;}
    // Open3D's binary PLY stores doubles; WebGL vertex buffers require Float32.
    for(const [name,attribute] of Object.entries(geometry.attributes))if(attribute.array instanceof Float64Array)geometry.setAttribute(name,new THREE.Float32BufferAttribute(attribute.array,attribute.itemSize,attribute.normalized));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:!!geometry.getAttribute('color'),color:geometry.getAttribute('color')?'#ffffff':color.scan,transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false}));scanObject=mesh;mesh.visible=source==='overlay';scene.add(mesh);message('扫描已叠加。编辑几何仍来自平整语义结构。');invalidate();
  }catch{message('本机没有准备此扫描的 TSDF 网格。规则结构仍可编辑。',true);}
}
async function loadRoom(id){const epoch=++loadEpoch;++scanEpoch;loading=true;document.body.classList.add('loading');cancelDraft(false);transform.detach();selection=null;roomId=id;$('room-select').value=id;$('loader').hidden=false;$('empty-error').hidden=true;
  if(scanObject){scene.remove(scanObject);scanObject.geometry.dispose();scanObject.material.dispose();scanObject=null;}
  try{const next=id==='sample'?structuredClone(sampleRoom):await fetch(new URL(`../.private/${id}/converted.json`,location.href)).then(r=>{if(!r.ok)throw new Error('未找到本机扫描数据');return r.json();});if(epoch!==loadEpoch)return;
    room=next;planBox=null;planDrag=null;state=createInitialState(room,id);try{const saved=localStorage.getItem(storageKey(id));if(saved)state=validateState(JSON.parse(saved),room,id);}catch(e){message(`保存的场景无法恢复：${e.message}`,true);}
    past=[];future=[];anchors=getAnchors(room,state);const b=anchors[0].bounds,span=Math.max(b[1]-b[0],b[3]-b[2]);homeTarget.set((b[0]+b[1])/2,.65,(b[2]+b[3])/2);homePosition.copy(homeTarget).add(new THREE.Vector3(span*1.35,span*1.25,span*1.35));
    refresh();cameraView('home');setTool('select');setSource('model');savedRevision=state.revision;$('save-status').textContent=state.revision?'已恢复本机':'初始状态';
    $('source-note').textContent=id==='sample'?'公开的虚构房间，用于无私有数据时体验编辑。不是扫描测量。':'RoomPlan 平面、开口与语义范围。家具为粗框，桌面高度为推断。';
    message(`${id==='sample'?'公开示例':id==='office-2'?'第二次扫描':'第一次扫描'} · ${room.walls.length} 段墙 · ${state.objects.length} 件物体`);
    const url=new URL(location.href);url.searchParams.set('room',id);history.replaceState(null,'',url);resize();
  }catch(e){if(epoch!==loadEpoch)return;state=null;disposeGroup(structure);disposeGroup(objectsGroup);$('empty-error').hidden=false;message(e.message,true);}finally{if(epoch===loadEpoch){loading=false;document.body.classList.remove('loading');$('loader').hidden=true;}}
}
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
all('[data-tool]').forEach(b=>b.onclick=()=>{if(state)setTool(b.dataset.tool);});all('[data-camera]').forEach(b=>b.onclick=()=>cameraView(b.dataset.camera));all('[data-viewmode]').forEach(b=>b.onclick=()=>{if(state)setView(b.dataset.viewmode);});all('[data-source]').forEach(b=>b.onclick=()=>{if(state)setSource(b.dataset.source);});
$('room-select').onchange=e=>loadRoom(e.target.value);$('grid-step').onchange=e=>{cancelDraft(false);commit({type:'setGrid',step:Number(e.target.value)},'已切换格密度，米制位置和尺寸保持原值');};$('anchor-select').onchange=()=>{cancelDraft();renderAnchor();};$('show-grid').onchange=()=>{if(state)refresh();};$('snap').onchange=attachTransform;
$('undo').onclick=()=>historyMove(true);$('redo').onclick=()=>historyMove(false);$('start-create').onclick=()=>setTool('create');$('cancel-create').onclick=()=>cancelDraft();$('draft-form').onsubmit=e=>{e.preventDefault();createDraft();};
for(const [i,k]of ['a','b','c'].entries())$(`draft-${k}`).oninput=e=>{if(!draft)return;const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=200){draft.counts[i]=n;if(draft.phase==='height')draft.phase='ready';renderDraft();}};
$('object-form').onsubmit=e=>{e.preventDefault();const item=state.objects.find(o=>o.id===selection);if(!item)return;const locked=$('object-locked').checked;
  const patch=item.locked?{locked}:{name:$('object-name').value.trim(),category:$('object-category').value.trim(),center:['x','y','z'].map(a=>readNumber(`center-${a}`)),size:['x','y','z'].map(a=>readNumber(`size-${a}`)),rotY:readNumber('rotation-y'),locked};commit({type:'update',id:selection,patch},locked?'物体已锁定':'已应用属性');};
$('delete-object').onclick=()=>{if(selection)commit({type:'delete',id:selection},'已删除物体，可撤销恢复');};$('duplicate-object').onclick=()=>{const item=state.objects.find(o=>o.id===selection);if(!item||item.locked)return;const copy={...structuredClone(item),id:`user-${crypto.randomUUID()}`,source:'user',name:`${item.name} 副本`,center:[item.center[0]+state.gridStep,item.center[1],item.center[2]+state.gridStep]};if(commit({type:'add',object:copy},'已复制物体'))selectObject(copy.id);};
$('clear-furniture').onclick=()=>{if(!state)return;const candidate=applyCommand(state,{type:'clearFurniture'}),removed=state.objects.filter(o=>!candidate.objects.some(n=>n.id===o.id));$('clear-summary').textContent=`将清除 ${removed.length} 件物体${removed.length?'：'+removed.map(o=>o.name).join('、'):''}。保留 ${candidate.objects.length} 件锁定或必要承载物。`;$('clear-dialog').returnValue='';$('clear-dialog').showModal();};$('clear-dialog').addEventListener('close',()=>{if($('clear-dialog').returnValue==='clear')commit({type:'clearFurniture'},'已清空家具，可撤销恢复');});
$('save-scene').onclick=()=>{if(state){persist();message('派生场景已保存到当前浏览器');}};$('export-scene').onclick=()=>{if(state)download(serializeState(state),`${roomId}-voxel-scene.json`,'application/json');};$('import-scene').onclick=()=>$('import-file').click();$('import-file').onchange=async event=>{const file=event.target.files[0];if(!file||!state)return;try{if(file.size>2*1024*1024)throw new Error('导入文件不能超过 2 MB');const candidate=validateState(JSON.parse(await file.text()),room,roomId);past.push(state);if(past.length>100)past.shift();future=[];state={...candidate,revision:state.revision+1};persist();refresh();message('已导入派生场景，可撤销');}catch(e){message(`导入未应用：${e.message}`,true);}event.target.value='';};
$('export-plan').onclick=()=>{if(!state)return;const clone=svg.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width','1200');clone.setAttribute('height','1000');const title=svgNode('title',{},'米制布局草图 · 测量粗模，非施工图');clone.prepend(title);download(new XMLSerializer().serializeToString(clone),`${roomId}-layout.svg`,'image/svg+xml');};
$('controls-toggle').onclick=()=>{const open=document.body.classList.toggle('controls-open');$('controls-toggle').setAttribute('aria-expanded',String(open));};$('use-sample').onclick=()=>loadRoom('sample');
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(draft)cancelDraft();else if(dragging){transform.reset();}document.body.classList.remove('controls-open');$('controls-toggle').setAttribute('aria-expanded','false');return;}if(event.target.matches('input,select,textarea')||$('clear-dialog').open)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();historyMove(!event.shiftKey);return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(state)persist();return;}
  if(!state)return;if(event.key==='Enter'&&draft){event.preventDefault();createDraft();return;}const tools={v:'select',b:'create',g:'translate',s:'scale',r:'rotate'};if(tools[event.key.toLowerCase()])setTool(tools[event.key.toLowerCase()]);if((event.key==='Delete'||event.key==='Backspace')&&selection){event.preventDefault();commit({type:'delete',id:selection},'已删除物体');}if(event.key==='Home')cameraView('home');
});
// Read-only geometry hooks for repeatable browser interaction tests, opt-in only.
if(new URLSearchParams(location.search).has('debug'))window.__voxelEditor={get state(){return state?structuredClone(state):null;},get room(){return room?structuredClone(room):null;},get transform(){return{axis:transform.axis,mode:transform.mode,dragging:transform.dragging};},get draft(){return draft?structuredClone(draft):null;},worldToScreen(point){const p=new THREE.Vector3(...point).project(camera),r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};}};
const requested=new URLSearchParams(location.search).get('room');loadRoom(['office-1','office-2','sample'].includes(requested)?requested:'office-2');
