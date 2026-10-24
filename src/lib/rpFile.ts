import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { withFingerprints } from '@/lib/fingerprint';
import { makeId } from '@/lib/id';
import { extractMediaUriEntries, type MediaFileKey } from '@/lib/mediaGc';
import type { ProgressUpdate } from '@/lib/progress';
import { migrateProject, relinkUri } from '@/lib/projectUtils';
import { utf8ToBytes } from '@/lib/sha256';
import {
  bytesToUtf8,
  localDataOffset,
  parseCentralDirectory,
  parseEocd,
  ZipStoreWriter,
  type ZipEntry,
} from '@/lib/zipStore';
import { autoRelink, findMissingMedia, type ImportResult } from '@/lib/videdFile';
import type { Project } from '@/types/project';

/**
 * 📦 `.rp` (RemixProject) — a SZABVÁNYOS teljes-projekt csomag (export/import).
 *
 * `fizetett-reklam` projekt → `fizetett-reklam.rp`: szabályos STORE-zip
 * ([zipStore](./zipStore.ts) pure mag) a projekt-tervvel ÉS minden app-tárolt
 * médiafájllal együtt — eszközön készül (ingyen, offline, worker nélkül), és
 * bármely eszközön teljes értékűen visszatölthető. Tartalom:
 *   - `manifest.json` — formátum/verzió + fájl-lista
 *   - `project.json`  — a projekt (fingerprint-ekkel, relink-tartalékként)
 *   - `media/<név>`, `mediacache/<név>` — a hivatkozott fájlok
 * A nagy fájlok CHUNKONKÉNT (FileHandle) folynak át — nincs egyben-memória.
 * A könnyű, média nélküli `.remix` (JSON) formátum változatlanul él mellette.
 */

export const RP_FORMAT = 'remix-project';
export const RP_EXTENSION = '.rp';

/** chunk-méret a stream-másoláshoz */
const CHUNK = 1024 * 1024;
/** zip64 nélkül ez a plafon — fölötte értelmes hibát adunk */
const MAX_PACKAGE_BYTES = 0xfff00000; // ~4 GB

interface RpManifest {
  format: typeof RP_FORMAT;
  version: 1;
  exportedAt: string;
  name: string;
  /** a csomagolt média-bejegyzések (entry-név = mappa/fájlnév) */
  media: string[];
}

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'projekt';
}

function keyString(k: MediaFileKey): string {
  return `${k.dir}/${k.name}`;
}

/** a projektben hivatkozott, LÉTEZŐ app-média fájlok (uri + entry-kulcs + File) */
function collectMediaFiles(project: Project): { uri: string; key: string; file: File }[] {
  const out: { uri: string; key: string; file: File }[] = [];
  const seenKeys = new Set<string>();
  for (const { uri, key } of extractMediaUriEntries(JSON.stringify(project))) {
    const ks = keyString(key);
    if (seenKeys.has(ks)) {
      continue;
    }
    try {
      // a KULCS szerinti aktuális konténer-útvonalon keressük (reinstall-biztos)
      const file = new File(new Directory(Paths.document, key.dir), key.name);
      if (file.exists) {
        seenKeys.add(ks);
        out.push({ uri, key: ks, file });
      }
    } catch {
      // nem elérhető fájl — a manifest/fingerprint relink-tartaléka marad rá
    }
  }
  return out;
}

/**
 * A projekt becsomagolása `.rp` fájlba (cache-be) — a megosztás a hívó dolga,
 * vagy használd a `shareRpFile`-t. Visszaadja a kész fájlt.
 */
