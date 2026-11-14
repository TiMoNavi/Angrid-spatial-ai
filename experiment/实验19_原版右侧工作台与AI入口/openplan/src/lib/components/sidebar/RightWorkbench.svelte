<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import { activeFloor, currentProject, selectedElementId, selectedRoomId } from '$lib/stores/project';
  import PropertiesPanel from './PropertiesPanel.svelte';
  import LayersPanel from './LayersPanel.svelte';
  import AssistantBoard from './AssistantBoard.svelte';

  type PanelTab = 'inspector' | 'layers' | 'assistant';
  let { mode, tab = $bindable('inspector'), collapsed = $bindable(false) }: {
    mode: '2d' | '3d'; tab: PanelTab; collapsed: boolean;
  } = $props();

  const tabs: PanelTab[] = ['inspector', 'layers', 'assistant'];
  let restored = $state(false);
  let assistantDraft = $state('');
  let hasInspectorTarget = $derived(Boolean($selectedElementId || $selectedRoomId || ($activeFloor?.backgroundImage && mode === '2d')));
  let sceneCount = $derived(($activeFloor?.walls.length ?? 0) + ($activeFloor?.doors.length ?? 0) +
    ($activeFloor?.windows.length ?? 0) + ($activeFloor?.furniture.length ?? 0) +
    ($activeFloor?.stairs.length ?? 0) + ($activeFloor?.columns.length ?? 0));

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('o3d-workbench-v1') || 'null');
      if (tabs.includes(saved?.tab)) tab = saved.tab;
      if (typeof saved?.collapsed === 'boolean') collapsed = saved.collapsed;
      else if (window.matchMedia('(max-width: 999px)').matches) collapsed = true;
    } catch { /* Workbench remains usable when storage is unavailable. */ }
    restored = true;
  });

  $effect(() => {
    if (!restored) return;
    try { localStorage.setItem('o3d-workbench-v1', JSON.stringify({ tab, collapsed })); }
    catch { /* Keep the in-memory state. */ }
  });

  function selectTab(next: PanelTab) {
    tab = next;
    collapsed = false;
  }

  function onTabKeydown(event: KeyboardEvent) {
    const index = tabs.indexOf(tab);
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[next]);
    document.getElementById('studio-tab-' + tabs[next])?.focus();
  }
</script>

