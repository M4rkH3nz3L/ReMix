import { File } from 'expo-file-system';

import { mixForExport } from '@/lib/audioExportMix';
import { isAudioTrack } from '@/lib/audioTracks';
import { TrackAnalyzer, type TrackStats } from '@/lib/mixAssist';
import { OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';
import { streamOfflinePasses } from '@/lib/offlineMixClient';
import type { ProgressUpdate } from '@/lib/progress';
import type { Project, TrackType } from '@/types/project';

/**
 * 🎚️🤖 A mixjavaslat és a mastering-segéd mérése a telefonon: azt a keverést méri, amit az export
 * ad (a némított sávok és a hiányzó fájlok nélkül) — sávonként (szóló, master nélkül) és egészben
 * (master nélkül), egyetlen dekódolással.
 */
export interface MixAnalysis {
  tracks: Partial<Record<TrackType, TrackStats>>;
  mix: TrackStats;
}

type View = { isTrackAudible: (t: TrackType) => boolean; masterVolume: number };

function playableMix(project: Project, view: View): Project | null {
  const mix = mixForExport(project, view.isTrackAudible, view.masterVolume);
  if (!mix) return null;
  const tracks = mix.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !(c.kind === 'audio' && c.uri.startsWith('file:') && !new File(c.uri).exists)) }));
  return tracks.some((t) => isAudioTrack(t.type) && t.clips.some((c) => c.kind === 'audio')) ? { ...mix, tracks } : null;
}

export async function analyzeMixTracks(project: Project, view: View, onProgress?: (u: ProgressUpdate) => void, signal?: AbortSignal): Promise<MixAnalysis | null> {
  const mix = playableMix(project, view);
  if (!mix) return null;
  const types = mix.tracks.filter((t) => isAudioTrack(t.type) && t.clips.some((c) => c.kind === 'audio')).map((t) => t.type);
  const analyzers = new Map(types.map((t) => [t, new TrackAnalyzer(OFFLINE_SAMPLE_RATE)] as const));
  const whole = new TrackAnalyzer(OFFLINE_SAMPLE_RATE);
  await streamOfflinePasses(
    mix,
    [...types.map((t) => ({ solo: [t], master: false, sink: (l: Float32Array, r: Float32Array) => analyzers.get(t)!.push(l, r) })), { master: false, sink: (l, r) => whole.push(l, r) }],
    onProgress,
    signal
  );
  const tracks: Partial<Record<TrackType, TrackStats>> = {};
  for (const [t, a] of analyzers) tracks[t] = a.finish();
  return { tracks, mix: whole.finish() };
}

/** a masteres keverés mérése (a mastering-segéd ellenőrzése: elérte-e a célt) */
export async function measureMastered(project: Project, view: View, onProgress?: (u: ProgressUpdate) => void, signal?: AbortSignal): Promise<TrackStats | null> {
  const mix = playableMix(project, view);
  if (!mix) return null;
  const a = new TrackAnalyzer(OFFLINE_SAMPLE_RATE);
  await streamOfflinePasses(mix, [{ master: true, sink: (l, r) => a.push(l, r) }], onProgress, signal);
  return a.finish();
}
