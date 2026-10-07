# Split Expenses — Design

Date: 2026-10-07. Status: reviewed; seven changes made on 2026-10-07 (marked *Review* below). Awaiting the user's go-ahead for the plan.

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
- Money owed to the user is not an asset in Net Worth. *Review:* so Net Worth dips while friends owe the user: pay £40 with £30 owed back and the current account drops by £40 at once, coming back up by £30 only at the settle-up. Agreed knowingly, not a bug.
- *Review:* **One name: "People".** Every label says People (History's switch, Settings, the Split block's pickers), never Friends: the table is `people`, and it fits family or a partner as well as friends. Like "merchant", never "vendor".
- *Review:* **A friend-paid bill never matches a duplicate.** It never touched the user's card, so `findDuplicate` skips entries with `paidBy` set; otherwise logging "Alex paid £40 at Pret" would swallow the user's own £40 Apple Pay payment at Pret within 2 minutes.

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
| `accountId` | required for a non-zero amount (any live current or savings account); null for a 0 settlement, since nothing moved |

### `entries.paidBy`

`null` = the user paid. A `personId` = that person paid the whole bill; then `methodId` is null and the entry has exactly one split, `iOwe`, to that person, equal to the user's share. Other people's shares of a friend-paid bill are not stored.

## Rules

- **User paid:** splits are all `owedToMe`. Share = `amountMinor` − Σ splits. Σ splits ≤ amount, so the share is ≥ 0 (0 is allowed: paying entirely for someone else).
- **Friend paid:** one `iOwe` split; the share is that split's amount.
- **Evenly:** `evenSplit(totalMinor, count)` with count = people + the user. Each person gets `floor(total / count)`; leftover minor units go to the user, never to a friend. Zero-decimal currencies split in whole units.
- **By amount:** each person's amount typed; the user's share is what's left.
- **Share in GBP:** `shareGbpPence(entry, splits)` = `round(gbpPence × share / amountMinor)`, so the fee is shared pro rata. Null while `gbpPence` is null. Unsplit entries return `gbpPence` unchanged.
- **Net per person per currency:** Σ unsettled `owedToMe` − Σ unsettled `iOwe`. Positive: they owe the user. Negative: the user owes them. Zero with unsettled splits reads "Even" with a "Close these bills" button, which settles them with a 0 settlement in the bills' own currency (shown as "S$0.00" for Singapore dollars), asking for no account (see Worker). *Review.*
- **Carried balance:** a settlement whose `accountId` is the account and dated after the balance adds (`in`) or takes off (`out`) its amount, converted through the latest rate if the currencies differ, like a foreign card payment. Counted as "1 settle-up since".

## Engine — `src/engine/splits.js` (pure, tests first)

- `evenSplit(totalMinor, count)` → `{ eachMinor, mineMinor }`.
- `validateSplit({ amountMinor, paidBy, splits })` → null or a message ("Shares add up to more than £40.00.").
- `shareMinor(entry, splits)` and `shareGbpPence(entry, splits)`.
- `owed({ people, splits, settlements })` → per person: `[{ personId, currency, netMinor, splitIds }]`, plus each person's settled-up history.
- `carriedBalance` in `src/engine/networth.js` takes `settlements`.

Every spending sum switches from `gbpPence` to `shareGbpPence`: `totals.js` (period totals, category rows and trip totals), `headline.js`, `forecast.js`, `budgets.js`, `overview.js` (including the period series and Spending by Category), `habits.js`, `review.js`, `summary.js`, `history.js`, `export.js`, `plan.js` where it reads entries. A test builds one split fixture (£40 paid, £30 owed) and checks each summary counts £10, one assertion per summary, so a missed one fails by name. *Review:* trip totals and the category table named.

## Worker

