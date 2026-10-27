import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

import { cloudBaseUrl } from '@/lib/backend';
import { type StorageEntry, joinPath, parentPath } from '@/lib/remixFiles';
import { workerAuthHeaders, workerJsonHeaders } from '@/lib/workerAuth';

/**
 * 🗂️ Tárhelyem — a két első hely kliense:
 *  - **Eszközöm**: az app saját, felhasználó által kezelt mappája a telefonon
 *    (`Paths.document/Files`) — offline, ingyenes, nem terheli a felhő-kvótát.
 *    (A rendszer-fájlválasztón át BEhozott fájlok ide másolódnak: iOS/Android a
 *    teljes készüléktárat nem adja oda, csak a kiválasztott fájlt.)
 *  - **ReMix Storage**: a worker `/files/*` végpontjai (élesben Cloudflare R2),
 *    a meglévő tárhely-kvótára terhelve. Publikus URL nincs: a letöltés is
 *    hitelesített proxyn megy.
 *
 * A pure logika (rendezés/szűrés/név-ellenőrzés) a `remixFiles.ts`-ben él.
 */

/** A worker hibája kóddal (`quota_exceeded`, `checksum_mismatch`, `exists` …) → a UI i18n-kulcsa. */
export class RemixFilesError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'RemixFilesError';
  }
}

