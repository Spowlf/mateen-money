// People: who owes whom from split bills, per person and per currency, and settling up.
// The list is History's People view; a person's sheet has their open bills, Settle, and past
// settle-ups with Undo. A settle-up always clears a whole currency line (see src/engine/splits.js).

import { h, fill, chips, field, sheet, toast } from './dom.js';
import { runAction } from './format.js';
import { today, formatDay, formatMoney, owed, owedPhrase, OWED_TO_ME } from '../engine/index.js';

const peopleState = (S) => owed({ people: S.people ?? [], splits: S.splits ?? [], settlements: S.settlements ?? [], entries: S.entries });

/** Where a settle-up's money can go: live current and savings accounts. */
const settleAccounts = (S) => S.accounts.filter((a) => !a.deletedAt && ['current', 'savings'].includes(a.kind))
  .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));

const lineClass = (line) => (line.netMinor > 0 ? 'income' : line.netMinor < 0 ? 'spend' : '');

/** History's People view. */
export function renderPeople(body, repo) {
  const S = repo.state;
  const rows = peopleState(S);
  // Everyone in the list shows, even with nothing yet, so a name added on Log can be found.
  const quiet = (S.people ?? []).filter((p) => !p.deletedAt && !p.archived && !rows.some((r) => r.person.id === p.id))
    .map((person) => ({ person, open: [], settled: [] }));
  const all = [...rows, ...quiet].sort((a, b) => a.person.name.localeCompare(b.person.name));
  if (!all.length) {
    return fill(body, h('section', { class: 'empty' },
      h('h2', {}, 'No People Yet'),
      h('p', { class: 'hint' }, 'Split a bill on Log to add someone.')));
  }
  fill(body, h('ul', { class: 'list' }, all.map(({ person, open }) => h('li', {},
    h('button', { type: 'button', class: 'list-row', onclick: () => openPersonSheet(repo, person.id) },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, person.name),
        !open.length && h('span', { class: 'list-sub' }, rows.some((r) => r.person.id === person.id) ? 'Settled up' : 'No split bills')),
      open.length > 0 && h('span', { class: 'list-end' }, open.map((line) => h('span', { class: `list-amount ${lineClass(line)}` },
        line.netMinor > 0 ? `Owes you ${formatMoney(line.netMinor, line.currency)}`
          : line.netMinor < 0 ? `You owe ${formatMoney(-line.netMinor, line.currency)}` : `Even in ${line.currency}`))))))));
}

