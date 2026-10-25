/**
 * 🐞 App-oldali hibajelentés — tiszta mag (expo-mentes, tesztelhető).
 *
 * A kliens a futásidejű hibákat a workerre küldi (`POST /bugs` → a
 * `server/bugs/` mappába, hibánként egy fájl). Itt van: a tetszőleges dobott
 * érték normalizálása, a hiba-vihar elleni throttle (ugyanaz a hiba percenként
 * egyszer — a közben elnyelt ismétlések SZÁMA a következő jelentéssel megy, így
 * a szerver-számláló pontos marad), a breadcrumb-gyűrű, a payload méret-plafonja
 * (a szerver 64 KB-os limitje alatt — különben a jelentés némán elveszne) és az
 * offline-sor elemei. A hálózat/eszköz-infó/sor-zár a `bugReporter.ts`.
 */

export type BugKind =
  | 'js-fatal'
  | 'js-error'
  | 'unhandled-rejection'
  | 'boundary'
  | 'handled'
  | 'native';

export interface NormalizedError {
  name: string;
  message: string;
  stack: string;
}

/** Bármilyen dobott érték (Error, string, objektum, null) → egységes alak. */
export function normalizeError(e: unknown): NormalizedError {
  if (e instanceof Error) {
    return { name: e.name || 'Error', message: e.message || String(e), stack: e.stack ?? '' };
  }
  if (typeof e === 'string') {
    return { name: 'Error', message: e, stack: '' };
  }
  if (e && typeof e === 'object') {
    const o = e as { name?: unknown; message?: unknown; stack?: unknown };
    let message = typeof o.message === 'string' ? o.message : '';
    if (!message) {
      try {
        message = JSON.stringify(e).slice(0, 500);
      } catch {
        message = String(e);
      }
    }
    return {
      name: typeof o.name === 'string' && o.name ? o.name : 'Error',
      message,
      stack: typeof o.stack === 'string' ? o.stack : '',
    };
  }
  return { name: 'Error', message: String(e), stack: '' };
}

/**
 * A throttle kulcsa: a VÁLTOZÓ részek (azonosítók, számok) nélkül — különben
 * egy render-ciklusban változó id-vel dobó hiba minden példánya „új" lenne, és
 * elárasztaná a szervert. (A szerver ennél pontosabb ujjlenyomatot számol.)
 */
