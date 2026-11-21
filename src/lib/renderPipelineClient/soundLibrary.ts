// 🎵 A worker hang-könyvtára: lista és letöltés.
import { File } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { cloudBaseUrl, ensureCloud } from '@/lib/backend';
import { fetchRead, readJson } from '@/lib/netRetry';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { projectMediaDir } from '@/lib/projectFolderClient';


export interface LibraryTrack {
  id: string;
  name: string;
  kind: 'sfx' | 'music';
  /** mp */
  duration: number;
  url: string;
  /** egységes metaadat (videóhoz-illesztés): BPM (0 = n/a) + energia 0–1 */
  bpm?: number;
  energy?: number;
}

/** A worker hang-könyvtára (generált SFX + a server/music mappa fájljai). */
export async function fetchSoundLibrary(): Promise<LibraryTrack[]> {
  const base = cloudBaseUrl();
  const res = await fetchRead(`${base}/music`, { timeoutMs: 5000 }); // 🔁 tiszta olvasás
  if (!res.ok) {
    throw new Error(tr('lib.render.soundLibraryUnreachable'));
  }
  const body = await readJson<{ tracks?: LibraryTrack[] }>(
    res,
    tr('lib.render.soundLibraryUnreachable')
  );
  return body.tracks ?? [];
}

/** Letölti a hangot az app dokumentum-mappájába; a helyi URI-t adja vissza. */
export async function downloadTrack(track: LibraryTrack): Promise<string> {
  if (Platform.OS === 'web') {
    // weben nincs fájlrendszer — az expo-audio közvetlenül streameli az URL-t
    return `${cloudBaseUrl()}${track.url}`;
  }
  const dir = projectMediaDir();
  if (!dir.exists) {
    dir.create();
  }
  const safe = track.id.replace(/[^a-z0-9_-]+/gi, '-');
  const target = new File(dir, `lib_${safe}.m4a`);
  if (target.exists) {
    return target.uri; // már letöltve (a telefonon van — újra nem kér Pro-t)
  }
  // 🔁 2026-11-14: a szerveres könyvtár letöltése Pro (a szerver is ellenőrzi — hitelesített kérés)
  const base = ensureCloud('soundLibrary');
  const file = await File.downloadFileAsync(`${base}${track.url}`, target, { headers: await workerAuthHeaders() });
  return file.uri;
}
