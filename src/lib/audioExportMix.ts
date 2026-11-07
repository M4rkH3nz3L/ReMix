import type { Clip, Project, TrackType, VideoClip } from '@/types/project';
import { AUDIO_TRACKS } from '@/lib/audioTracks';


/**
 * 🎚️ A hangexport azt adja, amit a felhasználó hall (PRO-AUDIO A15): a némított vagy solóból
 * kimaradó sáv nem kerül bele, a master-hangerő minden sávra hat. `null`, ha nem marad hang.
 */
export function mixForExport(project: Project, audible: (type: TrackType) => boolean, masterVolume: number): Project | null {
  const tracks = project.tracks.map((t) => {
    if (AUDIO_TRACKS.includes(t.type)) {
      return audible(t.type) ? t : { ...t, clips: [] };
    }
    if (t.type === 'video' || t.type === 'pip') {
      // 🎬 a videóklip (és a PiP-videó) hangja: a némított sáv néma, a master rá is hat — a
      // szerver a videó-hangra nem alkalmaz sáv-erősítést
      const gain = audible(t.type) ? masterVolume : 0;
      return gain === 1 ? t : { ...t, clips: t.clips.map((c) => (c.kind === 'video' ? scaleVideoVolume(c as VideoClip, gain) : c)) };
    }
    return t;
  });
  if (!tracks.some((t) => (AUDIO_TRACKS.includes(t.type) && t.clips.length > 0) || t.clips.some(videoHasSound))) {
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

function scaleVideoVolume(clip: VideoClip, gain: number): VideoClip {
  const kf = clip.keyframes?.volume;
  return {
    ...clip,
    volume: clip.volume * gain,
    ...(kf ? { keyframes: { ...clip.keyframes, volume: kf.map((k) => ({ ...k, value: k.value * gain })) } } : {}),
  };
}

function videoHasSound(clip: Clip): boolean {
  if (clip.kind !== 'video') {
    return false;
  }
  const v = clip as VideoClip;
  return v.volume > 0 || (v.keyframes?.volume ?? []).some((k) => k.value > 0);
}
