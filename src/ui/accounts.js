// Accounts (from Net Worth): each account by kind with its balance, and the sheets that add an
// account or update balances. Beside spending, never inside it: nothing here changes the headline,
// budget, forecast or Overview.

import { h, fill, chips, field, sheet, toast } from './dom.js';
import { runAction } from './format.js';
import {
  today, nowTime, gbp, formatMoney, formatDay, toDecimalText, netWorth, latestBalance, balanceRows, balanceMinor, undoRows,
  updatedPhrase, staleLine, isIbkrName, ACCOUNT_KINDS, COMMON_CURRENCIES,
} from '../engine/index.js';

const ACCOUNT_FIELDS = ['name', 'kind', 'currency', 'sort'];

// Drawn like the category icons: neutral, so the amount keeps the attention.
const KIND_ICONS = {
  investment: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  savings: '<path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>',
  current: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
};

export function kindIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cat-icon');
  svg.innerHTML = KIND_ICONS[kind] ?? KIND_ICONS.current;
  return svg;
}

// Each balance carried on with the card payments logged since it was typed.
// IBKR moves with the latest prices instead.
export const worth = (S) => netWorth({
  accounts: S.accounts, balances: S.balances, rates: S.rates, methods: S.methods, entries: S.entries,
  holdings: S.holdings, prices: S.prices, settlements: S.settlements ?? [], todayDate: today(),
});
export const rowsOf = (S) => worth(S).groups.flatMap((g) => g.accounts);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Prices at 14:32" / "Prices at 14:32 on 2 Oct 2026" */
export function pricesAt(ms, todayDate) {
  const d = new Date(ms);
  const day = today(d);
  return `Prices at ${nowTime(d)}${day === todayDate ? '' : ` on ${formatDay(day)}`}`;
}

/**
 * "Updated 27 Aug 2026, 14 payments since", "…, 1 payment in since", "…, 2 payments out, 1 in since",
 * "…, 1 settle-up since";
 * IBKR: "Prices at 14:32" or "Close on 1 Oct 2026".
 */
export function updatedLine(r, todayDate) {
  if (r.live) return r.live.pricedAt ? pricesAt(r.live.pricedAt, todayDate) : `Close on ${formatDay(r.balance.date)}`;
  const since = r.payments && r.income ? `${plural(r.payments, 'payment')} out, ${r.income} in`
    : r.income ? `${plural(r.income, 'payment')} in` : r.payments && plural(r.payments, 'payment');
  const moves = [since, r.settled && plural(r.settled, 'settle-up')].filter(Boolean).join(', ');
  return [updatedPhrase(r.balance.date, todayDate), moves && `${moves} since`].filter(Boolean).join(', ');
}

// The balance as an input shows it: "2016.76", "-25.00".
const inputText = (minor, currency) => (minor === null || minor === undefined ? '' : toDecimalText(minor, currency));
const cleanBalance = (input) => { input.value = input.value.replace(/[^\d.,\-−]/g, ''); return input.value; };

