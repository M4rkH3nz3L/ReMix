import type { Project, TrackType } from '@/types/project';

const AUDIO_TRACKS: TrackType[] = ['music', 'voiceover', 'sfx'];

/**
 * 🎚️ A hangexport azt adja, amit a felhasználó hall (PRO-AUDIO A15): a némított vagy solóból
 * kimaradó sáv nem kerül bele, a master-hangerő minden sávra hat. `null`, ha nem marad hang.
 */
export function mixForExport(project: Project, audible: (type: TrackType) => boolean, masterVolume: number): Project | null {
  const tracks = project.tracks.map((t) => (AUDIO_TRACKS.includes(t.type) && !audible(t.type) ? { ...t, clips: [] } : t));
  if (!tracks.some((t) => AUDIO_TRACKS.includes(t.type) && t.clips.length > 0)) {
    return null;
  }
  if (masterVolume === 1) {
    return { ...project, tracks };
  }
  const trackMix = { ...project.trackMix };
  for (const type of AUDIO_TRACKS) {
    trackMix[type] = { gain: (trackMix[type]?.gain ?? 1) * masterVolume };
  }
  return { ...project, tracks, trackMix };
}
