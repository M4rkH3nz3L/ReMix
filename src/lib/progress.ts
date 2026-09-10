/**
 * ⏳ Progressz-modell — minden hosszú műveletnek EGY közös nyelve.
 *
 * MIÉRT: eddig minden loader csak egy szöveget mutatott („Renderelés…") vagy
 * egy végtelen pörgő spinnert. A felhasználó nem tudta, hogy MIT csinál a gép,
 * MENNYI van hátra, és MEDDIG fog tartani — ettől tűnik „beragadtnak" egy
 * teljesen egészséges 2 perces render is.
 *
 * Itt egy művelet ezt jelenti:
 *   • `phase`   — mit csinál ÉPPEN (Feltöltés / Renderelés / Letöltés)
 *   • `ratio`   — hol tart (0–1), ha mérhető
 *   • `current`/`total` — hányadik hányból (pl. 3/8 klip)
 *   • `etaSec`  — becsült hátralévő idő, a MEGFIGYELT tempóból számolva
 *
 * Az ETA nem jóslás: a tényleges előrehaladás sebességéből extrapolál, és
 * simítja, hogy ne ugráljon. Ha még nincs elég adat, inkább NEM mutat ETA-t,
 * mint hogy hazudjon egyet.
 */
import { t as tr } from 'i18next';

export interface ProgressUpdate {
  /** mit csinál épp — a felhasználónak mutatott fázisnév */
  phase: string;
  /** 0–1 közti előrehaladás, ha mérhető (különben határozatlan a sáv) */
  ratio?: number;
  /** hányadik elem (1-alapú) — pl. 3 a „3/8 klip"-ből */
  current?: number;
  /** összes elem — pl. 8 */
  total?: number;
  /** a darabszám mértékegysége: „klip", „fájl", „videó" */
  unit?: string;
}

export interface ProgressSnapshot {
  phase: string;
  /** 0–1, vagy `null` ha határozatlan */
  ratio: number | null;
  current: number | null;
  total: number | null;
  unit: string | null;
  /** becsült hátralévő másodperc, vagy `null` ha még nem megbízható */
  etaSec: number | null;
  /** eltelt másodperc a művelet indulása óta */
  elapsedSec: number;
  indeterminate: boolean;
}

/** ennyi mp és ennyi haladás kell, mielőtt ETA-t merünk mutatni */
const ETA_MIN_ELAPSED_SEC = 2;
const ETA_MIN_RATIO = 0.02;
/**
 * A SEBESSÉGET simítjuk, nem az ETA-t (EMA: 0 = nincs simítás, 1 = befagy).
 *
 * MIÉRT: az ETA természeténél fogva csökken, így ha azt simítjuk, a becslés
 * tartósan a valóság FÖLÖTT ragad — a végén „még ~44 mp", amikor már csak 20
 * van hátra. A sebesség viszont nagyjából állandó, ezért azt simítani stabil
 * ÉS pontos: a hátralévő idő mindig a friss arányból számolódik.
 */
const RATE_SMOOTHING = 0.5;
/** ennyi minta alapján számolunk sebességet (csúszó ablak) */
const SAMPLE_WINDOW = 8;

interface Sample {
  t: number;
  ratio: number;
}

/**
 * Egy művelet előrehaladás-követője. A `report()`-ot hívja a művelet, a
 * `snapshot()` adja a UI-nak a kész állapotot (ETA-val együtt).
 */
export class ProgressTracker {
  private readonly startedAt: number;
  private samples: Sample[] = [];
  private smoothedRate: number | null = null;
  private last: ProgressUpdate = { phase: '' };

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  report(update: ProgressUpdate): void {
    this.last = update;
    const ratio = normalizeRatio(update);
    if (ratio != null) {
      const t = this.now();
      const prev = this.samples[this.samples.length - 1];
      // csak előre haladó, értelmes mintát tartunk meg
      if (!prev || ratio > prev.ratio) {
        this.samples.push({ t, ratio });
        if (this.samples.length > SAMPLE_WINDOW) {
          this.samples.shift();
        }
      }
    }
  }

  snapshot(): ProgressSnapshot {
    const ratio = normalizeRatio(this.last);
    const elapsedSec = (this.now() - this.startedAt) / 1000;
    return {
      phase: this.last.phase,
      ratio,
      current: this.last.current ?? null,
      total: this.last.total ?? null,
      unit: this.last.unit ?? null,
      etaSec: this.estimateEta(ratio, elapsedSec),
      elapsedSec,
      indeterminate: ratio == null,
    };
  }

