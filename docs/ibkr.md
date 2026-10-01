# Setting up IBKR

Net Worth fills in your IBKR account by itself. Once a night the Worker asks IBKR for a report you set up once (a Flex Query). It then updates:

- your net asset value at the close;
- your holdings;
- any new trades, dividends and deposits.

During the day it moves that value with prices up to 15 minutes old. The phone never talks to IBKR.

You need two things from IBKR: a **Flex Query** (what goes in the report) and a **Flex Web Service token** (which lets the Worker fetch it). IBKR moves its menus around now and then. If a name below doesn't match, look for the nearest one.

## 1. Make the Flex Query

1. Log in to IBKR on the website (Client Portal), not the phone app.
2. Go to **Performance & Reports → Flex Queries**.
3. Next to **Activity Flex Query**, tap **+** to make a new one. Name it `Mateen Money`.
4. Add these sections. For each, tick **Select All** fields, or at least the ones listed:

   | Section | Options | Fields it needs |
   |---|---|---|
   | Account Information | | Account ID, Currency |
   | Net Asset Value (NAV) in Base | | Report Date, Currency, Total |
   | Open Positions | **Summary** | Symbol, Description, Conid, Listing Exchange, Currency, FX Rate To Base, Quantity, Mark Price, Position Value, Cost Basis Money, Level of Detail |
   | Trades | **Execution** | Trade ID, Trade Date, Symbol, Listing Exchange, Currency, Quantity, Trade Price, Proceeds, Net Cash, Level of Detail |
   | Cash Transactions | Dividends, Payment in Lieu of Dividends, Withholding Tax, Deposits & Withdrawals, Broker Interest Received / Paid, Other Fees. Level: **Detail** | Type, Amount, Currency, Symbol, Date/Time, Transaction ID, Level of Detail |

5. Under **Delivery Configuration**:
   - **Format**: XML
   - **Period**: Last 30 Calendar Days. A night it misses is caught up the next time. Each trade is only ever added once.
6. Under **General Configuration**, leave the date format as `yyyyMMdd`.
7. Save. In the list of Flex Queries, tap the **(i)** next to `Mateen Money` and note its **Query ID**, a number.

## 2. Turn on the Flex Web Service

1. Still in **Flex Queries**, open **Flex Web Service Configuration** (the gear icon).
2. Turn it on and **Generate a New Token**. Pick the longest expiry it offers, up to a year.
3. Leave the IP address box empty. The Worker runs on Cloudflare and has no fixed address.
4. Copy the token. It's like a password: anyone with it and the Query ID can read your IBKR reports. It can't trade or move money.

## 3. Give them to the Worker

From the repo folder on your Mac:

```sh
npx wrangler secret put IBKR_FLEX_TOKEN      # paste the token
npx wrangler secret put IBKR_FLEX_QUERY_ID   # paste the Query ID
```

Never put either in a file in the repo.

If you haven't since stage 10, update the database and the Worker:

```sh
npx wrangler d1 execute mateen-money --remote --file worker/schema.sql
npx wrangler d1 execute mateen-money --remote --command "ALTER TABLE methods ADD COLUMN accountId TEXT"
npx wrangler deploy
```

`schema.sql` only adds tables that aren't there yet. Run the migration once only: run again, it says the column already exists, and that's harmless.

## 4. First sync

Open **Net Worth** in the app and tap **Sync IBKR now**. Your IBKR account appears with its value and holdings.

- If you already added an investment account called "IBKR" by hand, the sync uses that one.
- Otherwise it makes one, in your IBKR base currency.

After that it syncs by itself each night. Until then, Net Worth shows the last close.

## When it stops syncing

Net Worth says why and offers **Sync IBKR now**:

- **"Token has expired"**: generate a new token (step 2) and run `npx wrangler secret put IBKR_FLEX_TOKEN` again.
- **"The IBKR statement had no net asset value"**: the Flex Query is missing the **Net Asset Value (NAV) in Base** section.
- **"IBKR was still making the statement"**: nothing to do. It tries again within the hour.

## Prices

Prices come from Yahoo Finance, fetched by the Worker every 15 minutes while each market is open, and when you open Net Worth (at most once a minute). Your holdings are looked up as:

- SPUS and GLD (NYSE Arca) as `SPUS` and `GLD`;
- ISDW (London) as `ISDW.L`;
- an SGX holding as, for example, `ES3.SI`.

If a price can't be fetched, the holding keeps IBKR's last close.

## Trying it locally

Put `IBKR_FLEX_TOKEN=…` and `IBKR_FLEX_QUERY_ID=…` in `.dev.vars` (git ignores it) and run `npm run dev`. Then open `http://localhost:8787/__scheduled` to run the nightly job, or tap **Sync IBKR now**.
