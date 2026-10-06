import {
  CAPABILITIES,
  capabilityAllowed,
  capabilityMinTier,
  capabilityRequiresPro,
  capabilityWhere,
  proCapabilities,
  type CapabilityId,
} from '@/lib/capabilities';
import { isPaidTier, tierMeetsMin } from '@/lib/tiers';

const ALL = Object.keys(CAPABILITIES) as CapabilityId[];

describe('capabilities — minTier-alapú kapuzás (audit §2.1)', () => {
  test('ÜZLETI INVARIÁNS: ami eszközön fut (local), az KÖTELEZŐEN free', () => {
    for (const cap of ALL) {
      if (capabilityWhere(cap) === 'local') {
        expect(capabilityMinTier(cap)).toBe('free');
      }
    }
  });

  test('minden capability-nek van érvényes minTier-je', () => {
    for (const cap of ALL) {
      expect(['free', 'basic', 'pro', 'ultra']).toContain(capabilityMinTier(cap));
    }
  });

  test('capabilityAllowed rangsor szerint: ultra mindent, free csak a free-t', () => {
    for (const cap of ALL) {
      // ultra user minden képességet megkap
      expect(capabilityAllowed(cap, 'ultra')).toBe(true);
      // free user csak a free-minTier képességeket
      expect(capabilityAllowed(cap, 'free')).toBe(capabilityMinTier(cap) === 'free');
      // a tier-gate konzisztens a tierMeetsMin-nel
      expect(capabilityAllowed(cap, 'pro')).toBe(tierMeetsMin('pro', capabilityMinTier(cap)));
    }
  });

  test('capabilityRequiresPro backward-compat: = fizetős (free fölötti) minTier', () => {
    for (const cap of ALL) {
      expect(capabilityRequiresPro(cap)).toBe(isPaidTier(capabilityMinTier(cap)));
    }
  });

  test('a mai viselkedés változatlan: ismert local-ingyenes és cloud-Pro példák', () => {
    // on-device, ingyenes
    expect(capabilityMinTier('localRender')).toBe('free');
    expect(capabilityRequiresPro('localRender')).toBe(false);
    expect(capabilityAllowed('localRender', 'free')).toBe(true);
    // szándékosan ingyenes felhő-funkciók (adat-biztonság / mindenkinek jár)
    expect(capabilityMinTier('cloudSync')).toBe('free');
    expect(capabilityMinTier('collab')).toBe('free');
    expect(capabilityMinTier('soundLibrary')).toBe('free');
    // fizetős felhő-AI
    expect(capabilityMinTier('autoEdit')).toBe('pro');
    expect(capabilityRequiresPro('autoEdit')).toBe(true);
    expect(capabilityAllowed('autoEdit', 'free')).toBe(false);
    expect(capabilityAllowed('autoEdit', 'pro')).toBe(true);
  });

  test('backend-gate EKVIVALENCIA: capabilityAllowed(cap, tier) = a régi (!requiresPro || isPro)', () => {
    // a migráció (ensureCloud/canUseCloud → allowsNow) zéró-regressziós bizonyítéka:
    for (const cap of ALL) {
      // free user (isPro=false): régi "allowed" = !requiresPro
      expect(capabilityAllowed(cap, 'free')).toBe(!capabilityRequiresPro(cap));
      // pro user (isPro=true): régi "allowed" = true (minden)
      expect(capabilityAllowed(cap, 'pro')).toBe(true);
    }
  });

  test('proCapabilities a fizetős képességeket adja (nem üres)', () => {
    const list = proCapabilities();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    // pontosan annyi, ahány fizetős capability
    const paidCount = ALL.filter((c) => isPaidTier(capabilityMinTier(c))).length;
    expect(list.length).toBe(paidCount);
  });
});
