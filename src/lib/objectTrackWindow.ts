import { activeVisualClip } from '@/lib/projectUtils';
import type { Project, VideoClip } from '@/types/project';

/**
 * 🎯 Objektum-követés indítási ablaka (a Forma- és a Precíziós panel közös,
 * expo-mentes magja): a lejátszófej alatti videó, a klipen belüli lejátszófej és
 * a legfeljebb 15 s-os, legalább 0,5 s-os követési hossz (idővonal-másodpercben).
 */
export type ObjectTrackWindow =
  | { ok: true; video: VideoClip; durTl: number }
  | { ok: false; reason: 'needVideo' | 'playheadOnClip' | 'tooShort' };

export function objectTrackWindow(
  project: Project,
  clip: { start: number; duration: number },
  playhead: number
): ObjectTrackWindow {
  const video = activeVisualClip(project, playhead);
  if (!video || video.kind !== 'video') {
    return { ok: false, reason: 'needVideo' };
  }
  if (playhead < clip.start || playhead >= clip.start + clip.duration) {
    return { ok: false, reason: 'playheadOnClip' };
  }
  const endTl = Math.min(clip.start + clip.duration, video.start + video.duration, playhead + 15);
  const durTl = endTl - playhead;
  if (durTl < 0.5) {
    return { ok: false, reason: 'tooShort' };
  }
  return { ok: true, video, durTl };
}
