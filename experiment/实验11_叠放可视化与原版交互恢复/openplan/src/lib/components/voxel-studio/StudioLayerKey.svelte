<script lang="ts">
  /** A compact key for the actual visible scene layers; pass renderer priorities, not guesses. */
  export interface StudioLayerKeyEntry {
    id: string;
    label: string;
    color: string;
    opacity: number;
    priority: number;
    kind: 'volume' | 'shell' | 'candidate' | 'observed' | 'surface' | 'points' | 'reference';
    count?: number;
    countUnit?: string;
  }

  export interface StudioHeatmapKey {
    label: string;
    low: string;
    high: string;
    explanation: string;
    colors: string[];
  }

  let {
    entries = [],
    heatmap = null
  }: {
    entries?: StudioLayerKeyEntry[];
    heatmap?: StudioHeatmapKey | null;
  } = $props();

  const ordered = $derived([...entries].sort((a, b) => a.priority - b.priority));
  const percent = (opacity: number) => Math.round(Math.max(0, Math.min(1, opacity)) * 100);
  const kindLabel: Record<StudioLayerKeyEntry['kind'], string> = {
    volume: '实体',
    shell: '薄壳',
    candidate: '候选格',
    observed: '观察格',
    surface: '表面',
    points: '点',
    reference: '参照'
  };
</script>

<aside class="studio-key" aria-label="空间图层显示说明">
  <header>
    <div>
      <h3>显示层次</h3>
      <p>当前可见图层</p>
    </div>
    <span class="order-hint">低 → 高优先级</span>
  </header>
  <p class="depth-note">渲染优先级只定图层绘制；空间遮挡仍按三维深度。</p>

  {#if ordered.length}
    <ol>
      {#each ordered as layer (layer.id)}
        <li style={'--layer-color: ' + layer.color}>
          <span class:volume={layer.kind === 'volume'} class:shell={layer.kind === 'shell'} class:candidate={layer.kind === 'candidate'} class:observed={layer.kind === 'observed'} class="glyph" aria-hidden="true"></span>
          <span class="layer-copy">
            <span class="name">{layer.label}</span>
            <span class="detail">
              {kindLabel[layer.kind]} · {percent(layer.opacity)}% 不透明度
              {#if layer.count !== undefined} · {layer.count.toLocaleString()} {layer.countUnit || '记录'}{/if}
            </span>
          </span>
          <span class="opacity-track" aria-hidden="true"><span style={'width:' + percent(layer.opacity) + '%'}></span></span>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty">打开图层后，此处显示颜色、体积类型和遮挡顺序。</p>
  {/if}

  {#if heatmap}
    <div class="heatmap">
      <div class="heatmap-heading"><strong>{heatmap.label}</strong><span>热力图</span></div>
      <div class="heatmap-scale" style={'background: linear-gradient(90deg, ' + heatmap.colors.join(', ') + ')'} aria-hidden="true"></div>
      <div class="heatmap-ends"><span>{heatmap.low}</span><span>{heatmap.high}</span></div>
      <p>{heatmap.explanation}</p>
    </div>
  {/if}
</aside>

<style>
  .studio-key {
    width: min(286px, calc(100vw - 24px));
    padding: 14px 15px;
    color: #e9e9e9;
    background: rgba(10, 10, 10, .88);
    border: 1px solid rgba(255, 255, 255, .12);
    border-radius: 10px;
    box-shadow: 0 16px 44px rgba(0, 0, 0, .24);
    backdrop-filter: blur(15px) saturate(120%);
    font-family: Inter, system-ui, sans-serif;
    font-size: 12px;
    line-height: 1.42;
    pointer-events: none;
  }
  header, .heatmap-heading, .heatmap-ends { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  h3, p { margin: 0; }
  h3 { font-size: 13px; font-weight: 600; letter-spacing: .01em; }
  header p { color: #8e8e8e; margin-top: 2px; }
  .order-hint { color: #b8b8b8; white-space: nowrap; font-size: 11px; }
  .depth-note { margin-top: 7px; color: #a7a7a7; font-size: 10px; line-height: 1.45; }
  ol { margin: 12px 0 0; padding: 0; list-style: none; }
  li { display: flex; align-items: center; gap: 9px; padding: 8px 0; border-top: 1px solid rgba(255, 255, 255, .10); }
  .glyph {
    flex: 0 0 16px; width: 16px; height: 16px;
    background: var(--layer-color); opacity: .85;
    border: 1px solid rgba(255, 255, 255, .35);
    box-shadow: inset -3px -3px 0 rgba(0, 0, 0, .18);
  }
  .glyph.volume { transform: skewY(-13deg); box-shadow: 3px -2px 0 color-mix(in srgb, var(--layer-color), #fff 28%), inset -3px -3px 0 rgba(0, 0, 0, .18); }
  .glyph.shell { background: color-mix(in srgb, var(--layer-color), transparent 65%); border: 2px solid var(--layer-color); }
  .glyph.candidate { background: linear-gradient(135deg, var(--layer-color) 50%, transparent 50%); }
  .glyph.observed { background: transparent; border-style: dashed; border-color: var(--layer-color); }
  .layer-copy { flex: 1; display: flex; min-width: 0; flex-direction: column; gap: 1px; }
  .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #f1f1f1; font-weight: 500; }
  .detail { color: #9a9a9a; font-size: 10px; }
  .opacity-track { width: 27px; height: 3px; flex: 0 0 27px; border-radius: 99px; background: rgba(255, 255, 255, .14); overflow: hidden; }
  .opacity-track span { display: block; height: 100%; border-radius: inherit; background: var(--layer-color); transition: width .18s ease; }
  .empty { margin-top: 12px; color: #9a9a9a; }
  .heatmap { margin-top: 10px; padding-top: 11px; border-top: 1px solid rgba(255, 255, 255, .11); }
  .heatmap-heading strong { font-weight: 600; }
  .heatmap-heading span, .heatmap-ends { color: #9a9a9a; font-size: 10px; }
  .heatmap-scale { height: 5px; margin-top: 9px; border-radius: 99px; }
  .heatmap-ends { margin-top: 4px; }
  .heatmap p { margin-top: 7px; color: #9a9a9a; font-size: 10px; line-height: 1.45; }
  @media (prefers-reduced-motion: reduce) { .opacity-track span { transition: none; } }
</style>
