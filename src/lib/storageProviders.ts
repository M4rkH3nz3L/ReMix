import { Directory, File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { renderServerUrl } from '@/lib/render';
import type { Asset } from '@/types/project';

/**
 * StorageProvider-réteg (full-plan F2): a média bárhol lehet — a szerkesztő a
 * Gateway-en át listáz és old fel helyi uri-ra. Minden forrás (szerver-tár,
 * később Drive/S3/WebDAV…) ugyanazt az interfészt adja, így a Tár panel és a
 * klip-hozzáadás forrás-független marad.
 *
 * Asset-állapotok: a resolve() natívan az app médiatárába tölt (Imported),
 * weben stream-URL-t ad (External) — a projekt mindkettőt hivatkozásként kezeli.
 */

export interface StorageEntry {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  /** mp — videó/hang esetén */
  duration?: number;
  /** bájt */
  size?: number;
  /** provider-relatív letöltési út */
  url: string;
  /** forráson belüli út (probe-hoz) */
  path?: string;
}

export interface ResolvedMedia {
  uri: string;
  provider: Asset['provider'];
}

export interface StorageProvider {
  id: string;
  label: string;
  /** rövid magyarázat a panelen (honnan jön a tartalom) */
  description: string;
  isAvailable(): Promise<boolean>;
  list(): Promise<StorageEntry[]>;
  /** helyi (vagy weben stream-) uri-t ad a klip-hozzáadáshoz */
  resolve(entry: StorageEntry): Promise<ResolvedMedia>;
  /** hossz-lekérdezés hozzáadás előtt, ha a lista nem adta (opcionális) */
  probeDuration?(entry: StorageEntry): Promise<number | null>;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Szerver-tár: a worker server/library mappája. A fájlok letöltve az app
 * médiatárába kerülnek (újra-megnyitáskor is megvannak); azonos tétel nem
 * töltődik le kétszer.
 */
const serverLibraryProvider: StorageProvider = {
  id: 'server-library',
  label: 'lib.storageProviders.serverLibrary.label',
  description: 'lib.storageProviders.serverLibrary.description',

  async isAvailable() {
    try {
      const res = await fetchWithTimeout(`${renderServerUrl()}/health`, 4000);
      return res.ok;
    } catch {
      return false;
    }
  },

  async list() {
    const res = await fetchWithTimeout(`${renderServerUrl()}/library`, 5000);
    if (!res.ok) {
      throw new Error(tr('lib.storageProviders.libraryUnavailable'));
    }
    const body = await res.json();
    return body.entries as StorageEntry[];
  },

  async resolve(entry) {
    const remote = `${renderServerUrl()}${entry.url}`;
    if (Platform.OS === 'web') {
      // weben nincs fájlrendszer — a lejátszók az URL-t streamelik (External)
      return { uri: remote, provider: 'remote' };
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const safe = entry.id.replace(/[^\p{L}\p{N}._-]+/gu, '-');
    const target = new File(dir, `lib_${safe}`);
    if (target.exists) {
      return { uri: target.uri, provider: 'library' };
    }
    const file = await File.downloadFileAsync(remote, target);
    return { uri: file.uri, provider: 'library' };
  },
};

/**
 * Generikus adapter a worker storage-gateway-én konfigurált távoli forrásokhoz
 * (WebDAV/NAS…). A hitelesítés a workeren marad — a kliens csak a proxyzott
 * végpontokat látja, forrás-típustól függetlenül.
 */
function remoteSourceProvider(source: {
  id: string;
  label: string;
  type: string;
}): StorageProvider {
  return {
    id: `remote-${source.id}`,
    label: source.label,
    description: tr('lib.storageProviders.remoteSource.description', {
      type: source.type,
    }),

    async isAvailable() {
      try {
        const res = await fetchWithTimeout(`${renderServerUrl()}/health`, 4000);
        return res.ok;
      } catch {
        return false;
      }
    },

    async list() {
      const res = await fetchWithTimeout(
        `${renderServerUrl()}/storage/${encodeURIComponent(source.id)}/list`,
        15000
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? tr('lib.storageProviders.sourceUnavailable'));
      }
      return body.entries as StorageEntry[];
    },

    async resolve(entry) {
      const remote = `${renderServerUrl()}${entry.url}`;
      if (Platform.OS === 'web') {
        return { uri: remote, provider: 'remote' };
      }
      const dir = new Directory(Paths.document, 'media');
      if (!dir.exists) {
        dir.create();
      }
      const safe = entry.id.replace(/[^\p{L}\p{N}._-]+/gu, '-');
      const target = new File(dir, `rmt_${safe}`);
      if (target.exists) {
        return { uri: target.uri, provider: 'library' };
      }
      const file = await File.downloadFileAsync(remote, target);
      return { uri: file.uri, provider: 'library' };
    },

    async probeDuration(entry) {
      try {
        const res = await fetchWithTimeout(
          `${renderServerUrl()}/storage/${encodeURIComponent(source.id)}/probe?path=${encodeURIComponent(
            entry.path ?? ''
          )}`,
          20000
        );
        const body = await res.json();
        return typeof body.duration === 'number' ? body.duration : null;
      } catch {
        return null;
      }
    },
  };
}

/** Gateway: a beépített providerek — a távoliak futásidőben jönnek hozzá. */
export const storageProviders: StorageProvider[] = [serverLibraryProvider];

/**
 * A teljes provider-lista: beépítettek + a worker storage-gateway-én
 * konfigurált távoli források. Worker nélkül a beépítettek jönnek vissza.
 */
export async function loadStorageProviders(): Promise<StorageProvider[]> {
  const providers = [...storageProviders];
  try {
    const res = await fetchWithTimeout(`${renderServerUrl()}/storage/sources`, 4000);
    if (res.ok) {
      const body = (await res.json()) as {
        sources: { id: string; label: string; type: string }[];
      };
      for (const source of body.sources) {
        providers.push(remoteSourceProvider(source));
      }
    }
  } catch {
    // worker nem fut — a beépített providerekkel megyünk tovább
  }
  return providers;
}

export function getStorageProvider(id: string): StorageProvider | null {
  return storageProviders.find((p) => p.id === id) ?? null;
}
