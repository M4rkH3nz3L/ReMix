import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { BUILD_ENGINES, type CatalogRuntime } from '@/lib/modelCatalog';
import { executorchEngineAvailable, whisperEngineAvailable } from '@/lib/nativeEngines';
import {
  planModelEviction,
  verifyChecksum,
  type CachedModel,
  type ModelManifestEntry,
} from '@/lib/modelRegistry';
import { Sha256 } from '@/lib/sha256';

/**
 * 📦 Modell-registry kliens (Ai §06.2) — a tiszta manifest-logika
 * ([modelRegistry](./modelRegistry.ts)) FS-oldala: checksum-ellenőrzött letöltés,
 * lemez-cache (`document/models/`), index-nyilvántartás, smoke-test állapot
 * (local-ai 5.3) és LRU-eviction végrehajtás (BP-2).
 *
 * Szabályok:
 *  - sha256-eltérés → a fájl TÖRLŐDIK, nem kerül használatba (nincs „majdnem jó").
 *  - a cache a letöltött fájl VALÓS méretét tartja nyilván (a manifest-méret közelítő).
 *  - letöltött ≠ használható: a smoke-test PASS-ig a katalógus-státusz 'downloaded'.
 *  - weben nincs natív FS → minden művelet üres/No-op eredménnyel tér vissza.
 */

/** cache-limit (BP-2): e fölött a legrégebben használt, nem pinned modell repül */
export const MODEL_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/** az index egy sora: a pure `CachedModel` + fájlnév + smoke-állapot */
export interface CachedModelRecord extends CachedModel {
  file: string;
  smoke?: 'pass' | 'fail';
}

export type DownloadResult =
  | { ok: true; uri: string; sizeBytes: number }
  | { ok: false; reason: 'web' | 'network' | 'checksum' | 'fs' };

