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
  assert.equal(res.body, 'Week of 28 Sep: £57.50, 476% above your usual £9.99. Top: Food £42.00, Groceries £12.50. 1 to sort.');
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

test('summary: a Sunday-evening run from Singapore covers the week just ended there', async () => {
  // Sunday 4 Oct 2026, 19:00 in Singapore (12:00 in London).
  const w = makeWorker({ now: Date.UTC(2026, 9, 4, 11, 0, 0) });
  await w.call('PUT', '/entries/e1', { body: manualEntry({ date: '2026-09-28', amountMinor: 1000 }) });
  await w.call('POST', '/applepay', { body: applePay({ amount: '£3.00', timestamp: '2026-10-04T18:30:00+08:00' }) });
  await w.call('PUT', '/entries/e2', { body: manualEntry({ date: '2026-09-27', amountMinor: 999 }) });
  const res = await w.call('POST', '/summary', { body: { timestamp: '2026-10-04T19:00:00+08:00' } });
  assert.equal(res.status, 200);
  assert.match(res.body, /^Week of 28 Sep: £13\.00,/);
});

test('summary: the phone’s date decides the week, even when London is still on Saturday', async () => {
  // Sunday 4 Oct, 06:30 in Singapore is Saturday 3 Oct, 23:30 in London.
  const w = makeWorker({ now: Date.UTC(2026, 9, 3, 22, 30, 0) });
  assert.match((await w.call('GET', '/summary')).body, /^Week of 21 Sep:/);
  assert.match((await w.call('POST', '/summary', { body: { timestamp: '2026-10-04T06:30:00+08:00' } })).body, /^Week of 28 Sep:/);
});

test('summary: without a usable time it falls back to the time zone setting', async () => {
  const w = makeWorker({ now: SUNDAY });
  assert.match((await w.call('POST', '/summary', { body: {} })).body, /^Week of 28 Sep:/);
});
