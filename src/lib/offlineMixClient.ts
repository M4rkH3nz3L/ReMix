import { File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import type { FxState } from '@/lib/audioDsp';
import { denoiseStereo } from '@/lib/denoise';
import { LongSource, longUris } from '@/lib/longSource';
import { hasRoomFor, isDiskFullError, megabytes } from '@/lib/diskSpace';
import { freeDiskBytes } from '@/lib/diskSpaceClient';
import { logCaught } from '@/lib/logCaught';
import { mixRange, OFFLINE_SAMPLE_RATE, offlineMixPlan, pcm16, pcm24, sliceSource, stretchJobs, wavHeader16, wavHeader24, wavHeaderF32, pcmF32, withNormalizeGains, measureMasterGain, needsWholeWindow, sourceRanges, type DecodedSource, type OfflineMixPlan, type OfflineUnsupported, type StretchJob } from '@/lib/offlineMix';
import { ZipStoreWriter } from '@/lib/zipStore';
import type { ProgressUpdate } from '@/lib/progress';
import { RenderCancelledError } from '@/lib/render';
import type { Project } from '@/types/project';

/**
 * a telefonos export felső határa: a hosszú forrás szakaszosan olvasódik (`longSource`), a
 * kimenet a lemezre íródik szeletenként — a korlát a fájlméret (3 óra sztereó 16 bit ≈ 1,9 GB)
 */
export const OFFLINE_MAX_SEC = 3 * 60 * 60;
const CHUNK_SEC = 0.25;
/** egy szeletben legfeljebb ennyi munka, utána a felület jön (60 Hz-en egy képkocka ~16 ms) */
const FRAME_BUDGET_MS = 12;

/** WAV-mélység: 16 bit (TPDF-dither), 24 bit, vagy 32 bites lebegőpontos (a Pro köztes keveréke) */
export type WavBits = 16 | 24 | 32;

export interface OfflineExportOptions {
  /** ✂️ csak ez a tartomány (mp) — a keverés az elejétől fut, így a tartomány mintára az, ami a teljes exportban ott szól */
  range?: { from: number; to: number };
  bits?: WavBits;
}

interface Prepared {
  plan: OfflineMixPlan;
  sources: Map<string, DecodedSource>;
  prepare: (a: number, b: number) => Promise<void>;
  long: Set<string>;
  unsupported: OfflineUnsupported[];
}

const bytesPerSample = (bits: WavBits) => bits / 8;
const wavHeader = (bits: WavBits, frames: number) =>
  bits === 32 ? wavHeaderF32(frames, 2, OFFLINE_SAMPLE_RATE) : bits === 24 ? wavHeader24(frames, 2, OFFLINE_SAMPLE_RATE) : wavHeader16(frames, 2, OFFLINE_SAMPLE_RATE);
const wavData = (bits: WavBits, out: Float32Array[]) => (bits === 32 ? pcmF32(out) : bits === 24 ? pcm24(out) : pcm16(out));

/** a tartomány mintákban (a projekt hosszára szorítva) */
function frameRange(plan: OfflineMixPlan, range?: { from: number; to: number }): [number, number] {
  const total = Math.round(plan.duration * OFFLINE_SAMPLE_RATE);
  if (!range) return [0, total];
  const a = Math.max(0, Math.min(total, Math.round(range.from * OFFLINE_SAMPLE_RATE)));
  const b = Math.max(a, Math.min(total, Math.round(range.to * OFFLINE_SAMPLE_RATE)));
  return [a, b];
}

/** a források dekódolása, a nyújtott szakaszok és a normalizálás — a kiírás előtti közös rész */
async function prepareOffline(mix: Project, onProgress?: (u: ProgressUpdate) => void, signal?: AbortSignal): Promise<Prepared> {
  const plan = offlineMixPlan(mix);
  if (plan.duration > OFFLINE_MAX_SEC) {
    throw new Error(tr('studio.audio.offline.tooLong', { minutes: OFFLINE_MAX_SEC / 60 }));
  }
  const api = await loadAudioApi();
  if (!api) {
    throw new Error(tr('studio.audio.offline.noDecoder'));
  }
  const sources = new Map<string, DecodedSource>();
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
  // 📏 a klipek normalizálási erősítése (előmenet a kész forrásokon)
  return { plan: withNormalizeGains(mixPlan, sources), sources, prepare, long, unsupported: plan.unsupported };
}

/**
 * A keverés darabonként 0-tól `b`-ig; az `[a, b)` darabjai mennek az `onOut`-ba. A keverés mindig
 * 0-tól fut (az effektek, a halkítás és a master állapota így pontosan az, ami a teljes exportban).
 */
async function mixLoop(
  prep: Prepared,
  plan: OfflineMixPlan,
  [a, b]: [number, number],
  onOut: (l: Float32Array, r: Float32Array) => void,
  onRatio: (r: number) => void,
  signal?: AbortSignal
): Promise<void> {
  // 🎛️ az effektek állapota szeletről szeletre megmarad (folytonos szűrés)
  const fxState = new Map<string, FxState>();
  // T2: időkeretes feldolgozás — negyed mp-es darabok, és ~12 ms munka után mindig visszaadjuk
  // a vezérlést (mérve: az 5 mp-es darabok 392 ms-ig fogták a felületet, látható akadás)
  const chunk = Math.round(CHUNK_SEC * OFFLINE_SAMPLE_RATE);
  let sliceStart = Date.now();
  for (let from = 0; from < b; from += chunk) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    const to = Math.min(b, from + chunk);
    if (prep.long.size > 0) {
      await prep.prepare(from, to);
    }
    const out: [Float32Array, Float32Array] = [new Float32Array(to - from), new Float32Array(to - from)];
    mixRange(plan, prep.sources, out, from, to, 1, fxState);
    if (to > a) {
      const skip = Math.max(0, a - from);
      onOut(skip > 0 ? out[0].subarray(skip) : out[0], skip > 0 ? out[1].subarray(skip) : out[1]);
    }
    if (Date.now() - sliceStart >= FRAME_BUDGET_MS) {
      onRatio(to / b);
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }
}

/** a keverés WAV-ként a `write`-ba: fejléc + a `[a, b)` minták */
async function writeWav(
  prep: Prepared,
  plan: OfflineMixPlan,
  range: [number, number],
  bits: WavBits,
  write: (bytes: Uint8Array) => void,
  onRatio: (r: number) => void,
  signal?: AbortSignal
): Promise<void> {
  write(wavHeader(bits, range[1] - range[0]));
  await mixLoop(prep, plan, range, (l, r) => write(wavData(bits, [l, r])), onRatio, signal);
}

/**
 * 🩺 A keverés darabonként a hívónak (fájl nélkül) — a hangellenőrzés ugyanazt a keverést méri,
 * amit az export kiír (masterrel együtt).
 */
export async function streamOfflineMix(
  mix: Project,
  onChunk: (l: Float32Array, r: Float32Array) => void,
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<void> {
  const prep = await prepareOffline(mix, onProgress, signal);
  const plan = prep.plan.master
    ? { ...prep.plan, masterGain: await measureMasterGain(prep.plan, prep.sources, signal ?? undefined, prep.prepare) }
    : prep.plan;
  await mixLoop(prep, plan, frameRange(plan), onChunk, (r) => onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * r }), signal);
}

