# Spec

A personal spending tracker for a student. Base currency GBP. Design, architecture, writing style and testing follow `HANDOVER.md` (blue palette), except that data lives on a small backend rather than only on the phone.

## Moment of use

Right after paying, phone in one hand. Apple Pay payments log themselves; everything else takes three or four taps on the Log screen.

## Backend (single source of truth)

- Cloudflare Workers + D1, protected by a bearer token (a Worker secret, typed into Settings; never in the repo). CORS allows only the GitHub Pages origin (`https://spowlf.github.io`).
- The backend is the only store. No offline queue, no merging.
- The app caches the last-synced data in IndexedDB, opens offline read-only, and shows "Last synced [time]".
- Saving needs a connection. Offline, the Log form keeps what was typed as a draft with "You're offline. Save when you're back online." and a Save button that works once connected. One draft at a time.
- Backup (JSON) and CSV export from Settings.

## Logging

- Apple Pay: an iOS Shortcut POSTs `{amount (text, may include a currency symbol), merchant, card, timestamp}` to `/applepay`. Duplicates (same amount + merchant within 2 minutes) are ignored. Entries can be deleted (declined payments can still trigger).
- Known vendors get their category automatically. Unknown vendors land in "To sort" at the top of Log.
- The backend replies with one plain-text line for the notification: "£4.20 at Pret, Food" or "New vendor: add a category in the app".
- Manual entry on Log: date and time default to now (editable), category chips, vendor with autocomplete, amount on a number pad, currency, payment method, optional description and trip.
- Vendor memory: category, currency and payment method per vendor; editable.
- Vendor aliases: in To sort, an entry can be assigned to an existing vendor; the incoming merchant name is saved as an alias so later payments are categorised automatically. Aliases are editable.

## Keeping To sort short

- Each item offers one tap: its most likely vendor (by alias similarity), the 4 most-used categories, and "Other" for the full list.
- The count shows on the Log tab. Over 10 items: "10 to sort. It takes about a minute." at the top of Log.

## Headline figure

At the top of Log and Overview: "£X left this month", red if negative.

`left = income this month + recurring income still due this month − spending this month − recurring costs still due this month`

- The allowance is one lump sum a year, entered net of rent, spread evenly over Oct–Sep (each month gets an equal share, the remainder in September).
- Rent is never logged. Savings never count here: account balances live in Net worth, apart from spending.
- The headline counts trip spending even when Overview leaves trips out.

## Safe to spend and forecast

- Under the headline on Log: "£12.40 a day for the rest of October." = the headline ÷ days left in the month, today included. On the last day: "£75.00 to spend today, the last day of October." If the headline is negative: "Over by £X this month." Like the headline, it always counts trips.
- Overview, current month only: an "At this pace" section under the totals, with one row like theirs: "Spending by 31 Oct", the figure, and "£Y to spare" (or, in red, "£Y more than you have"). How it's counted sits under it.
- `forecast = spent so far + recurring costs still due + daily day-to-day rate × days after today`. "More than you have" / "to spare" compares it with everything coming in this month (income received + recurring income still due).
- Day-to-day spending leaves out recurring items (entries with a `recurringId`) and, when the Overview toggle leaves trips out, trip spending. Trip spending still counts in "spent so far": the toggle only keeps one trip from setting the pace.
- A booking for a trip (spending filed under a live trip but dated outside its dates, like a flight paid in November for January) is always left out of day-to-day spending, whatever the toggle. It still counts in "spent so far" and in the month it was paid.
- Daily rate: on days 1–7, `d/7 × this month's average + (1 − d/7) × the 8 weeks before the month`, so one big early purchase doesn't swing it; from day 7, this month's average alone. History counts only from the first logged payment; with none, this month stands alone.

## Weekly review

