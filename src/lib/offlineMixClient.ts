import { File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { hasRoomFor, isDiskFullError, megabytes, wavBytes } from '@/lib/diskSpace';
import { freeDiskBytes } from '@/lib/diskSpaceClient';
import { logCaught } from '@/lib/logCaught';
import { mixRange, OFFLINE_SAMPLE_RATE, offlineMixPlan, pcm16, sliceSource, stretchJobs, wavHeader16, type DecodedSource, type OfflineUnsupported, type StretchJob } from '@/lib/offlineMix';
import type { ProgressUpdate } from '@/lib/progress';
import { RenderCancelledError } from '@/lib/render';
import type { Project } from '@/types/project';

/** a telefonos export felső határa (a dekódolt források a memóriában vannak) */
export const OFFLINE_MAX_SEC = 20 * 60;
const CHUNK_SEC = 0.25;
/** egy szeletben legfeljebb ennyi munka, utána a felület jön (60 Hz-en egy képkocka ~16 ms) */
const FRAME_BUDGET_MS = 12;

/**
 * 🎧📱 PRO-AUDIO A26: a hang-mix WAV-ként, TELJESEN a telefonon (Free, szerver nélkül). A
 * források a natív dekóderrel 44,1 kHz-re dekódolódnak, a keverés a `offlineMix` pure magja
 * (a szerveres renderrel paritás-tesztelt), a WAV darabonként íródik a fájlba.
 */
export async function exportOfflineWav(
  mix: Project,
  target: File,
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<{ uri: string; unsupported: OfflineUnsupported[] }> {
  const plan = offlineMixPlan(mix);
  if (plan.duration > OFFLINE_MAX_SEC) {
    throw new Error(tr('studio.audio.offline.tooLong', { minutes: OFFLINE_MAX_SEC / 60 }));
  }
  // 💾 a WAV mérete előre ismert: ha nem fér el, a dekódolás el sem indul
  const needed = wavBytes(Math.round(plan.duration * OFFLINE_SAMPLE_RATE), 2);
  const free = freeDiskBytes();
  if (!hasRoomFor(needed, free)) {
    throw new Error(tr('studio.audio.offline.noSpace', { need: megabytes(needed), free: megabytes(free) }));
  }
  const api = await loadAudioApi();
  if (!api) {
    throw new Error(tr('studio.audio.offline.noDecoder'));
  }
  const sources = new Map<string, DecodedSource>();
  const uris = [...new Set(plan.clips.map((c) => c.uri))];
  for (let i = 0; i < uris.length; i++) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    onProgress?.({ phase: tr('studio.audio.offline.decoding'), ratio: (i / uris.length) * 0.4 });
    // a hiányzó fájl elvárt helyzet (újracsatolásra vár), nem programhiba: érthető üzenet, napló nélkül
    if (uris[i].startsWith('file:') && !new File(uris[i]).exists) {
      throw new Error(tr('studio.audio.offline.decodeFailed', { name: decodeURIComponent(uris[i].split('/').pop() ?? '') }));
    }
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

  const frames = Math.round(plan.duration * OFFLINE_SAMPLE_RATE);
  if (target.exists) {
    target.delete();
  }
  target.create();
  const handle = target.open();
  try {
    handle.writeBytes(wavHeader16(frames, 2, OFFLINE_SAMPLE_RATE));
    // T2: időkeretes feldolgozás — negyed mp-es darabok, és ~12 ms munka után mindig visszaadjuk
    // a vezérlést (mérve: az 5 mp-es darabok 392 ms-ig fogták a felületet, látható akadás)
    const chunk = Math.round(CHUNK_SEC * OFFLINE_SAMPLE_RATE);
    let sliceStart = Date.now();
    for (let from = 0; from < frames; from += chunk) {
      if (signal?.aborted) {
        throw new RenderCancelledError();
      }
      const to = Math.min(frames, from + chunk);
      const out: [Float32Array, Float32Array] = [new Float32Array(to - from), new Float32Array(to - from)];
      mixRange(mixPlan, sources, out, from, to);
      handle.writeBytes(pcm16(out));
      if (Date.now() - sliceStart >= FRAME_BUDGET_MS) {
        onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * (to / frames) });
        await new Promise((resolve) => setTimeout(resolve, 0));
        sliceStart = Date.now();
      }
    }
  } catch (caught) {
    handle.close();
    try {
      target.delete();
    } catch (cleanup) {
      logCaught('lib/offlineMixClient.ts:cleanup', cleanup);
    }
    // menet közben betelt (más app is írt): érthető üzenet a natív hiba helyett
    if (isDiskFullError(caught)) {
      throw new Error(tr('studio.audio.offline.noSpace', { need: megabytes(needed), free: megabytes(freeDiskBytes()) }));
    }
    throw caught;
  }
  handle.close();
  return { uri: target.uri, unsupported: plan.unsupported };
}

