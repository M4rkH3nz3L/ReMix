// ☁️ Felhő-render job: feltöltés → indítás → poll (+ szerver-oldali megszakítás).
import { t as tr } from 'i18next';

import { flattenClipUris } from '@/lib/assetResolve';
import { fetchRead, readJson } from '@/lib/netRetry';
import { weightedStages, type ProgressUpdate } from '@/lib/progress';
import { projectDuration } from '@/lib/projectUtils';
import { cloudRenderBlocked, cloudRenderStalled, type RenderHealth } from '@/lib/renderPreflight';
import { uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { useAuth } from '@/store/authStore';
import { useEntitlement } from '@/store/entitlementStore';
import type { Project } from '@/types/project';
import { reportRenderDegraded } from '@/lib/renderNotices';
import { logCaught } from '@/lib/logCaught';
import { asCancelled, RenderCancelledError } from '@/lib/renderPipeline/cancel';
import { fileName, mediaUris } from '@/lib/renderPipeline/projectMedia';
import type { RenderSettings } from '@/lib/renderPipeline/settings';
import { phoneMixFile } from './phoneMix';
import { appendMediaPart, fetchWithTimeout } from './transport';

export const POLL_MS = 2000;
export const MAX_POLLS = 300; // ~10 perc

/**
 * A felhő-render KÖZÖS magja: média-feltöltés (web-biztos) → indítás → poll.
 * A kész job azonosítóját adja vissza; a LETÖLTÉS a hívóé, mert platformfüggő
 * (natívan `File`-ba, weben Blobként/URL-lel). A `base` a worker címe — natívan
 * a Pro-kapu mögötti `ensureCloud(...)`, weben a nyers `cloudBaseUrl()`.
 */
/** 🛑 Best-effort szerver-oldali render-megszakítás (fire-and-forget): a worker
 *  ffmpeg-jét leállítja / a sorból eltávolítja. A kliens nem várja meg a választ. */
async function cancelRender(base: string, id: string): Promise<void> {
  try {
    await fetch(`${base}/render/${id}/cancel`, { method: 'POST', headers: await workerAuthHeaders() });
  } catch (caught) {
    logCaught('lib/render.ts:cancelRender', caught);
    // best-effort — a kliens akkor is megszakítottnak tekinti
  }
}

export async function submitAndPollRender(
  base: string,
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  signal?: AbortSignal
): Promise<string> {
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

  let health: RenderHealth = {};
  try {
    const r = await fetchWithTimeout(`${base}/health`, 3000);
    health = (await r.json()) as RenderHealth;
  } catch {
    throw new Error(tr('lib.render.workerUnreachable', { base }));
  }
  // ☁️ hosszú videó + van felhő-mód, de NINCS élő render-worker → fail-fast MÁR
  // a média-feltöltés ELŐTT (különben a megosztás/export 25%-on ragadna a
  // ~10 perces timeoutig). A szerver is elutasít; ez a sávszélesség-kímélő pár.
  if (cloudRenderBlocked(health, projectDuration(project))) {
    throw new Error(tr('lib.render.noWorker'));
  }

  // 🔗 ADR-012: a felhő-feltöltés előtt a klip-uri-kat a FELOLDOTT (asseten át)
  // uri-ra lapítjuk, hogy a `uriMap` kulcsai (mediaUris) ÉS a szerializált
  // `clip.uri` (amit a worker párosít) egyezzenek. Ma no-op; relink után a worker
  // így szerver-módosítás nélkül a helyes fájlt kapja.
  const flat = flattenClipUris(project);
  const form = new FormData();
  const uriMap: Record<string, string> = {};
  const uris = mediaUris(flat);
  for (let i = 0; i < uris.length; i++) {
    const uri = uris[i];
    const field = `f${i}`;
    uriMap[uri] = field;
    // 🌐 weben a natív `new File(uri)` nem megy → a médiát blobként fűzzük hozzá
    await appendMediaPart(form, field, uri, fileName(uri));
    onProgress?.({
      phase: PHASE_UPLOAD,
      ratio: stages.ratioFor(PHASE_UPLOAD, (i + 1) / Math.max(1, uris.length)),
      current: i + 1,
      total: uris.length,
      unit: tr('lib.render.unitFile'),
    });
  }
  // 🎧 „azt kapod, amit hallasz”: a telefon kész keverése (az előnézettel azonos kód — effektek,
  // duck, master is) megy fel, a szerver nem keveri újra. Ha itt nem készülhet el (nincs natív
  // dekóder, távoli vagy túl hosszú forrás), a szerver keveri — ez a régi út.
  const mix = await phoneMixFile(flat, onProgress, signal);
  if (mix) {
    await appendMediaPart(form, 'audioMix', mix.uri, 'mix.wav');
  }
  form.append('project', JSON.stringify(flat));
  form.append('uriMap', JSON.stringify(uriMap));
  if (settings) {
    form.append('settings', JSON.stringify(settings));
  }
  // 👤 A hívó azonosítója a felhő-sorhoz (schedules) + a kész értesítéshez. Prod-
  // ban a worker a VERIFIKÁLT tokenből veszi; ez a dev (INSECURE_DEV) fallbackje.
  const uid = useAuth.getState().user?.id;
  if (uid) {
    form.append('userId', uid);
  }
  // 💠 §2.6: a user szintje a render-sor PRIORITÁSÁHOZ (Ultra>Pro>Basic>Free). Csak
  // sorrend, nem biztonsági — a worker a `tierJobPriority`-vel számol belőle.
  form.append('tier', useEntitlement.getState().effectiveTier());

  const submit = await uploadFetch(`${base}/render`, {
    method: 'POST',
    body: form,
    headers: await workerAuthHeaders(),
    signal,
  })
    .catch((e: unknown) => {
      throw asCancelled(e, signal);
    })
    .finally(() => {
      // a feltöltött keverés helyi másolata már nem kell
      try {
        if (mix?.exists) mix.delete();
      } catch (caught) {
        logCaught('lib/render.ts:submitAndPollRender', caught);
      }
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
  // 🖥️ render-közbeni worker-halál detektálás: ha a job sokáig NEM halad
  // (progress 0), időnként újranézzük a worker-flottát — ha közben elfogyott
  // (pl. a worker leállt), ne várjunk a teljes ~10 perces timeoutra.
  let started = false; // volt-e már bármekkora előrehaladás
  let zeroStreak = 0;
  const STALL_RECHECK_POLLS = 12; // ~18 mp zéró-progress után ellenőrizzük a workert
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) {
      void cancelRender(base, id); // 🛑 a szervert is szóljuk (ffmpeg-kill / sor-eltávolítás)
      throw new RenderCancelledError();
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    // 🔁 A státusz-lekérés IDEMPOTENS olvasás — és itt a legdrágább a hiba: a
    // média már fent van, a worker épp renderel, és egy pillanatnyi hálózat-
    // kimaradás (lift, wifi→LTE) eldobná az egész munkát. A `signal` átmegy,
    // így a ✕ gomb továbbra is azonnal megszakít.
    const res = await fetchRead(`${base}/render/${id}`, {
      timeoutMs: 5000,
      signal,
      headers: await workerAuthHeaders(), // 🔒 BOLA: a poll a saját jobhoz
    }).catch((e: unknown) => {
      if (signal?.aborted) {
        void cancelRender(base, id); // 🛑 a lekérdezés közben jött ✕ is leállítja a szervert
      }
      throw asCancelled(e, signal);
    });
    const status = await readJson<{ state?: string; error?: string; progress?: number; degraded?: string[] }>(
      res,
      tr('lib.render.renderError')
    );
    if (status.state === 'done') {
      // 🛑 ha a szerver valamit egyszerűsítve renderelt, a felhasználó tudjon róla
      reportRenderDegraded(status.degraded);
      onProgress?.({ phase: PHASE_DOWNLOAD, ratio: stages.ratioFor(PHASE_DOWNLOAD, 0) });
      return id;
    }
    if (status.state === 'error') {
      throw new Error(status.error ?? tr('lib.render.renderError'));
    }
    // a worker az ffmpeg tényleges előrehaladását adja (0-1)
    const prog = typeof status.progress === 'number' ? status.progress : 0;
    if (prog > 0) {
      started = true;
      zeroStreak = 0;
      onProgress?.({ phase: PHASE_RENDER, ratio: stages.ratioFor(PHASE_RENDER, prog) });
    } else if (!started) {
      // még semmi nem történt — számoljuk a zéró-progress sorozatot, és időnként
      // ellenőrizzük, él-e még worker (a submit-kori guard után is eltűnhet)
      zeroStreak += 1;
      if (zeroStreak >= STALL_RECHECK_POLLS) {
        zeroStreak = 0;
        const h = (await fetchWithTimeout(`${base}/health`, 3000)
          .then((r) => r.json())
          .catch((caught) => { logCaught('lib/render.ts:submitAndPollRender', caught); return {}; })) as RenderHealth;
        if (cloudRenderStalled(h, prog)) {
          throw new Error(tr('lib.render.noWorker'));
        }
      }
    }
  }
  throw new Error(tr('lib.render.renderTimeout'));
}
