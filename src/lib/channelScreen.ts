/**
 * 📺 A csatorna-képernyő (src/app/channel/[id].tsx) tiszta, expo-mentes magja: a számok
 * tömör alakja, a kiemelés (promóció) mezőinek értelmezése és a megjelenített név/handle.
 * A képernyőből kiemelve (REFACTOR) — a képletek szó szerint az eredetiek.
 */
import type { ChannelData } from '@/lib/feedCore/channel';

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** a kiemelés költségkerete a beírt szövegből (nem szám → 0) */
export function promoteBudget(budget: string): number {
  return parseInt(budget, 10) || 0;
}

/** a megtekintésenkénti ár a beírt szövegből (legalább 1) */
export function promoteCostPerView(cpv: string): number {
  return Math.max(1, parseInt(cpv, 10) || 1);
}

/** a keretből és az árból várható megtekintés-szám (lefelé kerekítve) */
export function promoteTargetViews(budget: string, cpv: string): number {
  const b = promoteBudget(budget);
  const c = promoteCostPerView(cpv);
  return Math.floor(b / c);
}

/** a fejléc handle-je és megjelenített neve (creator nélkül az azonosító eleje) */
export function channelNames(
  data: ChannelData | null,
  id: string | undefined,
): { username: string; displayName: string } {
  const username = data?.creator?.username ?? (id ?? '').slice(0, 8);
  // ⚠️ NE a „Csatorna" (nav-címke) legyen a név, ha nincs creator — inkább a handle
  const displayName = data?.creator?.displayName || username;
  return { username, displayName };
}
