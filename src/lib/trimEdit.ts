import { MIN_CLIP_DURATION } from '@/constants/editor';
import { maxVideoDuration } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import type { Clip, Track, VideoClip } from '@/types/project';

/**
 * ✂️ Profi trim-műveletek TISZTA magja (roll · slip · slide).
 *
 * A számítás szándékosan nem ismeri a store-t: sávot + paramétereket kap, és az
 * ÚJ klip-listát adja vissza (vagy `null`, ha a művelet nem értelmezhető / nincs
 * érdemi elmozdulás). A `dispatch` a hívó dolga — így a matematika egység-
 * tesztelhető, és pontosan ez a különbség a „működik" és a „bizonyítottan
 * működik" között egy vágóprogramban.
 *
 * Közös szabályok:
 *  - egyik klip sem mehet `MIN_CLIP_DURATION` alá,
 *  - videóklip nem nyúlhat túl a forrás végén (`maxVideoDuration`) és nem
 *    kezdődhet a forrás eleje előtt (`trimIn >= 0`),
 *  - az idők ezredmásodpercre kerekítve (a lebegőpontos hiba ne halmozódjon).
 */

const round = (n: number) => Math.round(n * 1000) / 1000;

/** két klip „érintkezik", ha a rés kisebb ennél (mp) */
const TOUCH_EPS = 0.05;
/** ennél kisebb elmozdulás no-op (nem érdemes undo-lépést gyártani) */
const MIN_DELTA = 0.001;

function sortedWithIndex(track: Track, clipId: string): { sorted: Clip[]; idx: number } {
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  return { sorted, idx: sorted.findIndex((x) => x.id === clipId) };
}

/**
 * ROLL: a két SZOMSZÉDOS klip közös vágáspontját mozgatja — az együttes hossz
 * változatlan marad (az egyik nő, a másik ugyanannyit rövidül). Csak érintkező
 * szomszéddal értelmes.
 */
export function buildRollEdit(
  track: Track,
  clipId: string,
  edge: 'left' | 'right',
  deltaSec: number
): Clip[] | null {
  const { sorted, idx } = sortedWithIndex(track, clipId);
  const c = sorted[idx];
  if (!c) {
    return null;
  }

  if (edge === 'right') {
    const next = sorted[idx + 1];
    if (!next || Math.abs(next.start - (c.start + c.duration)) > TOUCH_EPS) {
      return null; // roll csak érintkező szomszéddal
    }
    let d = clamp(deltaSec, MIN_CLIP_DURATION - c.duration, next.duration - MIN_CLIP_DURATION);
    if (c.kind === 'video') {
      d = Math.min(d, maxVideoDuration(c) - c.duration); // c forrás-vége
    }
    if (next.kind === 'video') {
      d = Math.max(d, -next.trimIn / next.speed); // next forrás-eleje
    }
    if (Math.abs(d) < MIN_DELTA) {
      return null;
    }
    const newC = { ...c, duration: round(c.duration + d) } as Clip;
    const newNext = {
      ...next,
      start: round(next.start + d),
      duration: round(next.duration - d),
    } as Clip;
    if (newNext.kind === 'video' && next.kind === 'video') {
      newNext.trimIn = round(next.trimIn + d * next.speed);
    }
    return track.clips.map((x) => (x.id === c.id ? newC : x.id === next.id ? newNext : x));
  }

  const prev = sorted[idx - 1];
  if (!prev || Math.abs(prev.start + prev.duration - c.start) > TOUCH_EPS) {
    return null;
  }
  let d = clamp(deltaSec, MIN_CLIP_DURATION - prev.duration, c.duration - MIN_CLIP_DURATION);
  if (prev.kind === 'video') {
    d = Math.min(d, maxVideoDuration(prev) - prev.duration); // prev forrás-vége
  }
  if (c.kind === 'video') {
    d = Math.max(d, -c.trimIn / c.speed); // c forrás-eleje
  }
  if (Math.abs(d) < MIN_DELTA) {
    return null;
  }
  const newPrev = { ...prev, duration: round(prev.duration + d) } as Clip;
  const newC = { ...c, start: round(c.start + d), duration: round(c.duration - d) } as Clip;
  if (newC.kind === 'video' && c.kind === 'video') {
    newC.trimIn = round(c.trimIn + d * c.speed);
  }
  return track.clips.map((x) => (x.id === prev.id ? newPrev : x.id === c.id ? newC : x));
}

/**
 * SLIP: a klip HELYE és HOSSZA változatlan, csak a forrás-ablak csúszik benne.
 * Csak videón értelmes. Az ÚJ `trimIn`-t adja vissza (vagy `null`, ha nincs
 * érdemi elmozdulás). Jobbra húzás → korábbi forrás-tartalom.
 */
export function buildSlipEdit(clip: VideoClip, deltaSec: number): number | null {
  const windowSrc = clip.duration * clip.speed;
  const newTrimIn = clamp(
    clip.trimIn - deltaSec * clip.speed,
    0,
    Math.max(0, clip.sourceDuration - windowSrc)
  );
  if (Math.abs(newTrimIn - clip.trimIn) < MIN_DELTA) {
    return null;
  }
  return round(newTrimIn);
}

/**
 * SLIDE: a klip EGÉSZBEN mozdul, a szomszédai nyúlnak/rövidülnek hozzá — a
 * klip saját hossza és forrás-ablaka változatlan. Szomszéd nélkül csak a 0
 * (idővonal eleje) korlátoz.
 */
export function buildSlideEdit(track: Track, clipId: string, deltaSec: number): Clip[] | null {
  const { sorted, idx } = sortedWithIndex(track, clipId);
  const c = sorted[idx];
  if (!c) {
    return null;
  }
  const prev = sorted[idx - 1];
  const next = sorted[idx + 1];
  const touchingPrev = !!prev && Math.abs(prev.start + prev.duration - c.start) <= TOUCH_EPS;
  const touchingNext = !!next && Math.abs(next.start - (c.start + c.duration)) <= TOUCH_EPS;

  let d = deltaSec;
  if (touchingPrev) {
    d = Math.max(d, MIN_CLIP_DURATION - prev.duration);
    if (prev.kind === 'video') {
      d = Math.min(d, maxVideoDuration(prev) - prev.duration);
    }
  } else {
    d = Math.max(d, -c.start); // szomszéd nélkül csak a 0 a korlát
  }
  if (touchingNext) {
    d = Math.min(d, next.duration - MIN_CLIP_DURATION);
    if (next.kind === 'video') {
      d = Math.max(d, -next.trimIn / next.speed);
    }
  }
  if (Math.abs(d) < MIN_DELTA) {
    return null;
  }

  return track.clips.map((x) => {
    if (x.id === c.id) {
      return { ...x, start: round(x.start + d) } as Clip;
    }
    if (touchingPrev && x.id === prev.id) {
      return { ...x, duration: round(x.duration + d) } as Clip;
    }
    if (touchingNext && x.id === next.id) {
      const n = { ...x, start: round(x.start + d), duration: round(x.duration - d) } as Clip;
      if (n.kind === 'video' && x.kind === 'video') {
        n.trimIn = round(x.trimIn + d * x.speed);
      }
      return n;
    }
    return x;
  });
}
