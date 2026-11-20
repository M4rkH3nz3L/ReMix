import type { EditorCommand } from '@/lib/commands';
import { snapToFrame } from '@/lib/frames';
import { eqBandParams, EQ_BAND_SPEC } from '@/lib/fxParams';
import type { FxStage } from '@/lib/fxOrder';
import { stemClipsFrom } from '@/lib/stemClips';
import type { AudioClip, AudioFx } from '@/types/project';

/**
 * 🎚️ A klip-szerkesztő lap (ClipEditSheet) tiszta számításai — React és expo nélkül, hogy
 * önmagukban tesztelhetők legyenek. A parancsokat / patch-eket csak ÖSSZEÁLLÍTJÁK; a végrehajtás a
 * hívónál a command buson (`updateClip` / `dispatch` / `applyBatch`) megy.
 */

export type FxAutoKey = 'fxLowpass' | 'fxHighpass' | 'fxReverb' | 'fxDelay' | 'fxEqLow' | 'fxEqMid' | 'fxEqHigh' | 'fxEqLowFreq' | 'fxEqMidFreq' | 'fxEqHighFreq';
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

/** 🎛️ az automatizálható effekt-paraméterek: tartomány, alapérték (a statikus beállítás), kiírás */
export const FX_AUTO: { key: FxAutoKey; min: number; max: number; fallback: (fx?: AudioFx) => number; format: (v: number) => string }[] = [
  { key: 'fxLowpass', min: 1000, max: 20000, fallback: (fx) => fx?.lowpass || 20000, format: (v) => `${(v / 1000).toFixed(1)} kHz` },
  { key: 'fxHighpass', min: 20, max: 2000, fallback: (fx) => fx?.highpass || 20, format: (v) => `${Math.round(v)} Hz` },
  { key: 'fxReverb', min: 0, max: 1, fallback: (fx) => fx?.reverb ?? 0, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'fxDelay', min: 0, max: 1, fallback: (fx) => fx?.delay ?? 0, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'fxEqLow', min: -12, max: 12, fallback: (fx) => fx?.eq?.low ?? 0, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'fxEqMid', min: -12, max: 12, fallback: (fx) => fx?.eq?.mid ?? 0, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB` },
  { key: 'fxEqHigh', min: -12, max: 12, fallback: (fx) => fx?.eq?.high ?? 0, format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB` },
  // 🎛️ V7.4: a sávok frekvenciája (söprés) — a sáv tartományán belül
  { key: 'fxEqLowFreq', min: EQ_BAND_SPEC.low.min, max: EQ_BAND_SPEC.low.max, fallback: (fx) => eqBandParams(fx?.eq)[0].freq, format: hz },
  { key: 'fxEqMidFreq', min: EQ_BAND_SPEC.mid.min, max: EQ_BAND_SPEC.mid.max, fallback: (fx) => eqBandParams(fx?.eq)[1].freq, format: hz },
  { key: 'fxEqHighFreq', min: EQ_BAND_SPEC.high.min, max: EQ_BAND_SPEC.high.max, fallback: (fx) => eqBandParams(fx?.eq)[2].freq, format: hz },
];

/** a lap helyi (még nem mentett) beállításai */
export interface ClipEditSettings {
  volume: number;
  fadeIn: number;
  fadeOut: number;
  duration: number;
  trimIn: number;
  pan: number;
  voiceEnhance: boolean;
  deReverb: boolean;
  autoDuck: boolean;
  fx: AudioFx;
}

/** van-e mentetlen módosítás a klip mentett állapotához képest */
export function clipEditDirty(clip: AudioClip, s: ClipEditSettings): boolean {
  const { volume, fadeIn, fadeOut, duration, trimIn, pan, voiceEnhance, deReverb, autoDuck, fx } = s;
  return (
    volume !== clip.volume ||
    fadeIn !== clip.fadeIn ||
    fadeOut !== clip.fadeOut ||
    duration !== clip.duration ||
    trimIn !== (clip.trimIn ?? 0) ||
    pan !== (clip.pan ?? 0) ||
    voiceEnhance !== !!clip.voiceEnhance ||
    deReverb !== !!clip.deReverb ||
    autoDuck !== !!clip.autoDuck ||
    JSON.stringify(fx) !== JSON.stringify(clip.audioFx ?? {})
  );
}