async function failFrom(res: { status: number; text: () => Promise<string> }): Promise<never> {
  let code = 'failed';
  let message = `HTTP ${res.status}`;
  try {
    const body = JSON.parse(await res.text()) as { error?: string; code?: string };
    code = body.code ?? (res.status === 507 ? 'quota_exceeded' : code);
    message = body.error ?? message;
  } catch {
    // nem JSON → a státusz marad
  }
  throw new RemixFilesError(code, res.status, message);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${cloudBaseUrl()}${path}`, init);
  if (!res.ok) {
    await failFrom(res);
  }
  return (await res.json()) as T;
}

const post = async <T>(path: string, body: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', headers: await workerJsonHeaders(), body: JSON.stringify(body) });

// ── ReMix Storage (felhő / R2) ────────────────────────────────────────────────

interface ListResponse {
  path: string;
  folders: { name: string; path: string }[];
  files: { name: string; path: string; size: number; modified: string | null }[];
}

export async function remixList(dir: string): Promise<StorageEntry[]> {
  const data = await call<ListResponse>(`/files/list?path=${encodeURIComponent(dir)}`, {
    headers: await workerAuthHeaders(),
  });
  return [
    ...data.folders.map((f) => ({ location: 'remix' as const, path: f.path, name: f.name, isFolder: true })),
    ...data.files.map((f) => ({
      location: 'remix' as const,
      path: f.path,
      name: f.name,
      isFolder: false,
      size: f.size,
      modified: f.modified,
    })),
  ];
}

export async function remixMkdir(dir: string, name: string): Promise<void> {
  await post('/files/folder', { path: dir, name: name.trim() });
}

export async function remixDelete(paths: string[]): Promise<{ removed: number; bytes: number }> {
  return post('/files/delete', { paths });
}

export async function remixMove(from: string, to: string): Promise<void> {
  await post('/files/move', { from, to });
}

/**
 * Feltöltés a ReMix Storage `dir` mappájába, haladás-jelzéssel. Az MD5-öt az
 * eszköz számolja, a worker ellenőrzi (sérült átvitel → `checksum_mismatch`), és
 * ugyanazt a fájlt újrapróbálva nem keletkezik duplikátum.
 */
export async function remixUpload(
  uri: string,
  dir: string,
  name: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<{ name: string; path: string; size: number; deduplicated: boolean }> {
  const file = new File(uri);
  const md5 = file.info({ md5: true }).md5 ?? '';
  const res = await file.upload(`${cloudBaseUrl()}/files/upload`, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'media',
    headers: await workerAuthHeaders(),
    parameters: { path: dir, name, ...(md5 ? { md5 } : {}) },
    onProgress: onProgress
      ? ({ bytesSent, totalBytes }) => onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0)
      : undefined,
    signal,
  });
  if (res.status < 200 || res.status >= 300) {
    await failFrom({ status: res.status, text: async () => res.body });
  }
  return JSON.parse(res.body);
}

/** Letöltés a felhőből az Eszközöm mappájába (`deviceDir`); a végleges eszköz-utat adja. */
export async function remixDownloadToDevice(
  path: string,
  deviceDir: string,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dir = deviceDirectory(deviceDir);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const finalName = freeName(dir, name);
  const target = new File(dir, finalName);
  // a részleges letöltés ne maradjon „kész" fájlként: ideiglenes névre, majd átnevezés
  const partial = new File(dir, `${finalName}.part`);
  try {
    await File.downloadFileAsync(`${cloudBaseUrl()}/files/download?path=${encodeURIComponent(path)}`, partial, {
      headers: await workerAuthHeaders(),
      idempotent: true,
      onProgress: onProgress
        ? ({ bytesWritten, totalBytes }) => onProgress(totalBytes > 0 ? bytesWritten / totalBytes : 0)
        : undefined,
    });
    partial.rename(finalName);
  } catch (err) {
    if (partial.exists) {
      partial.delete();
    }
    throw err;
  }
  return joinPath(deviceDir, target.name);
}

// ── Eszközöm (a telefon) ──────────────────────────────────────────────────────

/** Az Eszközöm gyökere (létrehozza, ha még nincs). */
export function deviceRoot(): Directory {
  const root = new Directory(Paths.document, 'Files');
  if (!root.exists) {
    root.create({ intermediates: true, idempotent: true });
  }
  return root;
}

function deviceDirectory(dir: string): Directory {
  return dir ? new Directory(deviceRoot(), ...dir.split('/')) : deviceRoot();
}

function deviceNode(path: string): File | Directory {
  const parent = deviceDirectory(parentPath(path));
  const name = path.slice(path.lastIndexOf('/') + 1);
  const asDir = new Directory(parent, name);
  return asDir.exists ? asDir : new File(parent, name);
}

/** Szabad név a mappában: `a.mp4` → `a (1).mp4` … (a szerver `nextFreeName` tükre). */
function freeName(dir: Directory, name: string): string {
  const taken = new Set(dir.list().map((n) => n.name));
  if (!taken.has(name)) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  while (taken.has(`${stem} (${i})${ext}`)) {
    i++;
  }
  return `${stem} (${i})${ext}`;
}

export function deviceList(dir: string): StorageEntry[] {
  const d = deviceDirectory(dir);
  if (!d.exists) {
    return [];
  }
  return d
    .list()
    .filter((n) => !n.name.endsWith('.part'))
    .map((n) => {
      if (n instanceof Directory) {
        return { location: 'device' as const, path: joinPath(dir, n.name), name: n.name, isFolder: true, uri: n.uri };
      }
      const info = n.info();
      return {
        location: 'device' as const,
        path: joinPath(dir, n.name),
        name: n.name,
        isFolder: false,
        size: info.size ?? n.size,
        modified: info.modificationTime ? new Date(info.modificationTime).toISOString() : null,
        uri: n.uri,
      };
    });
}

export function deviceMkdir(dir: string, name: string): void {
  const d = new Directory(deviceDirectory(dir), name.trim());
  if (d.exists) {
    throw new RemixFilesError('exists', 409, 'exists');
  }
  d.create({ intermediates: true });
}

export function deviceDelete(paths: string[]): void {
  for (const p of paths) {
    const node = deviceNode(p);
    if (node.exists) {
      node.delete();
    }
  }
}

export function deviceRename(path: string, newName: string): void {
  const parent = deviceDirectory(parentPath(path));
  const taken = new Set(parent.list().map((n) => n.name));
  if (taken.has(newName.trim())) {
    throw new RemixFilesError('exists', 409, 'exists');
  }
  deviceNode(path).rename(newName.trim());
}

/** A rendszer fájlválasztójával kiválasztott fájlok bemásolása a `dir` mappába. */
export async function deviceImport(dir: string): Promise<number> {
  const picked = await File.pickFileAsync({ multipleFiles: true });
  if (picked.canceled) {
    return 0;
  }
  const target = deviceDirectory(dir);
  for (const f of picked.result) {
    await f.copy(new File(target, freeName(target, f.name)));
  }
  return picked.result.length;
}

/** A natív uri (megosztáshoz / feltöltéshez). */
export function deviceUri(path: string): string {
  return deviceNode(path).uri;
}

/** Szabad/teljes hely a készüléken (bájt) — a feltöltés/letöltés előtti becsléshez. */
export function deviceSpace(): { free: number; total: number } {
  if (Platform.OS === 'web') {
    return { free: 0, total: 0 };
  }
  return { free: Paths.availableDiskSpace, total: Paths.totalDiskSpace };
}

/** Az Eszközöm mappa teljes mérete (rekurzív). */
export function deviceUsedBytes(): number {
  const walk = (d: Directory): number =>
    d.list().reduce((sum, n) => sum + (n instanceof Directory ? walk(n) : (n.size ?? 0)), 0);
  return walk(deviceRoot());
}
