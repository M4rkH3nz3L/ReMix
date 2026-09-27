import {
  clampDevelop,
  copyDevelop,
  developToFilterPlan,
  isNeutralDevelop,
  neutralDevelop,
  summarizeDevelop,
  syncDevelop,
  type PhotoDevelop,
} from '@/lib/photoDevelop';

describe('photoDevelop — neutral / clamp', () => {
  it('neutralDevelop üres és neutrálisnak számít', () => {
    const n = neutralDevelop();
    expect(n).toEqual({ base: {}, detail: {} });
    expect(isNeutralDevelop(n)).toBe(true);
  });

  it('bármely nem-nulla param → nem neutrális', () => {
    expect(isNeutralDevelop({ base: { exposure: 0.2 }, detail: {} })).toBe(false);
    expect(isNeutralDevelop({ base: {}, detail: { clarity: 0.3 } })).toBe(false);
    expect(isNeutralDevelop({ base: { exposure: 0 }, detail: { clarity: 0 } })).toBe(true);
  });

  it('a görbe/3-way jelenléte is nem-neutrális', () => {
    expect(isNeutralDevelop({ base: { balance: { sh: { r: 0.1 } } }, detail: {} })).toBe(false);
  });

  it('clampDevelop a tartományba vág (base + detail)', () => {
    const dev: PhotoDevelop = {
      base: { exposure: 5, temperature: -9, contrast: 0.2 },
      detail: { sharpness: 3, lensDistortion: -8, dehaze: 0.5 },
    };
    const c = clampDevelop(dev);
    expect(c.base.exposure).toBe(1); // [-1,1]
    expect(c.base.temperature).toBe(-0.3); // [-0.3,0.3]
    expect(c.base.contrast).toBe(0.2); // tartományban marad
    expect(c.detail.sharpness).toBe(1); // [0,1]
    expect(c.detail.lensDistortion).toBe(-1); // [-1,1]
    expect(c.detail.dehaze).toBe(0.5);
  });

  it('clamp immutábilis', () => {
    const dev: PhotoDevelop = { base: { exposure: 5 }, detail: {} };
    clampDevelop(dev);
    expect(dev.base.exposure).toBe(5);
  });
});

describe('photoDevelop — copy / sync (batch)', () => {
  const source: PhotoDevelop = {
    base: { exposure: 0.5, temperature: 0.2, vignette: 0.4 },
    detail: { sharpness: 0.6, chromaticAberration: 0.3 },
  };

  it('copyDevelop mély másolat', () => {
    const c = copyDevelop(source);
    c.base.exposure = 0;
    expect(source.base.exposure).toBe(0.5);
  });

  it('syncDevelop csak a választott csoportot húzza rá (a csoport a FORRÁSRA igazodik)', () => {
    const target: PhotoDevelop = { base: { contrast: 0.3, saturation: 0.5 }, detail: {} };
    const synced = syncDevelop(target, source, ['tone']);
    expect(synced.base.exposure).toBe(0.5); // tone → átjött
    expect(synced.base.contrast).toBeUndefined(); // contrast is tone: a forrásban nincs → törlődik
    expect(synced.base.saturation).toBe(0.5); // saturation NEM tone (color) → érintetlen marad
    expect(synced.base.temperature).toBeUndefined(); // color csoport NEM jött
    expect(synced.detail.sharpness).toBeUndefined(); // detail csoport NEM jött
  });

  it('syncDevelop lens csoport a vignette-t (base) ÉS a CA-t (detail) is viszi', () => {
    const target: PhotoDevelop = { base: {}, detail: {} };
    const synced = syncDevelop(target, source, ['lens']);
    expect(synced.base.vignette).toBe(0.4);
    expect(synced.detail.chromaticAberration).toBe(0.3);
    expect(synced.base.exposure).toBeUndefined();
  });

  it('több csoport együtt', () => {
    const synced = syncDevelop({ base: {}, detail: {} }, source, ['tone', 'color', 'detail']);
    expect(synced.base.exposure).toBe(0.5);
    expect(synced.base.temperature).toBe(0.2);
    expect(synced.detail.sharpness).toBe(0.6);
  });

  it('a forrásban hiányzó kulcsot a targetből is eltávolítja (sync = ráigazítás)', () => {
    const target: PhotoDevelop = { base: { exposure: 0.9 }, detail: {} };
    const emptySource: PhotoDevelop = { base: {}, detail: {} };
    const synced = syncDevelop(target, emptySource, ['tone']);
    expect(synced.base.exposure).toBeUndefined();
  });
});

describe('photoDevelop — filter-terv + összefoglaló', () => {
  it('csak a nem-nulla paraméterek, stabil sorrendben (tónus → szín → detail → lens)', () => {
    const dev: PhotoDevelop = {
      base: { exposure: 0.3, temperature: -0.1, contrast: 0 },
      detail: { clarity: 0.4, chromaticAberration: 0.2 },
    };
    const plan = developToFilterPlan(dev);
    expect(plan.map((s) => s.param)).toEqual(['exposure', 'temperature', 'clarity', 'chromaticAberration']);
    expect(plan.find((s) => s.param === 'exposure')!.value).toBe(0.3);
  });

  it('neutrális előhívás → üres terv', () => {
    expect(developToFilterPlan(neutralDevelop())).toEqual([]);
  });

  it('summarizeDevelop az aktív paraméter-neveket adja', () => {
    expect(summarizeDevelop({ base: { exposure: 0.2 }, detail: { texture: 0.5 } })).toEqual(['exposure', 'texture']);
  });
});
