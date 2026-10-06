import { normalizeText } from '@/lib/visionIndex';
import type { Project } from '@/types/project';
import type { AssetKind, LibraryAsset } from '@/lib/assetLibrary';

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

export type SearchScope =
  | 'project'
  | 'asset'
  | 'person'
  | 'message'
  | 'music'
  | 'photo'
  | 'video'
  | 'document'
  | 'template'
  | 'shop'
  | 'ai';

export interface SearchDoc {
  id: string;
  scope: SearchScope;
  title: string;
  subtitle?: string;
  /** extra kereshető szöveg (tagek, leírás). */
  keywords?: string[];
  thumbUri?: string;
  createdAt?: string;
  updatedAt?: string;
  /** tetszőleges strukturált mező (pl. `{ status, progress, published }`). */
  meta?: Record<string, unknown>;
}

export interface SearchResult extends SearchDoc {
  score: number;
}

// ── NL-lexikon (normalizált tokenek → jelentés) ──────────────────────────────

const SCOPE_WORDS: Record<string, SearchScope> = {
  project: 'project',
  projects: 'project',
  projekt: 'project',
  projektek: 'project',
  projektet: 'project',
  asset: 'asset',
  assets: 'asset',
  person: 'person',
  people: 'person',
  szemely: 'person',
  emberek: 'person',
  message: 'message',
  messages: 'message',
  uzenet: 'message',
  uzenetek: 'message',
  music: 'music',
  zene: 'music',
  zenek: 'music',
  song: 'music',
  songs: 'music',
  dal: 'music',
  photo: 'photo',
  photos: 'photo',
  foto: 'photo',
  fotok: 'photo',
  kep: 'photo',
  kepek: 'photo',
  video: 'video',
  videos: 'video',
  videok: 'video',
  document: 'document',
  documents: 'document',
  dokumentum: 'document',
  doksi: 'document',
  template: 'template',
  templates: 'template',
  sablon: 'template',
  sablonok: 'template',
  shop: 'shop',
  bolt: 'shop',
  marketplace: 'shop',
  piac: 'shop',
  ai: 'ai',
};

const UNFINISHED_WORDS = new Set([
  'felbehagyott',
  'befejezetlen',
  'draft',
  'piszkozat',
  'vazlat',
  'unfinished',
  'incomplete',
  'wip',
]);

const PUBLISHED_WORDS = new Set(['published', 'kiadott', 'kesz', 'megjelent']);

type TimeHint = 'today' | 'yesterday' | 'this-week' | 'this-month' | 'this-year' | 'last-year' | 'summer';

const TIME_WORDS: Record<string, TimeHint> = {
  ma: 'today',
  today: 'today',
  tegnap: 'yesterday',
  yesterday: 'yesterday',
  heti: 'this-week',
  week: 'this-week',
  havi: 'this-month',
  month: 'this-month',
  idei: 'this-year',
  tavalyi: 'last-year',
  tavaly: 'last-year',
  nyari: 'summer',
  nyar: 'summer',
  summer: 'summer',
};

/** kétszavas idő-kifejezések (a szomszédos tokenből) — „this year", „last year". */
const TIME_BIGRAMS: Record<string, TimeHint> = {
  'this year': 'this-year',
  'last year': 'last-year',
  'this week': 'this-week',
  'this month': 'this-month',
};

export interface ParsedQuery {
  /** a maradék szabad-szavas keresőtokenek (normalizált). */
  terms: string[];
  scopes: SearchScope[];
  /** `'unfinished'` = félbehagyott · `'published'` = kész/kiadott · undefined = mind. */
  status?: 'unfinished' | 'published';
  timeHints: TimeHint[];
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A lekérdezés szétszedése scope/status/idő szűrőkre + maradék keresőszavakra. */
export function parseQuery(query: string): ParsedQuery {
  const tokens = tokenize(query);
  const scopes = new Set<SearchScope>();
  const timeHints = new Set<TimeHint>();
  let status: ParsedQuery['status'];
  const terms: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const bigram = i + 1 < tokens.length ? `${tok} ${tokens[i + 1]}` : '';
    if (bigram && TIME_BIGRAMS[bigram]) {
      timeHints.add(TIME_BIGRAMS[bigram]);
      i++; // a második tokent is elnyeli
      continue;
    }
    if (SCOPE_WORDS[tok]) {
      scopes.add(SCOPE_WORDS[tok]);
      continue;
    }
    if (TIME_WORDS[tok]) {
      timeHints.add(TIME_WORDS[tok]);
      continue;
    }
    if (UNFINISHED_WORDS.has(tok)) {
      status = 'unfinished';
      continue;
    }
    if (PUBLISHED_WORDS.has(tok)) {
      status = status ?? 'published';
      continue;
    }
    if (tok.length >= 2) {
      terms.push(tok);
    }
  }

