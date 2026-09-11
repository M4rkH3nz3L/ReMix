import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { ensureCloud } from '@/lib/backend';
import { formatRuler } from '@/lib/time';
import { fetchShotScores } from '@/lib/shotScore';
import type { VideoClip, Project } from '@/types/project';

/**
 * 🔍 Felvétel-minőség ellenőrzés (Phase 1.5): a videóklipek reprezentatív
 * kockáit a worker /shotscore végpontja pontozza (élesség+kontraszt = `score`,
 * átlag-fényerő = `luma`). Ebből jelöljük a HOMÁLYOS/lágy (a projekt-mediánhoz
 * képest jóval alacsonyabb score) és az ALUL-/TÚLexponált (szélső luma)
 * klipeket. Determinisztikus, egy /shotscore hívás fájlonként.
 *
 * Pro-funkció: `ensureCloud('qualityScan')`. Best-effort: web / worker nélkül null.
 */

export type QualityKind = 'blurry' | 'dark' | 'bright';

export interface QualityIssue {
  /** a klip kezdete az idővonalon (mp) — a summary-hoz */
  start: number;
  kind: QualityKind;
}

export interface QualityReport {
  issues: QualityIssue[];
  summary: string;
}

const DARK_LUMA = 0.14;
const BRIGHT_LUMA = 0.86;
/** homályos, ha a klip mediánja a projekt-medián ennyiszerese ALATT van */
const BLUR_RATIO = 0.5;

const median = (xs: number[]): number => {
  if (xs.length === 0) {
    return 0;
  }
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Felvétel-minőség ellenőrzés. `null`, ha nincs értékelhető jel (web / worker nélkül). */
export async function analyzeQuality(project: Project): Promise<QualityReport | null> {
  ensureCloud('qualityScan'); // Pro-kapu a felhő-jelek előtt
  if (Platform.OS === 'web') {
    return null;
  }
  const videoClips = project.tracks
    .filter((tk) => tk.type === 'video')
    .flatMap((tk) => tk.clips)
    .filter((c): c is VideoClip => c.kind === 'video');
  if (videoClips.length === 0) {
    return null;
  }

  // fájlonként egy hívás: az adott uri-t használó klipek forrás-időből vett
  // mintapontjai (klipenként ~4, összesen max 24 / fájl)
  const uris = [...new Set(videoClips.map((c) => c.uri))];
  const scoresByUri = new Map<string, { t: number; score: number; luma: number }[]>();
  for (const uri of uris) {
    const clips = videoClips.filter((c) => c.uri === uri);
    const times: number[] = [];
    for (const c of clips) {
      const win = c.duration * c.speed;
      for (let k = 1; k <= 4; k++) {
        times.push(Math.round((c.trimIn + (win * k) / 5) * 100) / 100);
      }
    }
    const shots = await fetchShotScores(uri, times);
    if (shots) {
      scoresByUri.set(
        uri,
        shots.map((s) => ({ t: s.t, score: s.score, luma: typeof s.luma === 'number' ? s.luma : 0.5 }))
      );
    }
  }
  if (scoresByUri.size === 0) {
    return null;
  }

  const allScores = [...scoresByUri.values()].flat().map((s) => s.score);
  const projMedian = median(allScores);

  const issues: QualityIssue[] = [];
  for (const c of videoClips) {
    const shots = scoresByUri.get(c.uri) ?? [];
    const winStart = c.trimIn;
    const winEnd = c.trimIn + c.duration * c.speed;
    const inWin = shots.filter((s) => s.t >= winStart && s.t <= winEnd);
    if (inWin.length === 0) {
      continue;
    }
    const luma = median(inWin.map((s) => s.luma));
    const score = median(inWin.map((s) => s.score));
    if (luma < DARK_LUMA) {
      issues.push({ start: c.start, kind: 'dark' });
    } else if (luma > BRIGHT_LUMA) {
      issues.push({ start: c.start, kind: 'bright' });
    }
    // homály csak akkor megbízható, ha van értelmes projekt-medián (≥3 klip)
    if (videoClips.length >= 3 && projMedian > 0 && score < BLUR_RATIO * projMedian) {
      issues.push({ start: c.start, kind: 'blurry' });
    }
  }

  issues.sort((a, b) => a.start - b.start);
  return { issues, summary: buildSummary(issues) };
}

function buildSummary(issues: QualityIssue[]): string {
  if (issues.length === 0) {
    return tr('panels.assistant.footageGood');
  }
  const lines = issues
    .slice(0, 8)
    .map((i) => `• ${formatRuler(i.start)} — ${tr('panels.assistant.qkind_' + i.kind)}`);
  return `${tr('panels.assistant.footageFlagged', { count: issues.length })}\n${lines.join('\n')}`;
}
