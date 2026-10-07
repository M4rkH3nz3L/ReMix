/**
 * 🎚️ A/V-szinkron mag (CORE §2.6) — a lejátszófejhez tartozó FORRÁS-idő egy
 * média-klipen, és a drift-korrekció döntése. Pure → headless tesztelhető (nincs
 * RN-render). A preview audio-rétegek EBBŐL a közös pontból seek-elnek (egységes
 * seek-pont), és a lejátszás közbeni elcsúszást a `shouldResync` küszöbe fogja meg.
 */

/**
 * A lejátszófejhez tartozó forrás-idő (mp) egy klipen belül: `trimIn + (playhead -
 * start)`, 0-ra vágva (a klip előtti playhead nem ad negatív forrás-időt). Hang-
 * klipekre (sebesség nélkül); a videó forrás-ideje a `sourceTimeAt` (speed/reversed).
 */
export function sourceTimeOf(clip: { start: number; trimIn?: number }, playhead: number): number {
  return Math.max(0, (clip.trimIn ?? 0) + (playhead - clip.start));
}

/**
 * A drift-korrekció küszöbe (mp). Ekkora eltérés FÖLÖTT tekerünk vissza a
 * szinkronhoz lejátszás közben; alatta hagyjuk a natív lejátszót szabadon futni
 * (a korrekciós seek hallható lehet, ezért csak érdemi elcsúszásnál). ~¼ mp a
 * legkisebb, ami már észrevehető, de még nem ad folyamatos ugrálást a JS-jank-en.
 */
export const DRIFT_THRESHOLD_SEC = 0.25;

/**
 * Igaz, ha a lejátszó TÉNYLEGES ideje ennyire elcsúszott az ELVÁRT-tól → resync
 * kell (a mestéróra és a natív hang-lejátszó közti drift behúzása).
 */
export function shouldResync(
  expectedSec: number,
  actualSec: number,
  thresholdSec: number = DRIFT_THRESHOLD_SEC
): boolean {
  return Math.abs(expectedSec - actualSec) > thresholdSec;
}
