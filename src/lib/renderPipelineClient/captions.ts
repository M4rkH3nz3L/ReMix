// 💬 Auto-caption a worker /captions végpontján.
import { File } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { ensureCloud } from '@/lib/backend';
import { readJson } from '@/lib/netRetry';
import { uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { fileName } from '@/lib/renderPipeline/projectMedia';
import { fetchWithTimeout } from './transport';

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
