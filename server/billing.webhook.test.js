/**
 * RevenueCat webhook idempotencia (devs/tasks/remix/11). A dedup-helpereket
 * INJEKTÁLT fake Supabase-klienssel teszteljük (hálózat nélkül): a döntés és a
 * best-effort hibatűrés a lényeg — a dedup SOHA nem blokkolhatja a legitim eseményt.
 */
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'teszt-service-role';

jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

const { webhookEventSeen, recordWebhookEvent } = require('./billing');

/** fake supabase-kliens a billing_webhook_events táblához */
function fakeSb({ row = null, selectThrows = false, insertThrows = false, onInsert } = {}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (selectThrows) throw new Error('db hiba');
            return { data: row, error: null };
          },
        }),
      }),
      insert: async (vals) => {
        if (insertThrows) throw new Error('db hiba');
        if (onInsert) onInsert(vals);
        return { data: vals, error: null };
      },
    }),
  };
}

describe('webhookEventSeen — idempotencia-ellenőrzés', () => {
  it('létező esemény-sor → true (duplikátum)', async () => {
    expect(await webhookEventSeen(fakeSb({ row: { id: 'e1' } }), 'e1')).toBe(true);
  });
  it('nincs sor → false (új esemény)', async () => {
    expect(await webhookEventSeen(fakeSb({ row: null }), 'e1')).toBe(false);
  });
  it('⚠️ DB-hiba → false (best-effort; a legitim eseményt NEM blokkolja)', async () => {
    expect(await webhookEventSeen(fakeSb({ selectThrows: true }), 'e1')).toBe(false);
  });
  it('hiányzó sb / id → false', async () => {
    expect(await webhookEventSeen(null, 'e1')).toBe(false);
    expect(await webhookEventSeen(fakeSb({}), '')).toBe(false);
  });
});

describe('recordWebhookEvent — rögzítés (best-effort)', () => {
  it('beszúrja az id-t és a type-ot', async () => {
    let got = null;
    await recordWebhookEvent(fakeSb({ onInsert: (v) => (got = v) }), 'e1', 'RENEWAL');
    expect(got).toEqual({ id: 'e1', type: 'RENEWAL' });
  });
  it('type nélkül → null type', async () => {
    let got = null;
    await recordWebhookEvent(fakeSb({ onInsert: (v) => (got = v) }), 'e2');
    expect(got).toEqual({ id: 'e2', type: null });
  });
  it('⚠️ DB-hiba / ütközés SEM dob (a feldolgozás már megtörtént)', async () => {
    await expect(recordWebhookEvent(fakeSb({ insertThrows: true }), 'e1', 'X')).resolves.toBeUndefined();
  });
  it('hiányzó sb / id → no-op', async () => {
    await expect(recordWebhookEvent(null, 'e1')).resolves.toBeUndefined();
    await expect(recordWebhookEvent(fakeSb({}), '')).resolves.toBeUndefined();
  });
});
