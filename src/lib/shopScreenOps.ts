/**
 * 🛍️ A bolt-képernyő (src/app/shop.tsx) tiszta, expo-mentes magja: a tétel-fajták
 * emojijai és a publikálási minimum-ár ellenőrzése. A képernyőből kiemelve (REFACTOR) —
 * a viselkedés változatlan.
 */
import { MIN_SHOP_PRICE_CENTS } from '@/lib/coins';
import type { ShopKind } from '@/lib/shop';

export const KIND_EMOJI: Record<ShopKind, string> = {
  template: '🎬',
  overlay: '🖼️',
  lut: '🎨',
  sfx: '🔊',
  sticker: '✨',
  font: '🔤',
  preset: '🎛️',
  soundpack: '🥁',
};

/** a kártyák emojija: ismeretlen fajtára a sablon-emoji */
export function kindEmoji(kind: ShopKind): string {
  return KIND_EMOJI[kind] ?? '🎬';
}

/** fizetős, de a bolti minimum alatti ár (0 = ingyenes, az engedett) */
export function isBelowShopMinimum(priceCents: number): boolean {
  return priceCents > 0 && priceCents < MIN_SHOP_PRICE_CENTS;
}
