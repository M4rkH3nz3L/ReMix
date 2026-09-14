/**
 * 🛡️ Safe-zone számítás + validáció a feliratokhoz. A `SafeZoneOverlay` VIZUÁLIS
 * iránymutatást ad; ez a pure réteg ELLENŐRZI, hogy egy felirat a biztonságos
 * sávon belül van-e (a platform-UI nem takarja), és ad egy javított y-t.
 *
 * A sáv-arányok a SafeZoneOverlay-jel egyeznek (0–1 normalizált vászon):
 *  - függőleges (9:16): felső 6% (státusz), alsó 20% (név/felirat/zene),
 *    jobb 14% (akció-gombok); minden arányra 5% általános inset.
 */

import type { AspectRatio } from '@/types/project';

export interface SafeZone {
  top: number;
  bottom: number; // a biztonságos terület ALSÓ éle (0–1), nem a sáv vastagsága
  left: number;
  right: number; // a biztonságos terület JOBB éle (0–1)
}

/** a biztonságos téglalap élei (0–1) a képarány szerint */
export function safeZone(aspect: AspectRatio): SafeZone {
  const vertical = aspect === '9:16';
  const inset = 0.05;
  const topBand = vertical ? 0.06 : 0;
  const bottomBand = vertical ? 0.2 : 0;
  const rightBand = vertical ? 0.14 : 0;
  return {
    top: Math.max(topBand, inset),
    bottom: 1 - Math.max(bottomBand, inset),
    left: inset,
    right: 1 - Math.max(rightBand, inset),
  };
}

export interface CaptionRect {
  /** y-középpont (0–1) */
  y: number;
  /** x-középpont (0–1) */
  x: number;
  /** a felirat sávjának magassága (0–1) — lásd captionBand */
  band: number;
}

/**
 * Beleér-e a felirat a biztonságos sávba? A függőleges tengelyt nézzük szigorúan
 * (a felirat teteje/alja), az x-et pedig csak a jobb akció-gomb sávra (a szöveg
 * alapból középre igazított). `true` = biztonságos.
 */
export function captionInSafeZone(rect: CaptionRect, zone: SafeZone): boolean {
  const top = rect.y - rect.band / 2;
  const bottom = rect.y + rect.band / 2;
  return top >= zone.top - 1e-6 && bottom <= zone.bottom + 1e-6;
}

/**
 * A felirat y-középpontja a biztonságos sávba tolva (a sáv magasságát megtartva).
 * Ha nem fér el (a sáv magasabb, mint a biztonságos terület), a tetejéhez igazít.
 */
export function fitCaptionY(rect: CaptionRect, zone: SafeZone): number {
  const half = rect.band / 2;
  const lo = zone.top + half;
  const hi = zone.bottom - half;
  if (lo > hi) {
    return zone.top + half; // nem fér el → a tetejéhez
  }
  return Math.min(hi, Math.max(lo, rect.y));
}
