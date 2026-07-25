const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STORAGE_KEY = 'jkr-terrain-ui-v5';

function readUiState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch (_) { return {}; }
}

function writeUiState(patch) {
  try {
    const current = readUiState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (_) { /* La interfaz sigue funcionando sin persistencia. */ }
}


const splitterRefreshers = [];
let splitterRefreshFrame = 0;

function refreshResizableSplitters() {
  if (splitterRefreshFrame) return;
  splitterRefreshFrame = requestAnimationFrame(() => {
    splitterRefreshFrame = 0;
    splitterRefreshers.forEach((refresh) => refresh());
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function bindResizableSplitter({
  splitterId,
  containerSelector,
  getAxis,
  getStorageKey,
  getCssVariable,
  defaultRatio,
  getMinimums,
}) {
  const splitter = document.getElementById(splitterId);
  const container = document.querySelector(containerSelector);
  if (!splitter || !container) return;

  let drag = null;
  let ratio = Number(readUiState()[getStorageKey()]);
  if (!Number.isFinite(ratio)) ratio = defaultRatio;

  const apply = (nextRatio = ratio) => {
    if (container.hidden || container.getClientRects().length === 0) return;
    const axis = getAxis();
    const rect = container.getBoundingClientRect();
    const splitterRect = splitter.getBoundingClientRect();
    const total = axis === 'y'
      ? rect.height - splitterRect.height
      : rect.width - splitterRect.width;
    if (total <= 0) return;

    const { start, end } = getMinimums(axis);
    const maximumStart = Math.max(start, total - end);
    const startSize = clamp(total * nextRatio, start, maximumStart);
    ratio = total ? startSize / total : defaultRatio;
    container.style.setProperty(getCssVariable(axis), `${Math.round(startSize)}px`);
    splitter.setAttribute('aria-orientation', axis === 'y' ? 'horizontal' : 'vertical');
    splitter.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  };

  const finishDrag = (event) => {
    if (!drag) return;
    if (event?.pointerId != null && event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId;
    drag = null;
    document.body.classList.remove('ui-resizing-row', 'ui-resizing-column');
    try {
      if (splitter.hasPointerCapture?.(pointerId)) splitter.releasePointerCapture(pointerId);
    } catch (_) { /* La captura ya pudo ser liberada por el navegador. */ }
    writeUiState({ [getStorageKey()]: ratio });
    notifyViewportResize();
  };

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const axis = getAxis();
    const rect = container.getBoundingClientRect();
    const splitterRect = splitter.getBoundingClientRect();
    const total = axis === 'y'
      ? rect.height - splitterRect.height
      : rect.width - splitterRect.width;
    if (total <= 0) return;
    drag = { pointerId: event.pointerId, axis, rect, total };
    splitter.setPointerCapture?.(event.pointerId);
    document.body.classList.add(axis === 'y' ? 'ui-resizing-row' : 'ui-resizing-column');
  });

  const moveDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pointerPosition = drag.axis === 'y' ? event.clientY - drag.rect.top : event.clientX - drag.rect.left;
    apply(pointerPosition / drag.total);
  };

  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
  window.addEventListener('blur', finishDrag);
  splitter.addEventListener('lostpointercapture', finishDrag);

  splitter.addEventListener('keydown', (event) => {
    const axis = getAxis();
    const decrease = axis === 'y' ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
    const increase = axis === 'y' ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
    if (!decrease && !increase && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (event.key === 'Home') ratio = 0.18;
    else if (event.key === 'End') ratio = 0.82;
    else ratio += decrease ? -0.03 : 0.03;
    apply(ratio);
    writeUiState({ [getStorageKey()]: ratio });
  });

  const refresh = () => {
    if (!drag) {
      const stored = Number(readUiState()[getStorageKey()]);
      if (Number.isFinite(stored)) ratio = stored;
    }
    apply(ratio);
  };
  splitterRefreshers.push(refresh);
  refresh();
}


function getResultsDockMode() {
  return document.body.classList.contains('results-dock-right') ? 'right' : 'bottom';
}

function notifyViewportResize() {
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function setResultsDock(mode, persist = true) {
  const compact = matchMedia('(max-width: 900px)').matches;
  const requested = mode === 'right' ? 'right' : 'bottom';
  const resolved = compact && requested === 'right' ? 'bottom' : requested;

  document.body.classList.toggle('results-dock-right', resolved === 'right');
  document.body.classList.toggle('results-dock-bottom', resolved === 'bottom');
  $$('[data-results-dock]').forEach((button) => {
    const active = button.dataset.resultsDock === resolved;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = compact && button.dataset.resultsDock === 'right';
  });

  if (persist) writeUiState({ resultsDock: requested });
  refreshResizableSplitters();
  notifyViewportResize();
}

function bindResultsDrawerSize() {
  const splitter = document.getElementById('results-drawer-resizer');
  const drawer = document.getElementById('results-drawer');
  if (!splitter || !drawer) return;

  let height = Number(readUiState().resultsDrawerHeight);
  let width = Number(readUiState().resultsDrawerWidth);
  let drag = null;

  const topbarHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-topbar-height')) || 42;
  const minimumHeight = () => matchMedia('(max-width: 700px)').matches ? 210 : 150;
  const editorMinimumHeight = () => matchMedia('(max-width: 700px)').matches ? 96 : 120;
  const maximumHeight = () => Math.max(
    minimumHeight(),
    window.innerHeight - topbarHeight() - editorMinimumHeight(),
  );
  const defaultHeight = () => Math.min(window.innerHeight * (matchMedia('(max-width: 700px)').matches ? 0.70 : 0.52), 520);
  const minimumWidth = () => Math.min(360, Math.max(260, window.innerWidth * 0.24));
  const editorMinimumWidth = () => Math.min(420, Math.max(300, window.innerWidth * 0.32));
  const maximumWidth = () => Math.max(minimumWidth(), window.innerWidth - editorMinimumWidth());
  const defaultWidth = () => Math.min(window.innerWidth * 0.44, 720);

  const apply = () => {
    const mode = getResultsDockMode();
    if (mode === 'right') {
      const resolved = Number.isFinite(width) ? width : defaultWidth();
      width = clamp(resolved, minimumWidth(), maximumWidth());
      document.documentElement.style.setProperty('--ui-results-drawer-width', `${Math.round(width)}px`);
      splitter.setAttribute('aria-orientation', 'vertical');
      splitter.setAttribute('aria-label', 'Cambiar anchura del panel de validación y resultados');
      splitter.setAttribute('aria-valuemin', String(Math.round(minimumWidth())));
      splitter.setAttribute('aria-valuemax', String(Math.round(maximumWidth())));
      splitter.setAttribute('aria-valuenow', String(Math.round(width)));
      splitter.setAttribute('aria-valuetext', `${Math.round(width)} píxeles de ancho`);
    } else {
      const resolved = Number.isFinite(height) ? height : defaultHeight();
      height = clamp(resolved, minimumHeight(), maximumHeight());
      document.documentElement.style.setProperty('--ui-results-drawer-height', `${Math.round(height)}px`);
      splitter.setAttribute('aria-orientation', 'horizontal');
      splitter.setAttribute('aria-label', 'Cambiar altura del panel de validación y resultados');
      splitter.setAttribute('aria-valuemin', String(Math.round(minimumHeight())));
      splitter.setAttribute('aria-valuemax', String(Math.round(maximumHeight())));
      splitter.setAttribute('aria-valuenow', String(Math.round(height)));
      splitter.setAttribute('aria-valuetext', `${Math.round(height)} píxeles de alto`);
    }
  };

  const finishDrag = (event) => {
    if (!drag) return;
    if (event?.pointerId != null && event.pointerId !== drag.pointerId) return;
    const { pointerId, mode } = drag;
    drag = null;
    document.body.classList.remove('ui-resizing-results-drawer-row', 'ui-resizing-results-drawer-column');
    try {
      if (splitter.hasPointerCapture?.(pointerId)) splitter.releasePointerCapture(pointerId);
    } catch (_) { /* La captura ya pudo ser liberada por el navegador. */ }
    if (mode === 'right') writeUiState({ resultsDrawerWidth: Math.round(width) });
    else writeUiState({ resultsDrawerHeight: Math.round(height) });
    notifyViewportResize();
  };

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const mode = getResultsDockMode();
    const rect = drawer.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };
    splitter.setPointerCapture?.(event.pointerId);
    document.body.classList.add(mode === 'right' ? 'ui-resizing-results-drawer-column' : 'ui-resizing-results-drawer-row');
  });

  const moveDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'right') width = drag.startWidth + (drag.startX - event.clientX);
    else height = drag.startHeight + (drag.startY - event.clientY);
    apply();
  };

  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
  window.addEventListener('blur', finishDrag);
  splitter.addEventListener('lostpointercapture', finishDrag);

  splitter.addEventListener('keydown', (event) => {
    const mode = getResultsDockMode();
    const step = event.shiftKey ? 80 : 24;
    const validKeys = mode === 'right'
      ? ['ArrowLeft', 'ArrowRight', 'Home', 'End']
      : ['ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!validKeys.includes(event.key)) return;
    event.preventDefault();

    if (mode === 'right') {
      if (event.key === 'ArrowLeft') width += step;
      else if (event.key === 'ArrowRight') width -= step;
      else if (event.key === 'Home') width = minimumWidth();
      else width = maximumWidth();
      apply();
      writeUiState({ resultsDrawerWidth: Math.round(width) });
    } else {
      if (event.key === 'ArrowUp') height += step;
      else if (event.key === 'ArrowDown') height -= step;
      else if (event.key === 'Home') height = minimumHeight();
      else height = maximumHeight();
      apply();
      writeUiState({ resultsDrawerHeight: Math.round(height) });
    }
    notifyViewportResize();
  });

  splitter.addEventListener('dblclick', () => {
    if (getResultsDockMode() === 'right') {
      width = defaultWidth();
      apply();
      writeUiState({ resultsDrawerWidth: Math.round(width) });
    } else {
      height = defaultHeight();
      apply();
      writeUiState({ resultsDrawerHeight: Math.round(height) });
    }
    notifyViewportResize();
  });

  const refresh = () => {
    if (!drag) {
      const state = readUiState();
      const storedHeight = Number(state.resultsDrawerHeight);
      const storedWidth = Number(state.resultsDrawerWidth);
      if (Number.isFinite(storedHeight)) height = storedHeight;
      if (Number.isFinite(storedWidth)) width = storedWidth;
    }
    apply();
  };
  splitterRefreshers.push(refresh);
  refresh();
}

