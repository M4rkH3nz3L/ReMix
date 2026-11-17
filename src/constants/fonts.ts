/**
 * Betűtípus-készlet (WYSIWYG): a `family` név AZONOS az appban (expo-font
 * useFonts kulcs) és a renderben (worker @font-face `font-family`), így az
 * előnézet és a beégetett videó ugyanazt a fontot mutatja. A TTF-ek az
 * `assets/fonts/` (app) és `server/assets/fonts/` (worker) mappákban élnek.
 */

export interface FontOption {
  id: string;
  label: string;
  /** RN/CSS font-family; hiányzó = az „Alap” betű (beágyazott Inter, lásd `DEFAULT_FONT`) */
  family?: string;
}

export const fontOptions: FontOption[] = [
  { id: 'system', label: 'Alap' },
  { id: 'anton', label: 'Anton', family: 'Anton' },
  { id: 'bebas', label: 'Bebas', family: 'BebasNeue' },
  { id: 'poppins', label: 'Poppins', family: 'Poppins' },
  { id: 'pacifico', label: 'Pacifico', family: 'Pacifico' },
  { id: 'bungee', label: 'Bungee', family: 'Bungee' },
  { id: 'oswald', label: 'Oswald', family: 'Oswald' },
  { id: 'archivo', label: 'Archivo', family: 'ArchivoBlack' },
  { id: 'righteous', label: 'Righteous', family: 'Righteous' },
  { id: 'lobster', label: 'Lobster', family: 'Lobster' },
  { id: 'marker', label: 'Marker', family: 'PermanentMarker' },
];

/** family név → TTF-fájlnév (a worker @font-face-hez / az app require-jéhez). */
export const fontFiles: Record<string, string> = {
  Anton: 'Anton-Regular.ttf',
  BebasNeue: 'BebasNeue-Regular.ttf',
  Poppins: 'Poppins-Bold.ttf',
  Pacifico: 'Pacifico-Regular.ttf',
  Bungee: 'Bungee-Regular.ttf',
  Oswald: 'Oswald-Regular.ttf',
  ArchivoBlack: 'ArchivoBlack-Regular.ttf',
  Righteous: 'Righteous-Regular.ttf',
  Lobster: 'Lobster-Regular.ttf',
  PermanentMarker: 'PermanentMarker-Regular.ttf',
};

/**
 * 🔤 Az „Alap” betű (és a hiányzó család): beágyazott Inter, két vastagsággal — a rendszerfont (SF) a
 * szerveren nincs meg, ott Arial-ra esne, és a kész kép mást mutatna, mint a vászon. A worker tükre:
 * `server/fonts.js` `DEFAULT_FONT` (contract-teszt).
 */
export const DEFAULT_FONT = { family: 'Inter', regular: 'Inter-Regular.ttf', bold: 'Inter-Bold.ttf' } as const;

/** az app a félkövér Intert külön néven tölti be (beágyazott fontnál az iOS nem vastagít) */
export const DEFAULT_FONT_BOLD_FAMILY = 'Inter-Bold';

/** félkövér-e a vastagság (a CSS-ben a 600 fölötti a 700-as fájlt kapja) */
export function isBoldWeight(weight: string | number | null | undefined): boolean {
  return weight === 'bold' || Number(weight) >= 600;
}

/** a rajzoláshoz használt családnév: a hiányzó család (és az „Inter”) a vastagság szerinti Inter-fájl */
export function renderFontFamily(family: string | null | undefined, weight?: string | number | null): string {
  if (family && family !== DEFAULT_FONT.family) {
    return family;
  }
  return isBoldWeight(weight) ? DEFAULT_FONT_BOLD_FAMILY : DEFAULT_FONT.family;
}
