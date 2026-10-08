// Inline SVG charts. Marks carry colour; every value is also readable as text (labels or a table).
// Series colours: --series-1 spending, --series-2 income (validated for colour blindness in both modes).

import { h } from './dom.js';
import { gbp, niceScale, rangeScale, daysBetween, formatDay, formatDayShort } from '../engine/index.js';

const SVG = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

/** A bar growing up from the baseline: 4px rounded data end, square at the baseline. */
function column(x, y, w, baseline) {
  const hgt = baseline - y;
  if (hgt <= 0) return null;
  const r = Math.min(4, hgt, w / 2);
  return `M${x},${baseline}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${baseline}Z`;
}

/**
 * A share as a meter: the track is the whole (a budget, or all the spending), the fill the part,
 * full when over. A share above zero always shows a sliver.
 */
function meter(share, cls) {
  const pct = Math.min(Math.max(share, 0), 1) * 100;
  const fill = share > 0 && h('span', { class: `meter-fill ${cls}` });
  if (fill) fill.style.width = `max(4px, ${pct.toFixed(2)}%)`;
  return h('span', { class: 'meter', 'aria-hidden': 'true' }, fill);
}

/**
 * Spending by category as a table whose first column carries its share as a meter.
 * rows: [{ categoryId, name, pence, share }], largest first; share is of the budget, or of all
 * the spending when there's none. "To sort" (categoryId null) is grey.
 */
export function categoryTable(rows, { caption }) {
  return shareTable(rows.map((r) => ({ ...r, fill: r.categoryId === null ? 'fill-muted' : 'fill-1' })),
    { caption, head: ['Category', 'Spent', 'Share'], amountClass: 'spend' });
}

/**
 * Parts of a whole as a table whose first column carries each share as a meter. rows: [{ name,
 * pence, share, fill? }]. Net worth's are accent blue (fill-accent, plain amounts), by the user's choice.
 * { amounts: false } leaves the amount out where a list beside it already says it (IBKR's Mix).
 */
export function shareTable(rows, { caption, head, amountClass = '', fill = 'fill-accent', amounts = true }) {
  return h('table', { class: 'cat-table' },
    h('caption', { class: 'visually-hidden' }, caption),
    h('thead', { class: 'visually-hidden' }, h('tr', {}, head.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('th', { scope: 'row' },
        h('span', { class: 'cat-name' }, r.name),
        meter(r.share, r.fill ?? fill)),
      amounts && h('td', { class: `num ${amountClass}`.trim() }, r.amount ?? gbp(r.pence)),
      h('td', { class: 'num share' }, `${Math.round(r.share * 100)}%`)))));
}

/**
 * The top five categories, then one row for the real Other and everything past the top five
 * ("Other + 3 more categories"), its pence and share the sum of theirs. To Sort keeps its own row.
 * Returns rows unchanged when folding would leave fewer than two rows to combine.
 */
export function foldCategories(rows, top = 5) {
  const categories = rows.filter((r) => r.categoryId !== null && r.categoryId !== 'other');
  const rest = categories.slice(top);
  const other = rows.find((r) => r.categoryId === 'other');
  const combined = other ? [other, ...rest] : rest;
  if (combined.length < 2) return rows;
  const kept = new Set(categories.slice(0, top).map((r) => r.categoryId));
  const more = `${rest.length} more ${rest.length === 1 ? 'category' : 'categories'}`;
  return [
    ...rows.filter((r) => r.categoryId === null || kept.has(r.categoryId)),
    {
      categoryId: 'other',
      name: other ? `Other + ${more}` : more.charAt(0).toUpperCase() + more.slice(1),
      pence: combined.reduce((sum, r) => sum + r.pence, 0),
      share: combined.reduce((sum, r) => sum + r.share, 0),
    },
  ];
}

/** Shows a tooltip centred over a point (a fraction of the chart's width), kept inside the chart. */
function placeTip(tooltip, at) {
  tooltip.hidden = false;
  const room = tooltip.parentElement.clientWidth;
  const w = tooltip.offsetWidth;
  const left = Math.min(Math.max(at * room - w / 2, 0), Math.max(room - w, 0));
  tooltip.style.transform = `translate(${left}px, 0)`;
}

