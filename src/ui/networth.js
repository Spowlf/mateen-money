// Net Worth: what you own, in GBP. The total with today's change and the change since the 1st;
// the total over time; By Type; This Month's change split into markets, currencies and balances.
// Accounts (and IBKR from there) are one tap away. Beside spending, never inside it: nothing here
// changes the headline, budget, forecast or Overview. Gains and losses carry + / − and stay
// neutral in colour, and the chart is accent blue (the user's choice).

import { h, fill, segmented, icon } from './dom.js';
import { worthChart, shareTable } from './charts.js';
import { worth, plural, ibkrNotices, connectFirst, openAccountSheet } from './accounts.js';
import {
  today, gbp, formatDayShort, addDays, staleLine, signedMoney, dayChange, monthChange, worthSeries, WORTH_RANGES,
} from '../engine/index.js';

// Kept between visits to the tab, like Overview's period.
let range = '6m';

export function renderNetWorth(root, { repo }) {
  const S = repo.state;

  /** The parts of the change line: ["+£120.00 today", "−£40.00 since 1 Oct"] (a day missed: "since 28 Sep"). */
  function changeLine(day, month, todayDate) {
    const parts = [];
    if (day) parts.push(`${signedMoney(day.pence)} ${day.from === addDays(todayDate, -1) ? 'today' : `since ${formatDayShort(day.from)}`}`);
    // On the 1st, since the 1st is today's change.
    if (month && month.from !== todayDate && month.from !== day?.from) parts.push(`${signedMoney(month.pence)} since ${formatDayShort(month.from)}`);
    return parts;
  }

  function thisMonth(month, foreign) {
    // Title case, like By Type's rows just above (the user's choice), and no subtitles.
    const row = (label, pence) => h('li', { class: 'total-row' },
      h('span', { class: 'list-title' }, label),
      h('span', { class: 'list-amount' }, signedMoney(pence)));
    return h('section', { class: 'section' },
      h('h2', { class: 'subhead' }, 'This Month'),
      h('ul', { class: 'list totals' },
        month.investments && row('Market Moves', month.marketPence),
        foreign && row('Currency Moves', month.currencyPence),
        row('Money In and Out', month.balancesPence)));
  }

  function overTime(totalPence, todayDate) {
    const { points } = worthSeries({ snapshots: S.snapshots, totalPence, todayDate, range });
    // Drawn at the size it will show (inside the card's padding), so its text stays true size.
    const width = Math.max((root.clientWidth || 358) - 32, 260);
    const label = WORTH_RANGES.find((r) => r.id === range).label;
    return h('section', { class: 'section' },
      h('h2', { class: 'subhead' }, 'Over Time'),
      segmented({ label: 'Show the last', options: WORTH_RANGES.map((r) => ({ value: r.id, label: r.label })), value: range, onChange: (v) => { range = v; render(); } }),
      points.length > 1
        ? worthChart(points, { width, name: range === 'all' ? 'all of it' : `the last ${label.toLowerCase()}` })
        : h('p', { class: 'empty-line' }, 'Net worth is saved once a day, so the chart starts tomorrow.'));
  }

  function render() {
    if (!repo.connected()) return fill(root, connectFirst());
    const todayDate = today();
    const nw = worth(S);
    if (!nw.groups.length) {
      // IBKR set up but not synced yet: a sync adds its account, so it's offered first.
      return fill(root, h('div', { class: 'screen' },
        ibkrNotices(repo, render),
        h('section', { class: 'empty' },
          h('h2', {}, 'No Accounts Yet'),
          h('p', {}, 'Add each account and what’s in it to see your net worth. Your spending figures stay as they are.'),
          h('button', { type: 'button', class: 'button primary', onclick: () => openAccountSheet(repo) }, 'Add an Account'))));
    }
    const day = dayChange({ snapshots: S.snapshots, totalPence: nw.totalPence, todayDate });
    const month = monthChange({
      accounts: S.accounts, balances: S.balances, rates: S.rates, methods: S.methods, entries: S.entries,
      holdings: S.holdings, prices: S.prices, activity: S.activity, settlements: S.settlements ?? [], transfers: S.transfers ?? [], todayDate,
    });
    const changes = changeLine(day, month, todayDate);
    // Only what's missing from the total (the rates, carried balances and share prices aren't
    // explained here, by the user's choice).
    const notes = [
      nw.noRate.length && `Leaves out ${nw.noRate.map((r) => r.account.name).join(', ')} until ${nw.noRate.length === 1 ? 'its exchange rate arrives' : 'their exchange rates arrive'}.`,
      nw.noBalance.length && `Leaves out ${nw.noBalance.map((r) => r.account.name).join(', ')}: add ${nw.noBalance.length === 1 ? 'its balance' : 'their balances'}.`,
    ].filter(Boolean);
    const stale = staleLine(nw.stale);
    const count = nw.groups.reduce((n, g) => n + g.accounts.length, 0);

    fill(root, h('div', { class: 'screen' },
      h('section', { class: 'headline', 'aria-label': 'Net worth' },
        h('div', { class: 'headline-figure' },
          h('span', { class: 'num' }, `${nw.estimated ? '~' : ''}${gbp(nw.totalPence)}`),
          h('span', { class: 'unit' }, 'in total')),
        // Each part stays whole, so a line too long for the card breaks after the comma.
        changes.length > 0 && h('p', { class: 'headline-change' }, changes.map((c, i) => [i ? ', ' : '', h('span', {}, c)])),
        notes.map((n) => h('p', { class: 'reason' }, n))),
      ibkrNotices(repo, render),
      // Accounts: where balances are updated, so a balance gone stale is flagged on the way in.
      h('ul', { class: 'list' }, h('li', {}, h('a', { class: 'list-row', href: '#accounts' },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, 'Accounts'),
          h('span', { class: `list-sub${stale ? ' stale' : ''}` }, stale ?? plural(count, 'account'))),
        h('span', { class: 'row-end-icon' }, icon('forward'))))),
      overTime(nw.totalPence, todayDate),
      h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, 'By Type'),
        shareTable(nw.groups.map((g) => ({ name: g.name, pence: g.pence, share: g.share })),
          { caption: 'Net worth by type of account', head: ['Type', 'Value', 'Share'] })),
      // Only foreign balances move with exchange rates.
      month && thisMonth(month, nw.rateDate !== null)));
  }

  render();
  // Opening Net Worth asks for the latest prices; offline, the last ones stay.
  if (repo.connected()) repo.refreshPrices().catch(() => {});
  return { refresh: render };
}
