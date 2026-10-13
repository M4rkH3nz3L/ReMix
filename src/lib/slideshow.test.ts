import { MAX_PROJECT_DURATION_SEC } from './projectUtils';
import {
  DEFAULT_PER_SLIDE_SEC,
  backgroundMusicClip,
  clampPerSlideForMax,
  slideshowDurationSec,
  slideshowFitsMax,
  slideshowPlan,
  type SlideSource,
} from './slideshow';

const slides = (n: number): SlideSource[] =>
  Array.from({ length: n }, (_, i) => ({ id: `d${i}`, uri: `file://img${i}.png` }));

describe('slideshow — galéria → diavetítés (TECH-TOP §2.2)', () => {
  test('slideshowDurationSec = képszám × perSlide', () => {
    expect(slideshowDurationSec(0)).toBe(0);
    expect(slideshowDurationSec(5)).toBe(5 * DEFAULT_PER_SLIDE_SEC);
    expect(slideshowDurationSec(4, { perSlideSec: 2.5 })).toBe(10);
  });

  test('slideshowFitsMax: a 10 perces plafon a diavetítésre is érvényes', () => {
    expect(slideshowFitsMax(100, { perSlideSec: 6 })).toBe(true); // 600 == plafon
    expect(slideshowFitsMax(101, { perSlideSec: 6 })).toBe(false); // 606 > 600
  });

  test('clampPerSlideForMax: a max perSlide, ami még belefér', () => {
    expect(clampPerSlideForMax(200)).toBe(MAX_PROJECT_DURATION_SEC / 200); // 3
    expect(slideshowDurationSec(200, { perSlideSec: clampPerSlideForMax(200) })).toBeLessThanOrEqual(
      MAX_PROJECT_DURATION_SEC
    );
  });

  test('slideshowPlan: helyes klip-szám, start/duration, uri/id', () => {
    const plan = slideshowPlan(slides(3), { perSlideSec: 4 });
    expect(plan).toHaveLength(3);
    expect(plan.map((c) => c.start)).toEqual([0, 4, 8]);
    expect(plan.every((c) => c.duration === 4 && c.kind === 'image' && c.filterId === 'none')).toBe(true);
    expect(plan[0].uri).toBe('file://img0.png');
    expect(plan[0].id).toBe('slide-d0');
  });

  test('átmenet minden képen VAN, kivéve az utolsót', () => {
    const plan = slideshowPlan(slides(3), { perSlideSec: 4, transition: 'dissolve', transitionSec: 0.5 });
    expect(plan[0].transitionOut).toEqual({ type: 'dissolve', duration: 0.5 });
    expect(plan[1].transitionOut).toEqual({ type: 'dissolve', duration: 0.5 });
    expect(plan[2].transitionOut).toBeUndefined(); // utolsó
  });

  test("transition 'none' / 0 → nincs átmenet", () => {
    expect(slideshowPlan(slides(2), { transition: 'none' })[0].transitionOut).toBeUndefined();
    expect(slideshowPlan(slides(2), { transitionSec: 0 })[0].transitionOut).toBeUndefined();
  });

  test('az átmenet-hossz nem több a kép felénél', () => {
    const plan = slideshowPlan(slides(2), { perSlideSec: 0.6, transitionSec: 2 });
    expect(plan[0].transitionOut?.duration).toBe(0.3); // min(2, 0.6/2)
  });

  test('backgroundMusicClip a teljes hosszra, fade-del', () => {
    const bgm = backgroundMusicClip('file://song.mp3', 30);
    expect(bgm.kind).toBe('audio');
    expect(bgm.duration).toBe(30);
    expect(bgm.uri).toBe('file://song.mp3');
    expect(bgm.fadeIn).toBe(1);
    expect(bgm.fadeOut).toBe(1);
  });
});
