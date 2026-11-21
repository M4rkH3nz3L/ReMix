/**
 * 🎥 Az in-app kamera-felvevő (src/components/editor/CameraRecorder.tsx) tiszta, expo-mentes
 * magja: a korlátok, a sebesség-presetek és a felvétel idő-számításai. A komponensből
 * kiemelve (REFACTOR) — a viselkedés változatlan.
 */

export const MAX_SEC = 60; // short-video felső korlát (auto-stop)
export const SPEEDS = [0.5, 1, 2, 3] as const;

/** a felvételi idő kijelzése: `m:ss` (lefelé kerekítve) */
export function formatRecordTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** a felvett forrás hossza: tizedmásodpercre kerekítve, legalább 0,5 mp */
export function recordedSourceDuration(recorded: number): number {
  return Math.max(0.5, Math.round(recorded * 10) / 10);
}

/** a klip idővonal-hossza a sebességgel (2× → fele annyi idő), legalább 0,3 mp */
export function clipTimelineDuration(src: number, speed: number): number {
  return Math.max(0.3, src / speed);
}

/** a 3-2-1 visszaszámlálóból hátralévő egész másodperc (≤ 0 → indulhat a felvétel) */
export function countdownLeft(t0: number, now: number): number {
  return 3 - Math.floor((now - t0) / 1000);
}
