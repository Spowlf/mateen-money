import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCase } from '../../src/engine/text.js';

test('title case: every word capitalised, short joining words lower case', () => {
  assert.equal(titleCase('Move money'), 'Move Money');
  assert.equal(titleCase('Add an account'), 'Add an Account');
  assert.equal(titleCase('Export payments as CSV'), 'Export Payments as CSV');
  assert.equal(titleCase('Spread over October to September'), 'Spread Over October to September');
  assert.equal(titleCase('Enter a fee from 0 to 100%'), 'Enter a Fee from 0 to 100%');
});

test('title case: the first and last words are always capitalised', () => {
  assert.equal(titleCase('a week'), 'A Week');
  assert.equal(titleCase('Pick who it’s split with'), 'Pick Who It’s Split With');
});

test('title case: acronyms, amounts and names keep their own case', () => {
  assert.equal(titleCase('Sync IBKR now'), 'Sync IBKR Now');
  assert.equal(titleCase('Move £500.00'), 'Move £500.00');
  assert.equal(titleCase('File under Pret a Manger'), 'File Under Pret a Manger');
  assert.equal(titleCase('Your share in SGD'), 'Your Share in SGD');
  assert.equal(titleCase('Use this phone’s time zone'), 'Use This Phone’s Time Zone');
  assert.equal(titleCase(''), '');
});
