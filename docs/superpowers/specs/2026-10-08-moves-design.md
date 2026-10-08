# Moves Between Accounts — Design

Date: 2026-10-08. Status: design agreed in chat; awaiting the user's review of this spec.

## Goal

Record money moved between the user's own accounts (HSBC → Revolut, Revolut → CIMB, HSBC → IBKR), so each account's carried balance in Net Worth stays right without typing a new balance. A move is never spending or income.

## Decisions

- **The user sees "move", never "transfer".** "Move Money", "Moves", "1 move since", "Moved £500.00 to Revolut". Code, table and fields say `transfers`, like `vendor` / "merchant".
- **Sent and received.** A move between accounts in different currencies records both amounts: what left (£500.00 from HSBC) and what arrived (S$865.20 in Revolut). The received box is pre-filled with an estimate at the latest rates ("~"), which the user overwrites with what the bank shows. So fees and the bank's rate land exactly. Between accounts in the same currency the user types one amount, and received equals sent.
- **Recorded on Accounts.** A "Move Money" button on the Accounts screen (`#accounts`, under the Net Worth tab). Log stays about spending and income: its blue / orange switch means money out / in, and a move is neither.
- **Seen on Accounts.** A Moves section under the accounts list. History stays spending and income.
- **Nothing outside Net Worth sees a move.** Moves are not entries: the headline, budget, forecast, Overview, review, habits, weekly summary, History, CSV and duplicate checks never read them.
- **An account with holdings (IBKR) ignores moves.** Its value comes from the Flex sync, which already shows the deposit. A move into IBKR only lowers the account it came from.
- **A move into or out of a deleted account still counts on the other side.** The money did leave (or reach) the live account.
- Left out for now: a note on a move, moves in the CSV export, recurring moves (a standing order).

## Data

New synced table in `worker/schema.sql` (added by running the schema file, which only adds missing tables, as in `004-splits.sql`; `worker/migrations/005-transfers.sql` documents the command):

```sql
CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  fromAccountId TEXT NOT NULL,
  fromAmountMinor INTEGER NOT NULL,
  fromCurrency TEXT NOT NULL,
  toAccountId TEXT NOT NULL,
  toAmountMinor INTEGER NOT NULL,
  toCurrency TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS transfers_rev ON transfers (rev);
```

- Each currency is that account's currency when the move is saved.
- Amounts are integer minor units in their own currency, above zero.
- The row joins `TABLES` in `worker/src/tables.js` (client writes, all eight fields required), the phone's `src/db/schema.js` stores, sync, backup and restore, like `settlements`.

## Engine (`src/engine/networth.js`)

- `carriedBalance` takes `transfers`. For each live move after the balance (same `afterBalance` rule as settle-ups: by date, then `updatedAt`):
  - From this account: `fromAmountMinor` comes off.
  - To this account: `toAmountMinor` goes on.
  - When the balance was typed in another currency than the move's side, that side converts through GBP at the latest rates (`convertThroughGbp`), as settle-ups do; with no rate it's skipped.
  - It returns `moved`, the count of moves applied, beside `payments`, `income` and `settled`.
- `netWorth` and `monthChange` pass `transfers` through (filtered to before the 1st for the opening balances, as for settlements). An account with holdings still skips `carriedBalance`.
- This Month needs no new line. A same-currency move nets to zero in "money in and out". With two currencies, the difference between sent and received (fees, the bank's rate against the stored rate) shows in "money in and out" too. A move into IBKR nets with IBKR's deposit, which Flex already counts as money moved in.
- The estimate for the received box: `estimateReceived(fromAmountMinor, fromCurrency, toCurrency, rates)` (the same `convertThroughGbp`), or null without rates.

## Worker

- No new route. A move saves with `PUT /transfers/:id` and deletes with `DELETE /transfers/:id` (the generic `saveRow` / `deleteRow`).
- `check('transfers', row, today)` refuses, with "Nothing changed: …":
  - From and To are the same account: "pick two different accounts.";
  - either amount isn't a whole number above zero: "enter an amount above zero.";
  - a date that isn't valid or is after today in the synced time zone: "pick a date up to today.".
- `saveRow` also refuses a new or edited move whose From or To account isn't live ("that account was deleted."). A deleted account's existing moves stay as they are.
- Restore keeps moves like every other synced table (deleted with the live rows, written from the backup, `updatedAt` kept).

## Interface

New `src/ui/transfers.js` (added to `FILES` in `sw.js`), used by `src/ui/accounts.js`.

**Accounts screen**
- A "Move Money" secondary button beside "Update Balances". It needs two live accounts (any kind); otherwise it's disabled and says "Add two accounts".
- A Moves section under the accounts list, newest first (by date, then `updatedAt`): 3 rows, then "Show N more". Each row: "HSBC → Revolut", the amounts ("£500.00 → S$865.20", or "£500.00" for one currency) and the date ("3 Oct 2026"). Tapping a row opens it in the move sheet. With no moves, the section isn't shown.
- An account row with moves since its balance adds "1 move since" / "2 moves since" to its line, like "2 payments since".

**Move sheet** ("Move Money", or "Edit Move")
- From: account chips (live accounts). To: account chips, without the From one.
- Sent: an amount box in From's currency.
- Received: shown only when the currencies differ, in To's currency, pre-filled with the estimate and marked "~ at the latest rate. Change it to what arrived." Once typed in, it stops following Sent.
- Date: defaults to today.
- Button: "Move £500.00"; disabled, it says what's missing ("Pick two accounts", "Enter an amount").
- Saving shows "Moved £500.00 to Revolut" with Undo (which deletes the move). Editing shows "Saved move".
- Edit Move has "Delete move" (danger text button), with "Deleted move" and Undo, which puts it back.
- Offline: saving needs a connection, like every write; the sheet says so the usual way.

## Tests

- Engine (`test/engine/networth.test.js`):
  - same-currency move: From down, To up, `moved` 1 on each;
  - two currencies: each side its own amount;
  - balance typed in a third currency: converted at the latest rate; skipped with no rate;
  - move dated before the balance, or same day but older `updatedAt`: ignored;
  - deleted move: ignored;
  - account with holdings: unchanged;
  - `monthChange`: a same-currency move leaves the total and money in and out unchanged;
  - `estimateReceived`.
- Worker: save and delete through the generic routes, each refusal, a deleted account, and restore round trip.
- The existing `sw.js` FILES test covers the new file.

## Records

When built: a Decisions line in `CLAUDE.md` and a Moves part in SPEC.md's Net Worth section.
