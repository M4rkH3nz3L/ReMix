import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { cloudBaseUrl } from '@/lib/backend';
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
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error || fallback;
}

/** A user bekötött külső forrásai (a profil-kezeléshez). */
export async function fetchConnectedProviders(): Promise<ConnectedProvider[]> {
  const res = await fetch(`${cloudBaseUrl()}/storage/connected`, {
    headers: await workerAuthHeaders(),
  });
  if (!res.ok) {
    return [];
  }
  const body = (await res.json()) as { providers?: ConnectedProvider[] };
  return body.providers ?? [];
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
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) {
    throw new Error(body.error || 'oauth_start_failed');
  }
  const result = await WebBrowser.openAuthSessionAsync(body.url, returnUrl);
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
  const body = (await res.json().catch(() => ({}))) as { entries?: StorageEntry[]; error?: string };
  if (!res.ok) {
    throw new Error(body.error || 'list_failed');
  }
  return body.entries ?? [];
}