/** Adds an account, or edits one (its name, kind, currency and balance). */
export function openAccountSheet(repo, account = null) {
  const S = repo.state;
  const latest = account ? latestBalance(S.balances, account.id) : null;
  const carried = account && rowsOf(S).find((r) => r.account.id === account.id);
  const methods = S.methods.filter((m) => !m.deletedAt).sort((a, b) => (a.name < b.name ? -1 : 1));
  const linkedBefore = new Set(account ? methods.filter((m) => m.accountId === account.id).map((m) => m.id) : []);
  const linked = new Set(linkedBefore);
  const f = {
    name: account?.name ?? '',
    kind: account?.kind ?? 'current',
    currency: account?.currency ?? 'GBP',
    balance: latest && latest.currency === (account?.currency) ? inputText(latest.amountMinor, latest.currency) : '',
    date: today(),
  };
  const body = h('div', { class: 'sheet-form' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  // IBKR set up on the Worker fills in a new account named like it (balance and currency) at its
  // next sync, so there's nothing to type.
  const fromIbkr = () => !account && S.ibkr?.configured && f.kind === 'investment' && isIbkrName(f.name);
  // Only a current account has cards paying from it (and an overdraft).
  const hasCards = () => f.kind === 'current';
  // A balance has to be typed again when the currency changes, so it's never read in the wrong one.
  const balanceNeeded = () => !fromIbkr() && (!account || (latest && latest.currency !== f.currency));
  const typedMinor = () => (f.balance.trim() ? balanceMinor(f.balance, f.currency) : null);

  function missing() {
    if (!f.name.trim()) return 'Name the account';
    if (f.balance.trim() && typedMinor() === null) return 'Enter the balance as a number';
    if (balanceNeeded() && typedMinor() === null) return `Enter the balance in ${f.currency}`;
    if (!f.date) return 'Pick the date of the balance';
    return null;
  }

  // Shown or hidden as the name and kind change, without redrawing the field being typed in.
  const parts = { typed: [], ibkr: null, cards: null };

  function renderSave() {
    for (const el of parts.typed) el.hidden = !!fromIbkr();
    if (parts.ibkr) parts.ibkr.hidden = !fromIbkr();
    if (parts.cards) parts.cards.hidden = !hasCards();
    const need = missing();
    save.disabled = !!need;
    save.textContent = need ?? (account ? 'Save changes' : `Add ${f.name.trim()}`);
  }

  const set = (changes, rerender = false) => { Object.assign(f, changes); if (rerender) render(); else renderSave(); };

  function render() {
    const name = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'words', value: f.name,
      placeholder: 'DBS', oninput: () => set({ name: name.value }) });
    const currency = h('select', { class: 'select', onchange: () => set({ currency: currency.value }, true) },
      [...new Set([f.currency, ...COMMON_CURRENCIES])].map((c) => h('option', { value: c, selected: c === f.currency }, c)));
    const balance = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.balance,
      placeholder: '0.00', oninput: () => set({ balance: cleanBalance(balance) }) });
    const date = h('input', { class: 'input', type: 'date', value: f.date, max: today(), required: true, onchange: () => set({ date: date.value }) });
    const hint = account && latest && latest.currency !== f.currency ? `The last balance was in ${latest.currency}.`
      : !latest ? (f.kind === 'current' ? 'Below zero for an overdraft: -25.00.' : null)
      : carried?.payments || carried?.income || carried?.settled ? `${updatedLine(carried, today())}: ~${formatMoney(carried.amountMinor, latest.currency)} now. Type today’s balance to correct it.`
        : `${updatedPhrase(latest.date, today())}.`;
    // Cards are toggles, not one choice: an account can have several.
    const cards = h('div', { class: 'chips', role: 'group', 'aria-label': 'Payment methods' }, methods.map((m) => {
      const chip = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(linked.has(m.id)), onclick: () => {
        if (linked.has(m.id)) linked.delete(m.id); else linked.add(m.id);
        chip.setAttribute('aria-pressed', String(linked.has(m.id)));
        renderSave();
      } }, m.name);
      return chip;
    }));
    body.replaceChildren(...[
      field('Name', name),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'),
        chips({ label: 'Kind', options: ACCOUNT_KINDS.map((k) => ({ value: k.id, label: k.one })), value: f.kind, onChange: (v) => set({ kind: v }, true) })),
      ...(parts.typed = [
        field('Currency', currency),
        h('div', { class: 'row-2' },
          field(`Balance in ${f.currency}`, balance),
          field('On', date)),
        hint && h('p', { class: 'field-hint' }, hint),
      ].filter(Boolean)),
      parts.ibkr = h('p', { class: 'field-hint' }, 'IBKR fills in its balance and currency when it next syncs.'),
      parts.cards = methods.length > 0 ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Payment methods'), cards) : null,
      h('div', { class: 'sheet-actions' },
        save,
        account && h('button', { type: 'button', class: 'button danger', onclick: () => remove() }, 'Delete account')),
    ].filter(Boolean));
    renderSave();
  }

  async function submit() {
    if (missing()) return;
    save.disabled = true;
    const id = account?.id ?? crypto.randomUUID();
    const sort = account?.sort ?? Math.max(-1, ...S.accounts.filter((a) => !a.deletedAt).map((a) => a.sort ?? 0)) + 1;
    const row = { id, name: f.name.trim(), kind: f.kind, currency: f.currency, sort, deletedAt: null };
    const typed = fromIbkr() ? null : typedMinor();
    // Leaving the balance as it was keeps it (and its date): nothing new was checked.
    const unchanged = account && latest && typed === latest.amountMinor && latest.currency === f.currency;
    const balances = typed === null || unchanged ? [] : balanceRows({ accounts: [row], balances: S.balances, typed: { [id]: typed }, date: f.date });
    const before = account && Object.fromEntries(ACCOUNT_FIELDS.map((k) => [k, account[k] ?? null]));
    const beforeBalances = S.balances.filter((b) => balances.some((r) => r.id === b.id)).map((b) => ({ ...b }));
    // A card moves here from any other account; one taken off is linked to none.
    // Only a current account keeps its cards: changed to another kind, they come off it.
    if (!hasCards()) linked.clear();
    const methodRows = methods.filter((m) => linked.has(m.id) !== linkedBefore.has(m.id))
      .map((m) => ({ id: m.id, accountId: linked.has(m.id) ? id : null }));
    const methodsBefore = methodRows.map((m) => ({ id: m.id, accountId: S.methods.find((x) => x.id === m.id)?.accountId ?? null }));
    const result = await runAction(() => repo.saveBatch({ accounts: [row], balances, methods: methodRows }));
    if (!result) return renderSave();
    s.close();
    if (account) {
      toast('Saved changes', {
        label: 'Undo',
        run: () => runAction(() => repo.saveBatch({ accounts: [{ id, ...before }], balances: undoRows(balances, beforeBalances, Date.now()), methods: methodsBefore })),
      });
    } else {
      toast(`Added ${row.name}`, { label: 'Undo', run: () => runAction(async () => {
        if (methodsBefore.length) await repo.saveBatch({ methods: methodsBefore });
        return repo.deleteRow('accounts', id);
      }) });
    }
  }

  async function remove() {
    if (!(await runAction(() => repo.deleteRow('accounts', account.id)))) return;
    s.close();
    toast(`Deleted ${account.name}`, { label: 'Undo', run: () => runAction(() => repo.restoreRow('accounts', account.id)) });
  }

  const s = sheet(account ? account.name : 'Add an Account', body);
  render();
}

