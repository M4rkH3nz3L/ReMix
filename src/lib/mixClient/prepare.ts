import { File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { LongSource, longUris } from '@/lib/longSource';
import { logCaught } from '@/lib/logCaught';
import { OFFLINE_SAMPLE_RATE, offlineMixPlan, stretchJobs, withNormalizeGains, needsWholeWindow, sourceRanges, type DecodedSource, type OfflineMixPlan, type OfflineUnsupported } from '@/lib/offlineMix';
import type { ProgressUpdate } from '@/lib/progress';
import { RenderCancelledError } from '@/lib/render';
import type { Project } from '@/types/project';

import { stretchSegment } from './nativeStretch';

/**
 * a telefonos export felső határa: a hosszú forrás szakaszosan olvasódik (`longSource`), a
 * kimenet a lemezre íródik szeletenként — a korlát a fájlméret (3 óra sztereó 16 bit ≈ 1,9 GB)
 */
export const OFFLINE_MAX_SEC = 3 * 60 * 60;

export interface Prepared {
  plan: OfflineMixPlan;
  sources: Map<string, DecodedSource>;
  prepare: (a: number, b: number) => Promise<void>;
  long: Set<string>;
  unsupported: OfflineUnsupported[];
}

/** a tartomány mintákban (a projekt hosszára szorítva) */
export function frameRange(plan: OfflineMixPlan, range?: { from: number; to: number }): [number, number] {
  const total = Math.round(plan.duration * OFFLINE_SAMPLE_RATE);
  if (!range) return [0, total];
  const a = Math.max(0, Math.min(total, Math.round(range.from * OFFLINE_SAMPLE_RATE)));
  const b = Math.max(a, Math.min(total, Math.round(range.to * OFFLINE_SAMPLE_RATE)));
  return [a, b];
}

/** a források dekódolása, a nyújtott szakaszok és a normalizálás — a kiírás előtti közös rész */
export async function prepareOffline(mix: Project, onProgress?: (u: ProgressUpdate) => void, signal?: AbortSignal): Promise<Prepared> {
  const plan = offlineMixPlan(mix);
  if (plan.duration > OFFLINE_MAX_SEC) {
    throw new Error(tr('studio.audio.offline.tooLong', { minutes: OFFLINE_MAX_SEC / 60 }));
  }
  const api = await loadAudioApi();
  if (!api) {
    throw new Error(tr('studio.audio.offline.noDecoder'));
  }
  const sources = new Map<string, DecodedSource>();
  // a hiányzó fájl elvárt helyzet (újracsatolásra vár), nem programhiba: érthető üzenet, napló nélkül —
  // MINDEN forrásra előre (a hosszú, szakaszos forrás is: eddig csendben néma szakaszt adott)
  for (const u of new Set(plan.clips.map((c) => c.uri))) {
    if (u.startsWith('file:') && !new File(u).exists) {
      throw new Error(tr('studio.audio.offline.decodeFailed', { name: decodeURIComponent(u.split('/').pop() ?? '') }));
    }
  }
  // 🎧 a hosszú forrás szakaszosan (nem dekódolódik egészben); az egész-ablakos feldolgozás
  // (zajszűrés, normalizálás, nyújtás…) hosszú forráson a telefonon nem érhető el
  const long = longUris(plan.clips);
  if (plan.clips.some((c) => long.has(c.uri) && needsWholeWindow(c))) {
    throw new Error(tr('studio.audio.offline.longProcessing'));
  }
  const longSources = new Map([...long].map((u) => [u, new LongSource(u)] as const));
  for (const [u, l] of longSources) sources.set(u, { channels: [], sampleRate: OFFLINE_SAMPLE_RATE, segmented: l });
  const prepare = (a: number, b: number) =>
    Promise.all(sourceRanges(plan, (u) => long.has(u), a, b).map((r) => longSources.get(r.uri)?.ensure(r.from, r.to))).then(() => undefined);
  const uris = [...new Set(plan.clips.map((c) => c.uri))].filter((u) => !long.has(u));
  for (let i = 0; i < uris.length; i++) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    onProgress?.({ phase: tr('studio.audio.offline.decoding'), ratio: (i / uris.length) * 0.4 });
    try {
      const buf = await api.decodeAudioData(uris[i], OFFLINE_SAMPLE_RATE);
      markAudioApi(true);
      // a csatornák átvétele között is a felület jön (egy hosszú forrás csatornája nagy tömb)
      const channels: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        channels.push(buf.getChannelData(c));
      }
      sources.set(uris[i], { channels, sampleRate: buf.sampleRate });
    } catch (caught) {
      logCaught('lib/offlineMixClient.ts:decode', caught);
      throw new Error(tr('studio.audio.offline.decodeFailed', { name: uris[i].split('/').pop() }));
    }
  }

  // ⏩⏪ a gyorsított / visszafelé játszott szakaszok: kivágás, fordítás, hangmagasság-tartó
  // nyújtás a natív motorral (a szerver areverse/atempo-jának megfelelője) — utána 1×-es forrás
  const { jobs, plan: mixPlan } = stretchJobs(plan);
  for (const job of jobs) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    const src = sources.get(job.uri);
    if (src) {
      sources.set(job.key, await stretchSegment(api, src, job));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  // 📏 a klipek normalizálási erősítése (előmenet a kész forrásokon)
  return { plan: withNormalizeGains(mixPlan, sources), sources, prepare, long, unsupported: plan.unsupported };
}