/** a kimeneti fájl írása (hiba esetén a félkész fájl törlődik, a betelt lemez érthető üzenet) */
async function withTargetFile(target: File, needed: number, body: (write: (bytes: Uint8Array) => void) => Promise<void>): Promise<void> {
  if (target.exists) {
    target.delete();
  }
  target.create();
  const handle = target.open();
  try {
    await body((bytes) => handle.writeBytes(bytes));
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
}

/** 💾 elfér-e (a WAV mérete előre ismert): ha nem, a dekódolás el sem indul */
function ensureRoom(needed: number): void {
  const free = freeDiskBytes();
  if (!hasRoomFor(needed, free)) {
    throw new Error(tr('studio.audio.offline.noSpace', { need: megabytes(needed), free: megabytes(free) }));
  }
}

/**
 * 🎧📱 PRO-AUDIO A26: a hang-mix WAV-ként, TELJESEN a telefonon (Free, szerver nélkül). A
 * források a natív dekóderrel 44,1 kHz-re dekódolódnak, a keverés a `offlineMix` pure magja
 * (a szerveres renderrel paritás-tesztelt), a WAV darabonként íródik a fájlba.
 */
export async function exportOfflineWav(
  mix: Project,
  target: File,
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal,
  /** `float32`: a Pro szerveres export köztes keveréke (veszteségmentes) */
  format: 'pcm16' | 'float32' = 'pcm16',
  opts: OfflineExportOptions = {}
): Promise<{ uri: string; unsupported: OfflineUnsupported[] }> {
  const bits: WavBits = format === 'float32' ? 32 : (opts.bits ?? 16);
  const draft = offlineMixPlan(mix);
  const [a, b] = frameRange(draft, opts.range);
  const needed = 44 + (b - a) * 2 * bytesPerSample(bits);
  ensureRoom(needed);
  const prep = await prepareOffline(mix, onProgress, signal);
  // 📏 a master mérése (kétmenetes) — a teljes projekten, a tartomány is ugyanazt a szintet kapja
  const finalPlan = prep.plan.master
    ? { ...prep.plan, masterGain: await measureMasterGain(prep.plan, prep.sources, signal ?? undefined, prep.prepare) }
    : prep.plan;
  if (signal?.aborted) {
    throw new RenderCancelledError();
  }
  await withTargetFile(target, needed, (write) =>
    writeWav(prep, finalPlan, [a, b], bits, write, (r) => onProgress?.({ phase: tr('studio.audio.offline.mixing'), ratio: 0.4 + 0.6 * r }), signal)
  );
  return { uri: target.uri, unsupported: prep.unsupported };
}

/** egy stem: a sáv típusa és a fájl neve a csomagban */
export interface StemSpec {
  track: string;
  name: string;
}

/**
 * 🎚️ Sávonkénti (stem) export a telefonon, egy STORE-zipbe (folyamatosan írva — a memóriában
 * sosem egy egész fájl). Minden stem a teljes keverésből jön, csak a saját sávja szól: a
 * klip-effektek, a sáv szintje, a buszra küldött része és a halkítás (a többi sáv beszéde
 * vezérli) benne van; a master-lánc nincs — a stemek összege a keverés master nélkül.
 */
export async function exportOfflineStems(
  mix: Project,
  target: File,
  stems: StemSpec[],
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal,
  opts: OfflineExportOptions = {}
): Promise<{ uri: string; files: string[] }> {
  const bits: WavBits = opts.bits ?? 16;
  const draft = offlineMixPlan(mix);
  const [a, b] = frameRange(draft, opts.range);
  const needed = stems.length * (44 + (b - a) * 2 * bytesPerSample(bits)) + 4096;
  ensureRoom(needed);
  const prep = await prepareOffline(mix, onProgress, signal);
  const zip = new ZipStoreWriter();
  const files: string[] = [];
  await withTargetFile(target, needed, async (write) => {
    for (let k = 0; k < stems.length; k++) {
      const name = `${stems[k].name}.wav`;
      files.push(name);
      write(zip.beginFile(name));
      const plan: OfflineMixPlan = { ...prep.plan, master: undefined, masterGain: undefined, solo: [stems[k].track] };
      await writeWav(prep, plan, [a, b], bits, (bytes) => write(zip.chunk(bytes)), (r) => onProgress?.({ phase: tr('studio.audio.offline.stems', { name: stems[k].name, n: k + 1, of: stems.length }), ratio: 0.4 + 0.6 * ((k + r) / stems.length) }), signal);
      write(zip.endFile());
    }
    write(zip.finish());
  });
  return { uri: target.uri, files };
}

type AudioApi = NonNullable<Awaited<ReturnType<typeof loadAudioApi>>>;

/** a natív nyújtás egy futása: `input` csatornái `speed`-del, `length` kimeneti mintára */
async function renderStretched(api: AudioApi, input: Float32Array[], speed: number, length: number, sr: number, cents = 0): Promise<Float32Array[]> {
  const ctx = new api.OfflineAudioContext({ numberOfChannels: input.length, length: Math.max(1, length), sampleRate: sr });
  const buf = ctx.createBuffer(input.length, Math.max(1, input[0].length), sr);
  input.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  const node = ctx.createBufferSource({ pitchCorrection: true });
  node.buffer = buf;
  node.playbackRate.value = speed;
  node.detune.value = cents;
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
/** 🧪 füstteszt: a mért késés (minta) */
export async function measureStretchLatency(speed: number, cents = 0): Promise<number | null> {
  const api = await loadAudioApi();
  return api ? stretchLatency(api, speed, OFFLINE_SAMPLE_RATE, cents) : null;
}

const latencyCache = new Map<string, number>();
async function stretchLatency(api: AudioApi, speed: number, sr: number, cents = 0): Promise<number> {
  const id = `${speed}|${cents}`;
  const cached = latencyCache.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const at = Math.round(0.25 * sr);
  const click = new Float32Array(Math.round(1 * sr));
  for (let i = 0; i < 32; i++) click[at + i] = Math.sin((Math.PI * i) / 32);
  const out = (await renderStretched(api, [click], speed, Math.round((1 / speed + 0.5) * sr), sr, cents))[0];
  let peak = 0;
  for (let i = 1; i < out.length; i++) if (Math.abs(out[i]) > Math.abs(out[peak])) peak = i;
  const latency = Math.max(0, peak - Math.round(at / speed));
  latencyCache.set(id, latency);
  return latency;
}

/**
 * Egy szakasz nyújtása: a natív `OfflineAudioContext` hangmagasság-tartó (`pitchCorrection`)
 * forrása `speed`-del játssza le a kivágott (és igény szerint megfordított) ablakot, a
 * hangmagasságot `detune` tolja el (a hossz marad — eszközön mérve). A nyújtó
 * késleltetését kompenzáljuk: a kimenet elejéről a késés leesik, a bemenet a végén ennyivel
 * hosszabb — így a kimenet pontosan `duration` hosszú és a helyén szól.
 */
export async function stretchSegment(api: AudioApi, src: DecodedSource, job: StretchJob): Promise<DecodedSource> {
  const sr = src.sampleRate;
  const n = Math.max(1, Math.round(job.sourceSec * sr));
  const cents = Math.round((job.pitch ?? 0) * 100);
  // 🧹 a zajszűrés a kész (nyújtott) szakaszon fut — az egész szakaszból becsült zajprofillal
  const finish = async (channels: Float32Array[]): Promise<DecodedSource> => {
    if (!job.denoise) {
      return { channels, sampleRate: sr };
    }
    const [l, r] = await denoiseStereo(channels[0], channels[1] ?? channels[0]);
    return { channels: [l, r], sampleRate: sr };
  };

  if (job.speed === 1 && cents === 0) {
    return finish(sliceSource(src.channels, Math.round(job.from * sr), n, job.reversed));
  }
  const lat = await stretchLatency(api, job.speed, sr, cents);
  // a kimenet `lat` mintával késik: elejéről ennyi esik le, ezért a bemenet a VÉGÉN hosszabb
  // (a forrás következő részével; a megfordított ablaké a forrásban előtte van)
  const extra = Math.round(lat * job.speed);
  const from = Math.round(job.from * sr);
  const slice = job.reversed ? sliceSource(src.channels, from - extra, n + extra, true) : sliceSource(src.channels, from, n + extra, false);
  const outLen = Math.round(job.duration * sr);
  const out = await renderStretched(api, slice, job.speed, outLen + lat, sr, cents);
  return finish(out.map((ch) => ch.slice(lat, lat + outLen)));
}
