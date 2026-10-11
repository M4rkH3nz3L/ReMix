import { buildProductAdPlan, type ProductShot } from '@/lib/productAd';
import type { VideoClip } from '@/types/project';

// 🛍️ Termékvideó-terv (best-shot pontok → product-stílusú snittek + cím/CTA)
// pure pajzsa. A pontozás/AI-cím a hívóé.

let n = 0;
const makeId = () => `id${n++}`;
beforeEach(() => {
  n = 0;
});

const source = (over: Partial<VideoClip> = {}): VideoClip =>
  ({ id: 'src', kind: 'video', start: 0, duration: 20, uri: 'v', trimIn: 0, speed: 1, sourceDuration: 20, volume: 1, filterId: 'none', ...(over as object) } as VideoClip);

const shot = (t: number, score: number): ProductShot => ({ t, score, faces: 0 });

describe('buildProductAdPlan', () => {
  it('nincs használható szelet → null', () => {
    // a window vége felé (< srcEnd - MIN_SHOT) nincs pont → üres
    expect(buildProductAdPlan(source(), [shot(19.9, 1)], { makeId })).toBeNull();
    expect(buildProductAdPlan(source(), [], { makeId })).toBeNull();
  });

  it('a legjobb, egymástól min. távolságra lévő szeletekből hézagmentes sávot épít', () => {
    const plan = buildProductAdPlan(source(), [shot(1, 1), shot(5, 0.9), shot(9, 0.8), shot(13, 0.7)], {
      targetSeconds: 10,
      makeId,
    })!;
    expect(plan.shots).toBe(4);
    // időben rendezve, hézagmentes (minden start = az előző vége)
    const starts = plan.clips.map((c) => c.start);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < plan.clips.length; i++) {
      expect(plan.clips[i].start).toBeCloseTo(plan.clips[i - 1].start + plan.clips[i - 1].duration, 3);
    }
    // a trimIn a kiválasztott forrás-időpont
    expect(plan.clips.map((c) => (c as VideoClip).trimIn)).toEqual([1, 5, 9, 13]);
    expect(plan.totalSeconds).toBeGreaterThan(0);
  });

  it('csak az UTOLSÓ klipnek nincs kimenő átmenete', () => {
    const plan = buildProductAdPlan(source(), [shot(1, 1), shot(5, 0.9), shot(9, 0.8)], { targetSeconds: 8, makeId })!;
    const last = plan.clips.length - 1;
    plan.clips.forEach((c, i) => {
      if (i === last) {
        expect((c as VideoClip).transitionOut).toBeUndefined();
      } else {
        expect((c as VideoClip).transitionOut).toBeDefined();
      }
    });
  });

  it('cím + CTA felirat-klipek: a cím elöl, a CTA a végén', () => {
    const plan = buildProductAdPlan(source(), [shot(1, 1), shot(5, 0.9)], {
      targetSeconds: 8,
      headline: 'Vedd meg',
      cta: 'Most!',
      makeId,
    })!;
    expect(plan.captions).toHaveLength(2);
    expect(plan.captions[0].text).toBe('Vedd meg');
    expect(plan.captions[0].start).toBe(0);
    expect(plan.captions[1].text).toBe('Most!');
    expect(plan.captions[1].start).toBeGreaterThan(0); // a végéhez közel
  });

  it('kevés erős szelet esetén is legalább a 3 legjobbat mérlegeli', () => {
    // egy kiváló + két gyenge → a minőség-kapu alatt is marad min. 3 a poolban
    const plan = buildProductAdPlan(source(), [shot(1, 1), shot(5, 0.1), shot(9, 0.1)], { targetSeconds: 8, makeId });
    expect(plan).not.toBeNull();
    expect(plan!.shots).toBeGreaterThanOrEqual(1);
  });
});
