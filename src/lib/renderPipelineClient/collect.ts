// 📦 Collect Project: a projekt + médiája egy zip-ben a workertől.
import { File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { flattenClipUris } from '@/lib/assetResolve';
import { cloudBaseUrl } from '@/lib/backend';
import { readJson } from '@/lib/netRetry';
import { weightedStages, type ProgressUpdate } from '@/lib/progress';
import { uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { withFingerprints } from '@/lib/fingerprint';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { fileName, mediaUris } from '@/lib/renderPipeline/projectMedia';
import { MAX_POLLS, POLL_MS } from './cloudJob';
import { fetchWithTimeout } from './transport';

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
  // md5+méret identitás az archívumba — a kicsomagolt project.remix
  // tartalom szerint is újracsatolható marad
  // 🔗 ADR-012: a .remix csomag előtt is a feloldott (asseten át) uri-kra lapítunk,
  // hogy a feltöltött fájlok ÉS a szerializált projekt klip-uri-jai egyezzenek.
  const stamped = flattenClipUris(await withFingerprints(project));
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
    const res = await fetchWithTimeout(`${base}/render/${submitBody.id}`, 5000, {
      headers: await workerAuthHeaders(), // 🔒 BOLA: a saját job pollja
    });
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
      } catch (caught) {
        logCaught('lib/render.ts:collectAndShareProject', caught);
        // ha nem törölhető, a letöltés úgyis hibát ad
      }
      const file = await File.downloadFileAsync(
        `${base}/render/${submitBody.id}/file`,
        target,
        { headers: await workerAuthHeaders() } // 🔒 BOLA: a saját .remix.zip letöltése
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
