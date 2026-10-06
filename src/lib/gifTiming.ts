/**
 * 🖼️ GIF-időzítés (audit §6.8) — tiszta, expo-mentes.
 *
 * Egy animált GIF változó kocka-késleltetéssel játszik. A projekt EGY rAF-mesteróra
 * köré épül (AGENTS.md): minden időzített réteg a playheadből számol, nem saját
 * órából. Ez a mag a GIF-klip playhead-idejéből kiszámolja a MEGJELENÍTENDŐ kockát
 * (loop-aware) — a preview ezt rajzolja, a dekódolás/render külön (natív/ffmpeg).
 */

export interface GifFrame {
  /** a kocka megjelenítési ideje ms-ban (a GIF-ből; a 0/negatív 100 ms-ra pótolva) */
  delayMs: number;
}

/** Egy kocka effektív késleltetése: a 0/negatív/NaN a GIF-konvenció szerint 100 ms. */
function safeDelay(d: number): number {
  return Number.isFinite(d) && d > 0 ? d : 100;
}

/** A GIF egy teljes ciklusának hossza ms-ban (0, ha nincs kocka). */
export function gifDuration(frames: readonly GifFrame[]): number {
  let total = 0;
  for (const f of frames) {
    total += safeDelay(f.delayMs);
  }
  return total;
}

/**
 * A playhead-időhöz (ms, a GIF-klip kezdetétől) tartozó kocka-INDEX.
 * `loop=true`: a cikluson túl újrakezd; `loop=false`: a végén az utolsó kockán áll.
 * Üres kocka-lista → -1. A negatív idő a 0. kockát adja.
 */
export function frameIndexAt(frames: readonly GifFrame[], elapsedMs: number, loop = true): number {
  const n = frames.length;
  if (n === 0) {
    return -1;
  }
  const total = gifDuration(frames);
  if (total <= 0) {
    return 0;
  }
  let t = elapsedMs;
  if (t <= 0) {
    return 0;
  }
  if (t >= total) {
    if (!loop) {
      return n - 1; // kifutott → az utolsó kockán marad
    }
    t = t % total; // ciklus
  }
  // megkeressük, melyik kocka-intervallumba esik `t`
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += safeDelay(frames[i].delayMs);
    if (t < acc) {
      return i;
    }
  }
  return n - 1; // lebegőpontos maradék-biztosíték
}

/** Hányadik teljes ciklusnál tart (loopszám) — statisztikához/vez. UI-hoz. */
export function loopCountAt(frames: readonly GifFrame[], elapsedMs: number): number {
  const total = gifDuration(frames);
  if (total <= 0 || elapsedMs <= 0) {
    return 0;
  }
  return Math.floor(elapsedMs / total);
}
