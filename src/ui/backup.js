// Backup (JSON), restore, and CSV export. Files go through the share sheet where the phone has one
// (Save to Files, AirDrop), otherwise they download.

import { toast } from './dom.js';
import { runAction } from './format.js';
import { today, formatDay, backupData, readBackup, entriesCsv } from '../engine/index.js';
import { OfflineError } from '../errors.js';

/** Shares or downloads a file. Returns false if the share sheet was closed without saving. */
async function deliver(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      // Some browsers refuse file shares they said they could do: fall back to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

/** Saves everything as JSON. Syncs first so the file is current; offline, it says the copy is from the last sync. */
export async function exportBackup(repo) {
  let fresh = true;
  try {
    await repo.sync();
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;
    fresh = false;
  }
  const data = backupData(repo.state, { now: Date.now() });
  const file = new File([JSON.stringify(data, null, 1)], `mateen-money-backup-${today()}.json`, { type: 'application/json' });
  if (!(await deliver(file))) return;
  await repo.markBackedUp();
  toast(fresh ? 'Saved a backup' : 'Saved a backup from the last sync. You’re offline.');
}

export async function exportCsv(repo) {
  const S = repo.state;
  const csv = entriesCsv({ entries: S.entries, vendors: S.vendors, categories: S.categories, methods: S.methods, accounts: S.accounts, trips: S.trips, splits: S.splits ?? [], people: S.people ?? [] });
  const file = new File([csv], `mateen-money-payments-${today()}.csv`, { type: 'text/csv' });
  if (await deliver(file)) toast('Exported payments');
}

/** Replaces everything on the backend with a backup file, after asking. */
export async function importBackup(repo, file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Nothing changed: this isn’t a Mateen Money backup.');
    return;
  }
  const check = readBackup(data);
  if (!check.ok) { toast(check.message); return; }
  const when = check.exportedAt ? ` from ${formatDay(today(new Date(check.exportedAt)))}` : '';
  const n = check.counts.entries;
  const ok = confirm(`Replace everything on your backend with the backup${when}? It has ${n === 1 ? '1 payment' : `${n.toLocaleString('en-GB')} payments`}. What you’ve logged since is removed.`);
  if (!ok) return;
  if (await runAction(() => repo.restoreBackup(data))) toast('Restored the backup');
}
