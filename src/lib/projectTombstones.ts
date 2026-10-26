/**
 * 🪦 Projekt-sírkövek — a TÖRÖLT projektek azonosítói (pure mag).
 *
 * MIÉRT: a projektek automatikusan a felhőbe (cloud_projects) mentődnek, és a
 * Stúdió induláskor a „helyileg hiányzó" felhő-projekteket visszatölti
 * (újratelepítés/eszközváltás után). Ha a felhős törlés elbukik (offline,
 * lejárt munkamenet) VAGY egy még futó háttér-mentés a törlés UTÁN újra
 * feltölti a projektet, a visszatöltés a törölt projektet „hiányzónak" látja és
 * visszahozza — a felhasználó szemszögéből a törlés nem működik.
 *
 * A sírkő ezt zárja ki: a törölt id-t helyben megjegyezzük, és
 *   • a visszatöltés KIHAGYJA,
 *   • a háttér-mentés NEM tölti fel,
 *   • a még felhőben lévő sírköves projektet a szinkron ÚJRA törli (öngyógyulás).
 *
 * Expo-mentes → önmagában tesztelhető; a perzisztencia a `storage.ts`-ben.
 */

/** ennyi sírkövet tartunk meg (a legutóbbiakat) — korlátos tárhely */
export const MAX_TOMBSTONES = 1000;

/** A felhő-id-k közül melyeket kell visszatölteni (helyileg hiányzik ÉS nem törölt). */
export function restorableIds(
  cloudIds: readonly string[],
  localIds: ReadonlySet<string>,
  tombstones: ReadonlySet<string>
): string[] {
  return cloudIds.filter((id) => !localIds.has(id) && !tombstones.has(id));
}

/** A felhőben MÉG ott lévő, de helyben törölt projektek — ezeket újra törölni kell. */
export function pendingCloudDeletes(
  cloudIds: readonly string[],
  tombstones: ReadonlySet<string>
): string[] {
  return cloudIds.filter((id) => tombstones.has(id));
}

/** Sírkövek hozzáadása (a legújabbak a lista végén; duplikáció nélkül, korlátosan). */
export function addTombstones(list: readonly string[], ids: readonly string[]): string[] {
  const added = new Set(ids);
  const next = [...list.filter((id) => !added.has(id)), ...added];
  return next.slice(Math.max(0, next.length - MAX_TOMBSTONES));
}

/** Sírkövek eltávolítása (pl. ugyanazzal az id-vel újra, KIFEJEZETTEN elmentett projekt). */
export function removeTombstones(list: readonly string[], ids: readonly string[]): string[] {
  const removed = new Set(ids);
  return list.filter((id) => !removed.has(id));
}