/**
 * a vágás csak akkor ül a rácsra, ha a felhasználó állította — a késés-kompenzált take (count-in,
 * punch) pontos `trimIn`-je egy hangerő-állítástól nem csúszhat el
 */
export function clipGeometryChanged(clip: AudioClip, duration: number, trimIn: number): boolean {
  return duration !== clip.duration || trimIn !== (clip.trimIn ?? 0);
}

/** a függő (nem vágási) beállítások patch-e — take-választás / tempó-illesztés előtt mentődik */
export function pendingSettingsPatch(clip: AudioClip, s: ClipEditSettings): Partial<AudioClip> {
  const { volume, pan, fadeIn, fadeOut, voiceEnhance, deReverb, autoDuck, fx } = s;
  return { volume, pan, fadeIn: Math.min(fadeIn, clip.duration), fadeOut: Math.min(fadeOut, clip.duration), voiceEnhance, deReverb, autoDuck, audioFx: fx } as Partial<AudioClip>;
}

/** a „Kész” patch-e: a vágás csak állításkor ül a rácsra (`fps`), a fade a végleges hosszon belül */
export function clipDonePatch(clip: AudioClip, s: ClipEditSettings, fps: number, sourceDuration: number): Partial<AudioClip> {
  const { volume, fadeIn, fadeOut, duration, trimIn, pan, voiceEnhance, deReverb, autoDuck, fx } = s;
  const geometryChanged = clipGeometryChanged(clip, duration, trimIn);
  const snapped = geometryChanged ? snapToFrame(duration, fps) : clip.duration;
  return {
    volume,
    pan,
    fadeIn: Math.min(fadeIn, snapped),
    fadeOut: Math.min(fadeOut, snapped),
    ...(geometryChanged ? { duration: Math.max(snapToFrame(0.1, fps), snapped), trimIn: snapToFrame(trimIn, fps) } : {}),
    sourceDuration,
    voiceEnhance,
    deReverb,
    autoDuck,
    audioFx: fx,
  } as Partial<AudioClip>;
}

/** 🔁 loop-klip be/ki: ki-kapcsoláskor a klip nem lóghat túl a forráson */
export function loopTogglePatch(clip: AudioClip, on: boolean): Partial<AudioClip> {
  return on
    ? { loopLength: clip.duration, loopOffset: undefined }
    : {
        loopLength: undefined,
        loopOffset: undefined,
        // ki: a klip nem lóghat túl a forráson
        duration: Math.min(clip.duration, Math.max(0.1, (clip.sourceDuration ?? clip.duration) - (clip.trimIn ?? 0))),
      };
}

/** 🎛️ V7: eltér-e a parametrikus EQ az alapértéktől (akkor a lap kinyitva indul) */
export function paramEqCustomized(eq: AudioFx['eq']): boolean {
  return eqBandParams(eq).some((b, i) => b.freq !== [100, 1000, 8000][i] || b.q !== 1);
}

/** 🥁 V7: a delay ütem-értékének kiírása (1/16 … 1/2) */
export const beatLabel = (b: number) => ({ 0.25: '1/16', 0.5: '1/8', 0.75: '1/8.', 1: '1/4', 2: '1/2' })[b] ?? `${b}`;

/** 🔀 aktív-e az effekt-lánc egy fokozata (csak az aktívak sorrendje állítható) */
export function fxStageActive(fx: AudioFx, st: FxStage): boolean {
  return st === 'filters' ? !!(fx.highpass || fx.lowpass) : st === 'eq' ? !!(fx.eq?.low || fx.eq?.mid || fx.eq?.high) : st === 'reverb' ? (fx.reverb ?? 0) > 0 : st === 'delay' ? (fx.delay ?? 0) > 0 : !!fx[st];
}

/** 🎚️ AI stem-szeparáció: a stem-klipek hozzáadása + az eredeti elnémítása — EGY köteg (EGY undo) */
export function stemSeparationCommands(clip: AudioClip, stems: Parameters<typeof stemClipsFrom>[1], newId: () => string): EditorCommand[] {
  const commands: EditorCommand[] = stemClipsFrom(clip, stems, newId).map((stem) => ({
    type: 'ADD_CLIP',
    trackType: stem.trackType,
    clip: stem.clip,
  }));
  commands.push({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { volume: 0 } });
  return commands;
}
