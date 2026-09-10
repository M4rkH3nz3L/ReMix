/**
 * Betűtípus-készlet (WYSIWYG): a `family` név AZONOS az appban (expo-font
 * useFonts kulcs) és a renderben (worker @font-face `font-family`), így az
 * előnézet és a beégetett videó ugyanazt a fontot mutatja. A TTF-ek az
 * `assets/fonts/` (app) és `server/assets/fonts/` (worker) mappákban élnek.
 */

export interface FontOption {
  id: string;
  label: string;
  /** RN/CSS font-family; hiányzó = rendszer-alap */
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