/**
 * Income and spending per step of a period (weeks of a month or term, months of a year) as paired
 * columns on one axis, with a legend, a tooltip on each step (hover, tap or keyboard focus) and the
 * same numbers as a table. Steps still to come (income and spent null) stay empty.
 * series: [{ label, title, income, spent }], oldest first. step names a step for the table: 'Week' or 'Month'.
 */
export function incomeSpendingChart(series, { width = 358, name, step }) {
  const height = 196;
  const pad = { top: 10, right: 4, bottom: 26, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseline = pad.top + plotH;
  const scale = niceScale(Math.max(...series.flatMap((m) => [m.income ?? 0, m.spent ?? 0])));
  const y = (pence) => baseline - (pence / scale.max) * plotH;
  const band = plotW / series.length;
  const barW = Math.min(24, (band - Math.min(14, band * 0.3)) / 2);
  const GAP = 2;
  // Twelve months don't fit as "Oct", "Nov" on a phone; their initials do (the tooltip and table say them in full).
  const axisLabel = (m) => (band < 34 ? m.label[0] : m.label);

  const tooltip = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
  const groups = [];

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'group', 'aria-label': `Income and spending, ${name}` },
    scale.ticks.map((t) => s('g', {},
      s('line', { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), class: 'grid' }),
      s('text', { x: pad.left - 8, y: y(t), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, document.createTextNode(gbp(t, { whole: true }))))),
    series.map((m, i) => {
      const x0 = pad.left + i * band;
      const mid = x0 + band / 2;
      const label = s('text', { x: mid, y: height - 8, class: 'axis', 'text-anchor': 'middle' }, document.createTextNode(axisLabel(m)));
      if (m.spent === null) return s('g', { role: 'img', 'aria-label': `${m.title}: still to come` }, label);
      const hit = s('rect', { x: x0, y: pad.top, width: band, height: plotH, class: 'hit', rx: 8 });
      const g = s('g', { tabindex: '0', class: 'month', role: 'img', 'aria-label': `${m.title}: income ${gbp(m.income)}, spending ${gbp(m.spent)}` },
        hit,
        s('path', { d: column(mid - GAP / 2 - barW, y(m.income), barW, baseline), class: 'mark-2' }),
        s('path', { d: column(mid + GAP / 2, y(m.spent), barW, baseline), class: 'mark-1' }),
        label);
      const show = () => {
        for (const other of groups) other.classList.remove('on');
        g.classList.add('on');
        tooltip.replaceChildren(
          h('p', { class: 'tip-title' }, m.title),
          h('p', { class: 'tip-row' }, h('span', { class: 'line-key key-2' }), h('strong', {}, gbp(m.income)), ' income'),
          h('p', { class: 'tip-row' }, h('span', { class: 'line-key key-1' }), h('strong', {}, gbp(m.spent)), ' spent'));
        placeTip(tooltip, mid / width);
      };
      const hide = () => { g.classList.remove('on'); tooltip.hidden = true; };
      g.addEventListener('pointerenter', show);
      g.addEventListener('pointerdown', show);
      g.addEventListener('focus', show);
      g.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
      g.addEventListener('blur', hide);
      groups.push(g);
      return g;
    }),
    s('line', { x1: pad.left, x2: width - pad.right, y1: baseline, y2: baseline, class: 'baseline' }));

  const legend = h('p', { class: 'legend' },
    h('span', {}, h('span', { class: 'swatch swatch-2' }), 'Income'),
    h('span', {}, h('span', { class: 'swatch swatch-1' }), 'Spending'));

  const table = h('details', { class: 'table-view' },
    h('summary', {}, 'Show as a Table'),
    h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, step), h('th', { scope: 'col' }, 'Income'), h('th', { scope: 'col' }, 'Spent'))),
      h('tbody', {}, series.filter((m) => m.spent !== null).map((m) => h('tr', {},
        h('th', { scope: 'row' }, m.title),
        h('td', { class: 'num' }, gbp(m.income)),
        h('td', { class: 'num' }, gbp(m.spent)))))));

  return h('figure', { class: 'chart-figure' }, legend, h('div', { class: 'chart-wrap' }, svg, tooltip), table);
}

