const TOOLTIP_ID = 'rich-config-tooltip';
const SHOW_DELAY = 360;
const QUICK_DELAY = 90;

function section(title, text, className = '') {
  if (text === undefined || text === null || String(text).trim() === '') return null;
  const node = document.createElement('div');
  node.className = `help-section ${className}`.trim();
  const heading = document.createElement('strong');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = String(text);
  node.append(heading, paragraph);
  return node;
}

function getTooltip() {
  let tooltip = document.getElementById(TOOLTIP_ID);
  if (!tooltip) {
    tooltip = document.createElement('aside');
    tooltip.id = TOOLTIP_ID;
    tooltip.className = 'help-tooltip';
    tooltip.hidden = true;
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function simpleDefinition(element, text) {
  const label = element.getAttribute('aria-label')
    || element.textContent?.trim()
    || element.getAttribute('placeholder')
    || 'Ayuda';
  return {
    label: label.slice(0, 90),
    category: 'Ayuda rápida',
    plain: text || `Control: ${label}.`,
    simple: true,
  };
}

export async function initializeHelp() {
  const definitions = await fetch('/config-help.json', { cache: 'no-store' }).then((response) => response.json());
  const tooltip = getTooltip();
  let active = null;
  let showTimer = null;
  let hideTimer = null;
  let recentlyShown = false;

  const clearTimers = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  };

  const hide = () => {
    clearTimers();
    tooltip.hidden = true;
    active?.setAttribute?.('aria-expanded', 'false');
    active = null;
    setTimeout(() => { recentlyShown = false; }, 500);
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 150);
  };

  const position = (anchor) => {
    const rect = anchor.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    const gap = 7;
    const margin = 10;
    const candidates = [
      { left: rect.right + gap, top: rect.top + rect.height / 2 - tip.height / 2 },
      { left: rect.left - tip.width - gap, top: rect.top + rect.height / 2 - tip.height / 2 },
      { left: rect.left + rect.width / 2 - tip.width / 2, top: rect.bottom + gap },
      { left: rect.left + rect.width / 2 - tip.width / 2, top: rect.top - tip.height - gap },
    ];
    let selected = candidates.find((item) => (
      item.left >= margin && item.top >= margin
      && item.left + tip.width <= innerWidth - margin
      && item.top + tip.height <= innerHeight - margin
    )) || candidates[2];
    selected = {
      left: Math.max(margin, Math.min(selected.left, innerWidth - tip.width - margin)),
      top: Math.max(margin, Math.min(selected.top, innerHeight - tip.height - margin)),
    };
    tooltip.style.left = `${selected.left}px`;
    tooltip.style.top = `${selected.top}px`;
  };

  const renderDefinition = (definition) => {
    tooltip.replaceChildren();
    const header = document.createElement('header');
    const title = document.createElement('b');
    title.textContent = definition.label || 'Ayuda';
    const hint = document.createElement('span');
    hint.textContent = definition.category || 'Ayuda del editor';
    header.append(title, hint);
    tooltip.append(header);

    if (definition.simple) {
      const quick = section('Qué hace', definition.plain || definition.technical, 'simple');
      if (quick) tooltip.append(quick);
      return;
    }

    const blocks = [
      section('Explicación técnica', definition.technical),
      section('En palabras simples', definition.plain, 'simple'),
    ].filter(Boolean);
    blocks.forEach((block) => tooltip.append(block));

    const values = [
      ['Mínimo', definition.minimum],
      ['Máximo', definition.maximum],
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
    if (values.length) {
      const range = document.createElement('div');
      range.className = 'help-range';
      for (const [label, value] of values) {
        const item = document.createElement('div');
        const small = document.createElement('small');
        small.textContent = label;
        const strong = document.createElement('b');
        strong.textContent = value;
        item.append(small, strong);
        range.append(item);
      }
      tooltip.append(range);
    }

    [
      section('Valor bajo', definition.low),
      section('Valor alto', definition.high),
      section('Regla importante', definition.rule, 'simple'),
    ].filter(Boolean).forEach((block) => tooltip.append(block));
  };

  const showNow = (anchor, definition) => {
    clearTimers();
    active?.setAttribute?.('aria-expanded', 'false');
    active = anchor;
    renderDefinition(definition);
    tooltip.hidden = false;
    anchor.setAttribute?.('aria-expanded', 'true');
    position(anchor);
    recentlyShown = true;
  };

  const scheduleShow = (anchor, definition, immediate = false) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    const delay = immediate ? 0 : recentlyShown ? QUICK_DELAY : SHOW_DELAY;
    showTimer = setTimeout(() => showNow(anchor, definition), delay);
  };

  const bindTarget = (target, definition, { click = false, anchor = target } = {}) => {
    if (!target || !definition || target.dataset.tooltipTargetBound === 'true') return false;
    target.dataset.tooltipTargetBound = 'true';
    target.setAttribute('aria-describedby', TOOLTIP_ID);
    target.addEventListener('mouseenter', () => scheduleShow(anchor, definition));
    target.addEventListener('mouseleave', scheduleHide);
    target.addEventListener('focus', () => scheduleShow(anchor, definition, true));
    target.addEventListener('blur', scheduleHide);
    if (click) {
      target.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!tooltip.hidden && active === anchor) hide();
        else showNow(anchor, definition);
      });
    }
    return true;
  };

  const attach = (button, definitionOrKey) => {
    const definition = typeof definitionOrKey === 'string' ? definitions[definitionOrKey] : definitionOrKey;
    if (!button || !definition || button.dataset.helpBound === 'true') return false;
    button.dataset.helpBound = 'true';
    if (button.tagName === 'BUTTON') button.type = 'button';
    if (button.classList.contains('help-button')) button.textContent = 'i';
    button.setAttribute('aria-label', `Ayuda sobre ${definition.label}`);
    button.setAttribute('aria-expanded', 'false');
    bindTarget(button, definition, { click: true });
    return true;
  };

  const bindField = (label) => {
    if (!label || label.dataset.fieldHelpBound === 'true') return;
    const key = label.dataset.help;
    const definition = definitions[key];
    if (!definition) return;
    label.dataset.fieldHelpBound = 'true';

    let row = label.querySelector(':scope > .field-label-row');
    if (!row) {
      const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const text = textNode?.textContent.trim() || definition.label;
      textNode?.remove();
      row = document.createElement('span');
      row.className = 'field-label-row';
      const title = document.createElement('span');
      title.textContent = text;
      const button = document.createElement('button');
      button.className = 'help-button';
      button.textContent = 'i';
      row.append(title, button);
      label.prepend(row);
      attach(button, definition);
      bindTarget(title, definition, { anchor: row });
    }

    bindTarget(label, definition, { anchor: row });
    label.querySelectorAll('input, select, textarea').forEach((control) => bindTarget(control, definition, { anchor: row }));
  };

  const bindSimpleElement = (element) => {
    if (!element || element.dataset.simpleTooltipBound === 'true' || element.classList?.contains('help-button')) return;
    const explicit = element.dataset.tooltip || element.getAttribute('title');
    let text = explicit;
    if (!text && element.tagName === 'BUTTON') {
      const name = element.getAttribute('aria-label') || element.textContent?.trim();
      if (name) text = `Ejecuta la acción «${name}».`;
    }
    if (!text && ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) && !element.closest('label[data-help]')) {
      const name = element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.id.replaceAll('-', ' ');
      text = element.tagName === 'SELECT' ? `Selecciona una opción para ${name}.` : `Introduce o modifica ${name}.`;
    }
    if (!text) return;
    element.dataset.simpleTooltipBound = 'true';
    element.removeAttribute('title');
    bindTarget(element, simpleDefinition(element, text));
  };

  const scan = (root = document) => {
    if (root.matches?.('label[data-help]')) bindField(root);
    root.querySelectorAll?.('label[data-help]').forEach(bindField);

    if (root.matches?.('button[data-help-only]')) attach(root, definitions[root.dataset.helpOnly]);
    root.querySelectorAll?.('button[data-help-only]').forEach((button) => attach(button, definitions[button.dataset.helpOnly]));

    const simpleSelector = '[data-tooltip], [title], button, input, select, textarea, label.check';
    if (root.matches?.(simpleSelector)) bindSimpleElement(root);
    root.querySelectorAll?.(simpleSelector).forEach(bindSimpleElement);
  };

  scan(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  tooltip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  tooltip.addEventListener('mouseleave', scheduleHide);
  document.addEventListener('pointerdown', (event) => {
    if (!tooltip.hidden && !tooltip.contains(event.target) && !active?.contains?.(event.target)) hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  addEventListener('resize', hide);

  return { definitions, attach, hide, scan };
}
