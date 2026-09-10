import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

import { cloudBaseUrl, ensureCloud, renderServerUrl } from '@/lib/backend';
import {
  canRenderLocally,
  isNativeRenderAvailable,
  LocalRenderUnavailableError,
  renderLocal,
} from '@/lib/nativeRender';
import { weightedStages, type ProgressUpdate } from '@/lib/progress';
import { uploadFetch } from '@/lib/upload';
import { withFingerprints } from '@/lib/fingerprint';
import type { Project } from '@/types/project';

/**
 * Render-kliens. Két út:
 *   • ESZKÖZÖN (ingyen): a natív renderelő a telefonon készíti az MP4-et,
 *     szerver nélkül (lásd `@/lib/nativeRender`). Ez az alapértelmezett.
 *   • FELHŐ (Pro): a projekt + médiafájlok feltöltése a felhő-workernek,
 *     státusz-poll, majd a kész MP4 letöltése — nagyobb felbontás/gyorsaság.
 * A `renderServerUrl` a `@/lib/backend`-ből jön (a dev-worker feloldása); itt
 * csak re-exportáljuk, hogy a régi importőrök (~28 modul) változatlanul menjenek.
 */

const POLL_MS = 2000;
const MAX_POLLS = 300; // ~10 perc

export { renderServerUrl };

function fileName(uri: string): string {
  const last = uri.split('/').pop() ?? 'media';
  return last.split('?')[0];
}


async function fetchWithTimeout(url: string, ms: number, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mediaUris(project: Project): string[] {
  const uris = new Set<string>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'audio') {
        uris.add(clip.uri);
      }
      if (clip.kind === 'shape' && clip.imageUri) {
        uris.add(clip.imageUri);
      }
    }
  }
  return [...uris];
}

/** Export-beállítások (látványterv szerint) — a worker rendere olvassa. */
export interface RenderSettings {
  /** a rövidebb oldal pixelben: 480 / 720 / 1080 / 2160 */
  resolution: number;
  fps: number;
  quality: 'low' | 'medium' | 'high';
}

/**
 * Melyik motor rendereljen:
 *   • 'auto'  — ha az eszközön-render elérhető ÉS a projekt helyben renderelhető,
 *               akkor eszközön; különben felhő (Pro). Ez az alapértelmezett.
 *   • 'local' — kizárólag eszközön (nincs natív modul → hiba).
 *   • 'cloud' — kizárólag felhő (Pro-gate).
 */
export type RenderMode = 'auto' | 'local' | 'cloud';

export interface RenderOptions {
  mode?: RenderMode;
  /** megszakítás — a poll-ciklus és a hálózati hívások figyelik */
  signal?: AbortSignal;
}

/** A felhasználó megszakította a műveletet. */
export class RenderCancelledError extends Error {
  constructor() {
    super('A művelet megszakítva.');
    this.name = 'RenderCancelledError';
  }
}

export function isRenderCancelledError(e: unknown): boolean {
  return (
    e instanceof RenderCancelledError ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'RenderCancelledError')
  );
}

const DEFAULT_SETTINGS: RenderSettings = { resolution: 1080, fps: 30, quality: 'high' };

/**
 * Render-orchesztrátor: eldönti, hogy ESZKÖZÖN (ingyen) vagy FELHŐBEN (Pro)
 * renderel, és a kész MP4 helyi File-ját adja vissza. Minden hívó (megosztás,
 * posztolás, Export-panel) ezen megy át, így egységes a local↔cloud döntés.
 */
export async function renderMp4(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  opts?: RenderOptions
): Promise<File> {
  if (Platform.OS === 'web') {
    throw new Error('Az MP4-render a natív appból érhető el (iOS/Android).');
  }
  const mode = opts?.mode ?? 'auto';
  const effective = settings ?? DEFAULT_SETTINGS;

  // ESZKÖZÖN: ingyen, szerver nélkül — ha a build támogatja és van mit renderelni
  const canLocal =
    (mode === 'local' || mode === 'auto') &&
    isNativeRenderAvailable() &&
    canRenderLocally(project, effective);
  if (canLocal) {
    onProgress?.({ phase: 'Renderelés az eszközön', ratio: 0 });
    return renderLocal(project, effective, (p) =>
      onProgress?.({ phase: 'Renderelés az eszközön', ratio: p })
    );
  }
  if (mode === 'local') {
    // kifejezetten eszközön kérték, de nincs natív modul (pl. Expo Go)
    throw new LocalRenderUnavailableError();
  }

  // FELHŐ: Pro-gate (nincs Pro → ProRequiredError a UI paywalljára)
  return renderCloud(project, onProgress, settings, opts?.signal);
}