/** Every account's balance on one day, at once. Only the ones typed are saved. */
export function openBalancesSheet(repo) {
  const S = repo.state;
  const carried = rowsOf(S);
  const accounts = carried.map((r) => r.account);
  const typed = {};
  const f = { date: today() };
  const body = h('div', { class: 'sheet-form' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });

  const rows = () => balanceRows({ accounts, balances: S.balances, typed, date: f.date });
  const invalid = new Set();

  function renderSave() {
    const n = rows().length;
    save.disabled = !n || invalid.size > 0 || !f.date;
    save.textContent = invalid.size ? 'Enter each balance as a number'
      : !f.date ? 'Pick the date'
        : !n ? 'Enter a balance'
          : `Save ${n} ${n === 1 ? 'balance' : 'balances'}`;
  }

  const date = h('input', { class: 'input', type: 'date', value: f.date, max: today(), required: true, onchange: () => { f.date = date.value; renderSave(); } });
  const fields = carried.map((r) => {
    const { account, balance: latest } = r;
    const input = h('input', {
      class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off',
      // What the app thinks it is now, to check against the bank.
      placeholder: latest && latest.currency === account.currency ? inputText(r.amountMinor, latest.currency) : '0.00',
      oninput: () => {
        const text = cleanBalance(input).trim();
        const minor = text ? balanceMinor(text, account.currency) : null;
        if (text && minor === null) invalid.add(account.id); else invalid.delete(account.id);
        if (minor === null) delete typed[account.id]; else typed[account.id] = minor;
        renderSave();
      },
    });
    // The box shows the balance as the app has it now; the hint says how it got there.
    const hint = latest ? `${updatedLine(r, today())}.` : 'No balance yet.';
    return field(`${account.name} in ${account.currency}`, input, hint);
  });

  async function submit() {
    const written = rows();
    if (!written.length) return;
    save.disabled = true;
    const before = S.balances.filter((b) => written.some((r) => r.id === b.id)).map((b) => ({ ...b }));
    if (!(await runAction(() => repo.saveBatch({ balances: written })))) return renderSave();
    s.close();
    toast(`Updated ${written.length} ${written.length === 1 ? 'balance' : 'balances'}`, {
      label: 'Undo',
      run: () => runAction(() => repo.saveBatch({ balances: undoRows(written, before, Date.now()) })),
    });
  }

  fill(body, field('Balances on', date), fields, h('p', { class: 'field-hint' }, 'Leave one blank to keep its balance as it is.'),
    h('div', { class: 'sheet-actions' }, save));
  const s = sheet('Update Balances', body);
  renderSave();
}

/**
 * The "Into" picker for income: the bank accounts it can go into (not investments, which IBKR
 * keeps itself), plus the one it's in already. Null when there's no account to offer.
 */
export function intoField(S, value, onChange) {
  const accounts = S.accounts.filter((a) => (!a.deletedAt && a.kind !== 'investment') || a.id === value)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (!accounts.length) return null;
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Into'),
    chips({ label: 'Into', options: [{ value: null, label: 'No account' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))], value: value ?? null, onChange }),
    h('span', { class: 'field-hint' }, 'It’s added to that account’s balance in Net Worth.'));
}

