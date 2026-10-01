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
   1. **Format Date**
      - Date: **Current Date**
      - Date Format: **ISO 8601**
      - Turn on **Include ISO 8601 Time**
   2. **Get Contents of URL**
      - URL: `<address>/summary`
      - Method: **POST**
      - Headers: `Authorization` = `Bearer <token>`
      - Request Body: **JSON**, with one text field:
        - `timestamp` = **Formatted Date**
   3. **Show Notification**, with **Contents of URL** as the text.

The time you send includes your phone's offset from UTC, so the summary covers the week that has just ended where you are, even abroad. Without it, the week follows the time zone in the app's Settings.

It reads like this: "Week of 28 Sep: £142.30, 12% above your usual £127.00. Top: Food £48.00, Groceries £35.00, Snacks £20.00. Tesco: 14 times in 4 weeks, £63.20 in all. 3 to sort."

The line after "Top" is your biggest frequent buy over the last 4 weeks, if you have one: a merchant you went to 8 times or more, or 8 or more buys under £5.00 in one category, adding up to £20.00 or more. All of them are in the weekly review in the app.

### Optional: a tip from Apple Intelligence

This needs iOS 26 or later and Apple Intelligence turned on. The tip is written on the phone, and your figures stay on it.

1. Between **Get Contents of URL** and **Show Notification**, add **Use Model**.
   - Model: **On-Device**
   - Prompt: `Here is my weekly spending summary in GBP: ` then **Contents of URL**, then:
     `Repeat it word for word. Then add one short sentence suggesting how I could spend less on the frequent buy it mentions, if it mentions one. Don't guess prices or name a saving. Use British English.`
2. In **Show Notification**, replace **Contents of URL** with **Response**.

The figures come from the app. The model only adds the tip, so treat it as an idea, not a fact.
