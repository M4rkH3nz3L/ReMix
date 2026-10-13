/**
 * 🎚️ Mixer-nézet mag (AUDIOT §2) — pure + tesztelt.
 *
 * A csatorna-szalagok (sávonkénti fader + némítás/szóló + sidechain-duck) UI-barát matekja.
 * A render-oldal MÁR kész a workerben: `trackMix[type].gain` (fader), `clip.pan`, `clip.audioFx`,
 * és a `clip.autoDuck` → `sidechaincompress` (zene/sfx lehalkul a voiceover alatt). Ez a mag a
 * gain↔dB váltást, a fader-skálát és a sáv-szintű duck-állapot levezetését adja. Expo-mentes.
 */
import type { AudioClip, Clip, TrackType } from '@/types/project';

export const MIN_GAIN = 0;
export const MAX_GAIN = 2; // +6 dB-ig boostolható

export function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) {
    return 1;
  }
  return Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain));
}

/** Lineáris gain → dB (0 = -∞). */
export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/** Fader-címke dB-ben (pl. „+3.5", „-6.0", „-∞"). */
export function formatGainDb(gain: number): string {
  if (gain <= 0) {
    return '-∞';
  }
  const db = gainToDb(gain);
  if (Math.abs(db) < 0.05) {
    return '0.0';
  }
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
}

/** 0…1 fader-pozíció → gain (lineáris a MAX_GAIN-ig). */
export function faderToGain(fader: number): number {
  return clampGain(Math.max(0, Math.min(1, fader)) * MAX_GAIN);
}

/** gain → 0…1 fader-pozíció. */
export function gainToFader(gain: number): number {
  return clampGain(gain) / MAX_GAIN;
}

/** A voiceover a sidechain KULCSA (nem duckolódik); duckolni a music/sfx sávot lehet. */
export function isVoiceTrack(type: TrackType): boolean {
  return type === 'voiceover';
}

/** Duckolható-e ez a sáv (nem a voiceover-kulcs). */
export function canDuckTrack(type: TrackType): boolean {
  return !isVoiceTrack(type);
}

const audioOf = (clips: Clip[]): AudioClip[] => clips.filter((c): c is AudioClip => c.kind === 'audio');

/** A sáv „ducked" állapota: van hang-klip ÉS mind autoDuck. */
export function trackDucked(clips: Clip[]): boolean {
  const a = audioOf(clips);
  return a.length > 0 && a.every((c) => !!c.autoDuck);
}

/** A sáv hang-klipjeinek id-jai (a duck-batch-hez). */
export function audioClipIds(clips: Clip[]): string[] {
  return audioOf(clips).map((c) => c.id);
}
