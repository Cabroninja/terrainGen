import { initializeHelp } from './config-help.js';
import { Terrain3DViewer } from './terrain-viewer.js';
import { VoxelTerrainViewer } from './voxel-viewer.js';
import { normalizeElevationProfile, elevationProfileInfluence } from './brush-profile.js';
import { normalizePlateauSettings, plateauInfluence, heightToLayerValue, layerValueToHeight } from './plateau-tool.js';
import { normalizeRoadRampSettings, analyzeRoadRamp } from './road-ramp-tool.js';
import { normalizeWaterSettings, smoothFreehandCourse, courseLength } from './water-course-tool.js';
import { normalizeStructureSettings, estimateStructureCount, weightedMember, pointInsideRamp, pointSegmentDistance } from './structure-tool.js';

const $ = (id) => document.getElementById(id);
function readPreference(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; } }
function writePreference(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* Preferencia no persistente en este contexto. */ } }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MIN_MAP_SIZE = 32;
const MAX_MAP_SIZE = 2048;
const MAX_EXPORT_VOXELS = 750000000;
const EXPORT_WARNING_VOXELS = 250000000;

function createMarkerId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch (_) { /* Continúa con el fallback compatible con HTTP. */ }
  return `marker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function createRoadRampId() {
  return `ramp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createWaterCourseId() {
  return `river-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createStructureId(prefix = 'structure') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

const LAYERS = {
  playable: { label: 'Límite jugable', color: '#d7e1dc', default: 255, kind: 'mask', help: 'layer_playable' },
  regions: { label: 'Regiones', color: '#85c0d3', default: 1, kind: 'category', help: 'layer_regions' },
  roads: { label: 'Caminos', color: '#d6aa6b', default: 0, kind: 'roads', help: 'layer_roads' },
  height_base: { label: 'Altura base', color: '#a7c7a3', default: 128, kind: 'plateau', help: 'layer_height_base' },
  height_modifier: { label: 'Modificador de altura', color: '#d2a8d8', default: 128, kind: 'modifier', help: 'layer_height_modifier' },
  water: { label: 'Agua', color: '#4d89c8', default: 0, kind: 'mask', help: 'layer_water' },
  reserved: { label: 'Zonas reservadas', color: '#d184d5', default: 0, kind: 'mask', help: 'layer_reserved' },
  materials: { label: 'Materiales', color: '#9cba76', default: 0, kind: 'material', help: 'layer_materials' },
  exclusion: { label: 'Exclusión decoración', color: '#cf6f6f', default: 0, kind: 'mask', help: 'layer_exclusion' },
  structures: { label: 'Estructuras', color: '#5fa86b', default: 0, kind: 'structures', help: 'layer_structures' },
};

const REGION_COLORS = [
  [0, 0, 0], [85, 142, 102], [93, 119, 171], [165, 111, 78], [128, 93, 157],
  [178, 155, 74], [69, 147, 151], [161, 86, 102], [103, 126, 77], [87, 103, 138],
  [146, 112, 65], [119, 82, 128], [67, 123, 112], [143, 78, 86], [115, 130, 156], [149, 139, 91],
];

const MATERIAL_OPTIONS = [
  ['0', 'Automático'], ['1', 'Césped'], ['2', 'Tierra'], ['3', 'Piedra'], ['4', 'Arena'], ['5', 'Nieve'], ['6', 'Grava'], ['7', 'Agua'],
];

const ACTIONS = {
  mask: [['add', 'Añadir'], ['erase', 'Borrar'], ['fill', 'Rellenar área']],
  category: [['paint', 'Pintar región'], ['erase', 'Borrar a 0'], ['fill', 'Rellenar área']],
  roads: [['primary', 'Camino principal'], ['secondary', 'Camino secundario'], ['erase', 'Borrar camino']],
  plateau: [['paint', 'Pintar meseta'], ['restore', 'Restaurar altura media']],
  modifier: [['raise', 'Elevar'], ['lower', 'Bajar'], ['reset', 'Volver a cero'], ['smooth', 'Suavizar']],
  material: [['paint', 'Pintar material'], ['erase', 'Volver a automático'], ['fill', 'Rellenar área']],
  structures: [],
};

const PRESET_GROUPS = {
  brush: {
    label: 'pincel', storageKey: 'jkr-terrain-presets-brush-v1',
    fields: [['plateau-tool-mode', 'value'], ['plateau-height', 'value'], ['plateau-radius', 'value'], ['plateau-slope-width', 'value'], ['plateau-support-enabled', 'checked'], ['plateau-support-width', 'value'], ['plateau-support-height', 'value'], ['plateau-action', 'value'], ['road-tool-mode', 'value'], ['road-ramp-type', 'value'], ['road-ramp-width', 'value'], ['road-ramp-shoulder', 'value'], ['road-ramp-ratio', 'value'], ['road-ramp-start-landing', 'value'], ['road-ramp-end-landing', 'value'], ['road-ramp-smooth-sides', 'checked'], ['road-ramp-side-ratio', 'value'], ['road-ramp-max-side-width', 'value'], ['road-ramp-side-roundness', 'value'], ['road-ramp-follow-terrain', 'checked'], ['water-tool-mode', 'value'], ['water-mass-action', 'value'], ['water-width', 'value'], ['water-depth', 'value'], ['water-shore-width', 'value'], ['water-shore-profile', 'value'], ['water-road-policy', 'value'], ['water-course-smoothing', 'value'], ['water-course-exit', 'checked'], ['structure-tool-mode', 'value'], ['structure-collection-select', 'value'], ['structure-brush-size', 'value'], ['structure-density', 'value'], ['structure-spacing', 'value'], ['structure-sink', 'value'], ['structure-random-rotation', 'checked'], ['structure-random-mirror', 'checked'], ['structure-avoid-water', 'checked'], ['structure-avoid-roads', 'checked'], ['structure-avoid-reserved', 'checked'], ['brush-size', 'value'], ['brush-core-mode', 'checked'], ['brush-core-radius', 'value'], ['brush-hardness', 'value'], ['elevation-profile-enabled', 'checked'], ['brush-slope-width', 'value'], ['brush-base-enabled', 'checked'], ['brush-base-width', 'value'], ['brush-base-intensity', 'value'], ['brush-profile-shape', 'value'], ['brush-terrace-steps', 'value'], ['brush-strict-clip', 'checked'], ['brush-opacity', 'value'], ['brush-strength', 'value'], ['brush-shape', 'value'], ['stroke-mode', 'value'], ['stroke-accumulation', 'checked']],
  },
  compilation: {
    label: 'compilación', storageKey: 'jkr-terrain-presets-compilation-v1',
    fields: [['modifier-range', 'value'], ['max-walk-slope', 'value'], ['surface-depth', 'value'], ['data-version', 'value']],
  },
  mountain: {
    label: 'borde montañoso', storageKey: 'jkr-terrain-presets-mountain-v1',
    fields: [['mountain-border-enabled', 'checked'], ['mountain-outer-width', 'value'], ['mountain-inner-transition', 'value'], ['mountain-height', 'value'], ['mountain-irregularity', 'value'], ['mountain-roughness', 'value'], ['mountain-exit-width', 'value'], ['mountain-exit-transition', 'value'], ['mountain-canvas-guide', 'checked']],
  },
};

function encodeRle(array) {
  if (!array.length) return [];
  const output = []; let value = array[0]; let count = 1;
  for (let index = 1; index < array.length; index += 1) {
    if (array[index] === value) count += 1;
    else { output.push(value, count); value = array[index]; count = 1; }
  }
  output.push(value, count); return output;
}

function decodeRle(data, expected) {
  const output = new Uint8Array(expected); let offset = 0;
  if (!Array.isArray(data) || data.length % 2) throw new Error('Capa RLE inválida.');
  for (let index = 0; index < data.length; index += 2) {
    const value = Number(data[index]); const count = Number(data[index + 1]);
    if (!Number.isInteger(value) || value < 0 || value > 255 || !Number.isInteger(count) || count <= 0 || offset + count > expected) throw new Error('Capa RLE inválida.');
    output.fill(value, offset, offset + count); offset += count;
  }
  if (offset !== expected) throw new Error('La capa no coincide con las dimensiones.');
  return output;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

class TerrainEditor {
  constructor(help) {
    this.help = help;
    this.canvas = $('terrain-canvas'); this.overlay = $('overlay-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false }); this.overlayCtx = this.overlay.getContext('2d');
    this.width = 256; this.length = 256; this.layers = {}; this.visibility = {}; this.locked = {};
    this.activeLayer = 'height_base'; this.undoStack = []; this.redoStack = []; this.maxHistory = 80;
    this.currentChanges = null; this.strokeBaseValues = null; this.strokeInfluence = null; this.pointerDown = false; this.lineStart = null; this.hover = null; this.renderQueued = false;
    this.markerTool = null; this.plateauPickHeight = false; this.markers = []; this.roadRamps = []; this.roadRampDraft = []; this.roadRampDraftKind = null; this.roadRampEditingId = null; this.selectedRoadRampId = null; this.waterCourses = []; this.waterCourseDraft = []; this.waterCourseEditingId = null; this.selectedWaterCourseId = null; this.waterCourseDrawing = false; this.massWaterSettings = null; this.riverWaterSettings = null; this.lastWaterMode = 'mass'; this.structureAssets = []; this.structureCollections = []; this.structurePlacements = []; this.libraryCollectionIds = new Set(); this.presetCache = { brush: {}, compilation: {}, mountain: {} }; this.structureDrawing = false; this.structureStrokeBefore = null; this.structureLastPoint = null; this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; this.dirty = true; this.compiledFiles = null; this.activePreview = 'preview';
    this.viewer3d = new Terrain3DViewer({
      canvas: $('terrain-3d-canvas'), status: $('terrain-3d-status'), scaleInput: $('terrain-3d-scale'), scaleValue: $('terrain-3d-scale-value'),
      wireframeInput: $('terrain-3d-wireframe'), resetButton: $('terrain-3d-reset'), expandButton: $('terrain-3d-expand'),
    });
    this.voxelViewer = new VoxelTerrainViewer({
      canvas: $('voxel-3d-canvas'), status: $('voxel-3d-status'), resetButton: $('voxel-3d-reset'), expandButton: $('voxel-3d-expand'),
      modeInput: $('voxel-3d-mode'), renderDistanceInput: $('voxel-render-distance'), renderDistanceValue: $('voxel-render-distance-value'),
      edgesInput: $('voxel-edges'), waterInput: $('voxel-water'), cutInput: $('voxel-cut-y'), cutValue: $('voxel-cut-y-value'),
    });
    $('stroke-accumulation').checked = readPreference('jkr-terrain-stroke-accumulation', 'false') === 'true';
    $('brush-core-mode').checked = readPreference('jkr-terrain-brush-core-mode', 'false') === 'true';
    $('brush-core-radius').value = readPreference('jkr-terrain-brush-core-radius', '6');
    $('elevation-profile-enabled').checked = readPreference('jkr-terrain-elevation-profile-enabled', 'false') === 'true';
    $('brush-base-enabled').checked = readPreference('jkr-terrain-brush-base-enabled', 'true') === 'true';
    $('brush-strict-clip').checked = readPreference('jkr-terrain-brush-strict-clip', 'true') === 'true';
    $('plateau-tool-mode').value = readPreference('jkr-terrain-plateau-tool-mode', 'plateau');
    $('plateau-height').value = readPreference('jkr-terrain-plateau-height', '72');
    $('plateau-radius').value = readPreference('jkr-terrain-plateau-radius', '19');
    $('plateau-slope-width').value = readPreference('jkr-terrain-plateau-slope-width', '8');
    $('plateau-support-enabled').checked = readPreference('jkr-terrain-plateau-support-enabled', 'false') === 'true';
    $('plateau-support-width').value = readPreference('jkr-terrain-plateau-support-width', '24');
    $('plateau-support-height').value = readPreference('jkr-terrain-plateau-support-height', '25');
    $('road-ramp-width').value = readPreference('jkr-terrain-road-ramp-width', '7');
    $('road-ramp-shoulder').value = readPreference('jkr-terrain-road-ramp-shoulder', '5');
    $('road-ramp-ratio').value = readPreference('jkr-terrain-road-ramp-ratio', '3');
    $('road-ramp-start-landing').value = readPreference('jkr-terrain-road-ramp-start-landing', '4');
    $('road-ramp-end-landing').value = readPreference('jkr-terrain-road-ramp-end-landing', '5');
    $('road-ramp-smooth-sides').checked = readPreference('jkr-terrain-road-ramp-smooth-sides', 'true') === 'true';
    $('road-ramp-side-ratio').value = readPreference('jkr-terrain-road-ramp-side-ratio', '2');
    $('road-ramp-max-side-width').value = readPreference('jkr-terrain-road-ramp-max-side-width', '24');
    $('road-ramp-side-roundness').value = readPreference('jkr-terrain-road-ramp-side-roundness', '65');
    $('road-ramp-follow-terrain').checked = readPreference('jkr-terrain-road-ramp-follow-terrain', 'true') === 'true';
    $('water-tool-mode').value = readPreference('jkr-terrain-water-tool-mode', 'mass');
    $('water-mass-action').value = readPreference('jkr-terrain-water-mass-action', 'paint');
    $('water-width').value = readPreference('jkr-terrain-water-width', '10');
    $('water-depth').value = readPreference('jkr-terrain-water-depth', '3');
    $('water-shore-width').value = readPreference('jkr-terrain-water-shore-width', '6');
    $('water-shore-profile').value = readPreference('jkr-terrain-water-shore-profile', 'natural');
    $('water-road-policy').value = readPreference('jkr-terrain-water-road-policy', 'protect');
    $('water-course-smoothing').value = readPreference('jkr-terrain-water-course-smoothing', '60');
    $('water-course-exit').checked = readPreference('jkr-terrain-water-course-exit', 'false') === 'true';
    $('structure-tool-mode').value = readPreference('jkr-terrain-structure-tool-mode', 'populate');
    $('structure-brush-size').value = readPreference('jkr-terrain-structure-brush-size', '60');
    $('structure-density').value = readPreference('jkr-terrain-structure-density', '100');
    $('structure-spacing').value = readPreference('jkr-terrain-structure-spacing', '4');
    $('structure-sink').value = readPreference('jkr-terrain-structure-sink', '1');
    $('structure-random-rotation').checked = readPreference('jkr-terrain-structure-random-rotation', 'true') === 'true';
    $('structure-random-mirror').checked = readPreference('jkr-terrain-structure-random-mirror', 'false') === 'true';
    $('structure-avoid-water').checked = readPreference('jkr-terrain-structure-avoid-water', 'true') === 'true';
    $('structure-avoid-roads').checked = readPreference('jkr-terrain-structure-avoid-roads', 'true') === 'true';
    $('structure-avoid-reserved').checked = readPreference('jkr-terrain-structure-avoid-reserved', 'true') === 'true';
    this.massWaterSettings = this.captureWaterControlSettings('mass'); this.riverWaterSettings = this.captureWaterControlSettings('river'); this.lastWaterMode = $('water-tool-mode').value;
    this.initializeLayers(); this.buildLayerList(); this.bind(); this.initializePresetManagers(); this.updateLayerControls(); this.updateBrushProfileUi(); this.applyZoom(); this.render(); this.updateVoxelBudget(); this.updateMountainUi();
    this.loadStructureLibrary({ merge: false }).catch((error) => this.setLibraryStatus(`Sin conexión: ${error.message}`, true));
  }

  initializeLayers() {
    const size = this.width * this.length;
    for (const [name, meta] of Object.entries(LAYERS)) {
      this.layers[name] = new Uint8Array(size); this.layers[name].fill(meta.default);
      this.visibility[name] = true; this.locked[name] = false;
    }
  }

  buildLayerList() {
    const list = $('layer-list'); list.replaceChildren();
    for (const [name, meta] of Object.entries(LAYERS)) {
      const row = document.createElement('div'); row.className = `layer-row${name === this.activeLayer ? ' active' : ''}`; row.dataset.layer = name;
      const eye = document.createElement('button'); eye.textContent = this.visibility[name] ? '👁' : '—'; eye.title = 'Mostrar u ocultar capa';
      eye.addEventListener('click', (event) => { event.stopPropagation(); this.visibility[name] = !this.visibility[name]; eye.textContent = this.visibility[name] ? '👁' : '—'; this.render(); });
      const swatch = document.createElement('span'); swatch.className = 'layer-color'; swatch.style.background = meta.color;
      const label = document.createElement('span'); label.className = 'layer-name'; label.textContent = meta.label;
      const helpButton = document.createElement('button'); helpButton.className = 'help-button layer-help'; helpButton.textContent = '?'; this.help?.attach(helpButton, meta.help);
      const lock = document.createElement('button'); lock.className = 'lock'; lock.textContent = this.locked[name] ? '●' : '○'; lock.title = 'Bloquear capa';
      lock.addEventListener('click', (event) => { event.stopPropagation(); this.locked[name] = !this.locked[name]; lock.textContent = this.locked[name] ? '●' : '○'; });
      row.append(eye, swatch, label, helpButton, lock); row.addEventListener('click', () => this.setActiveLayer(name)); list.append(row);
    }
  }

  bind() {
    this.overlay.addEventListener('pointerdown', (event) => this.pointerStart(event));
    this.overlay.addEventListener('pointermove', (event) => this.pointerMove(event));
    this.overlay.addEventListener('pointerup', (event) => this.pointerEnd(event));
    this.overlay.addEventListener('pointercancel', (event) => this.pointerEnd(event));
    this.overlay.addEventListener('pointerleave', () => { if (!this.pointerDown) { this.hover = null; this.renderOverlay(); } });
    this.overlay.addEventListener('contextmenu', (event) => event.preventDefault());

    $('undo').addEventListener('click', () => this.undo()); $('redo').addEventListener('click', () => this.redo());
    $('clear-layer').addEventListener('click', () => this.clearLayer()); $('show-all').addEventListener('click', () => this.showAll());
    $('zoom').addEventListener('input', () => this.applyZoom()); $('grid-toggle').addEventListener('change', () => this.renderOverlay());
    $('view-mode').addEventListener('change', () => this.render());
    $('brush-action').addEventListener('change', () => this.updateValueOptions());
    $('dimension-preset').addEventListener('change', () => this.applyPreset()); $('apply-dimensions').addEventListener('click', () => this.resizeFromInputs());
    $('randomize-seed').addEventListener('click', () => this.randomizeSeed());
    $('stroke-accumulation').addEventListener('change', () => writePreference('jkr-terrain-stroke-accumulation', String($('stroke-accumulation').checked)));
    $('brush-core-mode').addEventListener('change', () => { writePreference('jkr-terrain-brush-core-mode', String($('brush-core-mode').checked)); this.updateBrushProfileUi(); this.renderOverlay(); });
    $('brush-core-radius').addEventListener('input', () => { writePreference('jkr-terrain-brush-core-radius', $('brush-core-radius').value); this.updateBrushProfileUi(); this.renderOverlay(); });
    $('brush-size').addEventListener('input', () => { this.updateBrushProfileUi(); this.renderOverlay(); });
    $('brush-hardness').addEventListener('input', () => { this.updateBrushProfileUi(); this.renderOverlay(); });
    $('elevation-profile-enabled').addEventListener('change', () => { writePreference('jkr-terrain-elevation-profile-enabled', String($('elevation-profile-enabled').checked)); this.updateBrushProfileUi(); this.renderOverlay(); });
    $('brush-base-enabled').addEventListener('change', () => { writePreference('jkr-terrain-brush-base-enabled', String($('brush-base-enabled').checked)); this.updateBrushProfileUi(); this.renderOverlay(); });
    $('brush-strict-clip').addEventListener('change', () => writePreference('jkr-terrain-brush-strict-clip', String($('brush-strict-clip').checked)));
    for (const id of ['plateau-height', 'plateau-radius', 'plateau-slope-width', 'plateau-support-width', 'plateau-support-height']) $(id).addEventListener('input', () => { writePreference(`jkr-terrain-${id}`, $(id).value); this.updatePlateauUi(); this.renderOverlay(); });
    $('plateau-support-enabled').addEventListener('change', () => { writePreference('jkr-terrain-plateau-support-enabled', String($('plateau-support-enabled').checked)); this.updatePlateauUi(); this.renderOverlay(); });
    $('plateau-action').addEventListener('change', () => { this.updatePlateauUi(); this.renderOverlay(); });
    $('plateau-tool-mode').addEventListener('change', () => { writePreference('jkr-terrain-plateau-tool-mode', $('plateau-tool-mode').value); this.cancelRoadRampDraft(); this.updateLayerControls(); this.renderOverlay(); });
    $('plateau-pick-height').addEventListener('click', () => this.togglePlateauHeightPicker());
    $('road-tool-mode').addEventListener('change', () => { this.cancelRoadRampDraft(); this.updateLayerControls(); this.renderOverlay(); });
    for (const id of ['road-ramp-width', 'road-ramp-shoulder', 'road-ramp-ratio', 'road-ramp-start-landing', 'road-ramp-end-landing', 'road-ramp-side-ratio', 'road-ramp-max-side-width', 'road-ramp-side-roundness']) {
      $(id).addEventListener('input', () => { writePreference(`jkr-terrain-${id}`, $(id).value); this.updateRoadRampUi(); this.renderOverlay(); });
    }
    for (const id of ['road-ramp-smooth-sides', 'road-ramp-follow-terrain']) {
      $(id).addEventListener('change', () => { writePreference(`jkr-terrain-${id}`, String($(id).checked)); this.updateRoadRampUi(); this.renderOverlay(); });
    }
    $('road-ramp-type').addEventListener('change', () => { this.updateRoadRampUi(); this.renderOverlay(); });
    $('road-ramp-label').addEventListener('input', () => this.updateRoadRampUi());
    $('road-ramp-finish').addEventListener('click', () => this.finishRoadRampDraft());
    $('road-ramp-undo-point').addEventListener('click', () => this.removeRoadRampPoint());
    $('road-ramp-cancel').addEventListener('click', () => this.cancelRoadRampDraft());
    $('water-tool-mode').addEventListener('change', () => { const nextMode = $('water-tool-mode').value; this.rememberWaterControlSettings(this.lastWaterMode); this.lastWaterMode = nextMode; this.applyWaterControlSettings(nextMode === 'mass' ? this.massWaterSettings : this.riverWaterSettings); writePreference('jkr-terrain-water-tool-mode', nextMode); this.cancelWaterCourseDraft(); this.updateLayerControls(); this.renderOverlay(); });
    $('water-mass-action').addEventListener('change', () => { writePreference('jkr-terrain-water-mass-action', $('water-mass-action').value); this.rememberWaterControlSettings('mass'); this.updateWaterUi(); this.renderOverlay(); });
    for (const id of ['water-width', 'water-depth', 'water-shore-width', 'water-course-smoothing']) $(id).addEventListener('input', () => { writePreference(`jkr-terrain-${id}`, $(id).value); this.rememberWaterControlSettings($('water-tool-mode').value); this.updateWaterUi(); this.renderOverlay(); });
    for (const id of ['water-shore-profile', 'water-road-policy']) $(id).addEventListener('change', () => { writePreference(`jkr-terrain-${id}`, $(id).value); this.rememberWaterControlSettings($('water-tool-mode').value); this.updateWaterUi(); this.renderOverlay(); });
    $('water-course-exit').addEventListener('change', () => { writePreference('jkr-terrain-water-course-exit', String($('water-course-exit').checked)); this.rememberWaterControlSettings('river'); this.updateWaterUi(); this.renderOverlay(); });
    $('structure-tool-mode').addEventListener('change', () => { writePreference('jkr-terrain-structure-tool-mode', $('structure-tool-mode').value); this.updateStructureUi(); this.renderOverlay(); });
    $('structure-collection-select').addEventListener('change', () => { this.renderStructureAssets(); this.updateStructureUi(); this.renderOverlay(); });
    for (const id of ['structure-brush-size', 'structure-density', 'structure-spacing', 'structure-sink']) $(id).addEventListener('input', () => { writePreference(`jkr-terrain-${id}`, $(id).value); this.updateStructureUi(); this.renderOverlay(); });
    for (const id of ['structure-random-rotation', 'structure-random-mirror', 'structure-avoid-water', 'structure-avoid-roads', 'structure-avoid-reserved']) $(id).addEventListener('change', () => { writePreference(`jkr-terrain-${id}`, String($(id).checked)); this.updateStructureUi(); this.renderOverlay(); });
    $('structure-collection-create').addEventListener('click', () => this.createStructureCollection());
    $('structure-delete-collection').addEventListener('click', () => this.deleteStructureCollection());
    $('structure-import-files').addEventListener('change', (event) => this.importStructureFiles(event));
    $('water-course-label').addEventListener('input', () => this.updateWaterUi());
    $('water-course-apply').addEventListener('click', () => this.applyWaterCourseEdits());
    $('water-course-cancel').addEventListener('click', () => this.cancelWaterCourseDraft());
    for (const id of ['brush-slope-width', 'brush-base-width', 'brush-base-intensity', 'brush-profile-shape', 'brush-terrace-steps']) $(id).addEventListener('input', () => { this.updateBrushProfileUi(); this.renderOverlay(); });
    $('new-project').addEventListener('click', () => this.newProject()); $('save-project').addEventListener('click', () => this.saveProject());
    $('load-project').addEventListener('change', (event) => this.loadProject(event));
    $('compile-preview').addEventListener('click', () => this.compile(false)); $('export-schematic').addEventListener('click', () => this.compile(true));
    $('mountain-border-enabled').addEventListener('change', () => { this.updateMountainUi(); this.markDirty(); this.renderOverlay(); });
    $('mountain-canvas-guide').addEventListener('change', () => this.renderOverlay());
    $('prepare-mountain-margin').addEventListener('click', () => this.prepareMountainMargin());
    document.querySelectorAll('[data-marker-tool]').forEach((button) => button.addEventListener('click', () => this.setMarkerTool(button.dataset.markerTool)));
    $('marker-select').addEventListener('click', () => this.setMarkerTool('select'));
    document.querySelectorAll('[data-preview]').forEach((button) => button.addEventListener('click', () => this.selectPreview(button.dataset.preview)));

    for (const id of ['width', 'length', 'schematic-height', 'min-height', 'max-height', 'sea-level']) $(id).addEventListener('input', () => { this.updateVoxelBudget(); this.updatePlateauUi(); });
    for (const id of ['project-name', 'seed', 'schematic-height', 'min-height', 'max-height', 'sea-level', 'modifier-range', 'max-walk-slope', 'surface-depth', 'data-version', 'mountain-outer-width', 'mountain-inner-transition', 'mountain-height', 'mountain-irregularity', 'mountain-roughness', 'mountain-exit-width', 'mountain-exit-transition']) $(id).addEventListener('input', () => { this.markDirty(); this.updateMountainUi(); this.renderOverlay(); });
    document.addEventListener('keydown', (event) => {
      const editable = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (!editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); }
      if (!editable && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); }
      if (event.key === 'Escape') { this.setMarkerTool(null); this.cancelPlateauHeightPicker(); this.cancelRoadRampDraft(); this.cancelWaterCourseDraft(); this.cancelStructureStroke(); }
    });
  }

  setActiveLayer(name) {
    if (!LAYERS[name]) return;
    const targetRampKind = name === 'roads' ? 'road' : name === 'height_base' ? 'terrain' : null;
    if (this.roadRampDraft.length && targetRampKind !== this.roadRampDraftKind) this.cancelRoadRampDraft();
    if (name !== 'water') this.cancelWaterCourseDraft();
    if (name !== 'structures') this.cancelStructureStroke();
    this.activeLayer = name; this.markerTool = null; this.cancelPlateauHeightPicker();
    document.querySelectorAll('.layer-row').forEach((row) => row.classList.toggle('active', row.dataset.layer === name));
    document.querySelectorAll('.marker-tools button').forEach((button) => button.classList.remove('active'));
    $('active-layer-title').textContent = LAYERS[name].label; this.updateLayerControls(); this.render();
  }

  activeRampKind() {
    if (this.activeLayer === 'roads' && $('road-tool-mode').value === 'ramp') return 'road';
    if (this.activeLayer === 'height_base' && $('plateau-tool-mode').value === 'ramp') return 'terrain';
    return null;
  }

  syncRampEditorHost() {
    const fields = $('road-ramp-fields');
    const kind = this.activeRampKind();
    const host = kind === 'terrain' ? $('plateau-ramp-host') : $('road-ramp-host');
    if (fields && host && fields.parentElement !== host) host.append(fields);
  }

  updateLayerControls() {
    const kind = LAYERS[this.activeLayer].kind;
    const plateauLayer = kind === 'plateau';
    const roadLayer = kind === 'roads';
    const waterLayer = this.activeLayer === 'water';
    const structureLayer = kind === 'structures';
    const rampKind = this.activeRampKind();
    const rampMode = Boolean(rampKind);
    const plateauBrushMode = plateauLayer && !rampMode;

    $('brush-panel-title').textContent = rampKind === 'terrain' ? 'Rampa de meseta' : plateauLayer ? 'Herramientas de altura base' : roadLayer ? 'Herramientas de camino' : waterLayer ? 'Herramienta de agua' : structureLayer ? 'Pincel de estructuras' : 'Pincel';
    $('plateau-tool-panel').hidden = !plateauLayer;
    $('plateau-brush-fields').hidden = !plateauBrushMode;
    $('road-ramp-panel').hidden = !roadLayer;
    $('water-tool-panel').hidden = !waterLayer;
    $('structure-tool-panel').hidden = !structureLayer;
    $('standard-brush-panel').hidden = plateauLayer || rampMode || waterLayer || structureLayer;
    this.syncRampEditorHost();
    $('road-ramp-fields').hidden = !rampMode;

    const action = $('brush-action'); action.replaceChildren();
    for (const [value, label] of ACTIONS[kind]) { const option = document.createElement('option'); option.value = value; option.textContent = label; action.append(option); }
    if (plateauLayer || waterLayer) $('stroke-mode').value = 'free';
    this.updateValueOptions(); this.updateBrushProfileUi(); this.updatePlateauUi(); this.updateRoadRampUi(); this.updateWaterUi(); this.updateStructureUi();
  }

  updateValueOptions() {
    const kind = LAYERS[this.activeLayer].kind; const select = $('paint-value'); const field = $('value-field'); select.replaceChildren();
    let options = [];
    if (kind === 'category') options = Array.from({ length: 15 }, (_, index) => [String(index + 1), `Región ${index + 1}`]);
    else if (kind === 'material') options = MATERIAL_OPTIONS;
    for (const [value, label] of options) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
    field.hidden = !['category', 'material'].includes(kind) || !['paint', 'fill'].includes($('brush-action').value);
    $('stroke-accumulation-field').hidden = kind !== 'modifier';
  }

  updatePlateauUi() {
    if (!$('plateau-height')) return;
    const settings = normalizePlateauSettings({
      targetHeight: $('plateau-height').value,
      plateauRadius: $('plateau-radius').value,
      slopeWidth: $('plateau-slope-width').value,
      supportEnabled: $('plateau-support-enabled').checked,
      supportWidth: $('plateau-support-width').value,
      supportHeightPercent: $('plateau-support-height').value,
      minHeight: $('min-height').value,
      maxHeight: $('max-height').value,
    });
    const heightInput = $('plateau-height'); heightInput.min = String(settings.minHeight); heightInput.max = String(settings.maxHeight); heightInput.value = String(Math.round(settings.targetHeight));
    $('plateau-radius').value = String(Math.round(settings.plateauRadius * 10) / 10);
    $('plateau-slope-width').max = String(Math.max(0, 1024 - settings.plateauRadius)); $('plateau-slope-width').value = String(Math.round(settings.slopeWidth * 10) / 10);
    $('plateau-support-width').max = String(Math.max(0, 1024 - settings.slopeEndRadius)); $('plateau-support-width').value = String(Math.max(1, Math.round((settings.supportWidth || Number($('plateau-support-width').value) || 24) * 10) / 10));
    $('plateau-support-height').value = String(Math.max(1, Math.round((settings.supportHeightPercent || Number($('plateau-support-height').value) || 25) * 10) / 10));
    const supportRequested = $('plateau-support-enabled').checked;
    $('plateau-support-fields').hidden = !supportRequested; $('plateau-support-legend').hidden = !settings.supportEnabled;
    const ramping = $('plateau-tool-mode').value === 'ramp'; const restoring = $('plateau-action').value === 'restore'; heightInput.disabled = restoring || ramping; $('plateau-pick-height').disabled = restoring || ramping;
    const effectiveHeight = restoring ? layerValueToHeight(128, settings.minHeight, settings.maxHeight) : Math.round(settings.targetHeight);
    const baseText = `Altura Y ${effectiveHeight} · meseta ${settings.plateauRadius.toFixed(1)} de radio · pendiente ${settings.slopeWidth.toFixed(1)} · final de pendiente ${settings.slopeEndRadius.toFixed(1)}.`;
    const supportText = settings.supportEnabled
      ? ` Soporte exterior: ${settings.supportWidth.toFixed(1)} bloques, altura ${settings.supportHeightPercent.toFixed(0)}%, radio total ${settings.radius.toFixed(1)}.`
      : ' Sin soporte exterior: fuera del círculo blanco no se levanta el terreno.';
    $('plateau-tool-info').textContent = baseText + supportText;
  }

  plateauSettings() {
    const normalized = normalizePlateauSettings({
      targetHeight: $('plateau-height').value,
      plateauRadius: $('plateau-radius').value,
      slopeWidth: $('plateau-slope-width').value,
      supportEnabled: $('plateau-support-enabled').checked,
      supportWidth: $('plateau-support-width').value,
      supportHeightPercent: $('plateau-support-height').value,
      minHeight: $('min-height').value,
      maxHeight: $('max-height').value,
    });
    const action = $('plateau-action').value;
    return { ...normalized, action, targetValue: action === 'restore' ? 128 : heightToLayerValue(normalized.targetHeight, normalized.minHeight, normalized.maxHeight) };
  }

  togglePlateauHeightPicker() {
    if (this.activeLayer !== 'height_base' || $('plateau-tool-mode').value === 'ramp' || $('plateau-action').value === 'restore') return;
    this.markerTool = null; document.querySelectorAll('.marker-tools button').forEach((button) => button.classList.remove('active'));
    this.plateauPickHeight = !this.plateauPickHeight; $('plateau-pick-height').classList.toggle('active', this.plateauPickHeight);
    this.overlay.style.cursor = this.plateauPickHeight ? 'cell' : 'crosshair';
    this.message(this.plateauPickHeight ? 'Haz clic sobre el terreno para copiar su altura base.' : 'Muestreo de altura cancelado.'); this.renderOverlay();
  }

  cancelPlateauHeightPicker() {
    if (!this.plateauPickHeight) return;
    this.plateauPickHeight = false; $('plateau-pick-height')?.classList.remove('active');
    if (!this.markerTool) this.overlay.style.cursor = 'crosshair'; this.renderOverlay();
  }

  samplePlateauHeight(point) {
    const value = this.layers.height_base[point.z * this.width + point.x];
    const height = layerValueToHeight(value, Number($('min-height').value), Number($('max-height').value));
    $('plateau-height').value = String(height); $('plateau-height').dispatchEvent(new Event('input', { bubbles: true }));
    this.plateauPickHeight = false; $('plateau-pick-height').classList.remove('active'); this.overlay.style.cursor = 'crosshair';
    this.message(`Altura base Y ${height} tomada desde X ${point.x}, Z ${point.z}.`); this.renderOverlay();
  }

  roadRampSettings(kind = this.activeRampKind() || this.roadRampDraftKind || 'road') {
    return {
      ...normalizeRoadRampSettings({
        roadType: $('road-ramp-type').value,
        width: $('road-ramp-width').value,
        shoulderWidth: $('road-ramp-shoulder').value,
        slopeRatio: $('road-ramp-ratio').value,
        startLanding: $('road-ramp-start-landing').value,
        endLanding: $('road-ramp-end-landing').value,
        smoothSides: $('road-ramp-smooth-sides').checked,
        sideSlopeRatio: $('road-ramp-side-ratio').value,
        maxSideWidth: $('road-ramp-max-side-width').value,
        sideRoundness: $('road-ramp-side-roundness').value,
        followTerrain: $('road-ramp-follow-terrain').checked,
      }),
      kind,
    };
  }

  sourceHeightAt(point) {
    const x = clamp(Math.round(point.x), 0, this.width - 1); const z = clamp(Math.round(point.z), 0, this.length - 1); const index = z * this.width + x;
    const minHeight = Number($('min-height').value); const maxHeight = Number($('max-height').value); const modifierRange = Number($('modifier-range').value);
    const base = minHeight + this.layers.height_base[index] / 255 * (maxHeight - minHeight);
    const modifier = (this.layers.height_modifier[index] - 128) / 127 * modifierRange;
    return clamp(base + modifier, minHeight, maxHeight);
  }

  roadRampAnalysis(points = this.roadRampDraft) {
    return analyzeRoadRamp(points, this.roadRampSettings(), (point) => this.sourceHeightAt(point));
  }

  updateRoadRampUi() {
    if (!$('road-ramp-fields')) return;
    const kind = this.activeRampKind();
    const active = Boolean(kind);
    this.syncRampEditorHost();
    $('road-ramp-fields').hidden = !active;
    if ($('road-ramp-type-field')) $('road-ramp-type-field').hidden = kind === 'terrain';
    if ($('ramp-guide-text')) $('ramp-guide-text').textContent = kind === 'terrain'
      ? 'La rampa de meseta modifica únicamente el relieve. No crea ni cambia caminos o materiales viales.'
      : 'La rampa vial modifica el relieve y pinta un camino dentro del corredor central.';
    if ($('road-ramp-list-heading')) $('road-ramp-list-heading').textContent = kind === 'terrain' ? 'Rampas de meseta guardadas' : 'Rampas viales guardadas';
    if ($('road-ramp-label')) $('road-ramp-label').placeholder = kind === 'terrain' ? 'Ej.: Bajada de meseta norte' : 'Ej.: Acceso norte';
    if (!active) { this.renderRoadRampList(); return; }
    const analysis = this.roadRampAnalysis(); const count = this.roadRampDraft.length;
    $('road-ramp-smoothing-fields').hidden = !analysis.settings.smoothSides;
    $('road-ramp-undo-point').disabled = count === 0;
    $('road-ramp-cancel').disabled = count === 0 && !this.roadRampEditingId;
    $('road-ramp-finish').disabled = !analysis.valid;
    if (count === 0) $('road-ramp-info').textContent = kind === 'terrain'
      ? 'Haz clic en el terreno bajo, sigue el recorrido y termina sobre la meseta. No se pintará ningún camino.'
      : 'Haz clic en el terreno bajo, añade puntos siguiendo el recorrido y termina sobre la meseta.';
    else if (count === 1) $('road-ramp-info').textContent = `Inicio Y ${analysis.startHeight?.toFixed?.(1) ?? this.sourceHeightAt(this.roadRampDraft[0]).toFixed(1)} · añade el punto final o puntos intermedios.`;
    else {
      const actual = Number.isFinite(analysis.actualRatio) ? `1:${analysis.actualRatio.toFixed(2)}` : 'plana';
      const state = analysis.valid ? 'Válida' : `No válida: requiere ${analysis.requiredLength.toFixed(1)} bloques`;
      const sides = analysis.settings.smoothSides ? ` · costados suaves hasta ${analysis.estimatedSideWidth.toFixed(1)} bloques` : ` · transición fija ${analysis.settings.shoulderWidth}`;
      const material = kind === 'terrain' ? ' · sin camino' : ` · camino ${analysis.settings.roadType === 'secondary' ? 'secundario' : 'principal'}`;
      $('road-ramp-info').textContent = `${state} · recorrido ${analysis.length.toFixed(1)} · Y ${analysis.startHeight.toFixed(1)} → ${analysis.endHeight.toFixed(1)} · desnivel ${analysis.heightDifference.toFixed(1)} · pendiente real ${actual}${sides}${material}.`;
    }
    this.renderRoadRampList();
  }

  addRoadRampPoint(point) {
    const kind = this.activeRampKind();
    if (!kind) return;
    const layer = kind === 'terrain' ? 'height_base' : 'roads';
    if (this.locked[layer]) { this.message(`La capa ${LAYERS[layer].label} está bloqueada.`); return; }
    if (!this.roadRampDraft.length) this.roadRampDraftKind = kind;
    if (this.roadRampDraftKind !== kind) this.cancelRoadRampDraft(false);
    this.roadRampDraftKind = kind;
    const next = { x: point.x, z: point.z };
    const previous = this.roadRampDraft.at(-1);
    if (previous && Math.hypot(previous.x - next.x, previous.z - next.z) < 1) { this.message('El nuevo punto debe estar separado del anterior.', true); return; }
    if (this.roadRampDraft.length >= 64) { this.message('Una rampa admite como máximo 64 puntos.', true); return; }
    this.roadRampDraft.push(next); this.updateRoadRampUi(); this.renderOverlay();
    this.message(this.roadRampDraft.length === 1 ? 'Inicio fijado. Continúa haciendo clic hasta llegar a la meseta.' : `Punto ${this.roadRampDraft.length} añadido. Finaliza cuando el estado sea válido.`);
  }

  removeRoadRampPoint() {
    if (!this.roadRampDraft.length) return; this.roadRampDraft.pop(); if (!this.roadRampDraft.length) this.roadRampDraftKind = this.activeRampKind(); this.updateRoadRampUi(); this.renderOverlay();
  }

  cancelRoadRampDraft(render = true) {
    this.roadRampDraft = []; this.roadRampDraftKind = null; this.roadRampEditingId = null; if ($('road-ramp-label')) $('road-ramp-label').value = ''; if (render) { this.updateRoadRampUi(); this.renderOverlay(); }
  }

  finishRoadRampDraft() {
    const kind = this.roadRampDraftKind || this.activeRampKind();
    const analysis = this.roadRampAnalysis();
    if (!kind || !analysis.valid) { this.message(analysis.reason || 'La rampa no tiene longitud suficiente.', true); return; }
    const settings = analysis.settings; const before = structuredClone(this.roadRamps); const editingId = this.roadRampEditingId;
    const current = editingId ? this.roadRamps.find((ramp) => ramp.id === editingId) : null;
    const id = current?.id || createRoadRampId();
    const sameKind = this.roadRamps.filter((item) => (item.kind || 'road') === kind);
    const fallbackName = `${kind === 'terrain' ? 'Rampa de meseta' : 'Rampa vial'} ${editingId ? Math.max(1, sameKind.findIndex((item) => item.id === editingId) + 1) : sameKind.length + 1}`;
    const ramp = {
      kind, id, label: $('road-ramp-label').value.trim().slice(0, 80) || current?.label || fallbackName,
      road_type: kind === 'road' ? settings.roadType : 'primary', points: structuredClone(this.roadRampDraft), width: settings.width,
      shoulder_width: settings.shoulderWidth, slope_ratio: settings.slopeRatio,
      start_landing: settings.startLanding, end_landing: settings.endLanding,
      smooth_sides: settings.smoothSides, side_slope_ratio: settings.sideSlopeRatio,
      max_side_width: settings.maxSideWidth, side_roundness: settings.sideRoundness,
      follow_terrain: settings.followTerrain,
    };
    if (editingId) this.roadRamps = this.roadRamps.map((item) => item.id === editingId ? ramp : item); else this.roadRamps.push(ramp);
    this.selectedRoadRampId = id; this.roadRampDraft = []; this.roadRampDraftKind = null; this.roadRampEditingId = null; $('road-ramp-label').value = '';
    this.pushHistory({ type: 'roadRamps', before, after: structuredClone(this.roadRamps) }); this.renderRoadRampList(); this.updateRoadRampUi(); this.renderOverlay();
    this.message(`${editingId ? 'Rampa actualizada' : 'Rampa creada'}: ${ramp.label}${kind === 'terrain' ? ' · relieve sin camino' : ''}. Compila la vista para comprobar el resultado.`);
  }

  editRoadRamp(id) {
    const ramp = this.roadRamps.find((item) => item.id === id); if (!ramp) return;
    const kind = ramp.kind || 'road';
    this.cancelRoadRampDraft(false);
    if (kind === 'terrain') {
      this.setActiveLayer('height_base'); $('plateau-tool-mode').value = 'ramp'; $('plateau-tool-mode').dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      this.setActiveLayer('roads'); $('road-tool-mode').value = 'ramp'; $('road-tool-mode').dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.selectedRoadRampId = id; this.roadRampEditingId = id; this.roadRampDraftKind = kind; this.roadRampDraft = structuredClone(ramp.points);
    $('road-ramp-label').value = ramp.label || '';
    $('road-ramp-type').value = ramp.road_type || 'primary'; $('road-ramp-width').value = ramp.width; $('road-ramp-shoulder').value = ramp.shoulder_width;
    $('road-ramp-ratio').value = ramp.slope_ratio; $('road-ramp-start-landing').value = ramp.start_landing; $('road-ramp-end-landing').value = ramp.end_landing;
    $('road-ramp-smooth-sides').checked = Boolean(ramp.smooth_sides); $('road-ramp-side-ratio').value = ramp.side_slope_ratio ?? 2;
    $('road-ramp-max-side-width').value = ramp.max_side_width ?? 24; $('road-ramp-side-roundness').value = ramp.side_roundness ?? 65;
    $('road-ramp-follow-terrain').checked = ramp.follow_terrain !== false;
    this.updateLayerControls(); this.renderOverlay(); this.message(`${kind === 'terrain' ? 'Rampa de meseta' : 'Rampa vial'} cargada para edición. Puedes quitar o agregar puntos y finalizar para reemplazarla.`);
  }

  deleteRoadRamp(id) {
    const ramp = this.roadRamps.find((item) => item.id === id); if (!ramp || !confirm(`¿Eliminar la rampa «${ramp.label || ramp.id}»?`)) return;
    const before = structuredClone(this.roadRamps); this.roadRamps = this.roadRamps.filter((item) => item.id !== id); if (this.roadRampEditingId === id) this.cancelRoadRampDraft(false); if (this.selectedRoadRampId === id) this.selectedRoadRampId = null;
    this.pushHistory({ type: 'roadRamps', before, after: structuredClone(this.roadRamps) }); this.renderRoadRampList(); this.renderOverlay();
  }

  renderRoadRampList() {
    const list = $('road-ramp-list'); if (!list) return; list.replaceChildren();
    const kind = this.activeRampKind() || (this.activeLayer === 'height_base' ? 'terrain' : 'road');
    const ramps = this.roadRamps.filter((item) => (item.kind || 'road') === kind);
    if (!ramps.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = kind === 'terrain' ? 'Aún no hay rampas de meseta.' : 'Aún no hay rampas viales.'; list.append(empty); return; }
    for (const ramp of ramps) {
      const item = document.createElement('div'); item.className = `road-ramp-item${ramp.id === this.selectedRoadRampId ? ' selected' : ''}`;
      const content = document.createElement('button'); content.type = 'button'; content.className = 'road-ramp-select'; content.addEventListener('click', () => { this.selectedRoadRampId = ramp.id; this.renderRoadRampList(); this.renderOverlay(); });
      const title = document.createElement('strong'); title.textContent = ramp.label || ramp.id; const meta = document.createElement('small');
      const sideMeta = ramp.smooth_sides ? `suave 1:${ramp.side_slope_ratio ?? 2}, máx. ${ramp.max_side_width ?? 24}` : `lateral fijo ${ramp.shoulder_width}`;
      const typeMeta = kind === 'terrain' ? 'Relieve sin camino' : ramp.road_type === 'primary' ? 'Principal' : 'Secundario';
      meta.textContent = `${typeMeta} · ancho ${ramp.width} · ${sideMeta} · subida 1:${ramp.slope_ratio} · ${ramp.points.length} puntos`;
      content.append(title, meta); const actions = document.createElement('div'); actions.className = 'road-ramp-item-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editar'; edit.addEventListener('click', () => this.editRoadRamp(ramp.id));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'; remove.className = 'danger-soft'; remove.addEventListener('click', () => this.deleteRoadRamp(ramp.id));
      actions.append(edit, remove); item.append(content, actions); list.append(item);
    }
  }

  drawRoadRampPath(ctx, points, settings, selected = false, draft = false) {
    if (!points?.length) return; const pathPoints = [...points];
    if (draft && this.hover && pathPoints.length) pathPoints.push({ x: this.hover.x, z: this.hover.z });
    if (pathPoints.length < 2) {
      ctx.save(); ctx.fillStyle = settings.kind === 'terrain' ? '#75d8cf' : '#70dc91'; ctx.beginPath(); ctx.arc(pathPoints[0].x, pathPoints[0].z, Math.max(1.5, settings.width * .2), 0, Math.PI * 2); ctx.fill(); ctx.restore(); return;
    }
    const trace = () => { ctx.beginPath(); ctx.moveTo(pathPoints[0].x, pathPoints[0].z); for (const point of pathPoints.slice(1)) ctx.lineTo(point.x, point.z); };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (draft) ctx.setLineDash([Math.max(2, this.width / 256), Math.max(1.5, this.width / 384)]);
    const previewSideWidth = settings.smoothSides ? settings.maxSideWidth : settings.shoulderWidth;
    ctx.strokeStyle = settings.kind === 'terrain' ? (selected ? '#5fe0d499' : '#47bdb455') : (selected ? '#66f19c88' : '#50c77b55'); ctx.lineWidth = settings.width + previewSideWidth * 2; trace(); ctx.stroke();
    ctx.strokeStyle = settings.kind === 'terrain' ? '#8de4ddee' : settings.roadType === 'secondary' ? '#b8895eee' : '#f0c774ee'; ctx.lineWidth = settings.width; trace(); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#d9f4e2'; for (const point of points) { ctx.beginPath(); ctx.arc(point.x, point.z, Math.max(1.1, settings.width * .14), 0, Math.PI * 2); ctx.fill(); }
    const endpointRadius = Math.max(1.6, settings.width * .22); ctx.fillStyle = '#6dbaff'; ctx.beginPath(); ctx.arc(points[0].x, points[0].z, endpointRadius, 0, Math.PI * 2); ctx.fill();
    if (points.length > 1) { ctx.fillStyle = '#ff9b66'; ctx.beginPath(); ctx.arc(points.at(-1).x, points.at(-1).z, endpointRadius, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  drawRoadRamps(ctx) {
    for (const ramp of this.roadRamps) {
      const kind = ramp.kind || 'road';
      const visible = kind === 'terrain' ? (this.visibility.height_base || this.activeLayer === 'height_base') : (this.visibility.roads || this.activeLayer === 'roads');
      if (!visible) continue;
      this.drawRoadRampPath(ctx, ramp.points, { ...normalizeRoadRampSettings({ roadType: ramp.road_type, width: ramp.width, shoulderWidth: ramp.shoulder_width, slopeRatio: ramp.slope_ratio, startLanding: ramp.start_landing, endLanding: ramp.end_landing, smoothSides: ramp.smooth_sides, sideSlopeRatio: ramp.side_slope_ratio, maxSideWidth: ramp.max_side_width, sideRoundness: ramp.side_roundness, followTerrain: ramp.follow_terrain }), kind }, ramp.id === this.selectedRoadRampId, false);
    }
    const kind = this.activeRampKind();
    if (kind && this.roadRampDraft.length) this.drawRoadRampPath(ctx, this.roadRampDraft, this.roadRampSettings(kind), true, true);
  }

  captureWaterControlSettings(mode = $('water-tool-mode').value) {
    return normalizeWaterSettings({
      mode,
      action: $('water-mass-action').value,
      width: $('water-width').value,
      depth: $('water-depth').value,
      shoreWidth: $('water-shore-width').value,
      shoreProfile: $('water-shore-profile').value,
      roadPolicy: $('water-road-policy').value,
      smoothing: $('water-course-smoothing').value,
      exitEnabled: $('water-course-exit').checked,
    });
  }

  rememberWaterControlSettings(mode = $('water-tool-mode').value) {
    const settings = this.captureWaterControlSettings(mode);
    if (mode === 'mass') this.massWaterSettings = settings; else this.riverWaterSettings = settings;
    return settings;
  }

  applyWaterControlSettings(settings) {
    if (!settings) return;
    $('water-width').value = settings.width; $('water-depth').value = settings.depth; $('water-shore-width').value = settings.shoreWidth;
    $('water-shore-profile').value = settings.shoreProfile; $('water-road-policy').value = settings.roadPolicy;
    if (settings.mode === 'mass') $('water-mass-action').value = settings.action; else { $('water-course-smoothing').value = settings.smoothing; $('water-course-exit').checked = settings.exitEnabled; }
  }

  waterSettings() {
    return normalizeWaterSettings({
      mode: $('water-tool-mode').value,
      action: $('water-mass-action').value,
      width: $('water-width').value,
      depth: $('water-depth').value,
      shoreWidth: $('water-shore-width').value,
      shoreProfile: $('water-shore-profile').value,
      roadPolicy: $('water-road-policy').value,
      smoothing: $('water-course-smoothing').value,
      exitEnabled: $('water-course-exit').checked,
    });
  }

  updateWaterUi() {
    if (!$('water-tool-panel')) return;
    const active = this.activeLayer === 'water'; const settings = this.waterSettings(); const river = active && settings.mode === 'river';
    $('water-course-fields').hidden = !river; $('water-course-label-field').hidden = !river; $('water-mass-action-field').hidden = river; $('water-mass-info').hidden = river;
    $('water-course-cancel').disabled = !this.waterCourseEditingId && !this.waterCourseDraft.length;
    $('water-course-apply').disabled = !this.waterCourseEditingId || this.waterCourseDraft.length < 2;
    if (river) {
      const draftLength = courseLength(this.waterCourseDraft);
      const editText = this.waterCourseEditingId ? 'Editando un río guardado. Cambia controles y pulsa Aplicar, o dibuja un recorrido nuevo para reemplazarlo.' : 'Mantén clic y dibuja libremente. Al soltar se crea un río editable.';
      $('water-course-info').textContent = this.waterCourseDraft.length >= 2 ? `${editText} Recorrido actual: ${draftLength.toFixed(1)} bloques · ${this.waterCourseDraft.length} muestras.` : editText;
    } else {
      const profiles = { compact: 'compacta', natural: 'natural', smooth: 'suave' };
      const action = settings.action === 'erase' ? 'Borra' : 'Pinta';
      $('water-mass-info').textContent = `${action} agua con ${settings.width} bloques de ancho, profundidad ${settings.depth} y orilla ${profiles[settings.shoreProfile]} de ${settings.shoreWidth}.`;
    }
    this.renderWaterCourseList();
  }

  beginWaterCourseStroke(point, event) {
    if (this.locked.water) { this.message('La capa Agua está bloqueada.'); return; }
    this.waterCourseDrawing = true; this.pointerDown = true; this.waterCourseDraft = [{ x: point.x, z: point.z }];
    this.overlay.setPointerCapture(event.pointerId); this.updateWaterUi(); this.renderOverlay();
  }

  appendWaterCoursePoint(point) {
    if (!this.waterCourseDrawing) return; const previous = this.waterCourseDraft.at(-1);
    if (!previous || Math.hypot(previous.x - point.x, previous.z - point.z) >= 0.7) this.waterCourseDraft.push({ x: point.x, z: point.z });
    if (this.waterCourseDraft.length > 2048) this.waterCourseDraft.splice(1, 1);
  }

  finishWaterCourseStroke(event) {
    if (!this.waterCourseDrawing) return;
    this.waterCourseDrawing = false; this.pointerDown = false; try { this.overlay.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
    const settings = this.waterSettings(); const smoothed = smoothFreehandCourse(this.waterCourseDraft, settings.smoothing);
    if (smoothed.length < 2 || courseLength(smoothed) < 2) { this.waterCourseDraft = []; this.updateWaterUi(); this.renderOverlay(); this.message('El trazo del río fue demasiado corto.', true); return; }
    this.waterCourseDraft = smoothed; this.saveWaterCourseDraft(true);
  }

  saveWaterCourseDraft(alreadySmoothed = false) {
    const settings = this.waterSettings(); const points = alreadySmoothed ? structuredClone(this.waterCourseDraft) : smoothFreehandCourse(this.waterCourseDraft, settings.smoothing);
    if (points.length < 2) { this.message('Dibuja un recorrido válido antes de guardar el río.', true); return; }
    const before = structuredClone(this.waterCourses); const editingId = this.waterCourseEditingId;
    const current = editingId ? this.waterCourses.find((item) => item.id === editingId) : null;
    const id = current?.id || createWaterCourseId(); const position = editingId ? this.waterCourses.findIndex((item) => item.id === editingId) : this.waterCourses.length;
    const course = {
      id, label: $('water-course-label').value.trim().slice(0, 80) || current?.label || `Río ${position + 1}`,
      points: structuredClone(points), width: settings.width, depth: settings.depth, shore_width: settings.shoreWidth,
      shore_profile: settings.shoreProfile, road_policy: settings.roadPolicy, smoothing: settings.smoothing, exit_enabled: settings.exitEnabled,
    };
    if (editingId) this.waterCourses = this.waterCourses.map((item) => item.id === editingId ? course : item); else this.waterCourses.push(course);
    this.selectedWaterCourseId = id; this.waterCourseEditingId = null; this.waterCourseDraft = []; $('water-course-label').value = ''; this.riverWaterSettings = settings; this.lastWaterMode = 'river';
    this.pushHistory({ type: 'waterCourses', before, after: structuredClone(this.waterCourses) }); this.updateWaterUi(); this.renderOverlay();
    this.message(`${editingId ? 'Río actualizado' : 'Río creado'}: ${course.label}. Compila la vista para revisar su profundidad y niveles.`);
  }

  applyWaterCourseEdits() {
    if (!this.waterCourseEditingId || this.waterCourseDraft.length < 2) return; this.saveWaterCourseDraft();
  }

  cancelWaterCourseDraft(render = true) {
    this.waterCourseDrawing = false; this.waterCourseDraft = []; this.waterCourseEditingId = null; if ($('water-course-label')) $('water-course-label').value = '';
    if (render) { this.updateWaterUi(); this.renderOverlay(); }
  }

  editWaterCourse(id) {
    const course = this.waterCourses.find((item) => item.id === id); if (!course) return;
    this.rememberWaterControlSettings(this.lastWaterMode); this.setActiveLayer('water'); $('water-tool-mode').value = 'river'; this.lastWaterMode = 'river'; this.selectedWaterCourseId = id; this.waterCourseEditingId = id; this.waterCourseDraft = structuredClone(course.points);
    $('water-course-label').value = course.label || ''; $('water-width').value = course.width; $('water-depth').value = course.depth; $('water-shore-width').value = course.shore_width;
    $('water-shore-profile').value = course.shore_profile; $('water-road-policy').value = course.road_policy; $('water-course-smoothing').value = course.smoothing ?? 60; $('water-course-exit').checked = Boolean(course.exit_enabled);
    this.riverWaterSettings = this.captureWaterControlSettings('river');
    this.updateLayerControls(); this.renderOverlay(); this.message('Río cargado. Puedes cambiar sus controles y aplicar, o dibujar un recorrido nuevo para reemplazarlo.');
  }

  deleteWaterCourse(id) {
    const course = this.waterCourses.find((item) => item.id === id); if (!course || !confirm(`¿Eliminar el río «${course.label || course.id}»?`)) return;
    const before = structuredClone(this.waterCourses); this.waterCourses = this.waterCourses.filter((item) => item.id !== id); if (this.waterCourseEditingId === id) this.cancelWaterCourseDraft(false); if (this.selectedWaterCourseId === id) this.selectedWaterCourseId = null;
    this.pushHistory({ type: 'waterCourses', before, after: structuredClone(this.waterCourses) }); this.updateWaterUi(); this.renderOverlay();
  }

  renderWaterCourseList() {
    const list = $('water-course-list'); if (!list) return; list.replaceChildren();
    if (!this.waterCourses.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = 'Aún no hay ríos.'; list.append(empty); return; }
    for (const course of this.waterCourses) {
      const item = document.createElement('div'); item.className = `road-ramp-item${course.id === this.selectedWaterCourseId ? ' selected' : ''}`;
      const content = document.createElement('button'); content.type = 'button'; content.className = 'road-ramp-select'; content.addEventListener('click', () => { this.selectedWaterCourseId = course.id; this.renderWaterCourseList(); this.renderOverlay(); });
      const title = document.createElement('strong'); title.textContent = course.label || course.id; const meta = document.createElement('small');
      meta.textContent = `ancho ${course.width} · profundidad ${course.depth} · orilla ${course.shore_width} · ${course.points.length} puntos${course.exit_enabled ? ' · salida' : ''}`;
      content.append(title, meta); const actions = document.createElement('div'); actions.className = 'road-ramp-item-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editar'; edit.addEventListener('click', () => this.editWaterCourse(course.id));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Eliminar'; remove.className = 'danger-soft'; remove.addEventListener('click', () => this.deleteWaterCourse(course.id));
      actions.append(edit, remove); item.append(content, actions); list.append(item);
    }
  }

  drawWaterCoursePath(ctx, points, settings, selected = false, draft = false) {
    if (!points?.length) return; const trace = () => { ctx.beginPath(); ctx.moveTo(points[0].x, points[0].z); for (const point of points.slice(1)) ctx.lineTo(point.x, point.z); };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (draft) ctx.setLineDash([Math.max(1.5, this.width / 384), Math.max(1.5, this.width / 512)]);
    ctx.strokeStyle = selected ? '#75d9ff88' : '#56b8e866'; ctx.lineWidth = settings.width + settings.shoreWidth * 2; trace(); ctx.stroke();
    ctx.strokeStyle = selected ? '#35aef5ee' : '#318ed0dd'; ctx.lineWidth = settings.width; trace(); ctx.stroke(); ctx.setLineDash([]);
    if (settings.exitEnabled && points.length > 1) { const end = points.at(-1); ctx.fillStyle = '#ff6b66'; ctx.beginPath(); ctx.arc(end.x, end.z, Math.max(2, settings.width * .25), 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  drawWaterCourses(ctx) {
    if (!this.visibility.water && this.activeLayer !== 'water') return;
    for (const course of this.waterCourses) this.drawWaterCoursePath(ctx, course.points, normalizeWaterSettings({ mode: 'river', width: course.width, depth: course.depth, shoreWidth: course.shore_width, shoreProfile: course.shore_profile, roadPolicy: course.road_policy, smoothing: course.smoothing, exitEnabled: course.exit_enabled }), course.id === this.selectedWaterCourseId, false);
    if (this.activeLayer === 'water' && $('water-tool-mode').value === 'river' && this.waterCourseDraft.length) this.drawWaterCoursePath(ctx, this.waterCourseDraft, this.waterSettings(), true, true);
  }

  updateBrushProfileUi() {
    const kind = LAYERS[this.activeLayer].kind;
    const heightLayer = kind === 'modifier';
    const advanced = heightLayer && $('elevation-profile-enabled').checked;
    $('elevation-profile-enabled-field').hidden = !heightLayer;
    $('elevation-profile-fields').hidden = !advanced;
    $('brush-core-mode-field').hidden = advanced;

    let diameter = clamp(Number($('brush-size').value) || 1, 1, 2048);
    let totalRadius = Math.max(0.5, diameter / 2);
    let coreRadius = 0;
    let slopeWidth = 0;
    let baseWidth = 0;
    let baseIntensity = 0;

    if (advanced) {
      const profile = normalizeElevationProfile({
        coreRadius: $('brush-core-radius').value,
        slopeWidth: $('brush-slope-width').value,
        baseEnabled: $('brush-base-enabled').checked,
        baseWidth: $('brush-base-width').value,
        baseIntensity: $('brush-base-intensity').value,
        profile: $('brush-profile-shape').value,
        terraceSteps: $('brush-terrace-steps').value,
      });
      coreRadius = profile.coreRadius; slopeWidth = profile.slopeWidth; baseWidth = profile.baseWidth; baseIntensity = profile.baseIntensity;
      $('brush-core-radius').value = String(Math.round(coreRadius * 10) / 10); $('brush-slope-width').value = String(Math.round(slopeWidth * 10) / 10); $('brush-base-width').value = String(Math.round(baseWidth * 10) / 10);
      totalRadius = Math.max(0.5, profile.radius); diameter = Math.min(2048, totalRadius * 2);
      $('brush-size').value = String(Math.round(diameter * 10) / 10);
      $('brush-size').disabled = true; $('brush-hardness').disabled = true;
      $('brush-core-radius').disabled = false; $('brush-core-radius').max = '1024';
      $('brush-base-fields').hidden = !$('brush-base-enabled').checked;
      $('brush-terrace-steps-field').hidden = $('brush-profile-shape').value !== 'terraced';
      const baseText = $('brush-base-enabled').checked ? ` · base ${baseWidth.toFixed(1)} a ${(baseIntensity * 100).toFixed(0)}%` : ' · sin base exterior';
      $('brush-profile-info').textContent = `Radio exterior ${totalRadius.toFixed(1)} · núcleo ${coreRadius.toFixed(1)} · talud ${slopeWidth.toFixed(1)}${baseText} · diámetro ${diameter.toFixed(1)} bloques.`;
      return;
    }

    $('brush-size').disabled = false;
    const direct = $('brush-core-mode').checked;
    const coreInput = $('brush-core-radius'); coreInput.max = String(totalRadius);
    if (direct) {
      coreRadius = clamp(Number(coreInput.value) || 0, 0, totalRadius);
      coreInput.value = String(Math.round(coreRadius * 10) / 10);
    } else {
      coreRadius = totalRadius * clamp(Number($('brush-hardness').value) / 100, 0, 1);
      coreInput.value = String(Math.round(coreRadius * 10) / 10);
    }
    coreInput.disabled = !direct; $('brush-hardness').disabled = direct;
    const transition = Math.max(0, totalRadius - coreRadius);
    const equivalentHardness = totalRadius > 0 ? coreRadius / totalRadius * 100 : 0;
    $('brush-profile-info').textContent = `Radio total ${totalRadius.toFixed(1)} · núcleo ${coreRadius.toFixed(1)} · transición ${transition.toFixed(1)} bloques · dureza equivalente ${equivalentHardness.toFixed(0)}%.`;
  }

  async apiJson(url, options = {}) {
    const response = await fetch(url, options);
    let payload = {};
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : `Error HTTP ${response.status}`);
    return payload;
  }

  initializePresetManagers() {
    for (const group of Object.keys(PRESET_GROUPS)) {
      $(`${group}-preset-save`).addEventListener('click', () => this.savePreset(group));
      $(`${group}-preset-load`).addEventListener('click', () => this.loadPreset(group));
      $(`${group}-preset-delete`).addEventListener('click', () => this.deletePreset(group));
      $(`${group}-preset-select`).addEventListener('change', () => { const name = $(`${group}-preset-select`).value; if (name) $(`${group}-preset-name`).value = name; });
      this.refreshPresetSelect(group);
      this.fetchPresetGroup(group).catch((error) => this.message(`No se pudieron cargar los presets de ${PRESET_GROUPS[group].label}: ${error.message}`, true));
    }
  }

  async fetchPresetGroup(group, selected = '') {
    const payload = await this.apiJson(`/api/library/presets/${encodeURIComponent(group)}`);
    this.presetCache[group] = payload.presets && typeof payload.presets === 'object' ? payload.presets : {};
    this.refreshPresetSelect(group, selected);
    return this.presetCache[group];
  }

  presetStore(group) { return this.presetCache[group] || {}; }

  snapshotPreset(group) {
    const output = {};
    for (const [id, mode] of PRESET_GROUPS[group].fields) if ($(id)) output[id] = mode === 'checked' ? $(id).checked : $(id).value;
    return output;
  }

  refreshPresetSelect(group, selected = '') {
    const select = $(`${group}-preset-select`); const store = this.presetStore(group); select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Selecciona un preset del servidor'; select.append(empty);
    for (const name of Object.keys(store).sort((a, b) => a.localeCompare(b, 'es'))) { const option = document.createElement('option'); option.value = name; option.textContent = name; select.append(option); }
    if (selected && store[selected]) select.value = selected;
  }

  async savePreset(group) {
    const definition = PRESET_GROUPS[group]; const input = $(`${group}-preset-name`); const name = input.value.trim().slice(0, 40);
    if (!name) { this.message(`Escribe un nombre para el preset de ${definition.label}.`, true); input.focus(); return; }
    const store = this.presetStore(group); if (store[name] && !confirm(`El preset «${name}» ya existe en el servidor. ¿Reemplazarlo?`)) return;
    try {
      const values = this.snapshotPreset(group);
      await this.apiJson(`/api/library/presets/${encodeURIComponent(group)}/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
      this.presetCache[group] = { ...store, [name]: values }; this.refreshPresetSelect(group, name);
      this.message(`Preset de ${definition.label} «${name}» guardado en la biblioteca central.`);
    } catch (error) { this.message(`No se pudo guardar el preset: ${error.message}`, true); }
  }

  loadPreset(group) {
    const definition = PRESET_GROUPS[group]; const select = $(`${group}-preset-select`); const name = select.value; const preset = this.presetStore(group)[name];
    if (!name || !preset) { this.message(`Selecciona un preset de ${definition.label}.`, true); return; }
    for (const [id, mode] of definition.fields) {
      if (!(id in preset) || !$(id)) continue;
      if (mode === 'checked') $(id).checked = Boolean(preset[id]); else $(id).value = preset[id];
      $(id).dispatchEvent(new Event(mode === 'checked' ? 'change' : 'input', { bubbles: true }));
    }
    if (group === 'brush') { this.lastWaterMode = $('water-tool-mode').value; this.rememberWaterControlSettings(this.lastWaterMode); this.updateBrushProfileUi(); this.updatePlateauUi(); this.updateLayerControls(); this.updateWaterUi(); this.renderOverlay(); }
    else if (group === 'mountain') { this.updateMountainUi(); this.renderOverlay(); this.markDirty(); }
    else { this.updateVoxelBudget(); this.markDirty(); }
    $(`${group}-preset-name`).value = name; this.message(`Preset de ${definition.label} «${name}» cargado desde el servidor.`);
  }

  async deletePreset(group) {
    const definition = PRESET_GROUPS[group]; const select = $(`${group}-preset-select`); const name = select.value; const store = this.presetStore(group);
    if (!name || !store[name]) { this.message(`Selecciona un preset de ${definition.label} para borrarlo.`, true); return; }
    if (!confirm(`¿Borrar del servidor el preset «${name}»?`)) return;
    try {
      await this.apiJson(`/api/library/presets/${encodeURIComponent(group)}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const next = { ...store }; delete next[name]; this.presetCache[group] = next; this.refreshPresetSelect(group); $(`${group}-preset-name`).value = '';
      this.message(`Preset «${name}» eliminado de la biblioteca central.`);
    } catch (error) { this.message(`No se pudo borrar el preset: ${error.message}`, true); }
  }

  setLibraryStatus(text = 'Servidor', error = false) {
    const status = $('structure-library-status'); if (!status) return;
    status.textContent = text; status.className = `badge ${error ? 'error' : 'ok'}`;
  }

  async loadStructureLibrary({ merge = true } = {}) {
    this.setLibraryStatus('Cargando…');
    const payload = await this.apiJson('/api/library/structures');
    const serverAssets = Array.isArray(payload.structure_assets) ? payload.structure_assets : [];
    const serverCollections = Array.isArray(payload.structure_collections) ? payload.structure_collections : [];
    this.libraryCollectionIds = new Set(serverCollections.map((item) => item.id));
    if (merge) {
      const assetMap = new Map(this.structureAssets.map((item) => [item.id, item]));
      for (const asset of serverAssets) assetMap.set(asset.id, asset);
      const collectionMap = new Map(this.structureCollections.map((item) => [item.id, item]));
      for (const collection of serverCollections) collectionMap.set(collection.id, collection);
      this.structureAssets = [...assetMap.values()]; this.structureCollections = [...collectionMap.values()];
    } else {
      this.structureAssets = structuredClone(serverAssets); this.structureCollections = structuredClone(serverCollections);
    }
    this.refreshStructureCollectionSelect(); this.setLibraryStatus('Servidor');
    return payload;
  }

  structureSettings() {
    return normalizeStructureSettings({
      mode: $('structure-tool-mode').value,
      brushSize: $('structure-brush-size').value,
      density: $('structure-density').value,
      spacing: $('structure-spacing').value,
      sink: $('structure-sink').value,
      randomRotation: $('structure-random-rotation').checked,
      randomMirror: $('structure-random-mirror').checked,
      avoidWater: $('structure-avoid-water').checked,
      avoidRoads: $('structure-avoid-roads').checked,
      avoidReserved: $('structure-avoid-reserved').checked,
    });
  }

  activeStructureCollection() {
    const id = $('structure-collection-select').value;
    return this.structureCollections.find((item) => item.id === id) || null;
  }

  refreshStructureCollectionSelect(preferredId = null) {
    const select = $('structure-collection-select'); const current = preferredId || select.value; select.replaceChildren();
    if (!this.structureCollections.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Crea una colección central'; select.append(option); }
    for (const collection of this.structureCollections) {
      const option = document.createElement('option'); option.value = collection.id;
      const scope = this.libraryCollectionIds.has(collection.id) ? 'Servidor' : 'Proyecto';
      option.textContent = `${collection.category === 'rock' ? '🪨' : '🌲'} ${collection.label} · ${scope}`; select.append(option);
    }
    if (this.structureCollections.some((item) => item.id === current)) select.value = current;
    else if (this.structureCollections[0]) select.value = this.structureCollections[0].id;
    this.renderStructureAssets(); this.updateStructureUi();
  }

  updateStructureUi() {
    if (!$('structure-tool-info')) return;
    const settings = this.structureSettings(); const collection = this.activeStructureCollection();
    const members = collection?.members?.filter((member) => this.structureAssets.some((asset) => asset.id === member.asset_id)) || [];
    const estimate = estimateStructureCount(settings);
    const modeText = settings.mode === 'erase' ? `Borrará estructuras dentro de ${Math.round(settings.brushSize / 2)} bloques de radio.`
      : settings.mode === 'stamp' ? 'Cada clic colocará una variante de la colección.'
        : `Aproximadamente ${estimate} intentos por muestra · separación ${settings.spacing}${settings.spacing === 0 ? ' (superposición libre)' : ''}.`;
    $('structure-tool-info').textContent = collection && members.length ? `${collection.label}: ${members.length} variantes. ${modeText}` : 'Crea una colección central e importa al menos un archivo .schem.';
    const count = this.structurePlacements.length; const blocks = this.structureAssets.reduce((sum, asset) => sum + Number(asset.block_count || 0), 0);
    $('structure-placement-count').textContent = `${count.toLocaleString('es-CL')} estructuras colocadas · ${this.structureAssets.length} schematics disponibles · ${blocks.toLocaleString('es-CL')} bloques fuente.`;
    $('structure-delete-collection').disabled = !collection;
  }

  async createStructureCollection() {
    const label = $('structure-collection-name').value.trim(); if (!label) { this.message('Escribe un nombre para la colección.', true); return; }
    try {
      const collection = await this.apiJson('/api/library/structures/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: label.slice(0, 80), category: $('structure-collection-category').value === 'rock' ? 'rock' : 'tree' }) });
      this.structureCollections.push(collection); this.libraryCollectionIds.add(collection.id); $('structure-collection-name').value = ''; this.refreshStructureCollectionSelect(collection.id); this.markDirty(); this.message(`Colección central «${collection.label}» creada. Ahora importa sus .schem.`);
    } catch (error) { this.message(`No se pudo crear la colección: ${error.message}`, true); }
  }

  async deleteStructureCollection() {
    const collection = this.activeStructureCollection(); if (!collection) return;
    const central = this.libraryCollectionIds.has(collection.id);
    if (!confirm(`¿Eliminar la colección «${collection.label}», sus schematics y todas sus instancias${central ? ' del servidor' : ''}?`)) return;
    try {
      if (central) await this.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' });
      const assetIds = new Set(collection.members.map((item) => item.asset_id));
      this.structureCollections = this.structureCollections.filter((item) => item.id !== collection.id);
      this.libraryCollectionIds.delete(collection.id);
      this.structurePlacements = this.structurePlacements.filter((item) => item.collection_id !== collection.id);
      const stillUsed = new Set(this.structureCollections.flatMap((item) => item.members.map((member) => member.asset_id)));
      this.structureAssets = this.structureAssets.filter((asset) => !assetIds.has(asset.id) || stillUsed.has(asset.id));
      this.refreshStructureCollectionSelect(); this.markDirty(); this.render(); this.message('Colección eliminada.');
    } catch (error) { this.message(`No se pudo eliminar la colección: ${error.message}`, true); }
  }

  async importStructureFiles(event) {
    const files = [...(event.target.files || [])]; const collection = this.activeStructureCollection(); event.target.value = '';
    if (!collection) { this.message('Crea o selecciona una colección antes de importar.', true); return; }
    if (!files.length) return;
    let imported = 0; const central = this.libraryCollectionIds.has(collection.id);
    for (const file of files) {
      try {
        const form = new FormData(); form.append('file', file);
        if (central) {
          const payload = await this.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}/assets`, { method: 'POST', body: form });
          const currentIndex = this.structureAssets.findIndex((item) => item.id === payload.asset.id);
          if (currentIndex >= 0) this.structureAssets[currentIndex] = payload.asset; else this.structureAssets.push(payload.asset);
          const collectionIndex = this.structureCollections.findIndex((item) => item.id === collection.id);
          if (collectionIndex >= 0) this.structureCollections[collectionIndex] = payload.collection;
        } else {
          const payload = await this.apiJson('/api/structures/import', { method: 'POST', body: form });
          const asset = { id: createStructureId('asset'), label: payload.label, category: collection.category, filename: payload.filename, width: payload.width, height: payload.height, length: payload.length, anchor_x: payload.anchor_x, anchor_y: payload.anchor_y, anchor_z: payload.anchor_z, block_count: payload.block_count, palette_count: payload.palette_count, content_b64: payload.content_b64 };
          this.structureAssets.push(asset); collection.members.push({ asset_id: asset.id, weight: 100 });
        }
        imported += 1;
      } catch (error) { this.message(`No se pudo importar ${file.name}: ${error.message}`, true); }
    }
    this.refreshStructureCollectionSelect(collection.id); this.markDirty(); if (imported) this.message(`${imported} schematic${imported === 1 ? '' : 's'} importado${imported === 1 ? '' : 's'} en «${collection.label}»${central ? ' y guardado en el servidor' : ''}.`);
  }

  async persistStructureMember(collection, member) {
    if (!this.libraryCollectionIds.has(collection.id)) return;
    try {
      await this.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}/members/${encodeURIComponent(member.asset_id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight: member.weight }) });
    } catch (error) { this.message(`No se pudo guardar el peso en el servidor: ${error.message}`, true); }
  }

  async persistStructureAsset(asset, patch) {
    const central = this.structureCollections.some((collection) => this.libraryCollectionIds.has(collection.id) && collection.members.some((member) => member.asset_id === asset.id));
    if (!central) return;
    try { await this.apiJson(`/api/library/structures/assets/${encodeURIComponent(asset.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); }
    catch (error) { this.message(`No se pudo guardar el schematic en el servidor: ${error.message}`, true); }
  }

  async removeStructureAsset(collection, asset) {
    if (!confirm(`¿Quitar ${asset.label} y sus instancias?`)) return;
    try {
      if (this.libraryCollectionIds.has(collection.id)) await this.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' });
      collection.members = collection.members.filter((entry) => entry.asset_id !== asset.id);
      this.structurePlacements = this.structurePlacements.filter((entry) => entry.asset_id !== asset.id);
      const used = this.structureCollections.some((entry) => entry.members.some((value) => value.asset_id === asset.id));
      if (!used) this.structureAssets = this.structureAssets.filter((entry) => entry.id !== asset.id);
      this.renderStructureAssets(); this.updateStructureUi(); this.markDirty(); this.render();
    } catch (error) { this.message(`No se pudo quitar el schematic: ${error.message}`, true); }
  }

  renderStructureAssets() {
    const list = $('structure-asset-list'); if (!list) return; list.replaceChildren(); const collection = this.activeStructureCollection();
    if (!collection) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = 'Selecciona una colección.'; list.append(empty); return; }
    if (!collection.members.length) { const empty = document.createElement('div'); empty.className = 'empty-list'; empty.textContent = 'Importa uno o más archivos .schem.'; list.append(empty); return; }
    for (const member of collection.members) {
      const asset = this.structureAssets.find((item) => item.id === member.asset_id); if (!asset) continue;
      const item = document.createElement('div'); item.className = 'structure-asset-item';
      const info = document.createElement('div'); const title = document.createElement('strong'); title.textContent = asset.label; const meta = document.createElement('small'); meta.textContent = `${asset.width}×${asset.height}×${asset.length} · ${Number(asset.block_count).toLocaleString('es-CL')} bloques`; info.append(title, meta);
      const weightLabel = document.createElement('label'); weightLabel.textContent = 'Peso'; const weight = document.createElement('input'); weight.type = 'number'; weight.min = '1'; weight.max = '10000'; weight.value = String(member.weight || 100); weight.addEventListener('change', () => { member.weight = clamp(Number(weight.value) || 1, 1, 10000); weight.value = String(member.weight); this.markDirty(); this.persistStructureMember(collection, member); }); weightLabel.append(weight);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger-soft'; remove.textContent = 'Quitar'; remove.addEventListener('click', () => this.removeStructureAsset(collection, asset));
      const anchors = document.createElement('div'); anchors.className = 'structure-asset-anchor';
      for (const [key, labelText, max] of [['anchor_x', 'Apoyo X', asset.width - 1], ['anchor_y', 'Apoyo Y', asset.height - 1], ['anchor_z', 'Apoyo Z', asset.length - 1]]) {
        const label = document.createElement('label'); label.textContent = labelText; const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = String(max); input.value = String(asset[key]); input.addEventListener('change', () => { asset[key] = Math.round(clamp(Number(input.value) || 0, 0, max)); input.value = String(asset[key]); this.markDirty(); this.persistStructureAsset(asset, { [key]: asset[key] }); }); label.append(input); anchors.append(label);
      }
      item.append(info, weightLabel, remove, anchors); list.append(item);
    }
  }

  structurePointAllowed(point, settings) {
    if (point.x < 0 || point.z < 0 || point.x >= this.width || point.z >= this.length) return false;
    const index = point.z * this.width + point.x;
    if (this.layers.playable[index] < 128 || this.layers.exclusion[index] > 0) return false;
    if (settings.avoidWater) {
      if (this.layers.water[index] > 0) return false;
      for (const course of this.waterCourses) {
        const reach = Number(course.width || 1) / 2 + Number(course.shore_width || 0);
        for (let i = 1; i < course.points.length; i += 1) if (pointSegmentDistance(point, course.points[i - 1], course.points[i]) <= reach) return false;
      }
    }
    if (settings.avoidReserved && this.layers.reserved[index] > 0) return false;
    if (settings.avoidRoads) {
      if (this.layers.roads[index] > 0) return false;
      if (this.roadRamps.some((ramp) => pointInsideRamp(point, ramp))) return false;
    }
    return true;
  }

  rebuildStructureGrid(spacing) {
    this.structureGrid = null; if (spacing <= 0) return;
    const size = Math.max(1, spacing); const grid = new Map();
    for (const placement of this.structurePlacements) { const key = `${Math.floor(placement.x / size)},${Math.floor(placement.z / size)}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(placement); }
    this.structureGrid = { size, grid };
  }

  structureHasNeighbor(x, z, spacing) {
    if (spacing <= 0 || !this.structureGrid) return false; const { size, grid } = this.structureGrid; const gx = Math.floor(x / size); const gz = Math.floor(z / size);
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) for (const placement of grid.get(`${gx + dx},${gz + dz}`) || []) if (Math.hypot(placement.x - x, placement.z - z) < spacing) return true;
    return false;
  }

  addStructureToGrid(placement) {
    if (!this.structureGrid) return; const { size, grid } = this.structureGrid; const key = `${Math.floor(placement.x / size)},${Math.floor(placement.z / size)}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(placement);
  }

  createStructurePlacement(x, z, settings, collection) {
    if (!this.structurePointAllowed({ x, z }, settings) || this.structureHasNeighbor(x, z, settings.spacing)) return false;
    const member = weightedMember(collection.members); if (!member) return false; const asset = this.structureAssets.find((item) => item.id === member.asset_id); if (!asset) return false;
    const rotations = [0, 90, 180, 270]; const placement = { id: createStructureId('instance'), collection_id: collection.id, asset_id: asset.id, x, z, rotation: settings.randomRotation ? rotations[Math.floor(Math.random() * rotations.length)] : 0, mirror: settings.randomMirror ? Math.random() < .5 : false, sink: settings.sink };
    this.structurePlacements.push(placement); this.structureStrokeAdded.push(placement); this.addStructureToGrid(placement); return true;
  }

  paintStructureDisk(cx, cz, settings) {
    const radius = settings.brushSize / 2;
    if (settings.mode === 'erase') {
      const kept = []; for (const placement of this.structurePlacements) { if (Math.hypot(placement.x - cx, placement.z - cz) <= radius) this.structureStrokeRemoved.push(placement); else kept.push(placement); } this.structurePlacements = kept; return;
    }
    const collection = this.activeStructureCollection(); if (!collection || !collection.members.length) return;
    if (settings.mode === 'stamp') { this.createStructurePlacement(Math.round(cx), Math.round(cz), settings, collection); return; }
    const attempts = estimateStructureCount(settings);
    for (let index = 0; index < attempts; index += 1) {
      const angle = Math.random() * Math.PI * 2; const distance = Math.sqrt(Math.random()) * radius;
      this.createStructurePlacement(Math.round(cx + Math.cos(angle) * distance), Math.round(cz + Math.sin(angle) * distance), settings, collection);
    }
  }

  paintStructureSegment(start, end) {
    const settings = this.structureSettings(); const distance = Math.hypot(end.x - start.x, end.z - start.z); const stepSize = settings.mode === 'stamp' ? Math.max(1, settings.spacing || settings.brushSize * .3) : Math.max(1, settings.brushSize * .42); const steps = Math.max(1, Math.ceil(distance / stepSize));
    for (let step = 1; step <= steps; step += 1) { const t = step / steps; this.paintStructureDisk(start.x + (end.x - start.x) * t, start.z + (end.z - start.z) * t, settings); }
    this.updateStructureUi(); this.scheduleRender();
  }

  beginStructureStroke(point, event) {
    const settings = this.structureSettings(); if (settings.mode !== 'erase' && (!this.activeStructureCollection() || !this.activeStructureCollection().members.length)) { this.message('Selecciona una colección con al menos un schematic.', true); return; }
    this.structureDrawing = true; this.structureStrokeAdded = []; this.structureStrokeRemoved = []; this.structureLastPoint = point; this.rebuildStructureGrid(settings.spacing); this.overlay.setPointerCapture(event.pointerId); this.paintStructureDisk(point.x, point.z, settings); this.updateStructureUi(); this.renderOverlay();
  }

  appendStructureStroke(point) { if (!this.structureDrawing || !this.structureLastPoint) return; if (point.x === this.structureLastPoint.x && point.z === this.structureLastPoint.z) return; this.paintStructureSegment(this.structureLastPoint, point); this.structureLastPoint = point; }

  finishStructureStroke(event) {
    if (!this.structureDrawing) return; this.structureDrawing = false; this.structureLastPoint = null; this.structureGrid = null; try { this.overlay.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
    if (this.structureStrokeAdded.length || this.structureStrokeRemoved.length) this.pushHistory({ type: 'structurePlacementDelta', added: structuredClone(this.structureStrokeAdded), removed: structuredClone(this.structureStrokeRemoved) });
    this.structureStrokeAdded = []; this.structureStrokeRemoved = []; this.updateStructureUi(); this.render();
  }

  cancelStructureStroke() {
    if (!this.structureDrawing) return; const addedIds = new Set(this.structureStrokeAdded.map((item) => item.id)); this.structurePlacements = this.structurePlacements.filter((item) => !addedIds.has(item.id)); this.structurePlacements.push(...this.structureStrokeRemoved); this.structureDrawing = false; this.structureStrokeAdded = []; this.structureStrokeRemoved = []; this.structureLastPoint = null; this.structureGrid = null; this.updateStructureUi(); this.render();
  }

  drawStructurePlacements(ctx) {
    if (!this.visibility.structures) return;
    ctx.save(); const selected = this.activeStructureCollection()?.id;
    for (const placement of this.structurePlacements) {
      const asset = this.structureAssets.find((item) => item.id === placement.asset_id); const color = asset?.category === 'rock' ? '#b9b5ae' : '#69c878'; ctx.fillStyle = placement.collection_id === selected && this.activeLayer === 'structures' ? color : `${color}aa`; const radius = this.width > 800 ? 1.3 : 1.8; ctx.beginPath(); ctx.arc(placement.x + .5, placement.z + .5, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  randomizeSeed() {
    const maximum = 2147483647; let value;
    if (globalThis.crypto?.getRandomValues) {
      const random = new Uint32Array(1); globalThis.crypto.getRandomValues(random); value = random[0] & maximum;
    } else value = Math.floor(Math.random() * (maximum + 1));
    $('seed').value = String(value); $('seed').dispatchEvent(new Event('input', { bubbles: true }));
    this.message(`Semilla aleatoria generada: ${value}.`);
  }

  eventPoint(event) {
    const rect = this.overlay.getBoundingClientRect();
    return { x: clamp(Math.floor((event.clientX - rect.left) / rect.width * this.width), 0, this.width - 1), z: clamp(Math.floor((event.clientY - rect.top) / rect.height * this.length), 0, this.length - 1) };
  }

  pointerStart(event) {
    event.preventDefault(); const point = this.eventPoint(event); this.hover = point;
    if (this.plateauPickHeight && this.activeLayer === 'height_base') { this.samplePlateauHeight(point); return; }
    if (this.markerTool) {
      try { this.handleMarkerClick(point); }
      catch (error) { console.error(error); this.message(`No se pudo colocar el marcador: ${error.message || error}`, true); }
      return;
    }
    if (this.activeRampKind()) { this.addRoadRampPoint(point); return; }
    if (this.activeLayer === 'water' && $('water-tool-mode').value === 'river') { this.beginWaterCourseStroke(point, event); return; }
    if (this.activeLayer === 'structures') { this.beginStructureStroke(point, event); return; }
    if (this.locked[this.activeLayer]) { this.message('La capa está bloqueada.'); return; }
    this.pointerDown = true; this.overlay.setPointerCapture(event.pointerId); this.currentChanges = new Map(); this.strokeBaseValues = new Map(); this.strokeInfluence = new Map();
    if ($('brush-action').value === 'fill' && ['mask', 'category', 'material'].includes(LAYERS[this.activeLayer].kind)) {
      this.floodFill(point.x, point.z); this.finishStroke(); this.pointerDown = false; return;
    }
    if ($('stroke-mode').value === 'line') this.lineStart = point;
    else this.paintSegment(point, point);
    this.renderOverlay();
  }

  pointerMove(event) {
    const point = this.eventPoint(event); $('cursor-info').textContent = `X ${point.x} · Z ${point.z}`;
    const previous = this.hover; this.hover = point;
    if (this.waterCourseDrawing) this.appendWaterCoursePoint(point);
    else if (this.structureDrawing) this.appendStructureStroke(point);
    else if (this.pointerDown && !this.markerTool && $('stroke-mode').value === 'free' && previous) this.paintSegment(previous, point);
    this.renderOverlay();
  }

  pointerEnd(event) {
    if (this.waterCourseDrawing) { this.appendWaterCoursePoint(this.eventPoint(event)); this.finishWaterCourseStroke(event); return; }
    if (this.structureDrawing) { this.appendStructureStroke(this.eventPoint(event)); this.finishStructureStroke(event); return; }
    if (!this.pointerDown) return;
    const point = this.eventPoint(event);
    if ($('stroke-mode').value === 'line' && this.lineStart) this.paintSegment(this.lineStart, point);
    this.pointerDown = false; this.lineStart = null; try { this.overlay.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
    this.finishStroke(); this.renderOverlay();
  }

  beginChange(index) {
    if (!this.currentChanges.has(index)) this.currentChanges.set(index, this.layers[this.activeLayer][index]);
  }

  setCell(index, value) {
    const next = clamp(Math.round(value), 0, 255); const layer = this.layers[this.activeLayer]; if (layer[index] === next) return;
    this.beginChange(index); layer[index] = next; if (this.activeLayer === 'playable') { this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; }
  }

  brushSettings() {
    const kind = LAYERS[this.activeLayer].kind;
    if (kind === 'plateau') {
      const plateau = this.plateauSettings();
      return {
        radius: Math.max(1, plateau.radius), coreRadius: plateau.plateauRadius, hardness: 1,
        plateauMode: true, plateau, advanced: false, elevationProfile: null, strictClip: true,
        opacity: 1, strength: 0, shape: 'circle', action: plateau.action, value: plateau.targetValue,
      };
    }
    if (this.activeLayer === 'water') {
      const water = this.waterSettings(); const radius = Math.max(0.5, water.width / 2);
      return { radius, coreRadius: radius, hardness: 1, plateauMode: false, plateau: null, advanced: false, elevationProfile: null, strictClip: true, opacity: 1, strength: 0, shape: 'circle', action: water.action === 'erase' ? 'erase' : 'add', value: 255, waterMode: true, water };
    }
    const advanced = kind === 'modifier' && $('elevation-profile-enabled').checked;
    let radius; let coreRadius; let elevationProfile = null;
    if (advanced) {
      elevationProfile = normalizeElevationProfile({
        coreRadius: $('brush-core-radius').value,
        slopeWidth: $('brush-slope-width').value,
        baseEnabled: $('brush-base-enabled').checked,
        baseWidth: $('brush-base-width').value,
        baseIntensity: $('brush-base-intensity').value,
        profile: $('brush-profile-shape').value,
        terraceSteps: $('brush-terrace-steps').value,
      });
      radius = Math.max(0.5, elevationProfile.radius); coreRadius = elevationProfile.coreRadius;
    } else {
      radius = Math.max(0.5, Number($('brush-size').value) / 2);
      const directCore = $('brush-core-mode').checked;
      coreRadius = directCore ? clamp(Number($('brush-core-radius').value) || 0, 0, radius) : radius * clamp(Number($('brush-hardness').value) / 100, 0, 1);
    }
    return {
      radius, coreRadius, hardness: radius > 0 ? coreRadius / radius : 0, plateauMode: false, plateau: null, advanced, elevationProfile,
      strictClip: $('brush-strict-clip').checked,
      opacity: clamp(Number($('brush-opacity').value) / 100, 0.01, 1), strength: clamp(Number($('brush-strength').value), 1, 64), shape: $('brush-shape').value,
      action: $('brush-action').value, value: Number($('paint-value').value || 0),
    };
  }

  paintSegment(start, end) {
    const settings = this.brushSettings(); const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const steps = Math.max(1, Math.ceil(distance / Math.max(0.7, settings.radius * 0.28)));
    for (let step = 0; step <= steps; step += 1) { const t = step / steps; this.paintDisk(start.x + (end.x - start.x) * t, start.z + (end.z - start.z) * t, settings); }
    this.markDirty(); this.scheduleRender();
  }

  paintDisk(cx, cz, settings) {
    const { radius, hardness, opacity, strength, shape, action, value, plateauMode, plateau, advanced, elevationProfile, strictClip } = settings;
    const x0 = Math.max(0, Math.floor(cx - radius)); const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const z0 = Math.max(0, Math.floor(cz - radius)); const z1 = Math.min(this.length - 1, Math.ceil(cz + radius));
    const layer = this.layers[this.activeLayer]; const kind = LAYERS[this.activeLayer].kind;
    for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) {
      const dx = Math.abs(x - cx); const dz = Math.abs(z - cz); const distance = shape === 'square' ? Math.max(dx, dz) : Math.hypot(dx, dz);
      const edgeAllowance = strictClip ? 0 : 0.5; if (distance > radius + edgeAllowance) continue;
      let influence;
      if (plateauMode) influence = plateauInfluence(distance, plateau);
      else if (advanced) influence = elevationProfileInfluence(distance, elevationProfile);
      else { const normalized = distance / radius; influence = normalized <= hardness ? 1 : 1 - (normalized - hardness) / Math.max(0.001, 1 - hardness); }
      if (!strictClip && distance > radius) influence *= Math.max(0, 1 - (distance - radius) / Math.max(0.001, edgeAllowance));
      const alpha = clamp(influence * opacity, 0, 1);
      if (alpha <= 0) continue; const index = z * this.width + x; const current = layer[index];
      if (kind === 'mask') {
        if (action === 'add') this.setCell(index, Math.max(current, 255 * alpha)); else if (action === 'erase') this.setCell(index, current * (1 - alpha));
      } else if (kind === 'roads') {
        if (action === 'erase') this.setCell(index, 0); else if (alpha >= 0.18) this.setCell(index, action === 'primary' ? 1 : (current === 1 ? 1 : 2));
      } else if (kind === 'category' || kind === 'material') {
        if (action === 'erase') this.setCell(index, 0); else if (alpha >= 0.2) this.setCell(index, value);
      } else if (kind === 'plateau') {
        if (!this.strokeBaseValues?.has(index)) this.strokeBaseValues?.set(index, current);
        const previousInfluence = this.strokeInfluence?.get(index) || 0;
        if (alpha <= previousInfluence + 0.0001) continue;
        this.strokeInfluence?.set(index, alpha);
        const source = this.strokeBaseValues?.get(index) ?? current;
        this.setCell(index, source + (value - source) * alpha);
      } else if (kind === 'modifier') {
        const accumulate = $('stroke-accumulation').checked || action === 'smooth';
        let source = current; let effectiveAlpha = alpha;
        if (!accumulate) {
          if (!this.strokeBaseValues?.has(index)) this.strokeBaseValues?.set(index, current);
          const previousInfluence = this.strokeInfluence?.get(index) || 0;
          if (alpha <= previousInfluence + 0.0001) continue;
          this.strokeInfluence?.set(index, alpha); source = this.strokeBaseValues?.get(index) ?? current; effectiveAlpha = alpha;
        }
        if (action === 'raise') this.setCell(index, source + strength * effectiveAlpha); else if (action === 'lower') this.setCell(index, source - strength * effectiveAlpha);
        else if (action === 'reset') this.setCell(index, source + (128 - source) * effectiveAlpha);
        else if (action === 'smooth') {
          let total = 0; let count = 0;
          for (let nz = Math.max(0, z - 2); nz <= Math.min(this.length - 1, z + 2); nz += 1) for (let nx = Math.max(0, x - 2); nx <= Math.min(this.width - 1, x + 2); nx += 1) { total += layer[nz * this.width + nx]; count += 1; }
          this.setCell(index, current + (total / count - current) * alpha * 0.65);
        }
      }
    }
  }

  floodFill(x, z) {
    const layer = this.layers[this.activeLayer]; const target = layer[z * this.width + x]; const kind = LAYERS[this.activeLayer].kind; const action = $('brush-action').value;
    let replacement = 0; if (kind === 'mask') replacement = action === 'erase' ? 0 : 255; else replacement = action === 'erase' ? 0 : Number($('paint-value').value || 0);
    if (target === replacement) return; const queue = [z * this.width + x]; const visited = new Uint8Array(layer.length); visited[queue[0]] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]; if (layer[index] !== target) continue; this.setCell(index, replacement); const px = index % this.width; const pz = Math.floor(index / this.width);
      for (const next of [px > 0 ? index - 1 : -1, px < this.width - 1 ? index + 1 : -1, pz > 0 ? index - this.width : -1, pz < this.length - 1 ? index + this.width : -1]) if (next >= 0 && !visited[next]) { visited[next] = 1; if (layer[next] === target) queue.push(next); }
    }
    this.markDirty(); this.scheduleRender();
  }

  finishStroke() {
    if (!this.currentChanges) return; const changes = [];
    for (const [index, oldValue] of this.currentChanges.entries()) { const newValue = this.layers[this.activeLayer][index]; if (oldValue !== newValue) changes.push([index, oldValue, newValue]); }
    if (changes.length) this.pushHistory({ type: 'cells', layer: this.activeLayer, changes });
    this.currentChanges = null; this.strokeBaseValues = null; this.strokeInfluence = null; this.updateHistory();
  }

  pushHistory(operation) { this.undoStack.push(operation); if (this.undoStack.length > this.maxHistory) this.undoStack.shift(); this.redoStack.length = 0; this.markDirty(); this.updateHistory(); }

  applyOperation(operation, direction) {
    if (operation.type === 'cells') { const layer = this.layers[operation.layer]; for (const [index, oldValue, newValue] of operation.changes) layer[index] = direction === 'undo' ? oldValue : newValue; if (operation.layer === 'playable') { this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; } }
    else if (operation.type === 'markers') this.markers = structuredClone(direction === 'undo' ? operation.before : operation.after);
    else if (operation.type === 'roadRamps') { this.roadRamps = structuredClone(direction === 'undo' ? operation.before : operation.after); this.selectedRoadRampId = null; this.cancelRoadRampDraft(false); this.renderRoadRampList(); }
    else if (operation.type === 'waterCourses') { this.waterCourses = structuredClone(direction === 'undo' ? operation.before : operation.after); this.selectedWaterCourseId = null; this.cancelWaterCourseDraft(false); this.renderWaterCourseList(); }
    else if (operation.type === 'structurePlacementDelta') {
      const addedIds = new Set(operation.added.map((item) => item.id)); const removedIds = new Set(operation.removed.map((item) => item.id));
      if (direction === 'undo') { this.structurePlacements = this.structurePlacements.filter((item) => !addedIds.has(item.id)); this.structurePlacements.push(...structuredClone(operation.removed)); }
      else { this.structurePlacements = this.structurePlacements.filter((item) => !removedIds.has(item.id)); this.structurePlacements.push(...structuredClone(operation.added)); }
      this.updateStructureUi();
    }
    else if (operation.type === 'roadState') {
      const layer = this.layers.roads; for (const [index, oldValue, newValue] of operation.changes) layer[index] = direction === 'undo' ? oldValue : newValue;
      this.roadRamps = structuredClone(direction === 'undo' ? operation.rampsBefore : operation.rampsAfter); this.selectedRoadRampId = null; this.cancelRoadRampDraft(false); this.renderRoadRampList();
    } else if (operation.type === 'heightBaseState') {
      const layer = this.layers.height_base; for (const [index, oldValue, newValue] of operation.changes) layer[index] = direction === 'undo' ? oldValue : newValue;
      this.roadRamps = structuredClone(direction === 'undo' ? operation.rampsBefore : operation.rampsAfter); this.selectedRoadRampId = null; this.cancelRoadRampDraft(false); this.renderRoadRampList();
    } else if (operation.type === 'waterState') {
      const layer = this.layers.water; for (const [index, oldValue, newValue] of operation.changes) layer[index] = direction === 'undo' ? oldValue : newValue;
      this.waterCourses = structuredClone(direction === 'undo' ? operation.coursesBefore : operation.coursesAfter); this.selectedWaterCourseId = null; this.cancelWaterCourseDraft(false); this.renderWaterCourseList();
    }
    this.markDirty(); this.render(); this.renderMarkers();
  }

  undo() { const operation = this.undoStack.pop(); if (!operation) return; this.applyOperation(operation, 'undo'); this.redoStack.push(operation); this.updateHistory(); }
  redo() { const operation = this.redoStack.pop(); if (!operation) return; this.applyOperation(operation, 'redo'); this.undoStack.push(operation); this.updateHistory(); }
  updateHistory() { $('history-info').textContent = `Historial: ${this.undoStack.length} · Rehacer: ${this.redoStack.length}`; $('undo').disabled = !this.undoStack.length; $('redo').disabled = !this.redoStack.length; }

  clearLayer() {
    if (this.activeLayer === 'roads') {
      if (!confirm('¿Vaciar los caminos pintados y eliminar todas las rampas viales? Las rampas de meseta se conservarán.')) return;
      const layer = this.layers.roads; const changes = []; const rampsBefore = structuredClone(this.roadRamps);
      for (let index = 0; index < layer.length; index += 1) if (layer[index] !== 0) { changes.push([index, layer[index], 0]); layer[index] = 0; }
      this.roadRamps = this.roadRamps.filter((ramp) => (ramp.kind || 'road') === 'terrain'); const rampsAfter = structuredClone(this.roadRamps); this.cancelRoadRampDraft(false); this.selectedRoadRampId = null;
      if (changes.length || rampsBefore.length !== rampsAfter.length) this.pushHistory({ type: 'roadState', changes, rampsBefore, rampsAfter });
      this.renderRoadRampList(); this.updateHistory(); this.render(); return;
    }
    if (this.activeLayer === 'height_base') {
      if (!confirm('¿Restaurar la altura base y eliminar todas las rampas de meseta? Las rampas viales se conservarán.')) return;
      const layer = this.layers.height_base; const changes = []; const rampsBefore = structuredClone(this.roadRamps);
      for (let index = 0; index < layer.length; index += 1) if (layer[index] !== 128) { changes.push([index, layer[index], 128]); layer[index] = 128; }
      this.roadRamps = this.roadRamps.filter((ramp) => (ramp.kind || 'road') === 'road'); const rampsAfter = structuredClone(this.roadRamps); this.cancelRoadRampDraft(false); this.selectedRoadRampId = null;
      if (changes.length || rampsBefore.length !== rampsAfter.length) this.pushHistory({ type: 'heightBaseState', changes, rampsBefore, rampsAfter });
      this.renderRoadRampList(); this.updateHistory(); this.render(); return;
    }
    if (this.activeLayer === 'water') {
      if (!confirm('¿Vaciar el agua pintada y eliminar todos los ríos libres?')) return;
      const layer = this.layers.water; const changes = []; const coursesBefore = structuredClone(this.waterCourses);
      for (let index = 0; index < layer.length; index += 1) if (layer[index] !== 0) { changes.push([index, layer[index], 0]); layer[index] = 0; }
      this.waterCourses = []; this.cancelWaterCourseDraft(false); this.selectedWaterCourseId = null;
      if (changes.length || coursesBefore.length) this.pushHistory({ type: 'waterState', changes, coursesBefore, coursesAfter: [] });
      this.renderWaterCourseList(); this.updateHistory(); this.render(); return;
    }
    if (this.activeLayer === 'structures') {
      if (!confirm('¿Eliminar todas las estructuras colocadas? Las colecciones y schematics se conservarán.')) return;
      const removed = structuredClone(this.structurePlacements); this.structurePlacements = [];
      if (removed.length) this.pushHistory({ type: 'structurePlacementDelta', added: [], removed });
      this.updateStructureUi(); this.render(); return;
    }
    if (!confirm(`¿Vaciar la capa «${LAYERS[this.activeLayer].label}»?`)) return; const layer = this.layers[this.activeLayer]; const defaultValue = LAYERS[this.activeLayer].default; const changes = [];
    for (let index = 0; index < layer.length; index += 1) if (layer[index] !== defaultValue) { changes.push([index, layer[index], defaultValue]); layer[index] = defaultValue; }
    if (changes.length) this.pushHistory({ type: 'cells', layer: this.activeLayer, changes }); if (this.activeLayer === 'playable') { this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; } this.updateHistory(); this.render();
  }

  showAll() { for (const name of Object.keys(LAYERS)) this.visibility[name] = true; this.buildLayerList(); this.render(); }

  setMarkerTool(tool) {
    this.cancelPlateauHeightPicker(); if (tool) { this.cancelRoadRampDraft(); this.cancelWaterCourseDraft(); this.cancelStructureStroke(); } this.markerTool = tool; document.querySelectorAll('.marker-tools button').forEach((button) => button.classList.toggle('active', button.dataset.markerTool === tool || (tool === 'select' && button.id === 'marker-select')));
    const names = { spawn: 'Spawn', exit: 'Salida', poi: 'Punto de interés', select: 'Seleccionar' };
    this.overlay.style.cursor = tool ? (tool === 'select' ? 'pointer' : 'copy') : 'crosshair';
    this.message(tool ? `${names[tool] || tool} activo: haz clic una vez en el lienzo.` : 'Herramienta de marcador desactivada.'); this.renderOverlay();
  }

  playableBoundaryPoints() {
    if (this.playableBoundaryCache) return this.playableBoundaryCache;
    const playable = this.layers.playable; const points = [];
    for (let z = 0; z < this.length; z += 1) for (let x = 0; x < this.width; x += 1) {
      const index = z * this.width + x; if (playable[index] < 128) continue;
      const boundary = x === 0 || z === 0 || x === this.width - 1 || z === this.length - 1
        || playable[index - 1] < 128 || playable[index + 1] < 128
        || playable[index - this.width] < 128 || playable[index + this.width] < 128;
      if (boundary) points.push({ x, z });
    }
    this.playableBoundaryCache = points; return points;
  }

  nearestPlayableBoundary(point) {
    let best = null; let bestDistance = Infinity;
    for (const candidate of this.playableBoundaryPoints()) {
      const distance = (candidate.x - point.x) ** 2 + (candidate.z - point.z) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = candidate; }
    }
    if (best) return { ...best };
    const candidates = [
      { x: 0, z: point.z, d: point.x }, { x: this.width - 1, z: point.z, d: this.width - 1 - point.x },
      { x: point.x, z: 0, d: point.z }, { x: point.x, z: this.length - 1, d: this.length - 1 - point.z },
    ];
    const fallback = candidates.sort((a, b) => a.d - b.d)[0]; return { x: fallback.x, z: fallback.z };
  }

  markerPreviewPoint(point) { return this.markerTool === 'exit' ? this.nearestPlayableBoundary(point) : point; }

  handleMarkerClick(point) {
    if (this.markerTool === 'select') { const nearest = this.nearestMarker(point); if (nearest) this.message(`${nearest.label} (${nearest.type}) en X ${nearest.x}, Z ${nearest.z}.`); else this.message('No hay ningún marcador cerca de ese punto.'); return; }
    const before = structuredClone(this.markers); const type = this.markerTool; const target = type === 'exit' ? this.nearestPlayableBoundary(point) : point; const { x, z } = target;
    if (type === 'spawn') this.markers = this.markers.filter((marker) => marker.type !== 'spawn');
    const count = this.markers.filter((marker) => marker.type === type).length + 1; const labels = { spawn: 'Spawn principal', exit: `Salida ${count}`, poi: `POI ${count}` };
    const marker = { id: createMarkerId(), type, x, z, label: labels[type], radius: clamp(Number($('marker-radius').value) || 12, 1, 512) };
    this.markers.push(marker);
    this.pushHistory({ type: 'markers', before, after: structuredClone(this.markers) }); this.render(); this.renderMarkers(); this.updateHistory();
    this.message(`${marker.label} colocada en X ${x}, Z ${z}. Pulsa Esc cuando termines.`);
  }

  nearestMarker(point) { let best = null; let distance = Infinity; for (const marker of this.markers) { const current = Math.hypot(marker.x - point.x, marker.z - point.z); if (current < distance && current <= Math.max(8, marker.radius)) { best = marker; distance = current; } } return best; }

  renderMarkers() {
    const list = $('marker-list'); list.replaceChildren();
    for (const marker of this.markers) {
      const item = document.createElement('div'); item.className = 'marker-item';
      const content = document.createElement('div'); content.className = 'marker-content'; const input = document.createElement('input'); input.value = marker.label;
      const typeNames = { spawn: 'Spawn', exit: 'Salida', poi: 'Punto de interés' }; const meta = document.createElement('small'); meta.className = 'marker-meta'; meta.textContent = `${typeNames[marker.type] || marker.type} · X ${marker.x} · Z ${marker.z}`;
      input.addEventListener('change', () => { const before = structuredClone(this.markers); marker.label = input.value.slice(0, 80); this.pushHistory({ type: 'markers', before, after: structuredClone(this.markers) }); this.render(); });
      content.append(input, meta);
      const remove = document.createElement('button'); remove.textContent = 'Eliminar'; remove.addEventListener('click', () => { const before = structuredClone(this.markers); this.markers = this.markers.filter((itemMarker) => itemMarker.id !== marker.id); this.pushHistory({ type: 'markers', before, after: structuredClone(this.markers) }); this.render(); this.renderMarkers(); });
      item.append(content, remove); list.append(item);
    }
  }

  scheduleRender() { if (this.renderQueued) return; this.renderQueued = true; requestAnimationFrame(() => { this.renderQueued = false; this.render(); }); }

  render() {
    const image = this.ctx.createImageData(this.width, this.length); const data = image.data; const mode = $('view-mode').value;
    const base = this.layers.height_base; const modifier = this.layers.height_modifier; const playable = this.layers.playable; const regions = this.layers.regions; const roads = this.layers.roads; const water = this.layers.water; const reserved = this.layers.reserved; const materials = this.layers.materials; const exclusion = this.layers.exclusion;
    for (let index = 0; index < base.length; index += 1) {
      let r = 48 + base[index] * 0.48; let g = 58 + base[index] * 0.55; let b = 49 + base[index] * 0.42;
      const activeOnly = mode === 'current'; const active = this.activeLayer;
      if (activeOnly) {
        const value = this.layers[active][index]; const kind = LAYERS[active].kind;
        if (active === 'regions') [r, g, b] = REGION_COLORS[value % REGION_COLORS.length];
        else if (active === 'roads') [r, g, b] = value === 1 ? [210, 173, 113] : value === 2 ? [142, 104, 67] : [24, 29, 25];
        else if (active === 'water') [r, g, b] = value ? [52, 112, 170] : [24, 29, 25];
        else if (active === 'materials') { const colors = [[35, 40, 36], [73, 128, 67], [127, 88, 56], [105, 108, 112], [194, 174, 112], [225, 232, 235], [130, 126, 115], [52, 112, 170]]; [r, g, b] = colors[value] || colors[0]; }
        else if (active === 'height_modifier') { const delta = value - 128; r = 90 + Math.max(0, delta) * 1.2; g = 90 + Math.min(0, delta) * -0.3; b = 90 + Math.max(0, -delta) * 1.2; }
        else { r = g = b = value; }
      } else {
        if (this.visibility.regions) { const color = REGION_COLORS[regions[index] % REGION_COLORS.length]; r = r * .76 + color[0] * .24; g = g * .76 + color[1] * .24; b = b * .76 + color[2] * .24; }
        if (this.visibility.height_modifier) { const delta = modifier[index] - 128; r += Math.max(0, delta) * .22; b += Math.max(0, -delta) * .25; }
        if (this.visibility.materials && materials[index]) { const colors = REGION_COLORS; const color = colors[(materials[index] + 7) % colors.length]; r = r * .65 + color[0] * .35; g = g * .65 + color[1] * .35; b = b * .65 + color[2] * .35; }
        if (this.visibility.water && water[index]) { const alpha = water[index] / 255 * .8; r = r * (1 - alpha) + 46 * alpha; g = g * (1 - alpha) + 105 * alpha; b = b * (1 - alpha) + 170 * alpha; }
        if (this.visibility.reserved && reserved[index]) { const alpha = reserved[index] / 255 * .55; r = r * (1 - alpha) + 201 * alpha; g = g * (1 - alpha) + 115 * alpha; b = b * (1 - alpha) + 211 * alpha; }
        if (this.visibility.roads && roads[index]) [r, g, b] = roads[index] === 1 ? [204, 169, 112] : [136, 98, 65];
        if (this.visibility.exclusion && exclusion[index]) { r = 185; g *= .5; b *= .5; }
        if (this.visibility.playable && playable[index] < 128) [r, g, b] = [40, 42, 44];
      }
      const offset = index * 4; data[offset] = clamp(r, 0, 255); data[offset + 1] = clamp(g, 0, 255); data[offset + 2] = clamp(b, 0, 255); data[offset + 3] = 255;
    }
    this.ctx.putImageData(image, 0, 0); this.renderOverlay();
  }

  renderOverlay() {
    const ctx = this.overlayCtx; ctx.clearRect(0, 0, this.width, this.length);
    if ($('mountain-canvas-guide').checked) this.drawMountainGuide(ctx);
    this.drawRoadRamps(ctx);
    this.drawWaterCourses(ctx);
    this.drawStructurePlacements(ctx);
    for (const marker of this.markers) {
      const color = marker.type === 'spawn' ? '#f1df5d' : marker.type === 'exit' ? '#ff5f5f' : '#da88e4'; const radius = Math.max(3, marker.radius);
      ctx.save(); ctx.strokeStyle = '#101713'; ctx.lineWidth = Math.max(3, this.width / 180); ctx.beginPath(); ctx.arc(marker.x + .5, marker.z + .5, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, this.width / 360); ctx.beginPath(); ctx.arc(marker.x + .5, marker.z + .5, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(marker.x + .5, marker.z + .5, Math.max(2.5, radius * .22), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (this.hover && this.markerTool && this.markerTool !== 'select') {
      const preview = this.markerPreviewPoint(this.hover); const color = this.markerTool === 'spawn' ? '#f1df5d' : this.markerTool === 'exit' ? '#ff5f5f' : '#da88e4'; const radius = Math.max(3, Number($('marker-radius').value) || 12);
      ctx.save(); ctx.setLineDash([Math.max(2, this.width / 128), Math.max(2, this.width / 128)]); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, this.width / 360); ctx.beginPath(); ctx.arc(preview.x + .5, preview.z + .5, radius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (this.hover && this.activeLayer === 'structures' && !this.markerTool) {
      const settings = this.structureSettings(); const radius = settings.brushSize / 2; ctx.save(); ctx.strokeStyle = settings.mode === 'erase' ? '#ff7878ee' : '#79dc8bee'; ctx.lineWidth = Math.max(.9, this.width / 600); ctx.setLineDash(settings.mode === 'populate' ? [Math.max(2, this.width / 450), Math.max(2, this.width / 450)] : []); ctx.beginPath(); ctx.arc(this.hover.x + .5, this.hover.z + .5, radius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if ($('grid-toggle').checked) { ctx.strokeStyle = '#ffffff24'; ctx.lineWidth = .5; const step = 16; for (let x = 0; x <= this.width; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.length); ctx.stroke(); } for (let z = 0; z <= this.length; z += step) { ctx.beginPath(); ctx.moveTo(0, z); ctx.lineTo(this.width, z); ctx.stroke(); } }
    if (this.hover && !this.markerTool && !this.plateauPickHeight && !this.activeRampKind() && !(this.activeLayer === 'water' && $('water-tool-mode').value === 'river') && this.activeLayer !== 'structures') {
      const settings = this.brushSettings(); const radius = settings.radius; const coreRadius = settings.coreRadius; const square = !settings.plateauMode && $('brush-shape').value === 'square';
      const drawProfileRing = (ringRadius, color, dash = []) => { if (ringRadius <= 0.15) return; ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.beginPath(); if (square) ctx.rect(this.hover.x - ringRadius, this.hover.z - ringRadius, ringRadius * 2, ringRadius * 2); else ctx.arc(this.hover.x, this.hover.z, ringRadius, 0, Math.PI * 2); ctx.stroke(); };
      ctx.lineWidth = Math.max(.8, this.width / 600);
      if (settings.plateauMode) {
        if (settings.plateau.supportEnabled) drawProfileRing(radius, '#66df8bee');
        drawProfileRing(settings.plateau.slopeEndRadius, '#ffffffee');
        drawProfileRing(coreRadius, '#ffdc78ff', [Math.max(1.5, this.width / 512), Math.max(1.5, this.width / 512)]);
      } else if (settings.waterMode) {
        drawProfileRing(radius + settings.water.shoreWidth, '#8ce3ffee');
        drawProfileRing(radius, '#2ca8f2ff', [Math.max(1.5, this.width / 512), Math.max(1.5, this.width / 512)]);
      } else if (settings.advanced) {
        drawProfileRing(radius, '#ffffffee');
        drawProfileRing(coreRadius, '#ffdc78ee', [Math.max(1.5, this.width / 512), Math.max(1.5, this.width / 512)]);
        const slopeEnd = coreRadius + settings.elevationProfile.slopeWidth;
        if (settings.elevationProfile.baseEnabled && slopeEnd > coreRadius + 0.05 && slopeEnd < radius - 0.05) drawProfileRing(slopeEnd, '#ff9b66ee', [Math.max(2, this.width / 384), Math.max(1, this.width / 640)]);
      } else {
        drawProfileRing(radius, '#ffffffee');
        if (coreRadius > 0.15 && coreRadius < radius - 0.05) drawProfileRing(coreRadius, '#ffdc78dd', [Math.max(1.5, this.width / 512), Math.max(1.5, this.width / 512)]);
      }
      ctx.setLineDash([]);
      if (this.lineStart) { ctx.strokeStyle = '#ffef9c'; ctx.beginPath(); ctx.moveTo(this.lineStart.x, this.lineStart.z); ctx.lineTo(this.hover.x, this.hover.z); ctx.stroke(); }
    }
  }

  applyZoom() {
    const zoom = Number($('zoom').value); $('zoom-value').textContent = `${zoom}%`; const requestedScale = zoom / 100; const minimumScale = 160 / Math.max(1, Math.min(this.width, this.length)); const scale = Math.max(requestedScale, minimumScale); const stage = $('canvas-stage'); stage.style.width = `${Math.round(this.width * scale)}px`; stage.style.height = `${Math.round(this.length * scale)}px`;
  }

  applyPreset() {
    const value = $('dimension-preset').value; if (value === 'custom') return; const [width, length] = value.split('x').map(Number); $('width').value = width; $('length').value = length; this.updateVoxelBudget(); this.updateMountainUi();
  }

  resizeFromInputs() {
    const newWidth = Number($('width').value); const newLength = Number($('length').value);
    if (![newWidth, newLength].every((value) => Number.isInteger(value) && value >= MIN_MAP_SIZE && value <= MAX_MAP_SIZE && value % 16 === 0)) { this.message(`Ancho y largo deben ser múltiplos de 16 entre ${MIN_MAP_SIZE} y ${MAX_MAP_SIZE}.`, true); return; }
    if (newWidth === this.width && newLength === this.length) return;
    if (!confirm(`Redimensionar de ${this.width}×${this.length} a ${newWidth}×${newLength}. Las capas se reescalarán por vecino más cercano.`)) return;
    const oldWidth = this.width; const oldLength = this.length;
    for (const name of Object.keys(LAYERS)) { const old = this.layers[name]; const next = new Uint8Array(newWidth * newLength); for (let z = 0; z < newLength; z += 1) { const sourceZ = Math.min(oldLength - 1, Math.round(z / Math.max(1, newLength - 1) * (oldLength - 1))); for (let x = 0; x < newWidth; x += 1) { const sourceX = Math.min(oldWidth - 1, Math.round(x / Math.max(1, newWidth - 1) * (oldWidth - 1))); next[z * newWidth + x] = old[sourceZ * oldWidth + sourceX]; } } this.layers[name] = next; }
    this.markers = this.markers.map((marker) => ({ ...marker, x: Math.round(marker.x / Math.max(1, oldWidth - 1) * (newWidth - 1)), z: Math.round(marker.z / Math.max(1, oldLength - 1) * (newLength - 1)) }));
    this.roadRamps = this.roadRamps.map((ramp) => ({ ...ramp, points: ramp.points.map((point) => ({ x: point.x / Math.max(1, oldWidth - 1) * (newWidth - 1), z: point.z / Math.max(1, oldLength - 1) * (newLength - 1) })) }));
    this.waterCourses = this.waterCourses.map((course) => ({ ...course, points: course.points.map((point) => ({ x: point.x / Math.max(1, oldWidth - 1) * (newWidth - 1), z: point.z / Math.max(1, oldLength - 1) * (newLength - 1) })) }));
    this.structurePlacements = this.structurePlacements.map((item) => ({ ...item, x: Math.round(item.x / Math.max(1, oldWidth - 1) * (newWidth - 1)), z: Math.round(item.z / Math.max(1, oldLength - 1) * (newLength - 1)) }));
    this.width = newWidth; this.length = newLength; this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; this.canvas.width = newWidth; this.canvas.height = newLength; this.overlay.width = newWidth; this.overlay.height = newLength; this.undoStack.length = 0; this.redoStack.length = 0; this.applyZoom(); this.markDirty(); this.render(); this.renderMarkers(); this.updateSizeInfo(); this.updateHistory(); this.updateMountainUi(); this.updatePlateauUi(); this.renderRoadRampList(); this.renderWaterCourseList(); this.updateWaterUi(); this.refreshStructureCollectionSelect(); this.updateStructureUi();
  }

  updateSizeInfo() { $('project-size').textContent = `${this.width} × ${this.length} celdas`; $('width').value = this.width; $('length').value = this.length; }

  collectConfig() {
    if ($('water-tool-mode').value === 'mass') this.rememberWaterControlSettings('mass'); const massWater = this.massWaterSettings || this.captureWaterControlSettings('mass');
    const config = {
      name: $('project-name').value.trim(), width: this.width, length: this.length, schematic_height: Number($('schematic-height').value), min_height: Number($('min-height').value), max_height: Number($('max-height').value), sea_level: Number($('sea-level').value),
      height_modifier_range: Number($('modifier-range').value), shore_width: massWater.shoreWidth, water_depth: massWater.depth, water_shore_profile: massWater.shoreProfile, water_road_policy: massWater.roadPolicy, max_walk_slope: Number($('max-walk-slope').value), surface_depth: Number($('surface-depth').value), data_version: Number($('data-version').value), seed: Number($('seed').value),
      mountain_border_enabled: $('mountain-border-enabled').checked, mountain_outer_width: Number($('mountain-outer-width').value), mountain_inner_transition: Number($('mountain-inner-transition').value), mountain_height: Number($('mountain-height').value), mountain_irregularity: Number($('mountain-irregularity').value), mountain_roughness: Number($('mountain-roughness').value), mountain_exit_width: Number($('mountain-exit-width').value), mountain_exit_transition: Number($('mountain-exit-transition').value), max_voxels: MAX_EXPORT_VOXELS,
    };
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(config.name)) throw new Error('El nombre solo admite letras, números, guion y guion bajo.');
    if (!(config.min_height < config.sea_level && config.sea_level < config.max_height && config.max_height < config.schematic_height)) throw new Error('Debe cumplirse: altura mínima < agua < altura máxima < altura schematic.');
    return config;
  }

  projectStructureSnapshot() {
    const placementCollectionIds = new Set(this.structurePlacements.map((item) => item.collection_id));
    const includedCollections = this.structureCollections.filter((collection) => (
      !this.libraryCollectionIds.has(collection.id) || placementCollectionIds.has(collection.id)
    ));
    const assetIds = new Set(this.structurePlacements.map((item) => item.asset_id));
    for (const collection of includedCollections) for (const member of collection.members || []) assetIds.add(member.asset_id);
    return {
      assets: this.structureAssets.filter((asset) => assetIds.has(asset.id)),
      collections: includedCollections,
      placements: this.structurePlacements,
    };
  }

  projectDocument() {
    const layers = {}; for (const [name, array] of Object.entries(this.layers)) layers[name] = { encoding: 'rle-u8', data: encodeRle(array) };
    const structures = this.projectStructureSnapshot();
    return { format: 'jkr-terrain-project', version: 2, config: this.collectConfig(), layers, markers: structuredClone(this.markers), road_ramps: structuredClone(this.roadRamps), water_courses: structuredClone(this.waterCourses), structure_assets: structuredClone(structures.assets), structure_collections: structuredClone(structures.collections), structure_placements: structuredClone(structures.placements) };
  }

  saveProject() {
    try { const project = this.projectDocument(); downloadJson(`${project.config.name}.jkrterrain.json`, project); this.dirty = false; $('dirty-badge').textContent = 'Guardado'; $('dirty-badge').className = 'badge ok'; this.message('Proyecto guardado.'); }
    catch (error) { this.message(error.message, true); }
  }

  async loadProject(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const project = JSON.parse(await file.text()); if (project.format !== 'jkr-terrain-project' || project.version !== 2) throw new Error('Formato de proyecto no compatible.');
      const config = project.config; const width = Number(config.width); const length = Number(config.length); const expected = width * length;
      if (width < MIN_MAP_SIZE || width > MAX_MAP_SIZE || length < MIN_MAP_SIZE || length > MAX_MAP_SIZE || width % 16 || length % 16) throw new Error('Dimensiones inválidas.');
      const decoded = {}; for (const name of Object.keys(LAYERS)) { if (!project.layers?.[name]) { if (name === 'structures') { decoded[name] = new Uint8Array(expected); continue; } throw new Error(`Falta la capa ${name}.`); } decoded[name] = decodeRle(project.layers[name].data, expected); }
      this.width = width; this.length = length; this.layers = decoded; this.markers = Array.isArray(project.markers) ? project.markers : []; this.roadRamps = Array.isArray(project.road_ramps) ? project.road_ramps.map((ramp) => ({ kind: ramp.kind === 'terrain' ? 'terrain' : 'road', ...ramp })) : []; this.waterCourses = Array.isArray(project.water_courses) ? project.water_courses : []; this.structureAssets = Array.isArray(project.structure_assets) ? project.structure_assets : []; this.structureCollections = Array.isArray(project.structure_collections) ? project.structure_collections : []; this.structurePlacements = Array.isArray(project.structure_placements) ? project.structure_placements : []; this.roadRampDraft = []; this.roadRampDraftKind = null; this.roadRampEditingId = null; this.selectedRoadRampId = null; this.waterCourseDraft = []; this.waterCourseEditingId = null; this.selectedWaterCourseId = null; this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; for (const name of Object.keys(LAYERS)) { this.visibility[name] = true; this.locked[name] = false; } this.buildLayerList();
      try { await this.loadStructureLibrary({ merge: true }); } catch (error) { this.setLibraryStatus(`Sin conexión: ${error.message}`, true); }
      this.canvas.width = width; this.canvas.height = length; this.overlay.width = width; this.overlay.height = length; this.setConfigInputs(config); this.undoStack.length = 0; this.redoStack.length = 0; this.applyZoom(); this.render(); this.renderMarkers(); this.updateSizeInfo(); this.updateHistory(); this.updatePlateauUi(); this.renderRoadRampList(); this.renderWaterCourseList(); this.updateWaterUi(); this.refreshStructureCollectionSelect(); this.updateStructureUi(); this.dirty = false; $('dirty-badge').textContent = 'Cargado'; $('dirty-badge').className = 'badge ok'; this.message(`Proyecto ${file.name} cargado.`);
    } catch (error) { this.message(`No se pudo abrir: ${error.message}`, true); }
    finally { event.target.value = ''; }
  }

  setConfigInputs(config) {
    const mapping = { name: 'project-name', seed: 'seed', width: 'width', length: 'length', schematic_height: 'schematic-height', min_height: 'min-height', max_height: 'max-height', sea_level: 'sea-level', height_modifier_range: 'modifier-range', max_walk_slope: 'max-walk-slope', surface_depth: 'surface-depth', data_version: 'data-version', mountain_outer_width: 'mountain-outer-width', mountain_inner_transition: 'mountain-inner-transition', mountain_height: 'mountain-height', mountain_irregularity: 'mountain-irregularity', mountain_roughness: 'mountain-roughness', mountain_exit_width: 'mountain-exit-width', mountain_exit_transition: 'mountain-exit-transition' };
    for (const [key, id] of Object.entries(mapping)) if (config[key] !== undefined) $(id).value = config[key];
    this.massWaterSettings = normalizeWaterSettings({ mode: 'mass', action: 'paint', width: this.massWaterSettings?.width ?? 10, depth: config.water_depth ?? 3, shoreWidth: config.shore_width ?? 5, shoreProfile: config.water_shore_profile ?? 'natural', roadPolicy: config.water_road_policy ?? 'protect' });
    if ($('water-tool-mode').value === 'mass') this.applyWaterControlSettings(this.massWaterSettings);
    $('mountain-border-enabled').checked = Boolean(config.mountain_border_enabled); this.updateVoxelBudget(); this.updateMountainUi(); this.updateWaterUi();
  }

  async newProject() {
    if (this.dirty && !confirm('Crear un proyecto nuevo descartará los cambios no guardados.')) return;
    this.width = Number($('width').value) || 256; this.length = Number($('length').value) || 256;
    this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; this.initializeLayers(); this.buildLayerList();
    this.markers = []; this.roadRamps = []; this.waterCourses = []; this.structureAssets = []; this.structureCollections = []; this.structurePlacements = []; this.libraryCollectionIds = new Set();
    this.roadRampDraft = []; this.roadRampDraftKind = null; this.roadRampEditingId = null; this.selectedRoadRampId = null; this.waterCourseDraft = []; this.waterCourseEditingId = null; this.selectedWaterCourseId = null;
    this.undoStack.length = 0; this.redoStack.length = 0; this.canvas.width = this.width; this.canvas.height = this.length; this.overlay.width = this.width; this.overlay.height = this.length;
    try { await this.loadStructureLibrary({ merge: false }); } catch (error) { this.setLibraryStatus(`Sin conexión: ${error.message}`, true); }
    this.applyZoom(); this.markDirty(); this.render(); this.renderMarkers(); this.updateSizeInfo(); this.updateHistory(); this.updateMountainUi(); this.updatePlateauUi(); this.renderRoadRampList(); this.renderWaterCourseList(); this.updateWaterUi(); this.refreshStructureCollectionSelect(); this.updateStructureUi(); this.message('Proyecto nuevo creado con la biblioteca central disponible.');
  }

  async compile(exportSchematic) {
    let project; try { project = this.projectDocument(); } catch (error) { this.message(error.message, true); return; }
    const button = exportSchematic ? $('export-schematic') : $('compile-preview'); const original = button.textContent; button.disabled = true; button.textContent = exportSchematic ? 'Exportando…' : 'Compilando…'; this.message('Compilando capas…');
    try {
      const response = await fetch('/api/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, export_schematic: exportSchematic }) });
      const payload = await response.json(); if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail));
      this.compiledFiles = payload.files; this.renderValidation(payload.validation); this.renderDownloads(payload.files); this.selectPreview('preview'); this.message(exportSchematic ? 'Schematic generado correctamente.' : 'Vista compilada correctamente.');
    } catch (error) { this.message(`Error de compilación: ${error.message}`, true); }
    finally { button.disabled = false; button.textContent = original; }
  }

  renderValidation(validation) {
    const status = $('validation-status'); status.textContent = validation.status === 'ok' ? 'Aprobada' : 'Con errores'; status.className = `badge ${validation.status === 'ok' ? 'ok' : 'error'}`;
    const borderText = validation.mountain_border?.enabled ? ` · borde: ${validation.mountain_border.strong_cells.toLocaleString('es-CL')} celdas fuertes` : '';
    const rampText = validation.road_ramps?.count ? ` · rampas viales ${validation.road_ramps.valid}/${validation.road_ramps.count}` : '';
    const terrainRampText = validation.terrain_ramps?.count ? ` · rampas de meseta ${validation.terrain_ramps.valid}/${validation.terrain_ramps.count}` : '';
    const waterText = validation.water_system?.course_count ? ` · ríos ${validation.water_system.course_count}${validation.water_system.exit_count ? ` (${validation.water_system.exit_count} salida)` : ''}` : '';
    $('validation-summary').textContent = `${validation.detected_exits.length} salida(s) detectada(s) · ${validation.road_components} componente(s) vial(es) · ${(validation.walkable_ratio * 100).toFixed(1)}% transitable · salto vial máximo ${validation.maximum_road_step}${rampText}${terrainRampText}${waterText}${borderText}.`;
    const list = $('validation-issues'); list.replaceChildren();
    if (!validation.issues.length) { const ok = document.createElement('div'); ok.className = 'issue'; ok.textContent = 'No se detectaron problemas estructurales principales.'; list.append(ok); }
    for (const issue of validation.issues) { const item = document.createElement('div'); item.className = `issue ${issue.severity}`; item.textContent = issue.message; list.append(item); }
  }

  renderDownloads(files) {
    const links = $('download-links'); links.replaceChildren(); const labels = { preview: 'Vista PNG', heightmap: 'Heightmap', slope: 'Pendiente', walkability: 'Transitabilidad', terrain3d: 'Datos de vista 3D', voxel3d: 'Manifiesto de vista Minecraft', validation: 'Validación JSON', metadata: 'Metadatos', schematic: 'Descargar .schem' };
    for (const [key, url] of Object.entries(files)) { const anchor = document.createElement('a'); anchor.href = url; anchor.textContent = labels[key] || key; if (!url.endsWith('.png')) anchor.download = ''; links.append(anchor); }
  }

  selectPreview(key) {
    this.activePreview = key;
    document.querySelectorAll('[data-preview]').forEach((button) => button.classList.toggle('active', button.dataset.preview === key));
    const image = $('result-preview'); const view3d = $('terrain-3d-view'); const voxelView = $('voxel-3d-view'); const url = this.compiledFiles?.[key];
    const is3d = key === 'terrain3d'; const isVoxel = key === 'voxel3d';
    if (!is3d) this.viewer3d.setExpanded(false); if (!isVoxel) this.voxelViewer.setExpanded(false);
    image.hidden = is3d || isVoxel; view3d.hidden = !is3d; voxelView.hidden = !isVoxel;
    if (is3d) {
      if (url) this.viewer3d.load(url); else $('terrain-3d-status').textContent = 'Compila el proyecto para generar la vista 3D.';
    } else if (isVoxel) {
      if (url) this.voxelViewer.load(url); else $('voxel-3d-status').textContent = 'Compila el proyecto para generar la vista Minecraft.';
    } else if (url) image.src = `${url}?t=${Date.now()}`;
  }

  updateMountainUi() {
    const enabled = $('mountain-border-enabled').checked;
    $('mountain-settings').classList.toggle('disabled-group', !enabled);
    $('mountain-settings').querySelectorAll('input').forEach((input) => { input.disabled = !enabled; });
    const status = $('mountain-status'); status.textContent = enabled ? 'Activado' : 'Desactivado'; status.className = `badge ${enabled ? 'ok' : 'neutral'}`;
    const margin = Number($('mountain-outer-width').value) || 0; const usableWidth = this.width - margin * 2; const usableLength = this.length - margin * 2;
    $('mountain-margin-info').textContent = enabled ? `Margen propuesto: ${margin} bloques · zona central aproximada ${Math.max(0, usableWidth)} × ${Math.max(0, usableLength)}.` : 'Activa el borde para generar la cordillera durante la compilación.';
  }

  prepareMountainMargin() {
    const margin = Math.round(Number($('mountain-outer-width').value));
    if (!Number.isInteger(margin) || margin < 4 || margin * 2 >= Math.min(this.width, this.length) - 16) { this.message('El margen debe dejar al menos 16 bloques de zona central.', true); return; }
    if (!confirm(`Se marcarán como no jugables ${margin} bloques alrededor del lienzo. El interior existente se conservará. ¿Continuar?`)) return;
    const layer = this.layers.playable; const changes = [];
    for (let z = 0; z < this.length; z += 1) for (let x = 0; x < this.width; x += 1) {
      if (x >= margin && x < this.width - margin && z >= margin && z < this.length - margin) continue;
      const index = z * this.width + x; if (layer[index] !== 0) { changes.push([index, layer[index], 0]); layer[index] = 0; }
    }
    if (changes.length) this.pushHistory({ type: 'cells', layer: 'playable', changes });
    else this.markDirty();
    this.playableBoundaryCache = null; this.playableBoundaryPathCache = null; $('mountain-border-enabled').checked = true; this.updateMountainUi(); this.setActiveLayer('playable'); this.render(); this.renderMarkers(); this.message(`Margen montañoso de ${margin} bloques preparado. Coloca marcadores de salida y compila la vista.`);
  }

  drawMountainGuide(ctx) {
    const playable = this.layers.playable; if (!playable?.length) return;
    const enabled = $('mountain-border-enabled').checked; const lineWidth = Math.max(0.7, this.width / 700);
    ctx.save(); ctx.lineWidth = lineWidth; ctx.strokeStyle = enabled ? '#ffb45eee' : '#d97d7dcc';
    if (!this.playableBoundaryPathCache) {
      const path = new Path2D();
      for (let z = 0; z < this.length; z += 1) for (let x = 0; x < this.width; x += 1) {
        const index = z * this.width + x; if (playable[index] < 128) continue;
        if (z === 0 || playable[index - this.width] < 128) { path.moveTo(x, z); path.lineTo(x + 1, z); }
        if (z === this.length - 1 || playable[index + this.width] < 128) { path.moveTo(x, z + 1); path.lineTo(x + 1, z + 1); }
        if (x === 0 || playable[index - 1] < 128) { path.moveTo(x, z); path.lineTo(x, z + 1); }
        if (x === this.width - 1 || playable[index + 1] < 128) { path.moveTo(x + 1, z); path.lineTo(x + 1, z + 1); }
      }
      this.playableBoundaryPathCache = path;
    }
    ctx.stroke(this.playableBoundaryPathCache);
    if (enabled) {
      ctx.setLineDash([3, 2]); ctx.strokeStyle = '#75b9ffcc';
      for (const marker of this.markers.filter((item) => item.type === 'exit')) { ctx.beginPath(); ctx.arc(marker.x + .5, marker.z + .5, Math.max(2, Number($('mountain-exit-width').value) / 2), 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.restore();
  }

  updateVoxelBudget() {
    const width = Number($('width').value) || 0; const length = Number($('length').value) || 0; const height = Number($('schematic-height').value) || 0; const voxels = width * length * height; const budget = $('voxel-budget');
    const level = voxels > MAX_EXPORT_VOXELS ? 'error' : voxels > EXPORT_WARNING_VOXELS ? 'warning' : 'ok';
    const suffix = level === 'error' ? ' Supera el límite de exportación.' : level === 'warning' ? ' Exportación grande: puede tardar y generar un archivo pesado.' : ' Volumen dentro del rango normal.';
    budget.textContent = `Volumen de exportación: ${voxels.toLocaleString('es-CL')} bloques. Límite: ${MAX_EXPORT_VOXELS.toLocaleString('es-CL')}.${suffix}`;
    budget.classList.toggle('warning', level === 'warning'); budget.classList.toggle('error', level === 'error');
  }

  markDirty() { this.dirty = true; $('dirty-badge').textContent = 'Sin guardar'; $('dirty-badge').className = 'badge'; }
  message(text, error = false) { $('editor-message').textContent = text; $('editor-message').style.color = error ? '#ff9a9a' : ''; }
}

const help = await initializeHelp();
const editor = new TerrainEditor(help);
window.terrainEditor = editor;
