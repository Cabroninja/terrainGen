const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STORAGE_KEY = 'jkr-terrain-ui-v4';

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
}

function setInspectorCollapsed(collapsed, persist = true) {
  document.body.classList.toggle('inspector-collapsed', collapsed);
  document.body.classList.toggle('inspector-open', !collapsed);
  const buttons = $$('[data-ui-action="inspector"]');
  buttons.forEach((button) => button.setAttribute('aria-pressed', String(!collapsed)));
  if (persist) writeUiState({ inspectorCollapsed: collapsed });
  updateBackdrop();
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
  setInspectorCollapsed(mobile ? true : Boolean(state.inspectorCollapsed), false);
  setResultsOpen(Boolean(state.resultsOpen));
  setProjectOpen(false);

  const media = matchMedia('(max-width: 900px)');
  media.addEventListener?.('change', (event) => {
    if (event.matches) setInspectorCollapsed(true, false);
    else setInspectorCollapsed(Boolean(readUiState().inspectorCollapsed), false);
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
      button.title = `Selecciona: ${option.textContent}`;
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
    'plateau-action', 'road-tool-mode', 'water-tool-mode', 'water-mass-action',
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
bindShellActions();
enhanceToolSelectors();
observeEditorState();
labelIconButtons();
