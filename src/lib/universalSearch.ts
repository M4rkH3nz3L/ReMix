/**
 * 🔎 Universal Search / ⌘K (PM3 — MASTER §15) — GLOBÁLIS kereső MINDEN tartalom
 * felett (Projects · Assets · People · Messages · Music · Photos · Videos ·
 * Documents · Templates · Shop · AI), természetes-nyelvi szűrőkkel:
 * „félbehagyott projektek", „tavalyi nyári fotók", „hol a neon logóm",
 * „hol használtam a H3nz3L intro-t".
 *
 * A modul TISZTA: a szemantikus (embedding) réteg a `visionSearch`-ben él
 * (felhő); ez az on-device, INGYENES kulcsszó + NL-szűrő mag — determinisztikus,
 * `now`-paraméterrel (nincs rejtett `Date.now()`), így teljesen tesztelhető.
 */

// Barrel — expo-mentes mag a universalSearchCore/ alatt: dokumentum-modell, NL-lekérdezés
// (scope/status/idő), pontozás + fuzzy, keresés/autocomplete/csoportosítás, domain-adapterek
export type { SearchDoc, SearchResult, SearchScope } from '@/lib/universalSearchCore/docs';
export { parseQuery, resolveTimeRange, type ParsedQuery, type TimeRange } from '@/lib/universalSearchCore/query';
export { scoreDoc, scoreDocFuzzy } from '@/lib/universalSearchCore/scoring';
export {
  groupByScope,
  search,
  suggest,
  type SearchOptions,
  type SuggestOptions,
} from '@/lib/universalSearchCore/search';
export { assetToDoc, projectToDoc } from '@/lib/universalSearchCore/adapters';
