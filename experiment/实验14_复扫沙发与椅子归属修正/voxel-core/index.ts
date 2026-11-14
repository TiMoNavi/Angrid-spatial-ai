/** Editable object-local voxel occupancy. Units are metres; +Y is up. */
export type Vec3 = [number, number, number];
export type Cell = { level: number; x: number; y: number; z: number };
export type VoxelObject = {
  id: string; name: string; semantic: string; source: 'user' | 'inferred' | 'measured';
  color?: string;
  baseStep: number; placementStep: number; origin: Vec3; quarterTurns: 0 | 1 | 2 | 3;
  locked: boolean; cells: Cell[];
};
export type SceneData = { version: 1; revision: number; objects: VoxelObject[] };
export type CellHit = { objectId: string; cell: Cell };
const MAX_CELLS = 100_000;
const clone = <T>(v: T): T => structuredClone(v);
const key = (c: Cell) => `${c.level}:${c.x}:${c.y}:${c.z}`;
const compare = (a: Cell, b: Cell) => a.level-b.level || a.x-b.x || a.y-b.y || a.z-b.z;
function validVec(v: unknown): v is Vec3 { return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite); }
function checkCell(c: Cell) {
  if (!c || !Number.isInteger(c.level) || c.level < 0 || c.level > 8 || ![c.x,c.y,c.z].every(Number.isSafeInteger)) throw new Error('Invalid voxel cell');
}
function size(o: VoxelObject, c: Cell) { return o.baseStep / 2 ** c.level; }
function bounds(o: VoxelObject, c: Cell): [Vec3, Vec3] {
  const s = size(o,c); return [[c.x*s,c.y*s,c.z*s],[(c.x+1)*s,(c.y+1)*s,(c.z+1)*s]];
}
function contains(a: Cell, b: Cell): boolean {
  if (a.level > b.level) return false;
  const d = 2 ** (b.level-a.level);
  return Math.floor(b.x/d)===a.x && Math.floor(b.y/d)===a.y && Math.floor(b.z/d)===a.z;
}
function ensureObject(o: VoxelObject) {
  if (!o || typeof o.id !== 'string' || !o.id || typeof o.name !== 'string' || typeof o.semantic !== 'string' || !['user','inferred','measured'].includes(o.source) || !Number.isFinite(o.baseStep) || o.baseStep<=0 || !Number.isFinite(o.placementStep) || o.placementStep<=0 || !validVec(o.origin) || !Number.isInteger(o.quarterTurns) || o.quarterTurns<0 || o.quarterTurns>3 || typeof o.locked !== 'boolean' || !Array.isArray(o.cells) || o.cells.length>MAX_CELLS) throw new Error('Invalid voxel object');
  if (o.color !== undefined && (typeof o.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.color))) throw new Error('Invalid voxel color');
  const seen = new Set<string>();
  for (const c of o.cells) { checkCell(c); const k=key(c); if (seen.has(k)) throw new Error('Duplicate voxel cell'); seen.add(k); }
  // A leaf cannot have an occupied ancestor; no parent/child double counting.
  for (const c of o.cells) for (let l=0; l<c.level; l++) { const d=2**(c.level-l); if (seen.has(`${l}:${Math.floor(c.x/d)}:${Math.floor(c.y/d)}:${Math.floor(c.z/d)}`)) throw new Error('Overlapping voxel levels'); }
}
function rotate([x,y,z]: Vec3, turns: number): Vec3 {
  switch ((turns%4+4)%4) { case 1: return [-z,y,x]; case 2: return [-x,y,-z]; case 3: return [z,y,-x]; default: return [x,y,z]; }
}
/** Validates untrusted saved data before use; no partially loaded document. */
function validate(data: SceneData) {
  if (!data || data.version!==1 || !Number.isSafeInteger(data.revision) || data.revision<0 || !Array.isArray(data.objects)) throw new Error('Invalid voxel document');
  const ids=new Set<string>();
  for (const o of data.objects) { ensureObject(o); if (ids.has(o.id)) throw new Error('Duplicate object ID'); ids.add(o.id); }
}
export class VoxelDocument {
  private data: SceneData;
  private past: SceneData[] = [];
  private future: SceneData[] = [];
  constructor(data: SceneData = {version:1,revision:0,objects:[]}) { validate(data); this.data=clone(data); }
  static fromJSON(json: string): VoxelDocument { return new VoxelDocument(JSON.parse(json)); }
  get revision() { return this.data.revision; }
  snapshot(): SceneData { return clone(this.data); }
  toJSON(): string { return JSON.stringify(this.data); }
  getObject(id: string): VoxelObject | undefined { const o=this.data.objects.find(v=>v.id===id); return o && clone(o); }
  private object(data: SceneData, id: string, allowLocked = false): VoxelObject {
    const o=data.objects.find(v=>v.id===id); if (!o) throw new Error('Object not found'); if(o.locked && !allowLocked) throw new Error('Object is locked'); return o;
  }
  private change(fn: (d:SceneData)=>boolean): boolean {
    const next=clone(this.data); if (!fn(next)) return false; next.revision=this.data.revision+1; validate(next);
    this.past.push(this.data); if(this.past.length>100) this.past.shift(); this.data=next; this.future=[]; return true;
  }
  /** 3×2×2 means 12 independent occupied cells. origin is the local grid's world origin. */
  createBox(args: {id: string; name: string; semantic?: string; color?: string; source?: VoxelObject['source']; baseStep: number; origin: Vec3; dimensions: [number,number,number]; placementStep?: number}): string {
    const {id,name,baseStep,origin,dimensions}=args;
    if(!Array.isArray(dimensions) || dimensions.length!==3 || !dimensions.every(n=>Number.isSafeInteger(n)&&n>0) || dimensions[0]*dimensions[1]*dimensions[2]>MAX_CELLS) throw new Error('Invalid dimensions or cell budget exceeded');
    const cells:Cell[]=[]; for(let x=0;x<dimensions[0];x++) for(let y=0;y<dimensions[1];y++) for(let z=0;z<dimensions[2];z++) cells.push({level:0,x,y,z});
    const obj:VoxelObject={id,name,semantic:args.semantic??'object',color:args.color,source:args.source??'user',baseStep,placementStep:args.placementStep??baseStep,origin:clone(origin),quarterTurns:0,locked:false,cells}; ensureObject(obj);
    this.change(d=>{if(d.objects.some(o=>o.id===id)) throw new Error('Duplicate object ID'); d.objects.push(obj); return true;}); return id;
  }
  deleteObject(id:string): boolean { return this.change(d=>{this.object(d,id); d.objects=d.objects.filter(o=>o.id!==id); return true;}); }
  rename(id:string,name:string): boolean { if(!name.trim()) throw new Error('Name required'); return this.change(d=>{const o=this.object(d,id); if(o.name===name)return false; o.name=name; return true;}); }
  setColor(id:string,color:string): boolean { if(!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Invalid voxel color'); return this.change(d=>{const o=this.object(d,id); if(o.color===color)return false; o.color=color; return true;}); }
  setLocked(id:string,locked:boolean): boolean { return this.change(d=>{const o=this.object(d,id,true); if(o.locked===locked)return false; o.locked=locked; return true;}); }
  move(id:string, origin:Vec3): boolean { if(!validVec(origin)) throw new Error('Invalid origin'); return this.change(d=>{const o=this.object(d,id); if(o.origin.every((n,i)=>n===origin[i]))return false; o.origin=clone(origin); return true;}); }
  rotate(id:string,quarterTurns:0|1|2|3): boolean { if(!Number.isInteger(quarterTurns)||quarterTurns<0||quarterTurns>3)throw new Error('Invalid rotation'); return this.change(d=>{const o=this.object(d,id); if(o.quarterTurns===quarterTurns)return false; o.quarterTurns=quarterTurns; return true;}); }
  removeCell(id:string, cell:Cell): boolean { checkCell(cell); return this.change(d=>{const o=this.object(d,id); const i=o.cells.findIndex(c=>key(c)===key(cell)); if(i<0)return false; o.cells.splice(i,1); return true;}); }
  addCell(id:string, cell:Cell): boolean { checkCell(cell); return this.change(d=>{const o=this.object(d,id); if(o.cells.some(c=>contains(c,cell)||contains(cell,c))) throw new Error('Cell overlaps existing occupancy'); if(o.cells.length>=MAX_CELLS)throw new Error('Cell budget exceeded'); o.cells.push(clone(cell)); return true;}); }
  /** Split the selected existing leaves exactly once; outside leaves remain unchanged. */
  refine(id:string, cells:Cell[]): boolean {
    if(!cells.length)return false; cells.forEach(checkCell); const targets=new Set(cells.map(key));
    return this.change(d=>{const o=this.object(d,id); const chosen=o.cells.filter(c=>targets.has(key(c))); if(chosen.length!==targets.size)throw new Error('Selection must contain existing complete leaves'); if(chosen.some(c=>c.level>=8))throw new Error('Maximum refinement reached'); if(o.cells.length+chosen.length*7>MAX_CELLS)throw new Error('Cell budget exceeded');
      o.cells=o.cells.filter(c=>!targets.has(key(c))); for(const c of chosen) for(let x=0;x<2;x++) for(let y=0;y<2;y++) for(let z=0;z<2;z++) o.cells.push({level:c.level+1,x:2*c.x+x,y:2*c.y+y,z:2*c.z+z}); return true;});
  }
  /** Refine every leaf coarser than target; existing fine leaves and holes are preserved. */
  refineToLevel(id:string,level:number):boolean {
    if(!Number.isInteger(level)||level<0||level>8)throw new Error('Invalid target level');
    return this.change(d=>{const o=this.object(d,id); let count=0; for(const c of o.cells) count+=8**Math.max(0,level-c.level); if(count>MAX_CELLS)throw new Error('Cell budget exceeded');
      if(o.cells.every(c=>c.level>=level))return false; const leaves:Cell[]=[]; const split=(c:Cell)=>{if(c.level>=level){leaves.push(c);return;} for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++)split({level:c.level+1,x:2*c.x+x,y:2*c.y+y,z:2*c.z+z});}; o.cells.forEach(split); o.cells=leaves; return true;});
  }
  cellBounds(id:string, cell:Cell): [Vec3,Vec3] { const o=this.object(this.data,id,true); checkCell(cell); return bounds(o,cell); }
  cellWorldCenter(id:string,cell:Cell):Vec3 { const o=this.object(this.data,id,true); const s=size(o,cell); const v=rotate([(cell.x+.5)*s,(cell.y+.5)*s,(cell.z+.5)*s],o.quarterTurns); return [v[0]+o.origin[0],v[1]+o.origin[1],v[2]+o.origin[2]]; }
  /** Point membership is half-open; shared faces belong to the positive-index side. */
  query(world:Vec3):CellHit[] { if(!validVec(world))throw new Error('Invalid point'); const hits:CellHit[]=[]; for(const o of this.data.objects) { const p=rotate([world[0]-o.origin[0],world[1]-o.origin[1],world[2]-o.origin[2]],-o.quarterTurns); for(const c of o.cells){const [lo,hi]=bounds(o,c); if(p.every((v,i)=>v>=lo[i]&&v<hi[i]))hits.push({objectId:o.id,cell:clone(c)});}} return hits; }
  volume(id:string):number { const o=this.object(this.data,id,true); return o.cells.reduce((sum,c)=>sum+size(o,c)**3,0); }
  /** Stable shape fingerprint; independent of world pose, name, and array order. */
  shapeHash(id:string):string { const o=this.object(this.data,id,true); const str=JSON.stringify([o.baseStep,[...o.cells].sort(compare).map(c=>[c.level,c.x,c.y,c.z])]); let h=2166136261; for(let i=0;i<str.length;i++)h=Math.imul(h^str.charCodeAt(i),16777619); return (h>>>0).toString(16).padStart(8,'0'); }
  undo():boolean { const prior=this.past.pop(); if(!prior)return false; this.future.push(this.data); prior.revision=this.data.revision+1; this.data=prior; return true; }
  redo():boolean { const next=this.future.pop(); if(!next)return false; this.past.push(this.data); next.revision=this.data.revision+1; this.data=next; return true; }
}
