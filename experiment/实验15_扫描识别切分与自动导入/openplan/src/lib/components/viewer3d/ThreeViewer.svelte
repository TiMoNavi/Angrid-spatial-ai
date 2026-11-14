<script lang="ts">
  import { t, locale, type TranslationKey } from '$lib/i18n';
  import { furnitureName } from '$lib/i18n/furnitureNames';
  import { catalogCategoryLabels } from '$lib/i18n/catalogCategories';
  import { aiRenderLabels } from '$lib/i18n/aiRenderLabels';
  import { aiRenderMessages } from '$lib/i18n/aiRenderMessages';
  import { hasOpenModal } from '$lib/utils/modalDialog';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { VoxelDocument } from '../../../../../voxel-core/index';
  import { scanRegistration, type RegisteredScanRoom } from './scanVoxelLayer';
  import { ScanEvidenceScene, EVIDENCE_RENDER_ORDER, REVIEW_OUTLINE_LAYERS, setLayerDisplay, type EvidenceLayerMeta, type EvidenceLayerHandle, type EvidenceLayerId, type EvidenceObjectMeta } from './scanEvidenceLayers';
  import StudioLayerKey from '$lib/components/voxel-studio/StudioLayerKey.svelte';
  import { visibleScanTargets, scanHitOwners as hitOwners } from './scanPicking';
  import { makeDesignEnvelope, parseDesignEnvelope, makeExperimentPackage, parseExperimentPackage, designStorageKey, type ScanIdentity } from '$lib/utils/scanDesignPackage';
  import { autoSave } from '$lib/stores/saveStatus';
  import { get } from 'svelte/store';
  import { openAISettings, setOpenAIModel } from '$lib/stores/aiKeys';
  import { generateOpenAIRenderImage, validateOpenAIConfig, getEffectiveModel, normalizeBaseUrl } from '$lib/utils/openaiClient';
  import OpenAIModelPicker from '$lib/components/ai/OpenAIModelPicker.svelte';
  import { activeFloor, currentProject, selectedElementId, placingFurnitureId, loadProject } from '$lib/stores/project';
  import { triggerTip } from '$lib/stores/onboarding.svelte';
  import type { Floor, Wall, Door, Window as Win, Stair, Point } from '$lib/models/types';
  import { getWallStartHeight, getWallEndHeight } from '$lib/models/types';
  import { wallColors, type WallColor } from '$lib/utils/materials';
  import { projectSettings, formatArea } from '$lib/stores/settings';
  import * as THREE from 'three';
  import { createRoomSlabGeometry } from '$lib/utils/roomSlabGeometry';
  import { roomHoles } from '$lib/utils/roomNesting';
  import { createSlopedBoxGeometry, mapWallUVs } from '$lib/utils/slopedWallGeometry';
  import { buildWallSegments, baseboardSegment, roomCeilingHeight, wallProfileSpans, wallPathProfile, pathOpening } from '$lib/utils/wallProfiles';
  import { doorFrameColor, doorOpeningSide, isDoorFrameColor, isGlazedDoor, pocketDoorTravel, swingLeaves } from '$lib/utils/doorStyle';
  import { assembleFloorStack, pickedWallId, stackedFloorMaterial, stackedFloorOccludes, type StackedFloorsStyle } from '$lib/utils/floorStack';
  import { setFloorCameraPose } from '$lib/utils/floorCamera';
  import { frameScene } from '$lib/utils/frameScene';
  import { updateOrbitDamping } from '$lib/utils/orbitDamping';
  import { portableRenderSceneJSON } from '$lib/utils/portableRenderScene';
  import { sceneSignature } from '$lib/utils/sceneSignature';
  import { stairRises, stairSpan } from '$lib/utils/stairLevels';
  import { groundWithOpenings, stairwellView } from '$lib/utils/stairwell';
  import { SPIRAL_START_ANGLE, SPIRAL_SWEEP, stairFlights } from '$lib/utils/stairPlanGeometry';
  import { framingContext, shouldFrameScene, type FramingContext } from '$lib/utils/sceneFraming';
  import { WalkthroughMotion } from '$lib/utils/walkthroughMotion';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
  import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
  import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
  import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
  import { getCatalogItem, furnitureCatalog, furnitureCategories } from '$lib/utils/furnitureCatalog';
  import type { FurnitureDef } from '$lib/utils/furnitureCatalog';
  import { createWallHighlight } from '$lib/utils/wallHighlight';
  import { applyWallXray } from '$lib/utils/wallXray';
  import { disposeModel } from '$lib/utils/furnitureModelResources';
  import { ownColorCanvasTexture, refreshBackgroundTexture } from '$lib/utils/viewerTextures';
  import { gpuName, rememberShadowsLost, shadowsSupported } from '$lib/utils/viewerShadows';
  import { createFurnitureModelWithGLB, createPlacedFurnitureModel } from '$lib/utils/furnitureModelLoader';
  import { placedFurnitureY } from '$lib/utils/furnitureElevation';
  import { addFurniture } from '$lib/stores/project';
  import { detectRooms, resolveRoomGeometry, getRoomPolygon, roomCentroid, roomLabelPosition } from '$lib/utils/roomDetection';
  import { getMaterial } from '$lib/utils/materials';
  import { doorFrameBoxes, windowOuterBars } from '$lib/utils/openingFrames';
  import { DEPTH_ORDER, depthOffset, furnitureDepthOffsets } from '$lib/utils/depthOrder';
  import { columnGeometry } from '$lib/utils/columnGeometry';
  import { getWallTextureCanvas, getFloorTextureCanvas, setTextureLoadCallback } from '$lib/utils/textureGenerator';

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;

  // Dirty flag — only render when scene changes or camera moves
  let sceneDirty = true;
  let renderExportMessage = $state('');
  const renderExportLabels: Record<string, TranslationKey> = {
    "Exported neutral geometry for the local Blender worker. Textures and photo cameras are omitted.": "viewerExport.success",
    "The 3D scene is not ready.": "viewerExport.notReady",
    "Could not export the render scene.": "viewerExport.failed"
  };

  let viewerMounted = false;
  // The browser could not create a WebGL context: the view explains that instead of offering a viewer.
  let webglUnavailable = $state(false);
  let animId: number | undefined;
  let scanViewGlide: { position: THREE.Vector3; target: THREE.Vector3; started: number; last: number } | null = null;
  function requestRender() {
    if (viewerMounted && animId === undefined) animId = requestAnimationFrame(animate);
  }
  function markSceneDirty() {
    sceneDirty = true;
    requestRender();
  }
  let pointerControls: PointerLockControls;
  let currentFloor = $state.raw<Floor | null>(null);
  let renderedSignature: string | null = null;
  let framedContext: FramingContext | null = null;
  let wallGroup: THREE.Group;

  // Independent scan evidence and user design. Native OpenPlan objects stay in wallGroup.
  let voxelGroup: THREE.Group | undefined;
  let voxelStatus = $state('扫描图层载入中…');
  let currentScan = $state<'office-1' | 'office-2' | 'office-2-rescan' | null>(null);
  let scanStageReady = $state(false);
  let scanMotionRevision = $state(0);
  let scanRoom = $state.raw<RegisteredScanRoom | undefined>(undefined);
  let scanStep = $state('0.2');
  let buildingVisible = $state(false);
  let selectedScanObject = $state<number | null>(null);
  let pickStatus = $state('');
  let panelOpen = $state(true);
  // Scanned rooms open on the neutral drafting stage. The original OpenPlan sky remains one click away.
  let studioAppearance = $state(true);
  let studioBackground: THREE.CanvasTexture | undefined;
  let studioGrid: THREE.GridHelper | undefined;
  let selectedVoxelScreen = $state<{ x: number; y: number; name: string; cells: number; height: number } | null>(null);
  let selectedVoxelDetails: { id: string; name: string; cells: number; height: number } | null = null;
  let preset = $state('edit');
  let clipEnabled = $state(true);
  let clipHeight = $state(1.5);
  let evidence: ScanEvidenceScene | undefined;
  let scanIdentity = $state.raw<ScanIdentity | undefined>(undefined);
  let referencePhotos = $state<{ path: string; title: string; url: string }[]>([]);
  let reviewReportUrl = $state<string | null>(null);
  let scanObjects = $state<EvidenceObjectMeta[]>([]);
  let currentManifest: unknown = null;
  let loadSerial = 0;
  let scanController: AbortController | undefined;
  const layerControllers = new Map<EvidenceLayerId, AbortController>();
  const layerHandles = new Map<EvidenceLayerId, EvidenceLayerHandle>();
  type LayerRow = EvidenceLayerMeta & { visible: boolean; opacity: number; clipping: boolean; wireframe: boolean; busy: boolean; total: number; drawn: number; error: string };
  let layerRows = $state<LayerRow[]>([]);
  let clutterComputed = $state(false);
  let manifestWarnings = $state<string[]>([]);
  let userVisible = $state(true);
  let designFocus = $state(true);
  let userOpacity = $state(.1);
  let userClipped = $state(false);
  let userGridEdgesVisible = $state(true);
  let userColorMode = $state<'semantic' | 'height'>('semantic');
  function effectiveEvidenceOpacity(row: LayerRow): number {
    if (row.id === 'fusion') return row.opacity;
    return designFocus && userVisible && editedObjects.length ? Math.min(row.opacity, .18) : row.opacity;
  }
  let heightHeatMinM = $state(0);
  let heightHeatMaxM = $state(0);
  const MAX_EDGE_CELLS_PER_OBJECT = 3000;
  const heightHeatColors = [0, .25, .5, .75, 1].map(value => new THREE.Color().setHSL(.56 - .52 * value, .78, .55).getStyle());
  function studioLayerKind(id: EvidenceLayerId): 'volume' | 'shell' | 'candidate' | 'observed' | 'surface' | 'points' | 'reference' {
    if (id === 'depth') return 'points';
    if (['obb', 'aabb', 'roomplan'].includes(id)) return 'reference';
    if (id === 'structure') return 'shell';
    if (['unknown', 'unknownStructureResidual', 'unknownOpeningResidual', 'unknownObjectResidual'].includes(id)) return 'observed';
    if (['slice', 'furniture', 'corrected', 'conflict', 'clutter', 'sofaCore', 'sofaCandidate', 'chairContinuation', 'chairTableReview'].includes(id)) return 'candidate';
    return 'surface';
  }
  const studioEntries = $derived.by(() => {
    const rows = layerRows.filter(row => row.visible && row.available).map(row => ({
      id: String(row.id), label: row.title, color: row.color, opacity: effectiveEvidenceOpacity(row),
      priority: EVIDENCE_RENDER_ORDER[row.id], kind: studioLayerKind(row.id),
      count: row.drawn, countUnit: gridLayer(row.id) ? '格' : '记录'
    }));
    if (userVisible && editedObjects.length) {
      const selected = editedObjects.find(object => object.id === selectedEditedId);
      const other = selected ? editedObjects.filter(object => object.id !== selected.id) : [];
      const allCells = editedObjects.reduce((sum, object) => sum + object.cells, 0);
      const color = userColorMode === 'height' ? '#54bde0' : selected?.color ?? (editedObjects.length === 1 ? editedObjects[0].color : '#d1d1d1');
      rows.push({ id: 'user', label: selected ? '选中设计体素：' + selected.name : editedObjects.length === 1 ? '用户设计体素：' + editedObjects[0].name : '用户设计体素（多色）', color,
        opacity: userOpacity, priority: 35, kind: 'volume', count: selected?.cells ?? allCells, countUnit: '格' });
      if (other.length) rows.push({ id: 'user-other', label: '其余设计体素（多色）', color: '#d1d1d1', opacity: userOpacity, priority: 36,
        kind: 'volume', count: other.reduce((sum, object) => sum + object.cells, 0), countUnit: '格' });
    }
    return rows;
  });

  function disposeScanLayers() {
    scanController?.abort();
    for (const controller of layerControllers.values()) controller.abort();
    layerControllers.clear();
    for (const handle of layerHandles.values()) { voxelGroup?.remove(handle.group); handle.dispose(); }
    layerHandles.clear();
    if (voxelGroup) { scene.remove(voxelGroup); voxelGroup.clear(); voxelGroup = undefined; }
    evidence = undefined;
  }
  function removeStudioGrid() {
    if (!studioGrid) return;
    scene.remove(studioGrid);
    studioGrid.geometry.dispose();
    const mats = Array.isArray(studioGrid.material) ? studioGrid.material : [studioGrid.material];
    mats.forEach(material => material.dispose());
    studioGrid = undefined;
  }
  function updateStudioAppearance() {
    if (!scene) return;
    const active = Boolean(currentScan && studioAppearance);
    scene.background = active ? studioBackground ?? new THREE.Color(0x0a0a0a) : skyTexture;
    if (studioGrid) studioGrid.visible = active;
    if (renderer) renderer.toneMappingExposure = active ? 1.06 : 1.2;
    updateLayerDisplays();
    markSceneDirty();
  }
  function updateStudioGrid() {
    removeStudioGrid();
    if (!scanRoom || !scene) return;
    const registration = scanRegistration(scanRoom);
    // The guide shares the selected room-local spacing; it is not measured occupancy.
    const divisions = Math.round(12 / Number(scanStep));
    const grid = new THREE.GridHelper(1200, divisions, 0x4a4a4a, 0x303030);
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    mats.forEach(material => { material.transparent = true; material.opacity = divisions > 120 ? .17 : .26; material.depthWrite = false; });
    grid.position.copy(registration.point(0, -.035, 0));
    grid.quaternion.copy(registration.orientation);
    grid.name = 'Studio 编辑参照格（非扫描证据）';
    grid.renderOrder = -2;
    studioGrid = grid;
    scene.add(grid);
    updateStudioAppearance();
  }
  async function loadVoxelLayer(frame = false) {
    if (!scene || !currentScan) return;
    scanStageReady = false;
    const scan = currentScan;
    const serial = ++loadSerial;
    disposeScanLayers();
    const controller = new AbortController();
    scanController = controller;
    voxelStatus = scan + ' · 验证扫描身份与图层来源…';
    try {
      const response = await fetch(base + '/api/local-scan/' + scan, { signal: controller.signal });
      if (!response.ok) throw new Error('扫描配置不可用 (' + response.status + ')');
      const room = await response.json() as RegisteredScanRoom;
      if (controller.signal.aborted || serial !== loadSerial) return;
      scanRoom = room;
      updateStudioGrid();
      const manager = new ScanEvidenceScene(room, scan);
      const metadata = await manager.initialize(controller.signal);
      if (controller.signal.aborted || serial !== loadSerial) return;
      evidence = manager;
      scanIdentity = { scanId: scan, frame: 'room-local-m', transformHash: metadata.transformHash };
      // The portable project schema uses the broad measured/inferred/user source enum;
      // the verified v2 manifest retains its finer semantic-candidate wording separately.
      currentManifest = metadata.reviewManifest ? { ...metadata.reviewManifest, layers: metadata.reviewManifest.layers.map((row: Record<string, unknown>) => ({ ...row, provenance: 'measured' })) }
        : metadata.manifest ?? { schemaVersion: 1, ...scanIdentity, sourceFiles: [{ uri: 'converted.json', sha256: metadata.convertedHash }], layers: [] };
      referencePhotos = metadata.photos;
      reviewReportUrl = metadata.reviewReportUrl;
      scanObjects = metadata.objects;
      clutterComputed = metadata.clutterComputed;
      manifestWarnings = metadata.warnings;
      voxelGroup = new THREE.Group();
      voxelGroup.name = '独立扫描证据与分类图层';
      scene.add(voxelGroup);
      layerRows = metadata.layers.map(row => ({ ...row, visible: false, opacity: row.defaultOpacity, clipping: row.clipped, wireframe: REVIEW_OUTLINE_LAYERS.has(row.id), busy: false, total: row.total ?? 0, drawn: 0, error: '' }));
      loadEditedDocument();
      // First paint stays cheap: the fused scan plus a few rectified boxes and
      // existing OBB wireframes. Review-only and raw surface grids remain opt-in.
      await applyPreset(scan === 'office-1' ? 'fusion' : 'edit');
      if (controller.signal.aborted || serial !== loadSerial) return;
      scanStageReady = true;
      wallGroup.visible = buildingVisible;
      if (frame) frameVoxelLayer(true);
      summarizeLayers();
      markSceneDirty();
    } catch (error) {
      if (!controller.signal.aborted) voxelStatus = '扫描层不可用：' + (error instanceof Error ? error.message : String(error));
    }
  }
  function summarizeLayers() {
    const visible = layerRows.filter(row => row.visible && row.available);
    voxelStatus = (currentScan ?? '') + ' · ' + Number(scanStep) * 100 + ' cm · ' + visible.length + ' 图层 · ' + visible.reduce((sum, row) => sum + row.total, 0).toLocaleString() + ' 记录';
  }
  async function ensureLayer(id: EvidenceLayerId, rebuild = false) {
    const row = layerRows.find(item => item.id === id);
    const manager = evidence;
    const serial = loadSerial;
    if (!row || !row.available || !manager || !voxelGroup) return;
    const requestedStep = Number(scanStep);
    const existing = layerHandles.get(id);
    if (existing && !rebuild && (!gridLayer(id) || existing.group.userData.loadedStepM === requestedStep)) { existing.group.visible = row.visible; updateLayerDisplays(); return; }
    layerControllers.get(id)?.abort();
    const controller = new AbortController();
    layerControllers.set(id, controller);
    row.busy = true; row.error = '';
    try {
      const next = await manager.loadLayer(id, requestedStep, controller.signal);
      if (controller.signal.aborted || serial !== loadSerial || evidence !== manager) { next.dispose(); return; }
      if (existing) { voxelGroup.remove(existing.group); existing.dispose(); }
      layerHandles.set(id, next);
      next.group.userData.loadedStepM = requestedStep;
      voxelGroup.add(next.group);
      next.group.visible = row.visible;
      row.total = next.total; row.drawn = next.drawn;
      updateLayerDisplays();
    } catch (error) {
      if (!controller.signal.aborted) {
        row.error = error instanceof Error ? error.message : String(error);
        row.visible = false;
        if (existing) { voxelGroup?.remove(existing.group); existing.dispose(); layerHandles.delete(id); }
      }
    } finally {
      if (layerControllers.get(id) === controller) { row.busy = false; layerControllers.delete(id); }
      summarizeLayers(); markSceneDirty();
    }
  }
  async function toggleEvidence(id: EvidenceLayerId, checked: boolean) {
    const row = layerRows.find(item => item.id === id);
    if (!row || !row.available) return;
    preset = 'custom';
    row.visible = checked;
    if (!checked) {
      layerControllers.get(id)?.abort(); layerControllers.delete(id); row.busy = false;
      const handle = layerHandles.get(id); if (handle) handle.group.visible = false;
      summarizeLayers(); markSceneDirty();
    } else await ensureLayer(id);
  }
  async function applyPreset(value: string) {
    preset = value;
    const desired: Record<string, EvidenceLayerId[]> = {
      edit: ['fusion', 'structure', 'corrected', 'obb'],
      evidence: ['raw', 'roomplan', 'obb'],
      slices: ['slice', 'obb', 'aabb'],
      comparison: ['rawSurface', 'structure', 'furniture'],
      fusion: currentScan === 'office-1' ? ['fusion'] : ['fusion', 'depth'],
      conflict: ['structure', 'furniture', 'conflict', 'unknown'],
      review: ['fusion', 'structure', 'sofaCore', 'chairContinuation', 'chairTableReview', 'unknownObjectResidual']
    };
    const active = new Set(desired[value] || desired.edit);
    for (const row of layerRows) {
      row.visible = active.has(row.id) && row.available;
      const handle = layerHandles.get(row.id); if (handle) handle.group.visible = row.visible;
      if (!row.visible) { layerControllers.get(row.id)?.abort(); layerControllers.delete(row.id); row.busy = false; }
    }
    await Promise.all(layerRows.filter(row => row.visible).map(row => ensureLayer(row.id)));
    if (studioAppearance) scanMotionRevision++;
    summarizeLayers(); markSceneDirty();
  }
  function clearEvidenceLayers() {
    preset = 'custom';
    for (const row of layerRows) {
      row.visible = false; row.busy = false;
      layerControllers.get(row.id)?.abort(); layerControllers.delete(row.id);
      const handle = layerHandles.get(row.id); if (handle) handle.group.visible = false;
    }
    summarizeLayers(); markSceneDirty();
  }
  async function changeGridStep() {
    // New requests replace in-flight requests; each layer keeps its own cancellation token.
    updateStudioGrid();
    await Promise.all(layerRows.filter(row => row.visible && row.available && gridLayer(row.id)).map(row => ensureLayer(row.id, true)));
    if (studioAppearance) scanMotionRevision++;
    summarizeLayers();
  }
  function updateLayerDisplays() {
    for (const row of layerRows) {
      const handle = layerHandles.get(row.id);
      if (!handle) continue;
      handle.group.visible = row.visible;
      setLayerDisplay(handle, { opacity: effectiveEvidenceOpacity(row), clipped: clipEnabled && row.clipping, clipHeightM: Number(clipHeight), selectedIndex: objectLayer(row.id) ? selectedScanObject : null, wireframe: row.wireframe });
    }
    if (editedGroup) {
      editedGroup.visible = userVisible;
      const planes = clipEnabled && userClipped ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), Number(clipHeight) * 100)] : [];
      editedGroup.traverse(child => {
        if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const edge = child instanceof THREE.LineSegments || child.userData.gridEdge === true || child.userData.selectedOutline === true;
        child.visible = userOpacity > 0 && (!edge || child.userData.selectedOutline || userGridEdgesVisible);
        child.renderOrder = child.userData.selectedOutline ? 120 : edge ? 52 : 35;
        for (const material of materials) {
          // Transparent faces still need legible grid contours; zero opacity and
          // layer visibility remain authoritative for hiding the entire volume.
          material.opacity = edge && userOpacity > 0
            ? child.userData.selectedOutline ? .95 : studioAppearance ? Math.max(.62, userOpacity * .78) : userOpacity * .68
            : userOpacity;
          if (child.userData.gridEdge && material instanceof LineMaterial) {
            material.color.setHex(studioAppearance ? 0xbebebe : 0x292929);
          }
          material.transparent = edge || userOpacity < 1;
          material.depthWrite = !edge && userOpacity >= .995;
          material.clippingPlanes = planes;
          material.needsUpdate = true;
        }
      });
    }
    markSceneDirty();
  }
  function frameVoxelLayer(initialScanFrame = false) {
    if (!voxelGroup || !voxelGroup.children.length) return;
    const bounds = new THREE.Box3();
    for (const row of layerRows) { const handle = layerHandles.get(row.id); if (handle && row.visible) bounds.union(new THREE.Box3().setFromObject(handle.group)); }
    if (!bounds.isEmpty()) {
      const fromPosition = camera.position.clone();
      const fromTarget = controls.target.clone();
      frameScene(camera, bounds, controls.target);
      if (initialScanFrame && studioAppearance) {
        // One-time composition for the scan workbench. Never reframe on editing or a later reload.
        const cameraOffset = camera.position.clone().sub(controls.target).multiplyScalar(.72);
        camera.position.copy(controls.target).add(cameraOffset);
        const shift = Math.min(90, bounds.getSize(new THREE.Vector3()).y * .3);
        camera.position.y -= shift;
        controls.target.y -= shift;
        camera.lookAt(controls.target);
        controls.update();
      } else if (!initialScanFrame) {
        const toPosition = camera.position.clone();
        const toTarget = controls.target.clone();
        camera.position.copy(fromPosition);
        controls.target.copy(fromTarget);
        controls.update();
        glideToScanView(toPosition, toTarget);
      }
    }
    markSceneDirty();
  }
  function glideToScanView(position: THREE.Vector3, target: THREE.Vector3) {
    orbitGlide = null;
    if (!studioAppearance || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      scanViewGlide = null;
      camera.position.copy(position); controls.target.copy(target); controls.update(); markSceneDirty();
      return;
    }
    const now = performance.now();
    scanViewGlide = { position: position.clone(), target: target.clone(), started: now, last: now };
    markSceneDirty();
  }
  function chooseScanObject(index: number | null) {
    selectedScanObject = index;
    pickStatus = index === null ? '' : '查看 ' + (scanRoom?.objects[index]?.category ?? '物体') + ' ' + (index + 1) + ' 的候选；共享格仍可能属于多个实例。';
    updateLayerDisplays();
  }
  function toggleBuilding() { buildingVisible = !buildingVisible; if (wallGroup) wallGroup.visible = buildingVisible; markSceneDirty(); }
  function changeView(view: 'perspective' | 'top' | 'front' | 'side') {
    if (!scanRoom) return;
    const registration = scanRegistration(scanRoom);
    const center = registration.point(0, 1, 0);
    const directions = { perspective: [5, 4, 5], top: [0, 7, .001], front: [0, 1, 7], side: [7, 1, 0] };
    const offset = new THREE.Vector3(...directions[view] as [number, number, number]).applyQuaternion(registration.orientation).multiplyScalar(100);
    glideToScanView(center.clone().add(offset), center);
  }

  let editedDocument = new VoxelDocument();
  let editedGroup: THREE.Group | undefined;
  let editedObjects = $state<{ id: string; name: string; cells: number; color: string }[]>([]);
  let selectedEditedId = $state<string | null>(null);
  let placementMode = $state(false);
  let boxName = $state('新体素盒');
  let boxSemantic = $state('furniture');
  let boxColor = $state('#eba685');
  let boxWidth = $state(3), boxHeight = $state(2), boxDepth = $state(2);
  let boxStep = $state(.2);
  let editName = $state('');
  let editColor = $state('#eba685');
  let editStatus = $state('');
  function loadEditedDocument() {
    if (!scanIdentity) return;
    try {
      const json = localStorage.getItem(designStorageKey(scanIdentity));
      const data = json ? parseDesignEnvelope(json, scanIdentity).voxelDocument : undefined;
      editedDocument = data ? new VoxelDocument(data) : new VoxelDocument();
      selectedEditedId = null;
      renderEditedVoxels();
      editStatus = json ? '已读取当前扫描的设计版本 ' + editedDocument.snapshot().revision : '当前扫描尚无用户体素盒。';
    } catch (error) { editStatus = '保存的设计未载入：' + (error instanceof Error ? error.message : String(error)); }
  }
  function renderEditedVoxels() {
    if (!scanRoom || !scene) return;
    if (editedGroup) { scene.remove(editedGroup); clearGroup(editedGroup); }
    const next = new THREE.Group(); next.name = '用户设计占据（独立于扫描证据）';
    const registration = scanRegistration(scanRoom);
    const matrix = new THREE.Matrix4(); const scale = new THREE.Vector3();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edgeBox = new THREE.BoxGeometry(1, 1, 1);
    const edgeTemplate = new THREE.EdgesGeometry(edgeBox);
    const edgePositions = edgeTemplate.getAttribute('position');
    const objects = editedDocument.snapshot().objects;
    selectedVoxelDetails = null;
    selectedVoxelScreen = null;
    heightHeatMinM = Number.POSITIVE_INFINITY; heightHeatMaxM = Number.NEGATIVE_INFINITY;
    for (const object of objects) for (const cell of object.cells) {
      const height = editedDocument.cellWorldCenter(object.id, cell)[1];
      heightHeatMinM = Math.min(heightHeatMinM, height);
      heightHeatMaxM = Math.max(heightHeatMaxM, height);
    }
    if (!Number.isFinite(heightHeatMinM)) heightHeatMinM = heightHeatMaxM = 0;
    objects.forEach((object, index) => {
      if (!object.cells.length) return;
      const semanticColor = new THREE.Color(object.color ?? [0xeba685, 0xb99bdb, 0x90c9bd, 0xd3bc83][index % 4]);
      const mesh = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .77, metalness: .03 }), object.cells.length);
      mesh.name = object.name; mesh.userData = { editableVoxelId: object.id, semantic: object.semantic };
      const cellCenters: [number, number, number][] = [];
      const cellSteps: number[] = [];
      const bounds = new THREE.Box3();
      const boundPoint = new THREE.Vector3();
      const heatColor = new THREE.Color();
      object.cells.forEach((cell, cellIndex) => {
        const center = editedDocument.cellWorldCenter(object.id, cell);
        const step = object.baseStep / 2 ** cell.level;
        cellCenters.push(center); cellSteps.push(step);
        const half = step / 2;
        bounds.expandByPoint(boundPoint.set(center[0] - half, center[1] - half, center[2] - half));
        bounds.expandByPoint(boundPoint.set(center[0] + half, center[1] + half, center[2] + half));
        scale.setScalar(step * 100 * .965);
        matrix.compose(registration.point(...center), registration.orientation, scale); mesh.setMatrixAt(cellIndex, matrix);
        const heat = THREE.MathUtils.clamp((center[1] - heightHeatMinM) / Math.max(1e-6, heightHeatMaxM - heightHeatMinM), 0, 1);
        const color = userColorMode === 'height' ? heatColor.setHSL(.56 - .52 * heat, .78, .55) : semanticColor;
        mesh.setColorAt(cellIndex, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere(); next.add(mesh);

      // Box faces communicate volume; sampled cube edges reveal horizontal and vertical stacking.
      const drawCount = Math.min(object.cells.length, MAX_EDGE_CELLS_PER_OBJECT);
      const vertices = new Float32Array(drawCount * edgePositions.count * 3);
      let offset = 0;
      for (let i = 0; i < drawCount; i++) {
        const cellIndex = Math.floor(i * object.cells.length / drawCount);
        const center = cellCenters[cellIndex];
        const step = cellSteps[cellIndex] * 1.008;
        for (let j = 0; j < edgePositions.count; j++) {
          vertices[offset++] = center[0] + edgePositions.getX(j) * step;
          vertices[offset++] = center[1] + edgePositions.getY(j) * step;
          vertices[offset++] = center[2] + edgePositions.getZ(j) * step;
        }
      }
      const gridGeometry = new LineSegmentsGeometry().setPositions(vertices);
      const gridEdges = new LineSegments2(gridGeometry, new LineMaterial({ color: studioAppearance ? 0xbebebe : 0x292929, linewidth: .85, worldUnits: false, transparent: true, depthWrite: false }));
      gridEdges.name = object.name + ' · 格边'; gridEdges.userData = { gridEdge: true, editableVoxelId: object.id };
      gridEdges.position.copy(registration.point(0, 0, 0)); gridEdges.quaternion.copy(registration.orientation); gridEdges.scale.setScalar(100);
      next.add(gridEdges);
      if (object.id === selectedEditedId && !bounds.isEmpty()) {
        selectedVoxelDetails = { id: object.id, name: object.name, cells: object.cells.length, height: bounds.max.y };
        const size = bounds.getSize(new THREE.Vector3()).addScalar(.012);
        const outlineBox = new THREE.BoxGeometry(size.x, size.y, size.z);
        const outlineEdges = new THREE.EdgesGeometry(outlineBox); outlineBox.dispose();
        // Cathode Studio's contour language: a selected volume keeps a 1.25 CSS-pixel
        // stroke as the user zooms, instead of inheriting WebGL's device-pixel line.
        const outlineGeometry = new LineSegmentsGeometry().setPositions(outlineEdges.getAttribute('position').array as Float32Array);
        outlineEdges.dispose();
        const outline = new LineSegments2(outlineGeometry, new LineMaterial({ color: 0xffd671, linewidth: 1.25, worldUnits: false, transparent: true, depthTest: false, depthWrite: false }));
        const center = bounds.getCenter(new THREE.Vector3());
        outline.name = object.name + ' · 选中框'; outline.userData = { selectedOutline: true, editableVoxelId: object.id };
        outline.position.copy(registration.point(center.x, center.y, center.z)); outline.quaternion.copy(registration.orientation); outline.scale.setScalar(100);
        next.add(outline);
      }
    });
    edgeTemplate.dispose(); edgeBox.dispose();
    if (!objects.length) box.dispose();
    editedGroup = next; scene.add(next);
    editedObjects = objects.map(object => ({ id: object.id, name: object.name, cells: object.cells.length, color: object.color ?? '#eba685' }));
    updateLayerDisplays();
  }
  // Keep the selected object's readout attached to its actual 3D bounds as the camera orbits.
  function updateVoxelAnnotation() {
    const selected = selectedVoxelDetails;
    const outline = editedGroup?.children.find(child => child.userData.selectedOutline);
    if (!selected || selected.id !== selectedEditedId || !outline || !userVisible || userOpacity <= 0 || !container || !camera) {
      if (selectedVoxelScreen) selectedVoxelScreen = null;
      return;
    }
    const point = outline.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 28, 0)).project(camera);
    if (point.z < -1 || point.z > 1 || Math.abs(point.x) > .95 || Math.abs(point.y) > .93) {
      if (selectedVoxelScreen) selectedVoxelScreen = null;
      return;
    }
    const x = Math.round((point.x + 1) * container.clientWidth / 2);
    const y = Math.round((1 - point.y) * container.clientHeight / 2);
    const height = selected.height;
    const previous = selectedVoxelScreen;
    if (!previous || Math.abs(previous.x - x) > 1 || Math.abs(previous.y - y) > 1 || previous.name !== selected.name || previous.cells !== selected.cells || previous.height !== height) {
      selectedVoxelScreen = { x, y, name: selected.name, cells: selected.cells, height };
    }
  }
  function saveEditedDocument(next = editedDocument): boolean {
    if (!scanIdentity) return false;
    try {
      const envelope = makeDesignEnvelope(scanIdentity, next);
      localStorage.setItem(designStorageKey(scanIdentity), JSON.stringify(envelope));
      editedDocument = next;
      renderEditedVoxels();
      editStatus = '已保存在浏览器 · ' + scanIdentity.scanId + ' · 版本 ' + envelope.revision;
      return true;
    } catch (error) { editStatus = '保存失败，保留上一个设计：' + (error instanceof Error ? error.message : String(error)); return false; }
  }
  function mutateEdited(change: (next: VoxelDocument) => void) {
    try { const next = VoxelDocument.fromJSON(editedDocument.toJSON()); change(next); return saveEditedDocument(next); }
    catch (error) { editStatus = error instanceof Error ? error.message : String(error); return false; }
  }
  function downloadJSON(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportEditedJSON() { if (scanIdentity) downloadJSON(makeDesignEnvelope(scanIdentity, editedDocument), scanIdentity.scanId + '-design.json'); }
  async function importEditedJSON(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0];
    if (!file || !scanIdentity) return;
    const identity = scanIdentity;
    try {
      const imported = parseDesignEnvelope(await file.text(), identity);
      if (scanIdentity !== identity) throw new Error('扫描已切换，请重新导入。');
      const next = new VoxelDocument(imported.voxelDocument);
      if (saveEditedDocument(next)) { selectedEditedId = null; editStatus = '设计已恢复：' + next.snapshot().objects.length + ' 个体素盒'; }
    } catch (error) { editStatus = '导入被拒绝，原设计保留：' + (error instanceof Error ? error.message : String(error)); }
    finally { input.value = ''; }
  }
  function exportFullProject() {
    if (!scanIdentity) return;
    try { downloadJSON(makeExperimentPackage(scanIdentity, get(currentProject), editedDocument, currentManifest), scanIdentity.scanId + '-experiment15-project.json'); editStatus = '已导出平面项目、体素设计与扫描来源引用；原始扫描仍保留在本机。'; }
    catch (error) { editStatus = '工程导出失败：' + (error instanceof Error ? error.message : String(error)); }
  }
  async function importFullProject(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0];
    if (!file || !scanIdentity) return;
    const identity = scanIdentity;
    try {
      const imported = parseExperimentPackage(await file.text(), identity);
      if (scanIdentity !== identity) throw new Error('扫描已切换，请重新导入。');
      const next = new VoxelDocument(imported.design.voxelDocument);
      const oldPlan = structuredClone(get(currentProject));
      const key = designStorageKey(identity); const oldStored = localStorage.getItem(key);
      const plan = imported.plan;
      if (oldPlan) plan.id = oldPlan.id; // restore into this scan's independent E11 project
      try {
        localStorage.setItem(key, JSON.stringify(imported.design));
        loadProject(plan);
        if (!await autoSave()) throw new Error('平面项目未能保存。');
      } catch (error) {
        if (oldStored === null) localStorage.removeItem(key); else localStorage.setItem(key, oldStored);
        if (oldPlan) loadProject(oldPlan);
        throw error;
      }
      editedDocument = next; selectedEditedId = null; renderEditedVoxels();
      editStatus = '完整实验工程已恢复（平面 + 体素设计 + 扫描身份）。';
    } catch (error) { editStatus = '工程导入被拒绝，原设计保留：' + (error instanceof Error ? error.message : String(error)); }
    finally { input.value = ''; }
  }
  function placeVoxelBox(worldPoint: THREE.Vector3) {
    if (!scanRoom || !scanIdentity) return;
    try {
      const step = Number(boxStep); const dimensions: [number, number, number] = [Number(boxWidth), Number(boxHeight), Number(boxDepth)];
      if (![.2, .1, .05, .025].includes(step) || dimensions.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error('请选择有效格长与正整数尺寸。');
      const local = scanRegistration(scanRoom).roomPoint(worldPoint.x, worldPoint.y, worldPoint.z);
      const snap = (n: number) => Math.round(Math.floor((n + 1e-7) / step) * step * 10000) / 10000;
      const origin: [number, number, number] = [snap(local.x), Math.round(Math.ceil((Math.max(0, local.y) - 1e-5) / step) * step * 10000) / 10000, snap(local.z)];
      const id = crypto.randomUUID();
      if (mutateEdited(next => { next.createBox({ id, name: boxName.trim() || '新体素盒', semantic: boxSemantic.trim() || 'object', color: boxColor, baseStep: step, origin, dimensions }); })) {
        selectedEditedId = id; editName = boxName.trim() || '新体素盒'; placementMode = false; renderEditedVoxels();
      }
    } catch (error) { editStatus = error instanceof Error ? error.message : String(error); }
  }
  function moveEdited(axis: 0 | 1 | 2, direction: -1 | 1) {
    const id = selectedEditedId; if (!id) return;
    mutateEdited(next => {
      const object = next.getObject(id); if (!object) throw new Error('体素盒不存在。');
      const origin: [number, number, number] = [...object.origin]; origin[axis] = Math.round((origin[axis] + direction * object.placementStep) * 10000) / 10000;
      if (origin[1] < 0) throw new Error('体素盒不能移动到地面下方。'); next.move(id, origin);
    });
  }
  function rotateEdited() { const id = selectedEditedId; if (id) mutateEdited(next => { const object = next.getObject(id); if (object) next.rotate(id, ((object.quarterTurns + 1) % 4) as 0 | 1 | 2 | 3); }); }
  function selectEdited(id: string) { selectedEditedId = id; const object = editedDocument.getObject(id); editName = object?.name ?? ''; editColor = object?.color ?? '#eba685'; renderEditedVoxels(); }
  function renameEdited() { const id = selectedEditedId; if (id) mutateEdited(next => { next.rename(id, editName); }); }
  function recolorEdited() { const id = selectedEditedId; if (id) mutateEdited(next => { next.setColor(id, editColor); }); }
  function deleteEdited() { const id = selectedEditedId; if (id && mutateEdited(next => { next.deleteObject(id); })) { selectedEditedId = null; renderEditedVoxels(); } }
  function refineEdited() { const id = selectedEditedId; if (id) mutateEdited(next => { const object = next.getObject(id); if (object) next.refineToLevel(id, Math.max(...object.cells.map(cell => cell.level)) + 1); }); }
  function visibleMeshes(root: THREE.Object3D): THREE.Object3D[] {
    // Screen-space selection ink is drawn above geometry but is never a placement surface.
    return visibleScanTargets(root).filter(object => !object.userData.selectedOutline && !object.userData.gridEdge);
  }
  function validHit(hit: THREE.Intersection, clipped: boolean): boolean { return !clipEnabled || !clipped || hit.point.y <= Number(clipHeight) * 100 + 1e-4; }
  function objectLayer(id: EvidenceLayerId): boolean { return ['furniture', 'corrected', 'conflict', 'obb', 'slice', 'aabb'].includes(id); }
  function gridLayer(id: EvidenceLayerId): boolean { return ['rawSurface', 'structure', 'furniture', 'corrected', 'conflict', 'unknown', 'clutter', 'sofaCore', 'sofaCandidate', 'chairContinuation', 'chairTableReview', 'unknownStructureResidual', 'unknownOpeningResidual', 'unknownObjectResidual'].includes(id); }
  function selectedHit(hit: THREE.Intersection, id: EvidenceLayerId): boolean {
    // A zero-scaled InstancedMesh matrix must not be trusted as a picking filter.
    return selectedScanObject === null || !objectLayer(id) || hitOwners(hit).includes(selectedScanObject);
  }
  function floorFallback(): THREE.Vector3 | null {
    if (!scanRoom) return null;
    const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!point) return null;
    const local = scanRegistration(scanRoom).roomPoint(point.x, point.y, point.z);
    const polygon = scanRoom.polygon; let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
      if ((zi > local.z) !== (zj > local.z) && local.x < (xj - xi) * (local.z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside ? point : null;
  }
  function handleVoxelClick(event: PointerEvent): boolean {
    if (!currentScan || !scanRoom) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); raycaster.setFromCamera(mouse, camera);
    if (placementMode) {
      const hits: THREE.Intersection[] = [];
      for (const row of layerRows) {
        if (!row.visible || row.opacity <= 0 || !['structure', 'corrected', 'furniture'].includes(row.id)) continue;
        const handle = layerHandles.get(row.id); if (!handle) continue;
        for (const hit of raycaster.intersectObjects(visibleMeshes(handle.group), false)) {
          const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
          if (normal && normal.y > .6 && validHit(hit, row.clipping) && selectedHit(hit, row.id)) hits.push(hit);
        }
      }
      if (editedGroup && userVisible && userOpacity > 0) for (const hit of raycaster.intersectObjects(visibleMeshes(editedGroup), false)) {
        if (hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > .6 && validHit(hit, userClipped)) hits.push(hit);
      }
      hits.sort((a, b) => a.distance - b.distance);
      const point = hits[0]?.point ?? floorFallback();
      if (!point) { editStatus = '请点击房间轮廓内地面或当前可见的水平支撑面。'; return true; }
      placeVoxelBox(point); return true;
    }
    if (editedGroup && userVisible && userOpacity > 0) {
      const hit = raycaster.intersectObjects(visibleMeshes(editedGroup), false).find(hit => validHit(hit, userClipped));
      if (hit?.object.userData.editableVoxelId) { selectEdited(hit.object.userData.editableVoxelId as string); return true; }
    }
    const hits: THREE.Intersection[] = [];
    for (const row of layerRows) {
      const handle = layerHandles.get(row.id); if (!row.visible || row.opacity <= 0 || !handle) continue;
      hits.push(...raycaster.intersectObjects(visibleScanTargets(handle.group, true), false).filter(hit => validHit(hit, row.clipping) && selectedHit(hit, row.id)));
    }
    hits.sort((a, b) => a.distance - b.distance);
    const hit = hits.find(hit => hitOwners(hit).length);
    if (hit) {
      const owners = hitOwners(hit);
      if (owners.length === 1) chooseScanObject(owners[0]);
      else pickStatus = '这个粗格有多个候选：' + owners.map(index => (scanRoom?.objects[index]?.category ?? '物体') + ' ' + (index + 1)).join('、') + '；请选择一个实例查看，不自动裁决。';
      return true;
    }
    return false;
  }

  // Raycasting for wall selection in 3D
  const raycaster = new THREE.Raycaster();
  // OpenPlan uses centimetres; a 3 cm tolerance makes thin object boxes selectable.
  raycaster.params.Line = { threshold: 3 };
  const mouse = new THREE.Vector2();
  const wallMeshMap = new Map<THREE.Object3D, string>(); // mesh → wallId
  let selectedWallId3D: string | null = null;
  const wallHighlight = createWallHighlight();

  // 3D Edit mode — enables click-to-select
  let editMode = $state(false);
  // Wall transparency toggle
  let wallsTransparent = $state(false);
  // Multi-floor stacking
  let showAllFloors = $state(false);
  // How the floors other than the active one are drawn while stacked (issue #130).
  let otherFloorsStyle = $state<StackedFloorsStyle>('translucent');
  const OTHER_FLOOR_STYLES: { style: StackedFloorsStyle; label: TranslationKey }[] = [
    { style: 'translucent', label: 'viewerNav.otherFloorsTranslucent' },
    { style: 'solid', label: 'viewerNav.otherFloorsSolid' },
  ];
  function setOtherFloorsStyle(style: StackedFloorsStyle) {
    otherFloorsStyle = style;
    // The scene signature includes the style, so this rebuilds without refitting the camera.
    rebuildScene();
  }
  let activeFloorElevation = $state(0);
  let sceneGround: THREE.Mesh;
  /** How far beyond the model's bounds a double-click on bare ground still sets the orbit centre, in cm. */
  const ORBIT_PICK_MARGIN = 500;
  /** The site's paved floor just above the ground, and both surfaces' uncut geometry and size. An opening
   *  on the active floor swaps in copies with it cut out. */
  let siteFloor: THREE.Mesh;
  let plainGround: THREE.BufferGeometry, plainSiteFloor: THREE.BufferGeometry;
  const GROUND_SIZE = 40000, SITE_FLOOR_SIZE = 4000;
  // Stacked geometry uses the same floor levels as the 2D reference layer.

  // Walkthrough mode
  let walkthroughMode = $state(false);
  let walkthroughMouseUnavailable = $state(false);
  const walkthroughMotion = new WalkthroughMotion();
  let moveSpeed = $state(800);
  let sprintSpeed = $state(1600);
  let eyeHeight = $state(160); // cm

  // Lighting controls state
  let lightingPanelOpen = $state(false);
  let sunAzimuth = $state(135);      // 0-360 degrees
  let sunElevation = $state(60);     // 0-90 degrees
  let ambientIntensity = $state(0.35);
  let timeOfDay = $state<'morning' | 'noon' | 'evening' | 'night' | null>(null);

  // Light references
  let ambientLight: THREE.AmbientLight;
  let hemiLight: THREE.HemisphereLight;
  let sunLight: THREE.DirectionalLight;
  let fillLight: THREE.DirectionalLight;
  let rimLight: THREE.DirectionalLight;
  let skyCanvas: HTMLCanvasElement;
  let skyTexture: THREE.CanvasTexture;

  // Interior Camera placement
  let cameraPlacementMode = $state(false);
  let interiorCamera: THREE.PerspectiveCamera | null = null;
  let cameraHelper: THREE.Group | null = null;
  let cameraPosition = $state<{ x: number; y: number; z: number }>({ x: 0, y: 160, z: 0 });
  let cameraLookAt = $state<{ x: number; y: number; z: number }>({ x: 100, y: 120, z: 0 });
  let cameraFOV = $state(90);
  let cameraHeight = $state(160);
  let cameraPreviewOpen = $state(false);
  let cameraPreviewCanvas = $state<HTMLCanvasElement | null>(null);
  let cameraPreviewRenderer: THREE.WebGLRenderer | null = null;
  let previewAnimId: number | undefined;
  let cameraPlaced = $state(false);
  let cameraDragMode = $state<'position' | 'lookat' | null>(null);
  let cameraYaw = $state(0);   // degrees, 0 = initial direction
  let cameraPitch = $state(0); // degrees, negative = look down, positive = look up
  let cameraBaseDir = { x: 1, z: 0 }; // normalized direction from position to lookAt
  let cameraPreviewDirty = $state(false);
  let cameraXrayWalls = $state(false);
  let previewDragStart: { x: number; y: number; yaw: number; pitch: number } | null = null;
  let aiRenderOpen = $state(false);
  let aiRendering = $state(false);
  let aiRenderResult = $state<string | null>(null);
  let aiRenderError = $state<string | null>(null);
  let aiRenderStyle = $state('photorealistic');
  let aiRenderLighting = $state('natural daylight');
  let aiRenderMood = $state('warm and inviting');
  let aiRenderExtra = $state('');
  const STYLE_OPTIONS = ['photorealistic', 'architectural visualization', 'interior design magazine', 'minimalist', 'scandinavian', 'industrial', 'mid-century modern', 'luxury'];
  const LIGHTING_OPTIONS = ['natural daylight', 'warm afternoon', 'golden hour', 'soft ambient', 'dramatic shadows', 'bright and airy', 'moody evening', 'studio lighting'];
  const MOOD_OPTIONS = ['warm and inviting', 'clean and modern', 'cozy', 'elegant', 'rustic charm', 'sophisticated', 'relaxed', 'vibrant'];
  let aiProvider = $state<'gemini' | 'openai'>('gemini');
  let aiModel = $state('gemini-2.5-flash-image');
  const AI_MODELS = [
    { id: 'gemini-2.5-flash-image', name: 'Nano Banana (2.5 Flash)', desc: 'Fast & efficient image gen ✓' },
    { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro (3 Pro)', desc: 'Best quality, thinking, up to 4K ✓' },
  ];
  let openaiModel = $state('');
  let renderController: AbortController | null = null;

  function cancelAIRender() {
    if (!renderController) return;
    renderController.abort(); renderController = null; aiRendering = false;
    aiRenderError = 'Request cancelled. The provider may still finish and charge for work already started.';
  }

  function saveRenderModel() {
    try { setOpenAIModel(openaiModel); }
    catch { aiRenderError = 'Browser storage is unavailable. This model will be used for this render only.'; }
  }

  function providerDestination(): string {
    try { return normalizeBaseUrl($openAISettings.baseUrl); }
    catch { return 'Invalid provider URL. Update Settings → AI.'; }
  }

  function buildAIPrompt(): string {
    let prompt = `Transform this interior 3D floor plan render into a ${aiRenderStyle} image. `;
    prompt += `Lighting: ${aiRenderLighting}. Mood: ${aiRenderMood}. `;
    prompt += `Keep the exact same room geometry, furniture placement, and camera angle. `;
    prompt += `Add realistic materials, textures, shadows, and reflections. `;
    prompt += `Make walls, floors, and furniture look like real materials (wood, fabric, metal, etc). `;
    if (aiRenderExtra.trim()) prompt += aiRenderExtra.trim() + ' ';
    prompt += `Do NOT change the room layout, furniture positions, or camera perspective.`;
    return prompt;
  }

  /** Capture scene from interior camera as base64 PNG */
  function captureSceneBase64(width: number, height: number): string {
    updateInteriorCamera();
    const offRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    offRenderer.setSize(width, height);
    offRenderer.shadowMap.enabled = shadowsAllowed(offRenderer);
    offRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    offRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    try {
      return withInteriorScene(() => {
        offRenderer.render(scene, interiorCamera!);
        return offRenderer.domElement.toDataURL('image/png');
      }, false);
    } finally {
      releaseRenderer(offRenderer);
    }
  }

  async function runAIRender() {
    if (!scene || !interiorCamera || aiRendering) return;
    const controller = new AbortController();
    renderController = controller; aiRendering = true;
    aiRenderResult = null; aiRenderError = null;
    try {
      const result = aiProvider === 'gemini' ? await runGeminiRender(controller.signal) : await runOpenAIRender(controller.signal);
      if (renderController === controller) aiRenderResult = result;
    } catch (error) {
      if (renderController === controller) aiRenderError = error instanceof Error ? error.message : 'Rendering failed.';
    } finally {
      if (renderController === controller) { aiRendering = false; renderController = null; }
    }
  }

  async function runGeminiRender(signal: AbortSignal): Promise<string> {
    const geminiKey = localStorage.getItem('o3d_gemini_key');
    if (!geminiKey) {
      throw new Error('Please add your Gemini API key in Settings → AI first.');
    }

    const imageDataUrl = captureSceneBase64(1024, 576);
    const base64Image = imageDataUrl.split(',')[1];
    const prompt = buildAIPrompt();

    const requestBody: any = {
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64Image } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      }
    };
    requestBody.generationConfig.imageConfig = { aspectRatio: '16:9' };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
    if (imagePart) {
      return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    } else {
      const textPart = parts.find((p: any) => p.text && !p.thought);
      throw new Error(textPart?.text || 'No image returned. Try a different model or prompt.');
    }
  }

  async function runOpenAIRender(signal: AbortSignal): Promise<string> {
    const config = { ...get(openAISettings), model: openaiModel };
    validateOpenAIConfig(config);
    const imageDataUrl = captureSceneBase64(1024, 576);
    return generateOpenAIRenderImage(config, imageDataUrl.split(',')[1], buildAIPrompt(), fetch, signal);
  }

  function downloadAIRender() {
    if (!aiRenderResult) return;
    const link = document.createElement('a');
    const projectName = get(currentProject)?.name ?? 'floorplan';
    link.download = `${projectName}-ai-render.png`;
    link.href = aiRenderResult;
    link.click();
  }

  /** Move camera in the XZ plane relative to current facing direction.
   *  forward/right are in camera-local space (forward = facing dir, right = perpendicular). */
  function moveCameraRelative(forward: number, right: number) {
    const yawRad = cameraYaw * Math.PI / 180;
    const cos = Math.cos(yawRad);
    const sin = Math.sin(yawRad);
    // Current facing direction (rotated baseDir by yaw)
    const fwdX = cameraBaseDir.x * cos - cameraBaseDir.z * sin;
    const fwdZ = cameraBaseDir.x * sin + cameraBaseDir.z * cos;
    // Right is perpendicular to forward in XZ
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const dx = fwdX * forward + rightX * right;
    const dz = fwdZ * forward + rightZ * right;
    cameraPosition = { ...cameraPosition, x: cameraPosition.x + dx, z: cameraPosition.z + dz };
    updateCameraMarkerFromState();
    cameraPreviewDirty = true;
  }

  /** Rebuild the 3D camera marker to match current yaw/pitch/position state */
  function updateCameraMarkerFromState() {
    const yawRad = cameraYaw * Math.PI / 180;
    const cos = Math.cos(yawRad);
    const sin = Math.sin(yawRad);
    const dirX = cameraBaseDir.x * cos - cameraBaseDir.z * sin;
    const dirZ = cameraBaseDir.x * sin + cameraBaseDir.z * cos;
    const lookDist = 200;
    createCameraMarker(
      new THREE.Vector3(cameraPosition.x, 0, cameraPosition.z),
      new THREE.Vector3(cameraPosition.x + dirX * lookDist, 0, cameraPosition.z + dirZ * lookDist)
    );
  }

  function createCameraMarker(pos: THREE.Vector3, lookAt: THREE.Vector3) {
    if (cameraHelper) {
      clearGroup(cameraHelper);
      wallGroup.remove(cameraHelper);
    }
    cameraHelper = new THREE.Group();
    cameraHelper.userData.renderExclude = true;
    cameraHelper.name = 'interior_camera';

    // Camera body — small box
    const bodyGeo = new THREE.BoxGeometry(20, 15, 25);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3, metalness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.copy(pos);
    body.position.y = cameraHeight;
    cameraHelper.add(body);

    // Lens — cylinder
    const lensGeo = new THREE.CylinderGeometry(6, 8, 10, 8);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x1e40af, roughness: 0.1, metalness: 0.7 });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.z = Math.PI / 2;
    const dir = new THREE.Vector3().subVectors(lookAt, pos).normalize();
    lens.position.copy(pos);
    lens.position.y = cameraHeight;
    lens.position.add(dir.clone().multiplyScalar(17));
    lens.lookAt(lookAt.x, cameraHeight, lookAt.z);
    lens.rotateX(Math.PI / 2);
    cameraHelper.add(lens);

    // Direction line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pos.x, cameraHeight, pos.z),
      new THREE.Vector3(lookAt.x, cameraHeight * 0.75, lookAt.z)
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 });
    const line = new THREE.Line(lineGeo, lineMat);
    cameraHelper.add(line);

    // FOV cone wireframe
    const halfFov = (cameraFOV / 2) * Math.PI / 180;
    const coneLen = 150;
    const coneW = Math.tan(halfFov) * coneLen;
    const conePoints = [
      new THREE.Vector3(pos.x, cameraHeight, pos.z),
      new THREE.Vector3(pos.x + dir.x * coneLen + dir.z * coneW, cameraHeight, pos.z + dir.z * coneLen - dir.x * coneW),
      new THREE.Vector3(pos.x, cameraHeight, pos.z),
      new THREE.Vector3(pos.x + dir.x * coneLen - dir.z * coneW, cameraHeight, pos.z + dir.z * coneLen + dir.x * coneW),
    ];
    const coneGeo = new THREE.BufferGeometry().setFromPoints(conePoints);
    const coneLine = new THREE.LineSegments(coneGeo, new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.6 }));
    cameraHelper.add(coneLine);

    // Target marker — small sphere
    const targetGeo = new THREE.SphereGeometry(5, 8, 8);
    const targetMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 0.3 });
    const target = new THREE.Mesh(targetGeo, targetMat);
    target.position.set(lookAt.x, cameraHeight * 0.75, lookAt.z);
    cameraHelper.add(target);

    cameraHelper.position.y = activeFloorElevation;
    wallGroup.add(cameraHelper);
    markSceneDirty();
  }

  function updateInteriorCamera() {
    if (!interiorCamera) {
      interiorCamera = new THREE.PerspectiveCamera(cameraFOV, 16 / 9, 1, 5000);
    }
    interiorCamera.fov = cameraFOV;

    // Apply yaw (horizontal) and pitch (vertical) rotation to base direction
    const yawRad = cameraYaw * Math.PI / 180;
    const pitchRad = cameraPitch * Math.PI / 180;
    const cos = Math.cos(yawRad);
    const sin = Math.sin(yawRad);
    const dirX = cameraBaseDir.x * cos - cameraBaseDir.z * sin;
    const dirZ = cameraBaseDir.x * sin + cameraBaseDir.z * cos;
    const lookDist = 500;
    const lookY = cameraHeight + Math.tan(pitchRad) * lookDist;

    setFloorCameraPose(interiorCamera, activeFloorElevation,
      { x: cameraPosition.x, y: cameraHeight, z: cameraPosition.z },
      { x: cameraPosition.x + dirX * lookDist, y: lookY, z: cameraPosition.z + dirZ * lookDist });
    interiorCamera.updateProjectionMatrix();
  }

  /** Fade walls with their baseboards, doors and windows, and ceilings (the meshes
   *  buildWalls flags userData.xray) for the x-ray preview; room contents keep their
   *  look. Every faded material is restored exactly when x-ray is switched off. */
  let restoreWallsXray: (() => void) | null = null;
  function setWallsXray(xray: boolean) {
    restoreWallsXray?.();
    restoreWallsXray = xray && wallGroup ? applyWallXray(wallGroup) : null;
  }

  function captureInteriorPhoto() {
    if (!scene || !interiorCamera) return;
    updateInteriorCamera();

    // Create high-res offscreen renderer
    const width = 1920;
    const height = 1080;
    const offRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    offRenderer.setSize(width, height);
    offRenderer.setPixelRatio(1);
    offRenderer.shadowMap.enabled = shadowsAllowed(offRenderer);
    offRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    offRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    offRenderer.toneMappingExposure = 1.0;

    let dataUrl: string;
    try {
      dataUrl = withInteriorScene(() => {
        offRenderer.render(scene, interiorCamera!);
        return offRenderer.domElement.toDataURL('image/png');
      });
    } finally {
      releaseRenderer(offRenderer);
    }

    // Download
    const link = document.createElement('a');
    const projectName = get(currentProject)?.name ?? 'floorplan';
    link.download = `${projectName}-interior-photo.png`;
    link.href = dataUrl;
    link.click();
  }

  /** Set once this page's viewer lost its context while drawing shadows; its other renderers then skip them too. */
  let shadowsLostHere = false;
  /** When the viewer's renderer started drawing shadow maps. */
  let shadowsStartedAt = 0;

  function shadowsAllowed(target: THREE.WebGLRenderer): boolean {
    return !shadowsLostHere && shadowsSupported(gpuName(target.getContext()));
  }

  /** A driver that drops the context while drawing shadow maps drops it again on every restore, and Chrome then
   *  blocks WebGL for the site, so this page draws without shadows from now on. Only an early or repeated loss is
   *  remembered on the device, as memory pressure or a GPU reset can drop any context once. A backgrounded tab
   *  losing its context is no sign. */
  function onContextLost() {
    if (document.visibilityState !== 'visible' || !renderer.shadowMap.enabled) return;
    renderer.shadowMap.enabled = false;
    shadowsLostHere = true;
    rememberShadowsLost(performance.now() - shadowsStartedAt);
  }

  function releaseRenderer(target: THREE.WebGLRenderer) {
    try { target.dispose(); }
    finally { target.forceContextLoss(); }
  }

  function releaseCameraPreview() {
    if (previewAnimId !== undefined) cancelAnimationFrame(previewAnimId);
    previewAnimId = undefined;
    if (cameraPreviewRenderer) {
      releaseRenderer(cameraPreviewRenderer);
      cameraPreviewRenderer = null;
    }
  }

  function attachCameraPreview(canvas: HTMLCanvasElement) {
    cameraPreviewCanvas = canvas;
    cameraPreviewDirty = true;
    return { destroy() {
      releaseCameraPreview();
      cameraPreviewCanvas = null;
    } };
  }

  function closeCamera() {
    cancelAIRender();
    releaseCameraPreview();
    cameraPreviewOpen = cameraPlaced = cameraPlacementMode = false;
    previewDragStart = null;
    if (cameraHelper) {
      clearGroup(cameraHelper);
      cameraHelper.removeFromParent();
      cameraHelper = null;
    }
    interiorCamera = null;
    aiRenderOpen = false; aiRenderResult = null; aiRenderError = null;
    markSceneDirty();
  }

  /** All temporary presentation changes are restored even if rendering fails. */
  function withInteriorScene<T>(render: () => T, xray = cameraXrayWalls): T {
    const helperVisible = cameraHelper?.visible ?? true;
    const sprites = new Map<THREE.Sprite, boolean>();
    scene.traverse(obj => {
      if (obj instanceof THREE.Sprite) { sprites.set(obj, obj.visible); obj.visible = false; }
    });
    try {
      if (cameraHelper) cameraHelper.visible = false;
      if (xray) setWallsXray(true);
      return render();
    } finally {
      if (xray) setWallsXray(false);
      if (cameraHelper) cameraHelper.visible = helperVisible;
      for (const [sprite, visible] of sprites) sprite.visible = visible;
    }
  }

  function renderCameraPreview() {
    if (!cameraPreviewCanvas || !scene) return;
    updateInteriorCamera();
    if (!interiorCamera) return;

    if (!cameraPreviewRenderer) {
      cameraPreviewRenderer = new THREE.WebGLRenderer({ canvas: cameraPreviewCanvas, antialias: true, alpha: false });
      cameraPreviewRenderer.shadowMap.enabled = shadowsAllowed(cameraPreviewRenderer);
      cameraPreviewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      cameraPreviewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      cameraPreviewRenderer.toneMappingExposure = 1.0;
      cameraPreviewRenderer.setSize(384, 216);
      cameraPreviewRenderer.setPixelRatio(1);
    }
    withInteriorScene(() => cameraPreviewRenderer!.render(scene, interiorCamera!));
    cameraPreviewDirty = false;
  }

  // Cancel pending callbacks when the panel disappears or another update wins.
  $effect(() => {
    if (cameraPreviewDirty && cameraPreviewCanvas && cameraPlaced) {
      previewAnimId = requestAnimationFrame(() => {
        previewAnimId = undefined;
        updateCameraMarkerFromState();
        renderCameraPreview();
      });
      return () => {
        if (previewAnimId !== undefined) cancelAnimationFrame(previewAnimId);
        previewAnimId = undefined;
      };
    }
  });

  // 3D Furniture Placement
  let furniturePlacementMode = $state(false);
  let furniturePickerOpen = $state(false);
  let selectedCatalogId = $state<string | null>(null);
  let furniturePickerCategory = $state<string>('Living Room');
  let ghostGroup: THREE.Group | null = null;
  let floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // y=0 plane
  let ghostIntersection = new THREE.Vector3();

  const TIME_PRESETS = {
    morning: { azimuth: 90, elevation: 25, ambient: 0.3, sunColor: 0xffe0a0, sunIntensity: 0.8, skyTop: '#f5a86c', skyMid: '#fdd89b', skyHorizon: '#ffe8c0', hemiSky: '#fdd89b', hemiGround: '#9b8060' },
    noon:    { azimuth: 180, elevation: 80, ambient: 0.45, sunColor: 0xffffff, sunIntensity: 1.2, skyTop: '#3a7bd5', skyMid: '#87ceeb', skyHorizon: '#c8e8f8', hemiSky: '#87ceeb', hemiGround: '#8b7355' },
    evening: { azimuth: 270, elevation: 15, ambient: 0.2, sunColor: 0xff8040, sunIntensity: 0.6, skyTop: '#2d1b69', skyMid: '#c84e3c', skyHorizon: '#f4a460', hemiSky: '#c84e3c', hemiGround: '#4a3520' },
    night:   { azimuth: 0, elevation: 5, ambient: 0.08, sunColor: 0x8899cc, sunIntensity: 0.15, skyTop: '#0a0a2e', skyMid: '#141432', skyHorizon: '#1a1a3e', hemiSky: '#141432', hemiGround: '#0a0a15' },
  };

  function updateSunPosition() {
    if (!sunLight) return;
    const azRad = (sunAzimuth * Math.PI) / 180;
    const elRad = (sunElevation * Math.PI) / 180;
    const dist = 1500;
    sunLight.position.set(
      dist * Math.cos(elRad) * Math.sin(azRad),
      dist * Math.sin(elRad),
      dist * Math.cos(elRad) * Math.cos(azRad)
    );
    markSceneDirty();
  }

  function updateAmbientIntensity() {
    if (ambientLight) ambientLight.intensity = ambientIntensity;
    markSceneDirty();
  }

  function updateSkyGradient(topColor: string, midColor: string, horizonColor: string) {
    if (!skyCanvas || !skyTexture) return;
    const cx = skyCanvas.getContext('2d')!;
    const grad = cx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, topColor);
    grad.addColorStop(0.4, midColor);
    grad.addColorStop(0.55, horizonColor);
    grad.addColorStop(0.7, '#d4cfc4');
    grad.addColorStop(1.0, '#b8b0a0');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 4, 512);
    refreshBackgroundTexture(skyTexture);
  }

  function applyTimePreset(preset: 'morning' | 'noon' | 'evening' | 'night') {
    const p = TIME_PRESETS[preset];
    timeOfDay = preset;
    sunAzimuth = p.azimuth;
    sunElevation = p.elevation;
    ambientIntensity = p.ambient;
    updateSunPosition();
    updateAmbientIntensity();
    if (sunLight) {
      sunLight.color.set(p.sunColor);
      sunLight.intensity = p.sunIntensity;
    }
    if (hemiLight) {
      hemiLight.color.set(p.hemiSky);
      hemiLight.groundColor.set(p.hemiGround);
      hemiLight.intensity = preset === 'night' ? 0.1 : 0.4;
    }
    if (fillLight) fillLight.intensity = preset === 'night' ? 0.05 : 0.4;
    if (rimLight) rimLight.intensity = preset === 'night' ? 0.05 : 0.25;
    updateSkyGradient(p.skyTop, p.skyMid, p.skyHorizon);
    // The main view redraws for the new lights; an open interior preview redraws only when asked.
    if (cameraPlaced) cameraPreviewDirty = true;
  }

  const WALL_THICKNESS = 15;
  const BASEBOARD_HEIGHT = 8;

  // Create a canvas-based floor texture
  function createFloorTexture(): THREE.CanvasTexture {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const cx = c.getContext('2d')!;
    // Hardwood pattern
    cx.fillStyle = '#c4a882';
    cx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 32) {
      for (let x = 0; x < size; x += 64) {
        const offset = (y / 32) % 2 === 0 ? 0 : 32;
        cx.fillStyle = y % 64 < 32 ? '#b89b72' : '#d4b892';
        cx.fillRect(x + offset, y, 62, 30);
        cx.strokeStyle = '#a08060';
        cx.lineWidth = 0.5;
        cx.strokeRect(x + offset, y, 62, 30);
      }
    }
    const tex = ownColorCanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(10, 10);
    return tex;
  }

  function exitWalkthroughMode() {
    walkthroughMode = false;
    controls.enabled = true;
    walkthroughMotion.reset();
    markSceneDirty();

    if (typeof document !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (hasOpenModal()) return;
    // ESC exits edit mode
    if (event.code === 'Escape' && editMode && !walkthroughMode) {
      if (furniturePlacementMode) {
        furniturePlacementMode = false;
        furniturePickerOpen = false;
        selectedCatalogId = null;
        removeGhostPreview();
        return;
      }
      editMode = false;
      selectedElementId.set(null);
      return;
    }
    if (!walkthroughMode) return;
    if (event.code === 'Escape') { exitWalkthroughMode(); return; }
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
      || isWalkthroughField(event.target)) return;
    if (walkthroughMotion.setKey(event.code, true, event.repeat)) {
      event.preventDefault();
      wakeWalkthrough();
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    walkthroughMotion.setKey(event.code, false);
    wakeWalkthrough();
  }

  function wakeWalkthrough() {
    if (walkthroughMode && walkthroughMotion.active) {
      walkthroughMotion.startClock(performance.now());
      requestRender();
    }
  }

  function resetWalkthroughInput() {
    walkthroughMotion.reset();
  }

  function isWalkthroughField(target: EventTarget | null) {
    return target instanceof HTMLElement && (target.isContentEditable
      || Boolean(target.closest('input, textarea, select')));
  }

  function onWalkthroughFocus(event: FocusEvent) {
    if (hasOpenModal() || isWalkthroughField(event.target)) resetWalkthroughInput();
  }

  function init() {
    scene = new THREE.Scene();

    // Cathode's graded dark plate, generated once; no extra WebGL renderer or prop scene.
    const studioCanvas = document.createElement('canvas');
    studioCanvas.width = studioCanvas.height = 512;
    const studioContext = studioCanvas.getContext('2d')!;
    const studioGrade = studioContext.createRadialGradient(250, 220, 24, 250, 220, 390);
    studioGrade.addColorStop(0, '#171717');
    studioGrade.addColorStop(.55, '#101010');
    studioGrade.addColorStop(1, '#080808');
    studioContext.fillStyle = studioGrade;
    studioContext.fillRect(0, 0, 512, 512);
    studioBackground = ownColorCanvasTexture(studioCanvas);

    // Sky dome — hemisphere with gradient texture mapped inside
    skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4; skyCanvas.height = 512;
    const cx = skyCanvas.getContext('2d')!;
    const grad = cx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#4a90d9');
    grad.addColorStop(0.3, '#87ceeb');
    grad.addColorStop(0.5, '#b8ddf0');
    grad.addColorStop(0.55, '#f0ece4');
    grad.addColorStop(0.7, '#d4cfc4');
    grad.addColorStop(1.0, '#b8b0a0');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 4, 512);
    skyTexture = ownColorCanvasTexture(skyCanvas);
    // Use as scene background (maps onto equirectangular projection)
    skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = currentScan && studioAppearance ? studioBackground : skyTexture;

    // Ground plane — textured concrete with grid overlay
    const groundSize = GROUND_SIZE;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    plainGround = groundGeo;
    // Generate a subtle concrete texture with grid
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 1024; groundCanvas.height = 1024;
    const gctx = groundCanvas.getContext('2d')!;
    // Base concrete color with noise
    gctx.fillStyle = '#c8c2b8';
    gctx.fillRect(0, 0, 1024, 1024);
    // Add subtle noise for concrete feel
    for (let i = 0; i < 30000; i++) {
      const nx = Math.random() * 1024;
      const ny = Math.random() * 1024;
      const v = 180 + Math.random() * 30;
      gctx.fillStyle = `rgba(${v},${v-5},${v-12},0.15)`;
      gctx.fillRect(nx, ny, 2, 2);
    }
    // Grid lines every 128px (= 500cm real-world at current repeat)
    gctx.strokeStyle = 'rgba(0,0,0,0.08)';
    gctx.lineWidth = 1;
    const gridStep = 128;
    for (let x = 0; x <= 1024; x += gridStep) {
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, 1024); gctx.stroke();
    }
    for (let y = 0; y <= 1024; y += gridStep) {
      gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(1024, y); gctx.stroke();
    }
    // Thicker lines every 4 grid cells (= 2000cm / 20m)
    gctx.strokeStyle = 'rgba(0,0,0,0.15)';
    gctx.lineWidth = 2;
    for (let x = 0; x <= 1024; x += gridStep * 4) {
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, 1024); gctx.stroke();
    }
    for (let y = 0; y <= 1024; y += gridStep * 4) {
      gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(1024, y); gctx.stroke();
    }
    const groundTex = ownColorCanvasTexture(groundCanvas);
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(groundSize / 4000, groundSize / 4000);
    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.92,
      metalness: 0
    });
    Object.assign(groundMat, depthOffset(DEPTH_ORDER.ground));
    const ground = new THREE.Mesh(groundGeo, groundMat);
    sceneGround = ground;
    // The scan's classified floor is below y=0; the presentation plane would occlude it.
    ground.visible = !currentScan;
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    ground.receiveShadow = true;
    scene.add(ground);

    // A 1 cm near plane cannot separate the floor layers (0, 0.5, 1 cm) from 40 m away.
    camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 5, 20000);
    camera.position.set(800, 600, 800);

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      // WebGL is off, blocked or unsupported in this browser, and three has logged the error. Release
      // the scene built so far; onMount then starts nothing that needs a renderer.
      skyTexture.dispose();
      studioBackground?.dispose();
      clearGroup(scene);
      webglUnavailable = true;
      return false;
    }
    renderer.localClippingEnabled = true;
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    // three.js keeps the scene for a restored context (a mobile GPU reset, say); it only needs a frame.
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', markSceneDirty);
    renderer.shadowMap.enabled = shadowsAllowed(renderer);
    shadowsStartedAt = performance.now();
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = currentScan && studioAppearance ? 1.06 : 1.2;
    renderer.domElement.dataset.plan3dCanvas = 'true';
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 100, 0);
    controls.maxPolarAngle = Math.PI / 2.05;
    // A pinch can dolly by an infinite factor; at radius 0 every later pinch would scale nothing.
    controls.minDistance = 1;
    // Mark dirty when orbit controls move the camera
    controls.addEventListener('change', markSceneDirty);

    // Click-to-select walls via raycasting
    let pointerDownPos = { x: 0, y: 0 };
    renderer.domElement.addEventListener('pointerdown', (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      // Only select in edit mode, and only if mouse didn't move much (not a drag/orbit)
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 5) return;
      if (walkthroughMode) return;
      // Explicit native tools keep priority over passive scan-object inspection.
      if (cameraPlacementMode || furniturePlacementMode) placementMode = false;
      else if (handleVoxelClick(e)) return;
      if (!editMode) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Camera placement mode: first click = position, second click = look-at target
      if (cameraPlacementMode) {
        const hit = new THREE.Vector3();
        if (activeFloorHit(hit)) {
          if (!cameraPlaced) {
            // First click: place camera position
            cameraPosition = { x: hit.x, y: cameraHeight, z: hit.z };
            cameraLookAt = { x: hit.x + 200, y: cameraHeight * 0.75, z: hit.z };
            cameraBaseDir = { x: 1, z: 0 };
            cameraYaw = 0;
            cameraPitch = 0;
            cameraPlaced = true;
            updateInteriorCamera();
            createCameraMarker(new THREE.Vector3(hit.x, 0, hit.z), new THREE.Vector3(hit.x + 200, 0, hit.z));
            cameraPreviewOpen = true;
            cameraPreviewDirty = true;
          } else {
            // Second click: set look-at direction
            cameraLookAt = { x: hit.x, y: cameraHeight * 0.75, z: hit.z };
            const dx = hit.x - cameraPosition.x;
            const dz = hit.z - cameraPosition.z;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            cameraBaseDir = { x: dx / len, z: dz / len };
            cameraYaw = 0;
            cameraPitch = 0;
            updateInteriorCamera();
            createCameraMarker(
              new THREE.Vector3(cameraPosition.x, 0, cameraPosition.z),
              new THREE.Vector3(hit.x, 0, hit.z)
            );
            cameraPlacementMode = false;
            cameraPreviewDirty = true;
          }
        }
        return;
      }

      // Furniture placement mode: place on floor
      if (furniturePlacementMode && selectedCatalogId) {
        raycaster.setFromCamera(mouse, camera);
        const hit = new THREE.Vector3();
        if (activeFloorHit(hit)) {
          // Convert 3D (x, z) to 2D (x, y)
          const pos2D = { x: hit.x, y: hit.z };
          addFurniture(selectedCatalogId, pos2D);
          // Scene will rebuild via store subscription
        }
        return;
      }

      // A solid stacked floor in front of a wall hides it, so the click stops there.
      selectedElementId.set(pickedWallId(raycaster.intersectObjects(wallGroup.children, false), otherFloorsStyle));
    });

    // Double-click: orbit around the clicked point. Camera and target move by the same offset,
    // so the view direction and distance stay the same.
    // A placement click turns its mode off before the dblclick arrives, so note the mode when the press starts.
    let orbitPickBlocked = false;
    renderer.domElement.addEventListener('pointerdown', () => {
      orbitPickBlocked = walkthroughMode || cameraPlacementMode || furniturePlacementMode;
    });
    renderer.domElement.addEventListener('dblclick', (e) => {
      if (orbitPickBlocked || walkthroughMode || cameraPlacementMode || furniturePlacementMode) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      // Skip labels and anything hidden or excluded from the rendered model (ceilings).
      const shown = (o: THREE.Object3D | null): boolean => !o || (o.visible && !o.userData.renderExclude && shown(o.parent));
      // Translucent stacked floors are see-through for picking, as for selection and placement.
      const seeThrough = (o: THREE.Object3D) => o.userData.stackedFloor && otherFloorsStyle === 'translucent';
      const hit = raycaster.intersectObjects(wallGroup.children, true)
        .find(i => !(i.object instanceof THREE.Sprite) && shown(i.object) && !seeThrough(i.object));
      let point = hit?.point ?? null;
      if (!point) {
        // Off the model, the floor plane runs to the horizon: only orbit around ground near the plan.
        const near = new THREE.Box3().setFromObject(wallGroup).expandByScalar(ORBIT_PICK_MARGIN);
        point = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
        if (point && (near.isEmpty() || !near.containsPoint(point.clone().setY(near.min.y)))) point = null;
      }
      if (!point) return;
      orbitGlide = { position: camera.position.clone(), target: controls.target.clone(), offset: point.sub(controls.target), start: performance.now() };
      requestRender();
    });
    controls.addEventListener('start', () => { orbitGlide = null; scanViewGlide = null; });

    // Hover highlight in edit mode
    let hoveredMesh: THREE.Mesh | null = null;
    renderer.domElement.addEventListener('mousemove', (e) => {
      // Furniture placement ghost preview
      if (editMode && furniturePlacementMode && selectedCatalogId) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hit = new THREE.Vector3();
        if (activeFloorHit(hit)) {
          if (!ghostGroup) {
            createGhostPreview(selectedCatalogId);
          }
          if (ghostGroup) {
            // A new item takes its catalog default height above the floor, as placement will save it.
            ghostGroup.position.set(hit.x, hit.y + placedFurnitureY({ catalogId: selectedCatalogId, scale: { x: 1, y: 1, z: 1 } }), hit.z);
            ghostGroup.visible = true;
          }
        } else if (ghostGroup) {
          ghostGroup.visible = false;
        }
        markSceneDirty();
        renderer.domElement.style.cursor = 'crosshair';
        return;
      } else if (ghostGroup?.visible) {
        ghostGroup.visible = false;
        markSceneDirty();
      }

      if (!editMode) {
        if (hoveredMesh) { hoveredMesh = null; renderer.domElement.style.cursor = ''; }
        return;
      }
      renderer.domElement.style.cursor = 'pointer';
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(wallGroup.children, false);
      const hit = pickedWallId(intersects, otherFloorsStyle) ? intersects.find(i => i.object.userData.wallId) : undefined;
      if (hit && hit.object !== hoveredMesh) {
        hoveredMesh = hit.object as THREE.Mesh;
        renderer.domElement.style.cursor = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="%23fff" stroke="%23000" stroke-width="1.5" d="M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15a1.49 1.49 0 0 0 0 2.12l5.5 5.5a1.49 1.49 0 0 0 2.12 0l5.5-5.5a1.49 1.49 0 0 0 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5a2 2 0 1 0 4 0c0-1.33-2-3.5-2-3.5z"/></svg>') + '") 2 22, pointer';
      } else if (!hit) {
        hoveredMesh = null;
        renderer.domElement.style.cursor = editMode ? 'crosshair' : '';
      }
    });

    // Initialize PointerLock controls for walkthrough mode
    pointerControls = new PointerLockControls(camera, renderer.domElement);
    pointerControls.addEventListener('change', markSceneDirty);

    // Keyboard event listeners for walkthrough
    document.addEventListener('keydown', onKeyDown, false);
    document.addEventListener('keyup', onKeyUp, false);
    window.addEventListener('blur', resetWalkthroughInput);
    document.addEventListener('visibilitychange', resetWalkthroughInput);
    document.addEventListener('focusin', onWalkthroughFocus);

    // ESC key to exit walkthrough mode
    pointerControls.addEventListener('unlock', () => {
      if (walkthroughMode) {
        exitWalkthroughMode();
      }
    });

    // Lights — improved multi-source setup
    ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);
    hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.4);
    scene.add(hemiLight);

    // Key light (sun)
    sunLight = new THREE.DirectionalLight(0xfff8e7, 1.0);
    sunLight.position.set(500, 1200, 800);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.left = -1500;
    sunLight.shadow.camera.right = 1500;
    sunLight.shadow.camera.top = 1500;
    sunLight.shadow.camera.bottom = -1500;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    // Fill light — softer, opposite side to reduce harsh shadows
    fillLight = new THREE.DirectionalLight(0xc8d8f0, 0.4);
    fillLight.position.set(-600, 800, -400);
    scene.add(fillLight);

    // Rim/back light for depth
    rimLight = new THREE.DirectionalLight(0xffe4c4, 0.25);
    rimLight.position.set(-200, 600, 1000);
    scene.add(rimLight);

    // Textured floor
    const floorTex = createFloorTexture();
    const floorGeo = new THREE.PlaneGeometry(SITE_FLOOR_SIZE, SITE_FLOOR_SIZE);
    plainSiteFloor = floorGeo;
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, side: THREE.DoubleSide, roughness: 0.8, ...depthOffset(DEPTH_ORDER.basePlane) });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    siteFloor = floorMesh;
    floorMesh.visible = !currentScan;
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.5;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    wallGroup = new THREE.Group();
    scene.add(wallGroup);
    return true;
  }

  /** Where the pointer ray meets the active floor's plane, unless a solid stacked floor hides that spot. */
  function activeFloorHit(target: THREE.Vector3): boolean {
    if (!raycaster.ray.intersectPlane(floorPlane, target)) return false;
    if (otherFloorsStyle !== 'solid') return true;
    const distance = raycaster.ray.origin.distanceTo(target);
    return !stackedFloorOccludes(raycaster.intersectObjects(wallGroup.children, false), distance, otherFloorsStyle);
  }

  function createGhostPreview(catalogId: string) {
    removeGhostPreview();
    const cat = getCatalogItem(catalogId);
    if (!cat || cat.symbol) return;
    const model = createFurnitureModelWithGLB(catalogId, cat, markSceneDirty, { ghost: true });
    model.visible = false;
    ghostGroup = model;
    scene.add(ghostGroup);
  }

  function removeGhostPreview() {
    if (ghostGroup) {
      scene.remove(ghostGroup);
      disposeModel(ghostGroup);
      ghostGroup = null;
      markSceneDirty();
    }
  }

  function autoCenterCamera() {
    orbitGlide = null;
    frameScene(camera, new THREE.Box3().setFromObject(wallGroup), controls.target);
    controls.update();
  }

  /** Generate a wall texture. Wall UVs already count 200 cm tiles (mapWallUVs), so it sets no repeat. */
  function generateWallTexture(textureId: string, color: string): THREE.CanvasTexture {
    const canvas = getWallTextureCanvas(textureId, color);
    if (!canvas) {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const cx = c.getContext('2d')!;
      cx.fillStyle = color;
      cx.fillRect(0, 0, 64, 64);
      const tex = ownColorCanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    }
    const tex = ownColorCanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function buildStraightStairRun(group: THREE.Group, mat: THREE.MeshStandardMaterial, sideMat: THREE.MeshStandardMaterial, width: number, depth: number, riserCount: number, riserHeight: number, offsetX: number, offsetY: number, offsetZ: number) {
    const treadDepth = depth / riserCount;
    for (let i = 0; i < riserCount; i++) {
      const treadGeo = new THREE.BoxGeometry(width, 3, treadDepth);
      const tread = new THREE.Mesh(treadGeo, mat);
      tread.position.set(offsetX, offsetY + (i + 1) * riserHeight - 1.5, offsetZ + i * treadDepth + treadDepth / 2);
      tread.castShadow = true;
      tread.receiveShadow = true;
      group.add(tread);

      // Inset into the tread so no riser face is coplanar with the tread's sides or top.
      const riserGeo = new THREE.BoxGeometry(width - 1, riserHeight - 0.5, 2);
      const riser = new THREE.Mesh(riserGeo, sideMat);
      riser.position.set(offsetX, offsetY + i * riserHeight + (riserHeight - 0.5) / 2, offsetZ + i * treadDepth);
      riser.castShadow = true;
      group.add(riser);
    }
  }

  /** Stairs climb to the next floor (up) or descend to the floor below (down); see stairLevels. */
  function buildStairs(floor: Floor, group: THREE.Group = wallGroup, yOffset = 0, opacity = 1) {
    if (!floor.stairs?.length) return;
    const rises = stairRises(get(currentProject)?.floors ?? [floor], floor.id);
    const reference = opacity < 1 ? { transparent: true, opacity } : {};
    for (const stair of floor.stairs) {
      const { base, rise: totalHeight } = stairSpan(stair, rises);
      const riserHeight = totalHeight / stair.riserCount;
      const mat = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.7, ...reference });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xb8956a, roughness: 0.8, ...reference });
      const type = stair.stairType || 'straight';

      const stairGroup = new THREE.Group();

      // Runs and landings follow the plan's shape, climbing the way its UP arrow points.
      // Stair-local plan (x, y) is the group's (x, z).
      const flights = stairFlights(stair);
      for (const run of flights.runs) {
        const runGroup = new THREE.Group();
        buildStraightStairRun(runGroup, mat, sideMat, run.width, run.length, run.risers, riserHeight, 0, 0, 0);
        runGroup.position.set(run.start.x, run.firstRiser * riserHeight, run.start.y);
        runGroup.rotation.y = Math.atan2(run.dir.x, run.dir.y);
        stairGroup.add(runGroup);
      }
      for (const landing of flights.landings) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(landing.width, 3, landing.height), mat);
        mesh.position.set(landing.x + landing.width / 2, landing.atRiser * riserHeight - 1.5, landing.y + landing.height / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        stairGroup.add(mesh);
      }

      if (type === 'spiral') {
        const radius = Math.min(stair.width, stair.depth) / 2;
        const postR = radius * 0.1;
        // Center post
        const postGeo = new THREE.CylinderGeometry(postR, postR, totalHeight, 8);
        const post = new THREE.Mesh(postGeo, sideMat);
        post.position.set(0, totalHeight / 2, 0);
        post.castShadow = true;
        stairGroup.add(post);
        // Spiral treads as wedge-shaped steps, over the plan's sweep. The shape is laid flat with its y
        // along -z, so a plan angle a is the shape angle -a.
        for (let i = 0; i < stair.riserCount; i++) {
          const angle = -(SPIRAL_START_ANGLE + (i / stair.riserCount) * SPIRAL_SWEEP);
          const nextAngle = -(SPIRAL_START_ANGLE + ((i + 1) / stair.riserCount) * SPIRAL_SWEEP);
          const y = (i + 1) * riserHeight;
          // Create wedge shape using ExtrudeGeometry
          const shape = new THREE.Shape();
          shape.moveTo(postR * Math.cos(angle), postR * Math.sin(angle));
          shape.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
          // Arc outer edge
          const arcSteps = 4;
          for (let j = 1; j <= arcSteps; j++) {
            const a = angle + (nextAngle - angle) * (j / arcSteps);
            shape.lineTo(radius * Math.cos(a), radius * Math.sin(a));
          }
          shape.lineTo(postR * Math.cos(nextAngle), postR * Math.sin(nextAngle));
          shape.closePath();
          const extrudeSettings = { depth: 3, bevelEnabled: false };
          const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
          const tread = new THREE.Mesh(geo, mat);
          tread.rotation.x = -Math.PI / 2;
          tread.position.y = y - 3; // the 3 cm extrusion rises from here; its top is the step, as on straight runs
          tread.castShadow = true;
          tread.receiveShadow = true;
          stairGroup.add(tread);
        }
      }

      // A down stair is the same flight as the up stair it meets on the floor below, so it keeps
      // that shape and footprint and only moves down (the plan draws both with the same treads).
      stairGroup.position.set(stair.position.x, yOffset + base, stair.position.y);
      stairGroup.rotation.y = -(stair.rotation * Math.PI) / 180;
      group.add(stairGroup);
    }
  }

  function buildColumns(floor: Floor) {
    if (!floor.columns) return;
    for (const col of floor.columns) {
      const h = col.height || 280;
      const mat = new THREE.MeshStandardMaterial({ color: col.color || '#cccccc', roughness: 0.7, ...depthOffset(DEPTH_ORDER.column) });
      const mesh = new THREE.Mesh(columnGeometry(col), mat);
      mesh.position.set(col.position.x, h / 2, col.position.y);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      wallGroup.add(mesh);
    }
  }

  function clearGroup(group: THREE.Object3D) {
    disposeModel(group);
    group.clear();
  }

  /** A wooden door leaf `w` wide and `h` tall, pivoting on its hinge edge: local x runs
   * 0..w from the hinge, y is centred on the leaf. Shaker styles are four stacked
   * recessed panels in a stile-and-rail frame; glazed shaker glazes the top two, and
   * fully glazed fills the frame with one pane. Victorian styles are a 2×2 grid split by
   * a centre muntin and a lock rail centred at `lockY` (the handle height); the glazed
   * version glazes the upper pair. */
  function buildDoorLeaf(w: number, h: number, style: NonNullable<Door['leafStyle']>, woodMat: THREE.Material, panelMat: THREE.Material, glassMat: THREE.Material, lockY = 0): THREE.Group {
    const leaf = new THREE.Group();
    const depth = 4;
    const add = (bw: number, bh: number, d: number, x: number, y: number, mat: THREE.Material, glass = false) => {
      if (bw <= 0 || bh <= 0) return;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), mat);
      mesh.position.set(x, y, 0);
      mesh.castShadow = !glass;
      mesh.userData.xray = true;
      mesh.userData.renderExclude = glass;
      leaf.add(mesh);
    };
    const stile = Math.min(11, w * 0.15), topRail = Math.min(11, h * 0.06), bottomRail = Math.min(20, h * 0.1);
    if (style === 'slab' || w < stile * 2 + 10 || h < topRail + bottomRail + 20) {
      add(w, h, depth, w / 2, 0, woodMat);
      return leaf;
    }
    const bottom = -h / 2, top = h / 2, innerW = w - stile * 2, cx = w / 2;
    add(stile, h, depth, stile / 2, 0, woodMat);
    add(stile, h, depth, w - stile / 2, 0, woodMat);
    add(innerW, bottomRail, depth, cx, bottom + bottomRail / 2, woodMat);
    add(innerW, topRail, depth, cx, top - topRail / 2, woodMat);
    const openH = h - topRail - bottomRail;
    if (style === 'glazed') {
      add(innerW, openH, 1, cx, bottom + bottomRail + openH / 2, glassMat, true);
      return leaf;
    }
    if (style === 'victorian' || style === 'glazedVictorian') {
      const lockRail = Math.min(18, openH * 0.1), muntin = Math.min(10, innerW * 0.12);
      // Keep both panel rows at least 15 cm tall wherever the handle sits
      const lock = Math.max(bottom + bottomRail + 15 + lockRail / 2, Math.min(top - topRail - 15 - lockRail / 2, lockY));
      add(innerW, lockRail, depth, cx, lock, woodMat);
      const lowerH = lock - lockRail / 2 - (bottom + bottomRail), upperH = top - topRail - (lock + lockRail / 2);
      add(muntin, lowerH, depth, cx, bottom + bottomRail + lowerH / 2, woodMat);
      add(muntin, upperH, depth, cx, top - topRail - upperH / 2, woodMat);
      const panelW = (innerW - muntin) / 2;
      for (const side of [-1, 1]) {
        const px = cx + side * (muntin / 2 + panelW / 2);
        add(panelW, lowerH, depth - 2, px, bottom + bottomRail + lowerH / 2, panelMat);
        if (style === 'glazedVictorian') add(panelW, upperH, 1, px, top - topRail - upperH / 2, glassMat, true);
        else add(panelW, upperH, depth - 2, px, top - topRail - upperH / 2, panelMat);
      }
      return leaf;
    }
    // Four equal stacked panels split by three intermediate rails
    const midRail = Math.min(9, openH * 0.06), panelH = (openH - midRail * 3) / 4;
    for (let i = 0; i < 4; i++) {
      const y = bottom + bottomRail + i * (panelH + midRail) + panelH / 2;
      if (style === 'glazedShaker' && i >= 2) add(innerW, panelH, 1, cx, y, glassMat, true);
      else add(innerW, panelH, depth - 2, cx, y, panelMat); // recessed 1 cm each face
      if (i < 3) add(innerW, midRail, depth, cx, y + panelH / 2 + midRail / 2, woodMat);
    }
    return leaf;
  }

  function addOpeningFrame(wall: Wall, position: number, width: number, bottom: number, height: number, depth: number, material: THREE.Material, excludeFromRender = false) {
    const path = wallPathProfile(wall);
    const rect = pathOpening(path, position * path.length, width, bottom, height);
    if (!rect) return;
    for (const span of path.spans) {
      const from = Math.max(span.from, rect.left), to = Math.min(span.to, rect.right);
      if (to <= from) continue;
      const center = path.sample((from + to) / 2).point;
      const geo = new THREE.BoxGeometry(to - from, rect.top - rect.bottom, depth);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(center.x, (rect.bottom + rect.top) / 2, center.y);
      mesh.rotation.y = -Math.atan2(span.end.y - span.start.y, span.end.x - span.start.x);
      mesh.userData.renderExclude = excludeFromRender;
      mesh.userData.xray = true;
      mesh.castShadow = !excludeFromRender;
      wallGroup.add(mesh);
    }
  }

  function buildWalls(floor: Floor) {
    wallHighlight.clear();
    clearGroup(wallGroup);
    cameraHelper = null;
    wallMeshMap.clear();

    const defaultInteriorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, ...depthOffset(DEPTH_ORDER.interiorWall) });
    const defaultExteriorMat = new THREE.MeshStandardMaterial({ color: 0xd4cfc9, roughness: 0.85 });
    const baseboardMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.7 });

    for (const wall of floor.walls) {
      // Resolve per-side materials: interior and exterior can have independent color/texture
      const DEFAULT_2D_COLORS = ['#cccccc', '#888888', '#444444', '#404040'];

      function resolveWallMat(color: string | undefined, texture: string | undefined, fallback: THREE.MeshStandardMaterial, isInterior: boolean = false): THREE.MeshStandardMaterial {
        const polyOff = isInterior ? depthOffset(DEPTH_ORDER.interiorWall) : {};
        if (texture) {
          const tex = generateWallTexture(texture, color || '#888888');
          return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, ...polyOff });
        }
        if (color && !DEFAULT_2D_COLORS.includes(color.toLowerCase())) {
          return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.9, ...polyOff });
        }
        return fallback;
      }

      // Interior: use interiorColor/interiorTexture if set, else fall back to wall.color/wall.texture
      // 'none' means explicitly no texture (overrides shared wall.texture)
      const intTex = wall.interiorTexture === 'none' ? undefined : (wall.interiorTexture || wall.texture);
      let interiorMat = resolveWallMat(
        wall.interiorColor || wall.color,
        intTex,
        defaultInteriorMat,
        true
      );
      // Exterior: use exteriorColor/exteriorTexture if set, else fall back to wall.color/wall.texture (auto-darkened)
      const extTex = wall.exteriorTexture === 'none' ? undefined : (wall.exteriorTexture || wall.texture);
      let exteriorMat: THREE.MeshStandardMaterial;
      if (extTex || wall.exteriorColor) {
        exteriorMat = resolveWallMat(wall.exteriorColor, extTex, defaultExteriorMat);
      } else if (wall.texture) {
        const extTex = generateWallTexture(wall.texture, wall.color || '#888888');
        exteriorMat = new THREE.MeshStandardMaterial({ map: extTex, roughness: 0.85 });
      } else if (wall.color && !DEFAULT_2D_COLORS.includes(wall.color.toLowerCase())) {
        const c = new THREE.Color(wall.color).offsetHSL(0, -0.05, -0.1);
        exteriorMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
      } else {
        exteriorMat = defaultExteriorMat;
      }
      const startH = getWallStartHeight(wall);
      const endH = getWallEndHeight(wall);

      // Curved wall handling
      if (wall.curvePoint) {
        const t = Math.max(wall.thickness, WALL_THICKNESS);
        const materials = [
          exteriorMat, exteriorMat,
          interiorMat, interiorMat,
          interiorMat, exteriorMat,
        ];
        const doors = floor.doors.filter(d => d.wallId === wall.id);
        const windows = floor.windows.filter(w => w.wallId === wall.id);
        for (const span of wallProfileSpans(wall, doors, windows)) {
          const angle = Math.atan2(span.end.y - span.start.y, span.end.x - span.start.x);
          for (const segment of span.segments) {
            const geo = mapWallUVs(createSlopedBoxGeometry(segment.width, t, segment.bottomY, segment.topYLeft, segment.topYRight), span.from + segment.offsetX);
            const mesh = new THREE.Mesh(geo, materials);
            mesh.castShadow = true; mesh.receiveShadow = true;
            mesh.position.set(span.start.x + segment.offsetX * Math.cos(angle), 0, span.start.y + segment.offsetX * Math.sin(angle));
            mesh.rotation.y = -angle; mesh.userData.wallId = wall.id; mesh.userData.xray = true;
            wallMeshMap.set(mesh, wall.id); wallGroup.add(mesh);
          }
        }
        // The same cuts keep baseboards out of curved doorways.
        if (Math.min(startH, endH) >= BASEBOARD_HEIGHT) {
          const base = { ...wall, height: BASEBOARD_HEIGHT, startHeight: BASEBOARD_HEIGHT, endHeight: BASEBOARD_HEIGHT };
          const pathLength = wallPathProfile(base).length;
          for (const span of wallProfileSpans(base, doors, windows)) {
            const angle = Math.atan2(span.end.y - span.start.y, span.end.x - span.start.x);
            for (const segment of span.segments) {
              const { width, offsetX } = baseboardSegment(segment, span, pathLength);
              if (width <= 0) continue;
              const mesh = new THREE.Mesh(createSlopedBoxGeometry(width, t + 2, segment.bottomY, segment.topYLeft, segment.topYRight), baseboardMat);
              mesh.position.set(span.start.x + offsetX * Math.cos(angle), 0, span.start.y + offsetX * Math.sin(angle));
              mesh.rotation.y = -angle; mesh.castShadow = true; mesh.userData.xray = true; wallGroup.add(mesh);
            }
          }
        }
          continue;
        }

        const dx = wall.end.x - wall.start.x;
        const dy = wall.end.y - wall.start.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;

        const t = Math.max(wall.thickness, WALL_THICKNESS);
        const angle = Math.atan2(dy, dx);
        const cx = (wall.start.x + wall.end.x) / 2;
        const cy = (wall.start.y + wall.end.y) / 2;

        const doorOpenings = floor.doors.filter((d) => d.wallId === wall.id);
        const winOpenings = floor.windows.filter((w) => w.wallId === wall.id);
        const segments = buildWallSegments(len, startH, endH, doorOpenings, winOpenings);

        for (const seg of segments) {
          const geo = mapWallUVs(createSlopedBoxGeometry(seg.width, t, seg.bottomY, seg.topYLeft, seg.topYRight), seg.offsetX);

          // Create a multi-material wall: interior white, exterior brown
          const materials = [
            exteriorMat, exteriorMat, // left, right
            interiorMat, interiorMat, // top, bottom
            interiorMat, exteriorMat, // front (interior), back (exterior)
          ];
          const mesh = new THREE.Mesh(geo, materials);
          mesh.castShadow = true;
          mesh.receiveShadow = true;

          const localX = seg.offsetX - len / 2;
          mesh.position.set(
            cx + localX * Math.cos(angle),
            0,
            cy + localX * Math.sin(angle)
          );
          mesh.rotation.y = -angle;
          mesh.userData.wallId = wall.id;
          mesh.userData.xray = true;
          wallMeshMap.set(mesh, wall.id);
          wallGroup.add(mesh);
        }

        // Baseboard — the wall's own opening cuts at baseboard height, as on curved
        // walls: doors and windows whose sill is below the board cut it too.
        if (Math.min(startH, endH) >= BASEBOARD_HEIGHT) {
          for (const seg of buildWallSegments(len, BASEBOARD_HEIGHT, BASEBOARD_HEIGHT, doorOpenings, winOpenings)) {
            const { width, offsetX } = baseboardSegment(seg, { from: 0, length: len }, len);
            if (width <= 0) continue;
            const bbMesh = new THREE.Mesh(createSlopedBoxGeometry(width, t + 2, seg.bottomY, seg.topYLeft, seg.topYRight), baseboardMat);
            const localX = offsetX - len / 2;
            bbMesh.position.set(cx + localX * Math.cos(angle), 0, cy + localX * Math.sin(angle));
            bbMesh.rotation.y = -angle;
            bbMesh.castShadow = true;
            bbMesh.userData.xray = true;
            wallGroup.add(bbMesh);
          }
        }
    }

    // Doors
    for (const sourceDoor of floor.doors) {
      const wall = floor.walls.find((w) => w.id === sourceDoor.wallId);
      if (!wall) continue;
      const path = wallPathProfile(wall), length = path.length;
      const opening = pathOpening(path, path.distanceAt(sourceDoor.position), sourceDoor.width, 0, sourceDoor.height ?? 210);
      if (!opening || opening.top < 6 || opening.right - opening.left <= 2) continue;
      const left = path.sample(opening.left).point, right = path.sample(opening.right).point;
      const door = { ...sourceDoor, width: Math.hypot(right.x - left.x, right.y - left.y), position: (opening.left + opening.right) / 2 / length };
      if (door.width <= 2) continue;
      const t = door.position;
      const px = (left.x + right.x) / 2, py = (left.y + right.y) / 2;
      const angle = Math.atan2(right.y - left.y, right.x - left.x);
      const wt = Math.max(wall.thickness, WALL_THICKNESS);

      const glazed = isGlazedDoor(door.type);
      const frameMat = new THREE.MeshStandardMaterial(glazed
        ? { color: new THREE.Color(doorFrameColor(door)), roughness: 0.4, metalness: 0.25, ...depthOffset(DEPTH_ORDER.openingFrame) }
        : { color: new THREE.Color(doorFrameColor(door)), roughness: 0.6, ...depthOffset(DEPTH_ORDER.openingFrame) });
      // Wooden leaves follow a chosen frame colour; unset, they keep the natural wood.
      const leafColor = new THREE.Color(isDoorFrameColor(door.frameColor) ? door.frameColor : 0x8B6914);
      const doorHeight = opening.top;

      // Clip jambs and header too when an opening reaches the wall profile.
      for (const box of doorFrameBoxes(path, opening, wt)) {
        addOpeningFrame(wall, box.center / length, box.width, box.bottom, box.height, box.depth, frameMat);
      }

      if (door.type === 'opening') {
        // Plain doorway — jambs and header only, no door leaf
      } else if (door.type === 'garage') {
        // Sectional overhead door: stacked horizontal panels filling the opening
        const secMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7 });
        const sections = 4;
        const secH = (doorHeight - 6) / sections;
        for (let si = 0; si < sections; si++) {
          if (secH <= 2) continue;
          const secGeo = new THREE.BoxGeometry(door.width - 2, secH - 2, 5);
          const secMesh = new THREE.Mesh(secGeo, secMat);
          secMesh.position.set(px, secH / 2 + 2 + si * secH, py);
          secMesh.rotation.y = -angle;
          secMesh.castShadow = true;
          secMesh.userData.xray = true;
          wallGroup.add(secMesh);
        }
      } else if (door.type === 'pocket') {
        // Pocket door: a plain wooden slab shown half slid into a cavity in the wall on
        // the hinge side (where the plan symbol draws the dashed pocket). It slides no
        // further than the wall runs, and on a curved wall only while the straight slab
        // stays inside the wall faces; the rest of the door stays across the opening.
        const slabMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.5 });
        const pullMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.4, metalness: 0.6 });
        const group = new THREE.Group();
        group.position.set(px, 0, py);
        group.rotation.y = -angle;
        const pocketSide = door.swingDirection === 'left' ? 1 : -1; // matches the plan symbol's cavity
        const W = door.width, H = doorHeight, depth = 4;
        const along = { x: (right.x - left.x) / W, y: (right.y - left.y) / W };
        const hidden = pocketDoorTravel(W, pocketSide === 1 ? length - opening.right : opening.left,
          pocketSide === 1 ? right : left, { x: along.x * pocketSide, y: along.y * pocketSide },
          path.spans, wt / 2 - depth / 2);
        const center = pocketSide * hidden;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(W, H - 2, depth), slabMat);
        slab.position.set(center, (H - 2) / 2 + 1, 0);
        slab.castShadow = true;
        slab.userData.xray = true;
        group.add(slab);
        // Flush pulls on both faces near the leading edge
        const pullX = center - pocketSide * (W / 2 - 6);
        for (const face of [-1, 1]) {
          const pull = new THREE.Mesh(new THREE.BoxGeometry(3, 15, 0.6), pullMat);
          pull.position.set(pullX, Math.min(100, H * 0.5), face * (depth / 2 + 0.2));
          pull.userData.xray = true;
          group.add(pull);
        }
        wallGroup.add(group);
      } else if (glazed) {
        // Glazed doors: metal-framed glass leaves. Bifolds are below; otherwise closed, two leaves. Sliding leaves run on
        // offset tracks and overlap at the meeting stile; French leaves are hinged at
        // the jambs and meet flush in the wall plane.
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0xa8d8ea, transparent: true, opacity: 0.3,
          roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide
        });
        const hardwareMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.25, metalness: 0.8 });
        const group = new THREE.Group();
        group.position.set(px, 0, py);
        group.rotation.y = -angle;
        const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, glass = false, parent: THREE.Object3D = group) => {
          if (w <= 0 || h <= 0) return;
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          mesh.position.set(x, y, z);
          mesh.userData.xray = true;
          mesh.userData.renderExclude = glass;
          mesh.castShadow = !glass;
          parent.add(mesh);
        };
        const W = door.width, H = doorHeight;
        if (door.type === 'bifold') {
          // Bifold: four glazed panels hung from a head track, folded concertina-style
          // (30° zig-zag) and stacked toward the hinge-side jamb.
          const panels = 4, fold = Math.PI / 6;
          const pitch = W / panels, panelW = pitch - 1;
          const bottom = 1, top = H - 2, panelH = top - bottom;
          const stile = Math.min(5, panelW * 0.15), topRail = Math.min(7, panelH * 0.06), bottomRail = Math.min(10, panelH * 0.08), depth = 4;
          const hingeSide = door.swingDirection === 'left' ? 1 : -1; // matches doorPanelPose
          const face = door.flipSide ? -1 : 1;
          const x0 = hingeSide * W / 2, dir = -hingeSide;
          const c = pitch * Math.cos(fold), sz = pitch * Math.sin(fold) * face;
          const points = Array.from({ length: panels + 1 }, (_, i) => ({ x: x0 + dir * i * c, z: i % 2 ? sz : 0 }));
          addBox(W, 2, 6, 0, H - 1, 0, frameMat); // head track
          for (let i = 0; i < panels; i++) {
            const a = points[i], b = points[i + 1];
            const leaf = new THREE.Group();
            leaf.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
            leaf.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
            group.add(leaf);
            // Frame: two stiles, top and bottom rails, then the glass
            addBox(stile, panelH, depth, -panelW / 2 + stile / 2, bottom + panelH / 2, 0, frameMat, false, leaf);
            addBox(stile, panelH, depth, panelW / 2 - stile / 2, bottom + panelH / 2, 0, frameMat, false, leaf);
            addBox(panelW - stile * 2, bottomRail, depth, 0, bottom + bottomRail / 2, 0, frameMat, false, leaf);
            addBox(panelW - stile * 2, topRail, depth, 0, top - topRail / 2, 0, frameMat, false, leaf);
            const glassH = panelH - topRail - bottomRail;
            addBox(panelW - stile * 2, glassH, 1, 0, bottom + bottomRail + glassH / 2, 0, glassMat, true, leaf);
            if (i === panels - 1) {
              // Pull handles on both faces of the lead panel's free stile
              for (const side of [-1, 1]) addBox(1.5, 30, 2, panelW / 2 - stile / 2, Math.min(100, H * 0.5), side * (depth / 2 + 1.5), hardwareMat, false, leaf);
            }
          }
          // Hinge knuckles at the jamb and between panels
          for (let i = 0; i < panels; i++) {
            for (const y of [20, panelH / 2, panelH - 20]) addBox(1.5, 10, 1.5, points[i].x, bottom + y, points[i].z, hardwareMat);
          }
          wallGroup.add(group);
        } else {
          const sliding = door.type === 'sliding';
          const bottom = sliding ? 2 : 1; // sliding leaves sit on the floor track
          const top = sliding ? H - 2 : H - 1;
          const leafH = top - bottom;
          const overlap = sliding ? Math.min(6, W * 0.05) : -1; // French leaves leave a 1 cm gap
          const leafW = W / 2 + overlap / 2;
          const stile = Math.min(sliding ? 6 : 7, leafW * 0.15);
          const topRail = Math.min(sliding ? 8 : 9, leafH * 0.08);
          const bottomRail = Math.min(sliding ? 8 : 14, leafH * 0.1);
          const depth = sliding ? 4 : 5;
          const trackOffset = sliding ? Math.min(3, wt / 4) : 0;
          if (sliding) {
            // Bottom and head tracks spanning the opening
            addBox(W, 2, trackOffset * 2 + depth, 0, 1, 0, frameMat);
            addBox(W, 2, trackOffset * 2 + depth, 0, H - 1, 0, frameMat);
          }
          for (const side of [-1, 1]) {
            const cx = side * (W / 2 - leafW / 2);
            // The plan draws the end-side panel on the opening side's face.
            const z = side * trackOffset * (door.flipSide ? -1 : 1);
            // Frame: two stiles, top and bottom rails
            addBox(stile, leafH, depth, cx - leafW / 2 + stile / 2, bottom + leafH / 2, z, frameMat);
            addBox(stile, leafH, depth, cx + leafW / 2 - stile / 2, bottom + leafH / 2, z, frameMat);
            addBox(leafW - stile * 2, bottomRail, depth, cx, bottom + bottomRail / 2, z, frameMat);
            addBox(leafW - stile * 2, topRail, depth, cx, top - topRail / 2, z, frameMat);
            // Glass infill
            const glassH = leafH - topRail - bottomRail;
            addBox(leafW - stile * 2, glassH, 1, cx, bottom + bottomRail + glassH / 2, z, glassMat, true);
            const meetX = cx - side * (leafW / 2 - stile / 2);
            const handleY = Math.min(100, H * 0.5);
            if (sliding) {
              // Vertical pull handle on the meeting stile, on the leaf's outward face
              addBox(1.5, 30, 2, meetX, handleY, z + Math.sign(z) * (depth / 2 + 1.5), frameMat);
            } else {
              // Lever handles on both faces of the meeting stile
              for (const face of [-1, 1]) {
                const fz = face * (depth / 2 + 1);
                addBox(2, 6, 2, meetX, handleY, fz, hardwareMat);
                addBox(11, 1.5, 1.5, meetX + side * 5.5, handleY + 1.5, fz + face * 1.5, hardwareMat);
              }
              // Hinge knuckles on the jamb side
              const hingeX = cx + side * (leafW / 2);
              // Knuckles show on the face the leaves swing toward, as the plan arcs do
              const hingeZ = doorOpeningSide(door) * (depth / 2 + 0.5);
              for (const y of [20, leafH / 2, leafH - 20]) addBox(1.5, 10, 1.5, hingeX, bottom + y, hingeZ, hardwareMat);
            }
          }
          wallGroup.add(group);
        }
      } else {
        // Wooden door leaves, slightly ajar (15°), opening toward the face the plan symbol
        // draws. A single door has one leaf on the saved hinge; a double door has two
        // half-width leaves hinged at opposite jambs that part in the middle.
        const panelMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.5 });
        const recessMat = new THREE.MeshStandardMaterial({ color: leafColor.clone().multiplyScalar(0.88), roughness: 0.55 });
        const leafGlassMat = new THREE.MeshStandardMaterial({
          color: 0xa8d8ea, transparent: true, opacity: 0.3,
          roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide
        });
        const leafStyle = door.leafStyle ?? 'slab';
        const handleMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.2 });
        const gap = door.type === 'double' ? 1 : 2;
        for (const { width: leafW, pose } of swingLeaves(left, right, door)) {
          if (leafW <= gap + 2) continue;
          const handleY = Math.min(100, doorHeight * 0.5);
          const panelMesh = buildDoorLeaf(leafW - gap, doorHeight - 4, leafStyle, panelMat, recessMat, leafGlassMat, handleY - (doorHeight / 2 - 2));
          panelMesh.position.set(pose.x, doorHeight / 2 - 2, pose.z);
          panelMesh.rotation.y = -pose.yaw;
          wallGroup.add(panelMesh);

          // Door handle (small sphere) near the leaf's free edge
          const handleMesh = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 8), handleMat);
          const handleLocalX = leafW - 12;
          handleMesh.position.set(
            panelMesh.position.x + handleLocalX * Math.cos(pose.yaw),
            handleY,
            panelMesh.position.z + handleLocalX * Math.sin(pose.yaw)
          );
          handleMesh.userData.xray = true;
          wallGroup.add(handleMesh);
        }
      }
    }

    // Windows
    for (const sourceWindow of floor.windows) {
      const wall = floor.walls.find((w) => w.id === sourceWindow.wallId);
      if (!wall) continue;
      const path = wallPathProfile(wall), length = path.length;
      const opening = pathOpening(path, path.distanceAt(sourceWindow.position), sourceWindow.width, sourceWindow.sillHeight ?? 90, sourceWindow.height);
      if (!opening || opening.top - opening.bottom <= 4 || opening.right - opening.left <= 4) continue;
      const win = { ...sourceWindow, width: opening.right - opening.left, position: (opening.left + opening.right) / 2 / length, sillHeight: opening.bottom };
      const t = win.position;
      const wt = Math.max(wall.thickness, WALL_THICKNESS);
      const effectiveWinH = opening.top - opening.bottom;
      const winCY = win.sillHeight + effectiveWinH / 2;

      const frameMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.4, metalness: 0.1, ...depthOffset(DEPTH_ORDER.openingFrame) });
      const mullionW = 4; // mullion bar width

      // Outer frame — up to 4 bars forming a rectangle, less any the wall profile clips away
      for (const box of windowOuterBars(path, opening, mullionW)) {
        addOpeningFrame(wall, box.center / length, box.width, box.bottom, box.height, mullionW, frameMat);
      }
      // Center vertical and horizontal mullions
      addOpeningFrame(wall, t, mullionW, win.sillHeight, effectiveWinH, mullionW, frameMat);
      addOpeningFrame(wall, t, win.width, winCY - mullionW / 2, mullionW, mullionW, frameMat);

      // Glass panes (4 quadrants)
      const glassMat = new THREE.MeshStandardMaterial({
        color: 0xa8d8ea, transparent: true, depthWrite: false, opacity: 0.3,
        roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide
      });
      const halfW = (win.width - mullionW) / 2;
      const halfH = (effectiveWinH - mullionW) / 2;
      for (const qx of [-1, 1]) {
        for (const qy of [-1, 1]) {
          const ox = qx * (halfW / 2 + mullionW / 2);
          const centerY = winCY + qy * (halfH / 2 + mullionW / 2);
          addOpeningFrame(wall, t + ox / length, halfW, centerY - halfH / 2, halfH, 1, glassMat, true);
        }
      }

      // Sill — protruding ledge
      addOpeningFrame(wall, t, win.width + 16, win.sillHeight - 4, 4, wt + 10, frameMat);
    }

    // Furniture
    const furnitureOffsets = furnitureDepthOffsets(floor.furniture);
    for (const [i, fi] of floor.furniture.entries()) {
      const model = createPlacedFurnitureModel(fi, markSceneDirty, get(currentProject) ?? undefined, furnitureOffsets[i]);
      if (model) wallGroup.add(model);
    }

    // Room floors with materials + floating labels
    const FALLBACK_ROOM_COLORS = [0xbfdbfe, 0xfde68a, 0xbbf7d0, 0xfecaca, 0xddd6fe, 0xa5f3fc, 0xfed7aa];
    // Resolve labels and materials from this floor, including after a 3D floor switch.
    const rooms = resolveRoomGeometry(floor);
    const holes = roomHoles(rooms.map(r => r.polygon));
    for (let ri = 0; ri < rooms.length; ri++) {
      const { room, polygon: poly } = rooms[ri];
      if (poly.length < 3) continue;

      const slabGeometry = room.floorOpening ? null : createRoomSlabGeometry(poly, floor.slabThickness, holes[ri]);
      if (slabGeometry) {
        const slab = new THREE.Mesh(slabGeometry, new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9, ...depthOffset(DEPTH_ORDER.slab) }));
        slab.userData.renderMaterial = 'floor';
        slab.receiveShadow = true;
        wallGroup.add(slab);
      }

      // Triangulate the polygon using ear-clipping via THREE.ShapeGeometry
      const shape = new THREE.Shape();
      // Negate Y so that after -PI/2 X rotation, 2D Y maps to +Z (matching wall coords)
      shape.moveTo(poly[0].x, -poly[0].y);
      for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i].x, -poly[i].y);
      shape.closePath();

      for (const hole of holes[ri]) {
        const path = new THREE.Path();
        path.moveTo(hole[0].x,-hole[0].y);
        for (const p of hole.slice(1)) path.lineTo(p.x,-p.y);
        path.closePath();
        shape.holes.push(path);
      }

      const geo = new THREE.ShapeGeometry(shape);

      // Compute room bounds for UV normalization (using negated Y to match shape coords)
      const bounds = poly.reduce((b, p) => ({
        minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x),
        minY: Math.min(b.minY, -p.y), maxY: Math.max(b.maxY, -p.y),
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      const roomW = bounds.maxX - bounds.minX;
      const roomH = bounds.maxY - bounds.minY;

      // Normalize ShapeGeometry UVs from world coords to [0,1] range
      const uvAttr = geo.attributes.uv;
      for (let i = 0; i < uvAttr.count; i++) {
        const u = (uvAttr.getX(i) - bounds.minX) / (roomW || 1);
        const v = (uvAttr.getY(i) - bounds.minY) / (roomH || 1);
        uvAttr.setXY(i, u, v);
      }
      uvAttr.needsUpdate = true;

      // Use room's floor material or fallback to color coding
      let material: THREE.MeshStandardMaterial;
      if (room.floorTexture === 'none') {
        // Solid-color floor: no texture; use the room's picked color
        material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(room.color ?? getMaterial('none').color),
          roughness: 0.9,
          transparent: false,
          opacity: 1.0
        });
      } else if (room.floorTexture) {
        const floorMat = getMaterial(room.floorTexture);
        const floorCanvas = getFloorTextureCanvas(room.floorTexture);
        if (floorCanvas) {
          const tex = ownColorCanvasTexture(floorCanvas);
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          // Tile every 200cm — now UVs are 0-1, so repeat = room size / tile size
          const tileSizeCm = 200;
          tex.repeat.set(roomW / tileSizeCm, roomH / tileSizeCm);
          material = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: floorMat.roughness ?? 0.8,
            transparent: false,
            opacity: 1.0
          });
        } else {
          material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(floorMat.color),
            roughness: floorMat.roughness ?? 0.8,
            transparent: false,
            opacity: 1.0
          });
        }
      } else {
        // Fallback to old color system for rooms without specific materials
        const color = FALLBACK_ROOM_COLORS[ri % FALLBACK_ROOM_COLORS.length];
        material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.9,
          transparent: true,
          opacity: 0.5
        });
      }

      Object.assign(material, depthOffset(DEPTH_ORDER.roomFloor));
      const mesh = new THREE.Mesh(geo, material);
      // Rotate to lie on XZ plane, slightly above base floor
      mesh.userData.renderMaterial = 'floor';
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 1;
      mesh.receiveShadow = true;
      if (room.floorOpening) { geo.dispose(); material.dispose(); }
      else wallGroup.add(mesh);

      // Floating room label using sprite
      const centroid = roomLabelPosition(room, poly, holes[ri]);
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx2 = canvas.getContext('2d')!;
      ctx2.fillStyle = 'rgba(0,0,0,0.6)';
      ctx2.roundRect(0, 0, 256, 64, 8);
      ctx2.fill();
      ctx2.fillStyle = '#ffffff';
      ctx2.font = 'bold 22px sans-serif';
      ctx2.textAlign = 'center';
      ctx2.fillText(room.name, 128, 26);
      ctx2.font = '16px sans-serif';
      ctx2.fillStyle = '#d1d5db';
      ctx2.fillText(formatArea(room.area, get(projectSettings).units), 128, 50);

      const tex = ownColorCanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(centroid.x, 30, centroid.y);
      sprite.scale.set(150, 40, 1);
      wallGroup.add(sprite);

      // A flat ceiling is valid only when this room's boundary has one height.
      const ceilingHeight = roomCeilingHeight(room.walls, floor.walls);
      if (ceilingHeight !== undefined) {
        const ceilMat = new THREE.MeshStandardMaterial({
          color: 0xf5f5f0,
          roughness: 0.95,
          side: THREE.BackSide // visible from below
        });
        const ceilGeo = new THREE.ShapeGeometry(shape);
        const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
        ceilMesh.userData.renderExclude = true;
        ceilMesh.userData.xray = true;
        ceilMesh.rotation.x = -Math.PI / 2;
        ceilMesh.position.y = ceilingHeight;
        ceilMesh.receiveShadow = true;
        wallGroup.add(ceilMesh);
      }
    }

    // Stairs
    buildStairs(floor);

    // Columns
    buildColumns(floor);

    applyWallTransparency();
  }

  /** Cuts the openings out of the ground and the site floor, or restores them whole. */
  function cutGround(openings: Point[][]) {
    for (const [mesh, plain, size] of [[sceneGround, plainGround, GROUND_SIZE], [siteFloor, plainSiteFloor, SITE_FLOOR_SIZE]] as const) {
      const previous = mesh.geometry;
      if (previous === plain && !openings.length) continue;
      mesh.geometry = openings.length ? groundWithOpenings(size, openings) : plain;
      if (previous !== plain) previous.dispose();
    }
  }

  /** On the active floor alone, an "Open to floor below" room looks down a well to the floor below, where the
   *  stairs that climb into it stand (with the active floor's own Down stairs). The ground is cut away there. */
  function buildStairwell(view: ReturnType<typeof stairwellView>) {
    cutGround(view?.openings ?? []);
    if (!view) return;
    const below = -view.depth;
    for (const opening of view.openings) {
      const shape = new THREE.Shape(opening.map(p => new THREE.Vector2(p.x, -p.y)));
      const bottom = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.9 }));
      bottom.userData.renderMaterial = 'floor';
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.y = below;
      bottom.receiveShadow = true;
      wallGroup.add(bottom);
      // The well's sides, from the floor below up to the ground, seen from inside or out.
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xe7e3dc, roughness: 0.95, side: THREE.DoubleSide });
      opening.forEach((a, i) => {
        const b = opening[(i + 1) % opening.length], length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 1) return;
        const side = new THREE.Mesh(new THREE.PlaneGeometry(length, view.depth - 1), sideMat);
        side.position.set((a.x + b.x) / 2, below + (view.depth - 1) / 2, (a.y + b.y) / 2);
        side.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
        side.receiveShadow = true;
        wallGroup.add(side);
      });
    }
    if (view.stairs.length) buildStairs({ ...view.below, stairs: view.stairs }, wallGroup, below);
  }

  /** Build all floors stacked vertically in 3D */
  function buildAllFloorsStacked() {
    const project = get(currentProject);
    if (!project || project.floors.length === 0) return;

    // Use buildWalls for the active floor first (it clears wallGroup)
    const activeF = project.floors.find(f => f.id === project.activeFloorId) ?? project.floors[0];
    buildWalls(activeF);

    const entries = assembleFloorStack(wallGroup, project.floors, activeF.id, (floor, group, offset) => {
      buildFloorIntoGroup(floor, group, offset, otherFloorsStyle);
      // Picking and placement treat solid floors as covering what lies behind them.
      group.traverse(object => { object.userData.stackedFloor = true; });
    });
    const box = new THREE.Box3().setFromObject(wallGroup);
    const center = box.getCenter(new THREE.Vector3());
    const labelX = box.isEmpty() ? -200 : box.min.x - 200;
    for (const { floor, yOffset } of entries) {
      addFloorLabel(floor.name, yOffset, labelX, center.z);
    }
    activeFloorElevation = entries.find(entry => entry.floor.id === activeF.id)?.yOffset ?? 0;
    floorPlane.constant = -activeFloorElevation;
    // Keep the presentation ground below basements as well as above-ground floors.
    sceneGround.position.y = Math.min(0, ...entries.map(entry => entry.yOffset)) - 1;
  }

  function addFloorLabel(name: string, yOffset: number, labelX: number, labelZ: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.roundRect(0, 0, 256, 48, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, 128, 32);

    const tex = ownColorCanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(spriteMat);

    sprite.position.set(labelX, yOffset + 130, labelZ);
    sprite.scale.set(200, 40, 1);
    wallGroup.add(sprite);
  }

  /** Build another floor's walls, slabs and columns into a group at a Y offset, translucent or solid. */
  function buildFloorIntoGroup(floor: Floor, group: THREE.Group, yOffset: number, style: StackedFloorsStyle) {
    const look = stackedFloorMaterial(style);
    const stackedMat = (color: number, roughness = 0.9) => new THREE.MeshStandardMaterial({
      color, roughness, ...look, ...depthOffset(DEPTH_ORDER.interiorWall)
    });

    const defaultInteriorMat = stackedMat(0xffffff);
    const defaultExteriorMat = stackedMat(0xd4cfc9, 0.85);

    for (const sourceWall of floor.walls) {
      for (const span of wallProfileSpans(sourceWall, floor.doors.filter(d => d.wallId === sourceWall.id), floor.windows.filter(w => w.wallId === sourceWall.id))) {
        const wall = { ...sourceWall, ...span };
        const dx = wall.end.x - wall.start.x;
        const dy = wall.end.y - wall.start.y;
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;

        const startH = getWallStartHeight(wall);
        const endH = getWallEndHeight(wall);
        const t = Math.max(wall.thickness, WALL_THICKNESS);
        const angle = Math.atan2(dy, dx);
        const cx = (wall.start.x + wall.end.x) / 2;
        const cy = (wall.start.y + wall.end.y) / 2;

        const segments = span.segments;

        const materials = [
          defaultExteriorMat, defaultExteriorMat,
          defaultInteriorMat, defaultInteriorMat,
          defaultInteriorMat, defaultExteriorMat,
        ];

        for (const seg of segments) {
          const geo = createSlopedBoxGeometry(seg.width, t, seg.bottomY, seg.topYLeft, seg.topYRight);
          const mesh = new THREE.Mesh(geo, materials);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const localX = seg.offsetX - len / 2;
          mesh.position.set(
            cx + localX * Math.cos(angle),
            yOffset,
            cy + localX * Math.sin(angle)
          );
          mesh.rotation.y = -angle;
          mesh.userData.renderMaterial = 'wall';
          group.add(mesh);
        }
    }

    }
    // Match active-floor footprints instead of bridging recesses and separate rooms.
    const rooms = resolveRoomGeometry(floor);
    const holes = roomHoles(rooms.map(r => r.polygon));
    for (const [index, { room, polygon }] of rooms.entries()) {
      if (room.floorOpening) continue;
      const geometry = createRoomSlabGeometry(polygon, floor.slabThickness, holes[index]);
      if (!geometry) continue;
      const slab = new THREE.Mesh(geometry, stackedMat(0xcccccc, 0.95));
      slab.userData.renderMaterial = 'floor';
      slab.position.y = yOffset;
      slab.receiveShadow = true;
      group.add(slab);
    }

    // Stairs, drawn like the rest of a reference floor (translucent or solid)
    buildStairs(floor, group, yOffset, look.opacity);

    // Columns
    if (floor.columns) {
      for (const col of floor.columns) {
        const h = col.height || 280;
        const mat = new THREE.MeshStandardMaterial({ color: col.color || '#cccccc', roughness: 0.7, ...look, ...depthOffset(DEPTH_ORDER.column) });
        const mesh = new THREE.Mesh(columnGeometry(col), mat);
        mesh.position.set(col.position.x, h / 2 + yOffset, col.position.y);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
  }

  function rebuildScene(force = false) {
    const project = get(currentProject);
    if (!project || !currentFloor) return;
    const signature = sceneSignature(project, currentFloor, showAllFloors, get(projectSettings).units, otherFloorsStyle);
    if (!force && signature === renderedSignature) return;
    const walkingPosition = walkthroughMode ? camera.position.clone() : null;
    const walkingRotation = walkthroughMode ? camera.quaternion.clone() : null;
    if (showAllFloors) {
      cutGround([]);
      buildAllFloorsStacked();
    } else if (currentFloor) {
      activeFloorElevation = 0;
      floorPlane.constant = 0;
      sceneGround.position.y = -1;
      buildWalls(currentFloor);
      buildStairwell(stairwellView(project.floors, currentFloor.id));
    }
    wallGroup.visible = !currentScan || buildingVisible;
    // Fit the orbit camera only for a new project, floor or stacking choice, so edits, Undo/Redo,
    // unit changes and arriving textures keep the user's view. Walkthrough restores its pose below.
    const context = framingContext(project, currentFloor, showAllFloors);
    if (shouldFrameScene(framedContext, context)) autoCenterCamera();
    framedContext = context;
    wallHighlight.apply(wallMeshMap, selectedWallId3D);
    if (walkingPosition && walkingRotation) {
      camera.position.copy(walkingPosition);
      camera.position.y = activeFloorElevation + eyeHeight;
      camera.quaternion.copy(walkingRotation);
    }
    if (cameraPlaced) {
      updateInteriorCamera();
      updateCameraMarkerFromState();
      cameraPreviewDirty = true;
    }
    markSceneDirty();
    renderedSignature = signature;
  }

  function applyWallTransparency() {
    // Only active-floor wall bodies belong to this control; furniture finishes,
    // glass openings and reference-floor opacity keep their own settings.
    for (const child of wallMeshMap.keys()) if (child instanceof THREE.Mesh) {
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        material.transparent = wallsTransparent;
        material.opacity = wallsTransparent ? 0.15 : 1;
        material.depthWrite = !wallsTransparent;
        material.needsUpdate = true;
      }
    }
  }

  function toggleWallTransparency() {
    wallsTransparent = !wallsTransparent;
    wallHighlight.clear();
    applyWallTransparency();
    wallHighlight.apply(wallMeshMap, selectedWallId3D);
    markSceneDirty();
  }

  function viewTopDown() {
    if (walkthroughMode) exitWalkthroughMode();
    orbitGlide = null;
    scanViewGlide = null;
    // Consume pending orbit/pan deltas before setting the requested view. This
    // public update path clears damping without reaching into control internals.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
    const fromPosition = camera.position.clone();
    const fromTarget = controls.target.clone();
    frameScene(camera, new THREE.Box3().setFromObject(wallGroup), controls.target,
      { view: 'top-down', verticalInset: Math.min(64 / container.clientHeight, 0.2) });
    if (currentScan && studioAppearance) {
      const toPosition = camera.position.clone();
      const toTarget = controls.target.clone();
      camera.position.copy(fromPosition); controls.target.copy(fromTarget); controls.update();
      glideToScanView(toPosition, toTarget);
    } else controls.update();
    markSceneDirty();
  }

  function toggleWalkthroughMode() {
    if (walkthroughMode) {
      exitWalkthroughMode();
    } else {
      enterWalkthroughMode();
    }
  }

  function enterWalkthroughMode() {
    orbitGlide = null;
    cancelAIRender();
    cameraPlacementMode = false;
    cameraPreviewOpen = false;
    furniturePlacementMode = false;
    removeGhostPreview();
    walkthroughMode = true;
    walkthroughMotion.reset();
    walkthroughMouseUnavailable = false;
    controls.enabled = false;

    // Position camera at eye height in center of floor plan or largest room
    if (currentFloor) {
      const rooms = detectRooms(currentFloor.walls);
      let startPos = { x: 0, y: eyeHeight, z: 0 };

      if (rooms.length > 0) {
        // Find largest room and position camera at its center
        let largestRoom = rooms[0];
        let largestArea = 0;

        for (const room of rooms) {
          if (room.area > largestArea) {
            largestArea = room.area;
            largestRoom = room;
          }
        }

        const poly = getRoomPolygon(largestRoom, currentFloor.walls);
        if (poly.length > 0) {
          const centroid = roomCentroid(poly);
          startPos = { x: centroid.x, y: eyeHeight, z: centroid.y };
        }
      } else if (currentFloor.walls.length > 0) {
        // No rooms, use center of floor plan
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const w of currentFloor.walls) {
          for (const p of [w.start, w.end]) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y);
          }
        }
        startPos = { x: (minX + maxX) / 2, y: eyeHeight, z: (minZ + maxZ) / 2 };
      }

      setFloorCameraPose(camera, activeFloorElevation, startPos,
        { ...startPos, z: startPos.z - 100 });
    }

    // Three's lock() discards the browser's promise. Handle rejection here so
    // embedded/unsupported browsers can still use keyboard movement and look.
    try {
      Promise.resolve(renderer.domElement.requestPointerLock()).catch(() => {
        if (walkthroughMode) walkthroughMouseUnavailable = true;
      });
    } catch {
      walkthroughMouseUnavailable = true;
    }
    markSceneDirty();
  }



  let lastOrbitFrame: number | undefined;
  /** Double-click glide: camera and target move by `offset` over ORBIT_GLIDE_MS. */
  const ORBIT_GLIDE_MS = 350;
  let orbitGlide: { position: THREE.Vector3; target: THREE.Vector3; offset: THREE.Vector3; start: number } | null = null;
  function animate(timestamp: number) {
    animId = undefined;

    if (walkthroughMode) {
      lastOrbitFrame = undefined;
      const moving = walkthroughMotion.active;
      walkthroughMotion.advance(timestamp, camera, { moveSpeed, sprintSpeed, eyeHeight, floorElevation: activeFloorElevation });
      if (sceneDirty || moving) {
        sceneDirty = false;
        renderer.render(scene, camera);
        renderer.domElement.dataset.rendered = 'true';
        updateVoxelAnnotation();
      }
      if (walkthroughMotion.active) requestRender();
      else walkthroughMotion.stopClock();
    } else {
      if (scanViewGlide) {
        const glide = scanViewGlide;
        const dt = Math.min(.05, Math.max(0, (timestamp - glide.last) / 1000));
        glide.last = timestamp;
        // Cathode's frame-rate-independent easing, applied only to deliberate view changes.
        const k = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1 - Math.pow(.00015, dt);
        camera.position.lerp(glide.position, k);
        controls.target.lerp(glide.target, k);
        controls.update();
        sceneDirty = true;
        if (camera.position.distanceToSquared(glide.position) < .25 && controls.target.distanceToSquared(glide.target) < .25 || timestamp - glide.started > 750) {
          camera.position.copy(glide.position); controls.target.copy(glide.target); controls.update();
          scanViewGlide = null;
        } else requestRender();
      }
      if (orbitGlide) {
        const t = THREE.MathUtils.smoothstep(timestamp - orbitGlide.start, 0, ORBIT_GLIDE_MS);
        camera.position.copy(orbitGlide.position).addScaledVector(orbitGlide.offset, t);
        controls.target.copy(orbitGlide.target).addScaledVector(orbitGlide.offset, t);
        sceneDirty = true;
        if (t < 1) requestRender(); else orbitGlide = null;
      }
      // A change event schedules the next damping step. Once the controls settle,
      // leave no callback queued until an interaction or scene update wakes us.
      updateOrbitDamping(controls, lastOrbitFrame === undefined ? 1 / 60 : (timestamp - lastOrbitFrame) / 1000);
      lastOrbitFrame = animId === undefined ? undefined : timestamp;
      if (sceneDirty) {
        sceneDirty = false;
        renderer.render(scene, camera);
        renderer.domElement.dataset.rendered = 'true';
        updateVoxelAnnotation();
      }
    }
  }

  function onResize() {
    if (!container || !renderer) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    markSceneDirty();
  }

  function takeScreenshot() {
    if (!renderer || !scene || !camera) return;
    renderer.render(scene, camera);
    renderer.domElement.dataset.rendered = 'true';
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'floorplan-3d.png';
    link.href = dataUrl;
    link.click();
  }

  function exportBlenderScene() {
    try {
      if (!wallGroup) throw new Error('The 3D scene is not ready.');
      const json = portableRenderSceneJSON(wallGroup, showAllFloors ? 'stacked-floors' : 'active-floor');
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      try {
        const link = document.createElement('a');
        link.href = url; link.download = 'openplan3d-render-scene.json'; link.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      renderExportMessage = 'Exported neutral geometry for the local Blender worker. Textures and photo cameras are omitted.';
    } catch (error) {
      renderExportMessage = error instanceof Error ? error.message : 'Could not export the render scene.';
    }
  }

  onMount(() => {
    const scanParam = new URLSearchParams(window.location.search).get('scan');
    currentScan = scanParam === 'office-1' || scanParam === 'office-2' || scanParam === 'office-2-rescan' ? scanParam : null;
    const stopAISettings = openAISettings.subscribe(config => {
      cancelAIRender();
      openaiModel = getEffectiveModel(config);
    });
    // Without WebGL nothing below may start: every listener, observer and frame reaches the renderer.
    if (!init()) { stopAISettings(); return; }
    viewerMounted = true;
    markSceneDirty();
    // The one-time tip offers orbit and walkthrough, so only a view with a renderer uses it up.
    if (!currentScan) triggerTip('first-3d', 200, 80);

    // Rebuild 3D scene when photo textures finish loading
    const stopTextures = setTextureLoadCallback(() => {
      // New image pixels are not represented in the project's value snapshot.
      if (currentFloor) rebuildScene(true);
    });

    const resizeObs = new ResizeObserver(onResize);
    resizeObs.observe(container);

    const unsub = activeFloor.subscribe((f) => {
      if (currentFloor?.id !== f?.id) {
        closeCamera();
        if (walkthroughMode) exitWalkthroughMode();
      }
      currentFloor = f;
      if (f) rebuildScene();
    });
    if (currentScan) loadVoxelLayer(true);
    const stopScanProject = currentProject.subscribe(project => {
      if (!currentScan || !project || project.id === `experiment15-${currentScan}-registered-v1`) return;
      loadSerial++; disposeScanLayers();
      removeStudioGrid();
      if (editedGroup) { scene.remove(editedGroup); clearGroup(editedGroup); editedGroup = undefined; }
      currentScan = null; scanIdentity = undefined; scanRoom = undefined; editedObjects = []; placementMode = false;
      selectedVoxelScreen = null;
      updateStudioAppearance();
      if (wallGroup) wallGroup.visible = true;
      if (sceneGround) sceneGround.visible = true;
      if (siteFloor) siteFloor.visible = true;
      markSceneDirty();
    });
    const refreshVoxels = () => loadVoxelLayer();
    window.addEventListener('angrid-voxel-updated', refreshVoxels);
    window.addEventListener('storage', refreshVoxels);
    // Room area labels are textures and must refresh when display units change.
    const stopSettings = projectSettings.subscribe(() => {
      if (currentFloor) rebuildScene();
    });

    const unsubSel = selectedElementId.subscribe((id) => {
      selectedWallId3D = id;
      wallHighlight.apply(wallMeshMap, id);
      markSceneDirty();
    });
    let sidebarFurnitureActive = false;
    const stopSidebarFurniture = placingFurnitureId.subscribe((id) => {
      if (!id) {
        if (sidebarFurnitureActive) { sidebarFurnitureActive = false; furniturePlacementMode = false; selectedCatalogId = null; removeGhostPreview(); markSceneDirty(); }
        return;
      }
      if (!getCatalogItem(id)) return;
      sidebarFurnitureActive = true;
      if (walkthroughMode) exitWalkthroughMode();
      editMode = true; placementMode = false; cameraPlacementMode = false;
      furniturePlacementMode = true; furniturePickerOpen = false; selectedCatalogId = id;
      if (currentScan) { buildingVisible = true; if (wallGroup) wallGroup.visible = true; }
      removeGhostPreview(); markSceneDirty();
    });

    return () => {
      viewerMounted = false;
      loadSerial++;
      disposeScanLayers();
      removeStudioGrid();
      stopScanProject();
      window.removeEventListener('angrid-voxel-updated', refreshVoxels);
      window.removeEventListener('storage', refreshVoxels);
      cancelAIRender();
      stopAISettings();
      stopTextures();
      resizeObs.disconnect();
      unsub();
      stopSettings();
      unsubSel();
      stopSidebarFurniture();
      if (animId !== undefined) cancelAnimationFrame(animId);
      animId = undefined;
      document.removeEventListener('keydown', onKeyDown, false);
      document.removeEventListener('keyup', onKeyUp, false);
      window.removeEventListener('blur', resetWalkthroughInput);
      document.removeEventListener('visibilitychange', resetWalkthroughInput);
      document.removeEventListener('focusin', onWalkthroughFocus);
      walkthroughMotion.reset();
      releaseCameraPreview();
      wallHighlight.clear();
      removeGhostPreview();
      skyTexture.dispose();
      studioBackground?.dispose();
      sunLight.shadow.dispose();
      clearGroup(scene);
      wallMeshMap.clear();
      pointerControls.removeEventListener('change', markSceneDirty);
      pointerControls.dispose();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', markSceneDirty);
      releaseRenderer(renderer);
    };
  });
</script>

<div bind:this={container} class="w-full h-full relative {currentScan && studioAppearance ? 'studio-stage' : ''} {scanStageReady && studioAppearance ? 'scan-ready' : ''}" role="region" aria-label={$t('viewerNav.region')}>
  {#if currentScan && studioAppearance}<div class="studio-grain" aria-hidden="true"></div>{/if}
  {#if currentScan && studioAppearance && scanMotionRevision > 0}
    {#key scanMotionRevision}<div class="scan-reveal" aria-hidden="true"></div>{/key}
  {/if}
  {#if webglUnavailable}
    <div class="flex h-full items-center justify-center p-6">
      <p role="alert" class="max-w-md rounded-lg bg-black/80 px-4 py-3 text-center text-sm text-white">{$t('viewerNav.webglUnavailable')}</p>
    </div>
  {:else}<!-- Every control below needs the renderer. -->
  <div class="absolute bottom-16 left-4 z-10 max-w-xs">
    {#if renderExportMessage}<p role="status" class="mb-2 rounded bg-black/80 p-2 text-xs text-white">{renderExportLabels[renderExportMessage] ? $t(renderExportLabels[renderExportMessage]) : renderExportMessage}</p>{/if}
    <button class="rounded bg-black/70 px-3 py-2 text-sm text-white hover:bg-black/80" onclick={exportBlenderScene}
      title={$t('viewerExport.help')}>{$t('viewerExport.button')}</button>
  </div>
  {#if showAllFloors && currentFloor}
    <div class="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-1.5 pointer-events-none">
      <!-- The visible caption gives way on phones so the control clears Export Blender Scene. -->
      <div role="group" aria-label={$t('viewerNav.otherFloors')} class="pointer-events-auto flex items-center gap-1 rounded bg-black/70 p-1 text-xs text-white">
        <span class="hidden px-1.5 sm:inline" aria-hidden="true">{$t('viewerNav.otherFloors')}</span>
        {#each OTHER_FLOOR_STYLES as option (option.style)}
          <button type="button" aria-pressed={otherFloorsStyle === option.style} onclick={() => setOtherFloorsStyle(option.style)}
            class="rounded px-2 py-1 transition-colors {otherFloorsStyle === option.style ? 'bg-purple-600 text-white' : 'hover:bg-white/15'}"
          >{$t(option.label)}</button>
        {/each}
      </div>
      <div class="rounded bg-black/70 px-3 py-2 text-xs text-white">
        {$t('viewerExport.elevation', { name: currentFloor.name, value: activeFloorElevation })}
      </div>
    </div>
  {/if}
  {#if currentScan}
  <div data-testid="studio-layer-key" class="pointer-events-none absolute right-4 z-30 hidden sm:block {showAllFloors ? 'bottom-24' : 'bottom-4'}">
    <StudioLayerKey entries={studioEntries} heatmap={userColorMode === 'height' && userVisible && editedObjects.length ? { label: '设计格中心离地高度', low: heightHeatMinM.toFixed(2) + ' m', high: heightHeatMaxM.toFixed(2) + ' m', explanation: '只表示用户实体格的中心高度；不代表扫描置信度或净空。', colors: heightHeatColors } : null} />
  </div>
  <div data-testid="scan-scene-readout" class="scan-scene-readout pointer-events-none absolute right-4 top-[7rem] z-30 hidden lg:block" aria-label="当前扫描与体素场景信息">
    <div class="scan-readout-head"><span class="scan-readout-cross" aria-hidden="true">＋</span><span>{currentScan} / 房间坐标</span></div>
    <div class="scan-readout-values"><div><span>查看风格</span><strong>{studioAppearance ? 'Studio 工作台' : '原版光照'}</strong></div><div><span>显示/参照格长</span><strong>{Number(scanStep) * 100} cm</strong></div></div>
    <p>{layerRows.filter(row => row.visible && row.available).length} 个证据图层 · {layerRows.filter(row => row.visible && gridLayer(row.id)).reduce((sum, row) => sum + row.drawn, 0).toLocaleString()} 个显示格 · {editedObjects.length} 个设计盒</p>
    <p class="scan-readout-note">参照线非扫描证据，格距与显示设置同步。</p>
  </div>
  {#if studioAppearance && selectedVoxelScreen}
    <div data-testid="selected-voxel-annotation" class="selected-voxel-annotation pointer-events-none absolute z-30" style:left={selectedVoxelScreen.x + 'px'} style:top={selectedVoxelScreen.y + 'px'} aria-label={'选中体素盒 ' + selectedVoxelScreen.name}>
      <span class="annotation-index" aria-hidden="true">＋</span><strong>{selectedVoxelScreen.name}</strong><small>{selectedVoxelScreen.cells} 格 · 顶部 {selectedVoxelScreen.height.toFixed(2)} m</small>
    </div>
  {/if}
  <aside data-testid="scan-panel" aria-label="扫描图层与体素设计" class="scan-drawer absolute top-16 left-4 z-40 text-xs" class:collapsed={!panelOpen}>
    <div class="scan-panel-head flex items-center justify-between gap-2">
      <div class="scan-panel-title"><span class="scan-panel-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>扫描与体素</strong>{#if panelOpen}<small>{currentScan} · 空间编辑</small>{/if}</div>
      <button data-testid="scan-panel-toggle" type="button" aria-expanded={panelOpen} aria-label={panelOpen ? '收起扫描面板' : '展开扫描面板'} class="scan-panel-toggle" onclick={() => panelOpen = !panelOpen}>{panelOpen ? '收起面板 ↖' : '展开编辑 ↗'}</button>
    </div>
    {#if panelOpen}
    <div class="scan-drawer-content">
    <div data-testid="scan-voxel-status" role="status" class="scan-status mt-3">{voxelStatus}</div>
    <div class="scan-stage-switch" role="group" aria-label="三维场景风格"><button type="button" aria-pressed={studioAppearance} onclick={() => { studioAppearance = true; updateStudioAppearance(); scanMotionRevision++; }}>Studio 工作台</button><button type="button" aria-pressed={!studioAppearance} onclick={() => { studioAppearance = false; updateStudioAppearance(); }}>原版光照</button></div>
    <div class="my-2 flex gap-1">
      <a href={base + '/editor?scan=office-1'} data-sveltekit-reload aria-current={currentScan === 'office-1' ? 'page' : undefined} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">第一次扫描</a>
      <a href={base + '/editor?scan=office-2'} data-sveltekit-reload aria-current={currentScan === 'office-2' ? 'page' : undefined} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">第二次扫描</a>
      <a href={base + '/editor?scan=office-2-rescan'} data-sveltekit-reload aria-current={currentScan === 'office-2-rescan' ? 'page' : undefined} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">复扫 Office 2</a>
      <button class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20" onclick={() => frameVoxelLayer()}>定位房间</button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <label class="grid gap-1">查看预设<select aria-label="查看预设" bind:value={preset} onchange={event => applyPreset(event.currentTarget.value)} class="rounded bg-slate-700 p-1.5"><option value="edit">全局体素 · 规整与线框</option><option value="evidence">原始扫描</option><option value="slices">家具切片</option><option value="comparison">体素对照</option><option value="fusion">融合对照</option><option value="conflict">边界与未知</option>{#if currentScan === 'office-2-rescan'}<option value="review">沙发与椅子复核</option>{/if}<option value="custom" disabled>自定义选层</option></select></label>
      <label class="grid gap-1">显示格长<select aria-label="格子边长" bind:value={scanStep} onchange={changeGridStep} class="rounded bg-slate-700 p-1.5"><option value="0.2">20 厘米</option><option value="0.1">10 厘米</option><option value="0.05">5 厘米</option><option value="0.025">2.5 厘米</option></select></label>
    </div>
    <div class="mt-2 flex items-center gap-2">
      <label class="flex items-center gap-1"><input type="checkbox" aria-label="水平剖切" bind:checked={clipEnabled} onchange={updateLayerDisplays} />水平剖切</label>
      <label class="flex items-center gap-1"><input class="w-16 rounded bg-slate-700 p-1" type="number" min="0.2" max="5" step="0.1" aria-label="剖切高度" bind:value={clipHeight} oninput={updateLayerDisplays} />米</label>
    </div>
    <p class="mt-1 text-slate-400">剖切只隐藏上方画面。细格增加表达细节，不提高扫描测量精度。</p>
    {#if currentScan === 'office-2-rescan'}
      <div data-testid="review-layer-summary" class="mt-2 rounded border border-cyan-300/30 bg-cyan-300/[.06] p-2 text-[11px] text-slate-200">
        <strong class="text-cyan-100">复扫归属复核</strong>：原未归属观察体素 {layerRows.find(row => row.id === 'unknown')?.total.toLocaleString() ?? '—'} 格；复核后未决结构、开口、物体分层保留。照片锚定的沙发核心与椅子连续面是实测候选；邻近大件扩展未确认，默认关闭。原家具框和原 unknown 可独立对照。粗格跨类别可重叠，格数不能相加比较。
        {#if reviewReportUrl}<a href={reviewReportUrl} target="_blank" rel="noopener" class="mt-1 block text-cyan-200 underline underline-offset-2">查看源面归属复核报告</a>{/if}
      </div>
    {/if}
    <div class="mt-2 flex flex-wrap gap-1">
      <button onclick={() => changeView('perspective')} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">立体</button><button onclick={() => changeView('top')} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">俯视</button><button onclick={() => changeView('front')} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">正视</button><button onclick={() => changeView('side')} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">侧视</button>
      <button aria-pressed={buildingVisible} onclick={toggleBuilding} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">{buildingVisible ? '隐藏原生建筑' : '显示原生建筑'}</button>
    </div>
    <details class="mt-3 border-t border-white/20 pt-2">
      <summary class="cursor-pointer py-1 font-semibold">逐层开关、透明度与来源（{layerRows.length + 1} 层）</summary>
      <div role="group" aria-label="扫描证据批量选择" class="mt-2 flex flex-wrap items-center gap-2 rounded border border-white/15 bg-white/[.04] p-2">
        <label class="flex items-center gap-1.5"><input data-testid="scan-layer-partial" type="checkbox" aria-label="扫描证据部分开启" checked={layerRows.some(row => row.visible && row.available)} onchange={event => { if (event.currentTarget.checked) void applyPreset('edit'); else clearEvidenceLayers(); }} />部分开启</label>
        <button data-testid="scan-layer-off" type="button" class="rounded border border-white/20 px-2 py-1 hover:bg-white/10" onclick={clearEvidenceLayers}>全关</button>
        <span class="ml-auto text-[11px] text-slate-300">{layerRows.filter(row => row.visible && row.available).length}/{layerRows.filter(row => row.available).length} 层开启</span>
      </div>
      <p class="mt-1 text-[11px] text-slate-400">部分开启只载入 TSDF、规整结构／家具修正与 OBB 线框；高密度扫描和细格候选请逐层开启。体素方块初始 10%，TSDF 初始 100%。</p>
      {#if editedObjects.length}
        <div data-testid="scan-display-priority" role="group" aria-label="扫描与设计的显示侧重" class="scan-stage-switch">
          <button type="button" aria-pressed={designFocus} onclick={() => { designFocus = true; updateLayerDisplays(); }}>设计优先</button>
          <button type="button" aria-pressed={!designFocus} onclick={() => { designFocus = false; updateLayerDisplays(); }}>扫描对照</button>
        </div>
        <p class="mb-2 text-[11px] text-slate-300">设计优先时，已开启的扫描证据最多显示 18% 不透明度；滑块原值保留，切回扫描对照即可恢复。</p>
      {/if}
      <div class="mt-1 grid gap-2">
        {#each layerRows as row (row.id)}
          <div data-testid={'layer-' + row.id} class="rounded border border-white/10 bg-white/[.03] p-2">
            <label class="flex items-center gap-2"><input type="checkbox" aria-label={row.title} checked={row.visible} disabled={!row.available} onchange={event => toggleEvidence(row.id, event.currentTarget.checked)} /><span class:opacity-50={!row.available}>{row.title}</span>{#if row.busy}<span role="status" class="ml-auto text-sky-200">载入中</span>{/if}</label>
            <p class="mt-1 break-words text-[11px] text-slate-300">{row.provenance}{#if row.total > 0} · 全量 {row.total.toLocaleString()} / 抽显 {row.drawn.toLocaleString()}{/if}</p>
            {#if row.available}
              <div class="mt-1 flex items-center gap-2"><input class="min-w-0 flex-1" type="range" min="0" max="1" step="0.05" aria-label={row.title + '透明度'} bind:value={row.opacity} oninput={updateLayerDisplays} /><span class="min-w-10 text-right" title={'设定 ' + Math.round(row.opacity * 100) + '%'}>{Math.round(effectiveEvidenceOpacity(row) * 100)}%</span><label class="flex items-center gap-1"><input type="checkbox" aria-label={row.title + '参与剖切'} bind:checked={row.clipping} onchange={updateLayerDisplays} />剖切</label></div>
              {#if gridLayer(row.id)}<label class="mt-1 flex items-center gap-1 text-[11px] text-slate-300"><input type="checkbox" aria-label={row.title + '线框'} bind:checked={row.wireframe} onchange={updateLayerDisplays} />{REVIEW_OUTLINE_LAYERS.has(row.id) ? '观察格轮廓；填充仍保留' : '线框显示；透明度和剖切仍独立可调'}</label>{/if}
            {/if}
            {#if row.reason}<p class="mt-1 text-[11px] text-amber-200">{row.reason}</p>{/if}
            {#if row.error}<p role="alert" class="mt-1 text-[11px] text-rose-200">{row.error}</p>{/if}
          </div>
        {/each}
        <div class="rounded border border-white/10 p-2" data-testid="layer-user">
          <label class="flex items-center gap-2"><input type="checkbox" aria-label="用户体素盒" bind:checked={userVisible} onchange={updateLayerDisplays} />用户体素盒</label>
          <p class="mt-1 text-[11px] text-slate-300">实体设计占据 · {editedObjects.reduce((sum, object) => sum + object.cells, 0)} 格；透明扫描层仅作参照。</p>
          <div class="mt-1 flex items-center gap-2"><input class="min-w-0 flex-1" type="range" min="0" max="1" step="0.05" aria-label="用户体素盒透明度" bind:value={userOpacity} oninput={updateLayerDisplays} /><span class="w-8 text-right">{Math.round(userOpacity * 100)}%</span><label class="flex items-center gap-1"><input type="checkbox" aria-label="用户体素盒参与剖切" bind:checked={userClipped} onchange={updateLayerDisplays} />剖切</label></div>
          <div class="mt-2 flex items-center gap-3"><label class="flex items-center gap-1">着色<select data-testid="voxel-color-mode" aria-label="用户体素着色" bind:value={userColorMode} onchange={renderEditedVoxels} class="rounded bg-slate-700 p-1"><option value="semantic">物体颜色</option><option value="height">高度热力图</option></select></label><label class="flex items-center gap-1"><input type="checkbox" aria-label="显示体素格边" bind:checked={userGridEdgesVisible} onchange={updateLayerDisplays} />显示格边</label></div>
          {#if userColorMode === 'height'}<p class="mt-1 text-[11px] text-slate-300">蓝青到暖红表示设计格中心离地 {heightHeatMinM.toFixed(2)}–{heightHeatMaxM.toFixed(2)} 米；不表示扫描覆盖或净空。</p>{/if}
          <p class="mt-1 text-[11px] text-slate-400">每个物体最多绘制 {MAX_EDGE_CELLS_PER_OBJECT.toLocaleString()} 格的边线，实体格仍完整显示。</p>
        </div>
      </div>
    </details>
    <details class="mt-3 border-t border-white/20 pt-2">
      <summary class="cursor-pointer py-1 font-semibold">物体检查与不确定边界</summary>
      <p class="my-1 text-slate-300">先切原始三角面再形成表面格。原裁片与新分类格分开；候选均不等于封闭实心家具。</p>
      <div class="flex flex-wrap gap-1"><button aria-pressed={selectedScanObject === null} onclick={() => chooseScanObject(null)} class="rounded bg-white/10 px-2 py-1.5">全部</button>{#each scanRoom?.objects ?? [] as item, index}<button aria-pressed={selectedScanObject === index} onclick={() => chooseScanObject(index)} class="rounded bg-white/10 px-2 py-1.5">{item.category} {index + 1}</button>{/each}</div>
      {#if selectedScanObject !== null}
        {@const inspected = scanObjects.find(item => item.convertedIndex === selectedScanObject)}
        {#if inspected}<dl data-testid="scan-object-inspection" class="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 rounded bg-white/5 p-2 text-[11px]"><dt>稳定 ID</dt><dd class="break-all">{inspected.objectId}</dd><dt>映射状态</dt><dd>{inspected.mappingState ?? 'unverified'}</dd><dt>候选三角面</dt><dd>{inspected.faceCount === undefined ? '暂无切分报告' : inspected.faceCount.toLocaleString()}</dd><dt>水密状态</dt><dd>{inspected.watertight === undefined ? '未验证' : inspected.watertight ? '水密候选，仍需核验' : '非水密表面候选，不能视为实心家具'}</dd></dl>{/if}
      {/if}
      {#if pickStatus}<p data-testid="scan-pick-status" role="status" class="mt-2 text-amber-200">{pickStatus}</p>{/if}
      <p class="mt-2 text-slate-400">unknown 不是净空，conflict 保留多个候选。房间边界不全闭合，墙厚未知。</p>
    </details>
    {#if referencePhotos.length}<details class="mt-3 border-t border-white/20 pt-2">
      <summary class="cursor-pointer py-1 font-semibold">扫描参考照片</summary>
      <p class="mt-1 text-slate-300">照片用于对照扫描覆盖与家具候选；不是三维贴图或高斯泼溅。</p>
      <div class="mt-2 grid grid-cols-2 gap-2">{#each referencePhotos as photo}<a href={photo.url} target="_blank" rel="noopener" class="block rounded bg-white/5 p-1"><img src={photo.url} alt={photo.title} loading="lazy" class="aspect-[4/3] w-full rounded object-cover" /><span class="mt-1 block text-[11px]">{photo.title}</span></a>{/each}</div>
    </details>{/if}
    <details class="mt-3 border-t border-white/20 pt-2">
      <summary class="cursor-pointer py-1 font-semibold">杂物计算与诊断</summary>
      <p class="mt-1 text-slate-300">离线杂物计算：{clutterComputed ? '已运行，仅候选' : '未运行（默认关闭）'}。图层开关只显示已有结果，不启动计算。</p>
      <p class="mt-1 text-slate-400">需要时在实验 9 运行 <code class="break-all">python3 prepare_classified.py --compute-clutter</code>，然后刷新此页。仍需审核候选，不能自动清空 unknown。</p>
      {#each manifestWarnings as warning}<p class="mt-1 break-words text-amber-200">{warning}</p>{/each}
      <p class="mt-1 break-all text-slate-400">扫描身份：{scanIdentity?.scanId ?? '待验证'} · {scanIdentity?.transformHash.slice(0, 12) ?? '…'}</p>
    </details>
    <details open class="mt-3 border-t border-white/20 pt-2" data-testid="scan-voxel-editor">
      <summary class="cursor-pointer py-1 font-semibold">摆放与编辑体素盒</summary>
      <p class="mb-2 text-slate-300">输入 A×B×C 格数，点击可见水平支撑面摆放。本版尚未接入框选拉伸；细分是保体积的确定性编辑，AI 建模尚未接入。</p>
      <div class="grid grid-cols-2 gap-2"><label class="grid gap-1">名称<input aria-label="新盒名称" bind:value={boxName} class="min-w-0 rounded bg-slate-700 p-1.5" /></label><label class="grid gap-1">语义<input aria-label="新盒语义" bind:value={boxSemantic} class="min-w-0 rounded bg-slate-700 p-1.5" /></label></div>
      <label class="mt-2 flex items-center gap-2">新盒颜色<input data-testid="new-voxel-color" aria-label="新盒颜色" type="color" bind:value={boxColor} class="h-7 w-11 cursor-pointer rounded border border-white/20 bg-transparent" /><span class="text-slate-400">保存在体素工程中</span></label>
      <div class="mt-2 grid grid-cols-4 gap-1"><label class="grid gap-1">X 格<input aria-label="X 格数" type="number" min="1" max="100" bind:value={boxWidth} class="min-w-0 rounded bg-slate-700 p-1.5" /></label><label class="grid gap-1">Y 格<input aria-label="Y 格数" type="number" min="1" max="100" bind:value={boxHeight} class="min-w-0 rounded bg-slate-700 p-1.5" /></label><label class="grid gap-1">Z 格<input aria-label="Z 格数" type="number" min="1" max="100" bind:value={boxDepth} class="min-w-0 rounded bg-slate-700 p-1.5" /></label><label class="grid gap-1">米/格<select aria-label="盒体格长" bind:value={boxStep} class="min-w-0 rounded bg-slate-700 p-1.5"><option value={.2}>0.2</option><option value={.1}>0.1</option><option value={.05}>0.05</option><option value={.025}>0.025</option></select></label></div>
      <button data-testid="scan-place-box" aria-pressed={placementMode} disabled={!scanIdentity} onclick={() => { placementMode = !placementMode; if (placementMode) { cameraPlacementMode = false; furniturePlacementMode = false; removeGhostPreview(); } editStatus = placementMode ? '点击房间内地面或可见水平支撑面。隐藏层与剖切外表面不参与。' : ''; }} class="mt-2 rounded bg-amber-600 px-3 py-2 font-semibold hover:bg-amber-500 disabled:opacity-50">{placementMode ? '取消放置' : '点击放置 A×B×C 体素盒'}</button>
      {#if editStatus}<p data-testid="scan-edit-status" role="status" class="mt-2 text-amber-200">{editStatus}</p>{/if}
      {#if editedObjects.length}<div class="mt-2 flex flex-wrap gap-1">{#each editedObjects as object (object.id)}<button data-testid="edited-object" aria-pressed={selectedEditedId === object.id} onclick={() => selectEdited(object.id)} class="rounded bg-white/10 px-2 py-1.5 hover:bg-white/20">{object.name} · {object.cells} 格</button>{/each}</div>{/if}
      {#if selectedEditedId}<div class="mt-2 flex gap-1"><input aria-label="已选盒名称" bind:value={editName} class="min-w-0 flex-1 rounded bg-slate-700 p-1.5" /><button onclick={renameEdited} class="rounded bg-white/10 px-2">改名</button></div><div class="mt-2 flex items-center gap-2"><label class="flex items-center gap-2">盒颜色<input data-testid="selected-voxel-color" aria-label="已选盒颜色" type="color" bind:value={editColor} class="h-7 w-11 cursor-pointer rounded border border-white/20 bg-transparent" /></label><button onclick={recolorEdited} class="rounded bg-white/10 px-2 py-1.5">应用颜色</button></div><div class="mt-2 flex flex-wrap gap-1"><button onclick={() => moveEdited(0, -1)} class="rounded bg-white/10 px-2 py-1.5">X−</button><button onclick={() => moveEdited(0, 1)} class="rounded bg-white/10 px-2 py-1.5">X+</button><button onclick={() => moveEdited(2, -1)} class="rounded bg-white/10 px-2 py-1.5">Z−</button><button onclick={() => moveEdited(2, 1)} class="rounded bg-white/10 px-2 py-1.5">Z+</button><button onclick={() => moveEdited(1, -1)} class="rounded bg-white/10 px-2 py-1.5">Y−</button><button onclick={() => moveEdited(1, 1)} class="rounded bg-white/10 px-2 py-1.5">Y+</button><button onclick={rotateEdited} class="rounded bg-white/10 px-2 py-1.5">旋转 90°</button><button onclick={refineEdited} class="rounded bg-white/10 px-2 py-1.5">细分所选盒</button><button onclick={deleteEdited} class="rounded bg-red-800/70 px-2 py-1.5">删除</button></div>{/if}
      <div class="mt-3 flex flex-wrap gap-2"><button onclick={exportEditedJSON} class="rounded bg-white/10 px-2 py-1.5">导出体素 JSON</button><label class="cursor-pointer rounded bg-white/10 px-2 py-1.5">导入体素 JSON<input aria-label="导入体素 JSON" type="file" accept="application/json,.json" onchange={importEditedJSON} class="sr-only" /></label></div>
    </details>
    <details open class="mt-3 border-t border-white/20 pt-2">
      <summary class="cursor-pointer py-1 font-semibold">完整实验工程与恢复</summary>
      <p class="text-slate-300">包含原生平面、用户体素设计与扫描来源引用。扫描照片、PLY 等资产保留在本机；顶栏原生保存／导出只覆盖平面项目。</p>
      <div class="mt-2 flex flex-wrap gap-2"><button data-testid="export-full-project" onclick={exportFullProject} class="rounded bg-emerald-800 px-2 py-2 hover:bg-emerald-700">导出完整实验工程</button><label class="cursor-pointer rounded bg-white/10 px-2 py-2">恢复完整实验工程<input aria-label="恢复完整实验工程" type="file" accept="application/json,.json" onchange={importFullProject} class="sr-only" /></label></div>
    </details>
    </div>
    {/if}
  </aside>
  {/if}
  <!-- 3D Toolbar Row -->
  <div class="absolute top-4 right-4 z-50 flex gap-1.5">
    <!-- Multi-Floor Stacking Toggle -->
    <button
      onclick={() => { showAllFloors = !showAllFloors; rebuildScene(); }}
      class="p-2 rounded-lg transition-colors {showAllFloors ? 'bg-purple-600 text-white ring-2 ring-purple-300' : 'bg-black/70 text-white hover:bg-black/80'}"
      title={showAllFloors ? $t('viewerNav.activeFloor') : $t('viewerNav.allFloors')}
      aria-label={showAllFloors ? $t('viewerNav.activeFloor') : $t('viewerNav.allFloors')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="4" y="14" width="16" height="4" rx="1"/>
        <rect x="4" y="8" width="16" height="4" rx="1" opacity="0.6"/>
        <rect x="4" y="2" width="16" height="4" rx="1" opacity="0.3"/>
      </svg>
    </button>

    <!-- Top-Down View Button -->
    <button
      onclick={viewTopDown}
      class="p-2 rounded-lg bg-black/70 text-white hover:bg-black/80 transition-colors"
      title={$t('viewerNav.top')}
      aria-label={$t('viewerNav.top')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="2" x2="12" y2="6"/>
        <line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="2" y1="12" x2="6" y2="12"/>
        <line x1="18" y1="12" x2="22" y2="12"/>
      </svg>
    </button>

    <!-- Wall Transparency Toggle -->
    <button
      onclick={toggleWallTransparency}
      class="p-2 rounded-lg transition-colors {wallsTransparent ? 'bg-blue-600 text-white ring-2 ring-blue-300' : 'bg-black/70 text-white hover:bg-black/80'}"
      title={wallsTransparent ? $t('viewerNav.solid') : $t('viewerNav.transparent')}
      aria-label={wallsTransparent ? $t('viewerNav.solid') : $t('viewerNav.transparent')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" opacity={wallsTransparent ? 0.3 : 1}/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="12" y1="3" x2="12" y2="21"/>
      </svg>
    </button>

    <!-- Edit Mode Toggle -->
    <button
      onclick={() => { editMode = !editMode; if (editMode && walkthroughMode) { exitWalkthroughMode(); } if (!editMode) { selectedElementId.set(null); } }}
      class="p-2 rounded-lg transition-colors {editMode ? 'bg-blue-600 text-white ring-2 ring-blue-300' : 'bg-black/70 text-white hover:bg-black/80'}"
      title={editMode ? $t('viewerNav.exitEdit') : $t('viewerNav.editHelp')}
      aria-label={editMode ? $t('viewerNav.exitEdit') : $t('viewerNav.edit')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>

    <!-- Interior Camera Button -->
    <button
      onclick={() => {
        if (cameraPlacementMode) {
          cameraPlacementMode = false;
        } else {
          cameraPlacementMode = true;
          cameraPlaced = false;
          editMode = true;
          if (walkthroughMode) exitWalkthroughMode();
          furniturePlacementMode = false;
        }
      }}
      class="p-2 rounded-lg transition-colors {cameraPlacementMode ? 'bg-blue-600 text-white ring-2 ring-blue-300' : 'bg-black/70 text-white hover:bg-black/80'}"
      title={cameraPlacementMode ? $t('viewerNav.cameraCancel') : $t('viewerNav.cameraHelp')}
      aria-label={$t('viewerNav.camera')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 7l-7 5 7 5V7z"/>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg>
    </button>

    <!-- 3D Screenshot Button -->
    <button
      onclick={takeScreenshot}
      class="p-2 rounded-lg bg-black/70 text-white hover:bg-black/80 transition-colors"
      title={$t('viewerNav.screenshot')}
      aria-label={$t('viewerNav.screenshot')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </button>

    <!-- Walkthrough Mode Toggle Button -->
    <button
      onclick={toggleWalkthroughMode}
      class="p-2 rounded-lg bg-black/70 text-white hover:bg-black/80 transition-colors"
      title={walkthroughMode ? $t('viewerNav.exitWalk') : $t('viewerNav.enterWalk')}
      aria-label={walkthroughMode ? $t('viewerNav.exitWalk') : $t('viewerNav.enterWalk')}
  >
    {#if walkthroughMode}
      <!-- Exit/Eye closed icon -->
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
    {:else}
      <!-- Walking person icon -->
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="4" r="2"/>
        <path d="M10 16v6"/>
        <path d="M14 16v6"/>
        <path d="M12 6h2l4 4"/>
        <path d="M10 14l2-2 1 2"/>
      </svg>
    {/if}
    </button>
  </div><!-- end 3D toolbar row -->

  {#if cameraPlacementMode && !cameraPlaced}
    <div class="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-black/80 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-sm">
      {$t('viewerNav.cameraPosition')}
    </div>
  {:else if cameraPlacementMode && cameraPlaced}
    <div class="absolute top-16 left-1/2 -translate-x-1/2 z-50 bg-black/80 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-sm">
      {$t('viewerNav.cameraAim')}
    </div>
  {/if}

  <!-- Camera Preview Panel -->
  {#if cameraPreviewOpen && cameraPlaced}
    <div class="absolute bottom-4 right-4 z-[60] bg-gray-900/95 rounded-xl shadow-2xl backdrop-blur-sm overflow-y-auto max-w-[calc(100vw-2rem)]" style="width: 420px; max-height: calc(100vh - 8rem);">
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <span class="text-white text-sm font-medium">{$t('viewerCamera.title')}</span>
        <div class="flex gap-2">
          <button class="text-xs text-blue-400 hover:text-blue-300" onclick={() => { cancelAIRender(); aiRenderOpen = !aiRenderOpen; }}>
            {aiRenderOpen ? $t('viewerAI.hide') : $t('viewerAI.show')}
          </button>
          <button class="text-gray-400 hover:text-white text-lg leading-none" onclick={closeCamera} aria-label={$t('viewerCamera.close')}>✕</button>
        </div>
      </div>
      <!-- Preview canvas with drag-to-rotate -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="relative cursor-grab active:cursor-grabbing"
        onpointerdown={(e) => { previewDragStart = { x: e.clientX, y: e.clientY, yaw: cameraYaw, pitch: cameraPitch }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onpointermove={(e) => { if (!previewDragStart) return; const dx = e.clientX - previewDragStart.x; const dy = e.clientY - previewDragStart.y; cameraYaw = previewDragStart.yaw + dx * 0.5; cameraPitch = Math.max(-45, Math.min(45, previewDragStart.pitch - dy * 0.3)); cameraPreviewDirty = true; }}
        onpointerup={() => { previewDragStart = null; }}
      >
        <canvas use:attachCameraPreview aria-label={$t('viewerCamera.preview')} width="384" height="216" class="w-full pointer-events-none"></canvas>
        <div class="absolute bottom-1 left-1 text-[10px] text-white/50 pointer-events-none">{$t('viewerCamera.look')}</div>
      </div>

      <!-- Movement arrows -->
      <div class="flex items-center justify-center gap-1 py-1.5 border-b border-gray-800">
        <span class="text-[10px] text-gray-500 mr-2">{$t('viewerCamera.move')}</span>
        <button class="w-7 h-7 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center" onclick={() => moveCameraRelative(0, -10)} title={$t('viewerCamera.left')} aria-label={$t('viewerCamera.left')}>←</button>
        <div class="flex flex-col gap-0.5">
          <button class="w-7 h-7 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center" onclick={() => moveCameraRelative(10, 0)} title={$t('viewerCamera.forward')} aria-label={$t('viewerCamera.forward')}>↑</button>
          <button class="w-7 h-7 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center" onclick={() => moveCameraRelative(-10, 0)} title={$t('viewerCamera.back')} aria-label={$t('viewerCamera.back')}>↓</button>
        </div>
        <button class="w-7 h-7 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs flex items-center justify-center" onclick={() => moveCameraRelative(0, 10)} title={$t('viewerCamera.right')} aria-label={$t('viewerCamera.right')}>→</button>
      </div>

      <div class="px-3 py-2 space-y-1.5">
        <label class="flex items-center justify-between text-xs text-gray-300">
          <span>{$t('viewerCamera.fov')}</span>
          <div class="flex items-center gap-2">
            <input type="range" min="50" max="120" bind:value={cameraFOV} class="w-28 h-1 accent-blue-400"
              oninput={() => { cameraPreviewDirty = true; }} />
            <span class="w-10 text-right">{cameraFOV}°</span>
          </div>
        </label>
        <label class="flex items-center justify-between text-xs text-gray-300">
          <span>{$t('viewerCamera.height')}</span>
          <div class="flex items-center gap-2">
            <input type="range" min="80" max="220" bind:value={cameraHeight} class="w-28 h-1 accent-blue-400"
              oninput={() => { cameraPreviewDirty = true; }} />
            <span class="w-10 text-right">{cameraHeight}cm</span>
          </div>
        </label>
        <label class="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
          <input type="checkbox" bind:checked={cameraXrayWalls} class="accent-blue-400" onchange={() => { cameraPreviewDirty = true; }} />
          <span>{$t('viewerCamera.xray')}</span>
        </label>
        <div class="flex gap-2 pt-1">
          <button
            class="flex-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors"
            onclick={captureInteriorPhoto}
          >
            {$t('viewerCamera.capture')}
          </button>
          <button
            class="px-3 py-1.5 bg-gray-700 text-gray-300 text-sm rounded-lg hover:bg-gray-600 transition-colors"
            onclick={() => { cameraPlacementMode = true; cameraPlaced = false; }}
          >
            {$t('viewerCamera.reposition')}
          </button>
        </div>
      </div>

      <!-- AI Render Section -->
      {#if aiRenderOpen}
        <div class="border-t border-gray-700 px-3 py-3 space-y-2">
          <div class="text-xs font-medium text-white">{$t('viewerAI.title')}</div>

          <!-- Provider toggle -->
          <div class="flex rounded-lg overflow-hidden border border-gray-700">
            <button
              class="flex-1 text-xs py-1.5 font-medium transition-colors {aiProvider === 'gemini' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}"
              onclick={() => { cancelAIRender(); aiProvider = 'gemini'; }}
            >Gemini</button>
            <button
              class="flex-1 text-xs py-1.5 font-medium transition-colors {aiProvider === 'openai' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}"
              onclick={() => { cancelAIRender(); aiProvider = 'openai'; }}
            >OpenAI</button>
          </div>

          {#if aiProvider === 'gemini'}
            <label class="block">
              <span class="text-[10px] text-gray-400 block mb-1">{$t('viewerAI.model')}</span>
              <select bind:value={aiModel} disabled={aiRendering} class="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1.5 border border-gray-700">
                {#each AI_MODELS as m}<option value={m.id}>{m.name} — {m.desc}</option>{/each}
              </select>
            </label>
          {:else}
            <div class="text-gray-200 space-y-2">
              <p class="text-xs break-all">{$t('viewerAI.provider', { destination: providerDestination() })}</p>
              <OpenAIModelPicker config={$openAISettings} bind:model={openaiModel} id="render-openai-model" disabled={aiRendering} onchange={saveRenderModel} />
              <p class="text-xs text-gray-400">{$t('viewerAI.disclosure')}</p>
            </div>
          {/if}

          <div class="grid grid-cols-3 gap-2">
            <label class="block">
              <span class="text-[10px] text-gray-400 block mb-1">{$t('viewerAI.style')}</span>
              <select bind:value={aiRenderStyle} class="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-700">
                {#each STYLE_OPTIONS as opt}<option value={opt}>{aiRenderLabels[opt] ? $t(aiRenderLabels[opt]) : opt}</option>{/each}
              </select>
            </label>
            <label class="block">
              <span class="text-[10px] text-gray-400 block mb-1">{$t('viewerAI.lighting')}</span>
              <select bind:value={aiRenderLighting} class="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-700">
                {#each LIGHTING_OPTIONS as opt}<option value={opt}>{aiRenderLabels[opt] ? $t(aiRenderLabels[opt]) : opt}</option>{/each}
              </select>
            </label>
            <label class="block">
              <span class="text-[10px] text-gray-400 block mb-1">{$t('viewerAI.mood')}</span>
              <select bind:value={aiRenderMood} class="w-full bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-700">
                {#each MOOD_OPTIONS as opt}<option value={opt}>{aiRenderLabels[opt] ? $t(aiRenderLabels[opt]) : opt}</option>{/each}
              </select>
            </label>
          </div>

          <label class="block">
            <span class="text-[10px] text-gray-400 block mb-1">{$t('viewerAI.extra')}</span>
            <input type="text" bind:value={aiRenderExtra} placeholder={$t('viewerAI.placeholder')}
              class="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 border border-gray-700 placeholder:text-gray-600" />
          </label>

          <details class="text-[10px] text-gray-500">
            <summary class="cursor-pointer hover:text-gray-400">{$t('viewerAI.prompt')}</summary>
            <p class="mt-1 p-2 bg-gray-800 rounded text-gray-400 leading-relaxed">{buildAIPrompt()}</p>
          </details>

          <button
            class="w-full px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            onclick={runAIRender}
            disabled={aiRendering}
          >
            {#if aiRendering}
              <span class="animate-spin">⏳</span> {$t('viewerAI.rendering')}
            {:else}
              {$t('viewerAI.generate')}
            {/if}
          </button>

          {#if aiRendering}
            <button type="button" onclick={cancelAIRender} class="w-full py-2 text-sm text-gray-200 border border-gray-600 rounded-lg">{$t('viewerAI.cancel')}</button>
          {/if}

          {#if aiRenderError}
            <div class="bg-red-900/30 border border-red-700 rounded-lg p-3 space-y-2">
              <div class="text-xs font-medium text-red-400">{$t('viewerAI.failed')}</div>
              <pre class="text-[10px] text-red-300 whitespace-pre-wrap break-all max-h-32 overflow-y-auto select-all cursor-text font-mono bg-red-950/40 rounded p-2">{aiRenderMessages[aiRenderError] ? $t(aiRenderMessages[aiRenderError]) : aiRenderError}</pre>
              <button
                class="text-[10px] text-red-400 hover:text-red-300 underline"
                onclick={() => { navigator.clipboard.writeText(aiRenderError ?? ''); }}
              >{$t('viewerAI.copy')}</button>
            </div>
          {/if}

          {#if aiRenderResult}
            <div class="space-y-2">
              <img src={aiRenderResult} alt={$t('viewerAI.result')} class="w-full rounded-lg" />
              <button
                class="w-full px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-500 transition-colors"
                onclick={downloadAIRender}
              >
                {$t('viewerAI.download')}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if walkthroughMode}
    <!-- Crosshair -->
    <div class="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
      <div class="w-4 h-4">
        <svg width="16" height="16" viewBox="0 0 16 16" class="text-white drop-shadow-lg">
          <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="1"/>
          <line x1="8" y1="10" x2="8" y2="14" stroke="currentColor" stroke-width="1"/>
          <line x1="2" y1="8" x2="6" y2="8" stroke="currentColor" stroke-width="1"/>
          <line x1="10" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1"/>
        </svg>
      </div>
    </div>

    <!-- Controls Panel -->
    <div class="absolute top-4 left-4 z-10 bg-black/70 text-white text-xs rounded-lg backdrop-blur-sm p-3 space-y-2 min-w-[180px]">
      <div class="font-semibold text-white/90 mb-1">{$t('viewerNav.walkControls')}</div>
      {#if walkthroughMouseUnavailable}
        <p role="status" class="max-w-56 text-amber-200">{$t('viewerNav.mouseUnavailable')}</p>
      {/if}
      <label class="flex items-center justify-between gap-2">
        <span class="text-white/70">{$t('viewerNav.eyeHeight')}</span>
        <div class="flex items-center gap-1">
          <input type="range" min="80" max="220" bind:value={eyeHeight} oninput={markSceneDirty} class="w-16 h-1 accent-blue-400" />
          <span class="w-10 text-right">{eyeHeight}cm</span>
        </div>
      </label>
      <label class="flex items-center justify-between gap-2">
        <span class="text-white/70">{$t('viewerNav.walkSpeed')}</span>
        <div class="flex items-center gap-1">
          <input type="range" min="100" max="1000" step="50" bind:value={moveSpeed} class="w-16 h-1 accent-blue-400" />
          <span class="w-10 text-right">{moveSpeed}</span>
        </div>
      </label>
      <label class="flex items-center justify-between gap-2">
        <span class="text-white/70">{$t('viewerNav.sprintSpeed')}</span>
        <div class="flex items-center gap-1">
          <input type="range" min="200" max="2000" step="100" bind:value={sprintSpeed} class="w-16 h-1 accent-blue-400" />
          <span class="w-10 text-right">{sprintSpeed}</span>
        </div>
      </label>
    </div>

    <!-- Help Text -->
    <div class="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
      <div class="bg-black/70 text-white text-sm px-4 py-2 rounded-lg backdrop-blur-sm">
        {$t('viewerNav.walkHelp')}
      </div>
    </div>
  {/if}

  {#if editMode && !walkthroughMode}
    <div class="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10">
      <div class="bg-blue-600/90 text-white text-sm px-4 py-2 rounded-lg backdrop-blur-sm flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        {#if furniturePlacementMode}
          {$t('viewerFurniture.hint', { name: selectedCatalogId ? furnitureName(selectedCatalogId, $locale) : $t('viewerFurniture.fallback') })}
        {:else}
          {$t('viewerFurniture.paint')}
        {/if}
      </div>
    </div>

    <!-- Furniture Placement Toggle -->
    <button
      onclick={() => { furniturePlacementMode = !furniturePlacementMode; if (!furniturePlacementMode) { placingFurnitureId.set(null); removeGhostPreview(); selectedCatalogId = null; furniturePickerOpen = false; } else { placementMode = false; furniturePickerOpen = true; if (currentScan) { buildingVisible = true; wallGroup.visible = true; markSceneDirty(); } } }}
      class="absolute top-16 right-28 z-50 p-2 rounded-lg transition-colors {furniturePlacementMode ? 'bg-green-600 text-white ring-2 ring-green-300' : 'bg-black/70 text-white hover:bg-black/80'}"
      title={furniturePlacementMode ? $t('viewerFurniture.exit') : $t('viewerFurniture.place')}
      aria-label={furniturePlacementMode ? $t('viewerFurniture.exit') : $t('viewerFurniture.place')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="12" width="18" height="8" rx="1"/>
        <path d="M5 12V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/>
        <line x1="5" y1="20" x2="5" y2="22"/>
        <line x1="19" y1="20" x2="19" y2="22"/>
      </svg>
    </button>

    <!-- Furniture Picker Panel -->
    {#if furniturePlacementMode && furniturePickerOpen}
      <div class="absolute top-4 left-4 z-50 bg-black/85 text-white rounded-lg backdrop-blur-sm w-56 max-h-[70vh] flex flex-col overflow-hidden select-none">
        <div class="p-2 border-b border-white/10 flex items-center justify-between">
          <span class="font-semibold text-sm">{$t('viewerFurniture.title')}</span>
          <button onclick={() => { furniturePickerOpen = false; }} aria-label={$t('viewerFurniture.close')} class="text-white/50 hover:text-white text-lg leading-none">&times;</button>
        </div>
        <!-- Category tabs -->
        <div class="flex flex-wrap gap-1 p-2 border-b border-white/10">
          {#each furnitureCategories.filter(c => c !== 'Electrical' && c !== 'Plumbing') as cat}
            <button
              onclick={() => { furniturePickerCategory = cat; }}
              aria-pressed={furniturePickerCategory === cat}
              class="px-2 py-0.5 rounded text-[10px] transition-colors {furniturePickerCategory === cat ? 'bg-green-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white/70'}"
            >{catalogCategoryLabels[cat] ? $t(catalogCategoryLabels[cat]) : cat}</button>
          {/each}
        </div>
        <!-- Items -->
        <div class="overflow-y-auto p-1 flex-1">
          {#each furnitureCatalog.filter(f => f.category === furniturePickerCategory && !f.symbol) as item}
            <button
              onclick={() => { placingFurnitureId.set(null); furniturePlacementMode = true; selectedCatalogId = item.id; removeGhostPreview(); }}
              class="w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors {selectedCatalogId === item.id ? 'bg-green-600/80 text-white' : 'hover:bg-white/10 text-white/80'}"
            >
              <span class="text-base">{item.icon}</span>
              <span>{furnitureName(item.id, $locale)}</span>
              <span class="ml-auto text-[10px] text-white/40">{item.width}×{item.depth}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}

  <!-- Lighting Controls Toggle Button -->
  <button
    onclick={() => { lightingPanelOpen = !lightingPanelOpen; }}
    class="absolute bottom-4 left-4 md:left-14 z-50 p-2 rounded-lg transition-colors {lightingPanelOpen ? 'bg-amber-500 text-white ring-2 ring-amber-300' : 'bg-black/70 text-white hover:bg-black/80'}"
    title={$t('viewerLighting.title')}
    aria-label={$t('viewerLighting.title')}
    aria-expanded={lightingPanelOpen}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  </button>

  <!-- Lighting Controls Panel -->
  {#if lightingPanelOpen}
    <div class="absolute bottom-14 left-4 md:left-14 z-50 bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm p-3 space-y-3 min-w-[220px] select-none">
      <div class="font-semibold text-white/90 text-sm flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/></svg>
        {$t('viewerLighting.title')}
      </div>

      <!-- Time of Day Presets -->
      <div class="space-y-1">
        <span class="text-white/60 text-[10px] uppercase tracking-wide">{$t('viewerLighting.time')}</span>
        <div class="flex gap-1">
          {#each (['morning', 'noon', 'evening', 'night'] as const) as preset}
            <button
              onclick={() => applyTimePreset(preset)}
              aria-pressed={timeOfDay === preset}
              class="flex-1 px-1.5 py-1 rounded text-[11px] transition-colors {timeOfDay === preset ? 'bg-amber-500 text-white' : 'bg-white/10 hover:bg-white/20 text-white/80'}"
            >
              {preset === 'morning' ? '🌅' : preset === 'noon' ? '☀️' : preset === 'evening' ? '🌇' : '🌙'}
              <span class="block capitalize">{$t(`viewerLighting.${preset}`)}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Sun Position -->
      <label class="block space-y-0.5">
        <div class="flex justify-between text-white/60">
          <span>{$t('viewerLighting.azimuth')}</span><span>{sunAzimuth}°</span>
        </div>
        <input type="range" min="0" max="360" bind:value={sunAzimuth} oninput={() => { timeOfDay = null; updateSunPosition(); }} class="w-full h-1 accent-amber-400" />
      </label>

      <!-- Sun Elevation -->
      <label class="block space-y-0.5">
        <div class="flex justify-between text-white/60">
          <span>{$t('viewerLighting.elevation')}</span><span>{sunElevation}°</span>
        </div>
        <input type="range" min="0" max="90" bind:value={sunElevation} oninput={() => { timeOfDay = null; updateSunPosition(); }} class="w-full h-1 accent-amber-400" />
      </label>

      <!-- Ambient Intensity -->
      <label class="block space-y-0.5">
        <div class="flex justify-between text-white/60">
          <span>{$t('viewerLighting.ambient')}</span><span>{Math.round(ambientIntensity * 100)}%</span>
        </div>
        <input type="range" min="0" max="100" value={Math.round(ambientIntensity * 100)} oninput={(e) => { ambientIntensity = parseInt(e.currentTarget.value) / 100; timeOfDay = null; updateAmbientIntensity(); }} class="w-full h-1 accent-blue-400" />
      </label>
    </div>
  {/if}
  {/if}<!-- end of the controls that need the renderer -->
</div>

<style>
  .studio-stage { background: #0a0a0a; }
  .studio-grain { position: absolute; inset: 0; z-index: 4; pointer-events: none; opacity: .026; mix-blend-mode: screen; background-size: 128px 128px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' seed='7' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='128' height='128' filter='url(%23n)'/%3E%3C/svg%3E"); }
  .scan-ready :global(canvas[data-plan3d-canvas]) { animation: scan-stage-arrive .4s ease-out both; }
  @keyframes scan-stage-arrive { from { opacity: .78; } to { opacity: 1; } }
  .scan-reveal { position: absolute; inset: 0; z-index: 5; pointer-events: none; background: linear-gradient(180deg, transparent 34%, rgba(255, 255, 255, .024) 49%, transparent 64%); animation: scan-stage-sweep .57s ease-out both; }
  .scan-reveal::after { content: ''; position: absolute; top: 50%; left: 5%; right: 5%; height: 1px; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .16), transparent); }
  @keyframes scan-stage-sweep { from { opacity: 0; transform: translateY(-65%); } 30% { opacity: 1; } to { opacity: 0; transform: translateY(65%); } }
  .scan-drawer {
    width: min(22rem, calc(100% - 2rem));
    max-height: calc(100% - 9rem);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #e9e9e9;
    background: rgba(10, 10, 10, .88);
    border: 1px solid rgba(255, 255, 255, .12);
    border-radius: 12px;
    box-shadow: 0 18px 46px rgba(0, 0, 0, .25), inset 0 1px 0 rgba(255, 255, 255, .025);
    backdrop-filter: blur(16px) saturate(120%);
    -webkit-backdrop-filter: blur(16px) saturate(120%);
    transition: width .22s ease, border-radius .22s ease, background .22s ease;
  }
  .scan-drawer.collapsed { width: min(14.5rem, calc(100% - 2rem)); max-height: none; border-radius: 999px; }
  .scan-panel-head { flex: 0 0 auto; min-height: 47px; padding: 9px 12px 9px 14px; border-bottom: 1px solid rgba(255, 255, 255, .10); }
  .scan-drawer.collapsed .scan-panel-head { min-height: 39px; padding: 5px 7px 5px 12px; border-bottom: 0; }
  .scan-panel-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .scan-panel-title strong { font-size: 12px; font-weight: 600; white-space: nowrap; letter-spacing: .015em; }
  .scan-panel-title small { color: #9a9a9a; font-size: 10px; white-space: nowrap; }
  .scan-drawer.collapsed .scan-panel-title strong { font-size: 11px; }
  .scan-panel-mark { display: grid; grid-template-columns: repeat(2, 4px); grid-template-rows: repeat(2, 4px); gap: 2px; transform: rotate(-9deg); }
  .scan-panel-mark i { display: block; background: #d7d7d7; }
  .scan-panel-mark i:nth-child(2) { opacity: .58; }
  .scan-panel-mark i:nth-child(3) { opacity: .38; }
  .scan-panel-mark i:nth-child(4) { opacity: .75; }
  .scan-panel-toggle { flex: 0 0 auto; border: 1px solid rgba(255, 255, 255, .14); border-radius: 999px; padding: 6px 9px; background: rgba(255, 255, 255, .038); color: #dcdcdc; font-size: 10px; cursor: pointer; }
  .scan-panel-toggle:hover { background: rgba(255, 255, 255, .08); color: #fff; }
  .scan-drawer-content { min-height: 0; overflow-y: auto; padding: 0 13px 14px; scrollbar-color: rgba(255, 255, 255, .24) transparent; scrollbar-width: thin; }
  .scan-status { color: #c9c9c9; font-variant-numeric: tabular-nums; }
  .scan-stage-switch { display: flex; width: max-content; max-width: 100%; gap: 2px; margin: 11px 0 12px; padding: 3px; background: rgba(255, 255, 255, .038); border: 1px solid rgba(255, 255, 255, .075); border-radius: 999px; }
  .scan-stage-switch button { border: 0; border-radius: 999px; padding: 6px 10px; color: #8e8e8e; background: transparent; font-size: 10px; white-space: nowrap; cursor: pointer; }
  .scan-stage-switch button:hover { color: #ededed; background: rgba(255, 255, 255, .05); }
  .scan-stage-switch button[aria-pressed='true'] { color: #f2f2f2; background: rgba(255, 255, 255, .075); }
  .scan-drawer :global(input[type='checkbox']), .scan-drawer :global(input[type='range']) { accent-color: #d7d7d7; }
  .scan-drawer :global(input:not([type='checkbox']):not([type='range']):not([type='color'])), .scan-drawer :global(select) { background: rgba(255, 255, 255, .055); border: 1px solid rgba(255, 255, 255, .12); color: #f1f1f1; }
  .scan-drawer :global(input:focus-visible), .scan-drawer :global(select:focus-visible), .scan-drawer :global(button:focus-visible), .scan-panel-toggle:focus-visible { outline: 2px solid #d7d7d7; outline-offset: 2px; }
  .scan-drawer :global(details) { border-color: rgba(255, 255, 255, .14); }
  .scan-drawer :global(summary) { color: #e9e9e9; }
  .scan-drawer :global([data-testid='scan-place-box']) { background: #efefef; color: #0b0b0b; }
  .scan-drawer :global([data-testid='scan-place-box']:hover) { background: #fff; }
  .scan-drawer :global([data-testid='export-full-project']) { background: #dcdcdc; color: #0b0b0b; }
  .scan-drawer :global([data-testid='export-full-project']:hover) { background: #fff; }
  .scan-scene-readout { width: min(280px, calc(100% - 2rem)); padding: 10px 13px; color: #d1d1d1; background: rgba(10, 10, 10, .69); border-top: 1px solid rgba(255, 255, 255, .3); border-bottom: 1px solid rgba(255, 255, 255, .11); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  .scan-readout-head { display: flex; align-items: center; gap: 9px; padding-bottom: 9px; border-bottom: 1px solid rgba(255, 255, 255, .14); font-size: 11px; letter-spacing: .04em; }
  .scan-readout-cross { color: #d7d7d7; font-size: 18px; line-height: .6; }
  .scan-readout-values { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 11px; }
  .scan-readout-values div { display: grid; gap: 5px; }
  .scan-readout-values span { color: #9a9a9a; font-size: 10px; }
  .scan-readout-values strong { color: #f1f1f1; font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
  .scan-scene-readout p { margin: 10px 0 0; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, .1); color: #9a9a9a; font-size: 10px; }
  .selected-voxel-annotation { transform: translate(16px, -100%); display: grid; grid-template-columns: auto auto; column-gap: 7px; row-gap: 2px; min-width: 120px; max-width: 170px; padding: 7px 9px; color: #f1f1f1; background: rgba(10, 10, 10, .86); border-left: 2px solid #edae74; box-shadow: 0 7px 28px rgba(0, 0, 0, .2); backdrop-filter: blur(8px); animation: annotation-enter .28s ease-out both; }
  .selected-voxel-annotation::before { content: ''; position: absolute; width: 17px; height: 1px; left: -17px; bottom: 3px; background: #edae74; }
  .annotation-index { grid-row: 1 / span 2; color: #edae74; font-size: 15px; }
  .selected-voxel-annotation strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 600; }
  .selected-voxel-annotation small { color: #aaa; font-size: 10px; white-space: nowrap; }
  @keyframes annotation-enter { from { opacity: 0; transform: translate(16px, -95%); } to { opacity: 1; transform: translate(16px, -100%); } }
  @media (max-width: 640px) {
    .scan-drawer { top: 3.6rem; left: .6rem; width: min(20rem, calc(100% - 1.2rem)); max-height: calc(100% - 7rem); }
    .scan-drawer.collapsed { width: min(14.5rem, calc(100% - 1.2rem)); }
    .selected-voxel-annotation { max-width: 135px; }
  }
  @media (prefers-reduced-motion: reduce) { .scan-drawer, .selected-voxel-annotation, .scan-reveal, .scan-ready :global(canvas[data-plan3d-canvas]) { transition: none; animation: none; } .scan-reveal { display: none; } }
</style>
