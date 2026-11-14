<script lang="ts">
  import { activeE22Scan, e22GridStep, e22LayerErrors, e22LayerSettings, e22LoadState,
    e22Manifest, e22ShowEditorWalls, e22ViewMode, setE22LayerOpacity, setE22LayerVisible, setE22ViewMode } from '$lib/stores/e22Scan';
  import { E22_RENDERABLE_KINDS } from '$lib/services/e22LayerLoader';
  import { groupE22RenderableLayers } from '$lib/utils/e22LayerGroups';

  const steps = [0.2, 0.1, 0.05, 0.025] as const;
  let showData = $state(false);
  const supported = (kind: string) => E22_RENDERABLE_KINDS.has(kind);
  const groups = $derived($e22Manifest ? groupE22RenderableLayers($e22Manifest.layers, $e22ViewMode) : []);
</script>

{#if $activeE22Scan}
  <section class="scan-layers" aria-label="E22 scan layers">
    <div class="scan-head">
      <strong>扫描资产 · {$activeE22Scan.scanId}</strong>
      <span>房间 {$activeE22Scan.roomIndex} · 米制对齐</span>
    </div>
    <div class="scan-modes" role="group" aria-label="扫描显示预设">
      <button type="button" class:active={$e22ViewMode === 'scan-evidence'} aria-pressed={$e22ViewMode === 'scan-evidence'} onclick={() => void setE22ViewMode('scan-evidence')}>扫描证据</button>
      <button type="button" class:active={$e22ViewMode === 'model-voxel'} aria-pressed={$e22ViewMode === 'model-voxel'} onclick={() => void setE22ViewMode('model-voxel')}>模型体素</button>
    </div>
    <label class="scan-editor-walls"><input type="checkbox" checked={$e22ShowEditorWalls}
      onchange={(event) => e22ShowEditorWalls.set(event.currentTarget.checked)} />显示编辑器墙体（仅 3D）</label>
    <label class="scan-grain">扫描格显示宽度
      <select value={$e22GridStep} onchange={(event) => e22GridStep.set(Number(event.currentTarget.value) as typeof steps[number])}>
        {#each steps as step}<option value={step}>{Math.round(step * 100)} cm</option>{/each}
      </select>
    </label>
    <p class="scan-hint">一次优先查看一个高密度表面层；可手动叠加对照。扫描格宽只影响显示，不提高扫描精度。模型体素格宽由生成资产固定。方块面按下方不透明度显示，线框会增强以便看清格子。</p>
    {#if $e22LoadState.loading}<p class="scan-status" role="status">正在读取图层目录…</p>{/if}
    {#if $e22LoadState.error}<p class="scan-error" role="alert">{$e22LoadState.error}</p>{/if}
    {#if $e22Manifest}
      {#each groups as group (group.id)}
      <details class="scan-group" open={$e22ViewMode === 'model-voxel' ? ['structure', 'model'].includes(group.id) : ['scan', 'structure', 'furniture'].includes(group.id)}>
        <summary><span>{group.label}</span><small>{group.layers.filter(layer => layer.available).length}/{group.layers.length} 可用</small></summary>
        {#each group.layers as layer (layer.id)}
        {@const setting = $e22LayerSettings[layer.id]}
        {@const enabled = layer.available && supported(layer.kind)}
        <div class="scan-layer" class:disabled={!enabled}>
          <label class="scan-layer-title" title={enabled ? layer.provenance : layer.reason || '此层不可用'}>
            <input type="checkbox" checked={Boolean(setting?.visible)} disabled={!enabled}
              onchange={(event) => setE22LayerVisible(layer.id, event.currentTarget.checked)} />
            <span class="scan-swatch" style:background={layer.visual.color}></span>
            <span>{layer.label}</span>
          </label>
          <div class="scan-layer-meta">
            <small>{layer.provenance}</small>
            {#if enabled}
              <label title="图层不透明度">{Math.round((setting?.opacity ?? layer.visual.opacity) * 100)}%
                <input aria-label={layer.label + ' 不透明度'} type="range" min="0" max="1" step="0.05"
                  value={setting?.opacity ?? layer.visual.opacity}
                  oninput={(event) => setE22LayerOpacity(layer.id, Number(event.currentTarget.value))} />
              </label>
            {:else}<small class="scan-unavailable">{layer.available ? '暂不支持显示' : layer.reason || '本次未生成'}</small>{/if}
          </div>
          {#if $e22LayerErrors[layer.id]}<p class="scan-error" role="alert">{$e22LayerErrors[layer.id]}</p>{/if}
        </div>
        {/each}
      </details>
      {/each}
      {#if $e22Manifest.layers.some(layer => !layer.renderable)}
        <button type="button" class="scan-data-toggle" aria-expanded={showData} onclick={() => showData = !showData}>
          {showData ? '▾' : '▸'} 数据索引与账本
        </button>
        {#if showData}
          <ul class="scan-data-list">
            {#each $e22Manifest.layers.filter(layer => !layer.renderable) as layer (layer.id)}
              <li>{layer.label}<span>{layer.available ? '已生成' : '未生成'}</span></li>
            {/each}
          </ul>
        {/if}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .scan-layers{margin:11px 10px 13px;border:1px solid #d3bc8055;border-radius:8px;background:linear-gradient(155deg,#283331,#1d2828 60%,#1a2324);color:#e9ede3;box-shadow:inset 0 1px #ffffff14;font-size:11px}
  .scan-head{display:flex;flex-direction:column;gap:4px;padding:11px 12px;border-bottom:1px solid #ffffff1b}
  .scan-head strong{font-size:12px;color:#e9d5a7;font-weight:600;word-break:break-all}
  .scan-head span,.scan-hint,.scan-layer-meta{color:#aab9b0}
  .scan-modes{display:flex;gap:4px;padding:9px 9px 4px}
  .scan-modes button{flex:1;border:1px solid #ffffff20;border-radius:4px;padding:6px 3px;color:#c4d3c6;background:#ffffff07;cursor:pointer}
  .scan-modes button.active{border-color:#d2b7788a;background:#cbb27622;color:#f1dba9}
  .scan-grain{display:flex;align-items:center;justify-content:space-between;padding:4px 12px;color:#c8d4cb}
  .scan-editor-walls{display:flex;align-items:center;gap:7px;padding:5px 12px;color:#c8d4cb;cursor:pointer}
  .scan-editor-walls input{accent-color:#d4bd81}
  .scan-grain select{background:#171e1f;color:#e9eee6;border:1px solid #ffffff35;border-radius:4px;padding:3px 5px}
  .scan-hint{margin:5px 12px 11px;line-height:1.4;font-size:10px}
  .scan-group{border-top:1px solid #ffffff1b}
  .scan-group > summary{display:flex;align-items:center;justify-content:space-between;gap:5px;padding:9px 11px;cursor:pointer;color:#e9d5a7;font-size:11px;font-weight:600;list-style:none}
  .scan-group > summary::-webkit-details-marker{display:none}
  .scan-group > summary::before{content:'▸';font-size:10px;color:#b0c0b7;margin-right:4px}
  .scan-group[open] > summary::before{content:'▾'}
  .scan-group > summary span{flex:1}
  .scan-group > summary small{font-size:10px;color:#aab9b0;font-weight:400}
  .scan-group > summary:hover{background:#ffffff09}
  .scan-status,.scan-error{margin:7px 11px;line-height:1.4;font-size:10px}
  .scan-error{color:#ffb7af}
  .scan-layer{border-top:1px solid #ffffff12;padding:8px 11px}
  .scan-layer.disabled{opacity:.54}
  .scan-layer-title{display:flex;align-items:center;gap:7px;cursor:pointer;color:#e1e9dc;line-height:1.3}
  .scan-layer-title input{accent-color:#d4bd81;cursor:pointer;flex:none}
  .scan-layer-title span:last-child{flex:1}
  .scan-swatch{width:7px;height:7px;border-radius:2px;flex:none;box-shadow:0 0 0 1px #ffffff55}
  .scan-layer-meta{display:flex;justify-content:space-between;gap:6px;margin:5px 0 0 22px;font-size:10px}
  .scan-layer-meta small{font-size:10px;overflow-wrap:anywhere}
  .scan-layer-meta:has(.scan-unavailable){flex-wrap:wrap}
  .scan-layer-meta .scan-unavailable{flex-basis:100%;line-height:1.4;color:#d8bba5}
  .scan-layer-meta label{display:flex;align-items:center;gap:5px;white-space:nowrap}
  .scan-layer-meta input{width:56px;accent-color:#d4bd81}
  .scan-data-toggle{width:100%;text-align:left;padding:10px 11px;color:#bfcbbf;border-top:1px solid #ffffff18;cursor:pointer}
  .scan-data-list{padding:0 11px 10px 24px;color:#aebdb2;line-height:1.7}
  .scan-data-list li{display:flex;justify-content:space-between;gap:7px}
  .scan-data-list span{opacity:.65;white-space:nowrap}
  .scan-layers :focus-visible{outline:2px solid #d4bd81;outline-offset:2px}
</style>
