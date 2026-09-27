/**
 * 🎮 Gamer auto-highlight mag (S-GAMER — MASTER §8) — a „best-moments" logika
 * JEL-alapon (nem beszéd-alapon, ami gamernél kevés): audio-energia-csúcs +
 * jelenet-váltás + gameplay-markerek (kill/death/round) → pontozott highlight-
 * pillanatok → szegmensek → **montázs** cél-hosszra (pl. 30 mp TikTok).
 *
 * Tiszta, expo-mentes, determinisztikus — a command-buszra képezhető AI-parancsok
 * („mutasd az összes killt", „30 mp montázs", „legjobb clutch") ezt hívják. Az
 * energia-blokk formátuma a [beats.ts](./beats) `BeatGrid.energy`-jével egyezik.
 */

export type GameMarkerKind = 'kill' | 'death' | 'round' | 'clip' | 'custom';

export interface GameMarker {
  time: number;
  kind: GameMarkerKind;
  label?: string;
}

/** marker-típus → alap-fontosság a highlight-pontozáshoz. */
const MARKER_WEIGHT: Record<GameMarkerKind, number> = {
  kill: 1.0,
  clip: 0.9,
  round: 0.6,
  death: 0.4,
  custom: 0.5,
};

export interface HighlightSignals {
  /** teljes hossz (mp) */
  duration: number;
  /** 0–1 normalizált energia-blokkok (mint `BeatGrid.energy`) */
  energy?: number[];
  /** egy energia-blokk hossza mp-ben (alap: 0.5, mint a beats.ts) */
  blockSec?: number;
  /** jelenet-váltások időpontjai (mp) */
  sceneChanges?: number[];
  /** gameplay-markerek */
  markers?: GameMarker[];
}

export interface HighlightMoment {
  time: number;
  score: number;
  /** mi tette azzá: 'audio' | 'scene' | a marker-típus(ok) */
  reasons: string[];
}

export interface HighlightSegment {
  start: number;
  end: number;
  score: number;
  reasons: string[];
}

export interface DetectOptions {
  /** az egy pillanattá összevont jelöltek max. távolsága (mp) */
  mergeSec?: number;
  /** ennél kisebb összpontszámú pillanatok kiesnek */
  minScore?: number;
  /** audio-csúcs küszöb-szigor (mean + peakK*std) */
  peakK?: number;
}

interface Candidate {
  time: number;
  score: number;
  reason: string;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[], m: number): number =>
  xs.length ? Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length) : 0;

/** Audio-energia lokális csúcsai küszöb fölött → jelöltek. */
function energyPeaks(energy: number[], blockSec: number, peakK: number): Candidate[] {
  if (energy.length < 3) {
    return [];
  }
  const m = mean(energy);
  const threshold = m + peakK * std(energy, m);
  const out: Candidate[] = [];
  for (let i = 0; i < energy.length; i++) {
    const prev = i > 0 ? energy[i - 1] : -Infinity;
    const next = i < energy.length - 1 ? energy[i + 1] : -Infinity;
    if (energy[i] >= threshold && energy[i] > prev && energy[i] >= next) {
      out.push({ time: i * blockSec + blockSec / 2, score: energy[i], reason: 'audio' });
    }
  }
  return out;
}

/**
 * Highlight-pillanatok detektálása a jelekből. A közeli jelölteket (audio/scene/
 * marker) EGY pillanattá vonja össze (pontszám-összeg, indok-unió) — a klaszterek
 * (egyszerre kill + audio-csúcs + vágás) így magasabb pontot kapnak.
 */
