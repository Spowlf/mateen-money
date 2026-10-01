// Net Worth: what's in each account, and the total in GBP. Beside spending, never inside it:
// nothing here changes the headline, budget, forecast or Overview.

import { h, fill, chips, field, sheet, toast } from './dom.js';
import { runAction } from './format.js';
import {
  today, gbp, formatMoney, formatDay, toDecimalText, netWorth, latestBalance, balanceRows, balanceMinor, undoRows,
  updatedPhrase, staleLine, ACCOUNT_KINDS, COMMON_CURRENCIES,
} from '../engine/index.js';

const ACCOUNT_FIELDS = ['name', 'kind', 'currency', 'sort'];

// Drawn like the category icons: neutral, so the amount keeps the attention.
const KIND_ICONS = {
  investment: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  savings: '<path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>',
  current: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
};

function kindIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cat-icon');
  svg.innerHTML = KIND_ICONS[kind] ?? KIND_ICONS.current;
  return svg;
}

// Each balance carried on with the card payments logged since it was typed.
const worth = (S) => netWorth({ accounts: S.accounts, balances: S.balances, rates: S.rates, methods: S.methods, entries: S.entries, todayDate: today() });
const rowsOf = (S) => worth(S).groups.flatMap((g) => g.accounts);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Updated 27 Aug 2026, 14 payments since" */
const updatedLine = (r, todayDate) => [updatedPhrase(r.balance.date, todayDate), r.payments && `${plural(r.payments, 'payment')} since`].filter(Boolean).join(', ');

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

  // A balance has to be typed again when the currency changes, so it's never read in the wrong one.
  const balanceNeeded = () => !account || (latest && latest.currency !== f.currency);
  const typedMinor = () => (f.balance.trim() ? balanceMinor(f.balance, f.currency) : null);

  function missing() {
    if (!f.name.trim()) return 'Name the account';
    if (f.balance.trim() && typedMinor() === null) return 'Enter the balance as a number';
    if (balanceNeeded() && typedMinor() === null) return `Enter the balance in ${f.currency}`;
    if (!f.date) return 'Pick the date of the balance';
    return null;
  }

  function renderSave() {
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
    const hint = !latest ? 'Below zero for an overdraft: -25.00.'
      : carried?.payments ? `${updatedLine(carried, today())}: ~${formatMoney(carried.amountMinor, latest.currency)} now. Type today’s balance to correct it.`
        : `${updatedPhrase(latest.date, today())}. Leave it as it is to keep it.`;
    // Cards are toggles, not one choice: an account can have several.
    const cards = h('div', { class: 'chips', role: 'group', 'aria-label': 'Cards that pay from it' }, methods.map((m) => {
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
        chips({ label: 'Kind', options: ACCOUNT_KINDS.map((k) => ({ value: k.id, label: k.one })), value: f.kind, onChange: (v) => set({ kind: v }) })),
      field('Currency', currency),
      h('div', { class: 'row-2' },
        field(`Balance in ${f.currency}`, balance),
        field('On', date)),
      h('p', { class: 'field-hint' }, account && latest && latest.currency !== f.currency ? `The last balance was in ${latest.currency}.` : hint),
      methods.length > 0 && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Cards that pay from it'), cards,
        h('span', { class: 'field-hint' }, 'Payments with these come off the balance until you next update it.')),
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
    const typed = typedMinor();
    // Leaving the balance as it was keeps it (and its date): nothing new was checked.
    const unchanged = account && latest && typed === latest.amountMinor && latest.currency === f.currency;
    const balances = typed === null || unchanged ? [] : balanceRows({ accounts: [row], balances: S.balances, typed: { [id]: typed }, date: f.date });
    const before = account && Object.fromEntries(ACCOUNT_FIELDS.map((k) => [k, account[k] ?? null]));
    const beforeBalances = S.balances.filter((b) => balances.some((r) => r.id === b.id)).map((b) => ({ ...b }));
    // A card moves here from any other account; one taken off is linked to none.
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

export function renderNetWorth(root, { repo }) {
  const S = repo.state;

  function accountRow(r, todayDate) {
    const { account, balance } = r;
    const foreign = balance && balance.currency !== 'GBP';
    const own = balance && `${r.payments ? '~' : ''}${formatMoney(r.amountMinor, balance.currency)}`;
    const tilde = foreign || r.payments ? '~' : '';
    const sub = balance ? updatedLine(r, todayDate) : 'No balance yet';
    return h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => openAccountSheet(repo, account) },
      h('span', { class: 'row-icon' }, kindIcon(account.kind)),
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, account.name),
        h('span', { class: `list-sub${r.stale ? ' stale' : ''}` }, sub)),
      balance && h('span', { class: 'list-end' },
        h('span', { class: 'list-amount' }, r.pence === null ? own : `${tilde}${gbp(r.pence)}`),
        foreign && r.pence !== null && h('span', { class: 'list-sub' }, own))));
  }

  function render() {
    if (!repo.connected()) {
      return fill(root, h('section', { class: 'empty' },
        h('h2', {}, 'Connect to Your Backend First'),
        h('p', {}, 'Add your backend in Settings.'),
        h('button', { type: 'button', class: 'button primary', onclick: () => { location.hash = '#settings'; } }, 'Open Settings')));
    }
    const todayDate = today();
    const nw = worth(S);
    if (!nw.groups.length) {
      return fill(root, h('section', { class: 'empty' },
        h('h2', {}, 'No Accounts Yet'),
        h('p', {}, 'Add each account and what’s in it to see your net worth. Your spending figures stay as they are.'),
        h('button', { type: 'button', class: 'button primary', onclick: () => openAccountSheet(repo) }, 'Add an account')));
    }

    const notes = [
      nw.rateDate && `Converted to pounds at the rates for ${formatDay(nw.rateDate)}.`,
      nw.carried.length && 'Card payments logged since a balance was typed are taken off it.',
      nw.noRate.length && `Leaves out ${nw.noRate.map((r) => r.account.name).join(', ')} until ${nw.noRate.length === 1 ? 'its exchange rate arrives' : 'their exchange rates arrive'}.`,
      nw.noBalance.length && `Leaves out ${nw.noBalance.map((r) => r.account.name).join(', ')}: add ${nw.noBalance.length === 1 ? 'its balance' : 'their balances'}.`,
    ].filter(Boolean);
    const stale = staleLine(nw.stale);

    fill(root, h('div', { class: 'screen' },
      h('section', { class: 'headline', 'aria-label': 'Net worth' },
        h('div', { class: 'headline-figure' },
          h('span', { class: 'num' }, `${nw.estimated ? '~' : ''}${gbp(nw.totalPence)}`),
          h('span', { class: 'unit' }, 'in total')),
        notes.map((n) => h('p', { class: 'reason' }, n))),
      stale && h('div', { class: 'warning stale-warning' },
        h('p', {}, stale),
        h('button', { type: 'button', class: 'text-button', onclick: () => openBalancesSheet(repo) }, 'Update balances')),
      !stale && h('div', {}, h('button', { type: 'button', class: 'button secondary', onclick: () => openBalancesSheet(repo) }, 'Update balances')),
      nw.groups.map((g) => h('section', { class: 'section' },
        h('h2', { class: 'subhead' }, h('span', {}, g.name), h('span', { class: 'subhead-amount num' }, `${g.accounts.some((r) => r.forDate || r.payments) ? '~' : ''}${gbp(g.pence)}`)),
        h('ul', { class: 'list' }, g.accounts.map((r) => accountRow(r, todayDate))))),
      h('div', {}, h('button', { type: 'button', class: 'text-button', onclick: () => openAccountSheet(repo) }, 'Add an account'))));
  }

  render();
  return { refresh: render };
}
