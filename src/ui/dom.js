// Building DOM without a framework, and the shared pieces every screen uses.

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected']);

/** h('button', { class: 'chip', onclick }, 'Label', child, null) — null, undefined and false are skipped. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** Replaces an element's children (never inserts "null"). */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/**
 * A radio group of chips, for picking a value. options: [{ value, label }]. Returns the group;
 * group.set(value) changes the selection without calling onChange.
 */
export function chips({ label, options, value, onChange, className = '' }) {
  return radioGroup({ label, options, value, onChange, groupClass: 'chips', itemClass: `chip ${className}` });
}

/** A segmented control, for switching what the screen shows. Same options as chips(). */
export function segmented({ label, options, value, onChange }) {
  return radioGroup({ label, options, value, onChange, groupClass: 'segmented', itemClass: 'segment' });
}

function radioGroup({ label, options, value, onChange, groupClass, itemClass }) {
  const group = h('div', { class: groupClass, role: 'radiogroup', 'aria-label': label });
  const render = (current) => {
    fill(group, options.map((o) => h('button', {
      type: 'button',
      class: itemClass,
      role: 'radio',
      'aria-checked': String(o.value === current),
      onclick: () => { render(o.value); onChange(o.value); },
    }, o.label)));
  };
  render(value);
  group.set = render;
  return group;
}

export const field = (label, control, hint) => h('label', { class: 'field' },
  h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'field-hint' }, hint));

/** A bottom sheet on a native <dialog>. Returns { close, dialog }. */
export function sheet(title, ...content) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', onclick: () => close() }, icon('close'))),
    content);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('cancel', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog };
}

let toastTimer;
/** A message above the tab bar for 5 seconds, with an optional action ({ label, run }). */
export function toast(message, action) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  fill(el, h('span', {}, message), action && h('button', {
    type: 'button',
    class: 'toast-action',
    onclick: async () => { el.classList.remove('show'); await action.run(); },
  }, action.label));
  el.classList.add('show');
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

const ICONS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  forward: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

/** Smooth scrolling explains a jump, unless the phone asks for less motion. */
export const scrollBehaviour = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
