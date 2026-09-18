import { Directory, File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

import { cloudBaseUrl, ensureCloud, renderServerUrl } from '@/lib/backend';
import {
  canRenderLocally,
  isNativeRenderAvailable,
  LocalRenderUnavailableError,
  renderLocal,
} from '@/lib/nativeRender';
import { fetchRead, readJson } from '@/lib/netRetry';
import { weightedStages, type ProgressUpdate } from '@/lib/progress';
import { projectDuration } from '@/lib/projectUtils';
import { renderCacheKey } from '@/lib/projectHash';
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { withFingerprints } from '@/lib/fingerprint';
import type { Project, RenderedVersion } from '@/types/project';

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
      // 🎭 track/luma matte és 🎞️ 3D LUT: ezek is a worker FFmpeg `-i`-jére
      // mennek, tehát fel KELL tölteni őket. (Enélkül a felhő-render az eszköz
      // helyi útvonalát kapná — ami ott nem létezik —, a worker pedig
      // ellenőrzés nélkül nyitná meg: lásd a `/render` URI-átírását.)
      if ('matte' in clip && clip.matte?.uri) {
        uris.add(clip.matte.uri);
      }
      if ('adjust' in clip && clip.adjust?.lut?.uri) {
        uris.add(clip.adjust.lut.uri);
      }
    }
  }
  return [...uris];
}

/** Export-beállítások (látványterv szerint) — a worker rendere olvassa. */
/** videó-kodek: h264 = univerzális; hevc = modern eszköz+felhő; av1/prores = felhő */
export type RenderCodec = 'h264' | 'hevc' | 'av1' | 'prores';

export interface RenderSettings {
  /** a rövidebb oldal pixelben: 480 / 720 / 1080 / 2160 / 4320 (8K) */
  resolution: number;
  fps: number;
  quality: 'low' | 'medium' | 'high';
  /** cél-kodek (alap: h264); av1/prores + 8K csak felhő-renderrel */
  codec?: RenderCodec;
  // ── Pro export-kontroll (a felhő-worker honorálja) ─────────────────────
  /** bitráta-mód: crf (minőség-alapú, alap) · vbr (cél + csúcs) · cbr (konstans) */
  bitrateMode?: 'crf' | 'vbr' | 'cbr';
  /** cél-bitráta Mbps-ban (vbr/cbr esetén; crf-nél nem használt) */
  bitrateMbps?: number;
  /** GOP (kulcskocka-táv) képkockában; hiányzó = fps×2 */
  gop?: number;
  /** szín-mélység: 8 (alap) vagy 10 bit */
  bitDepth?: 8 | 10;
  /** szín-tér: rec709 (alap, SDR) vagy rec2020 (széles gamut) */
  colorSpace?: 'rec709' | 'rec2020';
  /** HDR (PQ / SMPTE-2084) — 10-bit + rec2020 kényszerű */
  hdr?: boolean;
  /** hang mintavétel: 44100 / 48000 */
  sampleRate?: 44100 | 48000;
  /** hang csatorna-elrendezés: 1 (mono) / 2 (sztereó) */
  channels?: 1 | 2;
  /** hang bitráta kbps (alap 192) */
  audioBitrateKbps?: number;
}

/**
 * Igaz, ha a beállítás CSAK felhő-renderrel teljesíthető: az eszköz-render
 * H.264-et, 8-bitet, Rec.709-et és max 4K-t tud; az AV1/ProRes/HEVC, a 10-bit,
 * a HDR/Rec.2020 és a 8K a felhő-worker (ffmpeg) dolga.
 */
/** 📲 Platform export-presetek: a platform ajánlott kimeneti beállításai. */
export type ExportPlatform = 'tiktok' | 'reels' | 'shorts' | 'youtube' | 'instagram';
export const PLATFORM_PRESETS: Record<
  ExportPlatform,
  { label: string; aspect: string; settings: Partial<RenderSettings> }