function bindResizableSplitters() {
  bindResizableSplitter({
    splitterId: 'inspector-splitter',
    containerSelector: '#inspector-dock',
    getAxis: () => 'y',
    getStorageKey: () => 'inspectorSplitRatio',
    getCssVariable: () => '--ui-inspector-navigation-size',
    defaultRatio: 0.40,
    getMinimums: () => ({ start: 110, end: 125 }),
  });

  const compactResults = matchMedia('(max-width: 700px)');
  bindResizableSplitter({
    splitterId: 'results-splitter',
    containerSelector: '#results-drawer .results-drawer-content',
    getAxis: () => getResultsDockMode() === 'right' || compactResults.matches ? 'y' : 'x',
    getStorageKey: () => {
      if (getResultsDockMode() === 'right') return 'resultsSplitRatioRight';
      return compactResults.matches ? 'resultsSplitRatioMobile' : 'resultsSplitRatioDesktop';
    },
    getCssVariable: (axis) => axis === 'y' ? '--ui-validation-height' : '--ui-validation-width',
    defaultRatio: getResultsDockMode() === 'right' ? 0.24 : (compactResults.matches ? 0.25 : 0.22),
    getMinimums: (axis) => axis === 'y'
      ? ({ start: 80, end: getResultsDockMode() === 'right' ? 180 : 170 })
      : ({ start: 120, end: 220 }),
  });
  compactResults.addEventListener?.('change', refreshResizableSplitters);
  bindResultsDrawerSize();
  addEventListener('resize', refreshResizableSplitters);
}

