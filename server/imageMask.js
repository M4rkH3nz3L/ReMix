const fs = require('fs');
const path = require('path');

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

/** Egy gyűrű kitöltése soronként (páros-páratlan szabály): homorú formán is pontos. */
function fillRing(points, W, H) {
  const out = new Uint8Array(W * H);
  const n = points.length;
  for (let y = 0; y < H; y += 1) {
    const cy = y + 0.5;
    const hits = [];
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const [ax, ay, bx, by] = [points[i].x * W, points[i].y * H, points[j].x * W, points[j].y * H];
      if (ay > cy !== by > cy) {
        hits.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
      }
    }
    hits.sort((a, b) => a - b);
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const from = Math.max(0, Math.round(hits[k]));
      const to = Math.min(W, Math.round(hits[k + 1]));
      if (to > from) {
        out.fill(255, y * W + from, y * W + to);
      }
    }
  }
  return out;
}

/** A maszk műveletei sorban egy W×H-s szürke képpé (0 / 255). */
function rasterMask(mask, W, H) {
  const ops = mask.ops?.length ? mask.ops : [{ op: 'add', points: mask.points }];
  const expand = 1 + Math.max(-0.5, Math.min(0.5, mask.expand ?? 0));
  let buf = new Uint8Array(W * H);
  for (const { op, points } of ops) {
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const ring = fillRing(points.map((p) => ({ x: cx + (p.x - cx) * expand, y: cy + (p.y - cy) * expand })), W, H);
    for (let i = 0; i < buf.length; i += 1) {
      buf[i] = op === 'add' ? buf[i] | ring[i] : op === 'subtract' ? buf[i] & ~ring[i] : buf[i] & ring[i];
    }
  }
  return buf;
}

const isRaster = (mask) => mask.shape === 'polygon' && (mask.ops?.length > 0 || mask.points?.length >= 3);

/** A poligon-maszk a munkakönyvtárba írt szürke képből: a `geq` legyezője homorú formát nem ad vissza. */
function rasterMaskChain(mask, W, H, label, workDir) {
  const file = path.join(workDir, `mask_${label.replace(/\W/g, '')}.pgm`);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), Buffer.from(rasterMask(mask, W, H))]));
  const feather = mask.feather ?? 0;
  const blur = feather > 0.005 ? `,gblur=sigma=${Math.max(1, feather * W).toFixed(1)}` : '';
  const invert = mask.invert ? ',negate' : '';
  const mo = Math.max(0, Math.min(1, mask.opacity ?? 0));
  const floor = mo > 0 ? `,geq=lum='${(mo * 255).toFixed(1)}+${(1 - mo).toFixed(3)}*lum(X,Y)'` : '';
  return `movie='${file.replace(/'/g, "'\\''")}',format=gray,scale=${W}:${H}${blur}${invert}${floor}${label}`;
}

/** A teljes-vászon szürke maszk-forrás filter-fragmentje (`color=white…geq…[label]`).
 *  Poligonnál az él lágyítását (feather) utólagos gblur adja (az ellipszis/téglalap a geq-ben featheröl). */
/**
 * A festett maszk: szürke PNG a saját dobozában, a dobozon kívül rejtett. Csak helyi fájl lehet
 * (a feltöltés-kötés után); a még URL-t hordozó, le nem tölthető képet nem adjuk az ffmpegnek.
 */
function imageMaskChain(mask, W, H, label) {
  const [bw, bh] = [Math.max(1, Math.round(mask.w * W)), Math.max(1, Math.round(mask.h * H))];
  const [x, y] = [Math.round((mask.x - mask.w / 2) * W), Math.round((mask.y - mask.h / 2) * H)];
  const feather = mask.feather ?? 0;
  const blur = feather > 0.005 ? `,gblur=sigma=${Math.max(1, feather * W).toFixed(1)}` : '';
  const file = mask.image.replace(/'/g, "'\\''");
  const src = label.replace(/\W/g, '');
  return `movie='${file}',format=gbrp,scale=${bw}:${bh}[${src}s];color=black:s=${W}x${H},format=gbrp[${src}b];[${src}b][${src}s]overlay=${x}:${y}:format=gbrp,extractplanes=g${blur}${mask.invert ? ',negate' : ''}${label}`;
}

function maskGrayChain(mask, W, H, label, workDir) {
  if (mask.image && fs.existsSync(mask.image)) {
    return imageMaskChain(mask, W, H, label);
  }
  if (workDir && isRaster(mask)) {
    return rasterMaskChain(mask, W, H, label, workDir);
  }
  const wExpr = maskWExpr(mask, W, H);
  let blur = '';
  if (mask.shape === 'polygon' && (mask.feather ?? 0) > 0.005) {
    blur = `,gblur=sigma=${Math.max(1, (mask.feather ?? 0) * W).toFixed(1)}`;
  }
  return `color=white:s=${W}x${H},format=gray,geq=lum='255*${wExpr}'${blur}${label}`;
}

// 🎯 vászon-normalizált maszk → a réteg DOBOZÁBA (box-lokális 0–1) transzformálva — a lokális
// korrekcióhoz, ami a réteg SAJÁT terében (forgatás/tükrözés ELŐTT) fut. A vászon-pontot a réteg
// geometriájának INVERZÉVEL visszük vissza: a forgatás pixel-térben értendő, ezért kell a W×H.
function maskToBox(mask, layer, W = 1, H = 1) {
  const bw = Math.max(Number(layer.w) || 1, 0.0001);
  const bh = Math.max(Number(layer.h) || 1, 0.0001);
  const cx = layer.position?.x ?? 0.5;
  const cy = layer.position?.y ?? 0.5;
  const rad = ((Number(layer.rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const toBox = (x, y) => {
    const dx = (x - cx) * W;
    const dy = (y - cy) * H;
    let lx = dx * cos + dy * sin;
    let ly = -dx * sin + dy * cos;
    if (layer.flipH) lx = -lx;
    if (layer.flipV) ly = -ly;
    return { x: 0.5 + lx / (bw * W), y: 0.5 + ly / (bh * H) };
  };
  // forgatott téglalap/ellipszis nem ábrázolható tengelyes paraméterekkel → poligon lesz belőle
  let points = Array.isArray(mask.points) ? mask.points : undefined;
  let shape = mask.shape;
  if (rad !== 0 && shape !== 'polygon') {
    points = outlinePoints(mask);
    shape = 'polygon';
  }
  const center = toBox(mask.x, mask.y);
  return {
    ...mask,
    shape,
    x: center.x,
    y: center.y,
    w: mask.w / bw,
    h: mask.h / bh,
    points: points ? points.map((p) => toBox(p.x, p.y)) : undefined,
    ops: mask.ops?.map((o) => ({ ...o, points: o.points.map((p) => toBox(p.x, p.y)) })),
  };
}

/** téglalap / ellipszis körvonala poligonként (vászon-normalizált) */
function outlinePoints(mask) {
  const rx = mask.w / 2;
  const ry = mask.h / 2;
  if (mask.shape === 'ellipse') {
    return Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return { x: mask.x + rx * Math.cos(a), y: mask.y + ry * Math.sin(a) };
    });
  }
  return [
    { x: mask.x - rx, y: mask.y - ry },
    { x: mask.x + rx, y: mask.y - ry },
    { x: mask.x + rx, y: mask.y + ry },
    { x: mask.x - rx, y: mask.y + ry },
  ];
}

module.exports = { maskWExpr, maskGrayChain, polyWExpr, staticPoly, maskToBox, rasterMask };
