import { File } from 'expo-file-system';

import { MixAnalyzer, signalIssues, sortIssues, structuralIssues, type CheckIssue, type MixStats } from '@/lib/audioCheck';
import { NORMALIZE_LUFS } from '@/lib/audioDsp';
import { mixForExport } from '@/lib/audioExportMix';
import { isAudioTrack } from '@/lib/audioTracks';
import { OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';
import { streamOfflineMix } from '@/lib/offlineMixClient';
import type { ProgressUpdate } from '@/lib/progress';
import type { Project, TrackType } from '@/types/project';

/**
 * 🩺 A hangellenőrzés futtatása a telefonon: a szerkezeti hibák (hiányzó fájl, némított/szóló
 * sáv, néma klip, vágási maradék), majd a keverés (azt méri, amit az export ad — a hiányzó fájlok
 * nélkül) folyamatos elemzése. Szerver és hálózat nélkül.
 */
export async function runAudioCheck(
  project: Project,
  view: { isTrackAudible: (t: TrackType) => boolean; masterVolume: number; mutedTracks: TrackType[]; soloTracks: TrackType[] },
  onProgress?: (u: ProgressUpdate) => void,
  signal?: AbortSignal
): Promise<{ issues: CheckIssue[]; stats: MixStats | null }> {
  const uris = new Set(project.tracks.filter((t) => isAudioTrack(t.type)).flatMap((t) => t.clips.flatMap((c) => (c.kind === 'audio' ? [c.uri] : []))));
  const missing = new Set([...uris].filter((u) => u.startsWith('file:') && !new File(u).exists));
  const structural = structuralIssues(project, { missing, muted: view.mutedTracks, solo: view.soloTracks, audio: isAudioTrack });
  const mix = mixForExport(project, view.isTrackAudible, view.masterVolume);
  const playable = mix && { ...mix, tracks: mix.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !(c.kind === 'audio' && missing.has(c.uri))) })) };
  if (!playable || !playable.tracks.some((t) => isAudioTrack(t.type) && t.clips.some((c) => c.kind === 'audio'))) {
    return { issues: sortIssues([...structural, { kind: 'empty', severity: 'error' }]), stats: null };
  }
  const analyzer = new MixAnalyzer(OFFLINE_SAMPLE_RATE);
  await streamOfflineMix(playable, (l, r) => analyzer.push(l, r), onProgress, signal);
  const stats = analyzer.finish();
  return { issues: sortIssues([...structural, ...signalIssues(stats, project.audioMaster?.lufs ?? NORMALIZE_LUFS)]), stats };
}
