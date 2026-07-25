const TOOLTIP_ID = 'rich-config-tooltip';

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
    || element.childNodes[0]?.textContent?.trim()
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

  const hide = () => {
    tooltip.hidden = true;
    active?.setAttribute?.('aria-expanded', 'false');
    active = null;
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

    [
      section('Explicación técnica', definition.technical),
      section('En palabras simples', definition.plain, 'simple'),
    ].filter(Boolean).forEach((block) => tooltip.append(block));

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
    active?.setAttribute?.('aria-expanded', 'false');
    active = anchor;
    renderDefinition(definition);
    tooltip.hidden = false;
    anchor.setAttribute?.('aria-expanded', 'true');
    position(anchor);
  };

  const bindTrigger = (trigger, definition, anchor = trigger) => {
    if (!trigger || !definition || trigger.dataset.tooltipTriggerBound === 'true') return false;
    trigger.dataset.tooltipTriggerBound = 'true';
    trigger.setAttribute('aria-controls', TOOLTIP_ID);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-describedby', TOOLTIP_ID);

    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!tooltip.hidden && active === anchor) hide();
      else showNow(anchor, definition);
    };

    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') toggle(event);
    });
    return true;
  };

  const attach = (button, definitionOrKey) => {
    const definition = typeof definitionOrKey === 'string' ? definitions[definitionOrKey] : definitionOrKey;
    if (!button || !definition || button.dataset.helpBound === 'true') return false;
    button.dataset.helpBound = 'true';
    if (button.tagName === 'BUTTON') button.type = 'button';
    if (button.classList.contains('help-button')) button.textContent = 'i';
    button.setAttribute('aria-label', `Ayuda sobre ${definition.label}`);
    bindTrigger(button, definition);
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
    } else {
      const button = row.querySelector('.help-button');
      if (button) attach(button, definition);
    }
  };

  const createInlineTrigger = (element, definition) => {
    if (!element || element.dataset.simpleTooltipBound === 'true' || element.classList?.contains('help-button')) return;
    element.dataset.simpleTooltipBound = 'true';
    element.removeAttribute('title');

    const trigger = document.createElement('span');
    trigger.className = 'inline-help-trigger';
    trigger.textContent = 'i';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-label', `Ayuda sobre ${definition.label}`);

    const dynamicTextButtons = new Set([
      'compile-preview', 'export-schematic', 'terrain-3d-expand', 'voxel-3d-expand',
    ]);
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) || dynamicTextButtons.has(element.id)) {
      trigger.classList.add('inline-help-trigger--sibling');
      element.insertAdjacentElement('afterend', trigger);
    } else {
      element.classList.add('has-inline-help');
      element.append(trigger);
    }
    bindTrigger(trigger, definition);
  };

  const bindSimpleElement = (element) => {
    if (!element || element.dataset.simpleTooltipBound === 'true' || element.classList?.contains('help-button')) return;
    const text = element.dataset.tooltip || element.getAttribute('title');
    if (!text) return;
    createInlineTrigger(element, simpleDefinition(element, text));
  };

  const scan = (root = document) => {
    if (root.matches?.('label[data-help]')) bindField(root);
    root.querySelectorAll?.('label[data-help]').forEach(bindField);

    if (root.matches?.('button[data-help-only]')) attach(root, definitions[root.dataset.helpOnly]);
    root.querySelectorAll?.('button[data-help-only]').forEach((button) => attach(button, definitions[button.dataset.helpOnly]));

    const simpleSelector = '[data-tooltip], [title]';
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

  document.addEventListener('pointerdown', (event) => {
    if (!tooltip.hidden && !tooltip.contains(event.target) && !active?.contains?.(event.target)) hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  document.addEventListener('scroll', hide, true);
  addEventListener('resize', hide);

  return { definitions, attach, hide, scan };
}
