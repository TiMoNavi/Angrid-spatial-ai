<script lang="ts">
  import { furnitureName } from '$lib/i18n/furnitureNames';
  import { t, locale } from '$lib/i18n';
  import { base } from '$app/paths';
  import { entourageLabels } from '$lib/i18n/entourageLabels';
  import { catalogCategoryLabels, normalizeCatalogSearch } from '$lib/i18n/catalogCategories';
  import { roomPresetLabels, roomTemplateLabels } from '$lib/i18n/roomLabels';
  import { modalDialog } from '$lib/utils/modalDialog';
  import { openProject } from '$lib/services/projectOpening';
  import ImportError from '$lib/components/ImportError.svelte';
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { activateMeasurementTool, selectedTool, placingFurnitureId, placingDoorType, placingWindowType, placingStair, addStair, placingColumn, placingColumnShape, activeFloor, setBackgroundImage, canvasCamX, canvasCamY, placingEntourageId, addCustomEntourage, viewMode } from '$lib/stores/project';
  import type { Tool } from '$lib/stores/project';
  import { toggleColumnPlacement, toggleStairPlacement } from '$lib/utils/placementArming';
  import type { Door, Window as Win, CustomEntourageDef } from '$lib/models/types';
  import { entourageCatalog, entourageCategories } from '$lib/utils/entourageCatalog';
  import { roomPresets, placePreset } from '$lib/utils/roomPresets';
  import { roomTemplates, placeRoomTemplate } from '$lib/utils/roomTemplates';
  import { furnitureCatalog, furnitureCategories } from '$lib/utils/furnitureCatalog';
  import type { FurnitureDef } from '$lib/utils/furnitureCatalog';
  import FurnitureThumbnail from './FurnitureThumbnail.svelte';
  import CustomModelPanel from './CustomModelPanel.svelte';
  import { createProjectFromRoomPlan, extractRoomJsonFromZip, importRoomPlanFloors, interchangeStateFromRoomPlan, roomPlanImportOptions, validateRoomPlan, ORTHO_VERSION } from '$lib/utils/roomplanImport';
  import { addRoomPlanFloorsToProject, currentProject, selectImportedElements } from '$lib/stores/project';
  import { selectableContentIds, type AddedContent } from '$lib/utils/roomplanMerge';
  import { interchangeProjectName } from '$lib/utils/interchange';
  import { createProjectFromE22FloorPlan, validateE22FloorPlan } from '$lib/utils/e22FloorPlanImport';
  import { attachE22Scan } from '$lib/stores/e22Scan';

  let { mode = '2d' }: { mode?: '2d' | '3d' } = $props();

  const openingLifetime = new AbortController();
  onDestroy(() => openingLifetime.abort());

  let importError = $state<string | null>(null);
  let largeImageWarning = $state(false);
  let unsupportedImage = $state(false);

  // AreaSummaryPanel moved to top bar dialog
  let activeTab = $state<'draw' | 'rooms' | 'objects'>('draw');
  // The 3D viewer only consumes furniture placement. Keep 2D drawing tools out
  // of its sidebar instead of showing controls that have no 3D receiver.
  $effect(() => { activeTab = mode === '3d' ? 'objects' : 'draw'; });
  let constructionOpen = $state(true);
  let selectedCategory = $state<string>('All');
  // RoomPlan import dialog state
  let showImportDialog = $state(false);
  let importFileName = $state('');
  // Raw, not deep state: the import structured-clones parts of the scan, and a reactive proxy cannot be cloned.
  let importJsonData: any = $state.raw(null);
  let optStraighten = $state(true);
  let optOrthogonal = $state(true);
  let optMergeDistance = $state(15);
  /** 'add' stitches the scan into the open plan (issue #103); 'new' opens it as its own project. */
  let importTarget = $state<'new' | 'add'>('new');

  type E22ScanSummary = { scanId: string; roomIndex: number; manifestUrl: string; floorPlanUrl: string };
  let showE22Dialog = $state(false);
  let e22File = $state.raw<File | null>(null);
  let e22Scans = $state<E22ScanSummary[]>([]);
  let e22Rooms = $state<number[]>([]);
  let e22Busy = $state(false);
  let e22Listing = $state(false);
  let e22Error = $state<string | null>(null);

  async function openE22Dialog() {
    showE22Dialog = true;
    e22Error = null;
    e22Listing = true;
    try {
      const response = await fetch(base + '/api/e22-scans');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not list processed scans.');
      e22Scans = Array.isArray(data.scans) ? data.scans : [];
    } catch (error) {
      e22Error = error instanceof Error ? error.message : String(error);
    } finally { e22Listing = false; }
  }

  function pickE22File(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    e22File = input.files?.[0] ?? null;
    input.value = '';
    e22Rooms = [];
    e22Error = null;
  }

  async function openE22Scan(scan: E22ScanSummary) {
    e22Busy = true;
    e22Error = null;
    try {
      const [planResponse, manifestResponse] = await Promise.all([
        fetch(scan.floorPlanUrl), fetch(scan.manifestUrl),
      ]);
      if (!planResponse.ok || !manifestResponse.ok) throw new Error('The processed scan assets could not be read.');
      const [plan, manifest] = await Promise.all([planResponse.json(), manifestResponse.json()]);
      validateE22FloorPlan(plan);
      if (plan.scanId !== scan.scanId || plan.roomIndex !== scan.roomIndex ||
          manifest.scanId !== scan.scanId || manifest.roomIndex !== scan.roomIndex ||
          manifest.transformHash !== plan.transformHash || manifest.convertedHash !== plan.convertedHash) {
        throw new Error('The floor plan and scan layers do not belong to the same room.');
      }
      const opened = await openProject(
        () => createProjectFromE22FloorPlan(plan, 'iPhone Scan ' + scan.scanId),
        'import', openingLifetime.signal,
      );
      if (!opened) return;
      attachE22Scan({ projectId: opened.id, scanId: scan.scanId, roomIndex: scan.roomIndex,
        manifestUrl: scan.manifestUrl, floorPlanUrl: scan.floorPlanUrl,
        transformHash: plan.transformHash });
      showE22Dialog = false;
      e22File = null;
      e22Rooms = [];
      viewMode.set('3d');
    } catch (error) {
      e22Error = error instanceof Error ? error.message : String(error);
    } finally { e22Busy = false; }
  }

  async function processE22File(roomIndex?: number) {
    if (!e22File || e22Busy) return;
    e22Busy = true;
    e22Error = null;
    try {
      const query = roomIndex === undefined ? '' : '?roomIndex=' + roomIndex;
      const response = await fetch(base + '/api/e22-scans' + query, {
        method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: e22File,
      });
      const data = await response.json();
      if (response.status === 422 && roomIndex === undefined && Array.isArray(data.rooms) && data.rooms.length > 1) {
        e22Rooms = data.rooms.map((room: { index: number }) => room.index).filter(Number.isSafeInteger);
        return;
      }
      if (!response.ok) throw new Error(data.error || 'Scan processing failed.');
      e22Busy = false;
      await openE22Scan(data as E22ScanSummary);
    } catch (error) {
      e22Error = error instanceof Error ? error.message : String(error);
    } finally { e22Busy = false; }
  }

  function setTool(tool: Tool) {
    if (tool === 'measure' || tool === 'annotate') activateMeasurementTool(tool);
    else selectedTool.set(tool);
    placingFurnitureId.set(null);
  }

  let currentTool = $state<Tool>('select');
  onDestroy(selectedTool.subscribe((t) => { currentTool = t; }));

  let currentPlacing = $state<string | null>(null);
  onDestroy(placingFurnitureId.subscribe((id) => { currentPlacing = id; }));

  function onPresetClick(presetId: string, templateName?: string) {
    const preset = roomPresets.find(p => p.id === presetId);
    if (preset) {
      let cx = 0, cy = 0;
      canvasCamX.subscribe(v => { cx = v; })();
      canvasCamY.subscribe(v => { cy = v; })();
      const template = templateName ? roomTemplates.find(t => t.name === templateName) ?? null : null;
      placeRoomTemplate(preset, { x: cx, y: cy }, template);
    }
  }

  function onFurnitureClick(item: FurnitureDef) {
    selectedTool.set('furniture');
    placingFurnitureId.set(item.id);
    addToRecent(item.id);
  }

  function onFurnitureDragStart(event: DragEvent, item: FurnitureDef) {
    event.dataTransfer?.setData('application/o3d-type', 'furniture');
    event.dataTransfer?.setData('application/o3d-id', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    // Dragover cannot read DataTransfer payloads in every browser. The shared
    // placement state lets the 3D viewer show the correct model while dragging.
    placingFurnitureId.set(item.id);
  }

  function onFurnitureDragEnd(id: string) {
    // A successful drop clears this state in the receiving canvas. A cancelled
    // drag must also remove its preview without cancelling a newer selection.
    if (get(placingFurnitureId) === id) placingFurnitureId.set(null);
  }

  let withFurniture = $state(true);

  let search = $state('');

  // --- Recent Items (localStorage) ---
  const RECENT_KEY = 'o3d_recent_furniture';
  const MAX_RECENT = 10;
  let recentIds = $state<string[]>((() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  })());

  function addToRecent(id: string) {
    recentIds = [id, ...recentIds.filter(r => r !== id)].slice(0, MAX_RECENT);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds)); } catch { /* Blocked or full storage: the list lasts for this session. */ }
  }

  let recentItems = $derived(
    recentIds.map(id => furnitureCatalog.find(f => f.id === id)).filter(Boolean) as FurnitureDef[]
  );

  // --- Favorites (localStorage) ---
  const FAV_KEY = 'o3d_favorite_furniture';
  let favoriteIds = $state<string[]>((() => {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
  })());

  function toggleFavorite(id: string) {
    if (favoriteIds.includes(id)) {
      favoriteIds = favoriteIds.filter(f => f !== id);
    } else {
      favoriteIds = [...favoriteIds, id];
    }
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favoriteIds)); } catch { /* Blocked or full storage: favorites last for this session. */ }
  }

  let favoriteItems = $derived(
    favoriteIds.map(id => furnitureCatalog.find(f => f.id === id)).filter(Boolean) as FurnitureDef[]
  );

  let filtered = $derived(
    (() => {
      const s = normalizeCatalogSearch(search);
      let items = selectedCategory === 'Favorites'
        ? favoriteItems
        : furnitureCatalog.filter((f) => {
            const matchCat = selectedCategory === 'All' || f.category === selectedCategory;
            return matchCat;
          });
      if (s) {
        items = items.filter(f => [f.name, furnitureName(f.id, $locale), f.category, catalogCategoryLabels[f.category] ? $t(catalogCategoryLabels[f.category]) : f.category]
          .some(value => normalizeCatalogSearch(value).includes(s)));
      }
      return items;
    })()
  );

  const doorCatalog: { type: Door['type']; name: string; desc: string; icon: string }[] = $derived([
    { type: 'single', name: $t('openingCatalog.single'), desc: $t('openingCatalog.singleDescription'), icon: 'M6 3h12v18H6z' },
    { type: 'double', name: $t('openingCatalog.double'), desc: $t('openingCatalog.doubleDescription'), icon: 'M3 3h8v18H3zM13 3h8v18h-8z' },
    { type: 'sliding', name: $t('openingCatalog.sliding'), desc: $t('openingCatalog.slidingDescription'), icon: 'M3 6h18v12H3z' },
    { type: 'french', name: $t('openingCatalog.french'), desc: $t('openingCatalog.frenchDescription'), icon: 'M3 3h8v18H3zM13 3h8v18h-8z' },
    { type: 'pocket', name: $t('openingCatalog.pocket'), desc: $t('openingCatalog.pocketDescription'), icon: 'M6 3h12v18H6z' },
    { type: 'bifold', name: $t('openingCatalog.bifold'), desc: $t('openingCatalog.bifoldDescription'), icon: 'M3 3h5v18H3zM9 3h6v18H9zM16 3h5v18h-5z' },
    { type: 'opening', name: $t('openingCatalog.doorway'), desc: $t('openingCatalog.doorwayDescription'), icon: 'M6 3h2v18H6zM16 3h2v18h-2z' },
    { type: 'garage', name: $t('openingCatalog.garage'), desc: $t('openingCatalog.garageDescription'), icon: 'M3 5h18v14H3zM5 9h14M5 13h14M5 17h14' },
  ]);

  const windowCatalog: { type: Win['type']; name: string; desc: string }[] = $derived([
    { type: 'standard', name: $t('openingCatalog.standard'), desc: '120×120cm' },
    { type: 'fixed', name: $t('openingCatalog.fixed'), desc: '100×100cm' },
    { type: 'casement', name: $t('openingCatalog.casement'), desc: '80×130cm' },
    { type: 'sliding', name: $t('openingCatalog.sliding'), desc: '180×120cm' },
    { type: 'bay', name: $t('openingCatalog.bay'), desc: '200×150cm' },
  ]);

  let selectedDoorType = $state<Door['type']>('single');
  let selectedWindowType = $state<Win['type']>('standard');

  function setDoorType(type: Door['type']) {
    selectedDoorType = type;
    placingDoorType.set(type);
    setTool('door');
  }

  function setWindowType(type: Win['type']) {
    selectedWindowType = type;
    placingWindowType.set(type);
    setTool('window');
  }

  let isPlacingStair = $state(false);
  onDestroy(placingStair.subscribe(v => { isPlacingStair = v; }));

  // Entourage (2D presentation symbols)
  let placingEntId = $state<string | null>(null);
  onDestroy(placingEntourageId.subscribe(v => { placingEntId = v; }));
  let customEntDefs = $state<CustomEntourageDef[]>([]);
  onDestroy(currentProject.subscribe(p => { customEntDefs = p?.customEntourage ?? []; }));
  let entourageFileInput = $state<HTMLInputElement | null>(null);

  function armEntourage(id: string) {
    placingEntourageId.set(placingEntId === id ? null : id);
    setTool('select');
  }

  let symbolUploadError = $state<'tooLarge' | 'readFailed' | 'invalid' | null>(null);

  function onEntourageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    symbolUploadError = null;
    if (file.size > 2 * 1024 * 1024) { symbolUploadError = 'tooLarge'; return; }
    const reader = new FileReader();
    reader.onerror = () => { symbolUploadError = 'readFailed'; };
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => { symbolUploadError = 'invalid'; };
      img.onload = () => {
        const aspect = img.naturalHeight / img.naturalWidth || 1;
        const id = addCustomEntourage(file.name.replace(/\.[^.]+$/, ''), dataUrl, aspect);
        placingEntourageId.set(id);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  let isPlacingColumn = $state(false);
  onDestroy(placingColumn.subscribe(v => { isPlacingColumn = v; }));
  let placingColShape = $state<'round' | 'square'>('round');
  onDestroy(placingColumnShape.subscribe(v => { placingColShape = v; }));
  const columnArmed = (shape: 'round' | 'square') => isPlacingColumn && placingColShape === shape;

  /** PNG, JPEG and GIF reach the iPhone package unchanged; any other decodable pick (WebP, BMP, …) is re-encoded as PNG so the package never drops it. */
  async function tracingImageDataUrl(file: File): Promise<string | undefined> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    if (/^data:image\/(?:png|jpeg|gif);base64,/.test(dataUrl)) return dataUrl;
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    // Bound the canvas so a huge WebP or BMP cannot exhaust memory.
    const scale = Math.min(1, Math.sqrt(24_000_000 / (image.naturalWidth * image.naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    return png.startsWith('data:image/png;base64,') ? png : undefined;
  }

  function onImportImage() {
    const input = document.createElement('input');
    input.type = 'file';
    // The formats a project package shares with iPhone, plus WebP, which is re-encoded as PNG.
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      unsupportedImage = false;
      const dataUrl = await tracingImageDataUrl(file).catch(() => undefined);
      if (!dataUrl) { unsupportedImage = true; return; }
      // A large image still imports; the note under the button replaces the old blocking alert.
      largeImageWarning = dataUrl.length * 3 / 4 > 5 * 1024 * 1024;
      setBackgroundImage({ dataUrl, position: { x: 0, y: 0 }, scale: 1, opacity: 0.4, rotation: 0, locked: false });
    };
    input.click();
  }

  async function onImportRoomPlan() {
    importError = null;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        let jsonData: any;
        if (/\.zip$/i.test(file.name)) {
          jsonData = await extractRoomJsonFromZip(file);
        } else {
          const text = await file.text();
          jsonData = JSON.parse(text);
        }
        validateRoomPlan(jsonData);
        const options = roomPlanImportOptions(jsonData);
        optStraighten = options.straighten ?? true;
        optOrthogonal = options.orthogonal ?? true;
        optMergeDistance = options.mergeDistance ?? 15;
        importJsonData = jsonData;
        importFileName = file.name.replace(/\.(json|zip)$/, '');
        showImportDialog = true;
      } catch (e: any) {
        importError = e.message;
      }
    };
    input.click();
  }

  async function confirmImport() {
    if (!importJsonData) return;
    const input = importJsonData;
    importError = null;
    const options = { straighten: optStraighten, orthogonal: optOrthogonal, mergeDistance: optMergeDistance };
    let added: AddedContent[] = [];
    try {
      if (importTarget === 'add') {
        // Stitch the scan into the open plan beside its current content; one Undo removes it again.
        // The file's sibling block, attributes, defaults and notes travel with the scan.
        added = addRoomPlanFloorsToProject(importRoomPlanFloors(input, options), undefined, interchangeStateFromRoomPlan(input)).added;
        selectAddedContent(added);
      } else {
        // Create a new project for the imported data instead of merging into current
        const projectName = interchangeProjectName(input, importFileName ? importFileName.replace(/\.(json|zip)$/i, '') : 'RoomPlan Import');
        await openProject(() => createProjectFromRoomPlan(input, projectName, options), 'import', openingLifetime.signal);
      }
    } catch (e: any) {
      if (importJsonData === input) importError = e.message;
    }
    if (importJsonData === input) {
      showImportDialog = false;
      importJsonData = null;
      if (added.some(entry => entry.ids.length)) await revealPlan();
    }
  }

  /** Show the stitched scan on its floor and select it, so it can be moved or rotated into place. */
  function selectAddedContent(added: AddedContent[]) {
    const first = added.find(entry => entry.ids.length), project = get(currentProject);
    if (!first || !project) return;
    const floor = project.floors.find(f => f.id === first.floorId);
    // Switches floor when needed and always leaves the select tool active with nothing being placed.
    selectImportedElements(first.floorId, floor ? selectableContentIds(floor, first.ids) : []);
  }

  /** The canvas owns its camera; its Zoom to Fit shortcut shows the plan and the new scan together once the dialog is gone. */
  async function revealPlan() {
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
  }

  function cancelImport() {
    showImportDialog = false;
    importJsonData = null;
  }

  // --- Hover Preview Tooltip ---
  let hoveredItem = $state<FurnitureDef | null>(null);
  let hoverTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
  let hoverPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let showPreview = $state(false);

  function onItemMouseEnter(e: MouseEvent, item: FurnitureDef) {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoveredItem = item;
    updateHoverPos(e);
    hoverTimeout = setTimeout(() => { showPreview = true; }, 300);
  }

  function onItemMouseMove(e: MouseEvent) {
    updateHoverPos(e);
  }

  function onItemMouseLeave() {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    hoverTimeout = null;
    showPreview = false;
    hoveredItem = null;
  }

  function updateHoverPos(e: MouseEvent) {
    const sidebarRight = 256; // w-64 = 16rem = 256px
    const viewportW = window.innerWidth;
    const tooltipW = 220;
    // Position to the right of sidebar, or left if no space
    const x = (sidebarRight + tooltipW + 8) < viewportW ? sidebarRight + 8 : -tooltipW - 8;
    // Vertically align near the mouse, clamped to viewport
    const y = Math.min(Math.max(e.clientY - 40, 8), window.innerHeight - 200);
    hoverPos = { x, y };
  }

  const categoryColors: Record<string, string> = {
    'Living Room': '#a78bfa',
    'Bedroom': '#60a5fa',
    'Kitchen': '#f87171',
    'Bathroom': '#93c5fd',
    'Office': '#34d399',
    'Dining': '#f59e0b',
    'Decor': '#c2956b',
    'Lighting': '#fbbf24',
    'Outdoor Furniture': '#b45309',
    'Landscaping': '#16a34a',
    'Fencing': '#a16207',
    'Structures': '#6b7280',
    'Electrical': '#2563eb',
    'Plumbing': '#0ea5e9',
  };
