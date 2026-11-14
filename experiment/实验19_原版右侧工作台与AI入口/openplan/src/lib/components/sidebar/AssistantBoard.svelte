<script lang="ts">
  import { t } from '$lib/i18n';
  import { get } from 'svelte/store';
  import { activeFloor, currentProject, afterUndoGroup, applyExternalProject, selectedElementId, selectedRoomId } from '$lib/stores/project';
  import { applyAgentOps } from '$lib/utils/agentOps';
  import { layoutRevision, layoutToAgentOps, previewLayout, type LayoutPreset, type LayoutProposal } from '$lib/utils/layoutAssistant';
  import { layoutRecipes } from '$lib/ai/layouts';

  let { mode, draft = $bindable('') }: { mode: '2d' | '3d'; draft: string } = $props();
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let preset = $state<LayoutPreset>('living');
  let catalogId = $state('sofa');
  let clearanceCm = $state(15);
  let preview = $state.raw<LayoutProposal | null>(null);
  let layoutError = $state('');
  let applying = $state(false);
  const demoItems = [
    { id: 'sofa', name: 'Sofa' }, { id: 'chair', name: 'Armchair' }, { id: 'fridge', name: 'Fridge' },
    { id: 'bed_queen', name: 'Queen bed' }, { id: 'desk', name: 'Desk' },
    { id: 'dining_table', name: 'Dining table' }, { id: 'floor_lamp', name: 'Floor lamp' },
  ];
  let previewStale = $derived.by(() => {
    if (!preview) return false;
    if (!$currentProject || $currentProject.id !== preview.projectId || $currentProject.activeFloorId !== preview.floorId) return true;
    try { return layoutRevision($currentProject, preview.floorId) !== preview.revision; }
    catch { return true; }
  });

  function makePreview() {
    layoutError = '';
    preview = null;
    const project = get(currentProject);
    if (!project) { layoutError = $t('workbench.noProject'); return; }
    try { preview = previewLayout(project, { preset, catalogId, clearanceCm }); }
    catch (error) { layoutError = error instanceof Error ? error.message : String(error); }
  }

  async function applyPreview() {
    if (!preview || previewStale || applying) return;
    const proposal = preview;
    applying = true;
    layoutError = '';
    try {
      await afterUndoGroup(() => {
        const project = get(currentProject);
        if (!project || project.id !== proposal.projectId || project.activeFloorId !== proposal.floorId ||
          layoutRevision(project, proposal.floorId) !== proposal.revision)
          throw new Error($t('workbench.stalePreview'));
        const { project: next, changed } = applyAgentOps(project, layoutToAgentOps(proposal));
        if (!applyExternalProject(next, $t('workbench.undoLabel'))) throw new Error($t('workbench.applyFailed'));
        selectedRoomId.set(null);
        selectedElementId.set(changed[changed.length - 1] ?? null);
      }, 10_000);
      preview = null;
    } catch (error) { layoutError = error instanceof Error ? error.message : String(error); }
    finally { applying = false; }
  }

  function buildBrief(): string {
    const floor = $activeFloor;
    const project = $currentProject;
    const furniture = (floor?.furniture ?? []).slice(0, 80).map(item =>
      '- ' + item.catalogId + ': x=' + Math.round(item.position.x) + 'cm, y=' +
      Math.round(item.position.y) + 'cm, rotation=' + Math.round(item.rotation) + '°'
    );
    return [
      $t('workbench.briefHeading'),
      'Project: ' + (project?.name ?? 'Untitled Project'),
      'Floor: ' + (floor?.name ?? '—'),
      'View: ' + mode.toUpperCase(),
      'Geometry: ' + (floor?.walls.length ?? 0) + ' walls, ' + (floor?.doors.length ?? 0) +
        ' doors, ' + (floor?.windows.length ?? 0) + ' windows, ' + (floor?.furniture.length ?? 0) + ' furniture items.',
      ...furniture,
      furniture.length < (floor?.furniture.length ?? 0) ? '- [Additional furniture omitted]' : '',
      '',
      $t('workbench.requestHeading'),
      draft.trim(),
      '',
      $t('workbench.briefCaution'),
    ].filter(Boolean).join(String.fromCharCode(10));
  }

  async function copyBrief() {
    if (!draft.trim()) return;
    try {
      await navigator.clipboard.writeText(buildBrief());
      copyState = 'copied';
    } catch { copyState = 'failed'; }
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void copyBrief();
    }
  }