- `GET /summary` (or `POST /summary` with `{ timestamp }`, the phone's ISO time with its offset, which picks the week) returns plain text: total spent Monday to Sunday in GBP, change vs the average week over the last 8 weeks, top 3 categories, number of items in To sort.
- A scheduled Shortcut (Sunday evening) fetches it and shows a notification.
- In the app, a "Weekly review" card appears on Log from Sunday until completed:
  1. Sort any remaining items.
  2. See the week: total vs usual, category breakdown, the 3 largest purchases.
  3. Anything unusual: categories more than 50% above their 8-week average.
  Then "Done". Completed reviews are recorded; a small count shows weeks reviewed in a row.

## Currency

- Store original amount + currency and the GBP value.
- Rates from Frankfurter (ECB; covers SGD), fetched by the Worker, cached, and marked "estimated" until refreshed.
- Per-payment-method foreign-currency fee % (default 0), added to the GBP value.
- The GBP value can be overwritten to match the statement.
- Ambiguous symbols ($, ¥, kr): ask which currency and remember the answer per card.

## Budget

- One optional overall monthly spending budget, in GBP, set in Settings (Budget) or from Overview: the part of the month's money you mean to spend (say £500 of a £1,200 share). Categories have no budgets.
- The headline is unchanged: it still says what's left of real income. The budget sits beside it.
- `budgets` rows `{ id: 'month:YYYY-MM', categoryId: 'month', fromMonth, amountPence }`: a month's budget is the latest live row on or before it. A change writes a row for the current month, so it applies from that month on and earlier months keep theirs. `amountPence` 0 = no budget from that month. Rows from the old per-category budgets are ignored. No rollover yet.
- Everything counts against it: spending, recurring costs (still due ones count as used), trips and trip bookings. The Overview toggle only keeps trips out of the forecast pace, as for the month forecast.
- Overview, month view: the budget with spent, still due, left, forecast and a bar. Over: red "£X over". Forecast to go over: amber "On track for £X of £Y". Past months: budget against actual, no forecast. "Spending by category" shows each category's share of the budget, so you can see where it goes.
- Log, spending: "£180 of your £500 budget left this month." (or "£20 over your £500 budget this month.").
- Weekly review, "Anything unusual": the budget when it's over, or forecast to go over, this month.

## Income and recurring

- Income entries: allowance, existing cash, friends / family, refunds, other. Same currency handling.
- Recurring costs and income: amount, currency, frequency, next date. Added automatically on the date by a scheduled Worker, shown as "added automatically", editable.

## Trips

- Name and dates. Entries within a trip's dates are suggested for it; changeable.
- Overview shows each trip's total and category breakdown, and a toggle to leave trips out of monthly and yearly totals.

## Net worth

What you own, beside the spending tracker, never inside it: no balance, holding or price changes the headline, budget, forecast or Overview. Shown in GBP; each account keeps its own currency. Credit cards come later.

- **Accounts** `{ id, name, kind, currency, sort }`, kind `current`, `savings` or `investment` (`card` later). The user's: DBS, HSBC, Revolut (current; Revolut in SGD), CIMB (savings, SGD), IBKR (investment, base SGD).
- **Balances** for current and savings accounts are typed in by hand as dated snapshots `{ id, accountId, date, amountMinor }`; the latest live one is the balance. A balance over 30 days old gets a warning on Accounts ("DBS was last updated 35 days ago.") with a button to update it.
- **IBKR** syncs itself each night through the Flex Web Service: the user sets up one Flex Query (open positions, net asset value, cash, trades, dividends and deposits) and its token, which is a Worker secret like the API token. The Worker replaces IBKR's holdings `{ id, accountId, symbol, exchange, name, currency, units, costMinor, closeMicro }` and appends its activity `{ id, accountId, date, type, symbol, units, amountMinor, currency }` (buy, sell, dividend, deposit, withdrawal). Units are fractional (184.8563), kept exactly as integer millionths, as are prices; values are multiplied with BigInt, since units × price in millionths passes 2^53.
- **Prices** are fetched by the Worker, never the phone: every 15 minutes while the London or New York market is open, and when the Net Worth tab opens (`POST /prices/refresh`, at most once a minute). Source: Yahoo Finance's chart endpoint (`SPUS`, `GLD`, `ISDW.L`) behind one small adapter, so it can be swapped; when it fails, the last Flex close stands. Prices live in their own table and `GET /prices`, outside `rev`, so a price tick is never a data change to sync.
- **IBKR's value** = the Flex net liquidation value at the last close + Σ units × (live price − close price), converted to SGD. So it matches IBKR's own figure at the close (fees and accruals included) and moves with prices during the day. **Today** = Σ units × (live price − previous close), as IBKR's Daily P&L.
- **Gain** = value − cost, from IBKR's cost basis, in GBP and %. Dividends show in activity.
- **Net worth** = every account's balance converted to GBP at the latest stored rate (Frankfurter; USD and SGD covered), marked "~" with "Shares at prices up to 15 minutes old. Singapore and US dollars at today's rates." The Worker saves one figure a day after the New York close `{ date, gbpPence }` for the chart; history starts the day accounts are added.
- **Net Worth tab**: the total, today's change and the change since the 1st; a 6 Months / Year / All line chart in `--ink` (blue means money out) with "Show as a table"; By Type (Investments, Savings, Current Accounts) as meters of the total; This Month split into market and currency moves (IBKR) and bank balance changes. Gains and losses carry + / − and stay neutral in colour.
- **Accounts** (from the tab): each account by kind with its balance, its own currency under the GBP figure, and when it was last updated; "Add an account".
- **IBKR** (from Accounts): value, today, cost and gain; holdings with a Value / Today / Gain switch; Mix (each holding's share); recent activity.

## Screens

1. **Log**: headline, weekly review card (when due), To sort, entry form.
2. **Overview**: totals with "Left over" standing out (no headline card); month and year to date; spending by category (inline SVG chart + table); income vs spending; change vs last month; month picker. Year is calendar or academic (Oct–Sep), plus a term view (Michaelmas, Lent, Easter) with editable dates (blank by default). Trips section.
3. **History**: grouped by day, search, filters (category, trip, payment method), edit and delete.
4. **Plan**: recurring items and income sources.
5. **Net Worth**: accounts, IBKR holdings and the total in GBP (see Net worth).
- **Settings** (header icon): categories, budget, payment methods and fees, term dates, trips, allowance schedule, backup, CSV export, backend token.

## Default categories

Delivery, Events and Societies, Food, Gifts, Groceries, Health, Kelly, Leisure, School, Snacks, Subscriptions, Transport, Travel, Utilities, Other. Editable.

## Named rules to test

- Currency conversion and fees (rounding, zero-decimal currencies, fee only on foreign currency, statement override kept).
- Amount text parsing and ambiguous symbols remembered per card.
- Recurring items added once and only once (including catch-up and running the job twice).
- Duplicate detection (same amount + merchant within 2 minutes; 2:01 is not a duplicate).
- Alias matching (exact alias auto-categorises; similar names are suggested, not applied).
- Headline figure, including the allowance spread across months and upcoming recurring items.
- Weekly summary figures (week bounds, 8-week average, top 3, To sort count).
- Trip exclusion from totals.
- The budget applying from its start month (earlier months unchanged), its forecast warning.
- Safe to spend (negative headline, last day of the month, trips always counted) and the forecast (blending in the first week and after, recurring and trips left out of the pace).
- The offline draft is never lost.
- Holding values (fractional units × price exactly, with BigInt; rounding to the penny once), IBKR's value from the close NAV plus moves since, today's change, gain.
- Net worth (latest balance per account, conversion to GBP, a balance over 30 days old flagged), one snapshot a day (running the job twice writes one).
- Price refresh (market hours only, at most once a minute on demand, the Flex close kept when the source fails).
- Flex sync replacing holdings and adding activity once only, however often it runs.
