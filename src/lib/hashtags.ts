import { normalizeHashtag } from '@/lib/publishTargets';

/**
 * #️⃣ Hashtag-mag (audit §4.5) — tiszta, expo-mentes.
 *
 * A hashtag-oldalak + a felfedezés alapja: szabad szövegből kinyeri a `#tag`-eket,
 * kanonizál (kis-betűs kulcs a csoportosításhoz), gyakoriságot/trendinget számol és
 * szűr egy poszt-halmazon. A megjelenítés/route-olás + a server-oldali lekérdezés a
 * bekötés — ez a determinisztikus, tesztelt számolás. A `normalizeHashtag`-ot a
 * [publishTargets](./publishTargets.ts)-ből veszi át (egy forrás a tisztításra).
 */

/** Kanonikus (kis-betűs, normalizált) hashtag-kulcs a csoportosításhoz; `null` ha érvénytelen. */
export function canonicalTag(tag: string): string | null {
  return normalizeHashtag(tag)?.toLowerCase() ?? null;
}

/** Szabad szövegből a `#tag`-ek — normalizálva + (kis-betű-érzéketlen) deduplikálva. */
export function extractHashtags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (text || '').matchAll(/#[\p{L}\p{N}_]+/gu)) {
    const display = normalizeHashtag(m[0]);
    if (!display) {
      continue;
    }
    const key = display.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(display);
    }
  }
  return out;
}

export interface HashtagCount {
  /** kanonikus (kis-betűs) tag, pl. `#remix` */
  tag: string;
  count: number;
}

/**
 * Hashtag-gyakoriság egy elem-halmazon (kanonikus kulcs szerint). Egy elem egy
 * tag-et csak EGYSZER számít (a caption-beli duplikátum nem torzít).
 */
export function countHashtags<T>(items: T[], getTags: (item: T) => string[] | undefined): HashtagCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const raw of getTags(item) ?? []) {
      const key = canonicalTag(raw);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** A leggyakoribb hashtagek (top-N). */
export function topHashtags<T>(items: T[], getTags: (item: T) => string[] | undefined, limit = 20): HashtagCount[] {
  return countHashtags(items, getTags).slice(0, limit);
}

/** Egy adott hashtaget (kanonikusan egyező) tartalmazó elemek — a hashtag-oldalhoz. */
export function filterByHashtag<T>(items: T[], tag: string, getTags: (item: T) => string[] | undefined): T[] {
  const key = canonicalTag(tag);
  if (!key) {
    return [];
  }
  return items.filter((item) => (getTags(item) ?? []).some((t) => canonicalTag(t) === key));
}

export interface HashtagTrend extends HashtagCount {
  /** frissesség-súlyozott pontszám (minden előfordulás `1/(ageHours+offset)` súllyal) */
  score: number;
}

/**
 * Trending hashtagek: minden előfordulást a poszt FRISSESSÉGÉVEL súlyoz
 * (`1/(ageHours+offset)`) — a most gyorsan terjedő tageket hozza előre, nem a
 * történelmi összeget (összhangban a [feedRanking](./feedRanking.ts) trendingjével).
 */
export function trendingHashtags<T>(
  items: T[],
  getTags: (item: T) => string[] | undefined,
  getAgeHours: (item: T) => number,
  opts: { offsetHours?: number; limit?: number } = {},
): HashtagTrend[] {
  const offset = Math.max(0.0001, opts.offsetHours ?? 2);
  const acc = new Map<string, { score: number; count: number }>();
  for (const item of items) {
    const weight = 1 / (Math.max(0, getAgeHours(item)) + offset);
    const seen = new Set<string>();
    for (const raw of getTags(item) ?? []) {
      const key = canonicalTag(raw);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const cur = acc.get(key) ?? { score: 0, count: 0 };
      cur.score += weight;
      cur.count += 1;
      acc.set(key, cur);
    }
  }
  return [...acc.entries()]
    .map(([tag, v]) => ({ tag, count: v.count, score: v.score }))
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
    .slice(0, opts.limit ?? 20);
}
