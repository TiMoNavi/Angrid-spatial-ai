/** GPU instance safety bound; manifests still report every source cell. */
export const E22_MAX_RENDER_CELLS = 150_000;

/** The manifest can advertise counts without fetching a potentially large grid JSON. */
export function e22DeclaredVoxelCount(kind: string, counts: Record<string, number> | undefined, stepM: number): number | undefined {
  if (!counts || typeof counts !== 'object') return undefined;
  const fixedModelGrid = kind === 'instance-voxel-grid' || kind === 'voxel-evidence-overlay';
  const values = Object.values(counts);
  const count = fixedModelGrid ? (values.length === 1 ? values[0] : undefined) : counts[String(stepM)];
  return Number.isSafeInteger(count) && count! >= 0 ? count : undefined;
}

/** Display budget only: source resolution and saved cells never change. */
export function e22DisplayedVoxelCount(total: number, limit?: number): number {
  if (!Number.isSafeInteger(total) || total < 0) return 0;
  return Math.max(0, Math.min(total, E22_MAX_RENDER_CELLS, Number.isFinite(limit) ? Math.round(limit!) : 50_000));
}
