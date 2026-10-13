/**
 * ✂️ YT/TikTok import -tól–-ig tartomány (TECH-TOP §6) — pure + tesztelt.
 *
 * Az importnál a user megadhatja, MEDDIG-MEDDIG töltsük be a videót; a tartomány
 * normalizálva: 0 ≤ from < to, to ≤ forrás-hossz (ha ismert), és a hossz ≤ MAX (alap
 * 10 perc — a globális videó-plafon). Túllépésnél a `to`-t vágjuk `from + max`-ra.
 */
import { MAX_PROJECT_DURATION_SEC } from './projectUtils';

export interface ImportRange {
  fromSec: number;
  toSec: number;
  durationSec: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export function clampImportRange(
  fromSec: number,
  toSec: number,
  sourceDurationSec?: number,
  maxSec: number = MAX_PROJECT_DURATION_SEC
): ImportRange {
  const max = Math.max(1, Number.isFinite(maxSec) ? maxSec : MAX_PROJECT_DURATION_SEC);
  const source =
    Number.isFinite(sourceDurationSec) && (sourceDurationSec as number) > 0
      ? (sourceDurationSec as number)
      : Infinity;

  let from = Number.isFinite(fromSec) ? Math.max(0, fromSec) : 0;
  if (from >= source) {
    from = 0; // a kezdő a forráson kívül → vissza az elejére
  }

  let to = Number.isFinite(toSec) ? toSec : Math.min(source, from + max);
  to = Math.min(to, source); // forrás-hossz plafon
  if (to <= from) {
    to = Math.min(source, from + max); // érvénytelen tartomány → alap-ablak
  }
  if (to - from > max) {
    to = from + max; // 10 perc-plafon
  }

  return { fromSec: round(from), toSec: round(to), durationSec: round(to - from) };
}
