/**
 * 🔗 Kliens ⇄ worker CONTRACT-tesztek (01-production §2.7).
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
 */
import type { Tier } from '@/lib/tiers';
import {
  TIER_QUOTAS,
  USAGE_METRICS,
  canUse,
  isUnlimited,
  periodKey,
  quotaFor,
  remaining,
  type UsageCounters,
  type UsageMetric,
} from '@/lib/usageMeter';
import { shearPoint, skewUnitCorners } from '@/lib/canvasTransform';
import { PRESET_BEZIER, bezierEase } from '@/lib/keyframes';
import {
  VIDEO_EFFECTS,
  VIDEO_EFFECT_TYPES,
  effectChainFilters,
  effectFilterString,
} from '@/lib/videoEffects';
import type { VideoEffect } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const workerUsage = require('../../server/usage');
const workerRender = require('../../server/render');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('contract: usage-kvóta (usageMeter.ts ⇄ server/usage.js)', () => {
  it('TIER_QUOTAS bitre azonos mindkét oldalon', () => {
    // A legfontosabb mirror: a kliens soft-warn és a worker hard-enforce UGYANAZ
    // a kvóta-táblából dolgozik. (Ezt frissen hoztam létre mindkét helyen → drift-veszély.)
    expect(workerUsage.TIER_QUOTAS).toEqual(TIER_QUOTAS);
  });

  it('USAGE_METRICS azonos halmaz', () => {
    expect([...workerUsage.USAGE_METRICS].sort()).toEqual([...USAGE_METRICS].sort());
  });

  it('periodKey azonos (UTC YYYY-MM) több dátumra', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-10-06T23:59:59Z', '2027-12-31T12:00:00Z']) {
      const d = new Date(iso);
      expect(workerUsage.periodKey(d)).toBe(periodKey(d));
    }
  });

  it('isUnlimited azonos minden tier × metrika-párra', () => {
    for (const tier of Object.keys(TIER_QUOTAS) as Tier[]) {
      const q = quotaFor(tier);
      for (const m of USAGE_METRICS) {
        expect(workerUsage.isUnlimited(q, m)).toBe(isUnlimited(q, m));
      }
    }
  });

  it('remaining/canUse azonos EREDMÉNY (az eltérő arg-alak ellenére)', () => {
    // kliens: remaining(counters, quota, m) · worker: remaining(used, quota, m)
    const q = quotaFor('free');
    const cases: Array<[number, UsageMetric]> = [
      [0, 'aiTokens'],
      [19000, 'aiTokens'],
      [25, 'cloudJobs'],
      [9, 'renderMinutes'],
      [15, 'exports'],
    ];
    for (const [used, m] of cases) {
      const c: UsageCounters = {};
      c[m] = used;
      expect(workerUsage.remaining(used, q, m)).toBe(remaining(c, q, m));
      expect(workerUsage.canUse(used, q, m, 1)).toBe(canUse(c, q, m, 1));
    }
    // korlátlan (pro exports) → mindkét oldalon Infinity
    const pro = quotaFor('pro');
    const cp: UsageCounters = { exports: 1e9 };
    expect(workerUsage.remaining(1e9, pro, 'exports')).toBe(remaining(cp, pro, 'exports'));
  });
});

describe('contract: effekt-filterek (videoEffects.ts ⇄ server/render.js)', () => {
  it('effectFilterString azonos minden típus × amount-ra', () => {
    const amounts = [0, 0.3, 0.5, 0.7, 1];
    for (const type of VIDEO_EFFECT_TYPES) {
      for (const amount of amounts) {
        const e: VideoEffect = { id: 'x', type, amount };
        expect(workerRender.effectFilterStr(e)).toBe(effectFilterString(e));
      }
    }
  });

  it('null-amount VÉDELMI ág is azonos (per-típus default)', () => {
    // amount nélkül mindkét oldal a per-típus defaultAmount-ot használja
    for (const type of VIDEO_EFFECT_TYPES) {
      const e: VideoEffect = { id: 'x', type };
      expect(workerRender.effectFilterStr(e)).toBe(effectFilterString(e));
    }
  });

  it('EFFECT_DEFAULT_AMOUNT == a kliens VIDEO_EFFECTS defaultAmount-ja', () => {
    for (const type of VIDEO_EFFECT_TYPES) {
      expect(workerRender.EFFECT_DEFAULT_AMOUNT[type]).toBe(VIDEO_EFFECTS[type].defaultAmount);
    }
  });

  it('a teljes lánc-füzér azonos (effectChainFilters ⇄ effectChainFx), tiltott kimarad', () => {
    const effects: VideoEffect[] = [
      { id: 'a', type: 'grayscale', amount: 1 },
      { id: 'b', type: 'invert', amount: 1, enabled: false }, // tiltott → mindkét oldalon kimarad
      { id: 'c', type: 'blur', amount: 0.5 },
      { id: 'd', type: 'vignette', amount: 0.25 },
    ];
    expect(workerRender.effectChainFx({ effects })).toBe(effectChainFilters(effects));
  });
});

describe('contract: skew-nyírás (canvasTransform.ts ⇄ server/render.js)', () => {
  it('shearPoint bitre azonos minden (x,y,skewX,skewY) mintára', () => {
    const pts: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [0, 0],
      [0.5, 0.25],
    ];
    const skews: [number, number][] = [
      [0, 0],
      [10, 0],
      [0, 15],
      [30, -20],
      [45, 45],
      [-45, -30],
    ];
    for (const [x, y] of pts) {
      for (const [sx, sy] of skews) {
        const w = workerRender.shearPoint(x, y, sx, sy);
        const c = shearPoint(x, y, sx, sy);
        expect(w.x).toBeCloseTo(c.x, 12);
        expect(w.y).toBeCloseTo(c.y, 12);
      }
    }
  });

  it('a worker shearPoint az egységnégyzet sarkain == a kliens skewUnitCorners', () => {
    for (const [sx, sy] of [
      [12, 0],
      [0, 20],
      [25, -15],
    ] as [number, number][]) {
      const corners = skewUnitCorners(sx, sy); // [tl, tr, br, bl]
      const expected = (
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ] as [number, number][]
      ).map(([x, y]) => workerRender.shearPoint(x, y, sx, sy));
      corners.forEach((c, i) => {
        expect(c.x).toBeCloseTo(expected[i].x, 12);
        expect(c.y).toBeCloseTo(expected[i].y, 12);
      });
    }
  });
});

describe('contract: keyframe bezier-easing (keyframes.ts ⇄ server/render.js)', () => {
  it('bezierEaseNode azonos a bezierEase-szel minden preset-görbe × p-re', () => {
    const ps = [0, 0.1, 0.25, 0.5, 0.5001, 0.75, 0.9, 1];
    for (const cp of Object.values(PRESET_BEZIER)) {
      for (const p of ps) {
        expect(workerRender.bezierEaseNode(cp, p)).toBe(bezierEase(cp, p));
      }
    }
    // egyedi (nem-preset) görbére is azonos a felezéses megoldás
    const custom: [number, number, number, number] = [0.2, 0.8, 0.3, 0.9];
    for (const p of ps) {
      expect(workerRender.bezierEaseNode(custom, p)).toBe(bezierEase(custom, p));
    }
  });
});