</script>

<div data-studio-build class="build-panel-studio w-64 bg-white border-r border-gray-200 flex flex-col h-full overflow-hidden">
  <!-- Tabs -->
  <div class="build-tabs flex border-b border-gray-200">
    {#if mode === '2d'}
    <button
      class="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide {activeTab === 'draw' ? 'text-slate-800 border-b-2 border-blue-500 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}"
      aria-pressed={activeTab === 'draw'}
      onclick={() => activeTab = 'draw'}
    >{$t('buildTools.build')}</button>
    <button
      class="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide {activeTab === 'rooms' ? 'text-slate-800 border-b-2 border-blue-500 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}"
      aria-pressed={activeTab === 'rooms'}
      onclick={() => activeTab = 'rooms'}
    >{$t('buildTools.rooms')}</button>
    {/if}
    <button
      class="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide {mode === '3d' || activeTab === 'objects' ? 'text-slate-800 border-b-2 border-blue-500 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}"
      aria-pressed={mode === '3d' || activeTab === 'objects'}
      onclick={() => activeTab = 'objects'}
    >{$t('buildTools.objects')}</button>
  </div>

  <div class="build-body flex-1 overflow-y-auto p-3">
    <button type="button" class="studio-scan-import mb-3 w-full rounded-lg px-3 py-2.5 text-left text-sm" onclick={openE22Dialog}>
      <span class="block font-semibold">导入 iPhone 扫描包</span>
      <span class="block text-xs text-slate-500">实验 22 · 平面图与扫描图层</span>
    </button>
    {#if mode === '2d' && activeTab === 'draw'}
      <div class="space-y-1">
        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2">{$t('buildTools.tools')}</h3>
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {currentTool === 'select' ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
          onclick={() => setTool('select')}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {currentTool === 'select' ? 'bg-blue-100' : ''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.select')} <span class="text-gray-400 text-xs ml-1">V</span></div>
            <div class="text-xs text-gray-400">{$t('buildTools.selectHelp')}</div>
          </div>
        </button>
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {currentTool === 'wall' ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
          onclick={() => setTool('wall')}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {currentTool === 'wall' ? 'bg-blue-100' : ''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="8" rx="1"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="17" y1="8" x2="17" y2="16"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.wall')} <span class="text-gray-400 text-xs ml-1">W</span></div>
            <div class="text-xs text-gray-400">{$t('buildTools.wallHelp')}</div>
          </div>
        </button>

        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3">{$t('buildTools.structure')}</h3>
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {isPlacingStair ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
          aria-pressed={isPlacingStair}
          onclick={toggleStairPlacement}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {isPlacingStair ? 'bg-blue-100' : ''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 5h-5V2h-3v6h-4V5H7v6H2v3h5v3h3v-3h4v3h3v-6h5z"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.stairs')}</div>
            <div class="text-xs text-gray-400">{$t('buildTools.stairsHelp')}</div>
          </div>
        </button>

        <div class="flex gap-2">
          <button
            class="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors {columnArmed('round') ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
            aria-pressed={columnArmed('round')}
            onclick={() => toggleColumnPlacement('round')}
          >
            <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {columnArmed('round') ? 'bg-blue-100' : ''}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6"/><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </div>
            <div class="text-left">
              <div class="font-medium text-xs">{$t('buildTools.round')}</div>
            </div>
          </button>
          <button
            class="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors {columnArmed('square') ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
            aria-pressed={columnArmed('square')}
            onclick={() => toggleColumnPlacement('square')}
          >
            <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {columnArmed('square') ? 'bg-blue-100' : ''}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
            </div>
            <div class="text-left">
              <div class="font-medium text-xs">{$t('buildTools.square')}</div>
            </div>
          </button>
        </div>

        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3">{$t('buildTools.annotate')}</h3>
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {currentTool === 'text' ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
          onclick={() => setTool('text')}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {currentTool === 'text' ? 'bg-blue-100' : ''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.text')}</div>
            <div class="text-xs text-gray-400">{$t('buildTools.textHelp')}</div>
          </div>
        </button>

        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {currentTool === 'annotate' ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
          onclick={() => setTool('annotate')}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {currentTool === 'annotate' ? 'bg-blue-100' : ''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><line x1="16" y1="5" x2="22" y2="5"/><line x1="19" y1="2" x2="19" y2="8"/><line x1="3" y1="12" x2="12" y2="12"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.dimension')}</div>
            <div class="text-xs text-gray-400">{$t('buildTools.dimensionHelp')}</div>
          </div>
        </button>
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {currentTool === 'measure' ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
          onclick={() => setTool('measure')}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center {currentTool === 'measure' ? 'bg-blue-100' : ''}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h5l2-7 4 14 2-7h7"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.measure')}</div>
            <div class="text-xs text-gray-400">{$t('buildTools.measureHelp')}</div>
          </div>
        </button>

        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3">{$t('buildTools.import')}</h3>
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-gray-50 text-gray-700"
          onclick={onImportImage}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.image')}</div>
            <div class="text-xs text-gray-400">{$t('buildTools.imageHelp')}</div>
          </div>
        </button>
        {#if largeImageWarning}
          <div role="status" class="mb-1 flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p><span class="font-semibold">{$t('buildTools.largeImageTitle')}</span> {$t('buildTools.largeImage')}</p>
            <button aria-label={$t('buildTools.largeImageDismiss')} class="rounded px-1 hover:bg-amber-100" onclick={() => largeImageWarning = false}>✕</button>
          </div>
        {/if}
        {#if unsupportedImage}
          <div role="alert" class="mb-1 flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>{$t('buildTools.imageUnsupported')}</p>
            <button aria-label={$t('buildTools.largeImageDismiss')} class="rounded px-1 hover:bg-amber-100" onclick={() => unsupportedImage = false}>✕</button>
          </div>
        {/if}
        <button
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-gray-50 text-gray-700"
          onclick={onImportRoomPlan}
        >
          <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          <div class="text-left">
            <div class="font-medium">{$t('buildTools.roomplan')}</div>
            <div class="text-xs text-gray-400">{$t('buildTools.roomplanHelp')}</div>
          </div>
        </button>

        <button
          class="w-full flex items-center justify-between px-1 py-2 mt-3"
          onclick={() => constructionOpen = !constructionOpen}
        >
          <h3 class="text-xs font-semibold text-gray-400 uppercase">{$t('layers.doors')}</h3>
          <span class="text-gray-400 text-xs">{constructionOpen ? '▼' : '▶'}</span>
        </button>

        {#if constructionOpen}
          <div class="grid grid-cols-2 gap-2 mb-3">
            {#each doorCatalog as dc}
              <button
                class="flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-colors cursor-grab active:cursor-grabbing {currentTool === 'door' && selectedDoorType === dc.type ? 'border-blue-400 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}"
                aria-pressed={currentTool === 'door' && selectedDoorType === dc.type}
                onclick={() => setDoorType(dc.type)}
                draggable="true"
                ondragstart={(e) => { e.dataTransfer?.setData('application/o3d-type', 'door'); e.dataTransfer?.setData('application/o3d-id', dc.type); }}
              >
                <div class="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#92400e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="{dc.icon}"/></svg>
                </div>
                <span class="text-xs font-medium text-gray-600">{dc.name}</span>
                <span class="text-[10px] text-gray-400">{dc.desc}</span>
              </button>
            {/each}
          </div>

          <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2">{$t('layers.windows')}</h3>
          <div class="grid grid-cols-2 gap-2">
            {#each windowCatalog as wc}
              <button
                class="flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-colors cursor-grab active:cursor-grabbing {currentTool === 'window' && selectedWindowType === wc.type ? 'border-blue-400 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}"
                aria-pressed={currentTool === 'window' && selectedWindowType === wc.type}
                onclick={() => setWindowType(wc.type)}
                draggable="true"
                ondragstart={(e) => { e.dataTransfer?.setData('application/o3d-type', 'window'); e.dataTransfer?.setData('application/o3d-id', wc.type); }}
              >
                <div class="w-9 h-9 rounded-lg bg-cyan-50 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0e7490" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
                </div>
                <span class="text-xs font-medium text-gray-600">{wc.name}</span>
                <span class="text-[10px] text-gray-400">{wc.desc}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

    {:else if mode === '2d' && activeTab === 'rooms'}
      <div class="space-y-2">
        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2">{$t('roomChoices.presets')}</h3>
        <p class="text-xs text-gray-400 mb-3">{$t('roomChoices.presetsHelp')}</p>
        <div class="grid grid-cols-2 gap-2">
          {#each roomPresets as preset}
            <button
              class="flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-grab active:cursor-grabbing"
              onclick={() => onPresetClick(preset.id)}
              draggable="true"
              ondragstart={(e) => { e.dataTransfer?.setData('application/o3d-type', 'room'); e.dataTransfer?.setData('application/o3d-id', preset.id); }}
            >
              <div class="w-12 h-12 rounded-lg bg-gray-50 flex items-center justify-center text-2xl font-mono">{preset.icon}</div>
              <span class="text-xs font-medium text-gray-600">{roomPresetLabels[preset.id] ? $t(roomPresetLabels[preset.id]) : preset.name}</span>
            </button>
          {/each}
        </div>

        <hr class="my-3 border-gray-200" />

        <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2">{$t('roomChoices.templates')}</h3>
        <p class="text-xs text-gray-400 mb-3">{$t('roomChoices.templatesHelp')}</p>
        <div class="grid grid-cols-2 gap-2">
          {#each roomTemplates as tmpl}
            <button
              class="flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 border-gray-100 hover:border-green-300 hover:bg-green-50 transition-colors cursor-grab active:cursor-grabbing"
              onclick={() => onPresetClick(tmpl.presetId, tmpl.name)}
              draggable="true"
              ondragstart={(e) => { e.dataTransfer?.setData('application/o3d-type', 'room-template'); e.dataTransfer?.setData('application/o3d-id', tmpl.name); }}
            >
              <div class="w-12 h-12 rounded-lg bg-green-50 flex items-center justify-center text-lg">
                {#if tmpl.name === 'Living Room'}🛋️
                {:else if tmpl.name === 'Bedroom'}🛏️
                {:else if tmpl.name === 'Kitchen'}🍳
                {:else if tmpl.name === 'Bathroom'}🛁
                {:else if tmpl.name === 'Office'}🖥️
                {:else if tmpl.name === 'Dining Room'}🍽️
                {:else}🏠
                {/if}
              </div>
              <span class="text-xs font-medium text-gray-600">{roomTemplateLabels[tmpl.name] ? $t(roomTemplateLabels[tmpl.name]) : tmpl.name}</span>
              <span class="text-[10px] text-gray-400">{$t(tmpl.furniture.length === 1 ? 'roomChoices.item' : 'roomChoices.items', { count: tmpl.furniture.length })}</span>
            </button>
          {/each}
        </div>
      </div>

    {:else if activeTab === 'objects'}
      <div class="space-y-2">
        {#if mode === '2d'}
        <CustomModelPanel />
        {/if}
        <!-- Search with clear button and result count -->
        <div class="relative">
          <input
            type="text"
            placeholder={$t('objectControls.search')} aria-label={$t('objectControls.search')}
            class="w-full px-3 py-2 pr-8 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
            bind:value={search}
          />
          {#if search}
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 w-5 h-5 flex items-center justify-center rounded-full hover:bg-gray-100"
              onclick={() => search = ''}
              title={$t('objectControls.clear')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          {/if}
        </div>
        {#if search}
          <div class="text-[10px] text-gray-400 px-1">{$t(filtered.length === 1 ? 'objectControls.result' : 'objectControls.results', { count: filtered.length, query: search })}</div>
        {/if}
        <!-- Category filter -->
        <div class="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          <button
            class="build-filter px-2 py-0.5 rounded-full text-[10px] font-medium {selectedCategory === 'All' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
            aria-pressed={selectedCategory === 'All'}
            onclick={() => selectedCategory = 'All'}
          >{$t('objectControls.all')}</button>
          <button
            class="build-filter px-2 py-0.5 rounded-full text-[10px] font-medium {selectedCategory === 'Favorites' ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
            aria-pressed={selectedCategory === 'Favorites'}
            onclick={() => selectedCategory = 'Favorites'}
          >♥ {$t('objectControls.favorites')}{favoriteIds.length ? ` (${favoriteIds.length})` : ''}</button>
          {#each furnitureCategories as cat}
            <button
              class="build-filter px-2 py-0.5 rounded-full text-[10px] font-medium {selectedCategory === cat ? 'text-white' : 'text-gray-600 hover:bg-gray-200'}"
              aria-pressed={selectedCategory === cat}
              style={selectedCategory === cat ? `background-color: ${categoryColors[cat] ?? '#6b7280'}` : 'background-color: #f3f4f6'}
              onclick={() => selectedCategory = cat}
            >{catalogCategoryLabels[cat] ? $t(catalogCategoryLabels[cat]) : cat}</button>
          {/each}
        </div>

        <!-- Recent Items -->
        {#if !search && selectedCategory === 'All' && recentItems.length > 0}
          <div class="mt-1">
            <h4 class="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">{$t('objectControls.recent')}</h4>
            <div class="grid grid-cols-2 gap-2">
              {#each recentItems as item}
                <div class="relative">
                  <button
                    class="w-full h-full flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-colors cursor-grab active:cursor-grabbing {currentPlacing === item.id ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : 'border-gray-100 hover:border-blue-300 hover:bg-blue-50'}"
                    aria-pressed={currentPlacing === item.id}
                    onclick={() => onFurnitureClick(item)}
                    draggable="true"
                    ondragstart={(e) => onFurnitureDragStart(e, item)}
                    ondragend={() => onFurnitureDragEnd(item.id)}
                    onmouseenter={(e) => onItemMouseEnter(e, item)}
                    onmousemove={onItemMouseMove}
                    onmouseleave={onItemMouseLeave}
                  >
                    <div class="w-10 h-10"><FurnitureThumbnail catalogId={item.id} name={furnitureName(item.id, $locale)} color={item.color} /></div>
                    <span class="text-[10px] font-medium text-gray-600 leading-tight text-center">{furnitureName(item.id, $locale)}</span>
                  </button>
                  <button
                    class="absolute top-1 right-1 text-[12px] leading-none cursor-pointer {favoriteIds.includes(item.id) ? 'text-pink-500' : 'text-gray-300 hover:text-pink-400'}"
                    onclick={() => toggleFavorite(item.id)}
                    aria-label={$t(favoriteIds.includes(item.id) ? 'objectControls.remove' : 'objectControls.add', { name: furnitureName(item.id, $locale) })}
                    aria-pressed={favoriteIds.includes(item.id)}
                    title={$t(favoriteIds.includes(item.id) ? 'objectControls.removeHint' : 'objectControls.addHint')}
                  >{favoriteIds.includes(item.id) ? '♥' : '♡'}</button>
                </div>
              {/each}
            </div>
          </div>
          <hr class="border-gray-100" />
        {/if}

        <!-- Catalog grid -->
        <div class="grid grid-cols-2 gap-2 mt-2">
          {#each filtered as item}
            {@const s = search.toLowerCase()}
            <div class="relative">
              <button
                class="w-full h-full flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors cursor-grab active:cursor-grabbing {currentPlacing === item.id ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300' : 'border-gray-100 hover:border-blue-300 hover:bg-blue-50'}"
                aria-pressed={currentPlacing === item.id}
                onclick={() => onFurnitureClick(item)}
                draggable="true"
                ondragstart={(e) => onFurnitureDragStart(e, item)}
                ondragend={() => onFurnitureDragEnd(item.id)}
                onmouseenter={(e) => onItemMouseEnter(e, item)}
                onmousemove={onItemMouseMove}
                onmouseleave={onItemMouseLeave}
              >
                <div class="w-12 h-12"><FurnitureThumbnail catalogId={item.id} name={furnitureName(item.id, $locale)} color={item.color} /></div>
                {#if s && furnitureName(item.id, $locale).toLowerCase().includes(s)}
                  {@const idx = furnitureName(item.id, $locale).toLowerCase().indexOf(s)}
                  <span class="text-xs font-medium text-gray-600">{furnitureName(item.id, $locale).slice(0, idx)}<mark class="bg-yellow-200 text-gray-800 rounded-sm px-0.5">{furnitureName(item.id, $locale).slice(idx, idx + s.length)}</mark>{furnitureName(item.id, $locale).slice(idx + s.length)}</span>
                {:else}
                  <span class="text-xs font-medium text-gray-600">{furnitureName(item.id, $locale)}</span>
                {/if}
                <span class="text-[10px] text-gray-400">{item.width}×{item.depth}cm</span>
              </button>
              <button
                class="absolute top-1 right-1 text-[12px] leading-none cursor-pointer {favoriteIds.includes(item.id) ? 'text-pink-500' : 'text-gray-300 hover:text-pink-400'}"
                onclick={() => toggleFavorite(item.id)}
                aria-label={$t(favoriteIds.includes(item.id) ? 'objectControls.remove' : 'objectControls.add', { name: furnitureName(item.id, $locale) })}
                aria-pressed={favoriteIds.includes(item.id)}
                title={$t(favoriteIds.includes(item.id) ? 'objectControls.removeHint' : 'objectControls.addHint')}
              >{favoriteIds.includes(item.id) ? '♥' : '♡'}</button>
            </div>
          {/each}
        </div>

        <!-- Entourage symbols are 2D-only; do not arm invisible tools in 3D. -->
        {#if mode === '2d'}
        <div class="pt-3 mt-2 border-t border-gray-100">
          <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2">{$t('entourageLabels.title')}</h3>
          {#each entourageCategories as cat}
            {@const defs = entourageCatalog.filter(d => d.category === cat.key)}
            <div class="mb-2">
              <span class="text-[10px] font-medium text-gray-500">{cat.icon} {$t(`entourageLabels.${cat.key}`)}</span>
              <div class="grid grid-cols-3 gap-1.5 mt-1">
                {#each defs as def}
                  {@const name = entourageLabels[def.id] ? $t(entourageLabels[def.id]) : def.name}
                  <button
                    class="p-1.5 rounded-lg border text-center hover:border-blue-300 hover:bg-blue-50 transition-colors {placingEntId === def.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200'}"
                    title={$t('entourageLabels.placeHint', { name, width: def.width })}
                    onclick={() => armEntourage(def.id)}
                  >
                    <svg viewBox="0 0 100 {Math.round(100 * def.aspect)}" class="w-full h-8 text-gray-600" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
                      {#each def.paths as d}<path d={d} />{/each}
                    </svg>
                    <span class="text-[9px] text-gray-500 leading-tight block truncate">{name}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
          {#if customEntDefs.length}
            <div class="mb-2">
              <span class="text-[10px] font-medium text-gray-500">🖼️ {$t('entourageLabels.custom')}</span>
              <div class="grid grid-cols-3 gap-1.5 mt-1">
                {#each customEntDefs as def}
                  <button
                    class="p-1.5 rounded-lg border text-center hover:border-blue-300 hover:bg-blue-50 transition-colors {placingEntId === def.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200'}"
                    title={def.name}
                    onclick={() => armEntourage(def.id)}
                  >
                    <img src={def.dataUrl} alt={def.name} class="w-full h-8 object-contain" />
                    <span class="text-[9px] text-gray-500 leading-tight block truncate">{def.name}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          <button
            class="w-full py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
            onclick={() => entourageFileInput?.click()}
          >+ {$t('entourageLabels.upload')}</button>
          {#if symbolUploadError}<p role="alert" class="text-xs text-red-700">{$t(`entourageLabels.${symbolUploadError}`)}</p>{/if}
          <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" bind:this={entourageFileInput} onchange={onEntourageUpload} />
        </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Furniture Hover Preview Tooltip -->
{#if showPreview && hoveredItem}
  {@const item = hoveredItem}
  <div
    class="fixed z-50 pointer-events-none"
    style="left: {hoverPos.x}px; top: {hoverPos.y}px;"
  >
    <div class="build-hover-card bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden" style="width: 220px;">
      <div class="build-hover-image w-full h-[120px] bg-gray-50 flex items-center justify-center p-3">
        <div class="w-full h-full"><FurnitureThumbnail catalogId={item.id} name={furnitureName(item.id, $locale)} color={item.color} /></div>
      </div>
      <div class="p-3 space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-800">{furnitureName(item.id, $locale)}</span>
          <span
            class="px-1.5 py-0.5 rounded-full text-[9px] font-semibold text-white"
            style="background-color: {categoryColors[item.category] ?? '#6b7280'}"
          >{catalogCategoryLabels[item.category] ? $t(catalogCategoryLabels[item.category]) : item.category}</span>
        </div>
        <div class="text-xs text-gray-500">
          {item.width} × {item.depth} × {item.height} cm
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showE22Dialog}
  <dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60" aria-label="导入 iPhone 扫描包" onclick={(event) => { if (!e22Busy && event.target === event.currentTarget) showE22Dialog = false; }} oncancel={(event) => { event.preventDefault(); if (!e22Busy) showE22Dialog = false; }}>
    <div class="max-h-[85vh] w-[440px] max-w-[calc(100vw-2rem)] overflow-auto rounded-xl bg-white p-5 shadow-2xl">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div><h3 class="text-base font-semibold text-slate-900">iPhone 扫描 · 实验 22</h3><p class="mt-1 text-xs leading-5 text-slate-500">从 House Capture ZIP 生成可编辑平面图，并在 3D 查看扫描和体素层。</p></div>
        <button type="button" class="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="关闭扫描导入" disabled={e22Busy} onclick={() => showE22Dialog = false}>✕</button>
      </div>
      <label for="e22-zip-file" class="block text-xs font-semibold text-slate-700">选择原始扫描 ZIP</label>
      <input id="e22-zip-file" type="file" accept=".zip,application/zip" class="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-700" disabled={e22Busy} onchange={pickE22File} />
      <button type="button" class="mt-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!e22File || e22Busy} onclick={() => processE22File()}>{e22Busy ? '处理中，请稍候…' : '处理并打开扫描'}</button>
      {#if e22Rooms.length}
        <p class="mt-3 text-xs text-amber-800">扫描包含多个房间，请选择要处理的房间索引：</p>
        <div class="mt-2 flex flex-wrap gap-2">{#each e22Rooms as roomIndex}<button type="button" class="rounded border border-amber-300 px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-50" disabled={e22Busy} onclick={() => processE22File(roomIndex)}>房间 {roomIndex}</button>{/each}</div>
      {/if}
      {#if e22Error}<p role="alert" class="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{e22Error}</p>{/if}
      <div class="mt-5 border-t border-slate-200 pt-4">
        <h4 class="text-xs font-semibold text-slate-700">已经处理的扫描</h4>
        {#if e22Listing}<p class="mt-2 text-xs text-slate-500">正在读取本机扫描…</p>
        {:else if !e22Scans.length}<p class="mt-2 text-xs text-slate-500">暂无可打开的实验 22 平面资产。</p>
        {:else}<div class="mt-2 max-h-40 space-y-1 overflow-auto">{#each e22Scans as scan}<button type="button" class="flex w-full justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={e22Busy} onclick={() => openE22Scan(scan)}><span class="truncate">{scan.scanId}</span><span class="ml-2 shrink-0">房间 {scan.roomIndex} →</span></button>{/each}</div>{/if}
      </div>
      <p class="mt-4 text-[11px] leading-4 text-slate-500">本机离线处理；扫描原包和照片保存在实验私有目录。原有 RoomPlan 导入仍可单独使用。</p>
    </div>
  </dialog>
{/if}

<!-- RoomPlan Import Options Dialog -->
{#if showImportDialog}
  <dialog use:modalDialog class="modal-overlay fixed inset-0 bg-black/50 z-50 flex items-center justify-center" aria-label={$t('roomPlanDialog.title')} onclick={(e) => { if (e.target === e.currentTarget) cancelImport(); }} oncancel={(e) => { e.preventDefault(); cancelImport(); }}>
    <div class="bg-white rounded-xl shadow-2xl w-80 max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-auto p-5">
      <h3 class="text-sm font-bold text-gray-800 mb-1">{$t('roomPlanDialog.title')}</h3>
      <p class="text-xs text-gray-400 mb-4">{importFileName}</p>

      <div class="space-y-3">
        <fieldset class="space-y-2 pb-3 border-b border-gray-100">
          <legend class="text-xs text-gray-500 mb-1">{$t('roomPlanDialog.target')}</legend>
          <label class="flex items-start gap-2.5 cursor-pointer">
            <input type="radio" name="roomplan-target" value="new" bind:group={importTarget} class="accent-blue-500 mt-0.5" />
            <div>
              <div class="text-sm font-medium text-gray-700">{$t('roomPlanDialog.newProject')}</div>
              <div class="text-xs text-gray-400">{$t('roomPlanDialog.newProjectHelp')}</div>
            </div>
          </label>
          <label class="flex items-start gap-2.5 cursor-pointer">
            <input type="radio" name="roomplan-target" value="add" bind:group={importTarget} class="accent-blue-500 mt-0.5" />
            <div>
              <div class="text-sm font-medium text-gray-700">{$t('roomPlanDialog.addToPlan')}</div>
              <div class="text-xs text-gray-400">{$t('roomPlanDialog.addToPlanHelp')}</div>
            </div>
          </label>
        </fieldset>

        <label class="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" bind:checked={optStraighten} class="accent-blue-500 mt-0.5" />
          <div>
            <div class="text-sm font-medium text-gray-700">{$t('roomPlanDialog.straighten')}</div>
            <div class="text-xs text-gray-400">{$t('roomPlanDialog.straightenHelp')}</div>
          </div>
        </label>

        <label class="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" bind:checked={optOrthogonal} class="accent-blue-500 mt-0.5" />
          <div>
            <div class="text-sm font-medium text-gray-700">{$t('roomPlanDialog.orthogonal')} <span class="text-xs text-blue-400 font-mono">{ORTHO_VERSION}</span></div>
            <div class="text-xs text-gray-400">{$t('roomPlanDialog.orthogonalHelp')}</div>
          </div>
        </label>

        <label class="block">
          <div class="text-xs text-gray-500 mb-1">{$t('roomPlanDialog.merge')}</div>
          <input type="number" bind:value={optMergeDistance} min="0" max="50" step="5" class="w-full px-2 py-1 border border-gray-200 rounded text-sm" />
        </label>
      </div>

      <div class="flex gap-2 mt-5">
        <button onclick={cancelImport} class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">{$t('roomPlanDialog.cancel')}</button>
        <button onclick={confirmImport} class="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors">{$t('roomPlanDialog.import')}</button>
      </div>
    </div>
  </dialog>
{/if}

{#if importError}
  <ImportError message={importError} onDismiss={() => importError = null} />
{/if}

<style>
  .build-panel-studio {
    background: radial-gradient(ellipse at -18% 0%, #a8a0781c 0%, transparent 38%), radial-gradient(ellipse at 120% 72%, #506b5f22 0%, transparent 46%), linear-gradient(165deg, #202929, #161d1e 56%, #111819) !important;
    border-right-color: #a3a58959 !important;
    color: #e9e9e2;
    box-shadow: inset -1px 0 #ffffff12, 8px 0 28px #070d1030;
  }
  .build-tabs { flex: none; padding: 0 7px; background: linear-gradient(180deg, #1c2525, #171f20); border-color: #ffffff1d !important; }
  .build-tabs button {
    min-height: 46px; color: #b4bfb6 !important; background: transparent !important;
    text-transform: none; letter-spacing: .015em; font-weight: 500; border-bottom-width: 1px;
  }
  .build-tabs button:hover { color: #f2eade !important; background: #ffffff0a !important; }
  .build-tabs button[aria-pressed="true"] {
    color: #f0d9aa !important; background: linear-gradient(180deg, #c6ac721c, transparent) !important;
    border-bottom-color: #cfb582 !important;
  }
  .build-body { scrollbar-color: #566359 transparent; scrollbar-width: thin; }
  .studio-scan-import {
    border: 1px solid #b89a6166;
    background: linear-gradient(135deg, #33413b, #26312d 63%, #1d2827);
    box-shadow: inset 0 1px #ffffff1b, 0 8px 20px #00000020;
    color: #f3e8cf;
    transition: border-color .2s, background .2s, box-shadow .2s;
  }
  .studio-scan-import:hover {
    border-color: #d5b880;
    background: linear-gradient(135deg, #415047, #2e3b34 63%, #26322f);
    box-shadow: inset 0 1px #ffffff25, 0 10px 24px #00000035;
  }
  .studio-scan-import span:last-child { color: #bfccbf !important; }
  .build-body h3, .build-body h4 {
    color: #d4c29d !important; font-size: 10px; font-weight: 600;
    line-height: 1.35; text-transform: uppercase; letter-spacing: .11em;
    border-bottom: 0; padding-bottom: 9px;
    background: linear-gradient(90deg, #cbb27d 0 32px, #ffffff1b 32px) left bottom / 100% 1px no-repeat;
  }
  .build-body > .space-y-1 > button,
  .build-body > .space-y-1 > .flex > button {
    border: 1px solid transparent; border-radius: 4px; min-height: 42px;
  }
  .build-body > .space-y-1 > button:hover,
  .build-body > .space-y-1 > .flex > button:hover {
    background: #ffffff0c !important; border-color: #ffffff15;
  }
  .build-body > .space-y-1 > button[class*="bg-blue-50"],
  .build-body > .space-y-1 > .flex > button[class*="bg-blue-50"] {
    background: linear-gradient(90deg, #bfa67320, #ffffff08) !important; border-color: #bfa67355; color: #f0dfba !important;
  }
  .build-body button > .w-9 {
    background: #252f2d !important; border: 1px solid #ffffff18; border-radius: 4px;
  }
  .build-body button[draggable="true"] {
    border-width: 1px !important; border-color: #ffffff20 !important;
    border-radius: 5px; background: linear-gradient(150deg, #27312f, #1e2727) !important;
    box-shadow: inset 0 1px #ffffff0a;
  }
  .build-body button[draggable="true"]:hover {
    border-color: #bba47596 !important; background: linear-gradient(150deg, #323b35, #232c2a) !important;
    transform: translateY(-1px);
  }
  .build-body button[draggable="true"][aria-pressed="true"] {
    border-color: #d2b67f !important; background: linear-gradient(150deg, #3a3b30, #2a312c) !important;
    box-shadow: inset 0 0 0 1px #d2b67f42, 0 0 16px #c7ae7420;
  }
  .build-body input[type="text"] {
    background: #131b1cbd !important; color: #eceee9; border-color: #ffffff36 !important; border-radius: 4px;
  }
  .build-body input[type="text"]::placeholder { color: #9eaaa3; }
  .build-body input[type="text"]:focus { border-color: #cbb280 !important; box-shadow: 0 0 0 2px #cbb28025 !important; }
  .build-filter {
    border: 1px solid #ffffff26; background: #ffffff0b !important; color: #d2dcd2 !important;
    border-radius: 3px; padding: 4px 8px; line-height: 1.2;
  }
  .build-filter:hover { border-color: #ae996f8f; background: #c7a97219 !important; }
  .build-filter[aria-pressed="true"] {
    border-color: #d4b7798f; background: #bda36d33 !important; color: #f5e1b8 !important;
  }
  .build-hover-card {
    background: #1c2423 !important; border-color: #758073 !important;
    border-radius: 5px; box-shadow: 0 18px 42px #0009;
  }
  .build-hover-image { background: #2b3430 !important; border-bottom: 1px solid #4e5a50; }
  .build-hover-card .text-gray-800 { color: #eee9df; }
  .build-hover-card .text-gray-500 { color: #aab7ac; }
  .build-body :is(.text-gray-700,.text-gray-600,.text-slate-800) { color: #e2e7dd !important; }
  .build-body :is(.text-gray-400,.text-gray-500) { color: #aebbb0 !important; }
  .build-body button[draggable="true"] .text-gray-600 { color: #e4e8e0 !important; }
  .build-body button[draggable="true"] .text-gray-400 { color: #aeb9b0 !important; }
  .build-body hr { border-color: #ffffff1c !important; }
  .build-panel-studio :focus-visible { outline: 2px solid #d5bb87; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .build-body button[draggable="true"]:hover { transform: none; } }
</style>
