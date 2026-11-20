/**
 * 🎛️ A KÖZÖS hang-DSP (PRO-AUDIO „azt kapod, amit hallasz”): az előnézet és a telefonos export
 * ugyanezt a kódot futtatja (`mixRange`). A szűrők a szerver ffmpeg-láncának (`voicechain.js`
 * `audioFxChain`) matematikáját követik — RBJ-biquad, direkt I. alak, 64 bites állapot —, így a
 * telefon és a szerver kimenete kivonva mérhetően egyezik.
 *
 * A dinamika (kompresszor, kapu, de-esser, limiter) SAJÁT megvalósítás ugyanazokkal a
 * beállításokkal (az ffmpeg C-kódja LGPL — nem portoljuk); az előnézet és a telefonos export
 * mintára azonos, a szerveres export a telefon keverését kapja.
 *
 * Ami itt még nincs, az a `fxUnsupported`-ban jelzett (a klip addig a régi úton szól).
 */
// A megvalósítás a `src/lib/dsp/` modulcsaládban él; ez a fájl a publikus felület (barrel).

export { Gain, runChain, type Processor } from '@/lib/dsp/processor';
export { AutoBiquad, Biquad } from '@/lib/dsp/filters';
export { Compressor, DeEsser, Ducker, Gate, Limiter, Multiband } from '@/lib/dsp/dynamics';
export { Echo, Haas } from '@/lib/dsp/delays';
export { Saturator } from '@/lib/dsp/master';
export { highpass, lowpass, peaking } from '@/lib/dsp/filters';
export { buildMasterChain, masterCompressorParams, saturationDrive, MASTER_COMP_ATTACK_MS, MASTER_COMP_RELEASE_MS } from '@/lib/dsp/master';
export { fxUnsupported, fxActive, voiceFx, buildFxChain, NORMALIZE_LUFS, NORMALIZE_PEAK_DB, FX_AUTO_KEYS, FX_WARMUP, type FxAutomation, type FxState } from '@/lib/dsp/fxChain';
