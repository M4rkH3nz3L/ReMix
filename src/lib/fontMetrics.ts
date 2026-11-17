/**
 * 📏 A fontok természetes sormagassága (em-ben): a `hhea` ascender − descender a unitsPerEm-re
 * osztva (a lineGap-et iOS itt nem számolja: Poppins-szal mérve) — ennyi az iOS-szöveg sora, ha nincs megadott sorköz. A vászon ebből számolja,
 * mennyivel tolja le a szöveget, ha a sorköz ennél szorosabb (iOS a sor tetejéhez igazít, a CSS középre).
 * Expo-mentes, önmagában tesztelhető; a beépített táblát a `fontMetrics.test.ts` a TTF-ekhez zárolja.
 */

/** az ismeretlen (még nem regisztrált) font természetes sormagassága */
export const DEFAULT_NATURAL_LEADING = 1.2;

/** az „Alap” betű (Inter, a hiányzó család is) természetes sormagassága — a TTF-hez zárolva */
export const DEFAULT_FONT_NATURAL_LEADING = 1.21;

/** a beépített fontok (`src/constants/fonts.ts`, `server/fonts.js`) természetes sormagassága */
export const BUILTIN_NATURAL_LEADING: Readonly<Record<string, number>> = {
  Anton: 1.505,
  ArchivoBlack: 1.088,
  BebasNeue: 1.2,
  Bungee: 1.32,
  Lobster: 1.25,
  Oswald: 1.482,
  Pacifico: 1.756,
  PermanentMarker: 1.427,
  Poppins: 1.4,
  Righteous: 1.242,
};

/** TTF/OTF bájtokból a természetes sormagasság (em), `null`, ha a fájl nem olvasható */
export function naturalLeadingFromFont(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = v.getUint16(4);
  let head = -1;
  let hhea = -1;
  for (let i = 0; i < tables; i++) {
    const o = 12 + i * 16;
    if (o + 16 > bytes.length) return null;
    const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    if (tag === 'head') head = v.getUint32(o + 8);
    if (tag === 'hhea') hhea = v.getUint32(o + 8);
  }
  if (head < 0 || hhea < 0 || head + 20 > bytes.length || hhea + 10 > bytes.length) return null;
  const upm = v.getUint16(head + 18);
  if (!upm) return null;
  const ascender = v.getInt16(hhea + 4);
  const descender = v.getInt16(hhea + 6);
  const n = (ascender - descender) / upm;
  return n > 0.5 && n < 4 ? Math.round(n * 1000) / 1000 : null;
}

const custom = new Map<string, number>();

/** egy betöltött saját font természetes sormagassága (a projekt fontjainak betöltésekor) */
export function registerFontLeading(family: string, leading: number | null): void {
  if (leading) custom.set(family, leading);
}

/** a család természetes sormagassága (em) */
export function naturalLeading(family: string | undefined): number {
  if (!family || family === 'Inter') return DEFAULT_FONT_NATURAL_LEADING;
  return custom.get(family) ?? BUILTIN_NATURAL_LEADING[family] ?? DEFAULT_NATURAL_LEADING;
}

/**
 * Mennyivel tolja le az iOS-szöveget a vászon (em-ben), hogy a sor ott álljon, ahol a CSS-ben:
 * a természetesnél szorosabb sorban iOS a sor tetejéhez igazít, a CSS a sor közepére.
 */
export function tightLeadingShift(family: string | undefined, lineHeight: number): number {
  return Math.max(0, naturalLeading(family) - lineHeight) / 2;
}
