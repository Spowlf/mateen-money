import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseMerchant, similarity, matchVendor, exactVendor, findDuplicate } from '../../src/engine/vendors.js';

test('normaliseMerchant strips store numbers, towns, processors and punctuation', () => {
  assert.equal(normaliseMerchant('PRET A MANGER #1234 LONDON'), 'pret a manger');
  assert.equal(normaliseMerchant('SQ *CORNER CAFE'), 'corner cafe');
  assert.equal(normaliseMerchant("Sainsbury's Local"), 'sainsburys local');
  assert.equal(normaliseMerchant('M&S Simply Food'), 'm and s simply food');
  assert.equal(normaliseMerchant('Café Nero'), 'cafe nero');
  assert.equal(normaliseMerchant('TFL.GOV.UK/CP'), 'tfl gov cp');
});

test('similarity is symmetric and high for the same vendor written differently', () => {
  assert.equal(similarity('Pret', 'PRET A MANGER 0412'), 0.9);
  assert.equal(similarity('PRET A MANGER 0412', 'Pret'), 0.9);
  assert.ok(similarity('Sainsburys', "SAINSBURY'S S/MKTS") >= 0.6);
  assert.ok(similarity('Tesco', 'Pret') < 0.6);
});

const VENDORS = [
  { id: 'v-pret', name: 'Pret', categoryId: 'coffee-snacks', useCount: 12 },
  { id: 'v-sains', name: "Sainsbury's", categoryId: 'groceries', useCount: 30 },
  { id: 'v-gone', name: 'Tesco', categoryId: 'groceries', deletedAt: 1 },
];
const ALIASES = [{ id: 'a1', vendorId: 'v-sains', alias: "SAINSBURY'S S/MKTS", aliasNorm: normaliseMerchant("SAINSBURY'S S/MKTS") }];

test('alias matching: an exact name or alias is applied automatically', () => {
  assert.equal(matchVendor('PRET #1234 LONDON', VENDORS, ALIASES).exact?.id, 'v-pret');
  assert.equal(matchVendor("SAINSBURY'S S/MKTS 0123", VENDORS, ALIASES).exact?.id, 'v-sains');
});

test('alias matching: a similar name is only suggested', () => {
  const r = matchVendor('PRET A MANGER', VENDORS, ALIASES);
  assert.equal(r.exact, null);
  assert.equal(r.suggestion?.id, 'v-pret');
});

test('alias matching: nothing close means no suggestion, and deleted vendors never match', () => {
  const r = matchVendor('Waterstones', VENDORS, ALIASES);
  assert.deepEqual([r.exact, r.suggestion], [null, null]);
  assert.equal(matchVendor('Tesco', VENDORS, ALIASES).exact, null);
  assert.equal(matchVendor('', VENDORS, ALIASES).exact, null);
});

const T = Date.UTC(2026, 9, 1, 12, 0, 0);
const existing = [{ id: 'e1', amountMinor: 420, currency: 'GBP', merchant: 'PRET A MANGER #12', at: T, deletedAt: null }];

test('duplicate detection: same amount and merchant within 2 minutes', () => {
  assert.equal(findDuplicate({ amountMinor: 420, currency: 'GBP', merchant: 'Pret a Manger', at: T + 60_000 }, existing)?.id, 'e1');
  assert.equal(findDuplicate({ amountMinor: 420, currency: 'GBP', merchant: 'PRET A MANGER #12', at: T + 120_000 }, existing)?.id, 'e1');
  assert.equal(findDuplicate({ amountMinor: 420, currency: 'GBP', merchant: 'PRET A MANGER #12', at: T - 90_000 }, existing)?.id, 'e1');
});

test('duplicate detection: not a duplicate after 2 minutes, at another amount or merchant, or once deleted', () => {
  assert.equal(findDuplicate({ amountMinor: 420, currency: 'GBP', merchant: 'PRET A MANGER #12', at: T + 121_000 }, existing), null);
  assert.equal(findDuplicate({ amountMinor: 421, currency: 'GBP', merchant: 'PRET A MANGER #12', at: T }, existing), null);
  assert.equal(findDuplicate({ amountMinor: 420, currency: 'GBP', merchant: 'Costa', at: T }, existing), null);
  assert.equal(findDuplicate({ amountMinor: 420, currency: 'GBP', merchant: 'PRET A MANGER #12', at: T }, [{ ...existing[0], deletedAt: 5 }]), null);
});

test('exactVendor: the vendor matchVendor applies, without a suggestion', () => {
  assert.equal(exactVendor('PRET #1234 LONDON', VENDORS, ALIASES)?.id, 'v-pret');
  assert.equal(exactVendor("SAINSBURY'S S/MKTS 0123", VENDORS, ALIASES)?.id, 'v-sains');
  assert.equal(exactVendor('PRET A MANGER', VENDORS, ALIASES), null);
  assert.equal(exactVendor('Tesco', VENDORS, ALIASES), null);
  assert.equal(exactVendor('', VENDORS, ALIASES), null);
});

test('normaliseMerchant gives the same answer the second time (it keeps results)', () => {
  assert.equal(normaliseMerchant('SQ *CORNER CAFE'), normaliseMerchant('SQ *CORNER CAFE'));
  assert.equal(normaliseMerchant(null), '');
  assert.equal(normaliseMerchant(undefined), '');
});
