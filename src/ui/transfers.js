// Moves between the user's own accounts (the transfers table; "moves" to the user), from Accounts.
// A move carries both accounts' balances on in Net Worth and is never spending or income.

import { h, chips, field, sheet, toast } from './dom.js';
import { runAction } from './format.js';
import { today, formatMoney, formatDay, toMinor, toDecimalText, estimateReceived } from '../engine/index.js';

/** Moves shown before "Show N more". */
const SHOWN = 3;

const MOVE_FIELDS = ['date', 'fromAccountId', 'fromAmountMinor', 'fromCurrency', 'toAccountId', 'toAmountMinor', 'toCurrency'];

const liveAccounts = (S) => S.accounts.filter((a) => !a.deletedAt).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

/** Live moves, newest first (by date, then the latest saved). */
export const movesOf = (S) => (S.transfers ?? []).filter((m) => !m.deletedAt)
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));

/** An amount typed in a box: minor units above zero, or null. */
const amountMinor = (text, currency) => {
  const minor = toMinor(String(text ?? '').trim().replace(/,/g, ''), currency);
  return minor ? minor : null;
};

/** What arrived, when it isn't what was sent: "→ S$865.20", else null. */
const receivedText = (m) => (m.fromCurrency === m.toCurrency && m.fromAmountMinor === m.toAmountMinor
  ? null : `→ ${formatMoney(m.toAmountMinor, m.toCurrency)}`);

/** Records a move, or edits one. */
export function openMoveSheet(repo, move = null) {
  const S = repo.state;
  // A move keeps showing its accounts even if one was deleted since.
  const accounts = S.accounts.filter((a) => !a.deletedAt || a.id === move?.fromAccountId || a.id === move?.toAccountId)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const accountOf = (id) => accounts.find((a) => a.id === id) ?? null;
  const f = {
    from: move?.fromAccountId ?? null,
    to: move?.toAccountId ?? null,
    sent: move ? toDecimalText(move.fromAmountMinor, move.fromCurrency) : '',
    received: move ? toDecimalText(move.toAmountMinor, move.toCurrency) : '',
    // Once typed in, Received stops following Sent.
    receivedTyped: !!move,
    date: move?.date ?? today(),
  };
  const fromCurrency = () => (move && f.from === move.fromAccountId ? move.fromCurrency : accountOf(f.from)?.currency);
  const toCurrency = () => (move && f.to === move.toAccountId ? move.toCurrency : accountOf(f.to)?.currency);
  const twoCurrencies = () => f.from && f.to && fromCurrency() !== toCurrency();
  const sentMinor = () => (f.from ? amountMinor(f.sent, fromCurrency()) : null);
  const receivedMinor = () => (twoCurrencies() ? amountMinor(f.received, toCurrency()) : sentMinor());

  const body = h('div', { class: 'sheet-form' });
  const save = h('button', { type: 'button', class: 'button primary', onclick: () => submit() });
  let receivedInput = null;

  function missing() {
    if (!f.from || !f.to) return 'Pick two accounts';
    if (sentMinor() === null) return 'Enter an amount';
    if (receivedMinor() === null) return 'Enter the amount received';
    if (!f.date) return 'Pick the date';
    return null;
  }

  function renderSave() {
    const need = missing();
    save.disabled = !!need;
    save.textContent = need ?? (move ? 'Save changes' : `Move ${formatMoney(sentMinor(), fromCurrency())}`);
  }

  // Received follows Sent at the latest rates until it's typed in.
  function follow() {
    if (!twoCurrencies() || f.receivedTyped) return;
    const sent = sentMinor();
    const estimate = sent === null ? null : estimateReceived(sent, fromCurrency(), toCurrency(), S.rates);
    f.received = estimate === null ? '' : toDecimalText(estimate, toCurrency());
    if (receivedInput) receivedInput.value = f.received;
  }

  function render() {
    receivedInput = null;
    const sent = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.sent, placeholder: '0.00',
      oninput: () => { f.sent = sent.value; follow(); renderSave(); } });
    const date = h('input', { class: 'input', type: 'date', value: f.date, max: today(), required: true, onchange: () => { f.date = date.value; renderSave(); } });
    const options = (without) => accounts.filter((a) => a.id !== without).map((a) => ({ value: a.id, label: a.name }));
    const pick = (side) => (v) => {
      f[side] = v;
      // A new currency on either side starts Received over from the estimate.
      f.receivedTyped = false;
      if (side === 'from' && f.to === v) f.to = null;
      follow();
      render();
    };
    let received = null;
    if (twoCurrencies()) {
      receivedInput = h('input', { class: 'input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: f.received, placeholder: '0.00',
        oninput: () => { f.received = receivedInput.value; f.receivedTyped = true; renderSave(); } });
      received = field(`Received in ${toCurrency()}`, receivedInput,
        f.receivedTyped ? 'What arrived, fees and the bank’s rate included.' : 'An estimate at the latest rate. Change it to what arrived.');
    }
    body.replaceChildren(...[
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'From'),
        chips({ label: 'From', options: options(null), value: f.from, onChange: pick('from') })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'To'),
        chips({ label: 'To', options: options(f.from), value: f.to, onChange: pick('to') })),
      h('div', { class: 'row-2' },
        field(f.from ? `Sent in ${fromCurrency()}` : 'Sent', sent),
        field('On', date)),
      received,
      h('div', { class: 'sheet-actions' },
        save,
        move && h('button', { type: 'button', class: 'button danger', onclick: () => remove() }, 'Delete move')),
    ].filter(Boolean));
    renderSave();
  }

  async function submit() {
    if (missing()) return;
    save.disabled = true;
    const id = move?.id ?? crypto.randomUUID();
    const row = {
      date: f.date,
      fromAccountId: f.from, fromAmountMinor: sentMinor(), fromCurrency: fromCurrency(),
      toAccountId: f.to, toAmountMinor: receivedMinor(), toCurrency: toCurrency(),
    };
    if (!(await runAction(() => repo.saveRow('transfers', id, row)))) return renderSave();
    s.close();
    if (move) {
      const before = Object.fromEntries(MOVE_FIELDS.map((k) => [k, move[k]]));
      toast('Saved move', { label: 'Undo', run: () => runAction(() => repo.saveRow('transfers', id, before)) });
    } else {
      toast(`Moved ${formatMoney(row.fromAmountMinor, row.fromCurrency)} to ${accountOf(f.to).name}`,
        { label: 'Undo', run: () => runAction(() => repo.deleteRow('transfers', id)) });
    }
  }

  async function remove() {
    if (!(await runAction(() => repo.deleteRow('transfers', move.id)))) return;
    s.close();
    toast('Deleted move', { label: 'Undo', run: () => runAction(() => repo.restoreRow('transfers', move.id)) });
  }

  const s = sheet(move ? 'Edit Move' : 'Move Money', body);
  render();
}

