import { flattenAdjustments } from '@/lib/adjustmentStack';
import { IMAGE_LOOKS, applyLook, isLook, lookFromLayer } from '@/lib/imageLooks';
import type { PhotoLayer } from '@/types/project';

const hu = require('../i18n/locales/hu.json');
const en = require('../i18n/locales/en.json');
const de = require('../i18n/locales/de.json');

const get = (obj: Record<string, unknown>, key: string) => key.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], obj);

describe('🎞️ S17: look-könyvtár', () => {
  it('10 beépített look, egyedi kulccsal, érvényes szerkezettel', () => {
    expect(IMAGE_LOOKS).toHaveLength(10);
    expect(new Set(IMAGE_LOOKS.map((l) => l.key)).size).toBe(10);
    IMAGE_LOOKS.forEach((l) => expect(isLook(l)).toBe(true));
  });

  it('minden look-név és lépés-név le van fordítva (hu, en, de)', () => {
    for (const loc of [hu, en, de]) {
      for (const look of IMAGE_LOOKS) {
        expect([look.key, typeof get(loc, look.name)]).toEqual([look.key, 'string']);
        for (const s of look.steps) expect([s.name, typeof get(loc, s.name)]).toEqual([s.name, 'string']);
      }
    }
  });

  it('a look a verem + HSL CSERÉJE, szerkeszthető lépésekkel; az adjust a verem laposítása', () => {
    const look = IMAGE_LOOKS.find((l) => l.key === 'cinematic')!;
    const patch = applyLook(look, (k) => `T(${k})`);
    expect(patch.adjustmentStack).toHaveLength(look.steps.length);
    expect(patch.adjustmentStack!.every((s) => s.enabled && s.amount === 1 && s.name.startsWith('T('))).toBe(true);
    expect(patch.adjust).toEqual(flattenAdjustments(patch.adjustmentStack!));
    expect(patch.adjust!.balance).toBeDefined();
    expect(patch.hsl).toEqual(look.hsl);
    // HSL nélküli look a meglévő HSL-t is leveszi
    expect(applyLook(IMAGE_LOOKS.find((l) => l.key === 'pop')!).hsl).toBeUndefined();
  });

  it('saját look a fotóból: a kikapcsolt lépés kimarad, az erősség beleszámít; visszaalkalmazva ugyanaz', () => {
    const base = applyLook(IMAGE_LOOKS.find((l) => l.key === 'landscape')!);
    const stack = base.adjustmentStack!.map((s, i) => (i === 0 ? { ...s, enabled: false } : i === 1 ? { ...s, amount: 0.5 } : s));
    const layer = { adjustmentStack: stack, adjust: flattenAdjustments(stack), hsl: base.hsl } as PhotoLayer;
    const mine = lookFromLayer(layer, 'k1', 'Saját')!;
    expect(mine.custom).toBe(true);
    expect(mine.steps).toHaveLength(2);
    expect(mine.steps[0].adjust.contrast).toBeCloseTo(0.075);
    expect(applyLook(mine).adjust).toEqual(flattenAdjustments(stack));
    expect(applyLook(mine).hsl).toEqual(base.hsl);
  });

  it('üres fotóból nincs look; a sima (verem nélküli) adjust egy lépés lesz', () => {
    expect(lookFromLayer({} as PhotoLayer, 'k', 'n')).toBeNull();
    expect(lookFromLayer({ adjust: { exposure: 0.2 } } as PhotoLayer, 'k', 'n')!.steps).toEqual([{ kind: 'custom', name: 'n', adjust: { exposure: 0.2 } }]);
  });

  it('a hibás tárolt look elutasítva', () => {
    expect(isLook({ key: 'a', name: 'b', steps: [{ kind: 'custom' }] })).toBe(false);
    expect(isLook(null)).toBe(false);
  });
});