function modelsDir(): Directory {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

function indexFile(): File {
  return new File(modelsDir(), 'index.json');
}

function readIndex(): CachedModelRecord[] {
  try {
    const f = indexFile();
    if (!f.exists) {
      return [];
    }
    const parsed: unknown = JSON.parse(f.textSync());
    return Array.isArray(parsed) ? (parsed as CachedModelRecord[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(records: CachedModelRecord[]): void {
  const f = indexFile();
  if (!f.exists) {
    f.create();
  }
  f.write(JSON.stringify(records));
}

/** A cache-elt modellek nyilvántartása (weben üres). */
export function listCachedModels(): CachedModelRecord[] {
  if (Platform.OS === 'web') {
    return [];
  }
  return readIndex();
}

/** A letöltött modell-fájl uri-ja, vagy null (nincs letöltve / web). */
export function modelFileUri(id: string): string | null {
  if (Platform.OS === 'web') {
    return null;
  }
  const rec = readIndex().find((r) => r.id === id);
  if (!rec) {
    return null;
  }
  const f = new File(modelsDir(), rec.file);
  return f.exists ? f.uri : null;
}

function deleteRecordFile(rec: CachedModelRecord): void {
  try {
    const f = new File(modelsDir(), rec.file);
    if (f.exists) {
      f.delete();
    }
  } catch {
    // a fájl hiánya nem hiba — az index-sor így is törlődik
  }
}

/** Modell törlése (fájl + index-sor). */
export function removeModel(id: string): void {
  if (Platform.OS === 'web') {
    return;
  }
  const records = readIndex();
  const rec = records.find((r) => r.id === id);
  if (rec) {
    deleteRecordFile(rec);
  }
  writeIndex(records.filter((r) => r.id !== id));
}

/** LRU + byte-cap eviction végrehajtása a pure terv alapján. */
export function runEviction(maxBytes: number = MODEL_CACHE_MAX_BYTES): string[] {
  if (Platform.OS === 'web') {
    return [];
  }
  const records = readIndex();
  const plan = planModelEviction(records, { maxBytes });
  if (plan.length === 0) {
    return [];
  }
  const evictIds = new Set(plan.map((m) => m.id));
  for (const rec of records) {
    if (evictIds.has(rec.id)) {
      deleteRecordFile(rec);
    }
  }
  writeIndex(records.filter((r) => !evictIds.has(r.id)));
  return [...evictIds];
}

/**
 * Modell letöltése checksum-ellenőrzéssel. A hash a memóriában lévő bufferen
 * darabonként számolódik (Sha256.update) — a mostani modellek (≤~100 MB) egyben
 * leférnek; a nagy SLM-ekhez (GB-os) a letöltés stream-elése külön lépés lesz
 * (a hash-oldal már most inkrementális).
 */
export async function downloadModel(entry: ModelManifestEntry): Promise<DownloadResult> {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web' };
  }
  let bytes: Uint8Array;
  try {
    const res = await fetch(entry.url);
    if (!res.ok) {
      return { ok: false, reason: 'network' };
    }
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return { ok: false, reason: 'network' };
  }

  // 🔐 BP-2: checksum-eltérés → elutasítás, a tartalom nem ér lemezt
  const hash = new Sha256();
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    hash.update(bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  if (!verifyChecksum(entry.sha256, hash.digestHex())) {
    return { ok: false, reason: 'checksum' };
  }

  try {
    const fileName = `${entry.id}-${entry.version}.bin`;
    const target = new File(modelsDir(), fileName);
    if (!target.exists) {
      target.create();
    }
    target.write(bytes);

    const records = readIndex().filter((r) => r.id !== entry.id);
    // frissítéskor a régi verzió fájlja nem maradhat árván
    const old = readIndex().find((r) => r.id === entry.id);
    if (old && old.file !== fileName) {
      deleteRecordFile(old);
    }
    records.push({
      id: entry.id,
      version: entry.version,
      sizeBytes: bytes.length, // a VALÓS méret (nem a manifest közelítése)
      lastUsedMs: Date.now(),
      file: fileName,
      // új letöltés → a korábbi smoke-eredmény nem érvényes (local-ai 5.3)
    });
    writeIndex(records);
    runEviction();
    return { ok: true, uri: target.uri, sizeBytes: bytes.length };
  } catch {
    return { ok: false, reason: 'fs' };
  }
}

/** Használat-előtti smoke-test eredménye (local-ai 5.3): PASS-ig nem használható. */
export function setModelSmokeResult(id: string, result: 'pass' | 'fail'): void {
  if (Platform.OS === 'web') {
    return;
  }
  writeIndex(readIndex().map((r) => (r.id === id ? { ...r, smoke: result } : r)));
}

/** Használat-jelzés az LRU-hoz (betöltéskor hívandó). */
export function markModelUsed(id: string): void {
  if (Platform.OS === 'web') {
    return;
  }
  writeIndex(readIndex().map((r) => (r.id === id ? { ...r, lastUsedMs: Date.now() } : r)));
}

/** A katalógus futásidejű állapota (a Profil-kártya + a deviceCaps bemenete). */
export function catalogRuntime(): CatalogRuntime {
  const records = listCachedModels();
  const smoke: Record<string, 'pass' | 'fail'> = {};
  for (const r of records) {
    if (r.smoke) {
      smoke[r.id] = r.smoke;
    }
  }
  return {
    // a motor-jelenlét VALÓS runtime-detektálás: a npm-csomag megléte ≠ natív
    // modul — új dev-buildig a TurboModule hiányzik → engine_missing (őszinte)
    engines: {
      ...BUILD_ENGINES,
      'whisper-rn': whisperEngineAvailable(),
      executorch: executorchEngineAvailable(),
    },
    downloaded: records.map((r) => r.id),
    smoke,
  };
}

/** A cache összmérete bájtban (a Profil tárhely-összegzőjéhez). */
export function cachedModelsTotalBytes(): number {
  return listCachedModels().reduce((s, r) => s + Math.max(0, r.sizeBytes ?? 0), 0);
}
