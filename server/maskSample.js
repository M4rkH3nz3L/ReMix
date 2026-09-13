// 🎬 Animált maszk mintavétele — a kliens src/lib/maskAnim.ts sampleMaskAt-jének
// TÜKRE (pure Node). A maszk-rasterizer (mask-render.js) ezzel sampleli a
// geometriát képkockánként, hogy a render a szerkesztővel EGYEZŐ maszkot kapjon
// (preview↔render paritás). Változtatásnál a kettőt együtt kell módosítani.

const lerp = (a, b, p) => a + (b - a) * p;

/** két keret geometriájának interpolációja p∈[0,1]-en (poligon-pont csak azonos számnál) */
function interpFrame(a, b, p) {
  const points =
    Array.isArray(a.points) && Array.isArray(b.points) && a.points.length === b.points.length
      ? a.points.map((pt, i) => ({ x: lerp(pt.x, b.points[i].x, p), y: lerp(pt.y, b.points[i].y, p) }))
      : a.points;
  return {
    x: lerp(a.x, b.x, p),
    y: lerp(a.y, b.y, p),
    w: lerp(a.w, b.w, p),
    h: lerp(a.h, b.h, p),
    feather: lerp(a.feather ?? 0.05, b.feather ?? 0.05, p),
    expand: lerp(a.expand ?? 0, b.expand ?? 0, p),
    points,
  };
}

/** a maszk effektív (statikus) állapota t klip-lokális időben; track nélkül változatlan */
function sampleMaskAt(mask, t) {
  const track = Array.isArray(mask.track) && mask.track.length > 0 ? mask.track : null;
  if (!track) {
    return mask;
  }
  const sorted = [...track].sort((a, b) => a.time - b.time);
  let g;
  if (t <= sorted[0].time) {
    g = sorted[0];
  } else if (t >= sorted[sorted.length - 1].time) {
    g = sorted[sorted.length - 1];
  } else {
    g = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (t < b.time) {
        const span = b.time - a.time;
        g = interpFrame(a, b, span > 0 ? (t - a.time) / span : 0);
        break;
      }
    }
  }
  return {
    ...mask,
    x: g.x,
    y: g.y,
    w: g.w,
    h: g.h,
    feather: g.feather ?? mask.feather,
    expand: g.expand ?? mask.expand,
    points: g.points ?? mask.points,
    track: undefined,
  };
}

module.exports = { sampleMaskAt };
