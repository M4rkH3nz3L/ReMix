import { ACTIVE_STATUSES, TIER_ORDER, activeTierFromRow, asTier, isPaidTier, tierMeetsMin, type Tier } from '@/lib/tiers';
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
import { ENTITLEMENTS, canCloudRender, canCloudStore, shouldWatermark } from '@/lib/entitlements';

/**
 * 🔗 Kliens ⇄ worker CONTRACT-tesztek (01-production §2.7) — szintek, kvóták, jogosultságok.
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
const workerUsage = require('../../server/usage');
const workerEntitlements = require('../../server/entitlements');
const workerTiers = require('../../server/tiers');
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
  it('a hiteles (fail-closed) szint azonos MINDEN státusz × szint × lejárat kombinációra', () => {
    expect(workerTiers.ACTIVE_STATUSES).toEqual([...ACTIVE_STATUSES]);
    const now = Date.parse('2026-11-19T12:00:00Z');
    const statuses = [...ACTIVE_STATUSES, 'canceled', 'past_due', 'expired', '', undefined, 7];
    const tiers = [...TIER_ORDER, 'gold', '', null, undefined, 3];
    const ends = ['2026-11-20T00:00:00Z', '2026-11-19T12:00:00Z', '2026-11-01T00:00:00Z', 'nem dátum', '', null, undefined];
    for (const status of statuses) {
      for (const tier of tiers) {
        for (const current_period_end of ends) {
          const row = { status, tier, current_period_end } as Parameters<typeof activeTierFromRow>[0];
          expect(workerTiers.activeTierFromRow(row, now)).toBe(activeTierFromRow(row, now));
        }
      }
    }
    for (const row of [null, undefined, {}]) expect(workerTiers.activeTierFromRow(row, now)).toBe(activeTierFromRow(row, now));
    for (const v of [...tiers, {}, []]) expect(workerTiers.asTier(v)).toBe(asTier(v));
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