export async function exportRpFile(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void,
): Promise<File> {
  if (Platform.OS === 'web') {
    throw new Error(tr('lib.rpFile.nativeOnly'));
  }
  const media = collectMediaFiles(project);
  const totalBytes = media.reduce((s, m) => s + (m.file.size ?? 0), 0);
  if (totalBytes > MAX_PACKAGE_BYTES) {
    throw new Error(tr('lib.rpFile.tooLarge'));
  }

  const out = new File(Paths.cache, `${safeName(project.name)}${RP_EXTENSION}`);
  try {
    if (out.exists) {
      out.delete();
    }
  } catch {
    // felülírjuk
  }
  out.create();
  const handle = out.open(FileMode.ReadWrite);
  const w = new ZipStoreWriter();
  const write = (bytes: Uint8Array) => handle.writeBytes(bytes);

  try {
    const manifest: RpManifest = {
      format: RP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      name: project.name,
      media: media.map((m) => m.key),
    };
    write(w.beginFile('manifest.json'));
    write(w.chunk(utf8ToBytes(JSON.stringify(manifest))));
    write(w.endFile());

    // fingerprint minden assetre — ha egy entry sérülne, a tartalom-relink megfogja
    const payload = { format: RP_FORMAT, version: 1, project: await withFingerprints(project) };
    write(w.beginFile('project.json'));
    write(w.chunk(utf8ToBytes(JSON.stringify(payload))));
    write(w.endFile());

    for (let i = 0; i < media.length; i += 1) {
      const m = media[i];
      onProgress?.({
        phase: tr('lib.rpFile.packingPhase'),
        current: i + 1,
        total: media.length,
        unit: tr('lib.rpFile.fileUnit'),
      });
      write(w.beginFile(m.key));
      const src = m.file.open(FileMode.ReadOnly);
      try {
        const size = m.file.size ?? 0;
        for (let off = 0; off < size; off += CHUNK) {
          write(w.chunk(src.readBytes(Math.min(CHUNK, size - off))));
        }
      } finally {
        src.close();
      }
      write(w.endFile());
    }
    write(w.finish());
  } finally {
    handle.close();
  }
  return out;
}

/** `.rp` export + rendszer-megosztó (ez a szabványos „projekt átadása" út). */
export async function shareRpFile(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void,
): Promise<void> {
  const file = await exportRpFile(project, onProgress);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/zip',
      dialogTitle: file.name,
    });
  }
}

/** egy zip-bejegyzés adatának stream-kimásolása a forrásból egy cél-fájlba */
function extractEntry(src: File, entry: ZipEntry, target: File): void {
  const handle = src.open(FileMode.ReadOnly);
  try {
    handle.offset = entry.headerOffset;
    const header = handle.readBytes(30);
    let offset = localDataOffset(header, entry.headerOffset);
    if (target.exists) {
      target.delete();
    }
    target.create();
    const outHandle = target.open(FileMode.ReadWrite);
    try {
      let remaining = entry.size;
      while (remaining > 0) {
        handle.offset = offset;
        const part = handle.readBytes(Math.min(CHUNK, remaining));
        outHandle.writeBytes(part);
        offset += part.length;
        remaining -= part.length;
        if (part.length === 0) {
          throw new Error(tr('lib.rpFile.corrupt'));
        }
      }
    } finally {
      outHandle.close();
    }
  } finally {
    handle.close();
  }
}

/** egy KICSI bejegyzés (json) tartalma memóriába */
function readEntryBytes(src: File, entry: ZipEntry): Uint8Array {
  const handle = src.open(FileMode.ReadOnly);
  try {
    handle.offset = entry.headerOffset;
    const header = handle.readBytes(30);
    handle.offset = localDataOffset(header, entry.headerOffset);
    return handle.readBytes(entry.size);
  } finally {
    handle.close();
  }
}

/**
 * `.rp` csomag importja: média-fájlok kibontása az app tárába (`document/media`,
 * `document/mediacache`), a projekt URI-jainak átírása az új helyre, ÚJ
 * projekt-azonosító. A mentés a hívó dolga (mint a `.remix`-importnál).
 * Név-ütközésnél: azonos méretű meglévő fájl ÚJRAHASZNÁLÓDIK (dedup), eltérő
 * tartalomnál a bejövő új, előtagolt nevet kap.
 */
