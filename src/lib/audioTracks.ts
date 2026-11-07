import type { TrackType } from '@/types/project';

/**
 * 🎚️ A hangsávok EGY helyen: az alap három (zene, beszéd, effekt) és a „+ Sáv”-val hozzáadható
 * általános sávok. Minden keverő, export és mérő ezt a listát használja.
 */
export const BASE_AUDIO_TRACKS: TrackType[] = ['music', 'voiceover', 'sfx'];
export const EXTRA_AUDIO_TRACKS: TrackType[] = ['aux1', 'aux2', 'aux3', 'aux4', 'aux5'];
export const AUDIO_TRACKS: TrackType[] = [...BASE_AUDIO_TRACKS, ...EXTRA_AUDIO_TRACKS];

export function isAudioTrack(type: TrackType): boolean {
  return AUDIO_TRACKS.includes(type);
}

/** a következő szabad általános sáv-típus (null, ha mind foglalt) */
export function nextExtraTrack(existing: TrackType[]): TrackType | null {
  return EXTRA_AUDIO_TRACKS.find((t) => !existing.includes(t)) ?? null;
}
