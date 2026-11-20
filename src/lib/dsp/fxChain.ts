import { fxStageOrder, type FxStage } from '@/lib/fxOrder';
import { delayTimeMs, EQ_BAND_SPEC, eqBandParams } from '@/lib/fxParams';
import type { AudioFx, Keyframe } from '@/types/project';
import { dbToLin, Gain, type Processor } from '@/lib/dsp/processor';
import { AutoBiquad, highpass, highpassCoeffs, lowpass, lowpassCoeffs, peaking, peakingCoeffs } from '@/lib/dsp/filters';
import { Compressor, DeEsser, Gate, Limiter, type Ducker } from '@/lib/dsp/dynamics';
import { Echo, Haas } from '@/lib/dsp/delays';

/** 🎛️ A klip effekt-lánca: támogatottság, Voice Studio-csomagok, automáció, futó állapot. */

/** a normalizálás célja (a szerver `loudnorm=I=-16:TP=-1.5`-e) */
export const NORMALIZE_LUFS = -16;
export const NORMALIZE_PEAK_DB = -1.5;

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** a közös DSP-ben már megvalósított effektek */
const SUPPORTED = new Set<keyof AudioFx>(['order', 'highpass', 'lowpass', 'eq', 'gate', 'deEsser', 'compressor', 'limiter', 'reverb', 'delay', 'stereoWide', 'pitchSemitones', 'harmony', 'normalize', 'denoise', 'delayBeats', 'delayMs', 'formant']);

/** van-e a klipen olyan effekt, amit a közös DSP még nem tud (akkor a régi úton szól) */
export function fxUnsupported(fx: AudioFx | undefined): boolean {
  if (!fx) {
    return false;
  }
  return (Object.keys(fx) as (keyof AudioFx)[]).some((k) => {
    const v = fx[k];
    const active = typeof v === 'object' && v !== null ? Object.values(v).some((x) => x) : !!v;
    return active && !SUPPORTED.has(k);
  });
}

/** van-e a klipen bármilyen (támogatott) effekt */
export function fxActive(fx: AudioFx | undefined): boolean {
  return buildFxChain(fx, 44100).length > 0 || !!fx?.denoise || !!fx?.pitchSemitones || !!fx?.harmony;
}

/**
 * 🎙️ A Voice Studio egygombos csomagjai a közös DSP elemeiből (a szerver `voicechain.js`
 * tükre): hangjavítás = 75 Hz-es felüláteresztő + zajszűrés + de-esser + kompresszor
 * (−18 dB, 3:1) + −16 LUFS; visszhang-csökkentés = zajszűrés + kapu + −3 dB 300 Hz-en. A klip
 * saját effektjei megmaradnak (a felüláteresztőből a nagyobb érvényes).
 */
export function voiceFx(fx: AudioFx | undefined, enhance: boolean, deReverb: boolean): AudioFx | undefined {
  if (!enhance && !deReverb) {
    return fx;
  }
  const out: AudioFx = { ...(fx ?? {}), denoise: true };
  if (enhance) {
    out.highpass = Math.max(out.highpass ?? 0, 75);
    out.deEsser = true;
    out.compressor = true;
    out.normalize = true;
  }
  return out;
}

/**
 * A klip effekt-lánca a szerver sorrendjében (szűrők → EQ). Üres = nincs feldolgozás. A
 * paraméter-szorítás a szerverével azonos.
 */
/** 🎛️ a klip effekt-automációs görbéi */
export interface FxAutomation {
  fxLowpass?: Keyframe[];
  fxHighpass?: Keyframe[];
  fxReverb?: Keyframe[];
  fxDelay?: Keyframe[];
  fxEqLow?: Keyframe[];
  fxEqMid?: Keyframe[];
  fxEqHigh?: Keyframe[];
  fxEqLowFreq?: Keyframe[];
  fxEqMidFreq?: Keyframe[];
  fxEqHighFreq?: Keyframe[];
}

export const FX_AUTO_KEYS = ['fxLowpass', 'fxHighpass', 'fxReverb', 'fxDelay', 'fxEqLow', 'fxEqMid', 'fxEqHigh', 'fxEqLowFreq', 'fxEqMidFreq', 'fxEqHighFreq'] as const;

