// The service worker's precache list covers every front-end file, so the app opens offline,
// and the install metadata points at files that exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function listed() {
  const source = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const block = /const FILES = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, 'sw.js has a FILES list');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
  });
}

test('precache: every file under src/ and the shell is listed', () => {
  const files = listed();
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  const needed = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', ...walk('icons'),
    ...manifest.icons.map((i) => i.src), ...walk('src').filter((f) => f.endsWith('.js'))];
  const missing = needed.filter((f) => !files.includes(f));
  assert.deepEqual(missing, [], 'add these to FILES in sw.js');
});

test('precache: every listed file exists', () => {
  const gone = listed().filter((f) => f !== './' && !existsSync(join(ROOT, f)));
  assert.deepEqual(gone, []);
});

test('precache: the Worker is not part of the app', () => {
  assert.deepEqual(listed().filter((f) => f.startsWith('worker/') || f.startsWith('tests/')), []);
});

test('manifest: installs from the folder it is in, in the paper colour, with a maskable icon', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual([m.id, m.start_url, m.scope, m.display], ['./', './', './', 'standalone']);
  const paper = /--paper:\s*(#[0-9A-F]{6})/i.exec(readFileSync(join(ROOT, 'styles.css'), 'utf8'))[1];
  assert.equal(m.background_color, paper);
  assert.equal(m.theme_color, paper);
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === size && i.purpose === 'any'), size);
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(!i.src.startsWith('/'), `${i.src} is relative`);
});

test('shell: every path in index.html is relative and exists', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const paths = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);
  assert.ok(paths.includes('manifest.webmanifest'));
  assert.ok(paths.includes('icons/apple-touch-icon.png'));
  for (const p of paths) {
    assert.ok(!p.startsWith('/') && !/^https?:/.test(p), `${p} is relative`);
    assert.ok(existsSync(join(ROOT, p)), `${p} exists`);
  }
});
