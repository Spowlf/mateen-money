# The two Shortcuts

You need the backend address and the API token from [deploy.md](deploy.md). Below they're written as `<address>` and `<token>`.

Keep these Shortcuts to yourself. The token is stored inside them, so anyone with a copy could read your data.

## 1. Log Apple Pay payments

This logs every Apple Pay payment on its own. It needs iOS 17 or later.

1. In the Shortcuts app, go to **Automation**, tap **+**, and choose **Transaction**.
2. Pick the cards to watch. Leave all categories selected, then choose **Run Immediately** and tap **Next**.
3. Tap **New Blank Automation** and add these actions in order:
   1. **Format Date**
      - Date: **Current Date**
      - Date Format: **ISO 8601**
      - Turn on **Include ISO 8601 Time**
   2. **Get Contents of URL**
      - URL: `<address>/applepay`
      - Method: **POST**
      - Headers: `Authorization` = `Bearer <token>`
      - Request Body: **JSON**, with four text fields:
        - `amount` = **Shortcut Input › Amount**
        - `merchant` = **Shortcut Input › Merchant**
        - `card` = **Shortcut Input › Card or Pass**
        - `timestamp` = **Formatted Date**
   3. **Show Notification**, with **Contents of URL** as the text.

After a payment, you'll see one of these notifications:

- "£4.20 at Pret, Food": a known merchant, sorted for you.
- "New merchant: add a category in the app.": it's waiting in To sort.
- "New merchant: add a category and currency in the app.": the amount used a symbol like $ or ¥ that fits several currencies. Once you pick the currency, it's remembered for that card.
- "Already logged: £4.20 at Pret.": the same payment arrived twice within 2 minutes, so it was only logged once.
- A line starting "Nothing changed:": nothing was saved. The rest of the line says what to check.

Declined payments can still trigger the automation. Delete those entries in the app.

## 2. Weekly summary

This sends you a summary notification every Sunday evening.

1. Go to **Automation**, tap **+**, and choose **Time of Day**.
2. Set it to 19:00, **Weekly**, on Sunday. Choose **Run Immediately**.
3. Add these actions:
   1. **Get Contents of URL**
      - URL: `<address>/summary`
      - Method: **GET**
      - Headers: `Authorization` = `Bearer <token>`
   2. **Show Notification**, with **Contents of URL** as the text.

It reads like this: "Week of 28 Sep: £142.30, 12% above your usual £127. Top: Food £48, Groceries £35, Snacks £20. 3 to sort."
