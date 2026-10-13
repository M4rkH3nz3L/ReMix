/**
 * 🖼️▶️ Galéria → diavetítés mag (TECH-TOP §2.2) — pure + tesztelt.
 *
 * A kép-projekt egy GALÉRIA (`project.imageDocs: ImageDoc[]`). A diavetítés a galéria
 * rendezett képeit (a renderelt PNG-ket) időzített videó-idővonallá fűzi: minden kép
 * `perSlideSec` ideig látszik, közöttük átmenet (`transitionOut`), opcionálisan háttérzenével.
 * A kimenet szabványos `ImageClip[]` (+ `AudioClip`), amit a meglévő videó-render renderel.
 * A 10 perces plafon (MAX_PROJECT_DURATION_SEC) a diavetítésre is érvényes.
 */
import type { AudioClip, ImageClip, TransitionOut } from '@/types/project';
import { MAX_PROJECT_DURATION_SEC } from './projectUtils';

export const DEFAULT_PER_SLIDE_SEC = 3;
export const DEFAULT_TRANSITION_SEC = 0.5;

export interface SlideSource {
  /** a forrás ImageDoc id-je (stabil klip-id-hez) */
  id: string;
  /** a kép renderelt PNG-je */
  uri: string;
}

export interface SlideshowOptions {
  /** egy kép hány mp-ig látszik (alap 3) */
  perSlideSec?: number;
  /** átmenet típusa a következő képre ('none' = kemény vágás) */
  transition?: TransitionOut['type'] | 'none';
  /** átmenet hossza mp (alap 0.5) */
  transitionSec?: number;
}

function perSlide(opts: SlideshowOptions): number {
  const v = Number(opts.perSlideSec);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PER_SLIDE_SEC;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** A diavetítés teljes hossza (mp) — a klipek NEM fednek át (az átmenet a határon belül). */
export function slideshowDurationSec(count: number, opts: SlideshowOptions = {}): number {
  const n = Math.max(0, Math.floor(count));
  return round(n * perSlide(opts));
}

/** Belefér-e a 10 perces plafonba? */
export function slideshowFitsMax(count: number, opts: SlideshowOptions = {}): boolean {
  return slideshowDurationSec(count, opts) <= MAX_PROJECT_DURATION_SEC;
}

/** A max `perSlideSec`, ami adott kép-számmal még belefér a 10 perces plafonba (auto-fit). */
export function clampPerSlideForMax(count: number): number {
  const n = Math.max(1, Math.floor(count));
  return round(MAX_PROJECT_DURATION_SEC / n);
}

/**
 * A galéria-képekből diavetítés-klip-terv (`ImageClip[]` egy videó-idővonalra): minden
 * kép `perSlideSec` hosszú, start = i·perSlideSec; a nem-utolsó képeken `transitionOut`.
 */
export function slideshowPlan(slides: SlideSource[], opts: SlideshowOptions = {}): ImageClip[] {
  const per = perSlide(opts);
  const trType = opts.transition ?? 'dissolve';
  const trSec = Math.max(0, Number.isFinite(opts.transitionSec as number) ? (opts.transitionSec as number) : DEFAULT_TRANSITION_SEC);
  return slides.map((s, i) => {
    const clip: ImageClip = {
      kind: 'image',
      id: `slide-${s.id}`,
      start: round(i * per),
      duration: per,
      uri: s.uri,
      filterId: 'none',
    };
    // átmenet a KÖVETKEZŐ képre (az utolsón nincs); 'none' / 0 → nincs
    if (trType !== 'none' && trSec > 0 && i < slides.length - 1) {
      clip.transitionOut = { type: trType, duration: Math.min(trSec, per / 2) };
    }
    return clip;
  });
}

/** Háttérzene-klip a teljes diavetítés hosszára (§2.2: „zenei illusztráció"). */
export function backgroundMusicClip(uri: string, totalSec: number, fadeSec = 1): AudioClip {
  const dur = Math.max(0, round(totalSec));
  return {
    kind: 'audio',
    id: 'slideshow-bgm',
    start: 0,
    duration: dur,
    uri,
    volume: 0.8,
    fadeIn: Math.min(fadeSec, dur / 2),
    fadeOut: Math.min(fadeSec, dur / 2),
  } as AudioClip;
}
