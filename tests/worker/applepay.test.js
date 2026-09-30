import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, manualEntry, applePay } from './helpers.js';

const rates = { latest: { date: '2026-09-30', rates: { SGD: 1.7, USD: 1.3, JPY: 200, CNY: 9.5 } } };

async function knownPret(w) {
  await w.call('PUT', '/entries/e0', { body: manualEntry({ merchant: 'Pret a Manger', date: '2026-09-20', at: null }) });
}

test('Apple Pay: an unknown vendor lands in To sort and the notification says so', async () => {
  const w = makeWorker();
  const res = await w.call('POST', '/applepay', { body: applePay() });
  assert.equal(res.status, 200);
  assert.equal(res.body, 'New vendor: add a category in the app.');
  const [e] = w.rows('entries');
  assert.deepEqual(
    [e.kind, e.source, e.merchant, e.categoryId, e.vendorId, e.amountMinor, e.currency, e.gbpPence, e.date, e.time, e.card],
    ['spend', 'applepay', 'PRET A MANGER #1234', null, null, 420, 'GBP', 420, '2026-10-01', '13:00', 'Monzo'],
  );
  assert.equal(e.at, Date.UTC(2026, 9, 1, 12, 0, 0));
});

test('Apple Pay: the card becomes a payment method the first time it is seen, and is reused after', async () => {
  const w = makeWorker();
  await w.call('POST', '/applepay', { body: applePay() });
  await w.call('POST', '/applepay', { body: applePay({ card: 'monzo', timestamp: '2026-10-01T15:00:00+01:00' }) });
  const cards = w.rows('methods', 'walletCard IS NOT NULL');
  assert.deepEqual(cards.map((m) => [m.name, m.walletCard, m.kind]), [['Monzo', 'Monzo', 'card']]);
  assert.deepEqual(w.rows('entries').map((e) => e.methodId), [cards[0].id, cards[0].id]);
});

test('Apple Pay: a known vendor gets its category and the notification names it', async () => {
  const w = makeWorker();
  await knownPret(w);
  const res = await w.call('POST', '/applepay', { body: applePay() });
  assert.equal(res.body, '£4.20 at Pret a Manger, Eating out');
  const e = w.rows('entries', "source = 'applepay'")[0];
  assert.equal(e.categoryId, 'eating-out');
  assert.equal(w.rows('vendors')[0].useCount, 2);
});

test('Apple Pay: a known vendor with no category yet still goes to To sort', async () => {
  const w = makeWorker();
  await w.call('PUT', '/vendors/v1', { body: { name: 'Pret a Manger', categoryId: null } });
  const res = await w.call('POST', '/applepay', { body: applePay() });
  assert.equal(res.body, '£4.20 at Pret a Manger. Add a category in the app.');
  assert.equal(w.rows('entries')[0].categoryId, null);
  assert.equal(w.rows('entries')[0].vendorId, 'v1');
});

test('Apple Pay: a similar name is only suggested, never applied', async () => {
  const w = makeWorker();
  await knownPret(w);
  await w.call('POST', '/applepay', { body: applePay({ merchant: 'PRET' }) });
  const e = w.rows('entries', "source = 'applepay'")[0];
  assert.deepEqual([e.categoryId, e.vendorId], [null, null]);
});

test('duplicates: the same amount and merchant within 2 minutes is ignored; 2:01 is not', async () => {
  const w = makeWorker();
  await w.call('POST', '/applepay', { body: applePay() });
  const again = await w.call('POST', '/applepay', { body: applePay({ timestamp: '2026-10-01T13:02:00+01:00' }) });
  assert.equal(again.status, 200);
  assert.equal(again.body, 'Already logged: £4.20 at PRET A MANGER #1234.');
  assert.equal(w.rows('entries').length, 1);

  await w.call('POST', '/applepay', { body: applePay({ timestamp: '2026-10-01T13:02:01+01:00' }) });
  assert.equal(w.rows('entries').length, 2);
});

