import { sourceTimeAt } from '@/lib/projectUtils';
import type { Project, VideoClip } from '@/types/project';

/**
 * 🎬 Videó-referencia a videóból nyitott Hang Stúdióban (AP8) — pure: a lejátszófejhez tartozó videó-
 * képkocka (a videó-sáv klipje és a forrás-ideje a projekt frame-rácsára kerekítve, ms-ban). Így a
 * hang a képhez igazítható (A/V szinkron nem vakon). Nincs videó a lejátszófejnél → null.
 */
export function videoFrameAt(project: Project | null | undefined, t: number): { clipId: string; uri: string; ms: number } | null {
  if (!project) return null;
  const fps = project.fps ?? 30;
  const track = project.tracks.find((tr) => tr.type === 'video');
  const clip = track?.clips.find((c): c is VideoClip => c.kind === 'video' && t >= c.start && t < c.start + c.duration);
  if (!clip) return null;
  const src = Math.max(0, sourceTimeAt(clip, t));
  return { clipId: clip.id, uri: clip.uri, ms: Math.round((Math.round(src * fps) / fps) * 1000) };
}
