import { developToFilterPlan, isNeutralDevelop, neutralDevelop, type PhotoDevelop } from '@/lib/photoDevelop';

/**
 * 🔗 Kliens ⇄ worker CONTRACT-tesztek (01-production §2.7) — RAW-develop terv.
 *
 * A platformon több logika szándékosan "tükrözve" él mindkét oldalon: a **kliens**
 * TypeScript a preview/UI/soft-warn-hoz, a **worker** JavaScript a render/enforce-hoz.
 * A kettőnek bitre egyeznie KELL (preview == export, kliens-becslés == server-enforce),
 * különben csendben szétcsúsznak. Az egyes oldalak külön unit-tesztjei HARDCODE-olt
 * elvárásokkal dolgoznak — ezek viszont MINDKÉT oldalt importálják és EGYMÁShoz kötik,
 * így a drift azonnal piros tesztként jelentkezik (a CI-ben is).
 *
 * Megjegyzés: a worker-modulok sima CommonJS JS-ek — a kliens (jest-expo) projekt
 * babellel betölti őket; a `require` visszatérése `any`, ezért a tsc nem lép be a .js-be.
 * (A korábbi egyetlen contract.test.ts tartományonként bontva: *.contract.test.ts.)
 */

/* eslint-disable @typescript-eslint/no-require-imports -- a server/ CommonJS JS-modulja (típus nélkül), a kliens–worker szerződésteszt require-rel tölti */
const workerImageDoc = require('../../server/imagedoc');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('contract: RAW-develop plan (photoDevelop.ts ⇄ server/imagedoc.js)', () => {
  // 📸 PIXEL 01: a non-destruktív fotó-előhívás EGYETLEN forrás-igazsága a deklaratív
  // lépés-lista. A kliens preview (UI/summarizeDevelop) és a worker render (developChain)
  // UGYANEBBŐL a tervből dolgozik → egyoldali bővítés itt azonnal piros.
  const CASES: Array<[string, PhotoDevelop]> = [
    ['neutrális', neutralDevelop()],
    ['csak-detail (clarity/texture/dehaze)', { base: {}, detail: { clarity: 0.4, texture: -0.3, dehaze: 0.6 } }],
    ['csak-base-tónus (exposure/highlights/shadows)', { base: { exposure: 0.5, highlights: -0.4, shadows: 0.3 }, detail: {} }],
    ['base-szín + lens', { base: { temperature: 0.2, tint: -0.1, saturation: 0.5, vignette: 0.3 }, detail: { chromaticAberration: 0.5, lensDistortion: -0.4 } }],
    ['teljes keverék', { base: { exposure: 0.3, contrast: 0.2, whites: 0.1, blacks: -0.2, vibrance: 0.4, hue: 0.1, hslSaturation: -0.3, hslLuminance: 0.2, vignette: 0.5 }, detail: { clarity: 0.5, texture: 0.3, dehaze: -0.2, sharpness: 0.6, noiseReduction: 0.4, chromaticAberration: 0.3, lensDistortion: 0.2 } }],
    ['0-mezők kimaradnak (stabil sorrend)', { base: { exposure: 0, contrast: 0.2, saturation: 0 }, detail: { clarity: 0, texture: 0.3 } }],
  ];

  it('developToFilterPlan BITRE azonos a worker developFilterPlan-nel (preview == export)', () => {
    for (const [name, dev] of CASES) {
      expect({ name, plan: workerImageDoc.developFilterPlan(dev) }).toEqual({ name, plan: developToFilterPlan(dev) });
    }
  });

  it('isNeutralDevelop azonos EREDMÉNY mindkét oldalon (nincs hatás-detektálás drift)', () => {
    for (const [name, dev] of CASES) {
      expect({ name, neutral: workerImageDoc.isNeutralDevelop(dev) }).toEqual({ name, neutral: isNeutralDevelop(dev) });
    }
    // görbe/3-way jelenléte: a kliens nem-neutrális → a worker developChain is fut
    const curved: PhotoDevelop = { base: { curves: { rgb: [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }] } }, detail: {} };
    expect(workerImageDoc.isNeutralDevelop(curved)).toBe(isNeutralDevelop(curved));
    expect(isNeutralDevelop(curved)).toBe(false);
  });

  it('a developChain neutrális/hiányzó developre ÜRES (additív — a mai dokumentumok változatlanok)', () => {
    expect(workerImageDoc.developChain(undefined)).toBe('');
    expect(workerImageDoc.developChain(neutralDevelop())).toBe('');
  });
});