> = {
  tiktok: {
    label: 'TikTok',
    aspect: '9:16',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
  reels: {
    label: 'Reels',
    aspect: '9:16',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
  shorts: {
    label: 'Shorts',
    aspect: '9:16',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
  youtube: {
    label: 'YouTube',
    aspect: '16:9',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 12 },
  },
  instagram: {
    label: 'Instagram',
    aspect: '4:5',
    settings: { resolution: 1080, fps: 30, quality: 'high', codec: 'h264', bitrateMode: 'vbr', bitrateMbps: 10 },
  },
};

export function settingsNeedCloud(s: RenderSettings): boolean {
  // Az eszközön futó (natív) render csak H.264 CRF-et tud, felbontásból/fps-ből.
  // Minden tényleges pro encode-kontroll (más kodek, cél-bitráta, egyedi GOP,
  // 10-bit, HDR, Rec.2020, >4K) a felhő-workerre kerül — hogy a UI ne ígérjen
  // olyat, amit a lokális út elnyel.
  return (
    (s.codec !== undefined && s.codec !== 'h264') ||
    s.resolution > 2160 ||
    s.bitDepth === 10 ||
    s.hdr === true ||
    s.colorSpace === 'rec2020' ||
    (s.bitrateMode !== undefined && s.bitrateMode !== 'crf') ||
    (s.gop !== undefined && s.gop > 0)
  );
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
    super(tr('lib.render.cancelled'));
    this.name = 'RenderCancelledError';
  }
}

export function isRenderCancelledError(e: unknown): boolean {
  return (
    e instanceof RenderCancelledError ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'RenderCancelledError')
  );
}

const DEFAULT_SETTINGS: RenderSettings = { resolution: 1080, fps: 30, quality: 'high', codec: 'h264' };

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
    throw new Error(tr('lib.render.mp4NativeOnly'));
  }
  const mode = opts?.mode ?? 'auto';
  const effective = settings ?? DEFAULT_SETTINGS;

  // 🗃️ Render-cache: ha a projekt + beállítás változatlan a legutóbbi renderhez
  // képest, a kész fájlt azonnal visszaadjuk (nincs újra-render). A kulcs a
  // render-releváns tartalom + a beállítás hash-e; a cache Paths.cache-ben él.
  const cacheKey = renderCacheKey(project, effective);
  const cached = cachedRenderFile(cacheKey);
  if (cached) {
    onProgress?.({ phase: tr('lib.render.phaseShare'), ratio: 1 });
    return cached;
  }

  // av1/prores + 8K csak felhőben megy → az eszköz-utat kizárjuk
  const needCloud = settingsNeedCloud(effective);

  // ESZKÖZÖN: ingyen, szerver nélkül — ha a build támogatja és van mit renderelni
  const canLocal =
    (mode === 'local' || mode === 'auto') &&
    !needCloud &&
    isNativeRenderAvailable() &&
    canRenderLocally(project, effective);
  let out: File;
  if (canLocal) {
    onProgress?.({ phase: tr('lib.render.phaseRenderingOnDevice'), ratio: 0 });
    out = await renderLocal(
      project,
      effective,
      (p) => onProgress?.({ phase: tr('lib.render.phaseRenderingOnDevice'), ratio: p }),
      opts?.signal // ✕ gomb: eddig NEM ment át ide, ezért hatástalan volt
    );
  } else if (mode === 'local') {
    // kifejezetten eszközön kérték, de nem megy: kodek/felbontás felhőt igényel,
    // vagy nincs natív modul (pl. Expo Go)
    throw needCloud ? new Error(tr('lib.render.codecNeedsCloud')) : new LocalRenderUnavailableError();
  } else {
    // FELHŐ: Pro-gate (nincs Pro → ProRequiredError a UI paywalljára)
    out = await renderCloud(project, onProgress, settings, opts?.signal);
  }
  return storeRenderCache(cacheKey, out);
}

/** Render-cache mappa (OS által üríthető cache-terület). */
function renderCacheDir(): Directory {
  return new Directory(Paths.cache, 'rendercache');
}

/** A kulcshoz tartozó gyorsítótár-fájl, ha létezik (különben null). */
function cachedRenderFile(key: string): File | null {
  try {
    const file = new File(renderCacheDir(), `${key}.mp4`);
    return file.exists ? file : null;
  } catch {
    return null;
  }
}

/**
 * A kész rendert a cache-be másolja (a régi bejegyzéseket kiürítve — csak a
 * legutóbbit tartjuk, hogy ne hízzon). Hiba esetén az eredeti fájlt adja vissza.
 */
function storeRenderCache(key: string, file: File): File {
  try {
    const dir = renderCacheDir();
    if (!dir.exists) {
      dir.create({ intermediates: true });
    } else {
      // csak a legutóbbi rendert tartjuk
      for (const e of dir.list()) {
        if (e instanceof File) {
          try {
            e.delete();
          } catch {
            /* ignore */
          }
        }
      }
    }
    const dest = new File(dir, `${key}.mp4`);
    file.copy(dest);
    return dest.exists ? dest : file;
  } catch {
    return file;
  }
}

