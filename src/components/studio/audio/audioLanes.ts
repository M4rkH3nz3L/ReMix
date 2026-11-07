import type { Ionicons } from '@expo/vector-icons';

import { palette, trackColors } from '@/constants/editor';
import { EXTRA_AUDIO_TRACKS } from '@/lib/audioTracks';
import type { Project, TrackType } from '@/types/project';

/** egy hangsáv a Hang Stúdió felületén: típus, ikon, szín és a név (i18n-kulcs vagy a felhasználó neve) */
export interface AudioLane {
  type: TrackType;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  labelKey: string;
  /** a felhasználó által adott név (a hozzáadott sávoknál) */
  name?: string;
  /** hozzáadott (átnevezhető, üresen törölhető) sáv */
  extra: boolean;
}

const BASE: AudioLane[] = [
  { type: 'music', icon: 'musical-notes', color: palette.accent, labelKey: 'editor.track.music', extra: false },
  { type: 'voiceover', icon: 'mic', color: palette.accent2, labelKey: 'editor.track.voiceover', extra: false },
  { type: 'sfx', icon: 'flash', color: '#39d98a', labelKey: 'editor.track.sfx', extra: false },
];

/** 🎚️ a projekt hangsávjai fentről le: az alap három + a hozzáadottak (a sorrendjük szerint) */
export function audioLanes(project: Pick<Project, 'tracks'> | null): AudioLane[] {
  const extras = EXTRA_AUDIO_TRACKS.flatMap((type) => {
    const track = project?.tracks.find((t) => t.type === type);
    return track
      ? [{ type, icon: 'musical-note' as const, color: trackColors[type], labelKey: `editor.track.${type}`, name: track.name, extra: true }]
      : [];
  });
  return [...BASE, ...extras];
}

/** a sáv megjelenített neve */
export function laneLabel(lane: AudioLane, t: (k: string) => string): string {
  return lane.name?.trim() || t(lane.labelKey);
}
