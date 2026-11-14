import type { E22Layer } from '$lib/stores/e22Scan';

export interface E22LayerGroup { id: string; label: string; layers: E22Layer[] }

const LABELS: Record<string, string> = {
  scan: '扫描证据', structure: '平整结构', furniture: '家具与边界',
  model: 'AI 模型资产', review: '冲突与未归属', plan: '平面数据', other: '其他图层',
};

/** Group the manifest's display layers without changing its per-layer order. */
export function groupE22RenderableLayers(layers: E22Layer[]): E22LayerGroup[] {
  const renderable = layers.filter(layer => layer.renderable);
  const priority = ['structure', 'scan', 'furniture', 'review', 'model'];
  const ids = [...new Set(renderable.map(layer => layer.group || 'other'))];
  ids.sort((a, b) => {
    const ai = priority.indexOf(a), bi = priority.indexOf(b);
    return (ai < 0 ? priority.length : ai) - (bi < 0 ? priority.length : bi);
  });
  return ids.map(id => ({ id, label: LABELS[id] || id, layers: renderable.filter(layer => (layer.group || 'other') === id) }));
}