function setTab(group, targetId, persist = true) {
  const buttons = $$(`[data-dock-group="${group}"]`);
  if (!buttons.length) return;
  for (const button of buttons) {
    const active = button.dataset.dockTarget === targetId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    const panel = document.getElementById(button.dataset.dockTarget);
    if (panel) {
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    }
  }
  if (persist) writeUiState({ [`tab-${group}`]: targetId });
}

function bindTabs() {
  $$('[data-dock-target]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.dockGroup, button.dataset.dockTarget));
  });
  const state = readUiState();
  for (const group of ['navigation', 'properties']) {
    const remembered = state[`tab-${group}`];
    const fallback = $(`[data-dock-group="${group}"].active`)?.dataset.dockTarget;
    if (remembered && document.getElementById(remembered)) setTab(group, remembered, false);
    else if (fallback) setTab(group, fallback, false);
  }
}

function setProjectOpen(open) {
  const drawer = $('#project-drawer');
  const buttons = $$('[data-ui-action="project"]');
  if (!drawer) return;
  drawer.hidden = !open;
  document.body.classList.toggle('project-open', open);
  buttons.forEach((button) => button.setAttribute('aria-pressed', String(open)));
  updateBackdrop();
  refreshResizableSplitters();
  if (open) drawer.querySelector('input, select, button')?.focus({ preventScroll: true });
}