</script>

<div class="assistant-board">
  <div class="assistant-head">
    <p class="assistant-overline">{$t('workbench.title')}</p>
    <div class="assistant-heading"><h2>{$t('workbench.assistant')}</h2><span>{$t('workbench.localDraft')}</span></div>
    <p>{$t('workbench.assistantHelp')}</p>
  </div>
  <div class="assistant-body">
    <section class="layout-tool" aria-label={$t('workbench.layoutTitle')}>
      <div class="layout-heading"><span class="layout-number" aria-hidden="true">⌖</span><div><h3>{$t('workbench.layoutTitle')}</h3><p>{$t('workbench.layoutHelp')}</p></div></div>
      <div class="layout-fields">
        <div class="layout-field"><label for="studio-layout-preset">{$t('workbench.layoutPreset')}</label>
          <select id="studio-layout-preset" bind:value={preset} onchange={() => { preview = null; layoutError = ''; }}>
            {#each layoutRecipes as recipe}<option value={recipe.id}>{recipe.label}</option>{/each}
            <option value="single">{$t('workbench.presetSingle')}</option>
          </select>
        </div>
        {#if preset === 'single'}
          <div class="layout-field"><label for="studio-layout-item">{$t('workbench.chooseObject')}</label>
            <select id="studio-layout-item" bind:value={catalogId} onchange={() => { preview = null; layoutError = ''; }}>
              {#each demoItems as item}<option value={item.id}>{item.name}</option>{/each}
            </select>
          </div>
        {/if}
        <div class="layout-field"><label for="studio-layout-clearance">{$t('workbench.clearance')}</label>
          <input id="studio-layout-clearance" type="number" min="0" max="80" step="5" bind:value={clearanceCm} oninput={() => { preview = null; layoutError = ''; }} />
        </div>
      </div>
      <button type="button" class="layout-preview-button" onclick={makePreview}>{$t('workbench.previewLayout')}</button>
      {#if preview}
        <div class="layout-preview" role="status">
          <div class="preview-title"><span>{$t('workbench.previewTitle')}</span><strong>{preview.placements.length} {$t('workbench.furniture')}</strong></div>
          {#each preview.placements as item}
            <div class="preview-item"><span>{item.name}</span><span>{item.position.x}, {item.position.y} cm · {item.rotation}°</span></div>
          {/each}
          <p>{$t('workbench.layoutLimit')}</p>
          {#if previewStale}<p class="layout-stale">{$t('workbench.stalePreview')}</p>{/if}
          <button type="button" class="layout-apply-button" disabled={previewStale || applying} onclick={() => void applyPreview()}>{applying ? $t('workbench.applying') : $t('workbench.applyLayout')}</button>
        </div>
      {/if}
      {#if layoutError}<p class="layout-error" role="alert">{layoutError}</p>{/if}
    </section>
    <div class="assistant-divider"></div>
    <div class="assistant-symbol" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M8 8 16 16 24 8M16 16v9"/><circle cx="8" cy="8" r="3"/><circle cx="24" cy="8" r="3"/><circle cx="16" cy="25" r="3"/><circle cx="16" cy="16" r="3"/></svg></div>
    <h3>{$t('workbench.aiPromptTitle')}</h3>
    <p>{$t('workbench.aiPromptHelp')}</p>
    <div class="assistant-context"><span class="context-light"></span>{$currentProject?.name ?? 'OpenPlan3D'}<span>／</span>{$activeFloor?.name ?? '—'}<span>／</span>{mode.toUpperCase()}</div>
    <div class="assistant-suggestions" aria-label={$t('workbench.suggestions')}>
      <button type="button" onclick={() => { draft = $t('workbench.suggestionLayout'); copyState = 'idle'; }}>{$t('workbench.suggestionLayout')}</button>
      <button type="button" onclick={() => { draft = $t('workbench.suggestionClearance'); copyState = 'idle'; }}>{$t('workbench.suggestionClearance')}</button>
      <button type="button" onclick={() => { draft = $t('workbench.suggestionLight'); copyState = 'idle'; }}>{$t('workbench.suggestionLight')}</button>
    </div>
  <form class="assistant-composer" onsubmit={(event) => { event.preventDefault(); void copyBrief(); }}>
    <label for="studio-ai-draft">{$t('workbench.promptLabel')}</label>
    <textarea id="studio-ai-draft" rows="5" maxlength="4000" bind:value={draft} oninput={() => copyState = 'idle'} onkeydown={onComposerKeydown} placeholder={$t('workbench.promptPlaceholder')}></textarea>
    <div class="composer-actions"><span>{draft.length} / 4000</span><button type="submit" disabled={!draft.trim()}>{$t('workbench.copyBrief')} <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 9h12m-5-5 5 5-5 5"/></svg></button></div>
    {#if copyState === 'copied'}<p role="status" class="copy-status">{$t('workbench.copied')}</p>{/if}
    {#if copyState === 'failed'}<p role="alert" class="copy-error">{$t('workbench.copyFailed')}</p>{/if}
  </form>
  </div>
</div>

<style>
  .assistant-board{height:100%;min-height:0;display:flex;flex-direction:column;color:#eeeae3}
  .assistant-head{position:relative;padding:25px 22px 20px;border-bottom:1px solid #ffffff16;background:linear-gradient(115deg,#d3b77b0c,transparent 67%)}
  .assistant-head::after{content:'';position:absolute;bottom:-1px;left:22px;width:46px;height:1px;background:#d1b477}
  .assistant-overline{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#c7b78f;margin:0 0 9px}
  .assistant-heading{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .assistant-heading h2{font-size:21px;font-weight:500;line-height:1.2;letter-spacing:-.025em;margin:0}
  .assistant-heading span{border:1px solid #c1a9775e;color:#e0c99e;font-size:9px;border-radius:3px;padding:4px 6px;white-space:nowrap;background:#c1a97713}
  .assistant-head>p:last-child{color:#aeb9b1;font-size:11px;line-height:1.6;margin:0}
  .assistant-body{flex:1;min-height:0;overflow-y:auto;padding:23px 22px 18px;scrollbar-color:#58665b transparent;scrollbar-width:thin}
  .layout-tool{padding-bottom:22px;border-bottom:1px solid #ffffff1b}
  .layout-heading{display:flex;gap:11px;align-items:start;margin-bottom:16px}
  .layout-number{display:grid;place-items:center;flex:none;width:27px;height:27px;border:1px solid #c3aa756b;border-radius:4px;color:#ead39e;background:#c3aa7512;font-size:19px;line-height:1}
  .layout-heading h3{margin:1px 0 5px;font-size:15px}.layout-heading p{margin:0;color:#aab6ab;font-size:11px;line-height:1.5}
  .layout-fields{display:grid;grid-template-columns:1fr 88px;gap:10px}
  .layout-field{min-width:0}.layout-field:nth-child(2):not(:last-child){grid-column:1 / -1}
  .layout-fields :is(select,input){display:block;width:100%;height:36px;margin-top:6px;padding:0 9px;border:1px solid #ffffff35;border-radius:4px;background:#11191ab8;color:#e7e9e4;font:12px Inter,ui-sans-serif,system-ui,sans-serif}
  .layout-fields :is(select,input):focus{outline:none;border-color:#cbb280;box-shadow:0 0 0 2px #cbb28026}
  .layout-preview-button,.layout-apply-button{width:100%;margin-top:12px;padding:10px 12px;border:1px solid #bba57680;border-radius:4px;background:linear-gradient(110deg,#c8aa7029,#c8aa700f);color:#f2ddae;font-size:11px;font-weight:600;cursor:pointer;transition:background .16s,border-color .16s}
  .layout-preview-button:hover,.layout-apply-button:hover:not(:disabled){background:#c8aa7033;border-color:#dbbe87}
  .layout-preview{margin-top:14px;padding:12px;border:1px solid #ffffff22;border-left-color:#bba5768c;border-radius:4px;background:linear-gradient(150deg,#ffffff0b,#ffffff03)}
  .preview-title,.preview-item{display:flex;justify-content:space-between;gap:8px}.preview-title{font-size:11px;color:#d6d9d3;margin-bottom:8px}.preview-title strong{font-weight:500;color:#dac495}
  .preview-item{padding:6px 0;border-top:1px solid #ffffff19;color:#dce2d9;font-size:10px}.preview-item span:last-child{color:#aab8ae;white-space:nowrap}
  .layout-preview>p{font-size:10px;line-height:1.5;color:#aab7ac;margin:9px 0 0}.layout-preview>p.layout-stale{color:#f1b19e}
  .layout-apply-button{background:#e6decf;color:#1b201f;border-color:#e6decf}.layout-apply-button:hover:not(:disabled){background:#f1e8d7}.layout-apply-button:disabled{opacity:.5;cursor:not-allowed}
  .layout-error{color:#efa99e;font-size:11px;line-height:1.5;margin:12px 0 0}
  .assistant-divider{height:0;margin:0 0 24px}
  .assistant-symbol{width:39px;height:39px;border:1px solid #c0a7736b;border-radius:4px;display:grid;place-items:center;background:radial-gradient(circle at 30% 15%,#c0a77328,#c0a77308);color:#e8ce96;margin-bottom:18px;box-shadow:0 0 22px #c3a56a14}
  .assistant-symbol svg{width:27px;height:27px}
  h3{font-size:17px;letter-spacing:-.02em;font-weight:500;line-height:1.25;margin:0 0 8px}
  .assistant-body>p{font-size:12px;line-height:1.65;color:#aeb9b1;margin:0 0 20px}
  .assistant-context{display:flex;align-items:center;gap:6px;color:#d0d9cf;font-size:10px;border:1px solid #ffffff20;border-left:2px solid #c3aa76;background:linear-gradient(90deg,#c3aa7615,#ffffff05);border-radius:3px;padding:10px 11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .assistant-context>span:not(.context-light){color:#596461}
  .context-light{width:6px;height:6px;flex:none;border-radius:50%;background:#d0b78a;box-shadow:0 0 0 3px #d0b78a21}
  .assistant-suggestions{display:flex;flex-direction:column;gap:8px;margin-top:20px}
  .assistant-suggestions button{background:linear-gradient(90deg,#ffffff09,transparent);color:#dde3da;border:1px solid #ffffff1c;border-radius:3px;padding:11px 12px;text-align:left;font-size:11px;line-height:1.4;cursor:pointer;transition:background .16s,border-color .16s}
  .assistant-suggestions button:hover{background:linear-gradient(90deg,#c5ad7923,transparent);border-color:#c5ad7966}
  .assistant-composer{margin-top:25px;padding:17px 0 8px;border-top:1px solid #ffffff1d;background:transparent}
  label{display:block;color:#c0cbc0;font-size:11px;margin-bottom:9px}
  textarea{display:block;width:100%;resize:vertical;max-height:180px;min-height:88px;border:1px solid #ffffff35;border-radius:4px;background:#11191ab8;color:#f0efea;padding:11px 12px;font:12px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;outline:none}
  textarea::placeholder{color:#96a49a}
  textarea:focus{border-color:#cbb88f;box-shadow:0 0 0 2px #cbb88f24}
  .composer-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:11px;color:#a3b0a5;font-size:10px}
  .composer-actions button{display:inline-flex;align-items:center;gap:7px;padding:9px 12px;border:1px solid #e0d7c4;border-radius:4px;background:#e6decf;color:#1b201f;font-size:11px;font-weight:600;cursor:pointer}
  .composer-actions button:hover:not(:disabled){background:#f1e8d7}
  .composer-actions button:disabled{opacity:.42;cursor:not-allowed}
  .composer-actions svg{width:15px;height:15px}
  .copy-status,.copy-error{margin:9px 0 0;font-size:11px;line-height:1.4}
  .copy-status{color:#c5d6bd}.copy-error{color:#efaca5}
</style>
