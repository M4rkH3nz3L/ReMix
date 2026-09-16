/**
 * A szerver-hiteles Pro-kapu magja. A Supabase-klienst mockoljuk, hogy a
 * DÖNTÉSI LOGIKA (tier / státusz / lejárat / hibakezelés) hálózat nélkül,
 * determinisztikusan tesztelhető legyen.
 */
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'teszt-service-role';

// a billing.js a notify.js-en át behúzza az expo-server-sdk-t (ESM) — a Pro-
// ellenőrzés tesztjéhez irreleváns, ezért kiváltjuk
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

// a `mock` előtag kell: a jest.mock factory csak így hivatkozhat külső változóra
const mockState = { row: null, shouldError: false };

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            mockState.shouldError
              ? { data: null, error: { message: 'DB hiba' } }
              : { data: mockState.row, error: null },
        }),
      }),
    }),
  }),
}));

const { isPro } = require('./billing');

const future = () => new Date(Date.now() + 30 * 864e5).toISOString();
const past = () => new Date(Date.now() - 864e5).toISOString();

beforeEach(() => {
  mockState.row = null;
  mockState.shouldError = false;
});

describe('billing.isPro — szerver-hiteles előfizetés-ellenőrzés', () => {
  it('érvényes, aktív Pro → true', async () => {
    mockState.row = { tier: 'pro', status: 'active', current_period_end: future() };
    await expect(isPro('u1')).resolves.toBe(true);
  });

  it.each([
    ['trialing', 'próbaidő'],
    ['in_grace_period', 'fizetési türelmi idő'],
  ])('a(z) "%s" státusz is Pro (%s)', async (status) => {
    mockState.row = { tier: 'pro', status, current_period_end: future() };
    await expect(isPro('u1')).resolves.toBe(true);
  });

  it('LEJÁRT periódus → false', async () => {
    mockState.row = { tier: 'pro', status: 'active', current_period_end: past() };
    await expect(isPro('u1')).resolves.toBe(false);
  });

  it.each([['canceled'], ['expired'], ['paused']])(
    'a(z) "%s" státusz NEM Pro',
    async (status) => {
      mockState.row = { tier: 'pro', status, current_period_end: future() };
      await expect(isPro('u1')).resolves.toBe(false);
    }
  );

  it('free tier → false', async () => {
    mockState.row = { tier: 'free', status: 'active', current_period_end: future() };
    await expect(isPro('u1')).resolves.toBe(false);
  });

  it('nincs előfizetés-sor → false', async () => {
    mockState.row = null;
    await expect(isPro('u1')).resolves.toBe(false);
  });

  it('hiányzó lejárat → false', async () => {
    mockState.row = { tier: 'pro', status: 'active', current_period_end: null };
    await expect(isPro('u1')).resolves.toBe(false);
  });

  it('üres userId → false', async () => {
    mockState.row = { tier: 'pro', status: 'active', current_period_end: future() };
    await expect(isPro('')).resolves.toBe(false);
  });

  it('⚠️ DB-hiba → FAIL-CLOSED (false, nem adjuk ingyen)', async () => {
    mockState.shouldError = true;
    await expect(isPro('u1')).resolves.toBe(false);
  });
});
