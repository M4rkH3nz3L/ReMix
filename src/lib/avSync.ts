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

/**
 * 🎚️ Tanuló szinkron-korrekció (PRO-AUDIO 17/5). Mérve iPaden (2026-11-04): a hang
 * ~0,2 mp-cel ÁLLANDÓAN a lejátszófej mögött járt (az indítási késés benne ragadt), és mivel
 * ez a 0,25-ös küszöb alatt van, sosem javult. Most:
 *  • 40 ms a tűrés (a szájszinkron határa ~45 ms);
 *  • a seek maga is késik (újra-pufferel) — az igazítás után maradó eltérés felét a
 *    következő igazítás előre-célzással kompenzálja (`comp`, legfeljebb ±0,5 mp);
 *  • két igazítás közt legalább 0,6 mp (nincs ugrálás).
 * ⚠️ A sebesség-állításos (playbackRate) korrekciót kipróbáltuk: az iOS-lejátszón minden
 * sebesség-váltás leállást okoz, az eltérés 1,3–1,7 mp-ig nőtt — nem használható.
 */
export const SYNC_TOLERANCE_SEC = 0.04;
export const MIN_SEEK_GAP_MS = 600;
const MAX_COMP_SEC = 0.5;

export interface DriftState {
  /** a tanult előre-célzás (mp) */
  comp: number;
  lastSeekMs: number;
  seeks: number;
}

export const INITIAL_DRIFT: DriftState = { comp: 0, lastSeekMs: -Infinity, seeks: 0 };

export function planDriftCorrection(
  st: DriftState,
  expectedSec: number,
  actualSec: number,
  nowMs: number
): { seekTo: number | null; next: DriftState } {
  const drift = expectedSec - actualSec;
  if (Math.abs(drift) <= SYNC_TOLERANCE_SEC || nowMs - st.lastSeekMs < MIN_SEEK_GAP_MS) {
    return { seekTo: null, next: st };
  }
  // csillapítva (a felét tanulja): a seek-késés ingadozik, a teljes átvétel túllövést adott
  const comp = st.seeks > 0 ? Math.max(-MAX_COMP_SEC, Math.min(MAX_COMP_SEC, st.comp + drift * 0.5)) : st.comp;
  return {
    seekTo: Math.max(0, expectedSec + comp),
    next: { comp, lastSeekMs: nowMs, seeks: st.seeks + 1 },
  };
}

/**
 * ⏱️ Preroll: a klip lejátszója ennyivel a kezdete ELŐTT létrejön, betölt és a forrás
 * elejére áll (szünetben). Mérve (iPad): preroll nélkül a lejátszás közben induló klip
 * ~200 ms késéssel szólalt meg — a betöltés ideje a hangba került.
 */
export const PREROLL_SEC = 1.5;

/** A lejátszóhoz tartozó klipek: a most szólók + az `PREROLL_SEC`-en belül kezdődők. */
export function clipsForPlayback<T extends { start: number; duration: number }>(clips: T[], t: number, preroll = PREROLL_SEC): T[] {
  return clips.filter((c) => c.start - preroll <= t && t < c.start + c.duration);
}

/**
 * ⏱️ Indítási késés: az iOS-lejátszó a `play()` után ~0,2 mp-ig áll, mielőtt valóban szól
 * (mérve iPaden; minden indulásnál újra jelentkezik). Eszköz-szintű érték, ezért a lejátszók
 * közösen tanulják: az első korrekció mért eltéréséből, csúszó átlaggal (0–0,5 mp).
 */
export function learnStartLatency(prevSec: number, observedSec: number): number {
  const next = prevSec === 0 ? observedSec : prevSec * 0.5 + observedSec * 0.5;
  return Math.max(0, Math.min(0.5, next));
}

