/**
 * 🐞 App-oldali hibajelentés — tiszta mag (expo-mentes, tesztelhető).
 *
 * A kliens a futásidejű hibákat a workerre küldi (`POST /bugs` → a
 * `server/bugs/` mappába, hibánként egy fájl). Itt van: a tetszőleges dobott
 * érték normalizálása, a hiba-vihar elleni throttle (ugyanaz a hiba percenként
 * egyszer, munkamenetenként plafon), a breadcrumb-gyűrű (a hiba előtti utolsó
 * lépések) és az offline-sor kezelése. A hálózat/eszköz-infó a `bugReporter.ts`.
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

/** a kliens-oldali throttle kulcsa (a szerver ennél pontosabb ujjlenyomatot számol) */
export function throttleKey(err: NormalizedError): string {
  const firstFrame = err.stack.split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
  return `${err.name}|${err.message.slice(0, 120)}|${firstFrame.trim().replace(/:\d+:\d+/g, '')}`;
}

export interface BugThrottleState {
  lastSent: Record<string, number>;
  sentThisSession: number;
}

export const BUG_THROTTLE_MS = 60_000;
export const BUG_SESSION_CAP = 30;

export function emptyThrottle(): BugThrottleState {
  return { lastSent: {}, sentThisSession: 0 };
}

/**
 * Mehet-e a jelentés: ugyanaz a hiba percenként egyszer, munkamenetenként max
 * `BUG_SESSION_CAP` — egy render-ciklusban dobó hiba ne árassza el a szervert.
 * Tiszta: az új állapotot adja vissza (`send=false` esetén változatlan).
 */
export function throttleDecision(
  state: BugThrottleState,
  key: string,
  nowMs: number,
): { send: boolean; next: BugThrottleState } {
  if (state.sentThisSession >= BUG_SESSION_CAP) {
    return { send: false, next: state };
  }
  const last = state.lastSent[key];
  if (last != null && nowMs - last < BUG_THROTTLE_MS) {
    return { send: false, next: state };
  }
  return {
    send: true,
    next: {
      lastSent: { ...state.lastSent, [key]: nowMs },
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

export const BUG_QUEUE_MAX = 30;

/** az offline-sor bővítése (a legrégebbiek esnek ki, ha betelt) */
export function enqueueBug<T>(queue: readonly T[], item: T, max: number = BUG_QUEUE_MAX): T[] {
  return [...queue, item].slice(-max);
}

/** a tárolt sor biztonságos visszaolvasása (sérült/idegen tartalom → üres) */
export function parseBugQueue(raw: string | null): unknown[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-BUG_QUEUE_MAX) : [];
  } catch {
    return [];
  }
}
