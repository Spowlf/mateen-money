import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, applePay } from './helpers.js';

// Sunday 4 Oct 2026, 19:00 in London: the Shortcut's weekly run.
const SUNDAY = Date.UTC(2026, 9, 4, 18, 0, 0);

test('summary: plain text for this week on Sunday, with top categories and the To sort count', async () => {
  const w = makeWorker({ now: SUNDAY });
  await w.call('PUT', '/entries/e1', { body: manualEntry({ date: '2026-10-01', amountMinor: 4200 }) });
  await w.call('PUT', '/entries/e2', { body: manualEntry({ date: '2026-10-02', amountMinor: 1250, merchant: 'Tesco', categoryId: 'groceries' }) });
  await w.call('PUT', '/entries/e3', { body: manualEntry({ date: '2026-09-27', amountMinor: 999 }) });
  await w.call('POST', '/applepay', { body: applePay({ amount: '£3.00', merchant: 'COSTA', timestamp: '2026-10-04T10:00:00+01:00' }) });
  const res = await w.call('GET', '/summary');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^text\/plain/);
  // The To sort payment counts in the total. Usual = the one full week since the first spend (£9.99).
  assert.equal(res.body, 'Week of 28 Sep: £57.50, 476% above your usual £10. Top: Food £42, Groceries £13. 1 to sort.');
});

test('summary: an empty week says so plainly', async () => {
  const w = makeWorker({ now: SUNDAY });
  const res = await w.call('GET', '/summary');
  assert.equal(res.body, 'Week of 28 Sep: £0.00. Nothing to sort.');
});

test('summary: needs the token', async () => {
  const w = makeWorker({ now: SUNDAY });
  assert.equal((await w.call('GET', '/summary', { token: null })).status, 401);
});
