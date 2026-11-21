import { COIN_PACKS, FEE_PCT, MIN_PAYOUT_CENTS, TIER_PRICE_CENTS, COIN_PAYOUT_EUR } from '@/lib/coins';
import { ADDONS } from '@/lib/subscriptionPlan';
import { STORE_TIERS, parseStoreProductId, storeProductId } from '@/lib/storeProducts';
import { TIER_ORDER, activeTierFromRow } from '@/lib/tiers';
import { seatQuota, effectiveQuota } from '@/lib/usageMeter';
import { ENTITLEMENTS } from '@/lib/entitlements';

/**
 * 🔗 Kliens ⇄ worker CONTRACT-tesztek (01-production §2.7) — PRO-CASH szintek, Coin-főkönyv, áruházi termékek, előfizetési ciklus (kliens ⇄ worker ⇄ DB).
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
const workerRc = require('../../server/rcEvents');
const fs = require('fs');
const path = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */

/** A migrációk közül a LEGUTOLSÓ, amelyik a `fnName` függvényt definiálja — a DB aktuális állapota. */
function latestSqlFunction(fnName: string): string {
  const dir = path.join(process.cwd(), 'supabase', 'migrations');
  const files: string[] = fs.readdirSync(dir).filter((f: string) => f.endsWith('.sql')).sort();
  const re = new RegExp(`create or replace function public\\.${fnName}\\([\\s\\S]*?\\$\\$;`, 'g');
  let found = '';
  for (const f of files) {
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(re);
    if (m) {
      found = m[m.length - 1];
    }
  }
  return found;
}

describe('contract: PRO-CASH szintek (kliens ⇄ worker ⇄ DB)', () => {
  it('a felhő-tárhely GB / szint a DB tier_storage_gb-ben = ENTITLEMENTS.storageQuotaGB (mindkét oldal)', () => {
    const sql = latestSqlFunction('tier_storage_gb');
    expect(sql).not.toBe('');
    for (const tier of TIER_ORDER) {
      const m = new RegExp(`when '${tier}' then (\\d+)`).exec(sql);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBe(ENTITLEMENTS[tier].storageQuotaGB);
      expect(workerEntitlements.ENTITLEMENTS[tier].storageQuotaGB).toBe(ENTITLEMENTS[tier].storageQuotaGB);
    }
  });

  it('a DB subscriptions.tier mind az 5 szintet engedi (TIER_ORDER)', () => {
    const dir = path.join(process.cwd(), 'supabase', 'migrations');
    const files: string[] = fs.readdirSync(dir).filter((f: string) => f.endsWith('.sql')).sort();
    let check = '';
    for (const f of files) {
      const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/subscriptions_tier_check\s+check \(tier in \(([^)]*)\)\)/g);
      if (m) {
        check = m[m.length - 1];
      }
    }
    for (const tier of TIER_ORDER) {
      expect(check).toContain(`'${tier}'`);
    }
  });

  it('activeTierFromRow azonos a kliensen és a workeren (státusz × lejárat × szint)', () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    const rows = [
      null,
      { tier: 'ultra', status: 'active', current_period_end: '2026-12-01T00:00:00Z' },
      { tier: 'ultra', status: 'active', current_period_end: '2026-11-01T00:00:00Z' },
      { tier: 'basic', status: 'trialing', current_period_end: '2026-11-10T00:00:00Z' },
      { tier: 'pro', status: 'canceled', current_period_end: '2026-12-01T00:00:00Z' },
      { tier: 'business', status: 'active', current_period_end: null },
      { tier: 'nope', status: 'active', current_period_end: null },
      { tier: 'pro', status: 'active', current_period_end: 'nem-dátum' },
    ];
    for (const r of rows) {
      expect(workerTiers.activeTierFromRow(r, now)).toBe(activeTierFromRow(r, now));
    }
    expect(activeTierFromRow(rows[1], now)).toBe('ultra');
    expect(activeTierFromRow(rows[2], now)).toBe('free');
    expect(activeTierFromRow(rows[5], now)).toBe('free'); // lejárat nélkül: fail-closed
    expect(activeTierFromRow(rows[7], now)).toBe('free');
  });

  it('seatQuota azonos (Vállalati × ülésszám, min. 2)', () => {
    for (const tier of TIER_ORDER) {
      for (const seats of [1, 2, 7]) {
        expect(workerUsage.seatQuota(tier, seats)).toEqual(seatQuota(tier, seats));
      }
    }
  });

  it('a DB active_tier_for ugyanazokat a státuszokat engedi, mint az ACTIVE_STATUSES', () => {
    const sql = latestSqlFunction('active_tier_for');
    const m = /s\.status in \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const dbStatuses = m![1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    expect(dbStatuses).toEqual([...workerTiers.ACTIVE_STATUSES].sort());
  });
});

