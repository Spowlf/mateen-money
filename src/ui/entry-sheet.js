// Editing a payment or income from History: every field, the statement amount, and delete.
// Saving and deleting both offer Undo; Undo puts back exactly what was there.

import { h, chips, segmented, field, sheet, toast, withCategoryIcons } from './dom.js';
import { money, liveSorted, runAction, withRemoved } from './format.js';
import { intoField } from './accounts.js';
import { splitBlock } from './split-block.js';
import {
  gbp, formatMoney, formatDay, toMinor, toDecimalText, exactVendor, INCOME_TYPES, COMMON_CURRENCIES,
  splitFromEntry, splitParts, splitMissing, splitsOf, emptySplit, titleCase,
} from '../engine/index.js';

// The fields the app sends when saving an entry (the backend owns the rest).
const FIELDS = ['kind', 'date', 'time', 'at', 'amountMinor', 'currency', 'merchant', 'vendorId', 'categoryId', 'incomeType',
  'methodId', 'accountId', 'note', 'tripId', 'tripManual', 'spreadStart', 'spreadMonths', 'needsCurrency', 'paidBy'];

/**
 * An entry as a PUT body that puts it back exactly: its statement amount included, and with splits
 * (S.splits), its split as it was.
 */
export function entryBody(e, splits = null) {
  const body = Object.fromEntries(FIELDS.map((f) => [f, e[f] ?? null]));
  body.gbpStatus = e.gbpStatus === 'statement' ? 'statement' : 'estimated';
  if (e.gbpStatus === 'statement') body.gbpPence = e.gbpPence;
  if (splits && e.kind === 'spend') body.splits = splitsOf(splits, e.id).map((s) => ({ id: s.id, personId: s.personId, amountMinor: s.amountMinor }));
  return body;
}

/**
 * Why a payment's amount, currency and split can't change, or null: a settled split.
 * "Alex settled this bill on 7 Oct 2026. Undo that settle-up to change the amount, currency or split."
 */
export function settledReason(S, entry) {
  const settled = splitsOf(S.splits ?? [], entry.id).find((s) => s.settlementId);
  if (!settled) return null;
  const person = (S.people ?? []).find((p) => p.id === settled.personId)?.name ?? 'Someone';
  const when = (S.settlements ?? []).find((t) => t.id === settled.settlementId);
  return `${person} settled this bill${when ? ` on ${formatDay(when.date)}` : ''}. Undo that settle-up to change the amount, currency or split.`;
}

function gbpLine(e) {
  if (e.currency === 'GBP') return null;
  if (e.gbpStatus === 'statement') return `${gbp(e.gbpPence)} from your statement.`;
  if (e.gbpPence == null) return 'Waiting for an exchange rate.';
  const fee = e.feePence ? `, including a ${gbp(e.feePence)} fee` : '';
  return e.gbpStatus === 'final'
    ? `${gbp(e.gbpPence)} at ${e.rate} per £1.00${fee}.`
    : `~${gbp(e.gbpPence)} at ${e.rate} per £1.00${fee}.`;
}

const SOURCE_NOTE = {
  applepay: (e) => `Added by Apple Pay${e.card ? ` from ${e.card}` : ''}. It arrived as ${e.merchant}.`,
  recurring: () => 'Added automatically from your plan.',
};