type AudioApi = NonNullable<Awaited<ReturnType<typeof loadAudioApi>>>;

/** a natív nyújtás egy futása: `input` csatornái `speed`-del, `length` kimeneti mintára */
async function renderStretched(api: AudioApi, input: Float32Array[], speed: number, length: number, sr: number): Promise<Float32Array[]> {
  const ctx = new api.OfflineAudioContext({ numberOfChannels: input.length, length: Math.max(1, length), sampleRate: sr });
  const buf = ctx.createBuffer(input.length, Math.max(1, input[0].length), sr);
  input.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  const node = ctx.createBufferSource({ pitchCorrection: true });
  node.buffer = buf;
  node.playbackRate.value = speed;
  node.connect(ctx.destination);
  node.start(0);
  const out = await ctx.startRendering();
  return Array.from({ length: out.numberOfChannels }, (_, c) => out.getChannelData(c));
}

/**
 * ⏱️ A nyújtó késleltetése (kimeneti minta) az adott sebességen — mérve: 2×-en ~55 ms, 0,5×-en
 * ~115 ms (iPad), tehát sebességfüggő. Egy rövid kattanás nyújtása után a kimenet csúcsa és a
 * várt helye közti különbség; sebességenként egyszer.
 */
const latencyCache = new Map<number, number>();
/** 🧪 füstteszt: a mért késés (minta) és a kattanás-kimenet csúcsa */
export async function measureStretchLatency(speed: number): Promise<number | null> {
  const api = await loadAudioApi();
  return api ? stretchLatency(api, speed, OFFLINE_SAMPLE_RATE) : null;
}

async function stretchLatency(api: AudioApi, speed: number, sr: number): Promise<number> {
  const cached = latencyCache.get(speed);
  if (cached !== undefined) {
    return cached;
  }
  const at = Math.round(0.25 * sr);
  const click = new Float32Array(Math.round(1 * sr));
  for (let i = 0; i < 32; i++) click[at + i] = Math.sin((Math.PI * i) / 32);
  const out = (await renderStretched(api, [click], speed, Math.round((1 / speed + 0.5) * sr), sr))[0];
  let peak = 0;
  for (let i = 1; i < out.length; i++) if (Math.abs(out[i]) > Math.abs(out[peak])) peak = i;
  const latency = Math.max(0, peak - Math.round(at / speed));
  latencyCache.set(speed, latency);
  return latency;
}

/**
 * Egy szakasz nyújtása: a natív `OfflineAudioContext` hangmagasság-tartó (`pitchCorrection`)
 * forrása `speed`-del játssza le a kivágott (és igény szerint megfordított) ablakot. A nyújtó
 * késleltetését kompenzáljuk: a kimenet elejéről a késés leesik, a bemenet a végén ennyivel
 * hosszabb — így a kimenet pontosan `duration` hosszú és a helyén szól.
 */
export async function stretchSegment(api: AudioApi, src: DecodedSource, job: StretchJob): Promise<DecodedSource> {
  const sr = src.sampleRate;
  const n = Math.max(1, Math.round(job.sourceSec * sr));
  if (job.speed === 1) {
    return { channels: sliceSource(src.channels, Math.round(job.from * sr), n, job.reversed), sampleRate: sr };
  }
  const lat = await stretchLatency(api, job.speed, sr);
  // a kimenet `lat` mintával késik: elejéről ennyi esik le, ezért a bemenet a VÉGÉN hosszabb
  // (a forrás következő részével; a megfordított ablaké a forrásban előtte van)
  const extra = Math.round(lat * job.speed);
  const from = Math.round(job.from * sr);
  const slice = job.reversed ? sliceSource(src.channels, from - extra, n + extra, true) : sliceSource(src.channels, from, n + extra, false);
  const outLen = Math.round(job.duration * sr);
  const out = await renderStretched(api, slice, job.speed, outLen + lat, sr);
  return { channels: out.map((ch) => ch.slice(lat, lat + outLen)), sampleRate: sr };
}