/** Felhő-render (Pro): fel a workernek → poll → kész MP4 letöltése. */
async function renderCloud(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  signal?: AbortSignal
): Promise<File> {
  const base = ensureCloud('cloudRender');
  // A három fázis EGY 0–1 skálára vetítve, hogy a sáv sose ugorjon vissza.
  // A súlyok a fázisok tipikus időarányai (a render viszi az idő nagy részét).
  const stages = weightedStages([
    ['Feltöltés', 0.25],
    ['Renderelés', 0.65],
    ['Letöltés', 0.1],
  ]);

  try {
    await fetchWithTimeout(`${base}/health`, 3000);
  } catch {
    throw new Error(
      `A render worker nem érhető el (${base}) — indítsd el: cd server && npm start`
    );
  }

  const form = new FormData();
  const uriMap: Record<string, string> = {};
  const uris = mediaUris(project);
  uris.forEach((uri, i) => {
    const field = `f${i}`;
    uriMap[uri] = field;
    form.append(field, new File(uri) as unknown as Blob, fileName(uri));
    onProgress?.({
      phase: 'Feltöltés',
      ratio: stages.ratioFor('Feltöltés', (i + 1) / Math.max(1, uris.length)),
      current: i + 1,
      total: uris.length,
      unit: 'fájl',
    });
  });
  form.append('project', JSON.stringify(project));
  form.append('uriMap', JSON.stringify(uriMap));
  if (settings) {
    form.append('settings', JSON.stringify(settings));
  }

  const submit = await uploadFetch(`${base}/render`, { method: 'POST', body: form });
  const submitBody = await submit.json();
  if (!submit.ok) {
    throw new Error(submitBody.error ?? 'A render indítása nem sikerült.');
  }
  const { id } = submitBody;

  onProgress?.({ phase: 'Renderelés', ratio: stages.ratioFor('Renderelés', 0) });
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const res = await fetchWithTimeout(`${base}/render/${id}`, 5000);
    const status = await res.json();
    if (status.state === 'done') {
      onProgress?.({ phase: 'Letöltés', ratio: stages.ratioFor('Letöltés', 0) });
      const safeName = project.name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'video';
      const target = new File(Paths.cache, `${safeName}.mp4`);
      try {
        if (target.exists) {
          target.delete();
        }
      } catch {
        // ha nem törölhető, a letöltés úgyis hibát ad
      }
      return await File.downloadFileAsync(`${base}/render/${id}/file`, target);
    }
    if (status.state === 'error') {
      throw new Error(status.error ?? 'Render hiba.');
    }
    // a worker az ffmpeg tényleges előrehaladását adja (0-1)
    if (typeof status.progress === 'number' && status.progress > 0) {
      onProgress?.({
        phase: 'Renderelés',
        ratio: stages.ratioFor('Renderelés', status.progress),
      });
    }
  }
  throw new Error('A render túl sokáig tartott — próbáld újra.');
}

export interface LibraryTrack {
  id: string;
  name: string;
  kind: 'sfx' | 'music';
  /** mp */
  duration: number;
  url: string;
}

/** A worker hang-könyvtára (generált SFX + a server/music mappa fájljai). */
export async function fetchSoundLibrary(): Promise<LibraryTrack[]> {
  const base = cloudBaseUrl();
  const res = await fetchWithTimeout(`${base}/music`, 5000);
  if (!res.ok) {
    throw new Error('A hang-könyvtár nem érhető el.');
  }
  const body = await res.json();
  return body.tracks as LibraryTrack[];
}

