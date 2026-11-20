/**
 * 🎧📱 Telefonos (offline) hang-keverés — PRO-AUDIO A26: a Free felhasználó szerver nélkül
 * exportálhat. Pure és expo-mentes: a dekódolt PCM-ből a szerveres render szabályaival kever
 * (`server/render.js`): forrás-ablak `trimIn`-től, hangerő-automáció (ugyanaz a görbe, mint az
 * élő lejátszóé), fade be/ki szorzatként, lineáris balansz (bal = 1 − max(0, pan), jobb =
 * 1 − max(0, −pan)), sáv- és master-erősítés, összegzés normalizálás nélkül. A szerver
 * effektjei (Pro) itt nincsenek: ezeket az `unsupported` sorolja fel.
 */

// A mag a `mix/` mappában, felelősség szerint bontva; ez a modul a publikus felület.
export { EDGE_FADE_SEC, OFFLINE_SAMPLE_RATE } from './mix/model';
export type { DecodedSource, OfflineMixClip, OfflineMixPlan, OfflineUnsupported, StretchJob } from './mix/model';
export { crossfadePairs, crossfades, edgeFades } from './mix/fades';
export { offlineMixPlan } from './mix/plan';
export { pipAudioClips, videoAudioClips } from './mix/visualAudio';
export { clipGainAt, panGains } from './mix/gain';
export { mixRange } from './mix/render';
export { encodeWav16, pcm16, pcm24, pcmF32, wavHeader16, wavHeader24, wavHeaderF32 } from './mix/wav';
export { needsWholeWindow, sliceSource, sourceRanges, stretchJobs } from './mix/sourcePrep';
export { measureMasterGain, withNormalizeGains } from './mix/levels';