test('duplicates: a deleted payment doesn\'t block the same payment arriving again', async () => {
  const w = makeWorker();
  await w.call('POST', '/applepay', { body: applePay() });
  await w.call('DELETE', `/entries/${w.rows('entries')[0].id}`);
  await w.call('POST', '/applepay', { body: applePay({ timestamp: '2026-10-01T13:01:00+01:00' }) });
  assert.equal(w.rows('entries', 'deletedAt IS NULL').length, 1);
});

test('Apple Pay: a foreign payment is converted, and the notification shows both amounts', async () => {
  const w = makeWorker({ rates });
  await w.call('PUT', '/entries/e0', { body: manualEntry({ merchant: 'Ya Kun', categoryId: 'coffee-snacks', date: '2026-09-20' }) });
  const res = await w.call('POST', '/applepay', { body: applePay({ amount: 'S$12.50', merchant: 'YA KUN #0231 SINGAPORE', timestamp: '2026-10-01T20:00:00+08:00' }) });
  assert.equal(res.body, 'S$12.50 at Ya Kun, Coffee and snacks, ~£7.35');
  const e = w.rows('entries', "source = 'applepay'")[0];
  assert.deepEqual([e.currency, e.amountMinor, e.gbpPence, e.gbpStatus, e.date, e.time], ['SGD', 1250, 735, 'estimated', '2026-10-01', '20:00']);
});

test('ambiguous symbols: "$" asks which currency, and the answer is remembered for that card', async () => {
  const w = makeWorker({ rates });
  const res = await w.call('POST', '/applepay', { body: applePay({ amount: '$12.50', merchant: 'CHEERS' }) });
  assert.equal(res.body, 'New vendor: add a category and currency in the app.');
  const e = w.rows('entries')[0];
  assert.deepEqual([e.needsCurrency, e.symbol, e.currency], [1, '$', 'USD']);

  await w.call('POST', `/entries/${e.id}/sort`, { body: { currency: 'SGD', categoryId: 'groceries' } });
  await w.call('POST', '/applepay', { body: applePay({ amount: '$5.00', merchant: 'CHEERS', timestamp: '2026-10-01T18:00:00+01:00' }) });
  const next = w.rows('entries', 'amountMinor = 500')[0];
  assert.deepEqual([next.currency, next.needsCurrency, next.categoryId], ['SGD', 0, 'groceries']);

  // Another card still asks.
  await w.call('POST', '/applepay', { body: applePay({ amount: '$5.00', merchant: 'CHEERS', card: 'Amex', timestamp: '2026-10-01T19:00:00+01:00' }) });
  assert.equal(w.rows('entries', "card = 'Amex'")[0].needsCurrency, 1);
});

test('Apple Pay: a refund arrives as income', async () => {
  const w = makeWorker();
  const res = await w.call('POST', '/applepay', { body: applePay({ amount: '-£4.20' }) });
  assert.equal(res.body, 'Refund of £4.20 from PRET A MANGER #1234');
  const e = w.rows('entries')[0];
  assert.deepEqual([e.kind, e.incomeType, e.categoryId, e.amountMinor], ['income', 'refund', null, 420]);
});

test('Apple Pay: an amount that can\'t be read changes nothing and says what to check', async () => {
  const w = makeWorker();
  for (const body of [applePay({ amount: 'abc' }), applePay({ amount: '£0.00' }), { merchant: 'X' }]) {
    const res = await w.call('POST', '/applepay', { body });
    assert.equal(res.status, 400);
    assert.match(res.body, /^Nothing changed: /);
  }
  assert.equal(w.rows('entries').length, 0);
});

test('Apple Pay: with no usable timestamp, the time it arrived is used, in London time', async () => {
  const w = makeWorker();
  await w.call('POST', '/applepay', { body: applePay({ timestamp: 'yesterday' }) });
  const e = w.rows('entries')[0];
  assert.deepEqual([e.date, e.time], ['2026-10-01', '13:00']);
});