/** "Move money" for the Accounts screen: it takes two accounts. */
export function moveButton(repo) {
  const enough = liveAccounts(repo.state).length >= 2;
  return h('button', { type: 'button', class: 'button secondary', disabled: !enough, onclick: () => openMoveSheet(repo) },
    enough ? 'Move money' : 'Add two accounts');
}

/** The Moves section on Accounts, newest first; null with none. */
export function movesSection(repo, { showAll, onShowAll }) {
  const S = repo.state;
  const moves = movesOf(S);
  if (!moves.length) return null;
  const name = (id) => S.accounts.find((a) => a.id === id)?.name ?? 'Deleted account';
  const shown = showAll ? moves : moves.slice(0, SHOWN);
  const row = (m) => h('li', {}, h('button', { type: 'button', class: 'list-row', onclick: () => openMoveSheet(repo, m) },
    h('span', { class: 'list-main' },
      h('span', { class: 'list-title' }, `${name(m.fromAccountId)} → ${name(m.toAccountId)}`),
      h('span', { class: 'list-sub' }, formatDay(m.date))),
    h('span', { class: 'list-end' },
      h('span', { class: 'list-amount' }, formatMoney(m.fromAmountMinor, m.fromCurrency)),
      receivedText(m) && h('span', { class: 'list-sub' }, receivedText(m)))));
  return h('section', { class: 'section' },
    h('h2', { class: 'subhead' }, 'Moves'),
    h('ul', { class: 'list' }, shown.map(row)),
    moves.length > shown.length && h('div', {},
      h('button', { type: 'button', class: 'text-button', onclick: onShowAll }, `Show ${moves.length - shown.length} more`)));
}
