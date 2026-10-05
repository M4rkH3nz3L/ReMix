import {
  addEffect,
  effectChainFilters,
  effectFilterString,
  moveEffect,
  removeEffect,
  resolveEffects,
  setEffectAmount,
  toggleEffect,
  VIDEO_EFFECT_TYPES,
  VIDEO_EFFECTS,
} from '@/lib/videoEffects';
import type { VideoEffect } from '@/types/project';

/** determinisztikus genId a teszthez */
const genId = (() => {
  let n = 0;
  return () => `fx${++n}`;
})();

const fx = (id: string, type: VideoEffect['type'], over: Partial<VideoEffect> = {}): VideoEffect => ({
  id,
  type,
  amount: VIDEO_EFFECTS[type].defaultAmount,
  ...over,
});

describe('videoEffects — lánc-műveletek (audit §6.5)', () => {
  it('katalógus: minden típus benne', () => {
    expect(VIDEO_EFFECT_TYPES).toEqual(['blur', 'sharpen', 'vignette', 'grain', 'grayscale', 'sepia', 'invert']);
  });

  it('addEffect a lánc végére, default amounttal', () => {
    const list = addEffect(undefined, 'blur', genId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'blur', amount: VIDEO_EFFECTS.blur.defaultAmount });
    const list2 = addEffect(list, 'invert', genId);
    expect(list2.map((e) => e.type)).toEqual(['blur', 'invert']);
    // additív: az eredeti tömb nem változik (immutábilis)
    expect(list).toHaveLength(1);
  });

  it('removeEffect id szerint', () => {
    const list = [fx('a', 'blur'), fx('b', 'grain')];
    expect(removeEffect(list, 'a').map((e) => e.id)).toEqual(['b']);
    expect(removeEffect(list, 'nincs')).toHaveLength(2);
  });

  it('moveEffect: fel/le + határon no-op', () => {
    const list = [fx('a', 'blur'), fx('b', 'grain'), fx('c', 'invert')];
    expect(moveEffect(list, 'b', -1).map((e) => e.id)).toEqual(['b', 'a', 'c']);
    expect(moveEffect(list, 'b', 1).map((e) => e.id)).toEqual(['a', 'c', 'b']);
    expect(moveEffect(list, 'a', -1).map((e) => e.id)).toEqual(['a', 'b', 'c']); // határ
    expect(moveEffect(list, 'c', 1).map((e) => e.id)).toEqual(['a', 'b', 'c']); // határ
  });

  it('toggleEffect: ki → vissza', () => {
    const list = [fx('a', 'blur')];
    const off = toggleEffect(list, 'a');
    expect(off[0].enabled).toBe(false);
    const on = toggleEffect(off, 'a');
    expect(on[0].enabled).toBeUndefined();
  });

  it('setEffectAmount: 0–1-re szorít', () => {
    const list = [fx('a', 'blur')];
    expect(setEffectAmount(list, 'a', 0.7)[0].amount).toBe(0.7);
    expect(setEffectAmount(list, 'a', 2)[0].amount).toBe(1);
    expect(setEffectAmount(list, 'a', -1)[0].amount).toBe(0);
  });

  it('resolveEffects: csak az engedélyezettek, sorrendben', () => {
    const list = [fx('a', 'blur'), fx('b', 'grain', { enabled: false }), fx('c', 'invert')];
    expect(resolveEffects(list).map((e) => e.id)).toEqual(['a', 'c']);
    expect(resolveEffects(undefined)).toEqual([]);
  });
});

describe('videoEffects — FFmpeg-filter leképezés', () => {
  it('parametrikus effektek az amounttól függnek', () => {
    expect(effectFilterString(fx('a', 'blur', { amount: 0.5 }))).toBe('gblur=sigma=10.00');
    expect(effectFilterString(fx('a', 'blur', { amount: 0 }))).toBe('gblur=sigma=0.00');
    expect(effectFilterString(fx('a', 'grain', { amount: 1 }))).toBe('noise=alls=40:allf=t+u');
    expect(effectFilterString(fx('a', 'vignette', { amount: 0 }))).toBe('vignette=a=0.100');
  });

  it('fix effektek', () => {
    expect(effectFilterString(fx('a', 'grayscale'))).toBe('hue=s=0');
    expect(effectFilterString(fx('a', 'invert'))).toBe('negate');
    expect(effectFilterString(fx('a', 'sepia'))).toContain('colorchannelmixer=');
  });

  it('amount clamp a filterben is', () => {
    expect(effectFilterString(fx('a', 'blur', { amount: 5 }))).toBe('gblur=sigma=20.00');
  });

  it('effectChainFilters: vezető vessző + sorrend, üresre üres', () => {
    expect(effectChainFilters(undefined)).toBe('');
    expect(effectChainFilters([])).toBe('');
    const list = [fx('a', 'grayscale'), fx('b', 'invert', { enabled: false }), fx('c', 'blur', { amount: 0.5 })];
    // 'b' tiltott → kimarad; a sorrend: grayscale, blur
    expect(effectChainFilters(list)).toBe(',hue=s=0,gblur=sigma=10.00');
  });
});
