// Plan: recurring costs and income. Each is added automatically on its date by the backend,
// and counts in "left this month" until then.

import { h, fill, chips, segmented, field, sheet, toast } from './dom.js';
import { liveSorted, runAction, withRemoved } from './format.js';
import {
  today, gbp, formatMoney, formatDay, toMinor, toDecimalText, planSummary, catchUpDates,
  FREQUENCIES, INCOME_TYPES, COMMON_CURRENCIES,
} from '../engine/index.js';

const FIELDS = ['kind', 'label', 'amountMinor', 'currency', 'frequency', 'nextDate', 'anchorDay', 'categoryId', 'incomeType', 'methodId', 'spreadMonths', 'active'];
const frequencyName = (id) => FREQUENCIES.find((f) => f.id === id)?.name ?? id;

/**
 * Adds or edits a recurring item. item is an existing row, or starting values for a new one
 * ({ kind: 'income', incomeType: 'allowance', ... }).
 */
export function openRecurringSheet(repo, item = {}) {
  const S = repo.state;
  const existing = item.id ? item : null;
  const f = {
    kind: item.kind ?? 'spend',
    label: item.label ?? '',
    amount: item.amountMinor ? toDecimalText(item.amountMinor, item.currency ?? 'GBP') : '',
    currency: item.currency ?? 'GBP',
    frequency: item.frequency ?? 'monthly',
    nextDate: item.nextDate ?? today(),
    categoryId: item.categoryId ?? null,
    incomeType: item.incomeType ?? null,
    methodId: item.methodId ?? null,
    spread: (item.spreadMonths ?? 1) > 1,
    active: item.active !== 0,
  };
  const body = h('div', { class: 'sheet-form' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  function missing() {
    if (!f.label.trim()) return f.kind === 'income' ? 'Name the income' : 'Name the cost';
    if (!toMinor(f.amount, f.currency)) return 'Enter an amount';
    if (!f.nextDate) return 'Pick the next date';
    if (f.kind === 'income' && !f.incomeType) return 'Pick a type of income';
    return null;
  }

  function renderSave() {
    const need = missing();
    save.disabled = !!need;
    save.textContent = need ?? (existing ? 'Save changes' : `Add ${formatMoney(toMinor(f.amount, f.currency), f.currency)} ${frequencyName(f.frequency).toLowerCase()}`);
    renderCatchUp();
  }

  const catchUp = h('p', { class: 'warning', hidden: true });
  function renderCatchUp() {
    const todayDate = today();
    const dates = f.nextDate && f.nextDate < todayDate && f.active ? catchUpDates({ nextDate: f.nextDate, frequency: f.frequency }, todayDate) : [];
    catchUp.hidden = !dates.length;
    if (dates.length) {
      catchUp.textContent = dates.length === 1
        ? 'The date has passed, so it’s added on the next run, within 6 hours.'
        : `The date has passed, so the next run adds ${dates.length}, one for each date from ${formatDay(dates[0])} to ${formatDay(dates.at(-1))}.`;
    }
  }

  const set = (changes, rerender = false) => { Object.assign(f, changes); if (rerender) render(); else renderSave(); };

  function render() {
    const income = f.kind === 'income';
    const label = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'sentences', value: f.label,
      placeholder: income ? 'Part-time job' : 'Phone contract', oninput: () => set({ label: label.value }) });
    const amount = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.amount,
      oninput: () => { amount.value = amount.value.replace(/[^\d.]/g, ''); set({ amount: amount.value }); } });
    const currency = h('select', { class: 'select', onchange: () => set({ currency: currency.value }) },
      [...new Set([f.currency, ...COMMON_CURRENCIES])].map((c) => h('option', { value: c, selected: c === f.currency }, c)));
    const next = h('input', { class: 'input', type: 'date', value: f.nextDate, required: true, onchange: () => set({ nextDate: next.value }) });
    const categories = liveSorted(S.categories).filter((c) => !c.archived);
    const methods = liveSorted(S.methods, 'name');
    body.replaceChildren(...[
      !existing && segmented({
        label: 'Cost or income',
        options: [{ value: 'spend', label: 'Cost' }, { value: 'income', label: 'Income' }],
        value: f.kind,
        onChange: (v) => set({ kind: v, spread: false }, true),
      }),
      field('Name', label),
      h('div', { class: 'row-2' }, field('Amount', amount), field('Currency', currency)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How often'),
        chips({ label: 'How often', options: FREQUENCIES.map((x) => ({ value: x.id, label: x.name })), value: f.frequency, onChange: (v) => set({ frequency: v }) })),
      field(existing ? 'Next date' : 'First date', next, f.frequency === 'termly' ? 'Every term means every 4 months from this date.' : null),
      catchUp,
      income
        ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Type of income'),
          chips({ label: 'Type of income', options: INCOME_TYPES.filter((t) => !t.oneOff || t.id === f.incomeType).map((t) => ({ value: t.id, label: t.name })), value: f.incomeType,
            onChange: (v) => set({ incomeType: v, spread: v === 'allowance' && f.frequency === 'yearly' }, true) }))
        : h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Category'),
          chips({ label: 'Category', options: withRemoved(categories, f.categoryId, S.categories), value: f.categoryId, onChange: (v) => set({ categoryId: v }) })),
      income && f.incomeType === 'allowance' && h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: f.spread, onchange: (e) => set({ spread: e.target.checked }) }),
        h('span', {}, 'Spread over October to September')),
      methods.length > 0 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, income ? 'Paid into' : 'Paid with'),
        chips({ label: income ? 'Paid into' : 'Paid with', options: withRemoved(methods, f.methodId, S.methods), value: f.methodId, onChange: (v) => set({ methodId: v }) })),
      existing && h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', checked: f.active, onchange: (e) => set({ active: e.target.checked }) }),
        h('span', {}, 'Add it automatically')),
      existing && !f.active && h('p', { class: 'field-hint' }, 'Paused.'),
      h('div', { class: 'sheet-actions' },
        save,
        existing && h('button', { type: 'button', class: 'button danger', onclick: () => remove() }, income ? 'Delete income' : 'Delete cost')),
    ].filter(Boolean));
    renderSave();
  }

  async function submit() {
    if (missing()) return;
    save.disabled = true;
    const income = f.kind === 'income';
    const fields = {
      kind: f.kind,
      label: f.label.trim(),
      amountMinor: toMinor(f.amount, f.currency),
      currency: f.currency,
      frequency: f.frequency,
      nextDate: f.nextDate,
      // A new date sets the day of the month it keeps.
      anchorDay: existing && existing.nextDate === f.nextDate ? existing.anchorDay : null,
      categoryId: income ? null : f.categoryId,
      incomeType: income ? f.incomeType : null,
      methodId: f.methodId,
      spreadMonths: income && f.incomeType === 'allowance' && f.spread ? 12 : 1,
      active: f.active ? 1 : 0,
    };
    const id = existing?.id ?? crypto.randomUUID();
    const before = existing && Object.fromEntries(FIELDS.map((k) => [k, existing[k] ?? null]));
    const result = await runAction(() => repo.saveRow('recurring', id, fields));
    if (!result) return renderSave();
    s.close();
    if (existing) toast('Saved changes', { label: 'Undo', run: () => runAction(() => repo.saveRow('recurring', id, before)) });
    else toast(`Added ${fields.label}`, { label: 'Undo', run: () => runAction(() => repo.deleteRow('recurring', id)) });
  }

  async function remove() {
    if (!(await runAction(() => repo.deleteRow('recurring', existing.id)))) return;
    s.close();
    toast(`Deleted ${existing.label}`, { label: 'Undo', run: () => runAction(() => repo.restoreRow('recurring', existing.id)) });
  }

  const s = sheet(existing ? existing.label : 'Add to Your Plan', body);
  render();
}

