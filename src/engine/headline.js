// "£X left this month".
// left = income this month (the allowance's monthly share included)
//      + recurring income still due this month
//      − spending this month
//      − recurring costs still due this month
// Trips always count here: this is real money.

import { monthStart, monthEnd, daysBetween } from './dates.js';
import { monthShare, defaultSpreadStart } from './allowance.js';
import { upcomingBetween } from './recurring.js';
import { estimateGbp } from './currency.js';
import { isLive } from './totals.js';
import { gbp } from './money.js';

export function monthHeadline({ entries, recurring = [], rates = [], month, todayDate }) {
  const from = monthStart(month);
  const to = monthEnd(month);
  let incomeReceived = 0;
  let spent = 0;
  let estimated = false;
  let unpriced = 0;

  for (const e of entries) {
    if (!isLive(e)) continue;
    if (e.kind === 'income') {
      const share = monthShare(e, month);
      incomeReceived += share;
      if (share && e.gbpStatus === 'estimated') estimated = true;
    } else if (e.date >= from && e.date <= to) {
      if (e.gbpPence == null) { unpriced++; continue; }
      spent += e.gbpPence;
      if (e.gbpStatus === 'estimated') estimated = true;
    }
  }

  let incomeDue = 0;
  let costsDue = 0;
  const dueItems = [];
  for (const item of recurring) {
    for (const date of upcomingBetween(item, from, to)) {
      const gbpPence = estimateGbp(item.amountMinor, item.currency, rates);
      if (item.currency !== 'GBP') estimated = true;
      if (item.kind === 'income') {
        // A spread item counts only this month's share.
        const spreadMonths = item.spreadMonths ?? 1;
        const spreadStart = spreadMonths > 1 ? defaultSpreadStart(date, { incomeType: item.incomeType, spreadMonths }) : null;
        const share = monthShare({ gbpPence, date, spreadMonths, spreadStart }, month);
        incomeDue += share;
        dueItems.push({ item, date, pence: share });
      } else {
        costsDue += gbpPence;
        dueItems.push({ item, date, pence: gbpPence });
      }
    }
  }

  const left = incomeReceived + incomeDue - spent - costsDue;
  const daysLeft = todayDate >= from && todayDate <= to ? daysBetween(todayDate, to) + 1 : 0;
  return {
    month,
    incomeReceived,
    incomeDue,
    spent,
    costsDue,
    left,
    negative: left < 0,
    estimated,
    unpriced,
    dueItems,
    daysLeft,
    // For budgets later: what can go out each day and still end the month at zero.
    safePerDay: left > 0 && daysLeft ? Math.floor(left / daysLeft) : 0,
  };
}

/** The line under the headline figure: how it's made up, or what to log while nothing has come in. */
export function headlineReason(hl) {
  const income = hl.incomeReceived + hl.incomeDue;
  if (!income && !hl.spent && !hl.costsDue) return 'Log your income and spending to see what’s left.';
  if (!income) {
    const out = [hl.spent && `${gbp(hl.spent, { whole: true })} spent`, hl.costsDue && `${gbp(hl.costsDue, { whole: true })} still due`].filter(Boolean).join(' and ');
    return `${out} and nothing coming in this month yet. Log your existing cash, or your allowance, as income to see what’s left.`;
  }
  return `${gbp(income, { whole: true })} coming in, ${gbp(hl.spent, { whole: true })} spent and ${gbp(hl.costsDue, { whole: true })} still due this month.`;
}
