import { normalizeText } from '@/lib/visionIndex';
import type { SearchScope } from '@/lib/universalSearchCore/docs';

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

export type TimeHint = 'today' | 'yesterday' | 'this-week' | 'this-month' | 'this-year' | 'last-year' | 'summer';

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
