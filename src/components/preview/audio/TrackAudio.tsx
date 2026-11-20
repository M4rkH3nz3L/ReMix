import { clipsForPlayback } from '@/lib/avSync';
import { trackAudible } from '@/lib/audioLayerMix';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, TrackType } from '@/types/project';

import { ClipAudioPlayer } from './ClipAudioPlayer';

/**
 * Egy audio-sáv: a playheadnél futó MINDEN aktív klipre egy-egy `ClipAudioPlayer`
 * (kulcs = clip.id) → a sávon belüli átfedő klipek EGYSZERRE szólnak (keverednek).
 * Korábban átfedésnél csak a legutóbb kezdődő klip szólt (a többi néma volt).
 */
export function TrackAudio({ trackType }: { trackType: TrackType }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  // 🎚️ sáv-monitorozás: az audio-export ugyanezt követi (`mixForExport`)
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const audible = trackAudible(trackType, mutedTracks, soloTracks);

  // 🎚️ sávonkénti mixer-gain (fader) — az előnézetben (a render is honorálja)
  const trackGain = project?.trackMix?.[trackType]?.gain ?? 1;
  const track = project ? project.tracks.find((t) => t.type === trackType) : null;
  // ⏱️ a hamarosan kezdődő klip lejátszója is elkészül (preroll — betöltve, a forrás elején)
  const active = track
    ? clipsForPlayback(track.clips.filter((c): c is AudioClip => c.kind === 'audio'), playhead)
    : [];

  return (
    <>
      {active.map((clip) => (
        <ClipAudioPlayer key={clip.id} clip={clip} audible={audible} trackGain={trackGain} />
      ))}
    </>
  );
}
