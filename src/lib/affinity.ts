import type { PostSignals } from '@/lib/feedRanking';

/**
 * 🧲 Affinitás-mag (For-You §01.2/§01.5) — tiszta, expo-mentes.
 *
 * A [feedRanking](./feedRanking.ts) `PostSignals`-je `creatorAffinity`/`topicAffinity`
 * jeleket vár (0–1), de ma senki nem tölti fel. Ez a mag a néző NYERS history-jából
 * (követés/kölcsönös-kapcsolat + like/save/remix/komment/végignézés) és a preferált
 * hashtag-ekből számolja ki őket — determinisztikusan, önmagában tesztelhetően. A
 * tényleges adat-aggregáció (service_role napi batch) a bekötés; ez a kontraktus.
 *
 * FONTOS (adatvédelem): az affinitás CSAK egy pontszám — SOHA nem kerüli meg a
 * `filterBlocked`/privacy-szűrést. A tiltott/privát tartalmat a hívó szűri KI
 * ELŐBB; ez a mag sosem hoz vissza posztot, csak súlyoz. (§01.5 megkötés.)
 *
 * Mirror [viewSignals](./viewSignals.ts) — ugyanaz a „nyers-jel → PostSignals" minta.
 */

/** Telítődő leképezés nem-negatív mennyiségről 0–1-re (0→0, →1 monoton). */
function saturate(x: number, k: number): number {
  return x <= 0 ? 0 : 1 - Math.exp(-x / Math.max(1e-9, k));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** ~ennyi súlyozott interakciónál telik be a creator-affinitás ~0.63-ra. */
export const INTERACTION_SATURATION_K = 10;
/** egyirányú követés hozzáadott affinitása */
export const FOLLOW_BOOST = 0.2;
/** kölcsönös követés = „kapcsolat" (§01.5) — erősebb, mint a sima követés */
export const CONNECTION_BOOST = 0.35;

export interface CreatorInteraction {
  /** a néző követi az alkotót */
  follows?: boolean;
  /** kölcsönös követés = „kapcsolat" (§01.5); magában foglalja a követést */
  mutual?: boolean;
  likes?: number;
  comments?: number;
  saves?: number;
  remixes?: number;
  /** hány posztját nézte ~végig a néző */
  viewsCompleted?: number;
}

/**
 * A néző affinitása EGY alkotóhoz (0–1). A súlyozott interakció-összeg telítődik,
 * majd a követés/kapcsolat additív boost-ot ad (kapcsolat > követés). Monoton: több
 * interakció / erősebb kapcsolat sosem csökkent.
 */
export function creatorAffinity(i: CreatorInteraction = {}): number {
  const raw =
    (i.likes ?? 0) * 1 +
    (i.comments ?? 0) * 2 +
    (i.saves ?? 0) * 3 +
    (i.remixes ?? 0) * 4 +
    (i.viewsCompleted ?? 0) * 1.5;
  let score = saturate(raw, INTERACTION_SATURATION_K);
  if (i.mutual) {
    score += CONNECTION_BOOST;
  } else if (i.follows) {
    score += FOLLOW_BOOST;
  }
  return clamp01(score);
}

export type TagPreferences = Record<string, number>;

/** Hashtag-normalizálás: trim + kisbetű + vezető `#`-ek levágva. */
export function normalizeTag(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .trim();
}

/**
 * A néző téma-preferenciái a history-ból: minden interakció hashtag-jeit a
 * súlyával (alap 1) halmozza egy tag→súly térképbe. A súly pl. az interakció
 * erőssége lehet (egy save többet nyom, mint egy nézés).
 */
export function buildTagPreferences(
  history: ReadonlyArray<{ hashtags?: readonly string[]; weight?: number }>,
): TagPreferences {
  const out: TagPreferences = {};
  for (const h of history ?? []) {
    const w = Math.max(0, Number(h?.weight ?? 1) || 0);
    for (const tag of h?.hashtags ?? []) {
      const t = normalizeTag(tag);
      if (!t) {
        continue;
      }
      out[t] = (out[t] ?? 0) + w;
    }
  }
  return out;
}

/**
 * Egy poszt téma-affinitása (0–1): a néző affinitás-tömegének mekkora HÁNYADÁT
 * fedi le a poszt hashtag-jei. Nincs preferencia/tag → 0.
 */
export function topicAffinity(prefs: TagPreferences, postTags: readonly string[]): number {
  let total = 0;
  for (const v of Object.values(prefs ?? {})) {
    total += Math.max(0, v);
  }
  if (total <= 0) {
    return 0;
  }
  const postSet = new Set((postTags ?? []).map(normalizeTag).filter(Boolean));
  let matched = 0;
  for (const [tag, w] of Object.entries(prefs)) {
    if (postSet.has(tag)) {
      matched += Math.max(0, w);
    }
  }
  return clamp01(matched / total);
}

/**
 * Az affinitás-jelek beolvasztása a meglévő `PostSignals`-be (engagement/age/
 * completion máshonnan jön). Mirror {@link mergeViewSignals}.
 */
export function mergeAffinity(
  base: PostSignals,
  a: { creatorAffinity?: number; topicAffinity?: number },
): PostSignals {
  const out: PostSignals = { ...base };
  if (a.creatorAffinity != null) {
    out.creatorAffinity = clamp01(a.creatorAffinity);
  }
  if (a.topicAffinity != null) {
    out.topicAffinity = clamp01(a.topicAffinity);
  }
  return out;
}