/** Letölti a hangot az app dokumentum-mappájába; a helyi URI-t adja vissza. */
export async function downloadTrack(track: LibraryTrack): Promise<string> {
  if (Platform.OS === 'web') {
    // weben nincs fájlrendszer — az expo-audio közvetlenül streameli az URL-t
    return `${cloudBaseUrl()}${track.url}`;
  }
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) {
    dir.create();
  }
  const safe = track.id.replace(/[^a-z0-9_-]+/gi, '-');
  const target = new File(dir, `lib_${safe}.m4a`);
  if (target.exists) {
    return target.uri; // már letöltve
  }
  const file = await File.downloadFileAsync(`${cloudBaseUrl()}${track.url}`, target);
  return file.uri;
}

/**
 * Auto-caption: a médiafájl feltöltése a worker /captions végpontjára —
 * a válasz nyers SRT, amit a kliens a meglévő SRT-útvonalon dolgoz fel.
 */
export async function transcribeToSrt(
  uri: string,
  granularity: 'caption' | 'word' = 'caption'
): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('Az automatikus felirat a natív appból érhető el (iOS/Android).');
  }
  const base = ensureCloud('autoCaption');
  let health: { captions?: boolean };
  try {
    const res = await fetchWithTimeout(`${base}/health`, 3000);
    health = await res.json();
  } catch {
    throw new Error(
      `A render worker nem érhető el (${base}) — indítsd el: cd server && npm start`
    );
  }
  if (!health.captions) {
    throw new Error(
      'A workeren nincs Whisper-modell — lásd server/models (ggml-base.bin).'
    );
  }
  const form = new FormData();
  form.append('media', new File(uri) as unknown as Blob, fileName(uri));
  form.append('granularity', granularity);
  const res = await uploadFetch(`${base}/captions`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? 'A beszédfelismerés nem sikerült.');
  }
  return body.srt as string;
}

/**
 * Collect Project (full-plan F2): a projekt + MINDEN médiafájl egy zip-ben —
 * átadáshoz/archiváláshoz. A worker csomagol (/collect), az állapot a közös
 * job-végpontokon jön; a kész zip a rendszer-megosztóval osztható meg.
 * A http-forrású médiát (stream-URL) nem töltjük fel — a csomagban URL marad.
 */
export async function collectAndShareProject(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void
): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('A Collect a natív appból érhető el (iOS/Android).');
  }
  const base = cloudBaseUrl();
  try {
    await fetchWithTimeout(`${base}/health`, 3000);
  } catch {
    throw new Error(
      `A render worker nem érhető el (${base}) — indítsd el: cd server && npm start`
    );
  }

  const stages = weightedStages([
    ['Feltöltés', 0.3],
    ['Csomagolás', 0.6],
    ['Letöltés', 0.1],
  ]);
  onProgress?.({ phase: 'Feltöltés', ratio: 0 });
  // md5+méret identitás az archívumba — a kicsomagolt project.vided
  // tartalom szerint is újracsatolható marad
  const stamped = await withFingerprints(project);
  const form = new FormData();
  const uriMap: Record<string, string> = {};
  mediaUris(stamped)
    .filter((uri) => !uri.startsWith('http'))
    .forEach((uri, i) => {
      const field = `f${i}`;
      uriMap[uri] = field;
      form.append(field, new File(uri) as unknown as Blob, fileName(uri));
    });
  form.append('project', JSON.stringify(stamped));
  form.append('uriMap', JSON.stringify(uriMap));

  const submit = await uploadFetch(`${base}/collect`, { method: 'POST', body: form });
  const submitBody = await submit.json();
  if (!submit.ok) {
    throw new Error(submitBody.error ?? 'A csomagolás indítása nem sikerült.');
  }

  onProgress?.({ phase: 'Csomagolás', ratio: stages.ratioFor('Csomagolás', 0) });
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const res = await fetchWithTimeout(`${base}/render/${submitBody.id}`, 5000);
    const status = await res.json();
    if (status.state === 'done') {
      onProgress?.({ phase: 'Letöltés', ratio: stages.ratioFor('Letöltés', 0) });
      const safe = project.name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'projekt';
      const target = new File(Paths.cache, `${safe}.remix.zip`);
      try {
        if (target.exists) {
          target.delete();
        }
      } catch {
        // ha nem törölhető, a letöltés úgyis hibát ad
      }
      const file = await File.downloadFileAsync(
        `${base}/render/${submitBody.id}/file`,
        target
      );
      onProgress?.({ phase: 'Megosztás', ratio: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/zip',
          dialogTitle: `${safe}.remix.zip`,
        });
      }
      return;
    }
    if (status.state === 'error') {
      throw new Error(status.error ?? 'Csomagolás-hiba.');
    }
  }
  throw new Error('A csomagolás túl sokáig tartott — próbáld újra.');
}