describe('contract: Coin-főkönyv (src/lib/coins.ts ⇄ DB)', () => {
  it('a havidíj cent-Coinban: tier_price_cents = TIER_PRICE_CENTS', () => {
    const sql = latestSqlFunction('tier_price_cents');
    for (const tier of TIER_ORDER) {
      const m = new RegExp(`when '${tier}' then (\\d+)`).exec(sql);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBe(TIER_PRICE_CENTS[tier]);
    }
  });

  it('a platform-díj: coin_fee_pct = FEE_PCT (bolt, ajándék)', () => {
    const sql = latestSqlFunction('coin_fee_pct');
    expect(sql).toContain(`when 'sale' then ${FEE_PCT.sale}`);
    expect(sql).toContain(`when 'gift' then ${FEE_PCT.gift}`);
  });

  it('a kifizetési minimum és a beváltási ár azonos', () => {
    expect(latestSqlFunction('coin_min_payout_cents')).toContain(`select ${MIN_PAYOUT_CENTS}::bigint`);
    expect(latestSqlFunction('coin_payout_eur_cents')).toContain(`select p_cents * ${COIN_PAYOUT_EUR}`);
  });
});

describe('contract: áruházi termékek (storeProducts.ts / coins.ts ⇄ server/rcEvents.js)', () => {
  it('a Coin-csomagok (Coin + bónusz) azonosak', () => {
    expect(workerRc.COIN_PACKS).toEqual(COIN_PACKS.map((p) => [p.id, p.coins, p.bonusCoins]));
    for (const p of COIN_PACKS) {
      expect(workerRc.coinPackFor(p.id)).toEqual({ id: p.id, cents: p.coins * 100, bonusCents: Math.round(p.bonusCoins * 100) });
    }
  });

  it('az előfizetési termék-azonosítókat mindkét oldal ugyanúgy érti', () => {
    for (const tier of STORE_TIERS) {
      for (const period of ['monthly', 'annual'] as const) {
        const id = storeProductId(tier, period);
        expect(workerRc.subscriptionProduct(id)).toEqual(parseStoreProductId(id));
      }
    }
    expect(workerRc.subscriptionProduct('remix_business_monthly')).toBeNull();
  });
});

describe('contract: előfizetési ciklus (subscriptionPlan.ts / usageMeter.ts ⇄ worker ⇄ DB)', () => {
  it('az add-onok havi ára és minimum-szintje a DB-ben azonos', () => {
    const price = latestSqlFunction('addon_price_cents');
    const minTier = latestSqlFunction('addon_min_tier');
    for (const a of ADDONS) {
      expect(price).toContain(`when '${a.id}' then ${a.priceCents}`);
      const proOnly = minTier.includes(`'${a.id}'`);
      expect(proOnly ? 'pro' : 'basic').toBe(a.minTier);
    }
  });

  it('effectiveQuota azonos (ülésszám + add-on többlet, a korlátlan korlátlan marad)', () => {
    const extras = { aiTokens: 2000000, renderMinutes: 60 };
    for (const tier of TIER_ORDER) {
      for (const seats of [1, 3]) {
        expect(workerUsage.effectiveQuota(tier, seats, extras)).toEqual(effectiveQuota(tier, seats, extras));
      }
    }
    expect(effectiveQuota('pro', 1, extras).aiTokens).toBe(3000000);
    expect(effectiveQuota('pro', 1, extras).exports).toBe(-1);
  });

  it('a DB add-on-többlet kulcsai a usage-metrikák (subscription_quota_for)', () => {
    const sql = latestSqlFunction('subscription_quota_for');
    expect(sql).toContain("'aiTokens', coalesce((select sum(qty) * 1000000");
    expect(sql).toContain("'renderMinutes', coalesce((select sum(qty) * 60");
  });
});
