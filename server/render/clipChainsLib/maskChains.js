// 🎭 Maszk / rotoszkóp: poligon-, ellipszis-, téglalap-maszk szürke maszk-kockán, animált kulcskockákkal (a clipChains.js-ből).

/**
 * @param rc a render-környezet: { W, H, FPS, graph } (a createClipChains-en át a renderProject-ből)
 */
function createMaskChains(rc) {
  const { W, H, FPS, graph } = rc;

  /**
   * Maszk (P0-10): a lágy szélű forma EGYETLEN szürke kockán készül el (a geq
   * per-pixel kiértékelése drága — képkockánként futtatva percekig tartana),
   * majd loop-olva az fg alfájával szorzódik össze (chroma-val kombinálható).
   */
  // háromszög-legyező poligon-teszt token-koordinátákból (szám VAGY T-kifejezés)
  const polyWExpr = (ptsX, ptsY, apexX, apexY) => {
    const K = ptsX.length;
    const tri = [];
    for (let k = 0; k < K; k++) {
      const ax = ptsX[k];
      const ay = ptsY[k];
      const bx = ptsX[(k + 1) % K];
      const by = ptsY[(k + 1) % K];
      const s1 = `((${bx}-${ax})*(Y-${ay})-(${by}-${ay})*(X-${ax}))`;
      const s2e = `((${apexX}-${bx})*(Y-${by})-(${apexY}-${by})*(X-${bx}))`;
      const s3 = `((${ax}-${apexX})*(Y-${apexY})-(${ay}-${apexY})*(X-${apexX}))`;
      tri.push(`(gte(${s1},0)*gte(${s2e},0)*gte(${s3},0)+lte(${s1},0)*lte(${s2e},0)*lte(${s3},0))`);
    }
    return `min(${tri.join('+')},1)`;
  };

  // statikus poligon (a legyező-súlyponttal) — a NEM-animált út és az animált
  // fallback közös építője; a `toFixed(1)` rögzíti a régi kimenetet (paritás)
  const staticPoly = (points, expand) => {
    let pts = points.map((p) => ({ x: p.x * W, y: p.y * H }));
    const cxP = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length;
    const cyP = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
    if (expand !== 0) {
      pts = pts.map((p) => ({ x: cxP + (p.x - cxP) * (1 + expand), y: cyP + (p.y - cyP) * (1 + expand) }));
    }
    const n = (v) => Number(v).toFixed(1);
    return polyWExpr(pts.map((p) => n(p.x)), pts.map((p) => n(p.y)), n(cxP), n(cyP));
  };

  /**
   * Maszk (P0-10 + 🎬 rotoszkóp): a lágy szélű forma szürke maszk-kockán készül.
   * NEM animált (nincs `track`): EGYETLEN kocka + loop (olcsó — a régi út bitre
   * változatlan). Animált (`track`): a geometria klip-lokális kulcskockákból
   * interpolálva, PER-FRAME geq (loop nélkül) — a `skip` a szegmens klipbeli
   * kezdete (geq idő-változó `T`, klip-idő = T + skip). Ellipszis/téglalap
   * teljes per-frame; poligon per-vertex ha a pontszám állandó és ≤16, különben
   * a klip közepéhez legközelebbi keret statikus alakja (dokumentált korlát).
   */
  const withMask = (i, fgLabel, mask, dur, skip = 0, maskInputIdx = null) => {
    if (!mask) {
      return fgLabel;
    }
    // 🎬 kész szürke maszk-videó (worker-rasterizer, tetszőleges pontszám +
    // feather-animáció): csak az fg-alfa szorzása kell, geq nélkül
    if (maskInputIdx != null) {
      graph.push(`[${maskInputIdx}:v]scale=${W}:${H},format=gray[mimg${i}]`);
      graph.push(`[${fgLabel}]split[mf${i}][mfa${i}]`);
      graph.push(`[mfa${i}]alphaextract[mae${i}]`);
      graph.push(`[mae${i}][mimg${i}]blend=all_mode=multiply:shortest=1[mab${i}]`);
      graph.push(`[mf${i}][mab${i}]alphamerge[mfg${i}]`);
      return `mfg${i}`;
    }
    const track =
      Array.isArray(mask.track) && mask.track.length > 0
        ? [...mask.track].sort((a, b) => a.time - b.time)
        : null;
    const fNum = Math.min(0.3, Math.max(mask.feather ?? 0.05, 0.005));
    const ENum = Math.max(-0.5, Math.min(0.5, mask.expand ?? 0));

    // interpolált skalár-mező if-lánca a T időre (a kliens maskAnim.ts lineáris görbéjével azonos)
    const T = `(T+${skip.toFixed(3)})`;
    const px5 = (v) => Number(v).toFixed(5);
    const scalarExpr = (getter, fb) => {
      const fr = track.map((f) => ({ t: f.time, v: getter(f) ?? fb }));
      let expr = px5(fr[fr.length - 1].v);
      for (let k = fr.length - 2; k >= 0; k--) {
        const a = fr[k];
        const b = fr[k + 1];
        const span = Math.max(b.t - a.t, 0.001);
        const P = `min(max((${T}-${px5(a.t)})/${px5(span)},0),1)`;
        expr = `if(lt(${T},${px5(b.t)}),(${px5(a.v)}+${px5(b.v - a.v)}*${P}),${expr})`;
      }
      return `if(lt(${T},${px5(fr[0].t)}),${px5(fr[0].v)},${expr})`;
    };

    // ellipszis/téglalap közös tokenjei (szám vagy T-kifejezés)
    const cx = track ? `(${scalarExpr((f) => f.x, mask.x)})*${W}` : (mask.x * W).toFixed(1);
    const cy = track ? `(${scalarExpr((f) => f.y, mask.y)})*${H}` : (mask.y * H).toFixed(1);
    const rw = track
      ? `(${scalarExpr((f) => f.w, mask.w)})*${(W / 2).toFixed(3)}`
      : ((Math.max(mask.w, 0.02) * W) / 2).toFixed(1);
    const rh = track
      ? `(${scalarExpr((f) => f.h, mask.h)})*${(H / 2).toFixed(3)}`
      : ((Math.max(mask.h, 0.02) * H) / 2).toFixed(1);
    const fDiv = track ? `max(0.005,(${scalarExpr((f) => f.feather, mask.feather ?? 0.05)}))` : fNum.toFixed(3);
    const oneMinE = track ? `(1+(${scalarExpr((f) => f.expand, mask.expand ?? 0)}))` : (1 + ENum).toFixed(3);

    // perFrame = a wExpr ténylegesen T-függő (a loop-ot ilyenkor elhagyjuk)
    let perFrame = false;
    let wExpr;
    if (mask.shape === 'polygon' && Array.isArray(mask.points) && mask.points.length >= 3) {
      if (track) {
        const baseCount = track[0].points?.length ?? 0;
        const canMorph =
          baseCount >= 3 &&
          baseCount <= 16 &&
          track.every((f) => Array.isArray(f.points) && f.points.length === baseCount);
        if (canMorph) {
          perFrame = true;
          const apexX = (mask.x * W).toFixed(1); // állandó legyező-apex (kis kifejezés)
          const apexY = (mask.y * H).toFixed(1);
          const vExpr = (k, axis) => scalarExpr((f) => f.points[k][axis], axis === 'x' ? mask.x : mask.y);
          const ptsX = Array.from({ length: baseCount }, (_, k) => `(${vExpr(k, 'x')})*${W}`);
          const ptsY = Array.from({ length: baseCount }, (_, k) => `(${vExpr(k, 'y')})*${H}`);
          wExpr = polyWExpr(ptsX, ptsY, apexX, apexY);
        } else {
          // fallback: a klip közepéhez legközelebbi keret statikus alakja
          const mid = dur / 2;
          const rep = track.reduce((best, f) =>
            Math.abs(f.time - mid) < Math.abs(best.time - mid) ? f : best
          );
          wExpr = staticPoly(rep.points ?? mask.points, rep.expand ?? ENum);
        }
      } else {
        wExpr = staticPoly(mask.points, ENum);
      }
    } else if (mask.shape === 'ellipse') {
      perFrame = !!track;
      const d = `sqrt(pow((X-${cx})/(${rw}),2)+pow((Y-${cy})/(${rh}),2))`;
      wExpr = `min(max((${oneMinE}-${d})/${fDiv},0),1)`;
    } else {
      perFrame = !!track;
      const fpx = track
        ? `max(2,(${scalarExpr((f) => f.feather, mask.feather ?? 0.05)})*${H})`
        : Math.max(2, fNum * H).toFixed(1);
      const off = track ? `(${scalarExpr((f) => f.expand, mask.expand ?? 0)})*${H}` : (ENum * H).toFixed(1);
      const dEdge =
        `min(min(X-((${cx})-(${rw})),((${cx})+(${rw}))-X),` +
        `min(Y-((${cy})-(${rh})),((${cy})+(${rh}))-Y))`;
      wExpr = `min(max((${dEdge}+${off})/${fpx},0),1)`;
    }
    if (mask.invert) {
      wExpr = `(1-${wExpr})`;
    }
    // 🌓 maszk-átlátszóság: a kimaszkolt terület megtartott láthatósága (alfa-padló)
    const mo = Math.max(0, Math.min(1, mask.opacity ?? 0));
    if (mo > 0) {
      wExpr = `(${mo.toFixed(3)}+${(1 - mo).toFixed(3)}*(${wExpr}))`;
    }
    if (perFrame) {
      // per-frame: a szürke maszk a teljes hosszon renderel (geq minden kockán újraértékel)
      graph.push(
        `color=white:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=gray,geq=lum='255*${wExpr}'[mimg${i}]`
      );
    } else {
      const frames = Math.ceil(dur * FPS) + 2;
      graph.push(
        `color=white:s=${W}x${H}:r=${FPS}:d=${(2 / FPS).toFixed(4)},format=gray,` +
          `geq=lum='255*${wExpr}',loop=loop=${frames}:size=1:start=0[mimg${i}]`
      );
    }
    graph.push(`[${fgLabel}]split[mf${i}][mfa${i}]`);
    graph.push(`[mfa${i}]alphaextract[mae${i}]`);
    graph.push(`[mae${i}][mimg${i}]blend=all_mode=multiply:shortest=1[mab${i}]`);
    graph.push(`[mf${i}][mab${i}]alphamerge[mfg${i}]`);
    return `mfg${i}`;
  };

  return {
    polyWExpr,
    staticPoly,
    withMask,
  };
}

module.exports = { createMaskChains };
