/**
 * 📈 Creator-szintű analitika (audit §4.10) — tiszta, expo-mentes.
 *
 * Az [analytics.ts](./analytics.ts) a TARTALOM teljesítményét nézi (engagement/
 * retention/breakdown); ez a CSATORNA aggregált mutatói: remix-analitika (a saját
 * tartalom mennyire „terjed" tovább) és követő-növekedés egy pillanatkép-sorozatból.
 * Determinisztikus (nincs rejtett `Date.now()` — a követő-sorozat saját időbélyegei
 * döntenek), a tömböket a hívó állítja össze (feed/profil), így önmagában tesztelhető.
 */

export interface RemixSource {
  id: string;
  views: number;
  remixes: number;
}

export interface RemixAnalytics {
  totalRemixes: number;
  totalViews: number;
  /** remixek / megtekintés (0, ha nincs view) */
  remixRate: number;
  /** a legalább egyszer remixelt posztok aránya az összeshez (0–1) */
  remixedShare: number;
  /** a legtöbbet remixelt posztok (csökkenő), top-N */
  topRemixed: { id: string; remixes: number }[];
}

/** A csatorna remix-mutatói a saját posztokból (a remix-count már a poszton van). */
export function remixAnalytics(posts: RemixSource[], topN = 5): RemixAnalytics {
  let totalRemixes = 0;
  let totalViews = 0;
  let remixedCount = 0;
  for (const p of posts) {
    const r = Math.max(0, p.remixes || 0);
    totalRemixes += r;
    totalViews += Math.max(0, p.views || 0);
    if (r > 0) {
      remixedCount += 1;
    }
  }
  const topRemixed = posts
    .filter((p) => (p.remixes || 0) > 0)
    .map((p) => ({ id: p.id, remixes: Math.max(0, p.remixes || 0) }))
    .sort((a, b) => b.remixes - a.remixes || a.id.localeCompare(b.id))
    .slice(0, topN);
  return {
    totalRemixes,
    totalViews,
    remixRate: totalViews > 0 ? totalRemixes / totalViews : 0,
    remixedShare: posts.length > 0 ? remixedCount / posts.length : 0,
    topRemixed,
  };
}

export interface FollowerSnapshot {
  /** ISO időbélyeg */
  at: string;
  followers: number;
}

export interface FollowerGrowth {
  current: number;
  /** nettó változás az első és utolsó pillanatkép közt */
  net: number;
  /** átlagos napi változás (0, ha nincs eltelt idő) */
  ratePerDay: number;
  /** a legnagyobb EGYMÁS UTÁNI növekmény (null, ha <2 pillanatkép) */
  bestGain: { at: string; gain: number } | null;
}

const DAY_MS = 86_400_000;

/**
 * Követő-növekedés egy (idő szerint rendezett vagy rendezetlen) pillanatkép-sorozatból.
 * A `ratePerDay` a teljes nettót osztja az eltelt nappal; a `bestGain` a legnagyobb
 * két szomszédos pillanatkép közti növekmény (a legjobb „felfutás").
 */
export function followerGrowth(snapshots: FollowerSnapshot[]): FollowerGrowth {
  const valid = snapshots
    .filter((s) => Number.isFinite(Date.parse(s.at)) && typeof s.followers === 'number')
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (valid.length === 0) {
    return { current: 0, net: 0, ratePerDay: 0, bestGain: null };
  }
  const first = valid[0];
  const last = valid[valid.length - 1];
  const net = last.followers - first.followers;
  const spanMs = Date.parse(last.at) - Date.parse(first.at);
  const ratePerDay = spanMs > 0 ? net / (spanMs / DAY_MS) : 0;

  let bestGain: { at: string; gain: number } | null = null;
  for (let i = 1; i < valid.length; i++) {
    const gain = valid[i].followers - valid[i - 1].followers;
    if (bestGain === null || gain > bestGain.gain) {
      bestGain = { at: valid[i].at, gain };
    }
  }
  return { current: last.followers, net, ratePerDay, bestGain };
}
