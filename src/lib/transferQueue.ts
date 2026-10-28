import AsyncStorage from '@react-native-async-storage/async-storage';
import { t as tr } from 'i18next';
import { useSyncExternalStore } from 'react';

import { RemixFilesError, remixDownloadToDevice, remixUpload } from '@/lib/remixFilesClient';

/**
 * 🔁 A Tárhelyem átviteli sora (Sync Center csírája) — KÉPERNYŐ-FÜGGETLEN modul:
 * a sor akkor is fut, ha a user elnavigál, és TARTÓS (AsyncStorage) — app-
 * újraindítás után a félbemaradt (`active`) elem újra `pending` lesz és folytatódik.
 * Soros (egyszerre egy), újrapróbálható; a „kész" csak a szerver ellenőrzött
 * válasza után (MD5 + cél-HEAD) jelenik meg.
 */

export interface Transfer {
  id: string;
  direction: 'up' | 'down';
  name: string;
  /** feltöltésnél az eszköz-uri, letöltésnél a felhő-út */
  source: string;
  /** feltöltésnél a felhő-mappa, letöltésnél az eszköz-mappa */
  targetDir: string;
  progress: number;
  status: 'pending' | 'active' | 'done' | 'failed';
  error?: string;
  /** a szerver felismerte, hogy már fent van (idempotens újrapróbálás) */
  deduplicated?: boolean;
}

const KEY = 'remix.transfers.v1';
/** a kész elemekből ennyit őrzünk meg a listában */
const KEEP_DONE = 30;

let items: Transfer[] = [];
let hydrated = false;
let running = false;
const listeners = new Set<() => void>();
const doneListeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const done = items.filter((x) => x.status === 'done').slice(-KEEP_DONE);
    const keep = items.filter((x) => x.status !== 'done' || done.includes(x));
    void AsyncStorage.setItem(KEY, JSON.stringify(keep.map((x) => ({ ...x, progress: 0 })))).catch(() => {});
  }, 300);
}

function set(next: Transfer[], save = true): void {
  items = next;
  emit();
  if (save) {
    persist();
  }
}

function patch(id: string, p: Partial<Transfer>, save = true): void {
  set(
    items.map((x) => (x.id === id ? { ...x, ...p } : x)),
    save
  );
}

/** A tárolt sor visszatöltése (egyszer) + a folytatás indítása. */
export async function hydrateTransfers(): Promise<void> {
  if (hydrated) {
    return;
  }
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Transfer[]) : [];
    // a félbemaradt elem újra várakozik (megszakítás utáni folytatás)
    const restored = saved.map((x) => (x.status === 'active' ? { ...x, status: 'pending' as const, progress: 0 } : x));
    set([...restored, ...items.filter((x) => !restored.some((r) => r.id === x.id))], false);
  } catch {
    // sérült tár → üres sor
  }
  pump();
}

function errorText(err: unknown): string {
  if (err instanceof RemixFilesError) {
    return tr(`storage.errors.${err.code}`, { defaultValue: err.message });
  }
  return err instanceof Error ? err.message : String(err);
}

/** A következő várakozó elem indítása (soros). */
function pump(): void {
  if (running) {
    return;
  }
  const next = items.find((x) => x.status === 'pending');
  if (!next) {
    return;
  }
  running = true;
  patch(next.id, { status: 'active', progress: 0, error: undefined });
  // a haladás nem kerül a tárba (sűrű frissítés) — csak az állapotváltások
  const onProgress = (f: number) => patch(next.id, { progress: f }, false);
  const job =
    next.direction === 'up'
      ? remixUpload(next.source, next.targetDir, next.name, onProgress).then((r) => r.deduplicated)
      : remixDownloadToDevice(next.source, next.targetDir, onProgress).then(() => false);
  job
    .then((deduplicated) => patch(next.id, { status: 'done', progress: 1, deduplicated }))
    .catch((err) => patch(next.id, { status: 'failed', error: errorText(err) }))
    .finally(() => {
      running = false;
      doneListeners.forEach((l) => l());
      pump();
    });
}

export function enqueueTransfers(list: Omit<Transfer, 'id' | 'progress' | 'status'>[]): void {
  if (!list.length) {
    return;
  }
  set([
    ...items,
    ...list.map((it, i) => ({
      ...it,
      id: `${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      progress: 0,
      status: 'pending' as const,
    })),
  ]);
  void hydrateTransfers().then(pump);
}

export function retryTransfer(id: string): void {
  patch(id, { status: 'pending', progress: 0, error: undefined });
  pump();
}

export function clearFinishedTransfers(): void {
  set(items.filter((x) => x.status !== 'done'));
}

/** Értesítés minden befejezett (kész/sikertelen) átvitel után — pl. lista-frissítéshez. */
export function onTransferSettled(cb: () => void): () => void {
  doneListeners.add(cb);
  return () => doneListeners.delete(cb);
}

/** A sor (React hook); az első használat visszatölti a tárolt sort és folytatja. */
export function useTransfers(): Transfer[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      void hydrateTransfers();
      return () => listeners.delete(cb);
    },
    () => items
  );
}