function setResultsOpen(open) {
  const drawer = $('#results-drawer');
  const buttons = $$('[data-ui-action="results"]');
  if (!drawer) return;
  drawer.hidden = !open;
  document.body.classList.toggle('results-open', open);
  buttons.forEach((button) => button.setAttribute('aria-pressed', String(open)));
  writeUiState({ resultsOpen: open });
  updateBackdrop();
  refreshResizableSplitters();
}

function setInspectorCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('inspector-collapsed', collapsed);
  document.body.classList.toggle('inspector-open', !collapsed);
  const buttons = $$('[data-ui-action="inspector"]');
  buttons.forEach((button) => button.setAttribute('aria-pressed', String(!collapsed)));
  if (persist) writeUiState({ inspectorCollapsed: collapsed });
  updateBackdrop();
  refreshResizableSplitters();
}

function updateBackdrop() {
  const backdrop = $('#ui-backdrop');
  if (!backdrop) return;
  const mobileInspectorOpen = matchMedia('(max-width: 900px)').matches && !document.body.classList.contains('inspector-collapsed');
  const visible = document.body.classList.contains('project-open') || mobileInspectorOpen;
  backdrop.hidden = !visible;
}

function closeTransientPanels() {
  setProjectOpen(false);
  if (matchMedia('(max-width: 900px)').matches) setInspectorCollapsed(true, false);
}

function bindShellActions() {
  $$('[data-ui-action="project"]').forEach((button) => button.addEventListener('click', () => setProjectOpen(!document.body.classList.contains('project-open'))));
  $$('[data-ui-action="results"]').forEach((button) => button.addEventListener('click', () => setResultsOpen(!document.body.classList.contains('results-open'))));
  $$('[data-ui-action="inspector"]').forEach((button) => button.addEventListener('click', () => setInspectorCollapsed(!document.body.classList.contains('inspector-collapsed'))));
  $$('[data-results-dock]').forEach((button) => button.addEventListener('click', () => setResultsDock(button.dataset.resultsDock)));
  $$('[data-close-drawer="project"]').forEach((button) => button.addEventListener('click', () => setProjectOpen(false)));
  $$('[data-close-drawer="results"]').forEach((button) => button.addEventListener('click', () => setResultsOpen(false)));
  $('#ui-backdrop')?.addEventListener('click', closeTransientPanels);

  $('#compile-preview')?.addEventListener('click', () => setResultsOpen(true));
  $('#export-schematic')?.addEventListener('click', () => setResultsOpen(true));
  $('#new-project')?.addEventListener('click', () => setProjectOpen(true));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.body.classList.contains('project-open')) setProjectOpen(false);
      else if (document.body.classList.contains('results-open')) setResultsOpen(false);
      else if (matchMedia('(max-width: 900px)').matches && !document.body.classList.contains('inspector-collapsed')) setInspectorCollapsed(true, false);
    }
    if (event.key === 'F1') {
      const focused = document.activeElement;
      const helpButton = focused?.closest('label[data-help]')?.querySelector('.help-button');
      if (helpButton) {
        event.preventDefault();
        helpButton.click();
      }
    }
  });

  const state = readUiState();
  const mobile = matchMedia('(max-width: 900px)').matches;
  setResultsDock(state.resultsDock || 'bottom', false);
  setInspectorCollapsed(mobile ? true : Boolean(state.inspectorCollapsed), false);
  setResultsOpen(Boolean(state.resultsOpen));
  setProjectOpen(false);

  const media = matchMedia('(max-width: 900px)');
  media.addEventListener?.('change', (event) => {
    if (event.matches) {
      setInspectorCollapsed(true, false);
      setResultsDock('bottom', false);
    } else {
      setInspectorCollapsed(Boolean(readUiState().inspectorCollapsed), false);
      setResultsDock(readUiState().resultsDock || 'bottom', false);
    }
  });
}

