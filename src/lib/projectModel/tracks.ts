import type { Clip, TrackType } from '@/types/project';

export const CANONICAL_TRACKS: { type: TrackType; name: string }[] = [
  { type: 'video', name: 'lib.projectUtils.trackVideo' },
  { type: 'pip', name: 'PiP' },
  { type: 'adjust', name: 'Grade' },
  { type: 'text', name: 'lib.projectUtils.trackText' },
  { type: 'captions', name: 'lib.projectUtils.trackCaptions' },
  { type: 'overlay', name: 'lib.projectUtils.trackOverlay' },
  { type: 'interactive', name: 'lib.projectUtils.trackInteractive' },
  { type: 'music', name: 'lib.projectUtils.trackMusic' },
  { type: 'voiceover', name: 'Voiceover' },
  { type: 'sfx', name: 'SFX' },
];

/**
 * 🎚️ Melyik klip-fajtát fogadhat egy sáv — a MOVE_CLIP (sávok közti mozgatás)
 * kompatibilitás-guardja. A kanonikus modell: a kép-sávok (video/pip) videót és
 * képet; a hang-sávok (music/voiceover/sfx) hangot; a szöveg/felirat szöveget;
 * az overlay a matricát (shape/kép); a többi a saját fajtáját. Pure → tesztelhető.
 */
const TRACK_HOSTS: Record<TrackType, Clip['kind'][]> = {
  video: ['video', 'image'],
  pip: ['video', 'image'],
  adjust: ['adjust'],
  text: ['text'],
  captions: ['text'],
  overlay: ['shape', 'image'],
  interactive: ['interactive'],
  music: ['audio'],
  voiceover: ['audio'],
  sfx: ['audio'],
  aux1: ['audio'],
  aux2: ['audio'],
  aux3: ['audio'],
  aux4: ['audio'],
  aux5: ['audio'],
};

export function canHostClip(trackType: TrackType, kind: Clip['kind']): boolean {
  return TRACK_HOSTS[trackType]?.includes(kind) ?? false;
}

/**
 * Egy klip-fajtát fogadó sávok a KANONIKUS sorrendben (a „sávváltás" + a sávok-
 * közti mozgatás ehhez igazodik). Pl. videó → [video, pip]; hang → [music,
 * voiceover, sfx]; szöveg → [text, captions].
 */
export function compatibleTracksFor(kind: Clip['kind']): TrackType[] {
  return CANONICAL_TRACKS.map((t) => t.type).filter((type) => canHostClip(type, kind));
}
