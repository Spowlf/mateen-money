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
 * A radio group of chips, for picking a value. options: [{ value, label, icon? }], icon a function
 * returning a fresh node (see withCategoryIcons). Returns the group;
 * group.set(value) changes the selection without calling onChange.
 */
export function chips({ label, options, value, onChange, className = '' }) {
  return radioGroup({ label, options, value, onChange, groupClass: 'chips', itemClass: `chip ${className}` });
}

/**
 * A segmented control, for switching what the screen shows. Same options as chips().
 * className 'kind-switch' colours a spend / income switch as money out or money in.
 */
export function segmented({ label, options, value, onChange, className = '' }) {
  return radioGroup({ label, options, value, onChange, groupClass: `segmented ${className}`.trim(), itemClass: 'segment' });
}

function radioGroup({ label, options, value, onChange, groupClass, itemClass }) {
  const group = h('div', { class: groupClass, role: 'radiogroup', 'aria-label': label });
  const render = (current) => {
    fill(group, options.map((o) => h('button', {
      type: 'button',
      class: itemClass,
      role: 'radio',
      'aria-checked': String(o.value === current),
      dataset: { value: o.value ?? '' },
      onclick: () => { render(o.value); onChange(o.value); },
    }, o.icon?.(), o.label)));
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

// One line icon per default category, drawn like the tab bar's (24 grid, stroked in currentColor), so a
// category reads at a glance without a colour of its own. A category you add gets the tag.
const CATEGORY_ICONS = {
  delivery: '<path d="M3 7.5l9-4 9 4v9l-9 4-9-4z"/><path d="M3 7.5l9 4 9-4M12 11.5v9"/>',
  societies: '<path d="M4 6h16v3a3 3 0 0 0 0 6v3H4v-3a3 3 0 0 0 0-6z"/><path d="M14 8v1.5M14 11.25v1.5M14 14.5V16"/>',
  food: '<path d="M5 3v5a2 2 0 0 0 4 0V3M7 3v18"/><path d="M18 21V3c-2.5 1.5-3.5 4.5-3.5 9H18"/>',
  gifts: '<rect x="3.5" y="8" width="17" height="4.5" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8v12M12 8C11 5 7 3.5 7 6.25S10.5 8 12 8zM12 8c1-3 5-4.5 5-1.75S13.5 8 12 8z"/>',
  groceries: '<path d="M3 4h2.2l2.3 10.5h10.8L20.5 7H6"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  health: '<path d="M9 3.5h6v5.5h5.5v6H15v5.5H9V15H3.5V9H9z"/>',
  kelly: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  leisure: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z"/>',
  school: '<path d="M2.5 5.5H8a4 4 0 0 1 4 4V20a3 3 0 0 0-3-3H2.5zM21.5 5.5H16a4 4 0 0 0-4 4V20a3 3 0 0 1 3-3h6.5z"/>',
  snacks: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9h.01M14.5 8.5h.01M15.5 14h.01M9.5 15h.01M12 12h.01"/>',
  subscriptions: '<path d="M19.5 10.5A7.5 7.5 0 0 0 6 6.5L4.5 8M4.5 4v4h4M4.5 13.5A7.5 7.5 0 0 0 18 17.5l1.5-1.5M19.5 20v-4h-4"/>',
  transport: '<rect x="5" y="3" width="14" height="15" rx="2.5"/><path d="M5 11h14M8 21v-3M16 21v-3M8.5 14.5h.01M15.5 14.5h.01"/>',
  travel: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M3 13h18"/>',
  utilities: '<path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z"/>',
  other: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  // Not one of the defaults.
  tag: '<path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5z"/><path d="M8 8h.01"/>',
  // Waiting in To Sort, with no category yet.
  'to-sort': '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.5M12 16.75h.01"/>',
  // Income has no category: money coming in.
  income: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 19.5h15"/>',
};

/** A category's icon (the tag for one you added). Also 'to-sort' and 'income'. */
export function categoryIcon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cat-icon');
  svg.innerHTML = CATEGORY_ICONS[id] ?? CATEGORY_ICONS.tag;
  return svg;
}

/** Category chip options ({ value: categoryId, label }) with each category's icon. */
export const withCategoryIcons = (options) => options.map((o) => ({ ...o, icon: () => categoryIcon(o.value) }));

/** Smooth scrolling explains a jump, unless the phone asks for less motion. */
export const scrollBehaviour = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
