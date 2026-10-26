/**
 * 🏷️ Média-fájl emberi megjelenítési neve.
 *
 * MIÉRT: a galériából érkező klip URI-ja gép-generált fájlnév (pl.
 * `mvptb3mn_8D46C0B4-C735-48….mov`) — ezt a kijelölés-sávban mutatni zaj és
 * nem professzionális (élő iPhone-teszt, V1). Ilyenkor nincs név (a sáv a klip
 * fajtáját és hosszát úgyis mutatja); a valódi fájlnév kiterjesztés nélkül jelenik meg.
 */

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
const LONG_HEX = /[0-9a-f]{16,}/i;
/** belső tároló-előtag: `abc123de_…` (rövid, kisbetű+szám azonosító + aláhúzás) */
const STORE_PREFIX = /^[a-z0-9]{6,10}_/;

/** Gép-generált (nem emberi) fájlnév-e. */
export function isMachineFileName(fileName: string): boolean {
  return UUID_LIKE.test(fileName) || LONG_HEX.test(fileName) || STORE_PREFIX.test(fileName);
}

/** Az URI utolsó elemének emberi alakja, vagy null, ha gép-generált / üres. */
export function mediaDisplayName(uri: string): string | null {
  let last = uri.split('?')[0].split('/').pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // hibás %-kódolás → nyersen
  }
  if (!last || isMachineFileName(last)) {
    return null;
  }
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}
