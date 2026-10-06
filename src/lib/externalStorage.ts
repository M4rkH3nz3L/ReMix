import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { cloudBaseUrl } from '@/lib/backend';
import { asRecord, boolOr, finiteTime, mapValid, str } from '@/lib/parseGuards';
import type { StorageEntry } from '@/lib/storageProviders';
import { workerAuthHeaders, workerJsonHeaders } from '@/lib/workerAuth';

/**
 * 🔌 Külső tárhely-szolgáltatók kliens-rétege — a user SAJÁT felhőjének (Google
 * Drive / Dropbox / WebDAV / S3) bekötése, listázása, leválasztása.
 *
 * A hitelesítés (OAuth token / kulcs) a WORKEREN marad (`user_storage_providers`,
 * service_role) — a kliens sosem látja, csak a proxyzott `/storage/*` végpontokat
 * hívja a bejelentkezett user tokenjével. Az itt bekötött forrás a Tár panelen
 * (LibraryPanel) forrásként megjelenik, és a projektekben használható; a rajta
 * fekvő média NEM terheli a kvótánkat (lásd `@/lib/storageQuota`).
 */

export type ExternalProviderType = 'gdrive' | 'dropbox' | 'webdav' | 's3';

export interface ConnectedProvider {
  id: string;
  label: string;
  type: ExternalProviderType;
  status: string;
  /** ez az AKTÍV tárhely-cél (ide ment minden studio, és innen olvas vissza) */
  isDefault: boolean;
}

/** A választható szolgáltatók a profil-UI-hoz (oauth = böngészős bekötés). */
export const EXTERNAL_PROVIDERS: {
  type: ExternalProviderType;
  label: string;
  oauth: boolean;
  icon: string;
}[] = [
  { type: 'gdrive', label: 'Google Drive', oauth: true, icon: 'logo-google' },
  { type: 'dropbox', label: 'Dropbox', oauth: true, icon: 'logo-dropbox' },
  { type: 'webdav', label: 'WebDAV / NAS', oauth: false, icon: 'server-outline' },
  { type: 's3', label: 'S3 / MinIO / R2', oauth: false, icon: 'cloud-outline' },
];

async function readError(res: Response, fallback: string): Promise<string> {
  const body = asRecord(await res.json().catch(() => null));
  return str(body?.error) || fallback;
}

// 🛡️ §12.1: a worker-válaszok TARTALOM-validálása (az alak-ellenőrzés + `as T` cast
// helyett). A hibás elem kiesik, a jó megmarad; null/nem-objektum válasz sem omlik.

/** Egy bekötött szolgáltató a /storage/connected válaszból (id+type kötelező). */
function parseProvider(o: Record<string, unknown>): ConnectedProvider | null {
  const id = str(o.id);
  const type = str(o.type);
  if (!id || !type) {
    return null;
  }
  return {
    id,
    label: str(o.label) ?? '',
    type: type as ExternalProviderType,
    status: str(o.status) ?? '',
    isDefault: boolOr(o.isDefault, false),
  };
}

/** A /storage/connected válaszából a bekötött források (null/hibás alak → []). */
export function parseConnectedProviders(raw: unknown): ConnectedProvider[] {
  const o = asRecord(raw);
  return o ? mapValid(o.providers, parseProvider) : [];
}

/** Egy tárhely-bejegyzés (id/name/url/kind kötelező; duration/size/path opcionális). */
function parseEntry(o: Record<string, unknown>): StorageEntry | null {
  const id = str(o.id);
  const name = str(o.name);
  const url = str(o.url);
  const kind = str(o.kind);
  if (!id || !name || !url || (kind !== 'video' && kind !== 'image' && kind !== 'audio')) {
    return null;
  }
  const entry: StorageEntry = { id, name, url, kind };
  const duration = finiteTime(o.duration);
  if (duration !== null) {
    entry.duration = duration;
  }
  const size = finiteTime(o.size);
  if (size !== null) {
    entry.size = size;
  }
  const path = str(o.path);
  if (path) {
    entry.path = path;
  }
  return entry;
}

/** A /storage/:id/list válaszából a tárolt fájlok (null/hibás alak → []). */
export function parseStorageEntries(raw: unknown): StorageEntry[] {
  const o = asRecord(raw);
  return o ? mapValid(o.entries, parseEntry) : [];
}

/** A user bekötött külső forrásai (a profil-kezeléshez). */
export async function fetchConnectedProviders(): Promise<ConnectedProvider[]> {
  const res = await fetch(`${cloudBaseUrl()}/storage/connected`, {
    headers: await workerAuthHeaders(),
  });
  if (!res.ok) {
    return [];
  }
  return parseConnectedProviders(await res.json().catch(() => null));
}

/**
 * OAuth-szolgáltató (Drive/Dropbox) bekötése: a worker ad egy authorize-URL-t,
 * amit böngészőben megnyitunk; a callback a workeren tárolja a tokent. `true`, ha
 * a folyamat sikeresen visszatért.
 */
export async function connectOAuthProvider(provider: 'gdrive' | 'dropbox'): Promise<boolean> {
  const returnUrl = Linking.createURL('storage/connected');
  const res = await fetch(`${cloudBaseUrl()}/storage/oauth/${provider}/start`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ returnUrl }),
  });
  const body = asRecord(await res.json().catch(() => null));
  const url = str(body?.url);
  if (!res.ok || !url) {
    throw new Error(str(body?.error) || 'oauth_start_failed');
  }
  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
  return result.type === 'success';
}

/** Manuális forrás (WebDAV/S3): a kulcsokat a kliens küldi, a workeren tárolódik. */
export async function connectManualProvider(
  type: 'webdav' | 's3',
  label: string,
  config: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/storage/connect`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ type, label, config }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'connect_failed'));
  }
}

/**
 * Az AKTÍV tárhely-cél beállítása: melyik bekötött forrásba mentsen minden studio
 * (és honnan olvasson vissza). `null` → a ReMix-tárhely (alap).
 */
export async function setDefaultStorage(sourceId: string | null): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/storage/default`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ sourceId }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'set_default_failed'));
  }
}

/** Forrás leválasztása (a tokent/kulcsot a worker törli). */
export async function disconnectProvider(id: string): Promise<void> {
  const res = await fetch(`${cloudBaseUrl()}/storage/${encodeURIComponent(id)}/disconnect`, {
    method: 'POST',
    headers: await workerAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(await readError(res, 'disconnect_failed'));
  }
}

/** Egy forráson tárolt média-fájlok (a profilon „mi van ott" nézethez). */
export async function listProviderFiles(id: string): Promise<StorageEntry[]> {
  const res = await fetch(`${cloudBaseUrl()}/storage/${encodeURIComponent(id)}/list`, {
    headers: await workerAuthHeaders(),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(str(asRecord(raw)?.error) || 'list_failed');
  }
  return parseStorageEntries(raw);
}
