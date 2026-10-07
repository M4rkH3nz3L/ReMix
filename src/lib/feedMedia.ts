import type { RenderedVersion } from '@/types/project';

/**
 * 🖼️ Feed-média segédek (04-social §2.8) — a feed-rács borítóképéhez (poster).
 * Tiszta, tesztelhető logika; a tényleges kocka-kinyerés + feltöltés a hívóban
 * (getFilmstrip + uploadMedia) megy.
 */

/**
 * A poster reprezentatív kockájának ideje (mp) a videó hosszából: ~10%-nál, de
 * legalább 0.5 mp (ne a fekete első kocka legyen), és sosem a legvégén (max hossz-0.1).
 */
export function posterFrameTime(durationSec: number): number {
  const d = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (d <= 0) {
    return 0;
  }
  const t = Math.max(0.5, d * 0.1);
  return Math.min(t, Math.max(0, d - 0.1));
}

/** Kell-e posztert generálni: van kész (feltöltött) videó, de nincs poster. */
export function needsPoster(rendered: RenderedVersion | undefined): boolean {
  return !!rendered?.url && !rendered.posterUrl;
}