/**
 * Render → mentés a Fotókba (engedéllyel, nem-fatális) → rendszer-megosztó.
 * A creator-flow vége: a kész videó a galériából azonnal tölthető TikTokra.
 */
export async function renderAndShareMp4(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  opts?: RenderOptions
): Promise<void> {
  const file = await renderMp4(project, onProgress, settings, opts);

  let savedToPhotos = false;
  if (Platform.OS !== 'web') {
    try {
      const MediaLibrary = await import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (permission.granted) {
        onProgress?.({ phase: 'Mentés a Fotókba', ratio: 1 });
        await MediaLibrary.saveToLibraryAsync(file.uri);
        savedToPhotos = true;
      }
    } catch {
      // engedély-megtagadás vagy hiba — a megosztó így is felajánlja a mentést
    }
  }

  onProgress?.({
    phase: savedToPhotos ? 'A Fotókba mentve ✓ — megosztás' : 'Megosztás',
    ratio: 1,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'video/mp4',
      dialogTitle: `${project.name}.mp4`,
    });
  }
}

/** Posztolási célplatformok — a kész videó közvetlen megosztásához. */
export type PostTarget = 'tiktok' | 'reels' | 'youtube' | 'other';

/**
 * A kész videó posztolása egy platformra: render → Fotókba mentés (a TikTok/
 * Reels/YouTube innen, a galériából importál) → a platform megnyitása.
 * - Reels (iOS): az Instagram közvetlenül a Reels-szerkesztőbe nyílik a mentett
 *   videóval (`instagram://library?LocalIdentifier=…`).
 * - TikTok / YouTube / egyéb: az OS megosztó-lapja, ahol a platform megosztó-
 *   bővítménye a videót a saját feltöltőjébe/szerkesztőjébe tölti.
 * A feliratot/hangot a platform szerkesztőjében adod hozzá, egy koppintással
 * posztolsz. (A teljesen automatikus, appból induló feltöltéshez a platformok
 * hivatalos API-ja + saját fejlesztői kulcsaid kellenének — az külön réteg.)
 */
export async function renderAndPost(
  project: Project,
  target: PostTarget,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  opts?: RenderOptions
): Promise<void> {
  const file = await renderMp4(project, onProgress, settings, opts);

  // Fotókba mentés — minden platform a galériából tudja betölteni a videót
  let assetId: string | null = null;
  if (Platform.OS !== 'web') {
    try {
      const MediaLibrary = await import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (permission.granted) {
        onProgress?.({ phase: 'Mentés a Fotókba', ratio: 1 });
        const asset = await MediaLibrary.createAssetAsync(file.uri);
        assetId = asset?.id ?? null;
      }
    } catch {
      // engedély-megtagadás vagy hiba — a megosztó így is felajánlja a mentést
    }
  }

  // Instagram Reels: iOS-en közvetlenül a szerkesztőbe nyílik a mentett videóval
  if (target === 'reels' && Platform.OS === 'ios' && assetId) {
    const igUrl = `instagram://library?LocalIdentifier=${encodeURIComponent(assetId)}`;
    try {
      if (await Linking.canOpenURL(igUrl)) {
        onProgress?.({ phase: 'Megnyitás az Instagramban (Reels)', ratio: 1 });
        await Linking.openURL(igUrl);
        return;
      }
    } catch {
      // az Instagram nincs telepítve / nem nyílt — a megosztó-lap a fallback
    }
  }

  // TikTok / YouTube / egyéb: OS megosztó-lap (a platform share-bővítménye viszi)
  onProgress?.({
    phase:
      target === 'tiktok'
        ? 'Válaszd a TikTok appot a listából'
        : target === 'youtube'
          ? 'Válaszd a YouTube appot (Short)'
          : 'Megosztás',
    ratio: 1,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'video/mp4',
      dialogTitle: `${project.name}.mp4`,
      UTI: 'public.mpeg-4',
    });
  }
}
