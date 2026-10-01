// IBKR (from Accounts): its value now, today's move, cost and gain; the holdings with a Value /
// Today / Gain switch; each holding's share of the whole; recent activity. Amounts are in the
// account's own currency, as IBKR shows them, with the total in pounds. Gains and losses carry
// + / − and stay neutral in colour.

import { h, fill, segmented } from './dom.js';
import { shareTable } from './charts.js';
import { rowsOf, ibkrAccount, ibkrNotices, connectFirst, openAccountSheet, updatedLine, syncIbkr } from './accounts.js';
import {
  today, gbp, formatMoney, formatDay, signedMoney, signedPct, holdingRows, recentActivity, activityTitle, activityCash, fromMicro, holdingName,
} from '../engine/index.js';

// Kept between visits, like Overview's period.
let show = 'value';
const SHOW = [{ value: 'value', label: 'Value' }, { value: 'today', label: 'Today' }, { value: 'gain', label: 'Gain' }];

export function renderIbkr(root, { repo }) {
  const S = repo.state;

  function holdingAmount(r, base) {
    if (show === 'value') return { amount: formatMoney(r.valueMinor, base) };
    if (show === 'today') return r.todayMinor === null ? { amount: 'No price yet', muted: true } : { amount: signedMoney(r.todayMinor, base) };
    return r.gainMinor === null ? { amount: 'No cost', muted: true } : { amount: signedMoney(r.gainMinor, base), sub: signedPct(r.gainShare) };
  }

  function holdingsList(rows, base, cashMinor) {
    // Cash has no price or cost, so it shows with the values only.
    const cash = show === 'value' && cashMinor !== 0 && h('li', {}, h('div', { class: 'list-row static' },
      h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, 'Cash'), h('span', { class: 'list-sub' }, 'Not invested')),
      h('span', { class: 'list-end' }, h('span', { class: 'list-amount' }, formatMoney(cashMinor, base)))));
    return h('ul', { class: 'list' }, rows.map((r) => {
      const a = holdingAmount(r, base);
      const units = fromMicro(r.holding.unitsMicro);
      const name = holdingName(r.holding.name);
      return h('li', {}, h('div', { class: 'list-row static' },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, r.holding.symbol),
          h('span', { class: 'list-sub' }, `${name && name !== r.holding.symbol ? `${name}, ` : ''}${units} ${units === '1' ? 'unit' : 'units'}`)),
        h('span', { class: 'list-end' },
          h('span', { class: `list-amount${a.muted ? ' muted' : ''}` }, a.amount),
          a.sub && h('span', { class: 'list-sub' }, a.sub))));
    }), cash);
  }

  function render() {
    if (!repo.connected()) return fill(root, connectFirst());
    const account = ibkrAccount(S);
    const r = account && rowsOf(S).find((x) => x.account.id === account.id);
    if (!r?.live) {
      return fill(root, h('div', { class: 'screen' },
        h('section', { class: 'empty' },
          h('h2', {}, 'IBKR Hasn’t Synced Yet'),
          h('p', {}, 'Once the Worker has your Flex Query, IBKR syncs each night.')),
        ibkrNotices(repo, render)));
    }
    const { live } = r;
    const base = r.balance.currency;
    const detail = holdingRows(live);
    const activity = recentActivity(S.activity, account.id);
    const tilde = live.pricedAt || base !== 'GBP' ? '~' : '';
    const row = (label, value, sub) => h('li', { class: 'total-row' },
      h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, label), sub && h('span', { class: 'list-sub' }, sub)),
      h('span', { class: 'list-amount' }, value));

    fill(root, h('div', { class: 'screen' },
      h('section', { class: 'headline', 'aria-label': 'IBKR' },
        h('div', { class: 'headline-figure' },
          h('span', { class: 'num' }, r.pence === null ? formatMoney(live.amountMinor, base) : `${tilde}${gbp(r.pence)}`),
          r.pence !== null && base !== 'GBP' && h('span', { class: 'unit' }, `${live.pricedAt ? '~' : ''}${formatMoney(live.amountMinor, base)}`)),
        h('p', { class: 'reason' }, `${updatedLine(r, today())}.${live.pricedAt ? ' Moved on from the close with the latest prices.' : ''}`)),
      ibkrNotices(repo, render),
      h('ul', { class: 'list totals' },
        live.todayMinor !== null && row('Today', signedMoney(live.todayMinor, base)),
        live.costMinor !== null && row('Cost', formatMoney(live.costMinor, base)),
        live.gainMinor !== null && row('Gain', signedMoney(live.gainMinor, base), detail.gainShare !== null ? signedPct(detail.gainShare) : null)),
      h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'Holdings'),
        detail.holdings.length
          ? [segmented({ label: 'Show each holding’s', options: SHOW, value: show, onChange: (v) => { show = v; render(); } }),
            holdingsList(detail.holdings, base, detail.cashMinor)]
          : h('p', { class: 'empty-line' }, 'No holdings at the last close.')),
      detail.holdings.length > 1 && h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'Mix'),
        // The values are in Holdings just above; this is how they split.
        shareTable(detail.holdings.map((x) => ({ name: x.holding.symbol, share: x.share })),
          { caption: 'Each holding’s share of IBKR', head: ['Holding', 'Share'], amounts: false })),
      h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'Recent Activity'),
        activity.length
          ? h('ul', { class: 'list' }, activity.map((a) => h('li', {}, h('div', { class: 'list-row static' },
            h('span', { class: 'list-main' },
              h('span', { class: 'list-title' }, activityTitle(a)),
              h('span', { class: 'list-sub' }, formatDay(a.date))),
            h('span', { class: 'list-amount' }, signedMoney(activityCash(a), a.currency))))))
          : h('p', { class: 'empty-line' }, 'No activity yet.')),
      h('div', { class: 'link-row' },
        h('button', { type: 'button', class: 'text-button', onclick: (e) => syncIbkr(repo, e.currentTarget) }, 'Sync IBKR now'),
        h('button', { type: 'button', class: 'text-button', onclick: () => openAccountSheet(repo, account) }, 'Change account details'))));
  }

  render();
  if (repo.connected()) repo.refreshPrices().catch(() => {});
  return { refresh: render };
}
