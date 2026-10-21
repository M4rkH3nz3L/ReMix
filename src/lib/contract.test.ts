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
import { TIER_ORDER, isPaidTier, tierMeetsMin, type Tier } from '@/lib/tiers';
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
import { TRANSITION_XFADE, xfadeMode, type TransitionType } from '@/lib/transitions';
import { fontFiles, fontOptions } from '@/constants/fonts';
import { MAX_PROJECT_DURATION_SEC } from '@/lib/projectUtils';
import { ENTITLEMENTS, canCloudRender, canCloudStore, shouldWatermark } from '@/lib/entitlements';
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
const workerFonts = require('../../server/fonts');
const workerEntitlements = require('../../server/entitlements');
const workerTiers = require('../../server/tiers');
const fs = require('fs');
const path = require('path');
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

describe('contract: átmenet-xfade (transitions.ts ⇄ server/render.js)', () => {
  it('TRANSITION_XFADE BITRE egyezik a worker XFADE_MODES-szal (preview == export)', () => {
    // EGYETLEN forrás: a preview-geometria és a render ugyanabból a típus→xfade
    // leképezésből dolgozik — egyoldali bővítés itt azonnal piros.
    expect(workerRender.XFADE_MODES).toEqual(TRANSITION_XFADE);
  });

  it('mind a 17 átmenet-típus jelen van mindkét oldalon', () => {
    const clientKeys = Object.keys(TRANSITION_XFADE).sort();
    expect(clientKeys.length).toBe(17);
    expect(Object.keys(workerRender.XFADE_MODES).sort()).toEqual(clientKeys);
  });

  it('xfadeMode irány-variánsok azonosak (wipe/slide/cube + minden irány)', () => {
    const dirs: Array<'left' | 'right' | 'up' | 'down'> = ['left', 'right', 'up', 'down'];
    const types: TransitionType[] = [
      'wipeLeft',
      'wipeRight',
      'wipeUp',
      'wipeDown',
      'slideLeft',
      'slideRight',
      'cube',
      'zoom',
      'dissolve',
      'pixelize',
    ];
    for (const type of types) {
      // irány nélkül
      expect(workerRender.xfadeMode(type)).toBe(xfadeMode(type));
      // minden iránnyal
      for (const d of dirs) {
        expect(workerRender.xfadeMode(type, d)).toBe(xfadeMode(type, d));
      }
    }
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

describe('contract: font-parity (constants/fonts.ts ⇄ server/fonts.js ⇄ _layout useFonts ⇄ TTF-ek)', () => {
  const ROOT = process.cwd(); // a jest a repo-gyökérből fut

  it('a kliens fontFiles bitre egyezik a worker FONT_FILES-szel (nincs drift)', () => {
    // a preview (app @font-face) és az export (worker @font-face) UGYANABBÓL a
    // family→TTF leképezésből dolgozik → bármelyik oldal bővítése a másik nélkül piros
    expect(fontFiles).toEqual(workerFonts.FONT_FILES);
  });

  it('minden UI font-opció (family-vel) szerepel a render-készletben (Preview == Export)', () => {
    for (const opt of fontOptions) {
      if (opt.family) {
        expect(Object.keys(fontFiles)).toContain(opt.family);
      }
    }
  });

  it('minden family TTF-je LÉTEZIK az appban ÉS a workerben is (nincs néma fallback)', () => {
    for (const [family, file] of Object.entries(fontFiles)) {
      expect(typeof file === 'string' && file.endsWith('.ttf')).toBe(true);
      const appTtf = path.join(ROOT, 'assets', 'fonts', file);
      const workerTtf = path.join(ROOT, 'server', 'assets', 'fonts', file);
      expect({ family, app: fs.existsSync(appTtf) }).toEqual({ family, app: true });
      expect({ family, worker: fs.existsSync(workerTtf) }).toEqual({ family, worker: true });
    }
  });

  it('minden family regisztrálva van az app expo-font useFonts-ban (_layout.tsx) → a preview megjeleníti', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'src', 'app', '_layout.tsx'), 'utf8');
    for (const [family, file] of Object.entries(fontFiles)) {
      expect({ family, registered: layout.includes(`${family}: require(`) }).toEqual({ family, registered: true });
      expect({ family, file, present: layout.includes(file) }).toEqual({ family, file, present: true });
    }
  });
});

describe('contract: videó max-hossz (projectUtils.ts ⇄ server/render.js)', () => {
  it('MAX_PROJECT_DURATION_SEC == MAX_RENDER_DURATION_SEC == 600 (10 perc)', () => {
    // a kliens figyelmeztet, a szerver hard-enforce-ol — a határnak EGYEZNIE kell (short-video scope)
    expect(MAX_PROJECT_DURATION_SEC).toBe(600);
    expect(workerRender.MAX_RENDER_DURATION_SEC).toBe(MAX_PROJECT_DURATION_SEC);
  });
});

describe('contract: entitlement-mátrix (entitlements.ts ⇄ server/entitlements.js)', () => {
  it('a kliens ENTITLEMENTS BITRE egyezik a szerver-tükörrel (SCOPES §5, nincs drift)', () => {
    // a kliens-gate (UX) és a szerver-enforce (autoritatív) UGYANABBÓL a mátrixból dolgozik
    expect(workerEntitlements.ENTITLEMENTS).toEqual(ENTITLEMENTS);
  });
  it('mind az 5 tier jelen van mindkét oldalon', () => {
    expect(Object.keys(workerEntitlements.ENTITLEMENTS).sort()).toEqual(Object.keys(ENTITLEMENTS).sort());
  });
  it('routing-magok azonosak minden tieren (shouldWatermark/canCloudRender/canCloudStore)', () => {
    for (const tier of TIER_ORDER) {
      expect(workerEntitlements.shouldWatermark(tier)).toBe(shouldWatermark(tier));
      expect(workerEntitlements.canCloudRender(tier)).toBe(canCloudRender(tier));
      expect(workerEntitlements.canCloudStore(tier)).toBe(canCloudStore(tier));
    }
  });
});

describe('contract: tier-rangsor (tiers.ts ⇄ server/tiers.js)', () => {
  it('TIER_ORDER + isPaidTier azonos', () => {
    expect(workerTiers.TIER_ORDER).toEqual([...TIER_ORDER]);
    for (const t of TIER_ORDER) {
      expect(workerTiers.isPaidTier(t)).toBe(isPaidTier(t));
    }
  });
  it('tierMeetsMin azonos MINDEN tier × minTier párra (a gate-logika egyezik)', () => {
    for (const user of TIER_ORDER) {
      for (const min of TIER_ORDER) {
        expect(workerTiers.tierMeetsMin(user, min)).toBe(tierMeetsMin(user, min));
      }
    }
  });
});

describe('contract: mirror-TELJESSÉG (drift-őr — egyoldali bővítés piros, 06-contract §06.1)', () => {
  // A bitre-egyezésen (toEqual) FELÜL: ha valaki tier-t ad a TIER_ORDER-hez a
  // kvóta nélkül, vagy metrikát a USAGE_METRICS-hez a quota-táblázat nélkül, az
  // a toEqual-t nem feltétlen bukná el két helyen szinkronban — ezt fogja meg.
  it('a TIER_QUOTAS tier-kulcsai PONTOSAN a TIER_ORDER (mindkét oldal)', () => {
    const order = [...TIER_ORDER].sort();
    expect(Object.keys(TIER_QUOTAS).sort()).toEqual(order);
    expect(Object.keys(workerUsage.TIER_QUOTAS).sort()).toEqual(order);
  });

  it('minden tier MINDEN USAGE_METRICS-re definiál kvótát (nincs hiányzó metrika egyik oldalon sem)', () => {
    for (const tier of TIER_ORDER) {
      const q = quotaFor(tier);
      const wq = workerUsage.quotaFor(tier);
      for (const m of USAGE_METRICS) {
        expect({ tier, m, client: q[m] !== undefined }).toEqual({ tier, m, client: true });
        expect({ tier, m, worker: wq[m] !== undefined }).toEqual({ tier, m, worker: true });
        expect(wq[m]).toBe(q[m]);
      }
    }
  });

  it('az ENTITLEMENTS tierei PONTOSAN a TIER_ORDER (nincs tier-drift a 3 mirror-tábla közt)', () => {
    const order = [...TIER_ORDER].sort();
    expect(Object.keys(ENTITLEMENTS).sort()).toEqual(order);
    expect(Object.keys(workerEntitlements.ENTITLEMENTS).sort()).toEqual(order);
  });
});
