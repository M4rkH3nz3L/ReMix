/**
 * 🚦 Élő adás ÁLLAPOTGÉP (PRO-LIVE L13/L17, terv §7/1) — pure.
 *
 * `idle → preparing → connecting → live ⇄ reconnecting → stopping → ended`, bármikor `error`.
 * A hiteles forrás a média-kapcsolat (a LiveKit room-eseményei) — NEM a UI: ha a kapcsolat
 * elvész, a UI nem ragadhat „ÉLŐ"-ben futó órával. Az újracsatlakozásnak időkorlátja van;
 * utána `error` (a host dönt: újrapróba vagy befejezés). Az egress (multistream/felvétel)
 * külön al-állapot: a hibája LÁTHATÓ, nem nyelődik el.
 */
export type LivePhase = 'idle' | 'preparing' | 'connecting' | 'live' | 'reconnecting' | 'stopping' | 'ended' | 'error';

export type LiveErrorCode = 'reconnectTimeout' | 'ended' | 'notFound' | 'permission' | 'token' | 'unknown';

export interface LiveState {
  phase: LivePhase;
  /** az aktuális fázis kezdete (ms) */
  since: number;
  /** az első sikeres élő-kapcsolat ideje (az adás-óra alapja) */
  liveSince?: number;
  error?: LiveErrorCode;
  /** hányszor szakadt meg a kapcsolat az adás alatt (diagnosztika) */
  drops: number;
}

export type LiveEvent =
  | { type: 'PREPARE'; at: number }
  | { type: 'CONNECT'; at: number }
  | { type: 'CONNECTED'; at: number }
  | { type: 'DISCONNECTED'; at: number }
  | { type: 'TICK'; at: number }
  | { type: 'RETRY'; at: number }
  | { type: 'STOP'; at: number }
  | { type: 'STOPPED'; at: number }
  | { type: 'FAIL'; at: number; error: LiveErrorCode };

/** ennyi ideig próbál újracsatlakozni, mielőtt hibát jelez */
export const RECONNECT_TIMEOUT_MS = 30_000;

export const initialLiveState = (at = 0): LiveState => ({ phase: 'idle', since: at, drops: 0 });

const go = (s: LiveState, phase: LivePhase, at: number, extra: Partial<LiveState> = {}): LiveState => ({
  ...s,
  ...extra,
  phase,
  since: at,
});

export function liveReducer(s: LiveState, e: LiveEvent): LiveState {
  // a befejezett adás végleges
  if (s.phase === 'ended') return s;
  switch (e.type) {
    case 'PREPARE':
      return s.phase === 'idle' ? go(s, 'preparing', e.at) : s;
    case 'CONNECT':
      return s.phase === 'idle' || s.phase === 'preparing' ? go(s, 'connecting', e.at) : s;
    case 'CONNECTED':
      if (s.phase === 'connecting' || s.phase === 'reconnecting' || s.phase === 'preparing') {
        return go(s, 'live', e.at, { liveSince: s.liveSince ?? e.at, error: undefined });
      }
      return s;
    case 'DISCONNECTED':
      if (s.phase === 'live') return go(s, 'reconnecting', e.at, { drops: s.drops + 1 });
      if (s.phase === 'stopping') return go(s, 'ended', e.at);
      return s;
    case 'TICK':
      if (s.phase === 'reconnecting' && e.at - s.since >= RECONNECT_TIMEOUT_MS) {
        return go(s, 'error', e.at, { error: 'reconnectTimeout' });
      }
      return s;
    case 'RETRY':
      return s.phase === 'error' && s.error === 'reconnectTimeout' ? go(s, 'reconnecting', e.at) : s;
    case 'STOP':
      return s.phase === 'idle' ? go(s, 'ended', e.at) : go(s, 'stopping', e.at);
    case 'STOPPED':
      return go(s, 'ended', e.at);
    case 'FAIL':
      return s.phase === 'stopping' ? go(s, 'ended', e.at) : go(s, 'error', e.at, { error: e.error });
  }
}

/** élő adásban van-e (csak ekkor „ÉLŐ" a jelvény és fut az óra) */
export const isOnAir = (s: LiveState) => s.phase === 'live';

/** a token-szerzés hibája → állapot-hiba (a szerver 404 / 410 / 403 kódjai, 1. lépés) */
export function tokenErrorCode(message: string): LiveErrorCode | null {
  if (/\(410\)|véget ért|ended/i.test(message)) return 'ended';
  if (/\(404\)|nincs ilyen élő adás|not found/i.test(message)) return 'notFound';
  return null;
}

// ── egress (multistream / felhős felvétel) al-állapot ──────────────────────────
export type EgressStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | { state: 'on'; destinations: number; recording: boolean; skipped: number }
  | { state: 'failed'; reason: EgressFailure };

export type EgressFailure = 'needsPro' | 'busy' | 'unavailable' | 'noTargets' | 'unknown';

/** a szerver egress-hibája (HTTP-státusz az üzenetben) → érthető ok */
export function egressFailure(message: string): EgressFailure {
  if (/\(402\)|pro/i.test(message)) return 'needsPro';
  if (/\(429\)|már fut/i.test(message)) return 'busy';
  if (/\(503\)|nincs konfigurálva/i.test(message)) return 'unavailable';
  if (/\(400\)|nincs sem engedélyezett/i.test(message)) return 'noTargets';
  return 'unknown';
}
