// "£X left this month": the raised panel at the top of Log.
// It always counts everything, trips included; the Overview toggle doesn't touch it.

import { h, fill } from './dom.js';
import { today, monthKey, monthHeadline, headlineReason, gbp } from '../engine/index.js';

export function renderHeadline(el, repo) {
  const S = repo.state;
  if (!repo.connected()) {
    fill(el, h('div', { class: 'headline headline-quiet' },
      h('p', { class: 'headline-figure' }, h('span', { class: 'unit' }, 'Connect to your backend')),
      h('p', { class: 'reason' }, 'Your spending is stored on your own backend. Add its address and token in Settings to start saving.'),
      h('button', { type: 'button', class: 'button secondary', onclick: () => document.getElementById('settings').click() }, 'Open Settings')));
    return;
  }
  const todayDate = today();
  const hl = monthHeadline({ entries: S.entries, recurring: S.recurring, rates: S.rates, month: monthKey(todayDate), todayDate });
  const figure = `${hl.estimated ? '~' : ''}${gbp(hl.left)}`;
  const reasons = [headlineReason(hl)];
  if (hl.estimated) reasons.push('Foreign amounts are estimated until their rate is final.');
  fill(el, h('div', { class: `headline${hl.negative ? ' negative' : ''}` },
    h('p', { class: 'headline-figure', 'aria-label': `${figure} left this month` },
      h('span', { class: 'num' }, figure), h('span', { class: 'unit' }, 'left this month')),
    h('p', { class: 'reason' }, reasons.join(' ')),
    hl.unpriced > 0 && h('p', { class: 'warning' },
      hl.unpriced === 1 ? '1 payment is waiting for its exchange rate, so it isn’t counted yet.' : `${hl.unpriced} payments are waiting for their exchange rate, so they aren’t counted yet.`),
    hl.unpricedIncome > 0 && h('p', { class: 'warning' }, 'Some income is waiting for its exchange rate, so it isn’t counted yet.')));
}
