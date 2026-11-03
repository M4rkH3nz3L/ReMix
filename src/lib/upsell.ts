import type { Tier } from '@/lib/tiers';

/**
 * 💡 Tisztességes ösztönzés — szabálymotor (PRO-CASH 4.4, C2.3). Tiszta, expo-mentes.
 *
 * A Free felhasználó akkor lássa a fizetős csomag értékét, amikor épp szüksége volna rá,
 * és ne zaklassuk, amikor nincs:
 *   • munkamenetenként legfeljebb 1 teljes képernyős ajánlat;
 *   • a „Most nem” után 72 óra csend (minden triggerre);
 *   • szerkesztés, vászon és render közben SOHA (UX-, márka- és áruházi szabály);
 *   • fizetős szinten nincs ajánlat (a magasabb szintre terelés az add-on javaslatban él).
 * A triggerenkénti megjelenés / koppintás mérése a hívó dolga (analytics).
 */

export type UpsellTrigger =
  | 'export_watermark'
  | 'device_storage_80'
  | 'long_export'
  | 'ai_without_key'
  | 'live_gift_received'
  | 'shop_sale'
  | 'active_day_milestone'
  | 'winback';

/** Hol jár épp a user — szerkesztő-felületen ajánlat nem jelenhet meg. */
export type UpsellSurface = 'editor' | 'canvas' | 'render' | 'export_done' | 'feed' | 'profile' | 'live' | 'shop' | 'home';

export const NO_UPSELL_SURFACES: readonly UpsellSurface[] = ['editor', 'canvas', 'render'];

export const SNOOZE_MS = 72 * 60 * 60 * 1000;
export const MAX_FULLSCREEN_PER_SESSION = 1;

export interface UpsellState {
  sessionId: string;
  /** a jelen munkamenetben megjelent teljes képernyős ajánlatok száma */
  sessionShown: number;
  /** a legutóbbi „Most nem” ideje (ms) */
  dismissedAt: number | null;
}

export interface UpsellOffer {
  trigger: UpsellTrigger;
  /** melyik szintet ajánljuk (PRO-CASH 4.4 táblázat) */
  tier: Exclude<Tier, 'free' | 'business'>;
  /** i18n-kulcs az üzenethez (upsell.msg.*) */
  messageKey: string;
}

const OFFERS: Record<UpsellTrigger, UpsellOffer> = {
  export_watermark: { trigger: 'export_watermark', tier: 'basic', messageKey: 'upsell.msg.exportWatermark' },
  device_storage_80: { trigger: 'device_storage_80', tier: 'basic', messageKey: 'upsell.msg.deviceStorage' },
  long_export: { trigger: 'long_export', tier: 'pro', messageKey: 'upsell.msg.longExport' },
  ai_without_key: { trigger: 'ai_without_key', tier: 'basic', messageKey: 'upsell.msg.aiWithoutKey' },
  live_gift_received: { trigger: 'live_gift_received', tier: 'pro', messageKey: 'upsell.msg.liveGift' },
  shop_sale: { trigger: 'shop_sale', tier: 'ultra', messageKey: 'upsell.msg.shopSale' },
  active_day_milestone: { trigger: 'active_day_milestone', tier: 'basic', messageKey: 'upsell.msg.milestone' },
  winback: { trigger: 'winback', tier: 'basic', messageKey: 'upsell.msg.winback' },
};

export type UpsellDecision = { show: true; offer: UpsellOffer } | { show: false; reason: 'paid' | 'surface' | 'session_cap' | 'snoozed' };

/** Megjelenhet-e most az ajánlat. */
export function decideUpsell(
  trigger: UpsellTrigger,
  ctx: { tier: Tier; surface: UpsellSurface; nowMs: number },
  state: UpsellState
): UpsellDecision {
  if (ctx.tier !== 'free') {
    return { show: false, reason: 'paid' };
  }
  if (NO_UPSELL_SURFACES.includes(ctx.surface)) {
    return { show: false, reason: 'surface' };
  }
  if (state.sessionShown >= MAX_FULLSCREEN_PER_SESSION) {
    return { show: false, reason: 'session_cap' };
  }
  if (state.dismissedAt != null && ctx.nowMs - state.dismissedAt < SNOOZE_MS) {
    return { show: false, reason: 'snoozed' };
  }
  return { show: true, offer: OFFERS[trigger] };
}

/** Megjelent egy ajánlat ebben a munkamenetben. */
export function markShown(state: UpsellState): UpsellState {
  return { ...state, sessionShown: state.sessionShown + 1 };
}

/** „Most nem”: 72 óra csend. */
export function markDismissed(state: UpsellState, nowMs: number): UpsellState {
  return { ...state, dismissedAt: nowMs };
}

/** Új munkamenet: a munkamenet-számláló nullázódik, a csend (dismissedAt) megmarad. */
export function newSession(state: UpsellState, sessionId: string): UpsellState {
  return state.sessionId === sessionId ? state : { ...state, sessionId, sessionShown: 0 };
}

/** Aktív-nap mérföldkő (7., 30., 90. nap) — a próba-ajánlat ideje. */
export function isActiveDayMilestone(activeDays: number): boolean {
  return activeDays === 7 || activeDays === 30 || activeDays === 90;
}
