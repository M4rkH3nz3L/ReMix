/**
 * 🔎 Keresés — tiszta relevancia/fuzzy mag (Socials §03.2/§03.4).
 *
 * A full-text (`tsvector`) és a trigram-index (`pg_trgm`) SZERVER-oldali (DB) — ez a
 * mag a KLIENS-oldali intelligencia: typo-toleráns hasonlóság (a `pg_trgm`-mel AZONOS
 * trigram-definícióval, szó-paddinggel `"  "+szó+" "`), „did you mean", és a
 * HETEROGÉN találatok (user/post/template/hashtag) egységes, determinisztikus
 * rangsora relevancia + típus-súly + népszerűség + frissesség alapján. Így a kliens
 * offline/degradált módban is tud fuzzy-rangsorolni, és az autocomplete-sorrend
 * tesztelhető. Expo-mentes, tiszta.
 */

/** Lekérdezés-normalizálás: trim + kisbetű + többszörös whitespace összevonva. */
export function normalizeQuery(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Alfanumerikus szavakra bont (a trigram-padding egysége), kisbetűsítve. */
function words(s: string): string[] {
  return normalizeQuery(s)
    .split(/[^a-z0-9áéíóöőúüű]+/i)
    .filter(Boolean);
}

/**
 * A szöveg trigram-halmaza — a Postgres `pg_trgm`-mel AZONOS: minden szó
 * `"  "+szó+" "` paddinggel, 3-karakteres csúszóablak. (`show_trgm('cat')` =
 * {"  c"," ca","cat","at "}.)
 */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(s)) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/** Trigram-hasonlóság 0–1 (Jaccard: |A∩B| / |A∪B|), mint a `pg_trgm.similarity`. */
export function trigramSimilarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 && B.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) {
      inter += 1;
    }
  }
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Levenshtein szerkesztési távolság (két-soros, O(n·m)). */
export function editDistance(a: string, b: string): number {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (s === t) {
    return 0;
  }
  if (!s.length) {
    return t.length;
  }
  if (!t.length) {
    return s.length;
  }
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  let curr = new Array<number>(t.length + 1);
  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[t.length];
}

/** Normalizált szerkesztési hasonlóság 0–1: 1 − táv / max(hossz). */
export function editSimilarity(a: string, b: string): number {
  const s = normalizeQuery(a);
  const t = normalizeQuery(b);
  const max = Math.max(s.length, t.length);
  if (max === 0) {
    return 0;
  }
  return 1 - editDistance(s, t) / max;
}

/**
 * Typo-toleráns hasonlóság: a trigram (pg_trgm-tükör) ÉS a szerkesztési hasonlóság
 * MAXIMUMA — a trigram a szó-átrendezést, az edit-distance az egy-betűs hibát/
 * transzpozíciót fogja meg (a taszk §03.2 „trigram / Levenshtein").
 */
export function fuzzySimilarity(a: string, b: string): number {
  return Math.max(trigramSimilarity(a, b), editSimilarity(a, b));
}

/**
 * „Did you mean": a lekérdezéshez legközelebbi jelölt, ha a typo-toleráns hasonlóság
 * a küszöb felett van (alap 0.4). Döntetlennél az első jelölt nyer (stabil). Nincs
 * elég közeli → null.
 */
export function didYouMean(
  query: string,
  candidates: readonly string[],
  { threshold = 0.4 }: { threshold?: number } = {},
): string | null {
  let best: string | null = null;
  let bestSim = threshold;
  for (const c of candidates ?? []) {
    const sim = fuzzySimilarity(query, c);
    if (sim > bestSim) {
      bestSim = sim;
      best = c;
    }
  }
  return best;
}

/**
 * Egyetlen találat szöveges relevanciája 0–1: egzakt > prefix > részszó > fuzzy.
 * A legerősebb egyező jel nyer (nem összeadás), hogy a pontos egyezés mindig
 * a fuzzy fölé kerüljön.
 */
export function searchRelevance(query: string, text: string): number {
  const q = normalizeQuery(query);
  const t = normalizeQuery(text);
  if (!q || !t) {
    return 0;
  }
  if (t === q) {
    return 1;
  }
  if (t.startsWith(q)) {
    return 0.9;
  }
  if (t.includes(q)) {
    return 0.7;
  }
  // fuzzy: a typo-toleráns hasonlóságot 0.6 alá szorítjuk, hogy a részszó-egyezés fölé ne menjen
  return Math.min(0.6, fuzzySimilarity(q, t));
}

export type ResultType = 'user' | 'post' | 'template' | 'hashtag';

export interface SearchItem {
  text: string;
  type: ResultType;
  /** nyers népszerűség (követő/like/használat) — kis tie-breaker bónusz */
  popularity?: number;
  /** a tartalom kora órában (frissesség tie-breaker) */
  ageHours?: number;
}

/** Navigációs találat (user/hashtag) kis előnyt kap döntetlennél. */
export const TYPE_WEIGHT: Record<ResultType, number> = {
  user: 1.2,
  hashtag: 1.1,
  post: 1.0,
  template: 0.9,
};

export interface RankOptions {
  /** ennél kisebb relevanciájú találat kiesik (alap 0.2) */
  minRelevance?: number;
  /** frissesség felezési ideje órában a tie-breakerhez (alap 72) */
  freshnessHalfLifeH?: number;
}

/** Egy találat kompozit pontszáma (relevancia dominál, a többi finomhangol). */
export function scoreItem<T extends SearchItem>(
  query: string,
  item: T,
  opts: RankOptions = {},
): number {
  const rel = searchRelevance(query, item.text);
  if (rel <= 0) {
    return 0;
  }
  const typeW = TYPE_WEIGHT[item.type] ?? 1;
  const pop = 1 + 0.1 * (1 - Math.exp(-Math.max(0, item.popularity ?? 0) / 100)); // 1.0–1.1
  const halfLife = opts.freshnessHalfLifeH ?? 72;
  const age = Math.max(0, item.ageHours ?? 0);
  const fresh = 1 + 0.05 * Math.pow(0.5, age / Math.max(1, halfLife)); // 1.0–1.05
  return rel * typeW * pop * fresh;
}

/**
 * Heterogén találatok egységes, determinisztikus rangsora (autocomplete + kevert
 * lista). Kiszűri a küszöb alatti relevanciát, majd csökkenő kompozit pontszám
 * szerint rendez; döntetlennél az eredeti sorrend stabil.
 */
export function rankSearchResults<T extends SearchItem>(
  query: string,
  items: readonly T[],
  opts: RankOptions = {},
): T[] {
  const min = opts.minRelevance ?? 0.2;
  return (items ?? [])
    .map((item, i) => ({ item, i, rel: searchRelevance(query, item.text), score: scoreItem(query, item, opts) }))
    .filter((x) => x.rel >= min)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}
