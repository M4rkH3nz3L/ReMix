/**
 * 🎬 Motion-tokenek — az app MOZGÁSÁNAK egyetlen forrása.
 *
 * MIÉRT: eddig minden animáció ad-hoc `withTiming`/`withSpring` hívás volt,
 * szétszórt, egyedi számokkal — így az app „érzése" komponensenként eltért.
 * Itt EGY hely szabja meg a ritmust, hogy az egész felület egységesen és
 * „iOS-native" tempóban mozogjon.
 *
 * ALAPELV: **fast-in, soft-out** — a mozgás gyorsan indul és puhán áll meg,
 * sosem túl bounce-os (a szerkesztő komoly eszköz, nem játék). A spring-ek
 * kritikus csillapítás közelében járnak (dampingRatio ≈ 0.9–1.0).
 *
 * Használat (worklet-barát):
 *   withTiming(v, motion.timing.base)
 *   withSpring(open ? 1 : 0, motion.spring.smooth)
 */
import { Easing } from 'react-native-reanimated';

/** Időtartamok (ms). A gomb gyors, a nagy átmenet ráérős — de sosem lomha. */
export const duration = {
  /** azonnali visszajelzés (gomb-press, ikon-swap) */
  instant: 90,
  /** apró kontroll (toggle, chip, trim-handle) */
  fast: 140,
  /** panel/tab megjelenés — az alapértelmezett */
  base: 220,
  /** bottom sheet / nagyobb felület */
  slow: 320,
  /** teljes képernyős / kiemelt átmenet */
  slower: 440,
} as const;

/**
 * Easing-görbék. A `standard` a fast-in/soft-out alap — a legtöbb átmenet ezt
 * használja. A bezier-eket modul-szinten tartjuk (a Reanimated worklet-en át
 * elérhető), hogy ne kelljen minden hívásnál újra létrehozni őket.
 */
export const easing = {
  /** fast-in, soft-out — az alapértelmezett átmenet */
  standard: Easing.bezier(0.2, 0, 0, 1),
  /** belépő elem (semmiből → helyre): lassan áll meg */
  decelerate: Easing.out(Easing.cubic),
  /** kilépő elem (helyről → el): gyorsulva tűnik */
  accelerate: Easing.in(Easing.cubic),
  /** kiemelt, „hangsúlyos" mozgás (nagy felület) */
  emphasized: Easing.bezier(0.3, 0, 0, 1),
  /** lineáris — csak folyamatos, nem-térbeli visszajelzéshez (pl. progress) */
  linear: Easing.linear,
} as const;

/**
 * Kész `withTiming` konfigurációk — a leggyakoribb esetek névvel.
 * `withTiming(value, motion.timing.base)`
 */
export const timing = {
  instant: { duration: duration.instant, easing: easing.standard },
  fast: { duration: duration.fast, easing: easing.standard },
  base: { duration: duration.base, easing: easing.standard },
  slow: { duration: duration.slow, easing: easing.standard },
  slower: { duration: duration.slower, easing: easing.standard },
  /** belépéshez (decelerate) */
  enter: { duration: duration.base, easing: easing.decelerate },
  /** kilépéshez (accelerate) */
  exit: { duration: duration.fast, easing: easing.accelerate },
} as const;

/**
 * Spring-presetek — fizikai formában (damping/stiffness/mass), mind közel a
 * kritikus csillapításhoz, hogy határozottak legyenek, ne rugózzanak túl.
 * `withSpring(value, motion.spring.smooth)`
 */
export const spring = {
  /** UI-kontrollok, apró snap (chip, toggle, ikon) — fürge, kevés túllövés */
  snappy: { damping: 22, stiffness: 260, mass: 0.9 },
  /** panelek / bottom sheet — sima, kényelmes */
  smooth: { damping: 26, stiffness: 190, mass: 1 },
  /** nagy felület / képernyő-átmenet — nyugodt */
  gentle: { damping: 30, stiffness: 130, mass: 1 },
  /** mágneses illesztés (snap-to-grid, playhead) — feszes, gyors megállás */
  stiff: { damping: 24, stiffness: 340, mass: 0.7 },
} as const;

/** Az összes motion-token egy csomagban (`import { motion } from '@/design'`). */
export const motion = { duration, easing, timing, spring } as const;
