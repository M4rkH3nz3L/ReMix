// 🎬 Render-orchesztrátor: eszközön (ingyen) vagy felhőben (Pro) — és a renderelt változat mentése.
import { Directory, File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { isProRequiredError } from '@/lib/backend';
import { localizeRemoteMedia } from '@/lib/remoteMediaClient';
import { exportPolicy } from '@/lib/exportPolicy';
import {
  canRenderLocally,
  deviceRenderGaps,
  isNativeRenderAvailable,
  LocalRenderUnavailableError,
  renderLocal,
} from '@/lib/nativeRender';
import type { ProgressUpdate } from '@/lib/progress';
import { projectDuration } from '@/lib/projectUtils';
import { renderCacheKey } from '@/lib/projectHash';
import { addBreadcrumb, reportBug } from '@/lib/bugReporter';
import { StorageQuotaError } from '@/lib/storageQuota';
import { useEntitlement } from '@/store/entitlementStore';
import type { Project, RenderedVersion } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { logCswcr, studioKindOf } from '@/lib/cswcrClient';
import { isRenderCancelledError } from '@/lib/renderPipeline/cancel';
import { DEFAULT_SETTINGS, settingsNeedCloud, type RenderOptions, type RenderSettings } from '@/lib/renderPipeline/settings';
import { cachedRenderFile, storeRenderCache } from './cache';
import { renderCloud } from './cloudExport';


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
  // 🌐 B28: a távoli (remix) forrásokat ELŐBB a projekt mappájába töltjük — az
  // eszközön-render a http-t kihagyná, a felhő „hiányzó klipre” 400-at adna
  project = await localizeRemoteMedia(project, onProgress);

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
  // 🐞 a hibajelentések kontextusa: milyen render indult (motor-döntés előtt)
  addBreadcrumb(`render: ${mode} ${effective.resolution}p ${effective.codec ?? 'h264'}`);

  // ESZKÖZÖN: ingyen, szerver nélkül — ha a build támogatja és van mit renderelni
  const canLocal =
    (mode === 'local' || mode === 'auto') &&
    !needCloud &&
    isNativeRenderAvailable() &&
    canRenderLocally(project, effective);
  let out: File;
  if (canLocal) {
    onProgress?.({ phase: tr('lib.render.phaseRenderingOnDevice'), ratio: 0 });
    // 🏷️ on-device = INGYEN (nem mért); a nem-fizető tier kimenetére ReMix-vízjel
    // kerül (exportPolicy — a felhő-render ezzel szemben mért + tiszta).
    const { watermark } = exportPolicy(useEntitlement.getState().effectiveTier(), 'local');
    try {
      out = await renderLocal(
        project,
        effective,
        (p) => onProgress?.({ phase: tr('lib.render.phaseRenderingOnDevice'), ratio: p }),
        opts?.signal, // ✕ gomb: eddig NEM ment át ide, ezért hatástalan volt
        watermark
      );
    } catch (e) {
      reportRenderFailure(e, 'renderLocal', project, effective);
      throw e;
    }
  } else if (mode === 'local') {
    // kifejezetten eszközön kérték, de nem megy: kodek/felbontás felhőt igényel,
    // nincs natív modul (pl. Expo Go), VAGY 🎯 a paritás-kapu szerint a kész
    // videóból hiányozna, amit a szerkesztő mutat (szöveg/effekt/átmenet…)
    if (needCloud) {
      throw new Error(tr('lib.render.codecNeedsCloud'));
    }
    const gaps = deviceRenderGaps(project);
    if (gaps.length > 0) {
      throw new Error(tr('lib.render.contentNeedsCloud', { count: gaps.length }));
    }
    throw new LocalRenderUnavailableError();
  } else {
    // FELHŐ: Pro-gate (nincs Pro → ProRequiredError a UI paywalljára)
    try {
      out = await renderCloud(project, onProgress, settings, opts?.signal);
    } catch (e) {
      reportRenderFailure(e, 'renderCloud', project, effective);
      throw e;
    }
  }
  return storeRenderCache(cacheKey, out);
}

/**
 * 🐞 Render-bukás jelentése a szerver bug-mappájába — a nem-hiba kimeneteleket
 * (user-megszakítás, Pro-kapu, betelt tárhely-kvóta) kihagyva. A kontextus
 * PII-mentes: motor, platform, kimeneti beállítás, a projekt mérete.
 */
function reportRenderFailure(
  e: unknown,
  where: 'renderLocal' | 'renderCloud',
  project: Project,
  settings: RenderSettings
): void {
  if (isRenderCancelledError(e) || isProRequiredError(e) || e instanceof StorageQuotaError) {
    return;
  }
  void reportBug(e, {
    kind: 'handled',
    extra: {
      where,
      resolution: settings.resolution,
      fps: settings.fps,
      codec: settings.codec ?? 'h264',
      clips: project.tracks.reduce((n, t) => n + t.clips.length, 0),
      tracks: project.tracks.filter((t) => t.clips.length > 0).map((t) => t.type).join(','),
    },
  });
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
  // 📊 CSWCR (CORE K4): a kész videó befejezi a láncot
  logCswcr({ type: 'export', projectId: project.id, kind: studioKindOf(project.kind) });
  const dir = new Directory(Paths.document, 'renders');
  try {
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  } catch (caught) {
    logCaught('lib/render.ts:renderProjectVersion', caught);
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
  } catch (caught) {
    logCaught('lib/render.ts:renderProjectVersion', caught);
    // a másolás bukott → a (cache-beli) render-uri-t adjuk vissza
  }
  return {
    uri,
    renderedAt: new Date().toISOString(),
    durationSec: Math.round(projectDuration(project) * 10) / 10,
  };
}
