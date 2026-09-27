import { addFact, type CreatorMemory } from '@/lib/creatorMemory';
import { breakdownBy, summarize, type ContentDimension, type ContentStat, type DimensionStat } from '@/lib/analytics';

/**
 * 🔁 Retention loop (E-Loop — MASTER §27) — a „függővé tétel" zárt köre:
 * CREATE → SAVE → SHARE → PUBLISH → ANALYZE → **AI LEARNS** → CREATE BETTER. A
 * remix + feed + AI-context már megvan; a hiány a ZÁRT KÖR + analytics-vissza-
 * csatolás. Ez a mag köti össze az [analytics](./analytics) teljesítmény-adatot a
 * [creatorMemory](./creatorMemory) perzisztens tudásával (az „AI LEARNS" lépés).
 *
 * Tiszta, expo-mentes, determinisztikus (`now`-paraméterrel).
 */

// ── Loop-fázisok ──────────────────────────────────────────────────────────────

export const LOOP_STAGES = ['create', 'save', 'share', 'publish', 'analyze', 'learn'] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

export interface LoopSignals {
  saved?: boolean;
  shared?: boolean;
  published?: boolean;
  analyzed?: boolean;
  learned?: boolean;
}

/** A legtávolabb elért loop-fázis a jelekből (create mindig teljesült). */
export function loopStageOf(s: LoopSignals): LoopStage {
  if (s.learned) {
    return 'learn';
  }
  if (s.analyzed) {
    return 'analyze';
  }
  if (s.published) {
    return 'publish';
  }
  if (s.shared) {
    return 'share';
  }
  if (s.saved) {
    return 'save';
  }
  return 'create';
}

/** A loop előrehaladása 0–1 (a fázis indexe a láncban). */
export function loopProgress(s: LoopSignals): number {
  const i = LOOP_STAGES.indexOf(loopStageOf(s));
  return Math.round((i / (LOOP_STAGES.length - 1)) * 100) / 100;
}

// ── Analytics → tanulság ──────────────────────────────────────────────────────

export interface LoopInsight {
  dimension: ContentDimension;
  best: DimensionStat;
  /** a legjobb variáns engagement-je a mezőny átlagához képest (1.5 = +50%) */
  lift: number;
}

export interface InsightOptions {
  /** a győztes variáns minimális mintaszáma (különben nem tanulunk belőle) */
  minSamples?: number;
  /** mely dimenziókból tanuljon */
  dimensions?: ContentDimension[];
}

/**
 * Mit tanulhatunk a teljesítmény-adatból: dimenziónként (hook/thumbnail/template/
 * platform) a legjobb variáns, HA elég mintája van ÉS ténylegesen a mezőny-átlag
 * FÖLÖTT teljesít (lift > 1). Az AI-visszacsatolás nyers alapanyaga.
 */
export function analyticsInsights(stats: ContentStat[], opts: InsightOptions = {}): LoopInsight[] {
  const minSamples = opts.minSamples ?? 2;
  const dims = opts.dimensions ?? (['hook', 'thumbnail', 'template', 'platform'] as ContentDimension[]);
  const overall = summarize(stats).avgEngagement;
  const out: LoopInsight[] = [];
  for (const dimension of dims) {
    const groups = breakdownBy(stats, dimension);
    if (groups.length < 2) {
      continue; // nincs mihez hasonlítani
    }
    const best = groups[0];
    if (best.count < minSamples || overall <= 0 || best.avgEngagement <= overall) {
      continue;
    }
    out.push({ dimension, best, lift: Math.round((best.avgEngagement / overall) * 100) / 100 });
  }
  return out.sort((a, b) => b.lift - a.lift);
}

/** i18n-kulcs helyett rövid, olvasható tény (a memóriába + a UI-ra). */
function insightText(i: LoopInsight): string {
  return `A legjobban teljesítő ${i.dimension}: "${i.best.key}" (átlag engagement ${i.best.avgEngagement}, ${i.lift}×)`;
}

/**
 * „AI LEARNS": a teljesítmény-tanulságokat a Creator Memory `workflow`-tényeivé
 * alakítja. Stabil kulcs (`analytics:<dimension>`) → az ismételt tanulás
 * MEGERŐSÍT, nem duplikál (a `creatorMemory.addFact` dedup-ja). A súly a lift-ből.
 * Így a következő „CREATE" már a tudással indul → CREATE BETTER.
 */
export function learnFromAnalytics(
  memory: CreatorMemory,
  stats: ContentStat[],
  opts: InsightOptions = {},
  now = new Date().toISOString()
): CreatorMemory {
  let next = memory;
  for (const i of analyticsInsights(stats, opts)) {
    next = addFact(
      next,
      {
        category: 'workflow',
        key: `analytics:${i.dimension}`,
        text: insightText(i),
        weight: Math.min(1, 0.4 + (i.lift - 1)),
      },
      now
    );
  }
  return next;
}