/**
 * 🎞️ A projekt RENDERELT VÁLTOZATÁNAK elkészítése és PERZISZTÁLÁSA a projekthez.
 * Render (eszköz/felhő) → a kész MP4-et a document-tárba másoljuk (a cache-ből,
 * ami törlődhet) → visszaadjuk a `RenderedVersion`-t (a hívó a projektre menti).
 */
export async function renderProjectVersion(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  opts?: RenderOptions
): Promise<RenderedVersion> {
  const file = await renderMp4(project, onProgress, settings, opts);
  const dir = new Directory(Paths.document, 'renders');
  try {
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  } catch {
    // ha nem hozható létre, marad a cache-uri (a copy alább akkor is próbál)
  }
  const dest = new File(dir, `${project.id}.mp4`);
  let uri = file.uri;
  try {
    if (dest.exists) {
      dest.delete();
    }
    file.copy(dest);
    uri = dest.uri;
  } catch {
    // a másolás bukott → a (cache-beli) render-uri-t adjuk vissza
  }
  return {
    uri,
    renderedAt: new Date().toISOString(),
    durationSec: Math.round(projectDuration(project) * 10) / 10,
  };
}

/**
 * Egy helyi médiafájl (renderelt videó / borító) feltöltése a workeren át a
 * publikus Storage-ba → a publikus URL (a feed / cross-device lejátszáshoz).
 */
