// Log: the headline, To sort, and the entry form. Home screen: type the amount, tap a vendor, Save.

import { h, fill, chips, field, sheet, toast } from './dom.js';
import { money, whenPhrase, liveSorted, runAction } from './format.js';
import { renderHeadline } from './headline.js';
import { renderReview } from './review.js';
import { sortPayment, openSortSheet, sortContext, reread } from './sort-sheet.js';
import {
  today, nowTime, formatMoney, toMinor, toDecimalText, exponent, prefix,
  emptyForm, missing, pressKey, applyVendor, nextForm, vendorChoices, tidyName, summaryLine,
  matchVendor, tripFor, toSortEntries, toSortNudge, sortChoices, topCategories,
  COMMON_CURRENCIES, SYMBOL_CURRENCIES, INCOME_TYPES,
} from '../engine/index.js';

const TO_SORT_SHOWN = 3;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

export function renderLog(root, { repo }) {
  const S = repo.state;
  const el = {
    headline: h('section', { 'aria-live': 'polite' }),
    review: h('section', { class: 'section', 'aria-label': 'Weekly review' }),
    toSort: h('section', { class: 'section', 'aria-label': 'To sort' }),
    entry: h('section', { class: 'entry', 'aria-label': 'Log a payment' }),
  };
  fill(root, h('div', { class: 'screen' }, el.headline, el.review, el.toSort, el.entry));

  let showAllToSort = false;
  // The details stay folded under the summary line until "Change" opens them.
  let detailsOpen = false;
  let form = null;
  let busy = false;
  let offline = !navigator.onLine;

  const renderHeadlinePanel = () => {
    renderHeadline(el.headline, repo);
    renderReview(el.review, { repo, showToSort: () => el.toSort.scrollIntoView({ behavior: 'smooth', block: 'start' }) });
  };

  // To sort

  const sort = (entry, choice) => sortPayment(repo, entry, choice);

  function sortRow(entry) {
    const sub = [whenPhrase(entry), entry.card ?? S.methods.find((m) => m.id === entry.methodId)?.name].filter(Boolean).join(', ');
    let quick;
    if (entry.needsCurrency) {
      const options = SYMBOL_CURRENCIES[entry.symbol] ?? [entry.currency];
      quick = h('div', { class: 'chips', role: 'group', 'aria-label': `Which currency is ${entry.symbol}${toDecimalText(entry.amountMinor, entry.currency)}?` },
        options.map((c) => h('button', { type: 'button', class: 'chip', onclick: () => sort(entry, { currency: c }) }, formatMoney(reread(entry, c), c))));
    } else {
      const { vendor, categories } = sortChoices(entry, sortContext(S));
      quick = h('div', { class: 'chips', role: 'group', 'aria-label': `Sort ${entry.merchant}` },
        vendor && h('button', { type: 'button', class: 'chip suggestion', onclick: () => sort(entry, { vendorId: vendor.id }) }, vendor.name),
        categories.map((c) => h('button', { type: 'button', class: 'chip', onclick: () => sort(entry, { categoryId: c.id, vendorName: tidyName(entry.merchant) }) }, c.name)),
        h('button', { type: 'button', class: 'chip', onclick: () => openSortSheet(repo, entry) }, 'Other'));
    }
    return h('li', { class: 'sort-item' },
      h('button', { type: 'button', class: 'list-row', onclick: () => openSortSheet(repo, entry) },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, entry.merchant),
          h('span', { class: 'list-sub' }, entry.needsCurrency ? `Which currency? ${sub}` : sub)),
        h('span', { class: 'list-amount' }, money(entry))),
      quick);
  }

  function renderToSort() {
    const items = toSortEntries(S.entries);
    el.toSort.hidden = !items.length;
    if (!items.length) return fill(el.toSort);
    const shown = showAllToSort ? items : items.slice(0, TO_SORT_SHOWN);
    const nudge = toSortNudge(items.length);
    fill(el.toSort,
      h('h2', { class: 'subhead' }, 'To sort', h('span', { class: 'tag' }, items.length)),
      nudge && h('p', { class: 'hint' }, nudge),
      h('ul', { class: 'list' }, shown.map(sortRow)),
      items.length > shown.length && h('div', {},
        h('button', { type: 'button', class: 'text-button', onclick: () => { showAllToSort = true; renderToSort(); } }, `Show ${items.length - shown.length} more`)));
  }

  // Entry form

  const lastMethod = () => [...S.entries].filter((e) => e.source === 'manual' && !e.deletedAt && e.methodId)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0]?.methodId ?? 'card';

  const freshForm = () => withTrip(emptyForm({ id: crypto.randomUUID(), date: today(), time: nowTime(), methodId: lastMethod() }));

  // Spending on a trip's days is suggested for it until a trip is picked by hand. Income never is.
  const withTrip = (f) => ({ ...f, tripId: tripFor(f, S.trips) });

  function set(changes, { details = false } = {}) {
    form = { ...form, ...changes };
    repo.draft.save(form).catch(() => {});
    renderForm({ details });
  }

  const kind = chips({
    label: 'Spent or received',
    options: [{ value: 'spend', label: 'Spent' }, { value: 'income', label: 'Received' }],
    value: 'spend',
    onChange: (v) => set(withTrip({ ...form, kind: v, categoryId: null, incomeType: null, vendorId: null, spreadMonths: 1, spreadStart: null, tripManual: false }), { details: true }),
  });
  const currencyButton = h('button', { type: 'button', class: 'currency', 'aria-label': 'Change currency', onclick: () => openCurrencySheet() });
  const amountNum = h('span', { class: 'num' });
  const display = h('output', { class: 'pad-display', 'aria-live': 'polite' }, currencyButton, amountNum);
  const vendorInput = h('input', {
    class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done',
    oninput: () => onVendorTyped(vendorInput.value),
  });
  const vendorLabel = h('span', { class: 'field-label' });
  const vendorChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Recent merchants' });
  const noteInput = h('input', {
    class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', placeholder: 'Optional',
    oninput: () => set({ note: noteInput.value }),
  });
  const quick = h('div', { class: 'field' });
  const keypad = h('div', { class: 'keypad' }, KEYS.map((k) => h('button', {
    type: 'button', class: 'key',
    'aria-label': k === 'back' ? 'Delete' : k === '.' ? 'Decimal point' : k,
    onclick: () => press(k),
  }, k === 'back' ? '⌫' : k)));
  const summaryText = h('span');
  const changeButton = h('button', { type: 'button', class: 'text-button', 'aria-controls': 'details', onclick: () => showDetails(!detailsOpen) });
  const summary = h('p', { class: 'summary' }, summaryText, changeButton);
  const offlineNote = h('p', { class: 'warning' }, 'You’re offline. Save when you’re back online.');
  const saveButton = h('button', { type: 'button', class: 'button primary', onclick: () => save() });
  const details = h('div', { class: 'details', id: 'details' });

  fill(el.entry, kind, display, h('label', { class: 'field' }, vendorLabel, vendorInput), vendorChips,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), noteInput), quick, keypad, summary, details, offlineNote, saveButton);

  function showDetails(open) {
    detailsOpen = open;
    renderForm({ details: open });
    if (open) details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function press(k) {
    set({ amount: pressKey(form.amount, k, form.currency) });
  }

  function onVendorTyped(value) {
    const { exact } = matchVendor(value, S.vendors, S.aliases);
    if (form.kind === 'spend' && exact && exact.id !== form.vendorId) {
      form = { ...applyVendor(form, exact), vendorName: value };
      set({}, { details: true });
    } else {
      set({ vendorName: value, vendorId: exact && form.kind === 'spend' ? exact.id : null });
    }
  }

  function pickVendor(vendor) {
    form = applyVendor(form, vendor);
    vendorInput.value = vendor.name;
    set({}, { details: true });
  }

  function renderAmount() {
    currencyButton.textContent = prefix(form.currency).trim();
    amountNum.textContent = form.amount || '0';
    amountNum.classList.toggle('placeholder', !form.amount);
  }

  function renderVendor() {
    const income = form.kind === 'income';
    vendorLabel.textContent = income ? 'From' : 'Merchant';
    vendorInput.placeholder = income ? 'Optional' : '';
    if (vendorInput.value !== form.vendorName) vendorInput.value = form.vendorName;
    if (noteInput.value !== form.note) noteInput.value = form.note;
    vendorChips.hidden = income;
    if (income) return fill(vendorChips);
    fill(vendorChips, vendorChoices(S.vendors, S.entries, form.vendorId ? '' : form.vendorName).map((v) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(v.id === form.vendorId), onclick: () => pickVendor(v),
    }, v.name)));
  }

  // The question that has to be answered before saving, asked right under the vendor.
  function renderQuick() {
    if (form.kind === 'income') {
      quick.hidden = false;
      return fill(quick, h('span', { class: 'field-label' }, 'Type of income'), chips({
        label: 'Type of income', options: INCOME_TYPES.map((t) => ({ value: t.id, label: t.name })), value: form.incomeType,
        onChange: (v) => set({ incomeType: v, spreadMonths: v === 'allowance' ? 12 : 1 }, { details: true }),
      }));
    }
    const vendor = S.vendors.find((v) => v.id === form.vendorId);
    const needsCategory = form.vendorName.trim() && !vendor?.categoryId;
    quick.hidden = !needsCategory;
    if (!needsCategory) return fill(quick);
    let options = topCategories(S.entries, S.categories, { todayDate: today(), n: 4 });
    const chosen = S.categories.find((c) => c.id === form.categoryId);
    if (chosen && !options.includes(chosen)) options = [...options.slice(0, 3), chosen];
    const group = chips({
      label: `Category for ${form.vendorName.trim()}`,
      options: options.map((c) => ({ value: c.id, label: c.name })),
      value: form.categoryId,
      onChange: (v) => set({ categoryId: v }, { details: true }),
    });
    group.append(h('button', { type: 'button', class: 'chip', onclick: () => showDetails(true) }, 'More'));
    fill(quick, h('span', { class: 'field-label' }, `Category for ${form.vendorName.trim()}`), group);
  }

  function renderSave() {
    const need = missing(form);
    const minor = toMinor(form.amount, form.currency);
    saveButton.disabled = busy || !!need;
    saveButton.textContent = need ?? `Save ${formatMoney(minor, form.currency)}`;
    offlineNote.hidden = !offline;
    details.hidden = !detailsOpen;
    changeButton.textContent = detailsOpen ? 'Hide details' : 'Change';
    changeButton.setAttribute('aria-expanded', String(detailsOpen));
    summaryText.textContent = summaryLine(form, { categories: S.categories, methods: S.methods, trips: S.trips, todayDate: today() });
  }

  function renderDetails() {
    const income = form.kind === 'income';
    const date = h('input', { class: 'input', type: 'date', value: form.date, required: true,
      onchange: () => { if (date.value) set(withTrip({ ...form, date: date.value }), { details: true }); } });
    const time = h('input', { class: 'input', type: 'time', value: form.time ?? '', onchange: () => set({ time: time.value || null }) });
    const currency = h('select', { class: 'select', onchange: () => changeCurrency(currency.value) },
      [...new Set([form.currency, ...COMMON_CURRENCIES])].map((c) => h('option', { value: c, selected: c === form.currency }, c)));
    const methods = liveSorted(S.methods, 'name');
    const categories = liveSorted(S.categories).filter((c) => !c.archived || c.id === form.categoryId);
    const trips = S.trips.filter((t) => !t.deletedAt).sort((a, b) => (a.start < b.start ? 1 : -1));
    const trip = h('select', { class: 'select', onchange: () => set({ tripId: trip.value || null, tripManual: true }) },
      h('option', { value: '', selected: !form.tripId }, 'No trip'),
      trips.map((t) => h('option', { value: t.id, selected: t.id === form.tripId }, t.name)));
    fill(details,
      h('div', { class: 'row-2' }, field('Date', date), field('Time', time)),
      field('Currency', currency),
      methods.length > 0 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Paid with'),
        chips({ label: 'Paid with', options: methods.map((m) => ({ value: m.id, label: m.name })), value: form.methodId, onChange: (v) => set({ methodId: v }) })),
      !income && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Category'),
        chips({ label: 'Category', options: categories.map((c) => ({ value: c.id, label: c.name })), value: form.categoryId, onChange: (v) => set({ categoryId: v }, { details: true }) })),
      income && form.incomeType === 'allowance' && h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: form.spreadMonths === 12, onchange: (e) => set({ spreadMonths: e.target.checked ? 12 : 1 }) }),
        h('span', {}, 'Spread over October to September')),
      !income && trips.length > 0 && field('Trip', trip, form.tripManual ? null : 'Suggested from the date.'));
  }

  function renderForm({ details: withDetails = false } = {}) {
    kind.set(form.kind);
    renderAmount();
    renderVendor();
    renderQuick();
    renderSave();
    if (withDetails) renderDetails();
  }

  function changeCurrency(c) {
    let amount = form.amount;
    if (exponent(c) === 0) amount = amount.split('.')[0];
    set({ currency: c, amount }, { details: true });
  }

  function openCurrencySheet() {
    const s = sheet('Currency', h('div', { class: 'sheet-form' },
      chips({
        label: 'Currency',
        options: [...new Set([form.currency, ...COMMON_CURRENCIES])].map((c) => ({ value: c, label: c })),
        value: form.currency,
        onChange: (c) => { changeCurrency(c); s.close(); },
      })));
  }

  async function save() {
    if (busy || missing(form)) return;
    busy = true;
    renderSave();
    const saving = form;
    const result = await repo.saveForm(saving);
    busy = false;
    if (result.status === 'saved') {
      offline = false;
      const entry = result.entry;
      form = withTrip(nextForm(saving, { id: crypto.randomUUID(), time: saving.date === today() ? nowTime() : saving.time }));
      detailsOpen = false;
      repo.draft.save(form).catch(() => {});
      renderForm({ details: true });
      const where = entry.kind === 'income' ? (entry.merchant ? ` from ${entry.merchant}` : ' income') : ` at ${entry.merchant}`;
      toast(`Saved ${formatMoney(entry.amountMinor, entry.currency)}${where}`, {
        label: 'Undo',
        run: () => runAction(async () => {
          await repo.deleteEntry(entry.id);
          // Put what was typed back, under a new id: the old one is deleted.
          form = { ...saving, id: crypto.randomUUID() };
          repo.draft.save(form).catch(() => {});
          renderForm({ details: true });
          toast('Removed');
        }),
      });
    } else if (result.status === 'offline') {
      offline = true;
      renderSave();
    } else {
      renderSave();
      toast(result.message);
    }
  }

  function onKey(e) {
    if (!root.isConnected || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea, dialog')) return;
    const k = e.key === 'Backspace' ? 'back' : e.key;
    if (KEYS.includes(k)) { e.preventDefault(); press(k); }
    else if (e.key === 'Enter') save();
  }
  document.addEventListener('keydown', onKey);
  const onNetwork = () => { offline = !navigator.onLine; if (form) renderSave(); };
  window.addEventListener('online', onNetwork);
  window.addEventListener('offline', onNetwork);

  async function start() {
    const draft = await repo.draft.load().catch(() => null);
    form = draft ? { ...emptyForm({ date: today(), time: nowTime() }), ...draft, id: draft.id ?? crypto.randomUUID() } : freshForm();
    renderForm({ details: true });
  }

  renderHeadlinePanel();
  renderToSort();
  start();

  return {
    /** New data arrived (a sync or a save): update everything except what's being typed. */
    refresh() {
      renderHeadlinePanel();
      renderToSort();
      if (form) renderForm({ details: !el.entry.contains(document.activeElement) || vendorInput === document.activeElement });
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('online', onNetwork);
      window.removeEventListener('offline', onNetwork);
    },
  };
}
