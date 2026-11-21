// 📤 A felhő-render kimenetei: natív File, hangexport, letölthető URL, webes feltöltés/letöltés.
import { File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';

import { cloudBaseUrl, ensureCloud } from '@/lib/backend';
import type { ProgressUpdate } from '@/lib/progress';
import { projectDuration } from '@/lib/projectUtils';
import { workerAuthHeaders, workerAuthToken } from '@/lib/workerAuth';
import type { Project, RenderedVersion } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { asCancelled } from '@/lib/renderPipeline/cancel';
import type { RenderSettings } from '@/lib/renderPipeline/settings';
import { submitAndPollRender } from './cloudJob';
import { uploadMedia } from './upload';

/** Felhő-render (Pro, NATÍV): fel a workernek → poll → kész MP4 letöltése File-ba. */
export async function renderCloud(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  signal?: AbortSignal
): Promise<File> {
  const base = ensureCloud('cloudRender');
  const id = await submitAndPollRender(base, project, onProgress, settings, signal);
  const safeName = project.name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'video';
  const target = new File(Paths.cache, `${safeName}.mp4`);
  try {
    if (target.exists) {
      target.delete();
    }
  } catch (caught) {
    logCaught('lib/render.ts:renderCloud', caught);
    // ha nem törölhető, a letöltés úgyis hibát ad
  }
  return await File.downloadFileAsync(`${base}/render/${id}/file`, target, {
    headers: await workerAuthHeaders(), // 🔒 BOLA: a saját render letöltése
  });
}

/**
 * 🌐 WEB: a szerver renderel (on-device render weben NINCS) → a kész MP4 workeren
 * elérhető URL-je. NINCS kliens-oldali Pro-kapu: weben a render KIZÁRÓLAG a
 * workeren mehet, a jogosultságot maga a szerver dönti el (a dev-worker ezt
 * `ALLOW_INSECURE_DEV`-vel átengedi). `cloudBaseUrl()` a worker címe.
 */
/**
 * 🎧 Hang-only export: a projektet a felhő-workerrel rendereli, majd a kész
 * keverékből a kért formátumot (WAV/MP3/AAC/FLAC) vonja ki → letölthető URL.
 * Pro (felhő-render). A master (loudnorm/alimiter) a hangban van; a videó-kép
 * eldobódik. A `resolution`/`fps` a típus miatt kell, de az export hangra megy.
 */
export async function exportAudioFile(
  project: Project,
  format: NonNullable<RenderSettings['audioFormat']>,
  onProgress?: (update: ProgressUpdate) => void,
  signal?: AbortSignal,
  extra?: Partial<RenderSettings>
): Promise<string> {
  return renderCloudFileUrl(
    project,
    onProgress,
    { resolution: 480, fps: project.fps ?? 30, quality: 'high', audioFormat: format, ...extra },
    signal
  );
}

/**
 * 🎧 Hangexport FÁJLBA (PRO-AUDIO A28): a kész fájl a projekt Export-mappájába kerül, a
 * hitelesítés fejlécben megy — a token nem kerül URL-be, böngészőbe, előzménybe. A hívó a
 * helyi fájlt a rendszer megosztólapjával adja tovább (Fájlok, AirDrop, üzenet).
 */
export async function exportAudioToFile(
  project: Project,
  settings: Partial<RenderSettings>,
  target: File,
  onProgress?: (update: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<string> {
  const base = cloudBaseUrl();
  const id = await submitAndPollRender(
    base,
    project,
    onProgress,
    { resolution: 480, fps: project.fps ?? 30, quality: 'high', ...settings },
    signal
  );
  const res = await fetch(`${base}/render/${id}/file`, { headers: await workerAuthHeaders(), signal }).catch((e: unknown) => {
    throw asCancelled(e, signal);
  });
  if (!res.ok) {
    throw new Error(tr('lib.render.renderError'));
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (target.exists) {
    target.delete();
  }
  target.create();
  target.write(bytes);
  return target.uri;
}

export async function renderCloudFileUrl(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  signal?: AbortSignal
): Promise<string> {
  const base = cloudBaseUrl();
  const id = await submitAndPollRender(base, project, onProgress, settings, signal);
  // 🔒 BOLA (07): ezt a nyers URL-t a böngésző / uploadMedia FETCH-eli, ahol nem
  // lehet fejlécet küldeni → a token `?t=` query-paraméterben megy.
  const token = await workerAuthToken();
  return `${base}/render/${id}/file${token ? `?t=${encodeURIComponent(token)}` : ''}`;
}

/**
 * 🌐 WEB: szerver-render → a kész MP4 a SZERVER média-tárába (a böngészhető
 * `server/media` mappa dev-ben, prodon service_role Supabase Storage). A worker a
 * renderelt fájlt a `/render/:id/file`-en adja; ezt töltjük fel `/media/upload`-ra
 * (`uploadMedia`) → a feed a szerver által adott, ELÉRHETŐ URL-t játssza. NINCS
 * kliens-oldali Storage-írás → nincs RLS-hiba.
 */
export async function renderAndUploadWeb(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings
): Promise<RenderedVersion> {
  const fileUrl = await renderCloudFileUrl(project, onProgress, settings);
  const url = await uploadMedia(fileUrl, {
    projectId: project.id,
    kind: 'video',
    name: `${project.id}.mp4`,
  });
  return {
    uri: url,
    url,
    renderedAt: new Date().toISOString(),
    durationSec: Math.round(projectDuration(project) * 10) / 10,
  };
}

/**
 * 🌐 WEB: szerver-render → a kész MP4 letöltése a böngészőben (nincs natív
 * megosztó/Fotók). Blob → object-URL → rejtett `<a download>`.
 */
export async function renderAndDownloadWeb(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  signal?: AbortSignal
): Promise<void> {
  const fileUrl = await renderCloudFileUrl(project, onProgress, settings, signal);
  const blob = await (await fetch(fileUrl)).blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const safeName = project.name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'video';
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${safeName}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  onProgress?.({ phase: tr('lib.render.phaseShare'), ratio: 1 });
}
