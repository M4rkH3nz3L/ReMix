/**
 * 🛡️ Live data-channel flood-védelem (LIVE.md Fázis F) — tiszta, expo-mentes mag.
 *
 * A realtime-csatornán (Supabase broadcast) a jelenet/chat/reakció üzenetek
 * mehetnek. Két irány védett:
 *  - KIMENŐ: a host jelenet-állapotát throttle-öljük (a gyors drag ne árasszon
 *    el — a jelenet TELJES-állapot snapshot, ezért a köztes képek elvesztése
 *    korrekt: a legfrissebb mindig felülírja). Chat/reakció token-bucket.
 *  - BEJÖVŐ: globális token-bucket esemény-típusonként, hogy egy rosszindulatú
 *    peer ne tudja elárasztani a renderert/UI-t (a többletet eldobjuk).
 *
 * Az időt injektálható `now()`-ból olvassuk → determinisztikusan tesztelhető.
 */

export interface TrailingThrottle<T> {
  /** új értéket ad be; vagy azonnal, vagy a következő ablakban (a legfrissebbet) küldi. */
  push: (value: T) => void;
  /** függő időzítő törlése (leálláskor). */
  stop: () => void;
}

export interface ThrottleDeps {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Trailing throttle: legfeljebb `minIntervalMs`-enként hív `flush`-t, mindig a
 * legutóbb bepusholt értékkel. Az első hívás azonnal mehet.
 */
export function createTrailingThrottle<T>(
  minIntervalMs: number,
  flush: (value: T) => void,
  deps: ThrottleDeps = {},
): TrailingThrottle<T> {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let lastSent = -Infinity;
  let pending: { value: T } | null = null;
  let timer: unknown = null;

  const doFlush = () => {
    timer = null;
    if (!pending) {
      return;
    }
    const v = pending.value;
    pending = null;
    lastSent = now();
    flush(v);
  };

  return {
    push(value: T) {
      const elapsed = now() - lastSent;
      if (elapsed >= minIntervalMs && timer == null) {
        lastSent = now();
        flush(value);
        return;
      }
      pending = { value };
      if (timer == null) {
        timer = schedule(doFlush, Math.max(0, minIntervalMs - elapsed));
      }
    },
    stop() {
      if (timer != null) {
        cancel(timer);
        timer = null;
      }
      pending = null;
    },
  };
}

export interface RateLimiter {
  /** `true` = van token (engedélyezett), `false` = eldobandó (flood). */
  allow: () => boolean;
}

/**
 * Token-bucket: `capacity` a maximális burst, `refillPerSec` az utántöltési ráta.
 * Minden `allow()` egy tokent fogyaszt; üres vödörnél `false`.
 */
export function createRateLimiter(
  capacity: number,
  refillPerSec: number,
  now: () => number = () => Date.now(),
): RateLimiter {
  let tokens = capacity;
  let last = now();
  return {
    allow() {
      const t = now();
      const refill = ((t - last) / 1000) * refillPerSec;
      if (refill > 0) {
        tokens = Math.min(capacity, tokens + refill);
        last = t;
      }
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
  };
}

export interface PerSenderLimiter {
  allow: (senderId: string) => boolean;
  forget: (senderId: string) => void;
  size: () => number;
}

/**
 * Feladónkénti token-bucket (ha a payload tartalmaz feladó-azonosítót, pl. chat).
 * Lusta: új feladóra hoz létre vödröt.
 */
export function createPerSenderLimiter(
  capacity: number,
  refillPerSec: number,
  now: () => number = () => Date.now(),
): PerSenderLimiter {
  const map = new Map<string, RateLimiter>();
  return {
    allow(senderId) {
      let rl = map.get(senderId);
      if (!rl) {
        rl = createRateLimiter(capacity, refillPerSec, now);
        map.set(senderId, rl);
      }
      return rl.allow();
    },
    forget(senderId) {
      map.delete(senderId);
    },
    size() {
      return map.size;
    },
  };
}
