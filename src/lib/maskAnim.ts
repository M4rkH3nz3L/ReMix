import type { ClipMask, MaskFrame } from '@/types/project';

/**
 * 🎬 Animált maszk (rotoszkóp / követés) — pure, tesztelhető mag.
 *
 * A maszk geometriája (x/y/w/h/feather/expand + poligon-pontok) kulcskockázható
 * klip-lokális időben (`ClipMask.track`). Ez a modul mintavételezi az effektív
 * (statikus) maszkot egy adott időpontban — a PREVIEW ezt mutatja, a RENDER
 * (server/render.js) ugyanezt az interpolációt képezi le per-frame FFmpeg-
 * kifejezésre (paritás). A poligon-pontok CSAK azonos pontszámú szomszédos
 * keretek közt interpolálódnak, különben az előző keret alakja tartva (stepped).
 */

/** két maszk-kulcskocka ennyin belül „ugyanaz az időpont" (csere, nem beszúrás) */
export const MASK_KF_EPS = 0.03;

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const round = (v: number) => Math.round(v * 1000) / 1000;

export function hasMaskTrack(mask: ClipMask | undefined | null): boolean {
  return !!mask?.track && mask.track.length > 0;
}

/** a maszk aktuális geometriája MaskFrame-ként (kulcskocka forrása) */
function geomOf(mask: ClipMask, time: number): MaskFrame {
  return {
    time,
    x: mask.x,
    y: mask.y,
    w: mask.w,
    h: mask.h,
    feather: mask.feather,
    expand: mask.expand,
    points: mask.points ? mask.points.map((p) => ({ ...p })) : undefined,
  };
}

/** két keret geometriájának interpolációja p∈[0,1]-en */
function interpFrame(a: MaskFrame, b: MaskFrame, p: number): MaskFrame {
  const points =
    a.points && b.points && a.points.length === b.points.length
      ? a.points.map((pt, i) => ({ x: lerp(pt.x, b.points![i].x, p), y: lerp(pt.y, b.points![i].y, p) }))
      : a.points; // eltérő pontszám → az előző keret alakja (stepped rotoszkóp)
  return {
    time: lerp(a.time, b.time, p),
    x: lerp(a.x, b.x, p),
    y: lerp(a.y, b.y, p),
    w: lerp(a.w, b.w, p),
    h: lerp(a.h, b.h, p),
    feather: lerp(a.feather ?? 0.05, b.feather ?? 0.05, p),
    expand: lerp(a.expand ?? 0, b.expand ?? 0, p),
    points,
  };
}

/**
 * A maszk effektív (statikus) állapota t klip-lokális időben. Track nélkül a
 * maszkot változatlanul adja vissza. A szélek előtt/után az érték tartva.
 */
export function sampleMaskAt(mask: ClipMask, t: number): ClipMask {
  const track = mask.track;
  if (!track || track.length === 0) {
    return mask;
  }
  const sorted = [...track].sort((a, b) => a.time - b.time);
  let frame: MaskFrame;
  if (t <= sorted[0].time) {
    frame = sorted[0];
  } else if (t >= sorted[sorted.length - 1].time) {
    frame = sorted[sorted.length - 1];
  } else {
    frame = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (t < b.time) {
        const span = b.time - a.time;
        frame = interpFrame(a, b, span > 0 ? (t - a.time) / span : 0);
        break;
      }
    }
  }
  return {
    ...mask,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    feather: frame.feather ?? mask.feather,
    expand: frame.expand ?? mask.expand,
    points: frame.points ?? mask.points,
    track: undefined, // a mintavett állapot már statikus
  };
}

/** a maszk kulcskocka-időpontjai (rendezve) */
export function maskKeyframeTimes(mask: ClipMask | undefined | null): number[] {
  return (mask?.track ?? []).map((f) => f.time).sort((a, b) => a - b);
}

/** kulcskocka beszúrása/cseréje t-nél a `source` maszk geometriájából */
export function addMaskKeyframe(mask: ClipMask, t: number, source: ClipMask): ClipMask {
  const frame = geomOf(source, round(Math.max(0, t)));
  const track = (mask.track ?? []).filter((f) => Math.abs(f.time - frame.time) > MASK_KF_EPS);
  track.push(frame);
  track.sort((a, b) => a.time - b.time);
  return { ...mask, track };
}

/** kulcskocka törlése t közelében; ha a track kiürül, elhagyva */
export function removeMaskKeyframeAt(mask: ClipMask, t: number): ClipMask {
  const track = (mask.track ?? []).filter((f) => Math.abs(f.time - t) > MASK_KF_EPS);
  return { ...mask, track: track.length > 0 ? track : undefined };
}

/**
 * 🎯 Követés-kulcskockák témapozíciókból (pl. arc-mintavételek): minden
 * `{ time, x, y }` mintára a maszk aktuális geometriájával, de az adott
 * középpontra helyezve tesz egy kulcskockát. A meglévő track lecserélve.
 */
export function trackToPoints(
  mask: ClipMask,
  samples: { time: number; x: number; y: number }[]
): ClipMask {
  if (samples.length === 0) {
    return mask;
  }
  const base = geomOf(mask, 0);
  const track = [...samples]
    .sort((a, b) => a.time - b.time)
    .map((s) => {
      // a poligon-pontokat a régi középpontból az új középpontba toljuk
      const dx = s.x - mask.x;
      const dy = s.y - mask.y;
      return {
        ...base,
        time: round(Math.max(0, s.time)),
        x: round(s.x),
        y: round(s.y),
        points: base.points?.map((p) => ({ x: round(p.x + dx), y: round(p.y + dy) })),
      } as MaskFrame;
    });
  return { ...mask, track };
}