/**
 * The monthly budget as a meter: the track is the budget, the fill what's spent (full when over).
 * Colour follows the status (ok, heading over, over); the status is always written beside it too.
 */
export function budgetBar(r) {
  return meter(r.share, { ok: 'fill-1', heading: 'fill-warn', over: 'fill-danger' }[r.status]);
}

/**
 * Net worth over time as one line in --accent (the user's choice for net worth), on an axis that fits the values
 * rather than starting at zero. A crosshair finds the nearest day (pointer, tap, or arrow keys once
 * focused) and the tooltip says it; the same days are a table. points: [{ date, pence }], oldest first,
 * at least two.
 */
export function worthChart(points, { width = 358, name }) {
  const height = 196;
  const pad = { top: 12, right: 8, bottom: 26, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseline = pad.top + plotH;
  const scale = rangeScale(Math.min(...points.map((p) => p.pence)), Math.max(...points.map((p) => p.pence)));
  const first = points[0].date;
  const span = Math.max(daysBetween(first, points.at(-1).date), 1);
  const x = (date) => pad.left + (daysBetween(first, date) / span) * plotW;
  const y = (pence) => baseline - ((pence - scale.min) / (scale.max - scale.min)) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.pence).toFixed(1)}`).join('');
  const last = points.at(-1);

  const tooltip = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
  const cross = s('line', { y1: pad.top, y2: baseline, class: 'crosshair', visibility: 'hidden' });
  const dot = s('circle', { r: 4, class: 'mark-accent-dot', visibility: 'hidden' });
  // Three dates under the axis: the first, the middle and the last ("Today").
  const mid = points[Math.floor((points.length - 1) / 2)];
  const dateLabels = [[first, 'start'], [mid.date, 'middle'], [last.date, 'end']]
    .filter(([d], i, all) => i === 0 || d !== all[i - 1][0])
    .map(([d, anchor], i) => s('text', { x: anchor === 'start' ? pad.left : anchor === 'end' ? width - pad.right : x(d), y: height - 8, class: 'axis', 'text-anchor': anchor },
      document.createTextNode(i > 0 && d === last.date ? 'Today' : formatDayShort(d))));

  let at = null;
  const show = (i) => {
    at = Math.max(0, Math.min(points.length - 1, i));
    const p = points[at];
    const px = x(p.date);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', y(p.pence)); dot.setAttribute('visibility', 'visible');
    tooltip.replaceChildren(
      h('p', { class: 'tip-title' }, at === points.length - 1 ? 'Today' : formatDay(p.date)),
      h('p', { class: 'tip-row' }, h('strong', {}, gbp(p.pence))));
    placeTip(tooltip, px / width);
  };
  const hide = () => { at = null; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tooltip.hidden = true; };
  const nearest = (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i; });
    return best;
  };

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart worth-chart', tabindex: '0', role: 'img',
    'aria-label': `Net worth, ${name}: ${gbp(points[0].pence)} on ${formatDay(first)}, ${gbp(last.pence)} today. Arrow keys step through the days.` },
  scale.ticks.map((t) => s('g', {},
    s('line', { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), class: 'grid' }),
    s('text', { x: pad.left - 8, y: y(t), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, document.createTextNode(gbp(t, { whole: true }))))),
  dateLabels,
  s('path', { d: line, class: 'mark-accent' }),
  s('circle', { cx: x(last.date), cy: y(last.pence), r: 4, class: 'mark-accent-dot' }),
  cross, dot,
  s('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, class: 'hit' }));

  svg.addEventListener('pointermove', (e) => show(nearest(e)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('focus', () => show(at ?? points.length - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(points.length - 1);
    else if (step) show((at ?? points.length - 1) + step);
    else return;
    e.preventDefault();
  });

  const table = h('details', { class: 'table-view' },
    h('summary', {}, 'Show as a Table'),
    h('table', { class: 'data-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col' }, 'Net Worth'))),
      h('tbody', {}, [...points].reverse().map((p, i) => h('tr', {},
        h('th', { scope: 'row' }, i === 0 ? 'Today' : formatDay(p.date)),
        h('td', { class: 'num' }, gbp(p.pence)))))));

  return h('figure', { class: 'chart-figure' }, h('div', { class: 'chart-wrap' }, svg, tooltip), table);
}
