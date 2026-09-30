// Editing a vendor's memory: name, category, currency, payment method, and the names it arrives as.

import { h, fill, chips, field, sheet, toast, icon } from './dom.js';
import { liveSorted, runAction, withRemoved } from './format.js';
import { formatDay, COMMON_CURRENCIES } from '../engine/index.js';

export function openVendorSheet(repo, vendor) {
  const S = repo.state;
  const f = { name: vendor.name, categoryId: vendor.categoryId, currency: vendor.currency ?? 'GBP', methodId: vendor.methodId };
  const own = S.entries.filter((e) => !e.deletedAt && e.vendorId === vendor.id);
  const last = own.reduce((d, e) => (e.date > d ? e.date : d), '');

  const name = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'words', value: f.name,
    oninput: () => { f.name = name.value; renderSave(); } });
  const currency = h('select', { class: 'select', onchange: () => { f.currency = currency.value; } },
    [...new Set([f.currency, ...COMMON_CURRENCIES])].map((c) => h('option', { value: c, selected: c === f.currency }, c)));
  const categories = liveSorted(S.categories).filter((c) => !c.archived);
  const methods = liveSorted(S.methods, 'name');
  const aliasList = h('div', { class: 'field' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  function renderSave() {
    const need = !f.name.trim() ? 'Enter a name' : null;
    save.disabled = !!need;
    save.textContent = need ?? 'Save changes';
  }

  function renderAliases() {
    const aliases = S.aliases.filter((a) => !a.deletedAt && a.vendorId === vendor.id).sort((a, b) => a.alias.localeCompare(b.alias));
    const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: 'PRET A MANGER #1234' });
    const add = h('button', { type: 'button', class: 'button secondary', onclick: async () => {
      const alias = input.value.trim();
      if (!alias) { input.setCustomValidity('Enter the name as it arrives.'); input.reportValidity(); return; }
      if (await runAction(() => repo.saveRow('aliases', crypto.randomUUID(), { vendorId: vendor.id, alias }))) {
        renderAliases();
        toast(`Payments arriving as ${alias} go to ${vendor.name}.`);
      }
    } }, 'Add');
    input.addEventListener('input', () => input.setCustomValidity(''));
    fill(aliasList,
      h('span', { class: 'field-label' }, 'Also arrives as'),
      aliases.length
        ? h('ul', { class: 'list' }, aliases.map((a) => h('li', { class: 'total-row' },
          h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, a.alias)),
          h('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove ${a.alias}`, onclick: async () => {
            if (!(await runAction(() => repo.deleteRow('aliases', a.id)))) return;
            renderAliases();
            toast(`Removed ${a.alias}`, { label: 'Undo', run: () => runAction(async () => { await repo.restoreRow('aliases', a.id); renderAliases(); }) });
          } }, icon('close')))))
        : h('p', { class: 'field-hint' }, 'Names from Apple Pay that you file under this merchant are added here.'),
      h('div', { class: 'add-row' }, input, add));
  }

  async function submit() {
    save.disabled = true;
    const before = { name: vendor.name, categoryId: vendor.categoryId, currency: vendor.currency, methodId: vendor.methodId };
    const result = await runAction(() => repo.saveRow('vendors', vendor.id, { ...f, name: f.name.trim() }));
    if (!result) return renderSave();
    s.close();
    toast('Saved changes', { label: 'Undo', run: () => runAction(() => repo.saveRow('vendors', vendor.id, before)) });
  }

  async function remove() {
    if (!(await runAction(() => repo.deleteRow('vendors', vendor.id)))) return;
    s.close();
    toast(`Deleted ${vendor.name}`, { label: 'Undo', run: () => runAction(() => repo.restoreRow('vendors', vendor.id)) });
  }

  const s = sheet(vendor.name, h('div', { class: 'sheet-form' },
    h('p', { class: 'reason' }, own.length
      ? `${own.length === 1 ? '1 payment' : `${own.length} payments`}, the last on ${formatDay(last)}. Changes apply to payments from now on.`
      : 'No payments yet. Changes apply to payments from now on.'),
    field('Name', name),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Category'),
      chips({ label: 'Category', options: withRemoved(categories, f.categoryId, S.categories), value: f.categoryId, onChange: (v) => { f.categoryId = v; } })),
    field('Usual currency', currency),
    methods.length > 0 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Usually paid with'),
      chips({ label: 'Usually paid with', options: withRemoved(methods, f.methodId, S.methods), value: f.methodId, onChange: (v) => { f.methodId = v; } })),
    aliasList,
    h('div', { class: 'sheet-actions' },
      save,
      h('button', { type: 'button', class: 'button danger', onclick: remove }, 'Delete merchant'))));
  renderAliases();
  renderSave();
}
