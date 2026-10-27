/**
 * 🌐 A böngészős változat FELÜLETE — pure mag (nincs expo/RN import).
 *
 * A web nézegető-felület: SEO/AEO + tartalom-böngészés + Live-nézés. A STÚDIÓK
 * (minden szerkesztő-felület) weben NEM érhetők el — ezekre az útvonalakra egy-egy
 * `.web.tsx` csonk ül („Szerkesztés az appban"), így a natív szerkesztő-kód (Skia,
 * kamera, render) be sem kerül a webes bundle-be. A bejelentkezés weben is megvan;
 * kijelentkezve CSAK a publikus tartalom nézhető.
 */

/** A stúdió-útvonalak előtagjai — ezek weben a „Szerkesztés az appban" csonkra futnak.
 *  A `/storage` (Tárhelyem fájlkezelő) a stúdiók munkaterülete, ezért szintén csak appban. */
export const STUDIO_ROUTE_PREFIXES = ['/studio', '/editor', '/collab', '/live/studio', '/storage'] as const;

/** Stúdió-útvonal-e (pl. `/editor/p1`, `/studio`, `/studio/image/p1`, `/live/studio/p1`). */
export function isStudioRoute(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return STUDIO_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Weben KIJELENTKEZVE is nézhető képernyők (expo-router screen-nevek). Mind csak
 * publikus adatot olvas (az RLS anonim módban is ezt engedi); minden írás-akció
 * (lájk, komment, követés, vásárlás) bejelentkezést kér.
 */
export const PUBLIC_WEB_SCREENS = [
  'index',
  'player/[id]',
  'channel/[id]',
  'hashtag/[tag]',
  'search',
  'live',
  'live/[id]',
  'shop',
] as const;