- **`PUT /entries/:id`** accepts optional `paidBy` and `splits: [{ id, personId, amountMinor }]`. After pricing, it writes the entry and replaces the entry's unsettled splits (removed ones soft-deleted) in one write. Checks: income has no splits; each person is live; amounts > 0; currency is the entry's; Σ ≤ amount; with `paidBy`, exactly one split to that person and `methodId` null.
- *Review:* **Splits follow the entry's currency.** A payment still waiting for its currency (`needsCurrency`, an ambiguous "$" or "¥") can't be split: refused, "Nothing changed: pick the currency first." A change of an entry's currency or amount with unsettled splits must send its splits again in the same request (the app recomputes an even split and clears typed amounts for the user to retype); a request that changes the currency but sends no splits is refused, "Nothing changed: split it again in the new currency." So `POST /entries/:id/sort`, which re-reads the amount in the picked currency, never meets a split.
- **Settled bills are locked.** With any settled split, changing `amountMinor`, `currency`, `paidBy` or the splits, or deleting the entry, is refused: "Nothing changed: Alex already settled this bill. Undo that settle-up first." Other fields still save.
- **Deleting an entry** soft-deletes its splits in the same write; Undo (PUT with `deletedAt: null`) restores both.
- **`POST /settle`** `{ id, personId, currency, accountId, date }`. The Worker nets that person's unsettled splits in that currency from its own rows, writes the settlement (`direction` from the sign) and stamps `settlementId` on every one of those splits, in one write. Nothing unsettled: refused, "Nothing changed: nothing is owed in GBP." A net of zero writes a settlement of 0 with `accountId` null, so the splits are closed together and no balance moves; any `accountId` sent with it is ignored. A non-zero net needs a live current or savings account: "Nothing changed: pick the account it went into." *Review.*
- **`DELETE /settlements/:id`** soft-deletes it and clears `settlementId` on its splits, one write. Undo of that is a new `POST /settle`.
- **`PUT /people/:id`** is a plain row. Deleting (archiving) a person with anything unsettled is refused.
- *Review:* **Duplicate detection** (`findDuplicate` in `src/engine/vendors.js`, used by `POST /applepay`) skips entries with `paidBy` set.
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

The same Split block, so an Apple Pay payment can be split after it arrives. With a settled split, amount, currency and Split are read-only with the reason shown. *Review:* while a payment waits for its currency, the Split block reads "Pick the currency first." in place of its controls, and opens once the currency is picked. Changing the currency in the edit sheet recomputes an even split and clears typed amounts.

### History

- The switch becomes **Payments / Income / Merchants / People** (if four segments don't fit at 375px, check widths before choosing a shorter label).
- A split payment row shows the user's share as its amount and "of £40.00, split" as small print.
- **People** lists each person with what's open, per currency: "Alex owes you £12.50" (income colour), "You owe Sam S$8.00" (spend colour), "Settled up". Tap → person sheet: open bills, a **Settle £12.50** button (account picker, date defaulting to today), then past settle-ups with Undo.
- Toasts: "Settled £12.50 with Alex", "Undid the settle-up with Alex".

### Elsewhere

- Accounts: "1 settle-up since" beside the "~".
- CSV export: "Your Share", "Split With", "Paid By" columns.
- Settings: a People section (rename, remove).

## Testing

- Engine: `evenSplit` rounding (pence, zero-decimal, 1 person, leftover to the user), `validateSplit`, `shareGbpPence` with a fee and with null `gbpPence`, `owed` netting both directions and per currency, `carriedBalance` with settlements in and out and in another currency, and the every-summary fixture.
- Worker: save entry with splits in one rev; replace splits on edit; income refused; Σ over amount refused; paidBy rules; settled lock; delete and undo with splits; settle netting, zero net, nothing owed; undo settle-up; person removal refused while owed; restore with the new tables; migration matches `schema.sql`.
- *Review:* Worker also: a friend-paid entry never matches an Apple Pay duplicate; splitting a payment still waiting for its currency is refused; a currency change without new splits is refused; a zero settle-up needs no account and moves no balance.
- Front end: new files in `sw.js` `FILES`; screenshot Log, the edit sheet, History People and the person sheet in light and dark at 375px.

## Out of scope

Partial settle-ups, group netting across people, splitting income, splitting recurring items, owed money in Net Worth, and notifying friends.

*Review:* **Refunds on a split bill.** A refund is income and can't be split, so a £40 refund on a bill split four ways counts as £40 of income, not £10. Until that's built, the user logs only their share of the refund (edit its amount), and settles the friends' parts with them directly.

## Build order

1. Engine and its tests.
2. Migration, schema, Worker routes and tests.
3. Sync tables and spending sums switched over.
4. Log Split block.
5. Edit and To Sort sheets.
6. History People, person sheet, settle-up.
7. Accounts line, CSV, Settings People.
8. *Review:* copy this spec's decisions into `SPEC.md` (a Split expenses section, and the spending figures counting your share) and `CLAUDE.md` (dated Decisions), so later sessions find them where they look first. This file stays as the design record.
