/**
 * 📊 Creator Analytics (E-Analytics — MASTER §22) — NEM csak social: a tartalom-
 * teljesítmény + a MUNKAFOLYAMAT/produktivitás tiszta aggregációja. Megválaszolja:
 * „melyik hook/thumbnail/template működik?", „miért teljesített ez jobban?",
 * „melyik workflow-lépés lassú?", „mennyit szerkesztettem?".
 *
 * Tiszta, expo-mentes, determinisztikus — a nyers számlálók (poszt-statok /
 * edit-sessionök / lépés-időzítések) a hívótól jönnek; ez az ELEMZŐ réteg.
 */

export interface ContentStat {
  id: string;
  publishedAt?: string;
  platform?: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** megtekintett másodperc (retencióhoz) */
  watchSec?: number;
  /** a tartalom teljes hossza (mp) */
  durationSec?: number;
  /** melyik hook/thumbnail/template variánssal készült (A/B) */
  hook?: string;
  thumbnail?: string;
  template?: string;
}

const round = (n: number, d = 4): number => {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
};

/** engagement = (like+comment+share) / megtekintés (0, ha nincs megtekintés). */
export function engagementRate(s: ContentStat): number {
  return s.views > 0 ? round((s.likes + s.comments + s.shares) / s.views) : 0;
}

/** retenció = megtekintett / teljes hossz (null, ha nincs adat). */
export function retentionRate(s: ContentStat): number | null {
  if (!s.watchSec || !s.durationSec || s.durationSec <= 0) {
    return null;
  }
  return round(s.watchSec / s.durationSec);
}

export interface ContentSummary {
  count: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  avgViews: number;
  avgEngagement: number;
}

export function summarize(stats: ContentStat[]): ContentSummary {
  const count = stats.length;
  const sum = (f: (s: ContentStat) => number) => stats.reduce((a, s) => a + f(s), 0);
  const views = sum((s) => s.views);
  return {
    count,
    views,
    likes: sum((s) => s.likes),
    comments: sum((s) => s.comments),
    shares: sum((s) => s.shares),
    avgViews: count ? round(views / count, 1) : 0,
    avgEngagement: count ? round(sum(engagementRate) / count) : 0,
  };
}

// ── Dimenzió-bontás („melyik hook/thumbnail/template működik?") ────────────────

export type ContentDimension = 'platform' | 'hook' | 'thumbnail' | 'template';

export interface DimensionStat {
  key: string;
  count: number;
  views: number;
  avgViews: number;
  avgEngagement: number;
}

/**
 * Bontás egy dimenzió szerint (platform/hook/thumbnail/template), az átlagos
 * engagement szerint CSÖKKENŐEN rangsorolva → a legjobban teljesítő variáns elöl.
 * Az adott dimenzió nélküli statok kimaradnak.
 */
export function breakdownBy(stats: ContentStat[], dim: ContentDimension): DimensionStat[] {
  const groups = new Map<string, ContentStat[]>();
  for (const s of stats) {
    const key = s[dim];
    if (typeof key !== 'string' || !key) {
      continue;
    }
    const g = groups.get(key);
    if (g) {
      g.push(s);
    } else {
      groups.set(key, [s]);
    }
  }
  const out: DimensionStat[] = [];
  for (const [key, g] of groups) {
    const sum = summarize(g);
    out.push({ key, count: g.length, views: sum.views, avgViews: sum.avgViews, avgEngagement: sum.avgEngagement });
  }
  return out.sort((a, b) => b.avgEngagement - a.avgEngagement || b.avgViews - a.avgViews);
}

// ── Top-teljesítők ────────────────────────────────────────────────────────────

export type PerfMetric = 'views' | 'engagement' | 'retention';

function metricValue(s: ContentStat, metric: PerfMetric): number {
  if (metric === 'views') {
    return s.views;
  }
  if (metric === 'engagement') {
    return engagementRate(s);
  }
  return retentionRate(s) ?? 0;
}

export function topPerformers(stats: ContentStat[], metric: PerfMetric, n = 5): ContentStat[] {
  return [...stats].sort((a, b) => metricValue(b, metric) - metricValue(a, metric)).slice(0, n);
}

// ── „Miért működött ez jobban?" ───────────────────────────────────────────────

export interface PerformanceInsight {
  factor: PerfMetric;
  /** a stat értéke a metrikán */
  value: number;
  /** eltérés a mezőny átlagától, arányban (+0.4 = +40%) */
  delta: number;
}

/**
 * Egy tartalom teljesítmény-magyarázata: az engagement/views/retention eltérése
 * a MEZŐNY átlagától, |delta| szerint csökkenően (a legnagyobb kiugrás elöl).
 * Az AI-nak nyers alapanyag a „miért működött jobban?" válaszhoz.
 */
export function whyItWorked(stat: ContentStat, population: ContentStat[]): PerformanceInsight[] {
  const metrics: PerfMetric[] = ['engagement', 'views', 'retention'];
  const insights: PerformanceInsight[] = [];
  for (const m of metrics) {
    const vals = population.map((s) => metricValue(s, m)).filter((v) => v > 0);
    if (vals.length === 0) {
      continue;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const value = metricValue(stat, m);
    if (mean <= 0) {
      continue;
    }
    insights.push({ factor: m, value: round(value), delta: round((value - mean) / mean, 3) });
  }
  return insights.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// ── Produktivitás + workflow-időzítés ────────────────────────────────────────

export interface EditSession {
  projectId: string;
  seconds: number;
  /** ISO nap (a napi bontáshoz a YYYY-MM-DD-t használja) */
  date: string;
}

export interface ProductivitySummary {
  totalSec: number;
  byProject: Record<string, number>;
  byDay: Record<string, number>;
}

/** „Mennyit szerkesztettem?" — összes + projektenkénti + napi bontás. */
export function productivity(sessions: EditSession[]): ProductivitySummary {
  const byProject: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let totalSec = 0;
  for (const s of sessions) {
    totalSec += s.seconds;
    byProject[s.projectId] = (byProject[s.projectId] ?? 0) + s.seconds;
    const day = s.date.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + s.seconds;
  }
  return { totalSec, byProject, byDay };
}

export interface StepTiming {
  kind: string;
  ms: number;
}

export interface StepShare {
  kind: string;
  ms: number;
  /** a teljes idő aránya (0–1) */
  share: number;
}

/** „Melyik workflow-lépés lassú?" — lépés-típusonként összegzett idő, arány szerint. */
export function slowestSteps(timings: StepTiming[], n = 3): StepShare[] {
  const byKind = new Map<string, number>();
  let total = 0;
  for (const t of timings) {
    byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + t.ms);
    total += t.ms;
  }
  return [...byKind.entries()]
    .map(([kind, ms]) => ({ kind, ms, share: total ? round(ms / total, 3) : 0 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, n);
}