export function renderPlan(root, { repo }) {
  const S = repo.state;

  function row(item) {
    const paused = item.active === 0;
    const extra = item.kind === 'income'
      ? [INCOME_TYPES.find((t) => t.id === item.incomeType)?.name, item.spreadMonths > 1 && 'spread over the year']
      : [S.categories.find((c) => c.id === item.categoryId)?.name];
    return h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => openRecurringSheet(repo, item) },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, item.label, paused && h('span', { class: 'tag tag-quiet' }, 'Paused')),
        h('span', { class: 'list-sub' }, [frequencyName(item.frequency), paused ? null : `next ${formatDay(item.nextDate)}`, ...extra].filter(Boolean).join(', '))),
      h('span', { class: 'list-amount' }, formatMoney(item.amountMinor, item.currency))));
  }

  function section(title, items, empty, addLabel, kind) {
    return h('section', { class: 'section' },
      h('h2', { class: 'subhead' }, title),
      items.length ? h('ul', { class: 'list' }, items.map(row)) : h('p', { class: 'empty-line' }, empty),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openRecurringSheet(repo, { kind }) }, addLabel)));
  }

  function render() {
    if (!repo.connected()) {
      return fill(root, h('section', { class: 'empty' },
        h('h2', {}, 'Connect to Your Backend First'),
        h('p', {}, 'Add your backend in Settings.'),
        h('button', { type: 'button', class: 'button primary', onclick: () => { location.hash = '#settings'; } }, 'Open Settings')));
    }
    const p = planSummary(S.recurring, { rates: S.rates });
    if (!p.costs.length && !p.income.length) {
      return fill(root, h('section', { class: 'empty' },
        h('h2', {}, 'Nothing Planned Yet'),
        h('p', {}, 'Each item is logged for you on its date.'),
        h('button', { type: 'button', class: 'button primary', onclick: () => openRecurringSheet(repo, { kind: 'spend' }) }, 'Add a recurring cost'),
        h('button', { type: 'button', class: 'button secondary', onclick: () => openRecurringSheet(repo, { kind: 'income' }) }, 'Add recurring income')));
    }
    const tilde = p.estimated ? '~' : '';
    fill(root, h('div', { class: 'screen' },
      h('section', { class: 'plan-summary', 'aria-label': 'Each month' },
        h('ul', { class: 'list totals' },
          h('li', { class: 'total-row' }, h('span', { class: 'list-title' }, 'Coming in'), h('span', { class: 'list-amount' }, `${tilde}${gbp(p.monthlyIncome)}`)),
          h('li', { class: 'total-row' }, h('span', { class: 'list-title' }, 'Going out'), h('span', { class: 'list-amount' }, `${tilde}${gbp(p.monthlyCosts)}`))),
        h('p', { class: 'reason' }, 'In an average month.')),
      section('Costs', p.costs, 'No recurring costs.', 'Add a recurring cost', 'spend'),
      section('Income', p.income, 'No recurring income.', 'Add recurring income', 'income')));
  }

  render();
  return { refresh: render };
}
