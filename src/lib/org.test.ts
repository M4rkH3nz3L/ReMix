import { parseOrg } from '@/lib/org';

jest.mock('@/lib/supabase', () => ({ supabase: null, requireSupabase: () => { throw new Error('nincs'); } }));
jest.mock('@/lib/billing', () => ({ refreshEntitlement: async () => undefined }));
jest.mock('@/lib/workerAuth', () => ({ workerJsonHeaders: async () => ({}) }));

describe('parseOrg (C4.5)', () => {
  it('a my_org() válaszát a konzol modelljére fordítja', () => {
    const o = parseOrg({
      id: 'o1', name: 'Teszt Kft.', country: 'HU', vat_id: 'HU1', status: 'verified', my_role: 'admin', seats: 5, pending_seats: 4,
      seat_price_cents: 1000, active: true, until: '2026-12-04', verification: { vies: { valid: true }, domain: { ok: true } },
      members: [{ user_id: 'u1', username: 'a', role: 'owner', storage_limit_gb: null, ai_tokens_limit: 500000, render_minutes_limit: null }],
      storage: { used_bytes: 10, quota_bytes: 100 },
    });
    expect(o).toMatchObject({ status: 'verified', vies: true, domainOk: true, myRole: 'admin', seats: 5, pendingSeats: 4, storageQuotaBytes: 100 });
    expect(o?.members[0]).toEqual({ userId: 'u1', username: 'a', role: 'owner', storageLimitGb: null, aiTokensLimit: 500000, renderMinutesLimit: null });
  });
  it('nincs szervezet → null', () => {
    expect(parseOrg(null)).toBeNull();
  });
});
