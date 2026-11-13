const root = new URL('../.private/office-2/derived-v1/', location.href);
const labels = {'structure':'结构观察面','one-owner':'家具独占面','conflict':'多个家具候选冲突','unknown':'未归属观察面','rejected-noise':'小碎片候选'};
const gridLabels = {'structure-grid.json':'平整结构壳（推断）','furniture-grid.json':'分类家具表面（观察）','furniture-corrected-grid.json':'桌面平面（推断）','conflict-grid.json':'归属冲突表面','unknown-grid.json':'未归属观察表面','clutter-grid.json':'杂物候选'};
const number = n => Number(n).toLocaleString('zh-CN');
function cell(row, value, cls) { const td=document.createElement('td'); td.textContent=value; if(cls)td.className=cls; row.append(td); }
function tableRow(id, values) { const tr=document.createElement('tr'); values.forEach((v,i)=>cell(tr,v,id==='objects'&&i===1?'id':'')); document.getElementById(id).append(tr); }
async function read(path,expectedHash) { const response=await fetch(new URL(path,root),{cache:'no-store'}); if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);const bytes=await response.arrayBuffer();if(expectedHash){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==expectedHash.replace(/^sha256:/,''))throw new Error(`${path} 哈希不符，请重新生成`);}return JSON.parse(new TextDecoder().decode(bytes)); }
try {
  const manifest=await read('layer-manifest.json');
  if(!manifest.reportHash)throw new Error('清单缺少报告哈希，请重新生成');
  const report=await read('segment-report.json',manifest.reportHash);
  if(manifest.scanId!=='office-2'||manifest.frame!=='room-local-m'||manifest.transformHash!==report.transformHash)throw new Error('房间、单位或变换不一致，拒绝显示混合统计');
  const status=document.getElementById('status'); status.textContent=`有效观察面 ${number(report.eligibleFaces)}，分类守恒${report.conservation.passes?'通过':'失败'}。5 件家具来源匹配 ${report.objects.filter(o=>o.mappingState==='verified').length}/5。`;
  if(!report.conservation.passes)status.classList.add('error');
  for(const [key,value] of Object.entries(report.assignments)){const dt=document.createElement('dt');dt.textContent=labels[key]||key;const dd=document.createElement('dd');dd.textContent=number(value);document.getElementById('counts').append(dt,dd);}
  for(const object of report.objects)tableRow('objects',[`${object.convertedIndex+1} · ${object.category==='table'?'桌子':'椅子'}`,object.objectId,number(object.faceCount),number(object.conflictFaceCount),`${(object.centerErrorM*1000).toFixed(2)} mm`,object.watertight?'封闭':'非水密 / 不填实心']);
  for(const [name,grids] of Object.entries(report.grids))tableRow('grids',[gridLabels[name]||name,...['0.2','0.1','0.05','0.025'].map(s=>number(grids[s]))]);
  for(const row of report.segmentationSensitivity)tableRow('sensitivity',[`${row.marginM*100} cm`,row.minComponentFaces,number(row.keptOneOwner),number(row.conflictFaces),number(row.unknownBeforeCleanup)]);
  document.getElementById('clutter-state').textContent=manifest.clutter.computed?'本轮已离线计算杂物候选，需要逐件复核；不会自动删除。':'本轮跳过杂物计算。unknown 与冲突均保留，没有生成杂物几何。';
  document.getElementById('performance').textContent=`预处理 ${report.elapsedSeconds} s，峰值内存 ${report.peakRssMiB} MiB。坐标往返最大误差 ${report.coordinateRoundTripMaxErrorM.toExponential(2)} m。`;
}catch(error){const status=document.getElementById('status');status.classList.add('error');status.textContent=`未能读取有效本机分类结果：${error.message}。先运行 prepare_classified.py，私人扫描资产不会随仓库发布。`;}
