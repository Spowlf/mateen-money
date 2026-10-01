// Setting the monthly budget, from Settings or Overview. A change applies from this month on;
// earlier months keep the budget they had (see src/engine/budgets.js).

import { h, field, sheet, toast } from './dom.js';
import { runAction } from './format.js';
import { today, monthKey, gbp, toDecimalText, budgetFor, budgetChange, budgetId, budgetPence } from '../engine/index.js';

export function openBudgetSheet(repo) {
  const S = repo.state;
  const month = monthKey(today());
  const current = budgetFor(S.budgets, month);
  const f = { amount: current ? toDecimalText(current).replace(/\.00$/, '') : '' };

  const amount = h('input', {
    class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '500', value: f.amount,
    oninput: () => { amount.value = amount.value.replace(/[^\d.,£]/g, ''); f.amount = amount.value; renderSave(); },
  });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit(budgetPence(f.amount)) });
  const remove = h('button', { type: 'button', class: 'button danger', onclick: () => submit(0) }, 'Remove the budget');

  function renderSave() {
    const pence = budgetPence(f.amount);
    save.disabled = !pence;
    save.textContent = pence ? `${current ? 'Save' : 'Set'} ${gbp(pence, { whole: true })} a month` : 'Enter an amount';
    remove.hidden = !current;
  }

  async function submit(pence) {
    const change = budgetChange(S.budgets, month, pence);
    if (!change) return s.close();
    // Undo puts this month's row back as it was: changed, or never there.
    const before = S.budgets.find((b) => b.id === budgetId(month) && !b.deletedAt);
    save.disabled = true;
    if (!(await runAction(() => repo.saveRow('budgets', change.id, change)))) return renderSave();
    s.close();
    toast(pence ? 'Saved Monthly Budget' : 'Removed Monthly Budget', {
      label: 'Undo',
      run: () => runAction(() => (before ? repo.saveRow('budgets', before.id, { amountPence: before.amountPence }) : repo.deleteRow('budgets', change.id))),
    });
  }

  const s = sheet('Monthly Budget', h('div', { class: 'sheet-form' },
    field('£ a month', amount, 'Recurring costs and trips count too.'),
    h('div', { class: 'sheet-actions' }, save, remove)));
  renderSave();
  amount.focus();
}
