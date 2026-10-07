# Split Expenses — Build Plan

Spec: `docs/superpowers/specs/2026-10-07-split-expenses-design.md`. Each step ends with `npm test` green, a commit and a push to `main`, and a check-in with the user. Steps that change what's on screen are checked in the browser at 375px in light and dark before the commit.

## 1. Engine (`src/engine/splits.js`, tests first)

- `evenSplit(totalMinor, count)` → `{ eachMinor, mineMinor }`: each person `floor(total / count)`, the leftover to the user.
- `shareMinor(entry, splits)` and `shareGbpPence(entry, splits)`: the user's share of a payment, in its currency and in GBP (fee shared pro rata; null while `gbpPence` is null; unsplit entries unchanged).
- `validateSplit({ amountMinor, currency, paidBy, parts })` → null or the message the Save button shows.
- `owed({ people, splits, settlements, entries })` → per person: open lines per currency (`netMinor`, `splitIds`) and past settle-ups; `owedPhrase()` for "Alex owes you £12.50" / "You owe Sam S$8.00" / "Even".
- `carriedBalance` (and `netWorth`) take `settlements`: one into or out of the account after its balance moves it, "1 settle-up since".
- `findDuplicate` skips entries with `paidBy`.
- Tests: rounding (pence, zero-decimal, leftover to the user), validation messages, share with a fee and with no GBP value yet, netting both ways and per currency, settled and deleted rows left out, carried balances with settlements in, out and in another currency, the duplicate rule.

## 2. Data and Worker

- `worker/migrations/004-splits.sql` and `worker/schema.sql`: `people`, `splits`, `settlements`, `entries.paidBy`. `TABLES`, `SYNCED`, `STORES` (IndexedDB 5), backup tables, restore.
- `PUT /entries/:id` with `paidBy` and `splits`: one write; the checks and refusals in the spec (income, live people, amounts, Σ, paidBy, waiting currency, currency change without new splits, settled lock).
- Entry delete and Undo carry their splits. `POST /settle` and `DELETE /settlements/:id`. People: archive refused while owed.
- Worker tests for each rule, and the migration matching `schema.sql`.

## 3. Spending counts your share

- Every spending sum reads `shareGbpPence`: totals (period, categories, trips), headline, forecast, budgets, overview (series, categories), habits, review, weekly summary, history, export, plan.
- One fixture (£40 paid, £30 owed) and one assertion per summary that it counts £10.
- The phone syncs the new tables; Net Worth passes settlements to `netWorth`.

## 4. Log Split block

- Folded "Split: Not split" row after Paid with; Who Paid, With, Evenly / By amount; "Save £40.00, your share £10.00"; new people on save; Undo and the offline draft keep the split.

## 5. Edit and To Sort sheets

- The same Split block; read-only with the reason when settled; "Pick the currency first." while the currency waits; a currency change recomputes an even split and clears typed amounts.

## 6. History People and settle-up

- Payments / Income / Merchants / People (widths checked at 375px); a split row shows your share and "of £40.00, split".
- People list, person sheet, Settle (account picker, date), Close these bills, past settle-ups with Undo, the toasts.

## 7. Elsewhere

- Accounts "1 settle-up since"; CSV "Your Share", "Split With", "Paid By"; Settings People (rename, remove).

## 8. Decisions

- Copy the spec's decisions into `SPEC.md` (a Split expenses section) and `CLAUDE.md` (dated Decisions).