export async function uploadMedia(uri: string, name?: string): Promise<string> {
  const base = cloudBaseUrl();
  const form = await mediaFormData(uri, name);
  const res = await uploadFetch(`${base}/media/upload`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || tr('lib.render.uploadFailed'));
  }
  const data = await readJson<{ url?: string }>(res, tr('lib.render.uploadFailed'));
  if (!data.url) {
    throw new Error(tr('lib.render.uploadFailed'));
  }
  return data.url;
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
  const PHASE_UPLOAD = tr('lib.render.phaseUpload');
  const PHASE_RENDER = tr('lib.render.phaseRender');
  const PHASE_DOWNLOAD = tr('lib.render.phaseDownload');
  const stages = weightedStages([
    [PHASE_UPLOAD, 0.25],
    [PHASE_RENDER, 0.65],
    [PHASE_DOWNLOAD, 0.1],
  ]);

  try {
    await fetchWithTimeout(`${base}/health`, 3000);
  } catch {
    throw new Error(tr('lib.render.workerUnreachable', { base }));
  }

  const form = new FormData();
  const uriMap: Record<string, string> = {};
  const uris = mediaUris(project);
  uris.forEach((uri, i) => {
    const field = `f${i}`;
    uriMap[uri] = field;
    form.append(field, new File(uri) as unknown as Blob, fileName(uri));
    onProgress?.({
      phase: PHASE_UPLOAD,
      ratio: stages.ratioFor(PHASE_UPLOAD, (i + 1) / Math.max(1, uris.length)),
      current: i + 1,
      total: uris.length,
      unit: tr('lib.render.unitFile'),
    });
  });
  form.append('project', JSON.stringify(project));
  form.append('uriMap', JSON.stringify(uriMap));
  if (settings) {
    form.append('settings', JSON.stringify(settings));
  }

  const submit = await uploadFetch(`${base}/render`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  // ⚠️ a `.json()` KORÁBBAN itt futott, mint az `!ok` ág — egy 502-es HTML-oldal
  // parse-hibát dobott, épp a beszédes üzenet helyett
  const submitBody = await readJson<{ id?: string; error?: string }>(
    submit,
    tr('lib.render.renderStartFailed')
  );
  if (!submit.ok || !submitBody.id) {
    throw new Error(submitBody.error ?? tr('lib.render.renderStartFailed'));
  }
  const { id } = submitBody;

  onProgress?.({ phase: PHASE_RENDER, ratio: stages.ratioFor(PHASE_RENDER, 0) });
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    // 🔁 A státusz-lekérés IDEMPOTENS olvasás — és itt a legdrágább a hiba: a
    // média már fent van, a worker épp renderel, és egy pillanatnyi hálózat-
    // kimaradás (lift, wifi→LTE) eldobná az egész munkát. A `signal` átmegy,
    // így a ✕ gomb továbbra is azonnal megszakít.
    const res = await fetchRead(`${base}/render/${id}`, { timeoutMs: 5000, signal });
    const status = await readJson<{ state?: string; error?: string; progress?: number }>(
      res,
      tr('lib.render.renderError')
    );
    if (status.state === 'done') {
      onProgress?.({ phase: PHASE_DOWNLOAD, ratio: stages.ratioFor(PHASE_DOWNLOAD, 0) });
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
      throw new Error(status.error ?? tr('lib.render.renderError'));
    }
    // a worker az ffmpeg tényleges előrehaladását adja (0-1)
    if (typeof status.progress === 'number' && status.progress > 0) {
      onProgress?.({
        phase: PHASE_RENDER,
        ratio: stages.ratioFor(PHASE_RENDER, status.progress),
      });
    }
  }
  throw new Error(tr('lib.render.renderTimeout'));
}

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
    throw new Error(tr('lib.render.autoCaptionNativeOnly'));
  }
  const base = ensureCloud('autoCaption');
  let health: { captions?: boolean };
  try {
    const res = await fetchWithTimeout(`${base}/health`, 3000);
    health = await readJson<{ captions?: boolean }>(res, tr('lib.render.workerUnreachable', { base }));
  } catch {
    throw new Error(tr('lib.render.workerUnreachable', { base }));
  }
  if (!health.captions) {
    throw new Error(tr('lib.render.noWhisperModel'));
  }
  const form = new FormData();
  form.append('media', new File(uri) as unknown as Blob, fileName(uri));
  form.append('granularity', granularity);
  const res = await uploadFetch(`${base}/captions`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  const body = await readJson<{ srt?: string; error?: string }>(
    res,
    tr('lib.render.transcriptionFailed')
  );
  if (!res.ok) {
    throw new Error(body.error ?? tr('lib.render.transcriptionFailed'));
  }
  if (typeof body.srt !== 'string') {
    // 200-as válasz `srt` nélkül: a feliratozás „sikerült", de nincs mit beszúrni
    throw new Error(tr('lib.render.transcriptionFailed'));
  }
  return body.srt;
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
    throw new Error(tr('lib.render.collectNativeOnly'));
  }
  const base = cloudBaseUrl();
  try {
    await fetchWithTimeout(`${base}/health`, 3000);
  } catch {
    throw new Error(tr('lib.render.workerUnreachable', { base }));
  }

  const PHASE_UPLOAD = tr('lib.render.phaseUpload');
  const PHASE_PACKAGING = tr('lib.render.phasePackaging');
  const PHASE_DOWNLOAD = tr('lib.render.phaseDownload');
  const stages = weightedStages([
    [PHASE_UPLOAD, 0.3],
    [PHASE_PACKAGING, 0.6],
    [PHASE_DOWNLOAD, 0.1],
  ]);
  onProgress?.({ phase: PHASE_UPLOAD, ratio: 0 });
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

  const submit = await uploadFetch(`${base}/collect`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
  });
  const submitBody = await readJson<{ id?: string; error?: string }>(
    submit,
    tr('lib.render.packagingStartFailed')
  );
  if (!submit.ok || !submitBody.id) {
    throw new Error(submitBody.error ?? tr('lib.render.packagingStartFailed'));
  }

  onProgress?.({ phase: PHASE_PACKAGING, ratio: stages.ratioFor(PHASE_PACKAGING, 0) });
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const res = await fetchWithTimeout(`${base}/render/${submitBody.id}`, 5000);
    const status = await readJson<{ state?: string; error?: string }>(
      res,
      tr('lib.render.renderError')
    );
    if (status.state === 'done') {
      onProgress?.({ phase: PHASE_DOWNLOAD, ratio: stages.ratioFor(PHASE_DOWNLOAD, 0) });
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
      onProgress?.({ phase: tr('lib.render.phaseShare'), ratio: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/zip',
          dialogTitle: `${safe}.remix.zip`,
        });
      }
      return;
    }
    if (status.state === 'error') {
      throw new Error(status.error ?? tr('lib.render.packagingError'));
    }
  }
  throw new Error(tr('lib.render.packagingTimeout'));
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
        onProgress?.({ phase: tr('lib.render.phaseSavingToPhotos'), ratio: 1 });
        await MediaLibrary.saveToLibraryAsync(file.uri);
        savedToPhotos = true;
      }
    } catch {
      // engedély-megtagadás vagy hiba — a megosztó így is felajánlja a mentést
    }
  }

  onProgress?.({
    phase: savedToPhotos
      ? tr('lib.render.phaseSavedToPhotosShare')
      : tr('lib.render.phaseShare'),
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
        onProgress?.({ phase: tr('lib.render.phaseSavingToPhotos'), ratio: 1 });
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
        onProgress?.({ phase: tr('lib.render.phaseOpeningInstagramReels'), ratio: 1 });
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
        ? tr('lib.render.phaseChooseTikTok')
        : target === 'youtube'
          ? tr('lib.render.phaseChooseYouTube')
          : tr('lib.render.phaseShare'),
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
