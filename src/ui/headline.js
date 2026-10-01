// The raised panel at the top of Log (a slim connect line until there's a backend): what's left of
// the monthly budget, or "£X left this month" of income when there's no budget.
// It always counts everything, trips included; the Overview toggle only changes the pace warning.
// Under it, safe to spend today: what's left ÷ the days left, today included.

import { h, fill } from './dom.js';
import {
  today, monthKey, monthHeadline, headlineFigure, headlineReason, incomeCheckLine, safeToSpend, safeToSpendLine, gbp,
  budgetStatus, budgetWarningLine,
} from '../engine/index.js';

// The figure last shown. It eases in only when it changes (after a save or a sync), never on every redraw.
let shownFigure = null;

export function renderHeadline(el, repo) {
  const S = repo.state;
  if (!repo.connected()) {
    // One slim line, so the form stays near the top.
    fill(el, h('div', { class: 'connect-banner' },
      h('span', {}, 'Connect to Your Backend'),
      h('button', { type: 'button', class: 'text-button', onclick: () => document.getElementById('settings').click() }, 'Open Settings')));
    return;
  }
  const todayDate = today();
  const month = monthKey(todayDate);
  const hl = monthHeadline({ entries: S.entries, recurring: S.recurring, rates: S.rates, month, todayDate });
  const excludeTrips = repo.setting('excludeTrips', false) === true && new Set(S.trips.filter((t) => !t.deletedAt).map((t) => t.id));
  const budget = budgetStatus({ entries: S.entries, trips: S.trips, budgets: S.budgets, recurring: S.recurring, rates: S.rates, month, todayDate, excludeTrips });
  const fig = headlineFigure(hl, budget);
  // Over budget reads as a positive amount over, never as "−£20.00 left".
  const figure = `${fig.estimated ? '~' : ''}${gbp(budget && fig.negative ? -fig.left : fig.left)}`;
  const unit = budget ? (fig.negative ? 'over budget this month' : 'left in this month’s budget') : 'left this month';
  const safe = safeToSpend(fig);
  const changed = shownFigure !== null && shownFigure !== figure;
  shownFigure = figure;
  const pace = budget?.status === 'heading' && budgetWarningLine(budget);
  const incomeCheck = incomeCheckLine(hl, budget);
  fill(el, h('div', { class: `headline${fig.negative ? ' negative' : ''}` },
    h('p', { class: 'headline-figure', 'aria-label': `${figure} ${unit}` },
      h('span', { class: `num${changed ? ' changed' : ''}` }, figure), h('span', { class: 'unit' }, unit)),
    safe && safe.over === undefined && h('p', { class: 'headline-safe' }, safeToSpendLine(safe, month, { estimated: fig.estimated, basis: fig.basis })),
    !budget && safe?.over !== undefined && h('p', { class: 'headline-safe over' }, safeToSpendLine(safe, month, { estimated: fig.estimated })),
    h('p', { class: 'reason' }, headlineReason(hl, budget)),
    pace && h('p', { class: 'warning' }, pace),
    incomeCheck && h('p', { class: 'warning' }, incomeCheck),
    hl.unpriced > 0 && h('p', { class: 'warning' },
      hl.unpriced === 1 ? '1 payment is waiting for its exchange rate.' : `${hl.unpriced} payments are waiting for their exchange rate.`),
    hl.unpricedIncome > 0 && h('p', { class: 'warning' }, 'Some income is waiting for its exchange rate.')));
}