export function throttleKey(err: NormalizedError): string {
  const firstFrame = err.stack.split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
  const msg = err.message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>')
    .replace(/\b[a-z]+_[0-9a-z]{4,}\b/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .slice(0, 160);
  return `${err.name}|${msg}|${firstFrame.trim().replace(/:\d+:\d+/g, '')}`;
}

export interface BugThrottleState {
  lastSent: Record<string, number>;
  /** kulcsonként hányszor ment már ki (az eszkalálódó ablakhoz) */
  sends: Record<string, number>;
  /** a throttle-ablakban elnyelt ismétlések kulcsonként (a következő küldéssel mennek) */
  suppressed: Record<string, number>;
  sentThisSession: number;
}

/**
 * ESZKALÁLÓDÓ ablak: ugyanaz a hiba az 1. küldés után 1 perc, majd 5, 15, végül
 * 60 perc múlva mehet újra — egy folyamatosan dobó hiba így eszközönként óránként
 * ~4 jelentés (nem 60), a szerver-számláló mégis pontos (`repeat`).
 */
export const BUG_THROTTLE_LADDER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
/** az első ablak (visszafelé-kompatibilis név) */
export const BUG_THROTTLE_MS = BUG_THROTTLE_LADDER_MS[0];
export const BUG_SESSION_CAP = 50;

export function emptyThrottle(): BugThrottleState {
  return { lastSent: {}, sends: {}, suppressed: {}, sentThisSession: 0 };
}

/** a következő küldésig kötelező ablak `n` korábbi küldés után */
export function throttleWindowMs(sends: number): number {
  if (sends <= 0) {
    return 0;
  }
  return BUG_THROTTLE_LADDER_MS[Math.min(sends - 1, BUG_THROTTLE_LADDER_MS.length - 1)];
}

/**
 * Mehet-e a jelentés (eszkalálódó ablak + munkamenet-plafon). Az elnyelt
 * ismétlések nem vesznek el: `repeat` = 1 + a közben elnyeltek száma (a szerver
 * ennyivel növeli a számlálót). Tiszta.
 */
export function throttleDecision(
  state: BugThrottleState,
  key: string,
  nowMs: number,
): { send: boolean; repeat: number; next: BugThrottleState } {
  const last = state.lastSent[key];
  const inWindow = last != null && nowMs - last < throttleWindowMs(state.sends[key] ?? 0);
  if (inWindow || state.sentThisSession >= BUG_SESSION_CAP) {
    return {
      send: false,
      repeat: 0,
      next: { ...state, suppressed: { ...state.suppressed, [key]: (state.suppressed[key] ?? 0) + 1 } },
    };
  }
  const repeat = 1 + (state.suppressed[key] ?? 0);
  const suppressed = { ...state.suppressed };
  delete suppressed[key];
  return {
    send: true,
    repeat,
    next: {
      lastSent: { ...state.lastSent, [key]: nowMs },
      sends: { ...state.sends, [key]: (state.sends[key] ?? 0) + 1 },
      suppressed,
      sentThisSession: state.sentThisSession + 1,
    },
  };
}

export const BREADCRUMB_MAX = 20;

/** breadcrumb-gyűrű: a legfrissebb `max` lépés marad, időbélyeggel */
export function pushBreadcrumb(
  list: readonly string[],
  text: string,
  atIso: string,
  max: number = BREADCRUMB_MAX,
): string[] {
  const entry = `${atIso.slice(11, 19)} ${text.slice(0, 160)}`;
  return [...list, entry].slice(-max);
}

/** hossz-plafonok (a szerver `sanitizeReport` tükre — ott se vágódjon semmi) */
export const PAYLOAD_LIMITS = {
  message: 2000,
  stack: 8000,
  componentStack: 4000,
  name: 120,
  route: 200,
  breadcrumb: 200,
  breadcrumbs: 30,
  extraValue: 500,
  extraKeys: 20,
} as const;

/** a szerver body-limitje 64 KB — ennél kisebb biztonsági plafon */
export const MAX_PAYLOAD_BYTES = 48 * 1024;

function cut(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export interface BugPayloadInput {
  qid: string;
  kind: BugKind;
  error: NormalizedError;
  repeat: number;
  componentStack?: string;
  platform: string;
  osVersion: string;
  appVersion: string;
  model: string;
  route: string;
  projectId: string;
  breadcrumbs: readonly string[];
  extra?: Record<string, unknown>;
}

/**
 * A küldendő payload, méret-plafonnal: a mezők a szerver-limitekre vágva, és
 * ha a JSON így is túl nagy (pl. sok több-bájtos karakter), a stack/komponens-
 * stack fokozatosan rövidül — a jelentés SOSEM lépi túl a szerver body-limitjét.
 */
export function buildBugPayload(input: BugPayloadInput): Record<string, unknown> {
  const extra: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input.extra ?? {}).slice(0, PAYLOAD_LIMITS.extraKeys)) {
    if (typeof v === 'number' || typeof v === 'boolean') {
      extra[k] = v;
    } else {
      let s: string;
      try {
        s = typeof v === 'string' ? v : JSON.stringify(v);
      } catch {
        s = String(v);
      }
      extra[k] = cut(s ?? '', PAYLOAD_LIMITS.extraValue);
    }
  }
  const payload = {
    qid: input.qid,
    kind: input.kind,
    repeat: Math.max(1, Math.min(1000, Math.floor(input.repeat))),
    name: cut(input.error.name, PAYLOAD_LIMITS.name),
    message: cut(input.error.message, PAYLOAD_LIMITS.message),
    stack: cut(input.error.stack, PAYLOAD_LIMITS.stack),
    componentStack: cut(input.componentStack ?? '', PAYLOAD_LIMITS.componentStack),
    platform: input.platform,
    osVersion: cut(input.osVersion, 40),
    appVersion: cut(input.appVersion, 40),
    model: cut(input.model, 80),
    route: cut(input.route, PAYLOAD_LIMITS.route),
    projectId: cut(input.projectId, 80),
    breadcrumbs: input.breadcrumbs
      .slice(-PAYLOAD_LIMITS.breadcrumbs)
      .map((b) => cut(b, PAYLOAD_LIMITS.breadcrumb)),
    extra,
  };
  // végső biztosíték: bájt-méret (UTF-8 ≈ ≤ 3 bájt/kódegység) a plafon alá
  let budget: number = PAYLOAD_LIMITS.stack;
  while (utf8Length(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES && budget > 200) {
    budget = Math.floor(budget / 2);
    payload.stack = cut(input.error.stack, budget);
    payload.componentStack = cut(input.componentStack ?? '', Math.floor(budget / 2));
    payload.breadcrumbs = payload.breadcrumbs.slice(-Math.max(5, Math.floor(budget / 400)));
  }
  return payload;
}

/** UTF-8 bájthossz (a szerver-limit bájtban értendő, nem karakterben) */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4; // surrogate-pár: 4 bájt, a második fél kimarad
      i += 1;
    } else {
      n += 3;
    }
  }
  return n;
}