function createSegmentedControl(select) {
  if (!select || select.dataset.segmentedReady === 'true') return;
  select.dataset.segmentedReady = 'true';
  select.classList.add('segmented-source');
  const control = document.createElement('div');
  control.className = 'segmented-control';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', select.closest('label')?.innerText?.trim() || 'Selector de herramienta');
  select.insertAdjacentElement('afterend', control);

  const render = () => {
    control.replaceChildren();
    for (const option of Array.from(select.options)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segment-button';
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      button.setAttribute('aria-label', `Selecciona: ${option.textContent}`);
      const active = select.value === option.value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = option.disabled || select.disabled;
      button.addEventListener('click', () => {
        if (select.value === option.value) return;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
        sync();
      });
      control.append(button);
    }
  };
  const sync = () => {
    for (const button of control.children) {
      const active = button.dataset.value === select.value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.disabled = select.disabled;
    }
  };

  select.addEventListener('change', sync);
  select.addEventListener('input', sync);
  new MutationObserver(render).observe(select, { childList: true, subtree: true, attributes: true });
  render();
}

function enhanceToolSelectors() {
  const ids = [
    'plateau-tool-mode', 'plateau-action', 'road-tool-mode', 'water-tool-mode', 'water-mass-action',
    'structure-tool-mode', 'brush-action',
  ];
  ids.forEach((id) => createSegmentedControl(document.getElementById(id)));
}

function observeEditorState() {
  const activeLayer = $('#active-layer-title');
  if (activeLayer) {
    new MutationObserver(() => {
      setTab('properties', 'tool-dock-panel');
      if (matchMedia('(max-width: 900px)').matches) setInspectorCollapsed(false, false);
    }).observe(activeLayer, { childList: true, characterData: true, subtree: true });
  }

  const resultImage = $('#result-preview');
  if (resultImage) {
    new MutationObserver(() => {
      if (resultImage.getAttribute('src')) setResultsOpen(true);
    }).observe(resultImage, { attributes: true, attributeFilter: ['src'] });
  }

  const validation = $('#validation-status');
  if (validation) {
    new MutationObserver(() => {
      if (!/sin compilar/i.test(validation.textContent || '')) setResultsOpen(true);
    }).observe(validation, { childList: true, characterData: true, subtree: true });
  }
}

function labelIconButtons() {
  const fallback = new Map([
    ['show-all', 'Mostrar todas las capas'],
    ['randomize-seed', 'Generar semilla aleatoria'],
    ['terrain-3d-reset', 'Recentrar vista 3D'],
    ['terrain-3d-expand', 'Ampliar vista 3D'],
    ['voxel-3d-reset', 'Recentrar vista Minecraft'],
    ['voxel-3d-expand', 'Ampliar vista Minecraft'],
  ]);
  for (const [id, label] of fallback) {
    const element = document.getElementById(id);
    if (element && !element.getAttribute('aria-label')) element.setAttribute('aria-label', label);
  }
}

bindTabs();
bindResizableSplitters();
bindShellActions();
enhanceToolSelectors();
observeEditorState();
labelIconButtons();