/** The IBKR account: the first with holdings, or null. */
export const ibkrAccount = (S) => S.accounts.find((a) => !a.deletedAt && S.holdings.some((x) => !x.deletedAt && x.accountId === a.id)) ?? null;

/** IBKR's sync state as warnings: set up but never synced, or the last sync failed. */
export function ibkrNotices(repo, onDone) {
  const S = repo.state;
  const failed = S.ibkr?.configured && S.ibkr.status && !S.ibkr.status.ok ? S.ibkr.status : null;
  // Set up on the Worker but not synced yet: the first sync is a tap away rather than a night.
  const firstSync = S.ibkr?.configured && !S.ibkr.status;
  const button = () => h('button', { type: 'button', class: 'text-button', onclick: (e) => syncIbkr(repo, e.currentTarget).then(onDone) }, 'Sync IBKR now');
  return [
    firstSync && h('div', { class: 'hint stale-warning' }, h('p', {}, 'IBKR is set up and syncs each night.'), button()),
    failed && h('div', { class: 'warning stale-warning' },
      h('p', {}, `IBKR didn’t sync${failed.reportDate ? `, so it shows the close on ${formatDay(failed.reportDate)}` : ''}. ${failed.message}`),
      button()),
  ].filter(Boolean);
}

export async function syncIbkr(repo, button) {
  button.disabled = true;
  const status = await runAction(() => repo.syncIbkr());
  button.disabled = false;
  if (status) toast(status.ok ? 'Synced IBKR' : `IBKR didn’t sync. ${status.message}`);
}

/** Not connected: Net Worth, Accounts and IBKR all need the backend. */
export const connectFirst = () => h('section', { class: 'empty' },
  h('h2', {}, 'Connect to Your Backend First'),
  h('p', {}, 'Add your backend in Settings.'),
  h('button', { type: 'button', class: 'button primary', onclick: () => { location.hash = '#settings'; } }, 'Open Settings'));

export function renderAccounts(root, { repo }) {
  const S = repo.state;

  function accountRow(r, todayDate) {
    const { account, balance } = r;
    const foreign = balance && balance.currency !== 'GBP';
    const moved = r.payments || r.income || r.settled || r.live?.pricedAt;
    const own = balance && `${moved ? '~' : ''}${formatMoney(r.amountMinor, balance.currency)}`;
    const tilde = foreign || moved ? '~' : '';
    const sub = balance ? updatedLine(r, todayDate) : 'No balance yet';
    // IBKR opens its own screen (holdings, gain, activity); any other account its sheet.
    const open = r.live ? () => { location.hash = '#ibkr'; } : () => openAccountSheet(repo, account);
    return h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: open },
      h('span', { class: 'row-icon' }, kindIcon(account.kind)),
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, account.name),
        h('span', { class: `list-sub${r.stale ? ' stale' : ''}` }, sub)),
      balance && h('span', { class: 'list-end' },
        h('span', { class: 'list-amount' }, r.pence === null ? own : `${tilde}${gbp(r.pence)}`),
        foreign && r.pence !== null && h('span', { class: 'list-sub' }, own))));
  }

  function render() {
    if (!repo.connected()) return fill(root, connectFirst());
    const todayDate = today();
    const nw = worth(S);
    if (!nw.groups.length) {
      return fill(root, h('section', { class: 'empty' },
        h('h2', {}, 'No Accounts Yet'),
        h('p', {}, 'Add each account and what’s in it to see your net worth. Your spending figures stay as they are.'),
        h('button', { type: 'button', class: 'button primary', onclick: () => openAccountSheet(repo) }, 'Add an account')));
    }
    const stale = staleLine(nw.stale);
    fill(root, h('div', { class: 'screen' },
      stale && h('div', { class: 'warning stale-warning' },
        h('p', {}, stale),
        h('button', { type: 'button', class: 'text-button', onclick: () => openBalancesSheet(repo) }, 'Update balances')),
      !stale && h('div', {}, h('button', { type: 'button', class: 'button secondary', onclick: () => openBalancesSheet(repo) }, 'Update balances')),
      nw.groups.map((g) => h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, h('span', {}, g.name), h('span', { class: 'subhead-amount num' }, `${g.accounts.some((r) => r.forDate || r.payments || r.income || r.settled || r.live?.pricedAt) ? '~' : ''}${gbp(g.pence)}`)),
        h('ul', { class: 'list' }, g.accounts.map((r) => accountRow(r, todayDate))))),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openAccountSheet(repo) }, 'Add an account'))));
  }

  render();
  return { refresh: render };
}