/** A person's sheet: open bills per currency with Settle, then past settle-ups. */
export function openPersonSheet(repo, personId) {
  const S = repo.state;
  const person = () => S.people.find((p) => p.id === personId);
  const content = h('div', { class: 'sheet-form' });
  const s = sheet(person()?.name ?? 'Someone', content);
  // Each currency line keeps the account picked for it while the sheet is open.
  const picked = new Map();

  const vendorName = (e) => S.vendors.find((v) => v.id === e.vendorId)?.name ?? e.merchant ?? 'Payment';
  const accountName = (id) => S.accounts.find((a) => a.id === id)?.name;

  function openBills(line) {
    const bills = line.splitIds.map((id) => S.splits.find((x) => x.id === id))
      .map((split) => ({ split, entry: S.entries.find((e) => e.id === split.entryId) }))
      .sort((a, b) => (a.entry.date < b.entry.date ? 1 : -1));
    return h('ul', { class: 'list' }, bills.map(({ split, entry }) => h('li', { class: 'total-row' },
      h('span', { class: 'list-main' },
        h('span', { class: 'list-title' }, vendorName(entry)),
        h('span', { class: 'list-sub' }, `${formatDay(entry.date)}, ${entry.paidBy ? `${person().name} paid ${formatMoney(entry.amountMinor, entry.currency)}` : `you paid ${formatMoney(entry.amountMinor, entry.currency)}`}`)),
      split.direction === OWED_TO_ME
        ? h('span', { class: 'list-amount income' }, `+${formatMoney(split.amountMinor, split.currency)}`)
        : h('span', { class: 'list-amount spend' }, formatMoney(split.amountMinor, split.currency)))));
  }

  // The account last used with this person, else the first one.
  function defaultAccount(accounts) {
    const last = (S.settlements ?? []).filter((t) => !t.deletedAt && t.personId === personId && t.accountId)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return accounts.find((a) => a.id === last?.accountId)?.id ?? accounts[0]?.id ?? null;
  }

  function settleForm(line) {
    const name = person().name;
    const even = line.netMinor === 0;
    const amount = formatMoney(Math.abs(line.netMinor), line.currency);
    const accounts = settleAccounts(S);
    if (!picked.has(line.currency)) picked.set(line.currency, defaultAccount(accounts));
    const date = h('input', { class: 'input', type: 'date', value: today(), max: today(), required: true, onchange: () => renderButton() });
    const button = h('button', { type: 'button', class: 'button primary' });
    function renderButton() {
      const need = !even && !accounts.length ? 'Add an account first' : !even && !picked.get(line.currency) ? 'Pick an account' : !date.value ? 'Pick a date' : null;
      button.disabled = !!need;
      button.textContent = need ?? (even ? 'Close these bills' : `Settle ${amount}`);
    }
    button.addEventListener('click', () => settleUp({ personId, currency: line.currency, accountId: even ? null : picked.get(line.currency), date: date.value }, line));
    renderButton();
    return [
      !even && (accounts.length
        ? field(line.netMinor > 0 ? 'Into' : 'From', chips({
          label: line.netMinor > 0 ? 'Into' : 'From',
          options: accounts.map((a) => ({ value: a.id, label: a.name })),
          value: picked.get(line.currency),
          onChange: (v) => { picked.set(line.currency, v); renderButton(); },
        }))
        : h('p', { class: 'hint' }, 'Add a current or savings account on Net Worth to settle into.')),
      !even && field('Date', date),
      even && h('p', { class: 'hint' }, `You and ${name} are even in ${line.currency}. Closing the bills moves no money.`),
      button,
    ];
  }

  async function settleUp(choice, line) {
    const name = person().name;
    const result = await runAction(() => repo.settle(choice));
    if (!result) return;
    const made = result.changes.settlements?.[0];
    render();
    const what = line.netMinor === 0 ? `Closed the ${line.currency} bills with ${name}` : `Settled ${formatMoney(Math.abs(line.netMinor), line.currency)} with ${name}`;
    toast(what, made && { label: 'Undo', run: () => runAction(async () => { await repo.undoSettlement(made.id); render(); }) });
  }

  async function undo(t) {
    const name = person().name;
    if (!(await runAction(() => repo.undoSettlement(t.id)))) return;
    render();
    toast(`Undid the settle-up with ${name}`, {
      label: 'Undo',
      run: () => runAction(async () => { await repo.settle({ personId, currency: t.currency, accountId: t.accountId, date: t.date }); render(); }),
    });
  }

  function pastPhrase(t) {
    const name = person().name;
    const amount = formatMoney(t.amountMinor, t.currency);
    if (!t.amountMinor) return `Closed even bills in ${t.currency}`;
    const account = accountName(t.accountId);
    return t.direction === 'out'
      ? `You paid ${name} ${amount}${account ? ` from ${account}` : ''}`
      : `${name} paid you ${amount}${account ? ` into ${account}` : ''}`;
  }

  function render() {
    if (!person()) return s.close();
    const name = person().name;
    const row = peopleState(S).find((r) => r.person.id === personId);
    const open = row?.open ?? [];
    const settled = row?.settled ?? [];
    fill(content,
      !open.length && h('p', { class: 'hint' }, settled.length ? `You and ${name} are settled up.` : `No split bills with ${name} yet.`),
      open.map((line) => h('section', { class: 'sheet-form' },
        h('h3', { class: `subhead ${lineClass(line)}` }, owedPhrase(name, line)),
        openBills(line),
        settleForm(line))),
      settled.length > 0 && h('section', { class: 'sheet-form' },
        h('h3', { class: 'subhead' }, 'Past Settle-Ups'),
        h('ul', { class: 'list' }, settled.map((t) => h('li', { class: 'total-row' },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, pastPhrase(t)),
            h('span', { class: 'list-sub' }, `${formatDay(t.date)}, ${countBills(t)}`)),
          h('button', { type: 'button', class: 'text-button', onclick: () => undo(t) }, 'Undo'))))));
  }

  const countBills = (t) => {
    const n = S.splits.filter((x) => !x.deletedAt && x.settlementId === t.id).length;
    return n === 1 ? '1 bill' : `${n} bills`;
  };

  render();
}
