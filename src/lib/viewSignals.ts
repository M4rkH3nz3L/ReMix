import type { PostSignals } from '@/lib/feedRanking';

/**
 * 👁️ Nézési-jel aggregáció (audit §4.3) — tiszta, expo-mentes.
 *
 * A [feedRanking](./feedRanking.ts) `PostSignals`-je `completionRate`/`rewatch`
 * jeleket vár, de ezek ma nincsenek feltöltve. Ez a mag a nyers NÉZÉSI ESEMÉNYEKből
 * (egy-egy megtekintés: mennyit nézett a hosszból, ki nézte) számolja ki a
 * végignézést és az újranézést — determinisztikusan, önmagában tesztelhetően. A
 * tényleges gyűjtés (lejátszó-instrumentálás + tárolás) a bekötés; ez a kontraktus.
 */

export interface ViewEvent {
  postId: string;
  /** a néző azonosítója (az újranézés/egyedi-néző méréshez); hiányzóan anonim */
  viewerId?: string | null;
  /** ebből a nézésből megtekintett idő (ms) */
  watchedMs: number;
  /** a tartalom teljes hossza (ms) */
  durationMs: number;
}

export interface ViewAggregate {
  views: number;
  uniqueViewers: number;
  /** átlagos végignézés 0–1 (min(1, watched/duration) nézésenként átlagolva) */
  completionRate: number;
  /** az ismételt nézések aránya 0–1 ((views − egyedi) / views) */
  rewatchRate: number;
}

function clampFraction(watched: number, duration: number): number {
  if (!(duration > 0) || !(watched > 0)) {
    return 0;
  }
  const f = watched / duration;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Egyetlen poszt nézési eseményeinek összegzése. */
export function aggregateViews(events: readonly ViewEvent[]): ViewAggregate {
  let views = 0;
  let completionSum = 0;
  const viewers = new Set<string>();
  let anonViews = 0;
  for (const e of events) {
    views += 1;
    completionSum += clampFraction(e.watchedMs, e.durationMs);
    if (e.viewerId) {
      viewers.add(e.viewerId);
    } else {
      anonViews += 1; // minden anonim nézés külön „egyedi"-nek számít
    }
  }
  if (views === 0) {
    return { views: 0, uniqueViewers: 0, completionRate: 0, rewatchRate: 0 };
  }
  const uniqueViewers = viewers.size + anonViews;
  const rewatchRate = Math.max(0, (views - uniqueViewers) / views);
  return {
    views,
    uniqueViewers,
    completionRate: completionSum / views,
    rewatchRate,
  };
}

/** Poszt-id → aggregátum az összes eseményből (egy menetben csoportosít). */
export function aggregateByPost(events: readonly ViewEvent[]): Map<string, ViewAggregate> {
  const byPost = new Map<string, ViewEvent[]>();
  for (const e of events) {
    const arr = byPost.get(e.postId) ?? [];
    arr.push(e);
    byPost.set(e.postId, arr);
  }
  const out = new Map<string, ViewAggregate>();
  for (const [postId, list] of byPost) {
    out.set(postId, aggregateViews(list));
  }
  return out;
}

/**
 * A nézési aggregátum beolvasztása a meglévő `PostSignals`-be (engagement/age a
 * feed-adatból jön; ez a `completionRate`-et és a `rewatch`-jelet adja hozzá). A
 * `rewatchRate` kis pozitív jelként a completionRate-et emeli (a feedRanking nem
 * ismer külön rewatch-súlyt — a végignézés az erős jel).
 */
export function mergeViewSignals(base: PostSignals, agg: ViewAggregate | undefined): PostSignals {
  if (!agg || agg.views === 0) {
    return base;
  }
  return {
    ...base,
    views: Math.max(base.views ?? 0, agg.views),
    completionRate: agg.completionRate,
  };
}