<aside class="studio-workbench" class:collapsed data-studio-workbench aria-label={$t('workbench.title')}>
  <div class="studio-rail">
    <div class="studio-rail-mark" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="studio-tabs" role="tablist" aria-orientation="vertical" aria-label={$t('workbench.title')} tabindex="-1" onkeydown={onTabKeydown}>
      {#each tabs as item}
        <button
          id={'studio-tab-' + item}
          type="button"
          role="tab"
          aria-selected={tab === item}
          aria-controls={'studio-panel-' + item}
          aria-label={$t(item === 'inspector' ? 'workbench.inspector' : item === 'layers' ? 'workbench.layers' : 'workbench.assistant')}
          title={$t(item === 'inspector' ? 'workbench.inspector' : item === 'layers' ? 'workbench.layers' : 'workbench.assistant')}
          tabindex={tab === item ? 0 : -1}
          class:active={tab === item}
          onclick={() => selectTab(item)}
        >
          {#if item === 'inspector'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h4"/></svg>
          {:else if item === 'layers'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4-5.7-1.8L10.2 9 12 3.5ZM19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6L19 17Z"/></svg>
          {/if}
          <span class="rail-label">{$t(item === 'inspector' ? 'workbench.inspector' : item === 'layers' ? 'workbench.layers' : 'workbench.assistant')}</span>
        </button>
      {/each}
    </div>
    <button type="button" class="studio-collapse" aria-label={collapsed ? $t('workbench.expand') : $t('workbench.collapse')} aria-expanded={!collapsed} title={collapsed ? $t('workbench.expand') : $t('workbench.collapse')} onclick={() => collapsed = !collapsed}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={collapsed ? 'm14 6-6 6 6 6' : 'm10 6 6 6-6 6'} /></svg>
    </button>
  </div>

  {#if !collapsed}
    <div class="studio-content">
      {#if tab === 'inspector'}
        <div id="studio-panel-inspector" role="tabpanel" aria-labelledby="studio-tab-inspector" class="studio-panel">
          <div class="studio-panel-head">
            <p class="studio-overline">{$t('workbench.title')}</p>
            <h2>{$t('workbench.inspector')}</h2>
            <p>{$t('workbench.inspectorHelp')}</p>
          </div>
          {#if !hasInspectorTarget}
            <div class="studio-empty" aria-hidden="true"><span class="studio-empty-glyph">⌖</span><span>{$t('workbench.selectHint')}</span></div>
          {/if}
          <PropertiesPanel is3D={mode === '3d'} embedded />
        </div>
      {:else if tab === 'layers'}
        <div id="studio-panel-layers" role="tabpanel" aria-labelledby="studio-tab-layers" class="studio-panel">
          <div class="studio-panel-head">
            <p class="studio-overline">{$t('workbench.title')}</p>
            <h2>{$t('workbench.layers')}</h2>
            <p>{$t('workbench.layersHelp')}</p>
          </div>
          <div class="studio-scene-stats">
            <span><strong>{sceneCount}</strong>{$t('workbench.elements')}</span>
            <span><strong>{$activeFloor?.furniture.length ?? 0}</strong>{$t('workbench.furniture')}</span>
          </div>
          <div class="studio-scene-name">{$currentProject?.name ?? 'OpenPlan3D'} <span>／ {$activeFloor?.name ?? '—'}</span></div>
          <LayersPanel embedded />
        </div>
      {:else}
        <div id="studio-panel-assistant" role="tabpanel" aria-labelledby="studio-tab-assistant" class="studio-panel">
          <AssistantBoard {mode} bind:draft={assistantDraft} />
        </div>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .studio-workbench{--ink:#eeeae0;--muted:#aeb9b1;--line:#ffffff16;--surface:#171d1e;display:flex;flex:none;width:358px;min-width:0;height:100%;background:#151b1c;color:var(--ink);border-left:1px solid #9b9d8459;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;box-shadow:inset 1px 0 #ffffff12,-12px 0 36px #080e113d;z-index:3;transition:width .22s ease}
  .studio-workbench.collapsed{width:58px}
  .studio-rail{width:58px;flex:none;display:flex;flex-direction:column;align-items:center;border-right:1px solid #ffffff18;background:linear-gradient(160deg,#1c2525 0%,#151c1d 43%,#101617 100%);padding:16px 6px 10px}
  .studio-rail-mark{width:28px;height:28px;display:grid;grid-template-columns:repeat(2,5px);grid-template-rows:repeat(2,5px);place-content:center;gap:4px;border:1px solid #b6aa865c;border-radius:5px;margin:0 0 27px;background:linear-gradient(145deg,#c5a96f15,#ffffff04);box-shadow:inset 0 1px #ffffff14}
  .studio-rail-mark span{display:block;border:1px solid #cbb789;border-radius:1px}
  .studio-tabs{width:100%;display:flex;flex-direction:column;gap:6px}
  .studio-tabs button,.studio-collapse{width:44px;min-height:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:1px solid transparent;border-radius:5px;background:transparent;color:#aeb8b1;cursor:pointer;transition:background .16s,color .16s,box-shadow .16s}
  .studio-tabs button:hover,.studio-collapse:hover{color:#f5eee0;background:#ffffff0d}
  .studio-tabs button.active{color:#f2d9a2;background:linear-gradient(90deg,#c6ab7230,#bda4700d 77%,transparent);border-color:transparent;box-shadow:inset 2px 0 0 #d9bd84}
  .studio-tabs svg,.studio-collapse svg{width:19px;height:19px}
  .rail-label{font-size:10px;line-height:1;white-space:nowrap;max-width:42px;overflow:hidden;text-overflow:ellipsis}
  .studio-collapse{margin-top:auto;border-top:1px solid var(--line);border-radius:0;min-height:42px}
  .studio-content{width:300px;min-width:0;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(ellipse at 100% 0%,#bd9d6420,transparent 35%),radial-gradient(ellipse at 0% 83%,#526a5a1c,transparent 43%),linear-gradient(155deg,#1e2727 0%,#171e1f 48%,#12191a 100%)}
  .studio-panel{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  .studio-panel-head{position:relative;padding:25px 22px 20px;border-bottom:1px solid var(--line);background:linear-gradient(115deg,#d3b77b0c,transparent 67%)}
  .studio-panel-head::after{content:'';position:absolute;bottom:-1px;left:22px;width:46px;height:1px;background:#d1b477}
  .studio-overline{font-size:10px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;color:#c7b78f;margin:0 0 9px}
  .studio-panel-head h2{font-size:21px;line-height:1.18;font-weight:500;letter-spacing:-.025em;margin:0 0 7px;color:#f1eee6}
  .studio-panel-head>p:last-child{font-size:11px;line-height:1.6;color:var(--muted);margin:0}
  .studio-empty{margin:22px 22px 8px;min-height:135px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:19px;color:var(--muted);font-size:12px;line-height:1.5;background:radial-gradient(ellipse at 50% 0%,#ccae7614,transparent 73%),linear-gradient(145deg,#ffffff07,#ffffff01);border:1px solid #ffffff18;border-left-color:#c7af765e;border-radius:4px}
  .studio-empty-glyph{font-size:37px;line-height:1;font-weight:200;color:#dcc89c}
  .studio-scene-stats{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:17px 21px 0;padding:3px 0 13px;border-bottom:1px solid #ffffff1c}
  .studio-scene-stats span{display:flex;flex-direction:column;gap:5px;padding:8px 0;color:var(--muted);font-size:11px}
  .studio-scene-stats span+span{padding-left:16px;border-left:1px solid #ffffff1c}
  .studio-scene-stats strong{color:#e6d5b3;font-size:24px;font-weight:400;line-height:1}
  .studio-scene-name{padding:12px 21px;color:#d9ddd6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .studio-scene-name span{color:var(--muted)}
  :global(.studio-workbench :focus-visible){outline:2px solid #dfc38c;outline-offset:2px}
  @media(max-width:767px){.studio-workbench{position:fixed;right:0;top:48px;bottom:0;height:auto;width:min(358px,calc(100vw - 26px));z-index:39}.studio-workbench.collapsed{top:58px;bottom:auto;width:58px;height:248px;border:1px solid var(--line);border-radius:12px 0 0 12px;box-shadow:0 10px 30px #0005}.studio-rail{padding-top:10px}.studio-rail-mark{margin-bottom:12px}.studio-collapse{margin-top:12px}}
  @media(prefers-reduced-motion:reduce){.studio-workbench{transition:none}}
</style>
