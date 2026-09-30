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
- Manual entry on Log: date and time default to now (editable), category chips, vendor with autocomplete, amount on a number pad, currency, payment method, optional note and trip.
- Vendor memory: category, currency and payment method per vendor; editable.
- Vendor aliases: in To sort, an entry can be assigned to an existing vendor; the incoming merchant name is saved as an alias so later payments are categorised automatically. Aliases are editable.

## Keeping To sort short

- Each item offers one tap: its most likely vendor (by alias similarity), the 4 most-used categories, and "Other" for the full list.
- The count shows on the Log tab. Over 10 items: "10 to sort. It takes about a minute." at the top of Log.

## Headline figure

At the top of Log and Overview: "£X left this month", red if negative.

`left = income this month + recurring income still due this month − spending this month − recurring costs still due this month`

- The allowance is one lump sum a year, entered net of rent, spread evenly over Oct–Sep (each month gets an equal share, the remainder in September).
- Rent is never logged. Savings are not tracked.
- The headline counts trip spending even when Overview leaves trips out.

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

## Income and recurring

- Income entries: allowance, part-time work, family, refunds, other. Same currency handling.
- Recurring costs and income: amount, currency, frequency, next date. Added automatically on the date by a scheduled Worker, shown as "added automatically", editable.

## Trips

- Name and dates. Entries within a trip's dates are suggested for it; changeable.
- Overview shows each trip's total and category breakdown, and a toggle to leave trips out of monthly and yearly totals.

## Screens

1. **Log**: headline, weekly review card (when due), To sort, entry form.
2. **Overview**: headline; month and year to date; spending by category (inline SVG chart + table); income vs spending; change vs last month; month picker. Year is calendar or academic (Oct–Sep), plus a term view (Michaelmas, Lent, Easter) with editable dates (blank by default). Trips section.
3. **History**: grouped by day, search, filters (category, trip, payment method), edit and delete.
4. **Plan**: recurring items and income sources.
- **Settings** (header icon): categories, payment methods and fees, term dates, trips, allowance schedule, backup, CSV export, backend token.

## Default categories

Delivery, Food, Gifts, Groceries, Health, Kelly, Leisure, School, Snacks, Societies and events, Subscriptions, Transport, Travel, Utilities, Other. Editable.

## Later, not now

Monthly budgets per category, with amount left and a "safe to spend today" figure. The data model reserves a `budgets` table and `categoryRows()` returns one row per category so a budget can be attached later.

## Named rules to test

- Currency conversion and fees (rounding, zero-decimal currencies, fee only on foreign currency, statement override kept).
- Amount text parsing and ambiguous symbols remembered per card.
- Recurring items added once and only once (including catch-up and running the job twice).
- Duplicate detection (same amount + merchant within 2 minutes; 2:01 is not a duplicate).
- Alias matching (exact alias auto-categorises; similar names are suggested, not applied).
- Headline figure, including the allowance spread across months and upcoming recurring items.
- Weekly summary figures (week bounds, 8-week average, top 3, To sort count).
- Trip exclusion from totals.
- The offline draft is never lost.
