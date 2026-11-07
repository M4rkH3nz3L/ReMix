import { loadAudioApi } from '@/lib/audioApiGuard';
import type { DrumVoice } from '@/lib/drums';
import { drumVoicePcm, INSTRUMENT_SR, renderSynthPcm } from '@/lib/instrumentRender';
import { logCaught } from '@/lib/logCaught';
import type { SynthWave } from '@/lib/synth';

/**
 * 🎧 A hangszerek élő előhallgatása a telefonon (offline): a tiszta mag PCM-je azonnal szól egy
 * saját hangkontextusban — a cellára koppintva a hang/dob, a „▶” a teljes minta (loopolva). Ugyanaz
 * a PCM, amit a „Sávra” beéget: azt hallod, ami a sávra kerül.
 */

type Api = NonNullable<Awaited<ReturnType<typeof loadAudioApi>>>;
type Ctx = InstanceType<Api['AudioContext']>;
type Source = ReturnType<Ctx['createBufferSource']>;

let api: Api | null = null;
let ctx: Ctx | null = null;
let loopSrc: Source | null = null;
let loopStartedAt = 0;
let loopLen = 0;
/** 🧪 mérés: az utolsó indítás késése (ms, hívás → start) */
export let lastStartMs = 0;

async function context(): Promise<Ctx | null> {
  if (!api) {
    api = await loadAudioApi();
    if (!api) return null;
    try {
      // az iOS hang-munkamenetet az expo-audio kezeli (mint az előnézeti motornál)
      api.AudioManager.disableSessionManagement();
    } catch (caught) {
      logCaught('lib/instrumentPreview.ts:session', caught);
    }
  }
  if (!ctx) ctx = new api.AudioContext({ sampleRate: INSTRUMENT_SR });
  await ctx.resume();
  return ctx;
}

/**
 * a hangkontextus előkészítése (a lap megnyitásakor): az első koppintás így nem a kontextus
 * létrehozására vár (mérve: hideg indításnál 151 ms, előkészítve néhány ms)
 */
export async function warmPreview(): Promise<boolean> {
  return (await context()) !== null;
}

/**
 * PCM lejátszása; `loop`: a korábbi loop helyére lép — szerkesztés közben a lejátszófej helyéről
 * folytatva (`resume`), így az új minta megszakítás nélkül szól tovább. @returns elindult-e
 */
export async function playPcm(stereo: Float32Array[], loop = false, resume = false): Promise<boolean> {
  const t0 = Date.now();
  try {
    const c = await context();
    if (!c || stereo[0].length === 0) return false;
    const buf = c.createBuffer(2, stereo[0].length, INSTRUMENT_SR);
    buf.copyToChannel(stereo[0] as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel((stereo[1] ?? stereo[0]) as Float32Array<ArrayBuffer>, 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(c.destination);
    let offset = 0;
    if (loop) {
      const len = stereo[0].length / INSTRUMENT_SR;
      const at = resume ? previewPosition() : null;
      offset = at !== null ? at % len : 0;
      stopPreview();
      loopSrc = src;
      loopLen = len;
      loopStartedAt = c.currentTime - offset;
    }
    src.start(0, offset);
    lastStartMs = Date.now() - t0;
    return true;
  } catch (caught) {
    logCaught('lib/instrumentPreview.ts:playPcm', caught);
    return false;
  }
}

/** a loop leállítása */
export function stopPreview(): void {
  if (!loopSrc) return;
  try {
    loopSrc.stop();
  } catch (caught) {
    logCaught('lib/instrumentPreview.ts:stop', caught);
  }
  loopSrc = null;
}

/** szól-e a loop */
export const previewLooping = (): boolean => loopSrc !== null;

/** a loop lejátszófeje (mp a minta elejétől), vagy null */
export function previewPosition(): number | null {
  if (!loopSrc || !ctx || loopLen <= 0) return null;
  return (ctx.currentTime - loopStartedAt) % loopLen;
}

const noteCache = new Map<string, Float32Array[]>();
/** egy hang megszólaltatása (fél beat) — a cellára koppintáskor */
export function auditionNote(midi: number, wave: SynthWave, bpm: number): Promise<boolean> {
  const key = `${midi}|${wave}|${bpm}`;
  let pcm = noteCache.get(key);
  if (!pcm) {
    pcm = renderSynthPcm([{ id: 'a', midi, startBeat: 0, lengthBeats: 0.5 }], wave, bpm);
    noteCache.set(key, pcm);
  }
  return playPcm(pcm);
}

const drumCache = new Map<DrumVoice, Float32Array[]>();
/** egy dob-hang megszólaltatása */
export function auditionDrum(voice: DrumVoice): Promise<boolean> {
  let pcm = drumCache.get(voice);
  if (!pcm) {
    const x = drumVoicePcm(voice);
    pcm = [x, x];
    drumCache.set(voice, pcm);
  }
  return playPcm(pcm);
}