export function detectHighlights(signals: HighlightSignals, opts: DetectOptions = {}): HighlightMoment[] {
  const mergeSec = opts.mergeSec ?? 1.5;
  const minScore = opts.minScore ?? 0.5;
  const peakK = opts.peakK ?? 0.75;
  const blockSec = signals.blockSec ?? 0.5;

  const candidates: Candidate[] = [];
  if (signals.energy && signals.energy.length) {
    candidates.push(...energyPeaks(signals.energy, blockSec, peakK));
  }
  for (const s of signals.sceneChanges ?? []) {
    candidates.push({ time: s, score: 0.3, reason: 'scene' });
  }
  for (const mk of signals.markers ?? []) {
    candidates.push({ time: mk.time, score: MARKER_WEIGHT[mk.kind], reason: mk.kind });
  }
  candidates.sort((a, b) => a.time - b.time);

  const moments: HighlightMoment[] = [];
  for (const c of candidates) {
    const last = moments[moments.length - 1];
    if (last && c.time - last.time <= mergeSec) {
      // súlyozott idő-átlag + pontszám-összeg + indok-unió
      const total = last.score + c.score;
      last.time = Math.round(((last.time * last.score + c.time * c.score) / total) * 1000) / 1000;
      last.score = Math.round(total * 1000) / 1000;
      if (!last.reasons.includes(c.reason)) {
        last.reasons.push(c.reason);
      }
    } else {
      moments.push({ time: c.time, score: c.score, reasons: [c.reason] });
    }
  }
  return moments.filter((m) => m.score >= minScore).sort((a, b) => a.time - b.time);
}

export interface SegmentOptions {
  /** a pillanat elé/mögé vett idő (mp) */
  preSec?: number;
  postSec?: number;
}

/** Pillanatok → klip-szegmensek (pre/post kerettel), az átfedők összevonva. */
export function momentsToSegments(
  moments: HighlightMoment[],
  duration: number,
  opts: SegmentOptions = {}
): HighlightSegment[] {
  const pre = opts.preSec ?? 3;
  const post = opts.postSec ?? 2;
  const raw = moments
    .map((m) => ({
      start: Math.max(0, m.time - pre),
      end: Math.min(duration, m.time + post),
      score: m.score,
      reasons: [...m.reasons],
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const merged: HighlightSegment[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      last.score = Math.round((last.score + s.score) * 1000) / 1000;
      for (const r of s.reasons) {
        if (!last.reasons.includes(r)) {
          last.reasons.push(r);
        }
      }
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

export interface MontagePlan {
  segments: HighlightSegment[];
  totalSec: number;
}

export interface MontageOptions {
  /** a cél-hosszhoz vágja-e az utolsó szegmenst (alap: igen) */
  trimToTarget?: boolean;
  /** a legrövidebb megtartható szegmens (mp) trimmeléskor */
  minSegmentSec?: number;
}

const segLen = (s: HighlightSegment): number => s.end - s.start;

/**
 * Montázs a legütősebb szegmensekből cél-hosszra: pontszám szerint mohón válogat
 * a `targetSec` eléréséig, majd IDŐREND szerint rendez (a lejátszás előrehaladjon).
 * `trimToTarget` esetén az utolsó (időrendi) szegmenst a cél-hosszra vágja.
 */
export function buildMontage(
  segments: HighlightSegment[],
  targetSec: number,
  opts: MontageOptions = {}
): MontagePlan {
  const trim = opts.trimToTarget ?? true;
  const minSeg = opts.minSegmentSec ?? 1;
  const byScore = [...segments].sort((a, b) => b.score - a.score);
  const chosen: HighlightSegment[] = [];
  let total = 0;
  for (const s of byScore) {
    if (total >= targetSec) {
      break;
    }
    chosen.push(s);
    total += segLen(s);
  }
  chosen.sort((a, b) => a.start - b.start);

  if (trim && total > targetSec && chosen.length > 0) {
    const over = total - targetSec;
    const last = chosen[chosen.length - 1];
    if (segLen(last) - over >= minSeg) {
      chosen[chosen.length - 1] = { ...last, end: Math.round((last.end - over) * 1000) / 1000 };
      total = targetSec;
    }
  }
  return { segments: chosen, totalSec: Math.round(total * 1000) / 1000 };
}

/** Szűrés marker-típusra („mutasd az összes killt"). */
export function filterByMarker(markers: GameMarker[], kind: GameMarkerKind): GameMarker[] {
  return markers.filter((m) => m.kind === kind);
}
