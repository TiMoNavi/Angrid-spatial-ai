import { asset, byId, drawPlan, formatBytes, loadRoom, loadSummary } from './common.js';

const select = document.getElementById('scan-select');
const title = document.getElementById('stage-title');
const tag = document.getElementById('stage-tag');
const lead = document.getElementById('stage-lead');
const body = document.getElementById('stage-body');
const steps = [...document.querySelectorAll('[data-step]')];
let summary, scan, room, step = 0;

function escape(value) {
  return String(value).replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]);
}
function artifact(heading, content) { return '<div class="artifact"><h3>' + heading + '</h3>' + content + '</div>'; }
function image(url, alt) { return '<img src="' + escape(url) + '" alt="' + escape(alt) + '" loading="lazy">'; }
function render() {
  if (!scan || !room) return;
  steps.forEach((button, index) => button.setAttribute('aria-current', index === step ? 'step' : 'false'));
  document.getElementById('prev-step').disabled = step === 0;
  document.getElementById('next-step').disabled = step === steps.length - 1;
  const fileRows = scan.files.map(file => '<li><code>' + escape(file.name) + '</code><span>' + formatBytes(file.bytes) + '</span></li>').join('');
  const bounds = scan.polygonBounds.map(value => value.toFixed(2)).join(' × ');
  const sample = scan.samples[Math.floor(scan.samples.length / 2)];
  if (step === 0) {
    title.textContent = '解包与核验'; tag.textContent = '已执行 · 原件不改写';
    lead.textContent = '读 ZIP 的目录、manifest.json 和 room-0.json，先确认格式、文件数量与每种证据是否存在。没有网格时不能编造一个“原始网格”。';
    body.innerHTML = '<div class="stage-grid">' +
      artifact('输入', '<p>' + escape(scan.archive) + ' · ' + formatBytes(scan.archiveBytes) + ' · ' + scan.fileCount + ' 个文件项，格式 ' + escape(scan.format) + '。</p><ul class="file-list">' + fileRows + '</ul>') +
      artifact('真实判定', '<p>RoomPlan：' + scan.walls + ' 面墙、' + scan.windows + ' 扇窗、' + scan.objects + ' 个物体边界框。' +
        (scan.hasMesh ? '此包有 LiDAR PLY：' + Number(scan.mesh.vertices).toLocaleString() + ' 顶点。' : '此包没有 PLY，只有采样深度与 RoomPlan/USDZ。') +
        '两份 ZIP 均未发现高斯泼溅资产。</p>') + '</div>';
  } else if (step === 1) {
    title.textContent = 'RoomPlan 坐标转换'; tag.textContent = '已执行 · 可重复';
    lead.textContent = '转换脚本读取每段墙的中心、方向和尺寸，换成以地面 y=0 为基准的米制端点、内法线、开窗范围；照片位姿也转到同一房间坐标。';
    body.innerHTML = '<div class="stage-grid">' +
      artifact('转换后的平面', '<svg id="process-plan" role="img" aria-label="从 RoomPlan JSON 转换的平面图" style="width:100%;height:315px;background:#173039"></svg>') +
      artifact('可核对的结果', '<p>外接范围约 ' + bounds + ' 米，墙高约 ' + scan.wallHeight.toFixed(2) + ' 米；墙段 ' + room.walls.length + ' 条，物体边界框 ' + room.objects.length + ' 个。这是识别结果，不等于验收测量。</p><pre>bundle_to_room.py bundle/Room --room 0 -o converted.json\n\npolygon / walls / objects / photos</pre>') + '</div>';
    drawPlan(document.getElementById('process-plan'), room);
  } else if (step === 2) {
    title.textContent = '留下视觉证据'; tag.textContent = '已提取 · 未做融合';
    lead.textContent = '照片有时间、内参和相机位姿；深度帧有 256 × 192 的距离值与置信度。它们能为建模提供尺度和外观参考，但本实验没有把它们自动训练成高斯模型。';
    body.innerHTML = '<div class="stage-grid">' +
      artifact('原始照片样本', image(asset('', sample.file), '采集照片样本') + '<p>照片 ' + sample.index + '；实际应按位姿挑选对应墙面与家具的合适视角。</p>') +
      artifact('一帧深度的显示热图', image(asset(scan.id, 'depth-heat.png'), '深度数据伪彩色') + '<p>从 Float16 数值生成显示图。另用 ' + scan.projectedFrames + ' 帧得到 ' + scan.projectedPoints.toLocaleString() + ' 个稀疏投影点，尚未融合、补洞或去噪。</p>') + '</div>';
  } else if (step === 3) {
    title.textContent = '生成可编辑初稿'; tag.textContent = '已实现 · 粗模';
    lead.textContent = '把转换后的墙窗参数做成 Three.js 几何，把物体识别框暂时组合成桌、椅和柜子的简化部件。结果能旋转、查看平面图和切换光影。';
    body.innerHTML = '<div class="stage-grid">' +
      artifact('结构如何进入网页', '<p>polygon → 地板面；walls + openings → 有窗洞的墙体网格；objects → 按尺寸放置的可编辑几何组。相机、材质与灯光是另加的显示层。</p><pre>converted.json → geometry + materials + lights → Three.js scene</pre>') +
      artifact('现在可实际打开', '<p>这一步已在独立实验页实现，不需要重新扫描。它仍是“测量初稿”，不是完整照片建模。</p><p><a class="control" style="display:inline-flex;align-items:center;text-decoration:none;margin-top:14px" href="../实验3_最终查看网页/index.html?scan=' + scan.id + '">打开可拖动的房间预览</a></p>') + '</div>';
  } else {
    title.textContent = '照片对照与继续修正'; tag.textContent = '未完成 · 需逐件复核';
    lead.textContent = '作者展示级别的效果来自持续比对：从原照片恢复对应相机，把模型截图叠到同视角，修墙体缺口、家具轮廓、材质尺度和灯光，再重复。';
    body.innerHTML = '<div class="stage-grid">' +
      artifact('真实照片', image(asset('', sample.file), '用于后续校准的真实照片') + '<p>图片有已记录的相机位姿，可用来建立同机位比较。</p>') +
      artifact('目前不能声称的结果', '<p>本实验尚未生成与左图严格同机位的模型截图，也没有处理跨会话配准和未闭合墙段。这里保留缺口，不展示虚构的“完成对比”。</p><ul class="note-list"><li>补测或人工确认缺失墙门</li><li>按照片逐件建家具、选材质</li><li>验证相机对位与光照</li></ul>') + '</div>';
  }
}
async function switchScan(id) {
  scan = byId(summary, id);
  select.value = scan.id;
  room = await loadRoom(scan.id);
  const url = new URL(location.href); url.searchParams.set('scan', scan.id); history.replaceState(null, '', url);
  render();
}
steps.forEach(button => button.addEventListener('click', () => { step = Number(button.dataset.step); render(); }));
document.getElementById('prev-step').addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
document.getElementById('next-step').addEventListener('click', () => { step = Math.min(steps.length - 1, step + 1); render(); });
select.addEventListener('change', () => switchScan(select.value));
document.addEventListener('keydown', event => {
  if (event.target instanceof HTMLSelectElement) return;
  if (event.key === 'ArrowRight' && step < steps.length - 1) { step++; render(); }
  if (event.key === 'ArrowLeft' && step > 0) { step--; render(); }
});
try {
  summary = await loadSummary();
  await switchScan(new URLSearchParams(location.search).get('scan') || 'office-2');
} catch (error) {
  title.textContent = '处理记录无法载入';
  lead.textContent = error.message;
  console.error(error);
}
