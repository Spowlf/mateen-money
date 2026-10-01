// Overview: a month, year or term: totals (left over stands out), spending by category,
// income and spending through the period, and trips. Nothing here is edited in place;
// a trip opens a sheet with its breakdown, and its payments in History.

import { h, fill, segmented, icon, sheet } from './dom.js';
import { runAction } from './format.js';
import { categoryTable, incomeSpendingChart, budgetBar } from './charts.js';
import { openBudgetSheet } from './budget-sheet.js';
import { openTripSheet } from './settings.js';
import { showTripPayments } from './history.js';
import {
  today, monthKey, gbp, formatDay, formatDayShort, overview, shiftPeriod, termNow, termLabel, inTermSpan, clampTerm, yearTerms, daysBetween,
  forecastRow, forecastReason, budgetStatus, budgetStatusText, budgetDetail,
} from '../engine/index.js';

// Kept between visits to the tab, so switching away and back doesn't lose the place.
let period = null;

const KINDS = [{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'term', label: 'Term' }];

function dateSpan(from, to) {
  const [a, b] = [formatDay(from), formatDay(to)];
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${a} to ${b}`;
  return `${a.replace(/ \d{4}$/, '')} to ${b}`;
}

export function renderOverview(root, { repo }) {
  const S = repo.state;
  const el = {
    filters: h('section', { class: 'filters', 'aria-label': 'Period' }),
    body: h('div', { class: 'screen sections' }),
  };
  fill(root, h('div', { class: 'screen' }, el.filters, el.body));

  const terms = () => repo.setting('terms', []);
  const yearMode = () => repo.setting('yearMode', 'academic');
  const excludeTrips = () => repo.setting('excludeTrips', false) === true;
  const liveTrips = () => S.trips.filter((t) => !t.deletedAt);

  function defaultPeriod(kind) {
    const todayDate = today();
    if (kind === 'month') return { kind, month: monthKey(todayDate) };
    if (kind === 'year') return { kind, date: todayDate };
    return { kind, ...termNow(terms(), todayDate) };
  }
  // A term period saved before terms had years is replaced.
  if (!period || (period.kind === 'term' && !period.name)) period = defaultPeriod('month');
  // Only Easter 2026 to Easter 2027 are offered.
  if (period.kind === 'term' && !inTermSpan(period)) period = { kind: 'term', ...clampTerm(period) };
  const canStep = (n) => period.kind !== 'term' || inTermSpan(shiftPeriod(period, n));

  function step(n) {
    period = shiftPeriod(period, n);
    render();
  }

  function renderFilters(data) {
    const unit = period.kind;
    const nav = h('div', { class: 'period-nav' },
      h('button', { type: 'button', class: 'icon-button', 'aria-label': `Previous ${unit}`, disabled: !canStep(-1), onclick: () => step(-1) }, icon('back')),
      h('p', { class: 'period-label', 'aria-live': 'polite' }, data?.range.label ?? termLabel(period)),
      h('button', { type: 'button', class: 'icon-button', 'aria-label': `Next ${unit}`, disabled: !canStep(1), onclick: () => step(1) }, icon('forward')));
    const modeChips = period.kind === 'year' && segmented({
      label: 'Kind of year',
      options: [{ value: 'academic', label: 'Academic Year' }, { value: 'calendar', label: 'Calendar Year' }],
      value: yearMode(),
      onChange: (v) => runAction(() => repo.setSetting('yearMode', v)).then(render),
    });
    fill(el.filters,
      segmented({ label: 'Show a', options: KINDS, value: period.kind, onChange: (v) => { period = defaultPeriod(v); render(); } }),
      nav, modeChips);
  }

  function totalsCard(data) {
    const t = data.totals;
    const tilde = t.estimated ? '~' : '';
    const row = (label, value, sub, cls = '', rowCls = '') => h('li', { class: `total-row ${rowCls}` },
      h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, label), sub && h('span', { class: 'list-sub' }, sub)),
      h('span', { class: `list-amount ${cls}` }, value));
    return h('ul', { class: 'list totals' },
      row(data.range.current ? 'Spent so far' : 'Spent', `${tilde}${gbp(t.spent)}`,
        data.compare ?? (data.weekly !== null ? `About ${tilde}${gbp(data.weekly)} a week` : null)),
      row('Income', `${tilde}${gbp(t.income)}`),
      row(t.net < 0 ? 'Overspent' : 'Left over', `${tilde}${gbp(Math.abs(t.net))}`, null, t.net < 0 ? 'danger' : '', 'standout'));
  }

  // The month in progress: where spending ends up at this pace, as a row like the totals, then how it's counted.
  function forecastSection(f) {
    const r = forecastRow(f);
    return h('section', { class: 'section' },
      h('h2', { class: 'subhead' }, 'At This Pace'),
      h('ul', { class: 'list totals' }, h('li', { class: 'total-row' },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, r.title),
          h('span', { class: `list-sub${r.over ? ' danger' : ''}` }, r.spare)),
        h('span', { class: `list-amount${r.over ? ' danger' : ''}` }, r.amount))),
      h('p', { class: 'reason' }, forecastReason(f)));
  }

  // The monthly budget: this month with its forecast (tap to change it), other months budget against actual.
  function budgetSection(data, budget) {
    if (period.kind !== 'month') return null;
    const current = data.range.current;
    if (!budget && !current) return null;
    const monthEndShort = formatDayShort(data.range.to);
    const content = (b) => [
      h('span', { class: 'budget-top' },
        h('span', { class: 'list-title' }, `${gbp(b.budgetPence)} a month`),
        h('span', { class: `budget-status ${b.status}` }, budgetStatusText(b))),
      h('span', { class: 'list-sub' }, `${budgetDetail(b)}${b.status === 'heading' ? `, ${gbp(b.leftPence)} left` : b.forecastPence > b.spentPence + b.costsDue ? `, about ${gbp(b.forecastPence)} by ${monthEndShort}` : ''}`),
      budgetBar(b),
    ];
    return h('section', { class: 'section' },
      h('h2', { class: 'subhead' }, 'Budget'),
      budget
        ? h('ul', { class: 'list' }, h('li', {}, current
          ? h('button', { type: 'button', class: 'list-row budget-row', 'aria-label': `Budget: ${budgetStatusText(budget)}. Change the budget`, onclick: () => openBudgetSheet(repo) }, content(budget))
          : h('div', { class: 'list-row budget-row static' }, content(budget))))
        : h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openBudgetSheet(repo) }, 'Set a Monthly Budget')));
  }

  const countPhrase = (n) => (n === 1 ? '1 payment' : `${n} payments`);

  function openTrip({ trip, pence, count, estimated, rows }) {
    const tilde = estimated ? '~' : '';
    const todayDate = today();
    const days = trip.start <= todayDate ? daysBetween(trip.start, todayDate < trip.end ? todayDate : trip.end) + 1 : 0;
    const s = sheet(trip.name,
      h('div', { class: 'sheet-form' },
        h('p', { class: 'reason' }, `${dateSpan(trip.start, trip.end)}${count ? `. ${countPhrase(count)}.` : '.'}`),
        h('ul', { class: 'list totals' }, h('li', { class: 'total-row' },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, trip.end < todayDate ? 'Spent' : 'Spent so far'),
            count > 0 && days > 0 && h('span', { class: 'list-sub' }, `About ${tilde}${gbp(pence / days)} a day`)),
          h('span', { class: 'list-amount' }, `${tilde}${gbp(pence)}`))),
        rows.length > 0
          ? categoryTable(rows, { caption: `Spending by category, ${trip.name}` })
          : h('p', { class: 'empty-line' }, 'No payments on it yet.'),
        h('div', { class: 'sheet-actions' },
          count > 0 && h('button', { type: 'button', class: 'button primary', onclick: () => { s.close(); showTripPayments(trip.id); } }, `See the ${countPhrase(count)}`),
          h('button', { type: 'button', class: count > 0 ? 'button secondary' : 'button primary', onclick: () => { s.close(); openTripSheet(repo, trip); } }, 'Change the name or dates'))));
  }

  function tripsSection(data) {
    const trips = data.trips;
    return h('section', { class: 'section' },
      h('h2', { class: 'subhead' }, 'Trips'),
      trips.length
        ? h('ul', { class: 'list' }, trips.map((t) => h('li', {}, h('button', { type: 'button', class: 'list-row trip-row', onclick: () => openTrip(t) },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, t.trip.name),
            h('span', { class: 'list-sub' }, `${dateSpan(t.trip.start, t.trip.end)}, ${t.count ? countPhrase(t.count) : 'nothing yet'}`),
            t.rows.length > 0 && h('span', { class: 'list-sub' }, t.rows.slice(0, 3).map((r) => `${r.name} ${gbp(r.pence)}`).join(', '))),
          h('span', { class: 'list-amount' }, `${t.estimated ? '~' : ''}${gbp(t.pence)}`)))))
        : h('p', { class: 'empty-line' }, 'No trips yet.'),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openTripSheet(repo, null) }, 'Add a trip')));
  }

  function render() {
    const data = overview({
      entries: S.entries, categories: S.categories, trips: liveTrips(), recurring: S.recurring, rates: S.rates, period, todayDate: today(),
      yearMode: yearMode(), terms: terms(), excludeTrips: excludeTrips(),
    });
    renderFilters(data);
    if (!data) {
      fill(el.body, h('section', { class: 'empty' },
        h('h2', {}, `No Dates for ${termLabel(period)} Yet`),
        h('p', {}, 'Add them in Settings.'),
        h('a', { class: 'button primary', href: '#settings' }, 'Add term dates')));
      return;
    }
    const budget = period.kind === 'month' ? budgetStatus({
      entries: S.entries, trips: S.trips, budgets: S.budgets, recurring: S.recurring, rates: S.rates,
      month: period.month, todayDate: today(), excludeTrips: excludeTrips() && new Set(liveTrips().map((t) => t.id)),
    }) : null;
    const term = period.kind === 'term' && yearTerms(terms(), period.year).find((t) => t.name === period.name);
    // Drawn at the size it will show (inside the card's padding), so its text stays true size.
    const width = Math.max((el.body.clientWidth || 358) - 32, 260);
    fill(el.body,
      h('section', { class: 'section', 'aria-label': 'Totals' },
        totalsCard(data),
        term && h('p', { class: 'reason' }, `${term.name} Term runs ${dateSpan(term.start, term.end)}.`),
        excludeTrips() && liveTrips().length > 0 && h('p', { class: 'reason' }, 'Trips are left out.'),
        // Under the totals it changes, so the figures come first.
        liveTrips().length > 0 && h('label', { class: 'toggle' },
          h('input', { type: 'checkbox', checked: excludeTrips(), onchange: (e) => runAction(() => repo.setSetting('excludeTrips', e.target.checked)).then(render) }),
          h('span', {}, 'Leave trips out of these totals'))),
      data.forecast && forecastSection(data.forecast),
      budgetSection(data, budget),
      h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'Spending by Category'),
        data.rows.length
          ? [categoryTable(budget ? data.rows.map((r) => ({ ...r, share: r.pence / budget.budgetPence })) : data.rows, { caption: `Spending by category, ${data.range.label}` }),
            budget && h('p', { class: 'reason' }, `Shares are of your ${gbp(budget.budgetPence)} budget.`)]
          : h('p', { class: 'empty-line' }, `Nothing spent in ${data.range.label} yet.`)),
      h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'Income and Spending'),
        data.series.some((m) => m.income || m.spent)
          ? [h('p', { class: 'reason' }, period.kind === 'year' ? 'Month by month.' : 'Week by week.'),
            incomeSpendingChart(data.series, { width, name: data.range.label, step: period.kind === 'year' ? 'Month' : 'Week' })]
          : h('p', { class: 'empty-line' }, `Nothing logged in ${data.range.label} yet.`)),
      tripsSection(data));
  }

  render();
  return { refresh: render };
}
