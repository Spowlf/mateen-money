// Filing a To sort payment: one tap on Log, or the full sheet (from Log or History).

import { h, chips, field, sheet, toast } from './dom.js';
import { money, whenPhrase, liveSorted, runAction } from './format.js';
import { today, formatMoney, toMinor, toDecimalText, tidyName, sortChoices, SYMBOL_CURRENCIES } from '../engine/index.js';

export const sortContext = (S) => ({ vendors: S.vendors, aliases: S.aliases, entries: S.entries, categories: S.categories, todayDate: today() });

/** The amount read as another currency (an ambiguous "$12.50" as S$12.50). */
export function reread(entry, currency) {
  return toMinor(toDecimalText(entry.amountMinor, entry.currency), currency);
}

/** Files entry under a vendor or category ({ vendorId?, categoryId?, vendorName?, currency? }). */
export async function sortPayment(repo, entry, choice, done) {
  await runAction(async () => {
    const result = await repo.sortEntry(entry.id, choice);
    const sorted = result.changes.entries?.find((e) => e.id === entry.id);
    const category = repo.state.categories.find((c) => c.id === sorted?.categoryId);
    done?.();
    if (choice.currency && !category) toast(`Changed to ${formatMoney(sorted.amountMinor, sorted.currency)}`);
    else if (category) toast(result.changes.entries.length > 1 ? `Filed ${result.changes.entries.length} payments under ${category.name}` : `Filed under ${category.name}`);
  });
}

export function openSortSheet(repo, entry) {
  const S = repo.state;
  const { vendor: suggestion } = sortChoices(entry, sortContext(S));
  let categoryId = null;
  let currency = entry.needsCurrency ? null : entry.currency;
  const name = h('input', { class: 'input', type: 'text', value: tidyName(entry.merchant), autocomplete: 'off', autocapitalize: 'words' });
  const save = h('button', { type: 'button', class: 'button primary' });
  const renderSave = () => {
    const need = !categoryId ? 'Pick a category' : !currency ? 'Pick a currency' : !name.value.trim() ? 'Enter a merchant name' : null;
    save.disabled = !!need;
    save.textContent = need ?? 'Save';
  };
  name.addEventListener('input', renderSave);
  const categories = liveSorted(S.categories).filter((c) => !c.archived);
  const facts = h('dl', { class: 'facts' },
    h('dt', {}, 'Amount'), h('dd', {}, money(entry)),
    h('dt', {}, 'When'), h('dd', {}, whenPhrase(entry)),
    entry.card && [h('dt', {}, 'Card'), h('dd', {}, entry.card)],
    h('dt', {}, 'Arrived as'), h('dd', {}, entry.merchant));
  const s = sheet('Sort payment', h('div', { class: 'sheet-form' },
    facts,
    suggestion && h('p', { class: 'hint' }, `Looks like ${suggestion.name}. `,
      h('button', { type: 'button', class: 'text-button', onclick: () => sortPayment(repo, entry, { vendorId: suggestion.id, currency: currency ?? undefined }, s.close) }, `File under ${suggestion.name}`)),
    entry.needsCurrency === 1 && field('Currency', chips({
      label: 'Currency',
      options: (SYMBOL_CURRENCIES[entry.symbol] ?? [entry.currency]).map((c) => ({ value: c, label: formatMoney(reread(entry, c), c) })),
      value: null,
      onChange: (v) => { currency = v; renderSave(); },
    })),
    field('Merchant name', name, 'Later payments from this merchant are filed the same way.'),
    field('Category', chips({ label: 'Category', options: categories.map((c) => ({ value: c.id, label: c.name })), value: null, onChange: (v) => { categoryId = v; renderSave(); } })),
    h('div', { class: 'sheet-actions' },
      save,
      h('button', {
        type: 'button', class: 'button danger',
        onclick: () => runAction(async () => {
          await repo.deleteEntry(entry.id);
          s.close();
          toast(`Deleted ${money(entry)} at ${entry.merchant}`, { label: 'Undo', run: () => runAction(() => repo.restoreEntry(entry.id)) });
        }),
      }, 'Delete payment'))));
  save.addEventListener('click', () => sortPayment(repo, entry, {
    categoryId, vendorName: name.value.trim(), ...(entry.needsCurrency ? { currency } : {}),
  }, s.close));
  renderSave();
}
