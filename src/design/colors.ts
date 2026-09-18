/**
 * 🎨 Szín-tokenek. A `palette` továbbra is az `@/constants/editor`-ban él (77+
 * fájl importálja) — itt csak RE-EXPORTÁLJUK, hogy a `@/design` egy belépőpont
 * legyen, és kiegészítjük **funkcionális** (jelentés-alapú) színekkel.
 *
 * FUNKCIONÁLIS SZÍNRENDSZER (a UI-terv szerint): a szín JELENTÉST hordoz, nem
 * dekoráció — a felhasználó a színből tudja, mivel van dolga.
 */
import { palette, accentGradient, trackColors } from '@/constants/editor';

export { palette, accentGradient, trackColors };

/** Jelentés-alapú színek — mindig ezeken keresztül hivatkozz szerepre. */
export const functional = {
  /** kijelölés / fókusz (cyan) */
  selection: '#5ac8ff',
  /** AI és remix (magenta) */
  ai: palette.accent2,
  /** effekt / kreatív művelet (lila) */
  effect: palette.accent,
  /** figyelmeztetés (sárga) */
  warning: '#f5a623',
  /** siker (zöld) */
  success: palette.ok,
  /** hiba / destruktív (piros) */
  danger: palette.danger,
} as const;

export type FunctionalColor = keyof typeof functional;

export const colors = { palette, functional, accentGradient, trackColors } as const;
