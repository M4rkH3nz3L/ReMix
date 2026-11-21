import { normalizeText } from '@/lib/visionIndex';
import type { SearchDoc } from '@/lib/universalSearchCore/docs';
import type { TimeRange } from '@/lib/universalSearchCore/query';

// ── Szűrés / pontozás / keresés ──────────────────────────────────────────────

export function docTime(doc: SearchDoc): string | undefined {
  return doc.updatedAt ?? doc.createdAt;
}

export function inRange(doc: SearchDoc, range: TimeRange): boolean {
  const t = docTime(doc);
  if (!t) {
    return !range.from && !range.to; // idő nélküli dokumentum csak idő-szűrő NÉLKÜL fér be
  }
  if (range.from && t < range.from) {
    return false;
  }
  if (range.to && t >= range.to) {
    return false;
  }
  return true;
}

export function isUnfinished(doc: SearchDoc): boolean {
  const m = doc.meta ?? {};
  if (m.published === true) {
    return false;
  }
  if (typeof m.progress === 'number' && m.progress >= 1) {
    return false;
  }
  if (m.status === 'published') {
    return false;
  }
  if (m.published === false) {
    return true;
  }
  if (typeof m.progress === 'number' && m.progress < 1) {
    return true;
  }
  const draftStates = ['draft', 'idea', 'backlog', 'production', 'editing', 'review'];
  return typeof m.status === 'string' && draftStates.includes(m.status);
}

function haystack(doc: SearchDoc): string {
  return [doc.title, doc.subtitle ?? '', (doc.keywords ?? []).join(' ')].join(' ');
}

/** Egy dokumentum pontozása a keresőtokenek fölött (0–~1,8). */
export function scoreDoc(doc: SearchDoc, terms: string[]): number {
  if (terms.length === 0) {
    return 1; // scope/idő-only lekérdezés: minden átment már, recency dönt
  }
  const hay = normalizeText(haystack(doc));
  const title = normalizeText(doc.title);
  let matched = 0;
  let titleMatched = 0;
  for (const t of terms) {
    if (hay.includes(t)) {
      matched++;
    }
    if (title.includes(t)) {
      titleMatched++;
    }
  }
  const coverage = matched / terms.length;
  const titleBoost = (titleMatched / terms.length) * 0.5;
  const phraseBoost = title.includes(terms.join(' ')) ? 0.3 : 0;
  return Math.round((coverage + titleBoost + phraseBoost) * 1000) / 1000;
}

// ── typo-tolerancia (fuzzy) ──────────────────────────────────────────────────

/**
 * Korlátos Levenshtein-táv (`> max` esetén korán `max+1`-gyel kilép → gyors).
 * On-device, allokáció-takarékos (két sor), így hosszú korpuszon is futhat.
 */
export function editDistance(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) {
    return max + 1;
  }
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) {
        rowMin = cur[j];
      }
    }
    if (rowMin > max) {
      return max + 1; // ebben a sorban már mind > max → a végeredmény is az lesz
    }
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

/** Egy token hossz-függő megengedett hibaszáma (rövidre 0 → ne adjon zajt). */
export function allowedEdits(len: number): number {
  return len <= 3 ? 0 : len <= 5 ? 1 : 2;
}

/** A `term` legjobb fuzzy-illeszkedése a tokenek közé: 0 (nincs) … 0.9 (közeli). */
function bestFuzzy(term: string, tokens: string[]): number {
  const allowed = allowedEdits(term.length);
  if (allowed === 0) {
    return 0;
  }
  let best = 0;
  for (const w of tokens) {
    if (Math.abs(w.length - term.length) > allowed) {
      continue;
    }
    const d = editDistance(term, w, allowed);
    if (d <= allowed) {
      const wt = 1 - d / (term.length + 1);
      if (wt > best) {
        best = wt;
      }
    }
  }
  // a fuzzy SOSEM ér annyit, mint a pontos egyezés → exact mindig előrébb rangsorol
  return best > 0 ? Math.min(0.9, best) : 0;
}

function tokensOf(s: string): string[] {
  return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * A `scoreDoc` typo-toleráns változata: a pontos substring-egyezés teljes súlyú
 * (azonos a `scoreDoc`-kal), a nem-pontos tokenek fuzzy-illeszkedése részleges
 * kreditet kap. Így a fuzzy mindig SZUPERHALMAZ: ahol van pontos találat, az
 * eredmény a `scoreDoc`-éval egyezik, a típushibák viszont nem esnek ki.
 */
export function scoreDocFuzzy(doc: SearchDoc, terms: string[]): number {
  if (terms.length === 0) {
    return 1;
  }
  const hay = normalizeText(haystack(doc));
  const title = normalizeText(doc.title);
  const hayTokens = tokensOf(hay);
  const titleTokens = tokensOf(title);
  let matched = 0;
  let titleMatched = 0;
  for (const t of terms) {
    matched += hay.includes(t) ? 1 : bestFuzzy(t, hayTokens);
    titleMatched += title.includes(t) ? 1 : bestFuzzy(t, titleTokens);
  }
  const coverage = matched / terms.length;
  const titleBoost = (titleMatched / terms.length) * 0.5;
  const phraseBoost = title.includes(terms.join(' ')) ? 0.3 : 0;
  return Math.round((coverage + titleBoost + phraseBoost) * 1000) / 1000;
}
