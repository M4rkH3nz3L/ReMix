/**
 * 🔤 Tipográfia-tokenek. iOS-en a rendszer-font a **SF Pro** — nem adunk meg
 * `fontFamily`-t, a natív rendszer-fontot használjuk (dinamikus típus, optikai
 * finomságok). Itt csak a SÚLYOK és a MÉRET-skála egységesek.
 *
 * Megjegyzés: a reszponzív méret-szorzót (`font(base)`) a layout-tokenek adják
 * (`src/constants/layout.ts`) — ez a skála a bázisméreteket definiálja.
 */
import type { TextStyle } from 'react-native';

/** SF Pro súlyok (RN `fontWeight`). */
export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const satisfies Record<string, TextStyle['fontWeight']>;

/** Bázis-méretek (pt) az Apple HIG szövegstílusaihoz közelítve. */
export const size = {
  caption2: 11,
  caption: 12,
  footnote: 13,
  subhead: 15,
  body: 17,
  headline: 17,
  title3: 20,
  title2: 22,
  title1: 28,
} as const;

/** Kész szöveg-stílusok (méret + súly + sorköz) a leggyakoribb szerepekhez. */
export const text = {
  caption: { fontSize: size.caption, fontWeight: weight.medium, lineHeight: 16 },
  footnote: { fontSize: size.footnote, fontWeight: weight.regular, lineHeight: 18 },
  body: { fontSize: size.body, fontWeight: weight.regular, lineHeight: 22 },
  bodyStrong: { fontSize: size.body, fontWeight: weight.semibold, lineHeight: 22 },
  headline: { fontSize: size.headline, fontWeight: weight.semibold, lineHeight: 22 },
  title3: { fontSize: size.title3, fontWeight: weight.bold, lineHeight: 25 },
  title2: { fontSize: size.title2, fontWeight: weight.bold, lineHeight: 28 },
  title1: { fontSize: size.title1, fontWeight: weight.heavy, lineHeight: 34 },
} as const satisfies Record<string, TextStyle>;

export const typography = { weight, size, text } as const;