/**
 * Egyedi sor-azonosító (a szerver ebből szűri az újraküldött duplikátumot). A
 * munkamenet-szintű sorszám garantálja, hogy két, ugyanabban a milliszekundumban
 * keletkező jelentés se kapjon azonos qid-et (különben a szerver duplikátumnak
 * venné a másodikat).
 */
export function makeQid(nowMs: number, rand: number, seq: number = 0): string {
  return `${nowMs.toString(36)}${Math.floor(rand * 1e9).toString(36)}${seq.toString(36)}`;
}

export const BUG_QUEUE_MAX = 30;

/** az offline-sor bővítése (a legrégebbiek esnek ki, ha betelt) */
export function enqueueBug<T>(queue: readonly T[], item: T, max: number = BUG_QUEUE_MAX): T[] {
  return [...queue, item].slice(-max);
}

/** a tárolt sor biztonságos visszaolvasása (sérült/idegen tartalom → üres) */
export function parseBugQueue(raw: string | null): Record<string, unknown>[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<
          string,
          unknown
        >[]).slice(-BUG_QUEUE_MAX)
      : [];
  } catch {
    return [];
  }
}

/**
 * Mi a teendő a szerver-válasz alapján: `done` (siker, vagy végleges elutasítás
 * — újraküldve is ugyanígy járna: 4xx, 507 betelt mappa) vagy `retry` (hálózat,
 * 5xx, 429 rate-limit — később újra).
 */
export function deliveryOutcome(status: number | null): 'done' | 'retry' {
  if (status == null) {
    return 'retry';
  }
  if (status >= 200 && status < 300) {
    return 'done';
  }
  if (status === 429) {
    return 'retry';
  }
  if (status === 507 || (status >= 400 && status < 500)) {
    return 'done';
  }
  return 'retry';
}

// ── visszalépés + kötegelés (a szerver kímélése) ────────────────────────────

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

/**
 * Exponenciális visszalépés `failures` egymás utáni sikertelen kézbesítés után
 * (30 mp → 1 → 2 → 4 … max 30 perc), ±20% jitterrel — hogy egy felépülő szervert
 * ne rohanjon meg egyszerre minden eszköz. Közben az új jelentések csak a sorba
 * kerülnek (nincs hálózati kísérlet). A `rand` [0,1) kívülről jön (tesztelhető).
 */
export function nextBackoffMs(failures: number, rand: number): number {
  if (failures <= 0) {
    return 0;
  }
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
  return Math.round(base * (0.8 + 0.4 * Math.min(Math.max(rand, 0), 1)));
}

/** `Retry-After` fejléc (másodperc VAGY HTTP-dátum) → ms; hibás/hiányzó → 0 */
export function parseRetryAfterMs(header: string | null | undefined, nowMs: number): number {
  if (!header) {
    return 0;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(BACKOFF_MAX_MS, Number(trimmed) * 1000);
  }
  const at = Date.parse(trimmed);
  return Number.isFinite(at) ? Math.min(BACKOFF_MAX_MS, Math.max(0, at - nowMs)) : 0;
}

export const BATCH_MAX_ITEMS = 20;
/** egy köteg bájt-plafonja (a szerver 512 KB-os body-limitje alatt bőven) */
export const BATCH_MAX_BYTES = 200 * 1024;

/**
 * A sor kötegekre bontása: kötegenként max `BATCH_MAX_ITEMS` elem és
 * `BATCH_MAX_BYTES` bájt — a sor egy-két kérésben ürül, nem elemenként.
 */
export function chunkBatches<T>(
  items: readonly T[],
  maxItems: number = BATCH_MAX_ITEMS,
  maxBytes: number = BATCH_MAX_BYTES,
): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = utf8Length(JSON.stringify(item));
    if (cur.length > 0 && (cur.length >= maxItems || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(item);
    bytes += size;
  }
  if (cur.length > 0) {
    out.push(cur);
  }
  return out;
}
