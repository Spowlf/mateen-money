# Split Expenses — Design

Date: 2026-10-07. Status: approved in conversation, awaiting spec review.

## Goal

Log a payment shared with other people: who it was split with, and how much each person's share was (evenly or by amount). Only the user's own share counts as spending. The app remembers who owes whom, per person and per currency, until it's settled, and a settle-up records the account the money went into (or came out of).

## Decisions

- **Your share is your spending.** Every spending figure (headline, budget, forecast, Overview, review, habits, weekly summary, History amounts) counts only the user's share of a split payment.
- **Either side can pay.** The user pays and others owe them, or a friend pays and the user owes that friend their share. Paying back or being paid back is never spending or income.
- **Settle per person, per currency, the whole amount.** No partial settle-ups. To record a partial repayment, edit the bill.
- **A settle-up always names an account** (required): where the money went in, or came out of. It moves that account's carried balance in Net Worth.
- **Owed amounts stay in the bill's currency.** "Alex owes you S$20.00 and £5.00". The share's GBP value uses the payment's own rate and fee.
- **The entry keeps the full amount charged** (£40 on the card, or £40 the friend paid). The share is derived. This keeps Apple Pay duplicate detection, card carried balances and later statement import matching the real charge.
- Income can't be split.
- Money owed to the user is not an asset in Net Worth.

## Data

New D1 migration `worker/migrations/004-splits.sql`, the same columns in `worker/schema.sql`, `TABLES` in `worker/src/tables.js`, `SYNCED` / `STORES` in `src/db/schema.js` (IndexedDB version 5), and the backup tables.

### `people`

| Field | Notes |
|---|---|
| `id` | UUID |
| `name` | as typed, title case not forced |
| `sort` | order in pickers |
| `archived` | 0/1; removed people are archived so old bills keep their name |

### `splits` — one row per person per bill

| Field | Notes |
|---|---|
| `id` | UUID |
| `entryId` | the payment |
| `personId` | |
| `amountMinor` | that person's part, minor units of the bill's currency, > 0 |
| `currency` | always the entry's currency |
| `direction` | `owedToMe` (user paid) or `iOwe` (this person paid) |
| `settlementId` | null while owed |

### `settlements` — one row per settle-up

| Field | Notes |
|---|---|
| `id` | UUID |
| `personId` | |
| `date` | `'YYYY-MM-DD'` |
| `amountMinor` | net amount, > 0 |
| `currency` | the splits' currency |
| `direction` | `in` (they paid the user) or `out` (the user paid them) |
| `accountId` | required; any live current or savings account |

### `entries.paidBy`

`null` = the user paid. A `personId` = that person paid the whole bill; then `methodId` is null and the entry has exactly one split, `iOwe`, to that person, equal to the user's share. Other people's shares of a friend-paid bill are not stored.

## Rules

- **User paid:** splits are all `owedToMe`. Share = `amountMinor` − Σ splits. Σ splits ≤ amount, so the share is ≥ 0 (0 is allowed: paying entirely for someone else).
- **Friend paid:** one `iOwe` split; the share is that split's amount.
- **Evenly:** `evenSplit(totalMinor, count)` with count = people + the user. Each person gets `floor(total / count)`; leftover minor units go to the user, never to a friend. Zero-decimal currencies split in whole units.
- **By amount:** each person's amount typed; the user's share is what's left.
- **Share in GBP:** `shareGbpPence(entry, splits)` = `round(gbpPence × share / amountMinor)`, so the fee is shared pro rata. Null while `gbpPence` is null. Unsplit entries return `gbpPence` unchanged.
- **Net per person per currency:** Σ unsettled `owedToMe` − Σ unsettled `iOwe`. Positive: they owe the user. Negative: the user owes them. Zero with unsettled splits reads "Even" with a "Close these bills" button, which settles them with a £0.00 settlement (see Worker).
- **Carried balance:** a settlement whose `accountId` is the account and dated after the balance adds (`in`) or takes off (`out`) its amount, converted through the latest rate if the currencies differ, like a foreign card payment. Counted as "1 settle-up since".

## Engine — `src/engine/splits.js` (pure, tests first)

- `evenSplit(totalMinor, count)` → `{ eachMinor, mineMinor }`.
- `validateSplit({ amountMinor, paidBy, splits })` → null or a message ("Shares add up to more than £40.00.").
- `shareMinor(entry, splits)` and `shareGbpPence(entry, splits)`.
- `owed({ people, splits, settlements })` → per person: `[{ personId, currency, netMinor, splitIds }]`, plus each person's settled-up history.
- `carriedBalance` in `src/engine/networth.js` takes `settlements`.

