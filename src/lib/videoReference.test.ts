import { createEmptyProject } from '@/lib/projectUtils';
import { videoFrameAt } from '@/lib/videoReference';
import type { Project, VideoClip } from '@/types/project';

/** 🎬 AP8: a lejátszófejhez tartozó videó-képkocka (vágással, sebességgel, frame-rácson). */
const v = (over: Partial<VideoClip>): VideoClip => ({ kind: 'video', id: 'v1', uri: 'file:///a.mp4', start: 2, duration: 4, trimIn: 1, speed: 1, volume: 1, ...over }) as VideoClip;
const proj = (clips: VideoClip[]): Project => {
  const b = createEmptyProject('x', '9:16');
  return { ...b, fps: 30, tracks: b.tracks.map((t) => (t.type === 'video' ? { ...t, clips } : t)) };
};
describe('🎬 videó-referencia', () => {
  it('a klip forrás-ideje (trimIn + eltelt × sebesség), a frame-rácsra kerekítve', () => {
    expect(videoFrameAt(proj([v({})]), 3.5)).toEqual({ clipId: 'v1', uri: 'file:///a.mp4', ms: 2500 });
    expect(videoFrameAt(proj([v({ speed: 2 })]), 3.01)?.ms).toBe(3033); // 1 + 1,01·2 = 3,02 s → a 91. kocka (3,0333 s)
  });
  it('a klipen kívül és videó nélkül null; a klip vége már a következő', () => {
    expect(videoFrameAt(proj([v({})]), 1.9)).toBeNull();
    expect(videoFrameAt(proj([v({})]), 6)).toBeNull();
    expect(videoFrameAt(proj([]), 3)).toBeNull();
    expect(videoFrameAt(null, 3)).toBeNull();
  });
});
