import { ENTITLEMENTS, can, canCloudRender, canCloudStore, entitlementsFor, shouldWatermark } from './entitlements';
import { TIER_ORDER, type Tier } from './tiers';

const INF = (n: number) => (n < 0 ? Infinity : n); // -1 = pool/korlátlan → Infinity a rendezéshez

describe('entitlements — SCOPES.md §5 mátrix', () => {
  test('mind az 5 tier-nek van bejegyzése', () => {
    expect(Object.keys(ENTITLEMENTS).sort()).toEqual([...TIER_ORDER].sort());
    expect(TIER_ORDER).toEqual(['free', 'basic', 'pro', 'ultra', 'business']);
  });

  test('⭐ Free = 100% ESZKÖZÖN (nulla cloud) + 720p + vízjel', () => {
    const f = ENTITLEMENTS.free;
    expect(f.renderEngine).toBe('device');
    expect(f.storageLocation).toBe('device');
    expect(f.storageCloudBackup).toBe(false);
    expect(f.storageQuotaGB).toBe(0);
    expect(f.aiCloud).toBe(false);
    expect(f.aiOnDevice).toBe(true);
    expect(f.renderMaxRes).toBe(720);
    expect(f.watermark).toBe(true);
    expect(f.publishEnabled).toBe(false);
  });

  test('vízjel KIZÁRÓLAG a free-n (minden fizetős szinten nincs)', () => {
    for (const t of TIER_ORDER) {
      expect(ENTITLEMENTS[t].watermark).toBe(t === 'free');
    }
  });

  test('a felhő a fizetős határ: basic+ kap felhő-mentést; pro+ felhő-rendert', () => {
    expect(ENTITLEMENTS.free.storageCloudBackup).toBe(false);
    for (const t of ['basic', 'pro', 'ultra', 'business'] as Tier[]) {
      expect(ENTITLEMENTS[t].storageCloudBackup).toBe(true);
    }
    expect(ENTITLEMENTS.free.renderEngine).toBe('device');
    for (const t of ['pro', 'ultra', 'business'] as Tier[]) {
      expect(ENTITLEMENTS[t].renderEngine).toBe('cloud');
    }
  });

  test('aiCloud: free/basic nincs, pro/ultra/business van', () => {
    expect(ENTITLEMENTS.free.aiCloud).toBe(false);
    expect(ENTITLEMENTS.basic.aiCloud).toBe(false);
    for (const t of ['pro', 'ultra', 'business'] as Tier[]) {
      expect(ENTITLEMENTS[t].aiCloud).toBe(true);
    }
  });

  test('Céges (business) kap csapat-funkciókat (rbac/governance/kliens-kezelés/api)', () => {
    const b = ENTITLEMENTS.business;
    expect(b.rbac).toBe(true);
    expect(b.brandGovernance).toBe('team-lock');
    expect(b.clientManagement).toBe(true);
    expect(b.apiWhitelabel).toBe(true);
    expect(b.teamSeats).toBe(-1); // per-seat
    expect(b.publishMaxAccounts).toBe(-1); // korlátlan
    // a kisebb tiereken NINCS csapat
    for (const t of ['free', 'basic', 'pro', 'ultra'] as Tier[]) {
      expect(ENTITLEMENTS[t].rbac).toBe(false);
      expect(ENTITLEMENTS[t].teamSeats).toBe(1);
    }
  });

  test('monoton (nem csökkenő) a rang mentén: felbontás / publish-fiók / storage-GB', () => {
    const res = TIER_ORDER.map((t) => ENTITLEMENTS[t].renderMaxRes);
    const acc = TIER_ORDER.map((t) => INF(ENTITLEMENTS[t].publishMaxAccounts));
    const gb = TIER_ORDER.map((t) => INF(ENTITLEMENTS[t].storageQuotaGB));
    for (let i = 1; i < TIER_ORDER.length; i++) {
      expect(res[i]).toBeGreaterThanOrEqual(res[i - 1]);
      expect(acc[i]).toBeGreaterThanOrEqual(acc[i - 1]);
      expect(gb[i]).toBeGreaterThanOrEqual(gb[i - 1]);
    }
  });

  test('a videó max-hossz minden tieren 600 mp (globális plafon)', () => {
    for (const t of TIER_ORDER) {
      expect(ENTITLEMENTS[t].maxVideoSec).toBe(600);
    }
  });

  test('resolver: entitlementsFor ismeretlen tierre → free', () => {
    expect(entitlementsFor('nope' as Tier)).toEqual(ENTITLEMENTS.free);
    expect(entitlementsFor('business')).toBe(ENTITLEMENTS.business);
  });

  test('can(): boolean-gate helyesen', () => {
    expect(can('pro', 'aiCloud')).toBe(true);
    expect(can('free', 'aiCloud')).toBe(false);
    expect(can('free', 'watermark')).toBe(true);
    expect(can('business', 'rbac')).toBe(true);
  });

  describe('routing-magok (Free = eszközön, felhő = Amatőr+)', () => {
    test('shouldWatermark: CSAK a free-n', () => {
      expect(shouldWatermark('free')).toBe(true);
      for (const t of ['basic', 'pro', 'ultra', 'business'] as Tier[]) {
        expect(shouldWatermark(t)).toBe(false);
      }
    });
    test('canCloudRender: free NEM, Amatőr+ IGEN', () => {
      expect(canCloudRender('free')).toBe(false);
      for (const t of ['basic', 'pro', 'ultra', 'business'] as Tier[]) {
        expect(canCloudRender(t)).toBe(true);
      }
    });
    test('canCloudStore: free NEM (eszköz-tár), Amatőr+ IGEN', () => {
      expect(canCloudStore('free')).toBe(false);
      for (const t of ['basic', 'pro', 'ultra', 'business'] as Tier[]) {
        expect(canCloudStore(t)).toBe(true);
      }
    });
  });
});
