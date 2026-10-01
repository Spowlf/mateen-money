import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorker, ORIGIN } from './helpers.js';

test('auth: no token or the wrong token gets 401 and changes nothing', async () => {
  const w = makeWorker();
  for (const token of [null, 'wrong-token']) {
    const res = await w.call('GET', '/sync', { token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Check the backend token in Settings.');
  }
  assert.equal(w.rows('categories').length, 0);
});

test('auth: a Worker with no token set refuses everything', async () => {
  const w = makeWorker({ env: { API_TOKEN: '' } });
  assert.equal((await w.call('GET', '/sync', { token: '' })).status, 401);
});

test('CORS: the Pages origin may call the API, other origins get no CORS headers', async () => {
  const w = makeWorker();
  const ok = await w.request('OPTIONS', '/entries/x', { token: null, headers: { 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.match(ok.headers.get('Access-Control-Allow-Methods'), /PUT/);

  const other = await w.request('OPTIONS', '/entries/x', { token: null, origin: 'https://evil.example' });
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);

  const res = await w.request('GET', '/sync');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('routes: an unknown path is 404 and an unknown table is refused', async () => {
  const w = makeWorker();
  assert.equal((await w.call('GET', '/nothing')).status, 404);
  assert.equal((await w.call('PUT', '/meta/rev', { body: { value: 0 } })).status, 404);
  assert.equal((await w.call('PUT', '/rates/x', { body: { perGbp: 1 } })).status, 404);
});

test('routes: a body that is not JSON is refused with nothing changed', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/entries/e1', { headers: { 'Content-Type': 'application/json' }, body: undefined });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /^Nothing changed: /);
});

test('routes: a badly encoded address is not found, not a server error', async () => {
  const w = makeWorker();
  const res = await w.call('PUT', '/entries/%E0%A4%A', { body: {} });
  assert.equal(res.status, 404);
});
