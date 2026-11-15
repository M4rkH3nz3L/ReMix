import type { ProjectFont } from '@/types/project';

/**
 * 🔤 A projekt saját betűtípusai (IMAGE-PROD S10 · PRO-DESIGN DS2) — pure mag.
 *
 * Egy importált TTF/OTF a projekt mappájába kerül, és a projekt `fonts` listájában él. A szöveg-réteg
 * a `family` kulccsal hivatkozik rá — ugyanez a név az app font-betöltőjében (expo-font) és a
 * render `@font-face`-ében, így a vászon, a telefonos és a szerveres kész kép ugyanazt a betűt adja.
 * A `family` egyedi (`u_` előtag + a fájl nevéből + rövid tartalom-kulcs), nem ütközik a beépítettekkel.
 */

/** egy fájlnév → felületi név (kiterjesztés és elválasztók nélkül) */
export function fontDisplayName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base.slice(0, 40) || 'Font';
}

/** a betöltő- és render-kulcs: csak betű/szám/aláhúzás, a tartalom-kulcs dönti el az egyediséget */
export function fontFamilyKey(fileName: string, contentKey: string): string {
  const slug = fontDisplayName(fileName)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .slice(0, 24);
  return `u_${slug || 'font'}_${contentKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}`;
}

/** TTF / OTF fejléc (az első 4 bájt) — a szerver ugyanígy ellenőrzi */
export function isFontHeader(bytes: ArrayLike<number>): boolean {
  if (bytes.length < 4) return false;
  const [a, b, c, d] = [bytes[0], bytes[1], bytes[2], bytes[3]];
  const tag = String.fromCharCode(a, b, c, d);
  return (a === 0 && b === 1 && c === 0 && d === 0) || tag === 'OTTO' || tag === 'true';
}

/** új font a listához (azonos `family` nem duplázódik; a név szerint rendezve) */
export function withProjectFont(fonts: readonly ProjectFont[] | undefined, font: ProjectFont): ProjectFont[] {
  const rest = (fonts ?? []).filter((f) => f.family !== font.family);
  return [...rest, font].sort((a, b) => a.name.localeCompare(b.name));
}

/** a lista a `family` nélkül */
export function withoutProjectFont(fonts: readonly ProjectFont[] | undefined, family: string): ProjectFont[] {
  return (fonts ?? []).filter((f) => f.family !== family);
}

/** a projekt saját fontja-e ez a család */
export function projectFontOf(fonts: readonly ProjectFont[] | undefined, family: string | undefined): ProjectFont | null {
  if (!family) return null;
  return (fonts ?? []).find((f) => f.family === family) ?? null;
}