/** A csomag bejegyzés-listája (EOCD a fájl végéről, majd a central directory). */
function readRpEntries(src: File): ZipEntry[] {
  const size = src.size ?? 0;
  if (size < 22) {
    throw new Error(tr('lib.rpFile.corrupt'));
  }
  const srcHandle = src.open(FileMode.ReadOnly);
  let entries: ZipEntry[];
  try {
    const tailLen = Math.min(size, 64 * 1024);
    srcHandle.offset = size - tailLen;
    const eocd = parseEocd(srcHandle.readBytes(tailLen), size - tailLen);
    if (!eocd) {
      throw new Error(tr('lib.rpFile.corrupt'));
    }
    srcHandle.offset = eocd.cdOffset;
    entries = parseCentralDirectory(srcHandle.readBytes(eocd.cdSize), eocd.count);
  } finally {
    srcHandle.close();
  }
  if (entries.some((e) => e.method !== 0)) {
    throw new Error(tr('lib.rpFile.unsupportedCompression'));
  }
  return entries;
}

/** egy média-entry kibontása az app tárába (dedup/átnevezés) → entry-név + új uri */
function extractMediaEntryToStore(src: File, entry: ZipEntry): { key: string; uri: string } | null {
  const slash = entry.name.indexOf('/');
  const dirName = entry.name.slice(0, slash);
  const fileName = entry.name.slice(slash + 1);
  if (!fileName || fileName.includes('/') || fileName.includes('..')) {
    return null; // védekezés a kitörős entry-nevek ellen
  }
  const dir = new Directory(Paths.document, dirName);
  if (!dir.exists) {
    dir.create();
  }
  let target = new File(dir, fileName);
  if (target.exists && target.size === entry.size) {
    // dedup: azonos nevű+méretű fájl már itt van (pl. visszaimport ugyanarra az eszközre)
    return { key: entry.name, uri: target.uri };
  }
  if (target.exists) {
    target = new File(dir, `${Date.now().toString(36)}_${fileName}`);
  }
  extractEntry(src, entry, target);
  return { key: entry.name, uri: target.uri };
}

/** a csomag média-bejegyzései (a szelektív visszaállítás listájához) */
export interface RpMediaEntry {
  /** entry-név: `media/<fájlnév>` vagy `mediacache/<fájlnév>` */
  name: string;
  /** fájlnév (megjelenítéshez) */
  fileName: string;
  size: number;
}

/** 🎯 A `.rp` csomag média-fájljainak listája — kibontás NÉLKÜL (gyors: central directory). */
export function listRpMediaEntries(uri: string): RpMediaEntry[] {
  const entries = readRpEntries(new File(uri));
  return entries
    .filter((e) => e.name.startsWith('media/') || e.name.startsWith('mediacache/'))
    .map((e) => ({ name: e.name, fileName: e.name.slice(e.name.indexOf('/') + 1), size: e.size }));
}

/**
 * 🎯 KIVÁLASZTOTT fájlok visszaállítása egy `.rp` csomagból (pl. Drive-ra mentett
 * csomagból 1-1 fájl) — a teljes projekt importja NÉLKÜL. A fájl az app tárába
 * kerül (dedup/átnevezés az importtal azonosan); entry-név → új uri térkép.
 */
export function extractRpMediaSelected(uri: string, names: readonly string[]): Map<string, string> {
  const src = new File(uri);
  const wanted = new Set(names);
  const out = new Map<string, string>();
  for (const entry of readRpEntries(src)) {
    if (!wanted.has(entry.name)) {
      continue;
    }
    const res = extractMediaEntryToStore(src, entry);
    if (res) {
      out.set(res.key, res.uri);
    }
  }
  return out;
}

/**
 * 📲 FELHŐ NÉLKÜLI eszközváltás: a projekt-terv (JSON) ingyen szinkronizál, a
 * médiát pedig a másik eszközről áthozott `.rp` csomag adja — ez a gazdaságos út
 * (AirDrop / Fájlok / saját Drive, nulla szerver-költség). Ez a helper a MÁSIK
 * eszközön kiválasztott `.rp`-ből PONT a hiányzó fájlokat köti vissza:
 * kulcs-egyezés (media/<név>) alapján bont ki, és relink-párokat ad — a hívó a
 * command-buson viszi át (undo-safe). `null` = a user mégsem választott fájlt.
 */
