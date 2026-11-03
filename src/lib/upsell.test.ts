import { SNOOZE_MS, decideUpsell, isActiveDayMilestone, markDismissed, markShown, newSession, type UpsellState } from '@/lib/upsell';

const s0: UpsellState = { sessionId: 's1', sessionShown: 0, dismissedAt: null };
const now = 1_800_000_000_000;
const free = (surface: Parameters<typeof decideUpsell>[1]['surface'] = 'export_done') => ({ tier: 'free' as const, surface, nowMs: now });

describe('upsell — szabálymotor (C2.3)', () => {
  it('Free + export vízjellel → Amatőr-ajánlat', () => {
    expect(decideUpsell('export_watermark', free(), s0)).toEqual({
      show: true,
      offer: { trigger: 'export_watermark', tier: 'basic', messageKey: 'upsell.msg.exportWatermark' },
    });
  });

  it('fizetősnek nincs ajánlat', () => {
    expect(decideUpsell('export_watermark', { ...free(), tier: 'basic' }, s0)).toEqual({ show: false, reason: 'paid' });
  });

  it.each(['editor', 'canvas', 'render'] as const)('szerkesztő-felületen (%s) soha', (surface) => {
    expect(decideUpsell('long_export', free(surface), s0)).toEqual({ show: false, reason: 'surface' });
  });

  it('munkamenetenként legfeljebb 1 teljes képernyős', () => {
    const s1 = markShown(s0);
    expect(decideUpsell('shop_sale', free('shop'), s1)).toEqual({ show: false, reason: 'session_cap' });
    expect(decideUpsell('shop_sale', free('shop'), newSession(s1, 's2')).show).toBe(true);
  });

  it('„Most nem” után 72 óra csend — új munkamenetben is', () => {
    const d = newSession(markDismissed(s0, now), 's2');
    expect(decideUpsell('winback', { ...free('home'), nowMs: now + SNOOZE_MS - 1 }, d)).toEqual({ show: false, reason: 'snoozed' });
    expect(decideUpsell('winback', { ...free('home'), nowMs: now + SNOOZE_MS }, d).show).toBe(true);
  });

  it('aktív-nap mérföldkövek', () => {
    expect([1, 7, 8, 30, 90, 91].map(isActiveDayMilestone)).toEqual([false, true, false, true, true, false]);
  });
});
