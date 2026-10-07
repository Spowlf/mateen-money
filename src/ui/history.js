// History: payments and income on their own tabs, grouped by day, with search and filters; every vendor;
// and People, who owes whom from split bills.
// Tapping a row opens its sheet. Nothing is edited in place.

import { h, fill, segmented, categoryIcon } from './dom.js';
import { money, liveSorted, spending } from './format.js';
import { openEntrySheet } from './entry-sheet.js';
import { openSortSheet } from './sort-sheet.js';
import { openVendorSheet } from './vendor-sheet.js';
import { renderPeople } from './people.js';
import { today, gbp, formatDay, formatMoney, searchEntries, groupByDay, toSortEntries, TO_SORT, INCOME_TYPES } from '../engine/index.js';

const PAGE = 100;

// Kept between visits to the tab, so switching away and back keeps the search.
let view = { kind: 'payments', query: '', categoryId: null, incomeType: null, tripId: null, methodId: null, vendorQuery: '' };

/** Opens History on one trip's payments (from a trip on Overview). */
export function showTripPayments(tripId) {
  view = { ...view, kind: 'payments', query: '', categoryId: null, incomeType: null, methodId: null, tripId };
  location.hash = '#history';
}

export function renderHistory(root, { repo }) {
  const S = repo.state;
  let shown = PAGE;
  const el = {
    switch: h('div'),
    controls: h('div', { class: 'filters' }),
    body: h('div', { class: 'screen', 'aria-live': 'polite' }),
  };
  fill(root, h('div', { class: 'screen' }, el.switch, el.controls, el.body));

  const name = (rows, id) => rows.find((r) => r.id === id)?.name;
  const isIncome = () => view.kind === 'income';
  // Each tab keeps its own filters; only the search is shared.
  const filters = () => (isIncome()
    ? { query: view.query, kind: 'income', incomeType: view.incomeType }
    : { query: view.query, kind: 'spend', categoryId: view.categoryId, tripId: view.tripId, methodId: view.methodId });
  const filtering = () => view.query.trim() || (isIncome() ? view.incomeType : view.categoryId || view.tripId || view.methodId);

  function select(label, value, options, onChange) {
    const control = h('select', { class: 'select select-small', 'aria-label': label, onchange: () => onChange(control.value || null) },
      options.map((o) => h('option', { value: o.value ?? '', selected: (o.value ?? null) === value }, o.label)));
    return control;
  }

  function renderSwitch() {
    fill(el.switch, segmented({
      label: 'Show',
      className: 'fit',
      options: [{ value: 'payments', label: 'Payments' }, { value: 'income', label: 'Income' }, { value: 'vendors', label: 'Merchants' }, { value: 'people', label: 'People' }],
      value: view.kind,
      onChange: (v) => { view.kind = v; shown = PAGE; renderControls(); renderBody(); },
    }));
  }

  // A trip deleted since it was picked can't be shown in the filter, so it stops filtering.
  function dropGoneTrip() {
    if (!view.tripId || S.trips.some((t) => !t.deletedAt && t.id === view.tripId)) return false;
    view.tripId = null;
    return true;
  }

  function renderControls() {
    dropGoneTrip();
    if (view.kind === 'people') return fill(el.controls);
    if (view.kind === 'vendors') {
      const search = h('input', { class: 'input', type: 'search', placeholder: 'Search merchants', 'aria-label': 'Search merchants', autocomplete: 'off',
        value: view.vendorQuery, oninput: () => { view.vendorQuery = search.value; renderBody(); } });
      return fill(el.controls, search);
    }
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search names, descriptions or amounts', 'aria-label': isIncome() ? 'Search income' : 'Search payments', autocomplete: 'off',
      value: view.query, oninput: () => { view.query = search.value; shown = PAGE; renderBody(); } });
    const change = (key) => (v) => { view[key] = v; shown = PAGE; renderControls(); renderBody(); };
    if (isIncome()) {
      return fill(el.controls, search, h('div', { class: 'filter-row' },
        select('Type of income', view.incomeType, [{ value: null, label: 'All types' }, ...INCOME_TYPES.map((t) => ({ value: t.id, label: t.name }))], change('incomeType'))));
    }
    // Alphabetical here, Other last, whatever order Settings gives them.
    const categories = S.categories.filter((c) => !c.deletedAt && (!c.archived || c.id === view.categoryId))
      .sort((a, b) => (a.id === 'other') - (b.id === 'other') || a.name.localeCompare(b.name, 'en'));
    const trips = S.trips.filter((t) => !t.deletedAt).sort((a, b) => (a.start < b.start ? 1 : -1));
    const methods = liveSorted(S.methods, 'name');
    const categorySelect = select('Category', view.categoryId, [
      { value: null, label: 'All categories' },
      { value: TO_SORT, label: 'To Sort' },
      ...categories.map((c) => ({ value: c.id, label: c.name })),
    ], change('categoryId'));
    fill(el.controls, search, h('div', { class: 'filter-row' },
      // The picked category's icon sits in the pill beside its name.
      view.categoryId ? h('span', { class: 'select-icon' }, categoryIcon(view.categoryId === TO_SORT ? 'to-sort' : view.categoryId), categorySelect) : categorySelect,
      methods.length > 1 && select('Paid with', view.methodId, [{ value: null, label: 'Any payment method' }, ...methods.map((m) => ({ value: m.id, label: m.name }))], change('methodId')),
      (trips.length > 0 || view.tripId) && select('Trip', view.tripId, [{ value: null, label: 'Any trip' }, ...trips.map((t) => ({ value: t.id, label: t.name }))], change('tripId'))));
  }

  const toSortIds = () => new Set(toSortEntries(S.entries).map((e) => e.id));

  function row(e, waiting) {
    const income = e.kind === 'income';
    const title = income
      ? e.merchant || INCOME_TYPES.find((t) => t.id === e.incomeType)?.name || 'Income'
      : name(S.vendors, e.vendorId) ?? e.merchant ?? 'Payment';
    const sub = [
      // The type is already the title when the income has no "From".
      income ? e.merchant && INCOME_TYPES.find((t) => t.id === e.incomeType)?.name : name(S.categories, e.categoryId),
      name(S.methods, e.methodId),
      income && name(S.accounts, e.accountId) && `into ${name(S.accounts, e.accountId)}`,
      e.time,
      name(S.trips, e.tripId) && `${name(S.trips, e.tripId)} trip`,
    ].filter(Boolean).join(', ').replace(/^into /, 'Into ');
    // What the row is at a glance: its category's icon, To Sort's, or money coming in.
    const rowIcon = income ? 'income' : waiting || !e.categoryId ? 'to-sort' : e.categoryId;
    return h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => (waiting ? openSortSheet(repo, e) : openEntrySheet(repo, e)) },
      h('span', { class: 'row-icon' }, categoryIcon(rowIcon)),
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, title,
          waiting && h('span', { class: 'tag tag-warn' }, 'To Sort'),
          e.source === 'recurring' && h('span', { class: 'tag' }, 'Added automatically'),
          e.gbpStatus === 'statement' && h('span', { class: 'tag' }, 'From statement')),
        sub && h('span', { class: 'list-sub' }, sub),
        // A split bill's amount is the user's share; the whole bill is said here.
        e.split && h('span', { class: 'list-sub' }, `of ${formatMoney(e.fullAmountMinor, e.currency)}, split`),
        e.note && h('span', { class: 'list-sub list-note' }, e.note)),
      h('span', { class: `list-amount ${income ? 'income' : 'spend'}` }, `${income ? '+' : ''}${money(e)}`)));
  }

  function renderPayments() {
    const income = isIncome();
    const kind = income ? 'income' : 'spend';
    if (!S.entries.some((e) => !e.deletedAt && e.kind === kind)) {
      return fill(el.body, h('section', { class: 'empty' },
        h('h2', {}, income ? 'No Income Yet' : 'No Payments Yet'),
        h('a', { class: 'button primary', href: '#log' }, income ? 'Log income' : 'Log a payment')));
    }
    const found = searchEntries(spending(S), filters(), { vendors: S.vendors, categories: S.categories, methods: S.methods, trips: S.trips });
    if (!found.length) {
      return fill(el.body, h('div', {},
        h('p', { class: 'empty-line' }, 'Nothing matches.'),
        h('button', { type: 'button', class: 'text-button', onclick: clear }, 'Clear search and filters')));
    }
    const waiting = toSortIds();
    const groups = groupByDay(found.slice(0, shown), today());
    const total = found.reduce((s, e) => s + (e.gbpPence ?? 0), 0);
    fill(el.body,
      filtering() && h('p', { class: 'reason' },
        `${found.length === 1 ? '1 match' : `${found.length} matches`}, ${gbp(total)} ${income ? 'in' : 'spent'}. `,
        h('button', { type: 'button', class: 'text-button inline', onclick: clear }, 'Clear')),
      groups.map((g) => h('section', { class: 'section day' },
        h('h2', { class: 'day-head' }, h('span', {}, g.label),
          (income ? g.income : g.spent) > 0 && h('span', { class: 'day-total' }, income ? `${gbp(g.income)} in` : `${gbp(g.spent)} spent`)),
        h('ul', { class: 'list' }, g.entries.map((e) => row(e, waiting.has(e.id)))))),
      found.length > shown && h('button', { type: 'button', class: 'button secondary', onclick: () => { shown += PAGE; renderBody(); } },
        `Show ${Math.min(PAGE, found.length - shown)} more`));
  }

  function clear() {
    view = { ...view, query: '', categoryId: null, incomeType: null, tripId: null, methodId: null };
    shown = PAGE;
    renderControls();
    renderBody();
  }

  function renderVendors() {
    const q = view.vendorQuery.trim().toLowerCase();
    const counts = new Map();
    const last = new Map();
    for (const e of S.entries) {
      if (e.deletedAt || !e.vendorId) continue;
      counts.set(e.vendorId, (counts.get(e.vendorId) ?? 0) + 1);
      if (e.date > (last.get(e.vendorId) ?? '')) last.set(e.vendorId, e.date);
    }
    const vendors = liveSorted(S.vendors, 'name').filter((v) => !q || v.name.toLowerCase().includes(q)
      || S.aliases.some((a) => !a.deletedAt && a.vendorId === v.id && a.alias.toLowerCase().includes(q)));
    if (!S.vendors.some((v) => !v.deletedAt)) {
      return fill(el.body, h('section', { class: 'empty' },
        h('h2', {}, 'No Merchants Yet')));
    }
    if (!vendors.length) return fill(el.body, h('p', { class: 'empty-line' }, 'No merchant has that name.'));
    fill(el.body, h('ul', { class: 'list' }, vendors.map((v) => h('li', {},
      h('button', { type: 'button', class: 'list-row', onclick: () => openVendorSheet(repo, v) },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, v.name, !v.categoryId && h('span', { class: 'tag tag-warn' }, 'No category')),
          h('span', { class: 'list-sub' }, [
            name(S.categories, v.categoryId),
            counts.get(v.id) ? `${counts.get(v.id) === 1 ? '1 payment' : `${counts.get(v.id)} payments`}, last ${formatDay(last.get(v.id))}` : 'No payments',
          ].filter(Boolean).join(', '))))))));
  }

  function renderBody() {
    if (view.kind === 'vendors') renderVendors();
    else if (view.kind === 'people') renderPeople(el.body, repo);
    else renderPayments();
  }

  renderSwitch();
  renderControls();
  renderBody();
  // New data (a sync or a save) redraws the list, never the search box being typed in
  // (the filters only when a trip picked in them was deleted).
  return { refresh: () => { if (dropGoneTrip()) renderControls(); renderBody(); } };
}
