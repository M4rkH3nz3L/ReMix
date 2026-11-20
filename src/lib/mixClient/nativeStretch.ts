import { loadAudioApi } from '@/lib/audioApiGuard';
import { denoiseStereo } from '@/lib/denoise';
import { OFFLINE_SAMPLE_RATE, sliceSource, type DecodedSource, type StretchJob } from '@/lib/offlineMix';
import { formantCorrect } from '@/lib/formant';

// ⏩⏪ a natív nyújtó (hangmagasság-tartó `OfflineAudioContext`) hídja és késés-kompenzációja

export type AudioApi = NonNullable<Awaited<ReturnType<typeof loadAudioApi>>>;

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
 * ⏱️ A nyújtó késleltetése (kimeneti minta) az adott sebességen — sebességfüggő. Egy tonális
 * burst nyújtása után a kimenet energia-középpontja és a várt helye közti különbség; sebességenként egyszer.
 */
/** 🧪 füstteszt: a mért késés (minta) */
export async function measureStretchLatency(speed: number, cents = 0): Promise<number | null> {
  const api = await loadAudioApi();
  return api ? stretchLatency(api, speed, OFFLINE_SAMPLE_RATE, cents) : null;
}

const latencyCache = new Map<string, number>();
async function stretchLatency(api: AudioApi, speed: number, _sr: number, cents = 0): Promise<number> {
  const id = `${speed}|${cents}`;
  const cached = latencyCache.get(id);
  if (cached !== undefined) {
    return cached;
  }
  // 🎯 a nyújtó késése tonális burstökön (250 Hz + 1 kHz + 3 kHz, 40 ms, Hann), az energia-középpontjuk
  // eltolódása a várt helyhez képest. A késés NEM állandó: az első burstnél nagyobb (beindulás — mérve
  // 0,8333×-en 88,9 ms, utána 78–82 ms). A nyújtás ezért előtöltéssel indul (`STRETCH_PREROLL`), és a
  // BEÁLLT érték (a 2. bursttől a medián) a kompenzáció. (Régen egy impulzus csúcsa volt: ~15 ms-mal
  // túllőtt, a nyújtott klip ütései korábban szóltak.)
  const offs = (await probeStretchTimingWith(api, speed, cents, 6)).slice(1).sort((x, y) => x - y);
  const latency = Math.max(0, offs[offs.length >> 1]);
  latencyCache.set(id, latency);
  return latency;
}

/** tonális burstök 0,5 s-onként (az első 0,25 s-nál) nyújtva — burstönként a kimeneti energia-középpont eltérése a várt helytől (minta) */
async function probeStretchTimingWith(api: AudioApi, speed: number, cents: number, count: number): Promise<number[]> {
  const sr = OFFLINE_SAMPLE_RATE;
  const len = Math.round(0.04 * sr);
  const input = new Float32Array(Math.round((0.5 * count + 0.5) * sr));
  const starts = Array.from({ length: count }, (_, k) => Math.round((0.25 + 0.5 * k) * sr));
  for (const at of starts) {
    for (let i = 0; i < len; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
      const t = i / sr;
      input[at + i] = 0.3 * w * (Math.sin(2 * Math.PI * 250 * t) + Math.sin(2 * Math.PI * 1000 * t) + Math.sin(2 * Math.PI * 3000 * t));
    }
  }
  const out = (await renderStretched(api, [input], speed, Math.round((input.length / sr / speed + 0.5) * sr), sr, cents))[0];
  return starts.map((at) => {
    const exp = (at + (len - 1) / 2) / speed;
    let e = 0;
    let te = 0;
    for (let i = Math.max(0, Math.round(exp - 0.1 * sr)); i < Math.min(out.length, Math.round(exp + 0.2 * sr)); i++) {
      const p = out[i] * out[i];
      e += p;
      te += i * p;
    }
    return e > 0 ? Math.round(te / e - exp) : 0;
  });
}

/** 🧪 füstteszt: a nyújtó burstönkénti késése (minta) */
export async function probeStretchTiming(speed: number, count = 6): Promise<number[] | null> {
  const api = await loadAudioApi();
  return api ? probeStretchTimingWith(api, speed, 0, count) : null;
}

/** a nyújtás előtöltése (mp): a beindulási tranziens ide esik, a kimenetből levágva */
const STRETCH_PREROLL = 0.5;

/**
 * 🎤 V3.2: egy puffer hangmagasságának eltolása (cent) a hossz megtartásával — a natív nyújtóval, a késése
 * kompenzálva (mint a `stretchSegment`); az előtöltés csend. `null`, ha nincs natív hang-motor.
 */
export async function pitchShiftBuffer(input: Float32Array[], cents: number, sr = OFFLINE_SAMPLE_RATE): Promise<Float32Array[] | null> {
  const api = await loadAudioApi();
  if (!api) return null;
  const n = input[0]?.length ?? 0;
  if (n === 0 || cents === 0) return input.map((ch) => Float32Array.from(ch));
  const lat = await stretchLatency(api, 1, sr, Math.round(cents));
  const pre = Math.round(STRETCH_PREROLL * sr);
  const padded = input.map((ch) => {
    const x = new Float32Array(pre + n + lat);
    x.set(ch, pre);
    return x;
  });
  const out = await renderStretched(api, padded, 1, pre + n + lat, sr, Math.round(cents));
  return out.map((ch) => ch.slice(pre + lat, pre + lat + n));
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
  // 🗣️ V7.3: formáns-korrekció — a tolt szakasz a tolatlan, ugyanígy nyújtott referencia burkolójára
  // (1-es sebességnél a referencia maga a forrás-ablak; a `formant.ts` bitre a szerveré)
  if (job.formant && cents !== 0) {
    const shifted = await stretchSegment(api, src, { ...job, formant: false, denoise: false });
    const ref =
      job.speed === 1
        ? sliceSource(src.channels, Math.round(job.from * sr), shifted.channels[0].length, job.reversed)
        : (await stretchSegment(api, src, { ...job, pitch: 0, formant: false, denoise: false })).channels;
    return finish(shifted.channels.map((ch, c) => formantCorrect(ref[c] ?? ref[0], ch, sr)));
  }
  const lat = await stretchLatency(api, job.speed, sr, cents);
  // a kimenet `lat` mintával késik: elejéről ennyi esik le, ezért a bemenet a VÉGÉN hosszabb
  // (a forrás következő részével; a megfordított ablaké a forrásban előtte van). Az ELEJÉN előtöltés
  // (a lejátszás irányában az ablak előtti forrás; a forráson kívül csend): a nyújtó beindulási
  // késése ide esik, a kimenetből levágva — így a szakasz eleje is a beállt késéssel szól.
  const extra = Math.round(lat * job.speed);
  const pre = Math.round(STRETCH_PREROLL * sr);
  const from = Math.round(job.from * sr);
  const slice = job.reversed ? sliceSource(src.channels, from - extra, n + extra + pre, true) : sliceSource(src.channels, from - pre, n + extra + pre, false);
  const outLen = Math.round(job.duration * sr);
  const preOut = Math.round(pre / job.speed);
  const out = await renderStretched(api, slice, job.speed, preOut + outLen + lat, sr, cents);
  return finish(out.map((ch) => ch.slice(preOut + lat, preOut + lat + outLen)));
}