export interface RpRestoreOutcome {
  pairs: { oldUri: string; newUri: string }[];
  matched: number;
}

/** A megadott .rp-ből PONT a projekt hiányzó/app-média hivatkozásait pótolja. */
export function restoreMissingFromRpUri(project: Project, rpUri: string): RpRestoreOutcome {
  const available = new Set(listRpMediaEntries(rpUri).map((e) => e.name));
  // a projekt app-média hivatkozásai → melyik entry fedi őket
  const wanted: { oldUri: string; entry: string }[] = [];
  for (const { uri, key } of extractMediaUriEntries(JSON.stringify(project))) {
    const entry = `${key.dir}/${key.name}`;
    if (available.has(entry)) {
      wanted.push({ oldUri: uri, entry });
    }
  }
  if (wanted.length === 0) {
    return { pairs: [], matched: 0 };
  }
  const restored = extractRpMediaSelected(rpUri, wanted.map((w) => w.entry));
  const pairs = wanted
    .map((w) => ({ oldUri: w.oldUri, newUri: restored.get(w.entry) ?? '' }))
    .filter((p) => p.newUri && p.newUri !== p.oldUri);
  return { pairs, matched: restored.size };
}

export async function pickAndRestoreMissingFromRp(
  project: Project,
): Promise<RpRestoreOutcome | null> {
  const DocumentPicker = await import('expo-document-picker');
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: ['application/zip', 'application/octet-stream', '*/*'],
  });
  if (picked.canceled || picked.assets.length === 0) {
    return null;
  }
  return restoreMissingFromRpUri(project, picked.assets[0].uri);
}

export async function importRpFromUri(
  uri: string,
  onProgress?: (u: ProgressUpdate) => void,
): Promise<ImportResult> {
  const src = new File(uri);
  const entries = readRpEntries(src);

  const projectEntry = entries.find((e) => e.name === 'project.json');
  if (!projectEntry) {
    throw new Error(tr('lib.rpFile.invalidPackage'));
  }
  const parsed: unknown = JSON.parse(bytesToUtf8(readEntryBytes(src, projectEntry)));
  const rawProject = (parsed as { project?: Project })?.project;
  if (!rawProject || !Array.isArray(rawProject.tracks)) {
    throw new Error(tr('lib.rpFile.invalidPackage'));
  }
  let project = migrateProject(rawProject);

  // média-kibontás + kulcs → új uri térkép
  const mediaEntries = entries.filter(
    (e) => e.name.startsWith('media/') || e.name.startsWith('mediacache/'),
  );
  const newUriByKey = new Map<string, string>();
  for (let i = 0; i < mediaEntries.length; i += 1) {
    const entry = mediaEntries[i];
    onProgress?.({
      phase: tr('lib.rpFile.unpackingPhase'),
      current: i + 1,
      total: mediaEntries.length,
      unit: tr('lib.rpFile.fileUnit'),
    });
    const res = extractMediaEntryToStore(src, entry);
    if (res) {
      newUriByKey.set(res.key, res.uri);
    }
  }

  // URI-átírás: minden app-média hivatkozás az ÚJ helyre (konténer-független kulcs szerint)
  for (const { uri: oldUri, key } of extractMediaUriEntries(JSON.stringify(project))) {
    const next = newUriByKey.get(keyString(key));
    if (next && next !== oldUri) {
      project = relinkUri(project, oldUri, next);
    }
  }

  const now = new Date().toISOString();
  const imported: Project = { ...project, id: makeId('prj'), createdAt: now, updatedAt: now };
  // tartalom-alapú relink-tartalék a maradékra (fingerprintek a project.json-ban)
  const relink = await autoRelink(imported, findMissingMedia(imported));
  return { project: relink.project, missing: relink.missing, relinked: relink.relinked };
}