export function buildFxChain(fx: AudioFx | undefined, sr: number, normGain = 1, deReverb = false, auto?: FxAutomation): Processor[] {
  const has = (k: keyof FxAutomation) => (auto?.[k]?.length ?? 0) > 0;
  if (!fx && !deReverb && !FX_AUTO_KEYS.some(has)) {
    return [];
  }
  fx = fx ?? {};
  const chain: Processor[] = [];
  // 🏚️ visszhang-csökkentés (a szerver `dereverbChain`-je): lágy kapu a lecsengő farokra és a
  // „dobozos” alsó-közép sáv visszavétele (a zajszűrés-része a szakasz-előmenetben fut)
  if (deReverb) {
    chain.push(new Gate(0.02, 2.5, 8, 90, 0.06, sr), peaking(300, -3, sr, 1.2));
  }
  // 🎛️ automatizált paraméternél a görbe szól (a statikus érték az alap); a szorítás a statikussal azonos
  const f = fx;
  const hpF = (v: number) => clampN(v, 20, 2000);
  const lpF = (v: number) => clampN(v, 1000, 20000);
  const g = (v: number | undefined) => clampN(v || 0, -12, 12);
  // 🎛️ V7: sávonként a frekvencia és a Q is (a szerver `equalizer=f=…:w=…` tükre — `fxParams.ts`)
  const eqBands = eqBandParams(f.eq);
  const band = (key: 'fxEqLow' | 'fxEqMid' | 'fxEqHigh', i: number) => {
    const { freq, q, gain } = eqBands[i];
    // 🎛️ V7.4: a frekvencia is automatizálható (söprés) — a tartomány a sávé
    const fKey = `${key}Freq` as 'fxEqLowFreq' | 'fxEqMidFreq' | 'fxEqHighFreq';
    const spec = EQ_BAND_SPEC[eqBands[i].key];
    const fz = (v: number) => Math.max(spec.min, Math.min(spec.max, v));
    if (has(key) || has(fKey)) {
      chain.push(new AutoBiquad((v, w) => peakingCoeffs(fz(w), g(v), sr, q), has(key) ? auto![key]! : [], gain, sr, has(fKey) ? auto![fKey] : undefined, freq));
    } else if (gain) {
      chain.push(peaking(freq, gain, sr, q));
    }
  };
  const reverbDecays = (amount: number) => {
    // a mérték 0-nál a zengés elhal (a 0,3-as alap is lehalkul) — a görbe 0-ja tényleg száraz
    const a = clampN(amount, 0, 1);
    const dec = a > 0 ? Number((0.3 + a * 0.5).toFixed(2)) : 0;
    return [dec, Number((dec * 0.7).toFixed(2))];
  };
  // 🔀 a mozgatható fokozatok a klip sorrendjében (`fxOrder.ts`; a szerver ugyanezt követi). Az alap
  // sorrend a szerveré: szűrők → EQ → (zajszűrés: előmenet) → kapu → de-esser → kompresszor → zengés →
  // visszhang → szélesítés; utána mindig a normalizálás és a limiter
  const stages: Record<FxStage, () => void> = {
    filters: () => {
      if (has('fxHighpass')) {
        chain.push(new AutoBiquad((v) => highpassCoeffs(hpF(v), sr), auto!.fxHighpass!, f.highpass || 20, sr));
      } else if (f.highpass && f.highpass > 0) {
        chain.push(highpass(Math.round(hpF(f.highpass)), sr));
      }
      if (has('fxLowpass')) {
        chain.push(new AutoBiquad((v) => lowpassCoeffs(lpF(v), sr), auto!.fxLowpass!, f.lowpass || 20000, sr));
      } else if (f.lowpass && f.lowpass > 0) {
        chain.push(lowpass(Math.round(lpF(f.lowpass)), sr));
      }
    },
    eq: () => {
      band('fxEqLow', 0);
      band('fxEqMid', 1);
      band('fxEqHigh', 2);
    },
    gate: () => {
      if (f.gate) chain.push(new Gate(0.05, 9, 5, 80, 0.06, sr));
    },
    deEsser: () => {
      if (f.deEsser) chain.push(new DeEsser(sr));
    },
    compressor: () => {
      if (f.compressor) chain.push(new Compressor(-18, 3, 5, 150, sr));
    },
    reverb: () => {
      if ((f.reverb && f.reverb > 0) || has('fxReverb')) {
        const e = new Echo(0.8, 0.9, [40, 75], reverbDecays(f.reverb ?? 0), sr);
        if (has('fxReverb')) e.auto = { kfs: auto!.fxReverb!, fallback: f.reverb ?? 0, decaysOf: reverbDecays, sr };
        chain.push(e);
      }
    },
    delay: () => {
      if ((f.delay && f.delay > 0) || has('fxDelay')) {
        // a delay ideje a statikus mértékből vagy (V7) a tempóból — a késleltetési vonal hossza nem
        // automatizálható kattogás nélkül
        const delayDecay = (amount: number) => [clampN(amount, 0, 1) > 0 ? Number((0.2 + clampN(amount, 0, 1) * 0.5).toFixed(2)) : 0];
        const e = new Echo(0.8, 0.6, [delayTimeMs(f)], delayDecay(f.delay ?? 0), sr);
        if (has('fxDelay')) e.auto = { kfs: auto!.fxDelay!, fallback: f.delay ?? 0, decaysOf: delayDecay, sr };
        chain.push(e);
      }
    },
    stereoWide: () => {
      if (f.stereoWide) chain.push(new Haas(sr));
    },
  };
  for (const stage of fxStageOrder(f.order)) stages[stage]();
  // 📏 normalizálás: az előmenetben mért fix erősítés −16 LUFS-re + csúcsplafon −1,5 dB
  if (fx.normalize) {
    chain.push(new Gain(normGain), new Limiter(dbToLin(NORMALIZE_PEAK_DB), 50, sr));
  }
  if (fx.limiter) chain.push(new Limiter(0.95, 50, sr));
  return chain;
}

/**
 * Egy klip futó effekt-állapota a darabos keveréshez: a lánc és hogy hol tart. Ugrásnál (a
 * következő minta nem ott van, ahol a lánc abbahagyta) a hívó újraindítja és bejáratja.
 */
export interface FxState {
  chain: Processor[];
  /** 🦆 a halkító (a sín állapota) */
  ducker?: Ducker;
  /** a következő feldolgozandó idővonal-minta */
  next: number;
}

/** a bejáratás hossza (minta): a biquadok ~10 ms, a dinamika-burkolók (150 ms lecsengés) ennyi
 * alatt bőven beállnak */
export const FX_WARMUP = Math.round(0.6 * 44100);