Every spending sum switches from `gbpPence` to `shareGbpPence`: `totals.js`, `headline.js`, `forecast.js`, `budgets.js`, `overview.js`, `habits.js`, `review.js`, `summary.js`, `history.js`, `export.js`, `plan.js` where it reads entries. A test builds one split fixture (£40 paid, £30 owed) and checks each summary counts £10.

## Worker

- **`PUT /entries/:id`** accepts optional `paidBy` and `splits: [{ id, personId, amountMinor }]`. After pricing, it writes the entry and replaces the entry's unsettled splits (removed ones soft-deleted) in one write. Checks: income has no splits; each person is live; amounts > 0; currency is the entry's; Σ ≤ amount; with `paidBy`, exactly one split to that person and `methodId` null.
- **Settled bills are locked.** With any settled split, changing `amountMinor`, `currency`, `paidBy` or the splits, or deleting the entry, is refused: "Nothing changed: Alex already settled this bill. Undo that settle-up first." Other fields still save.
- **Deleting an entry** soft-deletes its splits in the same write; Undo (PUT with `deletedAt: null`) restores both.
- **`POST /settle`** `{ id, personId, currency, accountId, date }`. The Worker nets that person's unsettled splits in that currency from its own rows, writes the settlement (`direction` from the sign) and stamps `settlementId` on every one of those splits, in one write. Nothing unsettled: refused, "Nothing changed: nothing is owed in GBP." A net of zero writes a settlement of 0 so the splits are closed together. Account must be live.
- **`DELETE /settlements/:id`** soft-deletes it and clears `settlementId` on its splits, one write. Undo of that is a new `POST /settle`.
- **`PUT /people/:id`** is a plain row. Deleting (archiving) a person with anything unsettled is refused.
- **Weekly summary and habits** read `shareGbpPence`.
- **Restore** includes `people`, `splits`, `settlements`.

## Screens

### Log (spending only)

- A **Split** row in the folded details after Paid with, reading "Not split". The summary line adds "split with Alex, Sam" or "Alex paid".
- Opened, it shows:
  - **Who Paid**: chips "You", each person, "Add person". A friend hides Paid with.
  - **With** (when the user paid): person chips, multi-pick, plus "Add person". A new name becomes a `people` row on save.
  - **Evenly / By amount** segmented control. Evenly shows "£10.00 each, your share £10.00". By amount shows an amount box per person and the user's share updating as they type.
- The Save button says both: "Save £40.00, your share £10.00". Disabled with the problem: "Shares add up to more than £40.00".
- Undo and the offline draft include the split.

### Edit sheet and To Sort sheet

The same Split block, so an Apple Pay payment can be split after it arrives. With a settled split, amount, currency and Split are read-only with the reason shown.

### History

- The switch becomes **Payments / Income / Merchants / Friends** (if four segments don't fit at 375px, check widths before choosing a shorter label).
- A split payment row shows the user's share as its amount and "of £40.00, split" as small print.
- **Friends** lists each person with what's open, per currency: "Alex owes you £12.50" (income colour), "You owe Sam S$8.00" (spend colour), "Settled up". Tap → person sheet: open bills, a **Settle £12.50** button (account picker, date defaulting to today), then past settle-ups with Undo.
- Toasts: "Settled £12.50 with Alex", "Undid the settle-up with Alex".

### Elsewhere

- Accounts: "1 settle-up since" beside the "~".
- CSV export: "Your Share", "Split With", "Paid By" columns.
- Settings: a People section (rename, remove).

## Testing

- Engine: `evenSplit` rounding (pence, zero-decimal, 1 person, leftover to the user), `validateSplit`, `shareGbpPence` with a fee and with null `gbpPence`, `owed` netting both directions and per currency, `carriedBalance` with settlements in and out and in another currency, and the every-summary fixture.
- Worker: save entry with splits in one rev; replace splits on edit; income refused; Σ over amount refused; paidBy rules; settled lock; delete and undo with splits; settle netting, zero net, nothing owed; undo settle-up; person removal refused while owed; restore with the new tables; migration matches `schema.sql`.
- Front end: new files in `sw.js` `FILES`; screenshot Log, the edit sheet, History Friends and the person sheet in light and dark at 375px.

## Out of scope

Partial settle-ups, group netting across people, splitting income, splitting recurring items, owed money in Net Worth, and notifying friends.

## Build order

1. Engine and its tests.
2. Migration, schema, Worker routes and tests.
3. Sync tables and spending sums switched over.
4. Log Split block.
5. Edit and To Sort sheets.
6. History Friends, person sheet, settle-up.
7. Accounts line, CSV, Settings People, CLAUDE.md decisions.
