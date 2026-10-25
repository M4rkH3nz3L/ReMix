const crypto = require('crypto');

/**
 * 🐞 A hibajelentés-végpont terhelés-védelmei (tiszta, időt kívülről kapó
 * osztályok → tesztelhetők):
 *  - `TokenCache`: a token → user-id feloldás cache-e (különben MINDEN jelentés
 *    egy kifelé menő Supabase-hívás lenne); csak a token HASH-ét tárolja,
 *  - `LoadShedder`: globális percenkénti plafon — fölötte 503 + Retry-After, a
 *    kliensek visszalépnek (a hiba-vihar nem viheti el a workert).
 */

class TokenCache {
  constructor({ ttlMs = 10 * 60_000, max = 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    /** @type {Map<string, { userId: string | null, exp: number }>} */
    this.map = new Map();
  }

  static key(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  get(token, nowMs) {
    const k = TokenCache.key(token);
    const hit = this.map.get(k);
    if (!hit) {
      return undefined;
    }
    if (hit.exp <= nowMs) {
      this.map.delete(k);
      return undefined;
    }
    return hit.userId;
  }

  set(token, userId, nowMs) {
    const k = TokenCache.key(token);
    this.map.delete(k);
    this.map.set(k, { userId, exp: nowMs + this.ttlMs });
    // a legrégebbi kiesik (a Map beszúrási sorrendet tart)
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
  }
}

class LoadShedder {
  constructor({ maxPerWindow = 300, windowMs = 60_000 } = {}) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this.windowStart = 0;
    this.count = 0;
  }

  /**
   * Befogadható-e `n` jelentés. Ha nem: `{ ok: false, retryAfterSec }` — a kliens
   * ennyi ideig nem próbálkozik újra.
   */
  admit(n, nowMs) {
    if (nowMs - this.windowStart >= this.windowMs) {
      this.windowStart = nowMs;
      this.count = 0;
    }
    if (this.count + n > this.maxPerWindow) {
      const retryAfterSec = Math.max(1, Math.ceil((this.windowStart + this.windowMs - nowMs) / 1000));
      return { ok: false, retryAfterSec };
    }
    this.count += n;
    return { ok: true, retryAfterSec: 0 };
  }
}

module.exports = { TokenCache, LoadShedder };
