import type { EditorCommand } from '@/lib/commands';
import { findClip } from '@/lib/projectUtils';
import type { Project, TrackType } from '@/types/project';

/**
 * 🔒 Egy command által ÉRINTETT sáv-típus(ok) — a core-guardhoz (zárolt sáv).
 * Üres tömb = a parancs nem sáv-scope-os (pl. SET_FPS, markerek) → sosem blokkolt.
 */
export function touchedTrackTypes(project: Project, cmd: EditorCommand): TrackType[] {
  switch (cmd.type) {
    case 'ADD_CLIP':
    case 'ADD_CLIPS':
    case 'REPLACE_TRACK_CLIPS':
    case 'SET_TRACK_GAIN':
      return [cmd.trackType];
    case 'REPLACE_TRACKS':
      return cmd.tracks.map((t) => t.trackType);
    case 'UPDATE_CLIP':
    case 'REMOVE_CLIP':
    case 'SPLIT_CLIP': {
      const t = findClip(project, cmd.clipId)?.track.type;
      return t ? [t] : [];
    }
    case 'MOVE_CLIP': {
      // a mozgatás a FORRÁS és a CÉL sávot is érinti — bármelyik zárolt → tiltott
      const from = findClip(project, cmd.clipId)?.track.type;
      return from ? [from, cmd.toTrackType] : [cmd.toTrackType];
    }
    default:
      return [];
  }
}
