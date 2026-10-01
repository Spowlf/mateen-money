// Setting a category's monthly budget, from Settings or Overview. A change applies from this
// month on; earlier months keep the budget they had (see src/engine/budgets.js).

import { h, chips, field, sheet, toast } from './dom.js';
import { liveSorted, runAction } from './format.js';
import { today, monthKey, formatMonth, gbp, toDecimalText, budgetFor, budgetChange, budgetId, budgetPence } from '../engine/index.js';

/** Opens the sheet for a category, or with a category picker when categoryId is null. */
export function openBudgetSheet(repo, categoryId = null) {
  const S = repo.state;
  const month = monthKey(today());
  const monthName = formatMonth(month).split(' ')[0];
  const f = { categoryId, amount: '' };
  const current = () => (f.categoryId ? budgetFor(S.budgets, f.categoryId, month) : 0);
  const categoryName = (id) => S.categories.find((c) => c.id === id)?.name ?? 'Category';
  if (categoryId && current()) f.amount = toDecimalText(current()).replace(/\.00$/, '');

  const amount = h('input', {
    class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '150', value: f.amount,
    oninput: () => { amount.value = amount.value.replace(/[^\d.,£]/g, ''); f.amount = amount.value; renderSave(); },
  });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit(budgetPence(f.amount)) });
  const remove = h('button', { type: 'button', class: 'button danger', onclick: () => submit(0) }, 'Remove the budget');

  function renderSave() {
    const pence = budgetPence(f.amount);
    const need = !f.categoryId ? 'Pick a category' : !pence ? 'Enter an amount' : null;
    save.disabled = !!need;
    save.textContent = need ?? `${current() ? 'Save' : 'Set'} ${gbp(pence, { whole: true })} a month`;
    remove.hidden = !current();
  }

  async function submit(pence) {
    const name = categoryName(f.categoryId);
    const change = budgetChange(S.budgets, f.categoryId, month, pence);
    if (!change) return s.close();
    // Undo puts this month's row back as it was: changed, or never there.
    const before = S.budgets.find((b) => b.id === budgetId(f.categoryId, month) && !b.deletedAt);
    save.disabled = true;
    if (!(await runAction(() => repo.saveRow('budgets', change.id, change)))) return renderSave();
    s.close();
    toast(pence ? `Saved ${name} budget` : `Removed ${name} budget`, {
      label: 'Undo',
      run: () => runAction(() => (before ? repo.saveRow('budgets', before.id, { amountPence: before.amountPence }) : repo.deleteRow('budgets', change.id))),
    });
  }

  const categories = liveSorted(S.categories).filter((c) => !c.archived);
  const s = sheet(categoryId ? `${categoryName(categoryId)} budget` : 'Set a budget', h('div', { class: 'sheet-form' },
    !categoryId && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Category'),
      chips({
        label: 'Category',
        options: categories.map((c) => ({ value: c.id, label: c.name })),
        value: null,
        onChange: (v) => {
          f.categoryId = v;
          if (current()) { f.amount = toDecimalText(current()).replace(/\.00$/, ''); amount.value = f.amount; }
          renderSave();
        },
      })),
    field('Monthly budget, £', amount, `Applies from ${monthName}.`),
    h('div', { class: 'sheet-actions' }, save, remove)));
  renderSave();
  if (categoryId) amount.focus();
}
