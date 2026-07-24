const TOOLTIP_ID = 'rich-config-tooltip';

function section(title, text, className = '') {
  const node = document.createElement('div'); node.className = `help-section ${className}`;
  const heading = document.createElement('strong'); heading.textContent = title;
  const paragraph = document.createElement('p'); paragraph.textContent = text;
  node.append(heading, paragraph); return node;
}

function getTooltip() {
  let tooltip = document.getElementById(TOOLTIP_ID);
  if (!tooltip) {
    tooltip = document.createElement('aside'); tooltip.id = TOOLTIP_ID; tooltip.className = 'help-tooltip'; tooltip.hidden = true; tooltip.setAttribute('role', 'tooltip'); document.body.appendChild(tooltip);
  }
  return tooltip;
}

export async function initializeHelp() {
  const definitions = await fetch('/config-help.json', { cache: 'no-store' }).then((response) => response.json());
  const tooltip = getTooltip(); let active = null; let timer = null;
  const hide = () => { tooltip.hidden = true; active?.setAttribute('aria-expanded', 'false'); active = null; };
  const scheduleHide = () => { clearTimeout(timer); timer = setTimeout(hide, 140); };
  const position = (button) => {
    const rect = button.getBoundingClientRect(); const tip = tooltip.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - tip.width / 2, innerWidth - tip.width - 12));
    let top = rect.bottom + 7; if (top + tip.height > innerHeight - 12) top = Math.max(12, rect.top - tip.height - 7);
    tooltip.style.left = `${left}px`; tooltip.style.top = `${top}px`;
  };
  const show = (button, definition) => {
    clearTimeout(timer); active?.setAttribute('aria-expanded', 'false'); active = button;
    tooltip.replaceChildren();
    const header = document.createElement('header'); const title = document.createElement('b'); title.textContent = definition.label; const hint = document.createElement('span'); hint.textContent = definition.category || 'Ayuda del editor'; header.append(title, hint);
    const range = document.createElement('div'); range.className = 'help-range';
    for (const [label, value] of [['Mínimo', definition.minimum], ['Máximo', definition.maximum]]) {
      const item = document.createElement('div'); const small = document.createElement('small'); small.textContent = label; const strong = document.createElement('b'); strong.textContent = value; item.append(small, strong); range.append(item);
    }
    tooltip.append(header, section('Explicación técnica', definition.technical), section('En palabras simples', definition.plain, 'simple'), range, section('Valor bajo', definition.low), section('Valor alto', definition.high));
    if (definition.rule) tooltip.append(section('Regla importante', definition.rule, 'simple'));
    tooltip.hidden = false; button.setAttribute('aria-expanded', 'true'); position(button);
  };
  const attach = (button, definitionOrKey) => {
    const definition = typeof definitionOrKey === 'string' ? definitions[definitionOrKey] : definitionOrKey;
    if (!button || !definition || button.dataset.helpBound === 'true') return false;
    button.dataset.helpBound = 'true'; button.type = 'button'; button.setAttribute('aria-label', `Ayuda sobre ${definition.label}`); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('mouseenter', () => show(button, definition)); button.addEventListener('mouseleave', scheduleHide);
    button.addEventListener('focus', () => show(button, definition)); button.addEventListener('blur', scheduleHide);
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); tooltip.hidden || active !== button ? show(button, definition) : hide(); });
    return true;
  };

  document.querySelectorAll('label[data-help]').forEach((label) => {
    const key = label.dataset.help; const definition = definitions[key]; if (!definition) return;
    const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const text = textNode?.textContent.trim() || definition.label; textNode?.remove();
    const row = document.createElement('span'); row.className = 'field-label-row'; const title = document.createElement('span'); title.textContent = text;
    const button = document.createElement('button'); button.className = 'help-button'; button.textContent = '?'; attach(button, definition);
    row.append(title, button); label.prepend(row);
  });
  document.querySelectorAll('button[data-help-only]').forEach((button) => {
    attach(button, definitions[button.dataset.helpOnly]);
  });
  tooltip.addEventListener('mouseenter', () => clearTimeout(timer)); tooltip.addEventListener('mouseleave', scheduleHide);
  document.addEventListener('pointerdown', (event) => { if (!tooltip.hidden && !tooltip.contains(event.target) && !active?.contains(event.target)) hide(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  return { definitions, attach, hide };
}
