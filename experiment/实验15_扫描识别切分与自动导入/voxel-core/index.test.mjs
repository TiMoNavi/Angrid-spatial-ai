import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VoxelDocument} from './index.ts';
const box = () => { const d=new VoxelDocument(); d.createBox({id:'table-object',name:'box',baseStep:.2,origin:[0,.73,0],dimensions:[3,2,2]}); return d; };
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('local grid on 0.73m table, hole and shape persist across moves and reload',()=>{
 const d=box(); assert.equal(d.getObject('table-object').cells.length,12); near(d.volume('table-object'),.096);
 d.removeCell('table-object',{level:0,x:0,y:0,z:0}); const hash=d.shapeHash('table-object');
 d.move('table-object',[0,0,0]); d.move('table-object',[0,.73,0]); d.rotate('table-object',1);
 assert.equal(d.getObject('table-object').cells.length,11); assert.equal(d.shapeHash('table-object'),hash);
 const reopened=VoxelDocument.fromJSON(d.toJSON()); assert.equal(reopened.shapeHash('table-object'),hash); assert.equal(reopened.getObject('table-object').id,'table-object');
});
test('local refinement and global refinement preserve holes',()=>{
 const d=box(); const c={level:0,x:0,y:0,z:0}; d.refine('table-object',[c]); assert.equal(d.getObject('table-object').cells.length,19); near(d.volume('table-object'),.096);
 d.removeCell('table-object',{level:1,x:0,y:0,z:0}); assert.equal(d.getObject('table-object').cells.length,18);
 d.refineToLevel('table-object',1); assert.equal(d.getObject('table-object').cells.length,95); near(d.volume('table-object'),.095);
 assert.deepEqual(d.query([.05,.78,.05]),[]); assert.equal(d.query([.15,.78,.05])[0].objectId,'table-object');
});
test('two owners sharing a broad cell are queried by effective shape',()=>{
 const d=new VoxelDocument(); d.createBox({id:'A',name:'A',baseStep:.08,origin:[0,0,0],dimensions:[1,1,1]}); d.createBox({id:'B',name:'B',baseStep:.08,origin:[.12,0,0],dimensions:[1,1,1]});
 assert.deepEqual(d.query([.04,.04,.04]).map(h=>h.objectId),['A']); assert.deepEqual(d.query([.10,.04,.04]),[]); assert.deepEqual(d.query([.16,.04,.04]).map(h=>h.objectId),['B']);
});
test('history is atomic and locked objects refuse edits',()=>{
 const d=box(); const c={level:0,x:0,y:0,z:0}; d.removeCell('table-object',c); const rev=d.revision; assert.equal(d.undo(),true); assert.equal(d.getObject('table-object').cells.length,12); assert.ok(d.revision>rev); assert.equal(d.redo(),true); assert.equal(d.getObject('table-object').cells.length,11);
 d.setLocked('table-object',true); const before=d.toJSON(); assert.throws(()=>d.move('table-object',[1,2,3])); assert.equal(d.toJSON(),before); assert.throws(()=>d.addCell('table-object',c));
});
test('overlapping leaves and corrupt storage are rejected',()=>{
 const d=box(); assert.throws(()=>d.addCell('table-object',{level:1,x:0,y:0,z:0})); assert.throws(()=>d.refine('table-object',[{level:0,x:100,y:0,z:0}]));
 const data=d.snapshot(); data.objects[0].cells.push({level:1,x:0,y:0,z:0}); assert.throws(()=>new VoxelDocument(data));
});
test('negative coordinates and 90 degree rotation query correctly',()=>{
 const d=new VoxelDocument(); d.createBox({id:'A',name:'A',baseStep:1,origin:[-2,0,-2],dimensions:[1,1,1]}); d.rotate('A',1);
 assert.equal(d.query([-2.5,.5,-1.5])[0].objectId,'A'); assert.equal(d.query([-1.5,.5,-1.5]).length,0);
});