  /**
   * Hátralévő idő a MEGFIGYELT tempóból: a csúszó ablak első és utolsó mintája
   * közti sebesség (Δratio/Δt). A SEBESSÉG megy át EMA-simításon (hogy ne
   * villogjon), az idő pedig mindig a FRISS arányból számolódik — így a becslés
   * stabil, de a végén helyesen nullához tart.
   */
  private estimateEta(ratio: number | null, elapsedSec: number): number | null {
    if (ratio != null && ratio >= 1) {
      return 0;
    }
    if (ratio == null) {
      return null;
    }
    if (elapsedSec < ETA_MIN_ELAPSED_SEC || ratio < ETA_MIN_RATIO) {
      return null; // még nincs elég adat — ne találjunk ki számot
    }
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || last.t <= first.t || last.ratio <= first.ratio) {
      return null;
    }
    const rate = (last.ratio - first.ratio) / ((last.t - first.t) / 1000);
    if (!Number.isFinite(rate) || rate <= 0) {
      return null;
    }
    this.smoothedRate =
      this.smoothedRate == null
        ? rate
        : this.smoothedRate * RATE_SMOOTHING + rate * (1 - RATE_SMOOTHING);
    if (this.smoothedRate <= 0) {
      return null;
    }
    const eta = (1 - ratio) / this.smoothedRate;
    // 24 óránál hosszabb becslés értelmetlen (induláskori zaj)
    return Number.isFinite(eta) && eta >= 0 && eta <= 86400 ? eta : null;
  }
}

/**
 * Az arány kinyerése: elsődlegesen az explicit `ratio`, különben a
 * `current/total` párosból. Mindig 0–1 közé vágva.
 */
function normalizeRatio(u: ProgressUpdate): number | null {
  if (typeof u.ratio === 'number' && Number.isFinite(u.ratio)) {
    return Math.min(1, Math.max(0, u.ratio));
  }
  if (
    typeof u.current === 'number' &&
    typeof u.total === 'number' &&
    u.total > 0
  ) {
    return Math.min(1, Math.max(0, u.current / u.total));
  }
  return null;
}

/** „~1 p 20 mp" alakú, emberi hátralévő idő. */
export function formatEta(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) {
    return null;
  }
  const s = Math.round(sec);
  if (s < 5) {
    return tr('lib.progress.etaAlmostDone');
  }
  if (s < 60) {
    return tr('lib.progress.etaSeconds', { seconds: s });
  }
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) {
    return rest > 0
      ? tr('lib.progress.etaMinutesSeconds', { minutes: m, seconds: rest })
      : tr('lib.progress.etaMinutes', { minutes: m });
  }
  const h = Math.floor(m / 60);
  return tr('lib.progress.etaHoursMinutes', { hours: h, minutes: m % 60 });
}

/** „3/8 klip" alakú darabszám-jelzés (ha van). */
export function formatCount(s: ProgressSnapshot): string | null {
  if (s.current == null || s.total == null || s.total <= 0) {
    return null;
  }
  return `${s.current}/${s.total}${s.unit ? ` ${s.unit}` : ''}`;
}

/** „42%" — a sávhoz tartozó szám. */
export function formatPercent(ratio: number | null): string | null {
  return ratio == null ? null : `${Math.round(ratio * 100)}%`;
}

/**
 * Több-lépcsős művelet: a részfázisok arányait EGY 0–1 skálára vetíti, hogy a
 * sáv sose ugorjon vissza. A súlyok a fázisok becsült időarányai.
 *
 *   const stages = weightedStages([['Feltöltés', 0.2], ['Renderelés', 0.7], ['Letöltés', 0.1]]);
 *   stages.ratioFor('Renderelés', 0.5)  // → 0.2 + 0.7*0.5 = 0.55
 */
export function weightedStages(stages: [string, number][]): {
  ratioFor: (phase: string, innerRatio: number) => number;
} {
  const total = stages.reduce((sum, [, w]) => sum + w, 0) || 1;
  const offsets = new Map<string, { start: number; weight: number }>();
  let acc = 0;
  for (const [name, w] of stages) {
    offsets.set(name, { start: acc / total, weight: w / total });
    acc += w;
  }
  return {
    ratioFor: (phase, innerRatio) => {
      const o = offsets.get(phase);
      if (!o) {
        return Math.min(1, Math.max(0, innerRatio));
      }
      const inner = Math.min(1, Math.max(0, innerRatio));
      return Math.min(1, o.start + o.weight * inner);
    },
  };
}