export function openEntrySheet(repo, shown) {
  const S = repo.state;
  // History shows a split payment as your share; the sheet edits the payment itself.
  const entry = S.entries.find((e) => e.id === shown.id) ?? shown;
  const locked = settledReason(S, entry);
  const vendor = S.vendors.find((v) => v.id === entry.vendorId);
  const f = {
    kind: entry.kind,
    amount: toDecimalText(entry.amountMinor, entry.currency),
    currency: entry.currency,
    vendorText: vendor?.name ?? entry.merchant ?? '',
    categoryId: entry.categoryId,
    incomeType: entry.incomeType,
    methodId: entry.methodId,
    accountId: entry.accountId ?? null,
    date: entry.date,
    time: entry.time ?? '',
    tripId: entry.tripId,
    tripManual: !!entry.tripManual,
    note: entry.note ?? '',
    spread: (entry.spreadMonths ?? 1) > 1,
    statement: entry.gbpStatus === 'statement',
    statementText: entry.gbpStatus === 'statement' ? toDecimalText(entry.gbpPence, 'GBP') : '',
    split: splitFromEntry(entry, S.splits ?? []),
  };
  const initialVendorText = f.vendorText;

  const body = h('div', { class: 'sheet-form' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });
  const listId = `vendors-${entry.id}`;

  function missing() {
    if (!toMinor(f.amount, f.currency)) return 'Enter an Amount';
    if (f.kind === 'spend' && !f.vendorText.trim()) return 'Enter a Merchant';
    if (f.kind === 'spend' && !f.categoryId) return 'Pick a Category';
    if (f.kind === 'income' && !f.incomeType) return 'Pick a Type of Income';
    if (!f.date) return 'Pick a Date';
    if (f.statement && toMinor(f.statementText, 'GBP') === null) return 'Enter the Statement Amount';
    if (f.kind === 'spend' && !locked) return splitMissing(f.split, toMinor(f.amount, f.currency), f.currency);
    return null;
  }

  function renderSave() {
    const need = missing();
    save.disabled = !!need;
    save.textContent = need ? titleCase(need) : 'Save Changes';
  }

  const set = (changes, rerender = false) => { Object.assign(f, changes); if (rerender) render(); else renderSave(); };

  function render() {
    const income = f.kind === 'income';
    const amount = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.amount, readonly: !!locked,
      oninput: () => { amount.value = amount.value.replace(/[^\d.]/g, ''); set({ amount: amount.value }); } });
    // A new currency: an even split follows by itself; typed amounts are cleared to type again.
    const currency = h('select', { class: 'select', disabled: !!locked, onchange: () => set({
      currency: currency.value,
      statement: currency.value === 'GBP' ? false : f.statement,
      split: f.split.mode === 'amount' ? { ...f.split, amounts: {}, share: '' } : f.split,
    }, true) },
      [...new Set([f.currency, ...COMMON_CURRENCIES])].map((c) => h('option', { value: c, selected: c === f.currency }, c)));
    const vendorInput = h('input', { class: 'input', type: 'text', list: listId, autocomplete: 'off', autocapitalize: 'words', value: f.vendorText,
      placeholder: income ? 'Optional' : '', oninput: () => set({ vendorText: vendorInput.value }) });
    const date = h('input', { class: 'input', type: 'date', value: f.date, required: true, onchange: () => set({ date: date.value }) });
    const time = h('input', { class: 'input', type: 'time', value: f.time, onchange: () => set({ time: time.value }) });
    const categories = liveSorted(S.categories).filter((c) => !c.archived);
    const methods = liveSorted(S.methods, 'name');
    const trips = S.trips.filter((t) => !t.deletedAt).sort((a, b) => (a.start < b.start ? 1 : -1));
    const trip = h('select', { class: 'select', onchange: () => set({ tripId: trip.value || null, tripManual: true }) },
      h('option', { value: '', selected: !f.tripId }, 'No Trip'),
      withRemoved(trips, f.tripId, S.trips).map((t) => h('option', { value: t.value, selected: t.value === f.tripId }, t.label)));
    const note = h('input', { class: 'input', type: 'text', autocomplete: 'off', value: f.note, oninput: () => set({ note: note.value }) });
    const statement = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.statementText,
      oninput: () => { statement.value = statement.value.replace(/[^\d.]/g, ''); set({ statementText: statement.value }); } });
    const foreign = f.currency !== 'GBP';
    const unchangedMoney = f.currency === entry.currency && toMinor(f.amount, f.currency) === entry.amountMinor;

    body.replaceChildren(...[
      SOURCE_NOTE[entry.source] && h('p', { class: 'reason' }, SOURCE_NOTE[entry.source](entry)),
      locked && h('p', { class: 'reason' }, locked),
      !locked && segmented({
        label: 'Spent or received',
        options: [{ value: 'spend', label: 'Spent' }, { value: 'income', label: 'Received' }],
        value: f.kind,
        className: 'kind-switch',
        onChange: (v) => set({ kind: v, spread: false }, true),
      }),
      h('div', { class: 'row-2' }, field('Amount', amount), field('Currency', currency)),
      foreign && h('div', { class: 'field' },
        unchangedMoney && !f.statement && gbpLine(entry) && h('p', { class: 'reason' }, gbpLine(entry)),
        h('label', { class: 'toggle' },
          h('input', { type: 'checkbox', checked: f.statement, onchange: (e) => set({ statement: e.target.checked }, true) }),
          h('span', {}, 'Use the Amount on My Statement')),
        f.statement && field('Amount on Your Statement, in £', statement, null)),
      field(income ? 'From' : 'Merchant', vendorInput,
        !income && vendor && f.vendorText === initialVendorText && entry.merchant && entry.merchant !== vendor.name ? `Arrived as ${entry.merchant}.` : null),
      h('datalist', { id: listId }, liveSorted(S.vendors, 'name').map((v) => h('option', { value: v.name }))),
      field('Description', note),
      income
        ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Type of Income'),
          chips({ label: 'Type of Income', options: INCOME_TYPES.map((t) => ({ value: t.id, label: t.name })), value: f.incomeType,
            onChange: (v) => set({ incomeType: v, spread: v === 'allowance' ? f.spread : false }, true) }))
        : h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Category'),
          chips({ label: 'Category', options: withCategoryIcons(withRemoved(categories, f.categoryId, S.categories)), value: f.categoryId, onChange: (v) => set({ categoryId: v }) })),
      income && f.incomeType === 'allowance' && h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: f.spread, onchange: (e) => set({ spread: e.target.checked }) }),
        h('span', {}, 'Spread Over October to September')),
      h('div', { class: 'row-2' }, field('Date', date), field('Time', time)),
      // Someone else paid: none of your cards was used.
      !income && !f.split.paidBy && methods.length > 0 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Paid With'),
        chips({ label: 'Paid With', options: withRemoved(methods, f.methodId, S.methods), value: f.methodId, onChange: (v) => set({ methodId: v }) })),
      !income && splitBlock({
        repo,
        get: () => ({ split: f.split, amountMinor: toMinor(f.amount, f.currency), currency: f.currency }),
        onChange: (split, { quiet = false } = {}) => set({ split }, !quiet),
        locked: locked ? 'Settled: it can’t change until that settle-up is undone.' : null,
        waiting: entry.needsCurrency && f.currency === entry.currency ? 'Pick the currency first.' : null,
      }).el,
      income && intoField(S, f.accountId, (v) => set({ accountId: v })),
      ((!income && trips.length > 0) || f.tripId) && field('Trip', trip, f.tripManual ? null : 'Suggested from the date.'),
      h('div', { class: 'sheet-actions' },
        save,
        h('button', { type: 'button', class: 'button danger', onclick: () => remove() }, entry.kind === 'income' ? 'Delete Income' : 'Delete Payment')),
    ].filter(Boolean));
    renderSave();
  }

  function toBody() {
    const income = f.kind === 'income';
    const text = f.vendorText.trim();
    let merchant = entry.merchant;
    let vendorId = income ? null : entry.vendorId;
    if (text !== initialVendorText.trim()) {
      merchant = text || null;
      vendorId = income ? null : exactVendor(text, S.vendors, S.aliases)?.id ?? null;
    }
    const spreadMonths = income && f.incomeType === 'allowance' && f.spread ? 12 : 1;
    const out = {
      ...entryBody(entry),
      kind: f.kind,
      amountMinor: toMinor(f.amount, f.currency),
      currency: f.currency,
      merchant,
      vendorId,
      categoryId: income ? null : f.categoryId,
      incomeType: income ? f.incomeType : null,
      methodId: income ? null : f.methodId,
      accountId: income ? f.accountId : null,
      date: f.date,
      time: f.time || null,
      note: f.note.trim() || null,
      tripId: f.tripId,
      tripManual: f.tripManual ? 1 : 0,
      spreadMonths,
      // A new date or spread starts where the backend says (the allowance covers Oct–Sep).
      spreadStart: spreadMonths === entry.spreadMonths && f.date === entry.date ? entry.spreadStart : null,
      needsCurrency: f.currency !== entry.currency ? 0 : entry.needsCurrency ?? 0,
      gbpStatus: f.statement && f.currency !== 'GBP' ? 'statement' : 'estimated',
    };
    if (out.gbpStatus === 'statement') out.gbpPence = toMinor(f.statementText, 'GBP');
    else delete out.gbpPence;
    // The split, sent in full each time (a settled bill's is left as it is). Income has none.
    if (!locked) {
      const split = income ? emptySplit() : f.split;
      const { paidBy, parts } = splitParts(split, out.amountMinor, out.currency);
      out.paidBy = paidBy;
      out.splits = parts;
      if (paidBy) out.methodId = null;
    }
    return out;
  }

  const label = (e) => (e.kind === 'income' ? `${formatMoney(e.amountMinor, e.currency)} income` : `${money(e)} at ${S.vendors.find((v) => v.id === e.vendorId)?.name ?? e.merchant}`);

  async function submit() {
    if (missing()) return;
    save.disabled = true;
    const before = entryBody(entry, locked ? null : S.splits ?? []);
    const result = await runAction(() => repo.saveEntry({ id: entry.id, ...toBody() }));
    if (!result) return renderSave();
    s.close();
    toast('Saved changes', { label: 'Undo', run: () => runAction(async () => { await repo.saveEntry({ id: entry.id, ...before }); toast('Changed back'); }) });
  }

  async function remove() {
    const result = await runAction(() => repo.deleteEntry(entry.id));
    if (!result) return;
    s.close();
    toast(`Deleted ${label(entry)}`, { label: 'Undo', run: () => runAction(() => repo.restoreEntry(entry.id)) });
  }

  const s = sheet(entry.kind === 'income' ? 'Edit Income' : 'Edit Payment', body);
  render();
}
