/**
 * 🎯 For-You feed-ranking (audit §4.3) — tiszta, expo-mentes mag.
 *
 * A mai feed kronológikus (`promoted` + `created_at`). Ez egy valódi, jel-alapú
 * rangsoroló PONTSZÁM-magja: engagement + végignézés + alkotó-/téma-affinitás +
 * frissesség-csökkenés + negatív-jel-büntetés, végül diverzitás (ne klaszterezzen
 * egy alkotó). A jel-gyűjtés (watch-time/affinitás) + a server-oldali lekérdezés a
 * bekötés — ez a determinisztikus, tesztelt scoring, amit a kliens/worker használ.
 */

export interface PostSignals {
  likes?: number;
  comments?: number;
  saves?: number;
  shares?: number;
  remixes?: number;
  views?: number;
  /** a poszt kora órában (frissesség) */
  ageHours?: number;
  /** 0–1: mennyire nézik végig (erős jel) */
  completionRate?: number;
  /** 0–1: a néző affinitása az alkotóhoz (követi? sokat nézi tőle?) */
  creatorAffinity?: number;
  /** 0–1: téma/hashtag affinitás */
  topicAffinity?: number;
  /** 0–1 negatív jel (elrejtés/gyors átugrás) */
  negative?: number;
}

export interface RankWeights {
  engagement: number;
  completion: number;
  creatorAffinity: number;
  topicAffinity: number;
  /** a frissesség-csökkenés felezési ideje órában */
  freshnessHalfLifeH: number;
  negativePenalty: number;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  engagement: 1,
  completion: 1.5,
  creatorAffinity: 1.2,
  topicAffinity: 0.8,
  freshnessHalfLifeH: 24,
  negativePenalty: 2,
};

/** Súlyozott engagement-ráta: az interakciók / megtekintés (a ritkább = értékesebb). */
export function engagementScore(s: PostSignals): number {
  const views = Math.max(1, s.views ?? 0);
  const weighted =
    (s.likes ?? 0) * 1 +
    (s.comments ?? 0) * 2 +
    (s.saves ?? 0) * 3 +
    (s.shares ?? 0) * 4 +
    (s.remixes ?? 0) * 5;
  return weighted / views;
}

/** Frissesség-szorzó: exponenciális csökkenés (half-life). 1.0 frissen, →0 régen. */
export function freshnessFactor(ageHours: number, halfLifeH: number): number {
  if (ageHours <= 0) {
    return 1;
  }
  return Math.pow(0.5, ageHours / Math.max(1, halfLifeH));
}

/** Egy poszt rang-pontszáma (nem-negatív). Magasabb = előrébb. */
export function scorePost(s: PostSignals, w: RankWeights = DEFAULT_WEIGHTS): number {
  const base =
    w.engagement * engagementScore(s) +
    w.completion * (s.completionRate ?? 0) +
    w.creatorAffinity * (s.creatorAffinity ?? 0) +
    w.topicAffinity * (s.topicAffinity ?? 0);
  const fresh = freshnessFactor(s.ageHours ?? 0, w.freshnessHalfLifeH);
  const penalty = w.negativePenalty * (s.negative ?? 0);
  return Math.max(0, base * fresh - penalty);
}

/** Tetszőleges elemek rangsorolása csökkenő pontszám szerint (stabil a sorrend-térképpel). */
export function rankBy<T>(items: T[], signalsOf: (item: T) => PostSignals, w?: RankWeights): T[] {
  return items
    .map((item, i) => ({ item, i, score: scorePost(signalsOf(item), w) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}

/**
 * Diverzitás: ne legyen `maxStreak`-nél több EGYMÁS UTÁNI elem ugyanattól az
 * alkotótól — ha összegyűlne, a következő MÁS alkotót húzunk előre (mohó interleave).
 */
export function applyDiversity<T>(
  ranked: T[],
  creatorOf: (item: T) => string,
  maxStreak = 2,
): T[] {
  const out: T[] = [];
  const remaining = [...ranked];
  while (remaining.length) {
    let idx = 0;
    if (out.length >= maxStreak) {
      const tail = out.slice(-maxStreak);
      const last = creatorOf(tail[tail.length - 1]);
      const streak = tail.every((x) => creatorOf(x) === last);
      if (streak) {
        const alt = remaining.findIndex((x) => creatorOf(x) !== last);
        if (alt >= 0) {
          idx = alt;
        }
      }
    }
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}
