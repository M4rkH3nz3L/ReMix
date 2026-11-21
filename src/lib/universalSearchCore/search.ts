import { normalizeText } from '@/lib/visionIndex';
import type { SearchDoc, SearchResult, SearchScope } from '@/lib/universalSearchCore/docs';
import { parseQuery, resolveTimeRange } from '@/lib/universalSearchCore/query';
import {
  allowedEdits,
  docTime,
  editDistance,
  inRange,
  isUnfinished,
  scoreDoc,
  scoreDocFuzzy,
} from '@/lib/universalSearchCore/scoring';

export interface SearchOptions {
  /** az idő-szűrők feloldásához (ISO). */
  now?: string;
  limit?: number;
  /** csak ezekre a scope-okra (a lekérdezésből detektált scope-ok fölé). */
  scopes?: SearchScope[];
  /**
   * typo-tolerancia: ha a PONTOS keresés 0 találatot ad, egy fuzzy-körrel újrapróbál
   * (`true`/undefined = engedélyezett fallback; `false` = kikapcsolva). A pontos
   * találatos lekérdezések viselkedése változatlan.
   */
  fuzzy?: boolean;
}

/**
 * Globális keresés a heterogén dokumentum-halmaz felett. A lekérdezésből
 * detektált scope/status/idő szűrők szűrnek, majd a maradék tokenek pontoznak;
 * végül recency dönt a döntetlennél.
 */
export function search(docs: SearchDoc[], query: string, opts: SearchOptions = {}): SearchResult[] {
  const parsed = parseQuery(query);
  const scopes = new Set<SearchScope>([...parsed.scopes, ...(opts.scopes ?? [])]);
  const range = parsed.timeHints.length ? resolveTimeRange(parsed.timeHints, opts.now ?? new Date().toISOString()) : null;
  const limit = opts.limit ?? 30;

  // egy kör: a (scope/status/idő) szűrőkön átment dokumentumok pontozva a megadott
  // scorer-rel (a fuzzy-fallback ugyanazt a szűrést használja, más pontozással).
  const run = (scorer: (doc: SearchDoc, terms: string[]) => number): SearchResult[] => {
    const out: SearchResult[] = [];
    for (const doc of docs) {
      if (scopes.size > 0 && !scopes.has(doc.scope)) {
        continue;
      }
      if (parsed.status === 'unfinished' && !isUnfinished(doc)) {
        continue;
      }
      if (parsed.status === 'published' && isUnfinished(doc)) {
        continue;
      }
      if (range && !inRange(doc, range)) {
        continue;
      }
      const score = scorer(doc, parsed.terms);
      if (parsed.terms.length > 0 && score <= 0) {
        continue;
      }
      out.push({ ...doc, score });
    }
    return out;
  };

  let results = run(scoreDoc);
  // typo-tolerancia: ha a PONTOS keresésnek nincs találata (de volt keresőszó),
  // egy fuzzy-körrel újrapróbálunk — a pontos-találatos lekérdezések érintetlenek.
  if (results.length === 0 && parsed.terms.length > 0 && opts.fuzzy !== false) {
    results = run(scoreDocFuzzy);
  }

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return (docTime(b) ?? '').localeCompare(docTime(a) ?? '');
  });
  return results.slice(0, limit);
}

export interface SuggestOptions {
  limit?: number;
}

/**
 * ⌨️ Autocomplete: a `prefix`-hez illő javaslatok (cím-találatok + kulcsszavak),
 * rangsorolva: cím-prefix > kulcsszó-prefix > tartalmazás > fuzzy-prefix. Üres/
 * rövid prefix → nincs javaslat. A visszatérés deduplikált javaslat-szövegek listája.
 */
export function suggest(docs: SearchDoc[], prefix: string, opts: SuggestOptions = {}): string[] {
  const q = normalizeText(prefix).trim();
  if (q.length < 1) {
    return [];
  }
  const limit = opts.limit ?? 8;
  const best = new Map<string, number>(); // javaslat-szöveg → legjobb pontszám
  const bump = (text: string, s: number): void => {
    if (!text) {
      return;
    }
    const cur = best.get(text);
    if (cur == null || s > cur) {
      best.set(text, s);
    }
  };
  const fuzzyPrefix = (n: string): boolean => {
    const allowed = allowedEdits(q.length);
    return allowed > 0 && editDistance(q, n.slice(0, q.length), allowed) <= allowed;
  };
  for (const doc of docs) {
    const title = doc.title ?? '';
    const nTitle = normalizeText(title);
    if (nTitle.startsWith(q)) {
      bump(title, 4);
    } else if (nTitle.includes(q)) {
      bump(title, 2);
    } else if (fuzzyPrefix(nTitle)) {
      bump(title, 1);
    }
    for (const kw of doc.keywords ?? []) {
      const nk = normalizeText(kw);
      if (nk.startsWith(q)) {
        bump(kw, 3);
      } else if (nk.includes(q)) {
        bump(kw, 1.5);
      }
    }
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text]) => text);
}

/** Scope-onként csoportosított találatok (a ⌘K szekciós megjelenítéséhez). */
export function groupByScope(results: SearchResult[]): Partial<Record<SearchScope, SearchResult[]>> {
  const out: Partial<Record<SearchScope, SearchResult[]>> = {};
  for (const r of results) {
    (out[r.scope] ??= []).push(r);
  }
  return out;
}
