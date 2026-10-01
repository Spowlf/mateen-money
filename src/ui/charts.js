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

/** A bar growing right from the start: 4px rounded data end. */
function bar(w, hgt) {
  if (w <= 0) return null;
  const r = Math.min(4, w, hgt / 2);
  return `M0,0H${w - r}Q${w},0 ${w},${r}V${hgt - r}Q${w},${hgt} ${w - r},${hgt}H0Z`;
}

/**
 * Spending by category as a table whose first column carries a bar.
 * rows: [{ categoryId, name, pence, share }], largest first. "To sort" (categoryId null) is grey.
 */
export function categoryTable(rows, { caption }) {
  const max = Math.max(...rows.map((r) => r.pence), 1);
  const width = 100;
  return h('table', { class: 'cat-table' },
    h('caption', { class: 'visually-hidden' }, caption),
    h('thead', { class: 'visually-hidden' }, h('tr', {}, h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col' }, 'Spent'), h('th', { scope: 'col' }, 'Share'))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('th', { scope: 'row' },
        h('span', { class: 'cat-name' }, r.name),
        s('svg', { class: 'cat-bar', viewBox: `0 0 ${width} 8`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
          s('path', { d: bar(Math.max((r.pence / max) * width, 1), 8), class: r.categoryId === null ? 'mark-muted' : 'mark-1' }))),
      h('td', { class: 'num' }, gbp(r.pence)),
      h('td', { class: 'num share' }, `${Math.round(r.share * 100)}%`)))));
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (key) => Number(key.slice(5, 7)) - 1;

/**
 * Income and spending per month as paired columns on one axis, with a legend, a tooltip on
 * each month (hover, tap or keyboard focus) and the same numbers as a table.
 * series: [{ month: 'YYYY-MM', income, spent }], oldest first.
 */
export function incomeSpendingChart(series, { width = 358 } = {}) {
  const height = 196;
  const pad = { top: 10, right: 4, bottom: 26, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseline = pad.top + plotH;
  const scale = niceScale(Math.max(...series.flatMap((m) => [m.income, m.spent])));
  const y = (pence) => baseline - (pence / scale.max) * plotH;
  const band = plotW / series.length;
  const barW = Math.min(24, (band - 14) / 2);
  const GAP = 2;

  const tooltip = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
  const groups = [];

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'group', 'aria-label': 'Income and spending for the last six months' },
    scale.ticks.map((t) => s('g', {},
      s('line', { x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t), class: 'grid' }),
      s('text', { x: pad.left - 8, y: y(t), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, document.createTextNode(gbp(t, { whole: true }))))),
    series.map((m, i) => {
      const x0 = pad.left + i * band;
      const mid = x0 + band / 2;
      const hit = s('rect', { x: x0, y: pad.top, width: band, height: plotH, class: 'hit', rx: 8 });
      const g = s('g', { tabindex: '0', class: 'month', role: 'img',
        'aria-label': `${MONTH_LONG[monthOf(m.month)]}: income ${gbp(m.income)}, spending ${gbp(m.spent)}` },
        hit,
        s('path', { d: column(mid - GAP / 2 - barW, y(m.income), barW, baseline), class: 'mark-2' }),
        s('path', { d: column(mid + GAP / 2, y(m.spent), barW, baseline), class: 'mark-1' }),
        s('text', { x: mid, y: height - 8, class: 'axis', 'text-anchor': 'middle' }, document.createTextNode(MONTH_SHORT[monthOf(m.month)])));
      const show = () => {
        for (const other of groups) other.classList.remove('on');
        g.classList.add('on');
        tooltip.replaceChildren(
          h('p', { class: 'tip-title' }, `${MONTH_LONG[monthOf(m.month)]} ${m.month.slice(0, 4)}`),
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
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Month'), h('th', { scope: 'col' }, 'Income'), h('th', { scope: 'col' }, 'Spent'))),
      h('tbody', {}, series.map((m) => h('tr', {},
        h('th', { scope: 'row' }, `${MONTH_SHORT[monthOf(m.month)]} ${m.month.slice(0, 4)}`),
        h('td', { class: 'num' }, gbp(m.income)),
        h('td', { class: 'num' }, gbp(m.spent)))))));

  return h('figure', { class: 'chart-figure' }, legend, h('div', { class: 'chart-wrap' }, svg, tooltip), table);
}

/**
 * A category's budget as a meter: the track is the budget, the fill what's spent (full when over).
 * Colour follows the status (ok, heading over, over); the status is always written beside it too.
 */
export function budgetBar(r) {
  const width = 100;
  const mark = { ok: 'mark-1', heading: 'mark-warn', over: 'mark-danger' }[r.status];
  return s('svg', { class: 'cat-bar', viewBox: `0 0 ${width} 8`, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    s('rect', { x: 0, y: 0, width, height: 8, rx: 4, class: 'mark-track' }),
    r.share > 0 && s('path', { d: bar(Math.max(r.share * width, 1), 8), class: mark }));
}
