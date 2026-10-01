// Inline SVG charts. Marks carry colour; every value is also readable as text (labels or a table).
// Series colours: --series-1 spending, --series-2 income (validated for colour blindness in both modes).

import { h } from './dom.js';
import { gbp, niceScale } from '../engine/index.js';

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
  return h('table', { class: 'cat-table' },
    h('caption', { class: 'visually-hidden' }, caption),
    h('thead', { class: 'visually-hidden' }, h('tr', {}, h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col' }, 'Spent'), h('th', { scope: 'col' }, 'Share'))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('th', { scope: 'row' },
        h('span', { class: 'cat-name' }, r.name),
        meter(r.share, r.categoryId === null ? 'fill-muted' : 'fill-1')),
      h('td', { class: 'num' }, gbp(r.pence)),
      h('td', { class: 'num share' }, `${Math.round(r.share * 100)}%`)))));
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
        tooltip.hidden = false;
        const left = Math.min(Math.max(mid - 70, 0), width - 140);
        tooltip.style.transform = `translate(${left}px, 0)`;
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
    h('summary', {}, 'Show as a table'),
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
