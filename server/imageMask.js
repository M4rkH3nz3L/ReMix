// 🎭 Kép-réteg maszk (IMGEDD §2): egy `ClipMask` (rectangle/ellipse/polygon) → teljes-vászon
// SZÜRKE maszk-kocka ffmpeg `geq`-kifejezése (0..1 alfa-súly). A render a réteget egy átlátszó
// teljes vászonra helyezi, az alfáját EZZEL szorozza (alphaextract→blend multiply→alphamerge),
// így a maszkon kívüli rész átlátszó lesz. A STATIKUS (idő nélküli) logika a `server/render.js`
// videó-maszkjával AZONOS (render-paritás); pure → tesztelhető.

// pont-a-poligonban: legyező-trianguláció a súlypontból (render.js polyWExpr-rel azonos).
// Konvex/csillag-alakra pontos; erősen konkávra közelítés (dokumentált korlát, mint a videónál).
function polyWExpr(ptsX, ptsY, apexX, apexY) {
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
}

function staticPoly(points, W, H, expand) {
  let pts = points.map((p) => ({ x: p.x * W, y: p.y * H }));
  const cxP = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cyP = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  if (expand !== 0) {
    pts = pts.map((p) => ({ x: cxP + (p.x - cxP) * (1 + expand), y: cyP + (p.y - cyP) * (1 + expand) }));
  }
  const n = (v) => Number(v).toFixed(1);
  return polyWExpr(pts.map((p) => n(p.x)), pts.map((p) => n(p.y)), n(cxP), n(cyP));
}

/** A maszk alfa-súly (0..1) geq-kifejezése a megadott vászon-méretre. */
function maskWExpr(mask, W, H) {
  const fNum = Math.min(0.3, Math.max(mask.feather ?? 0.05, 0.005));
  const ENum = Math.max(-0.5, Math.min(0.5, mask.expand ?? 0));
  const cx = (mask.x * W).toFixed(1);
  const cy = (mask.y * H).toFixed(1);
  const rw = ((Math.max(mask.w, 0.02) * W) / 2).toFixed(1);
  const rh = ((Math.max(mask.h, 0.02) * H) / 2).toFixed(1);
  let wExpr;
  if (mask.shape === 'polygon' && Array.isArray(mask.points) && mask.points.length >= 3) {
    wExpr = staticPoly(mask.points, W, H, ENum);
  } else if (mask.shape === 'ellipse') {
    const oneMinE = (1 + ENum).toFixed(3);
    const d = `sqrt(pow((X-${cx})/(${rw}),2)+pow((Y-${cy})/(${rh}),2))`;
    wExpr = `min(max((${oneMinE}-${d})/${fNum.toFixed(3)},0),1)`;
  } else {
    // rectangle
    const fpx = Math.max(2, fNum * H).toFixed(1);
    const off = (ENum * H).toFixed(1);
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
  return wExpr;
}

/** A teljes-vászon szürke maszk-forrás filter-fragmentje (`color=white…geq…[label]`).
 *  Poligonnál az él lágyítását (feather) utólagos gblur adja (az ellipszis/téglalap a geq-ben featheröl). */
function maskGrayChain(mask, W, H, label) {
  const wExpr = maskWExpr(mask, W, H);
  let blur = '';
  if (mask.shape === 'polygon' && (mask.feather ?? 0) > 0.005) {
    blur = `,gblur=sigma=${Math.max(1, (mask.feather ?? 0) * W).toFixed(1)}`;
  }
  return `color=white:s=${W}x${H},format=gray,geq=lum='255*${wExpr}'${blur}${label}`;
}

// 🎯 vászon-normalizált maszk → a réteg DOBOZÁBA (box-lokális 0–1) transzformálva — a lokális
// korrekcióhoz, ami a box-méretű prepared rétegen fut. A réteg középe (position) + w/h adja a dobozt.
function maskToBox(mask, layer) {
  const bw = Math.max(Number(layer.w) || 1, 0.0001);
  const bh = Math.max(Number(layer.h) || 1, 0.0001);
  const bx = (layer.position?.x ?? 0.5) - bw / 2;
  const by = (layer.position?.y ?? 0.5) - bh / 2;
  const tx = (v) => (v - bx) / bw;
  const ty = (v) => (v - by) / bh;
  return {
    ...mask,
    x: tx(mask.x),
    y: ty(mask.y),
    w: mask.w / bw,
    h: mask.h / bh,
    points: Array.isArray(mask.points) ? mask.points.map((p) => ({ x: tx(p.x), y: ty(p.y) })) : undefined,
  };
}

module.exports = { maskWExpr, maskGrayChain, polyWExpr, staticPoly, maskToBox };