  return {
    terms,
    scopes: [...scopes],
    ...(status ? { status } : {}),
    timeHints: [...timeHints],
  };
}

// ── Idő-tartomány feloldás (determinisztikus, UTC) ───────────────────────────

export interface TimeRange {
  /** inkluzív ISO-alsó határ (undefined = nincs alsó korlát). */
  from?: string;
  /** exkluzív ISO-felső határ (undefined = nincs felső korlát). */
  to?: string;
}

const DAY_MS = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const startOfUtcDay = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Az idő-hintekből egy tartomány (a `now` ISO-hoz viszonyítva). */
export function resolveTimeRange(hints: TimeHint[], now: string): TimeRange {
  if (hints.length === 0) {
    return {};
  }
  const nowMs = new Date(now).getTime();
  const year = new Date(now).getUTCFullYear();
  // „summer" évét egy jelenlévő év-hint dönti el (tavalyi nyár vs. idei nyár)
  const summerYear = hints.includes('last-year') ? year - 1 : hints.includes('this-year') ? year : year;

  let from = -Infinity;
  let to = Infinity;
  const clampFrom = (ms: number) => (from = Math.max(from, ms));
  const clampTo = (ms: number) => (to = Math.min(to, ms));

  for (const h of hints) {
    switch (h) {
      case 'today':
        clampFrom(startOfUtcDay(nowMs));
        clampTo(nowMs + 1);
        break;
      case 'yesterday':
        clampFrom(startOfUtcDay(nowMs) - DAY_MS);
        clampTo(startOfUtcDay(nowMs));
        break;
      case 'this-week':
        clampFrom(nowMs - 7 * DAY_MS);
        clampTo(nowMs + 1);
        break;
      case 'this-month':
        clampFrom(nowMs - 30 * DAY_MS);
        clampTo(nowMs + 1);
        break;
      case 'this-year':
        clampFrom(Date.UTC(year, 0, 1));
        clampTo(nowMs + 1);
        break;
      case 'last-year':
        clampFrom(Date.UTC(year - 1, 0, 1));
        clampTo(Date.UTC(year, 0, 1));
        break;
      case 'summer':
        clampFrom(Date.UTC(summerYear, 5, 1)); // június 1.
        clampTo(Date.UTC(summerYear, 8, 1)); // szeptember 1.
        break;
    }
  }

  return {
    ...(from === -Infinity ? {} : { from: iso(from) }),
    ...(to === Infinity ? {} : { to: iso(to) }),
  };
}

// ── Szűrés / pontozás / keresés ──────────────────────────────────────────────

function docTime(doc: SearchDoc): string | undefined {
  return doc.updatedAt ?? doc.createdAt;
}

function inRange(doc: SearchDoc, range: TimeRange): boolean {
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

function isUnfinished(doc: SearchDoc): boolean {
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
function editDistance(a: string, b: string, max: number): number {
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
function allowedEdits(len: number): number {
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

// ── Adapterek: domain → SearchDoc ────────────────────────────────────────────

/** Projekt → kereshető dokumentum (a `rendered` = publikált heurisztika). */
export function projectToDoc(project: Project): SearchDoc {
  const kind = project.kind ?? 'video';
  return {
    id: project.id,
    scope: 'project',
    title: project.name,
    subtitle: kind,
    keywords: [kind, project.aspectRatio],
    ...(project.updatedAt ? { updatedAt: project.updatedAt } : {}),
    ...(project.createdAt ? { createdAt: project.createdAt } : {}),
    meta: { kind, published: !!project.rendered },
  };
}

const ASSET_SCOPE: Partial<Record<AssetKind, SearchScope>> = {
  music: 'music',
  photo: 'photo',
  video: 'video',
};

/** Könyvtár-asset → kereshető dokumentum (a zene/fotó/videó saját scope-ot kap). */
export function assetToDoc(asset: LibraryAsset): SearchDoc {
  return {
    id: asset.id,
    scope: ASSET_SCOPE[asset.kind] ?? 'asset',
    title: asset.name,
    subtitle: asset.kind,
    keywords: [...asset.tags, ...(asset.source ? [asset.source] : [])],
    ...(asset.thumbUri ? { thumbUri: asset.thumbUri } : {}),
    updatedAt: asset.updatedAt,
    createdAt: asset.createdAt,
    meta: { kind: asset.kind, favorite: asset.favorite, published: true },
  };
}
