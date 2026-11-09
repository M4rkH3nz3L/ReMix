import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

/**
 * 🎧🅰️🅱️ A referencia hallgatása — tiszta mag: egy egyklipes projekt a referenciával (a lejátszó-motor
 * ezt játssza a keverés helyett), a keverés hangosságára illesztett erősítéssel; master, sáv-keverés nélkül.
 */
export function referenceMatchGain(refLufs: number, mixLufs: number): number {
  if (!Number.isFinite(refLufs) || !Number.isFinite(mixLufs)) return 1;
  // a B ne vágjon túl: legfeljebb +12 dB
  return Math.min(Math.pow(10, 12 / 20), Math.pow(10, (mixLufs - refLufs) / 20));
}

export function referenceProject(base: Project, ref: { uri: string; name: string; duration: number }, gain: number): Project {
  const p = createEmptyProject(base.name, base.aspectRatio ?? '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: '__ref', uri: ref.uri, label: ref.name, start: 0, duration: ref.duration, trimIn: 0, sourceDuration: ref.duration, volume: gain, fadeIn: 0, fadeOut: 0, source: 'imported' };
  return { ...p, id: `${base.id}__ref`, fps: base.fps, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) };
}
