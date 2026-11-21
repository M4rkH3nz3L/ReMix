// 🎭 Régió-/maszk-láncok a filtergraphba (címkékkel): AI Select, arc-elmosás, matte, chroma-él (a videoFilters.js-ből).
const fs = require('fs');
const path = require('path');

const { bgRemoveDir } = require('../../bgremove');
const { localPathOnly } = require('./localPath');
const { adjustChain } = require('./colorChains');

/**
 * 🎯 AI Select (CC V2): a képjavítás CSAK a kijelölésre hat — a korrigált és
 * az eredeti kép a téma-maszkkal keveredik (maskedmerge). A maszk a bgremove
 * cache-ből jön; háttér-célnál a maszk invertálva megy.
 */
function selectiveChain(clip, W, H, labelIn, labelOut, idx, graph, addInput, dur) {
  const sel = clip.selective;
  const adjust = adjustChain(clip);
  if (!sel || !adjust) {
    return false;
  }
  const alphaFile = path.join(bgRemoveDir(sel.id), 'alpha.png');
  if (!fs.existsSync(alphaFile)) {
    return false;
  }
  const aIdx = addInput(['-loop', '1', '-t', dur.toFixed(3), '-i', alphaFile]);
  const invert = sel.target === 'background' ? ',lutyuv=y=negval' : '';
  graph.push(`[${labelIn}]split[selA${idx}][selB${idx}]`);
  // a korrekció a MÁSOLATON fut, majd a maszk szerint keveredik vissza
  // (a maskedmerge minden bemenete gbrp — különben gray-re tárgyalna le)
  graph.push(`[selB${idx}]${adjust.slice(1)},format=gbrp[selC${idx}]`);
  graph.push(`[selA${idx}]format=gbrp[selD${idx}]`);
  graph.push(
    `[${aIdx}:v]scale=${W}:${H},format=gray${invert},format=gbrp[selM${idx}]`
  );
  graph.push(
    `[selD${idx}][selC${idx}][selM${idx}]maskedmerge,format=yuv420p[${labelOut}]`
  );
  return true;
}

/**
 * 🙈 Arc-elmosás (adatvédelem): a régió KIVÁGVA elmosódik és visszakerül a
 * helyére — így a szűrő csak a kis területen fut (gyors), és a kép többi
 * része érintetlen marad. A régió statikus (a mintavett arcok uniója+margó),
 * páros pixelekre igazítva; a `pixelate` mozaikot ad lágy blur helyett.
 */
function faceBlurChain(clip, W, H, labelIn, labelOut, idx, graph, skip = 0) {
  const fb = clip.faceBlur;
  if (!fb) {
    return false;
  }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const bw = even(Math.min(1, Math.max(0.03, fb.w)) * W);
  const bh = even(Math.min(1, Math.max(0.03, fb.h)) * H);
  const strength = Math.min(2, Math.max(0.3, fb.strength ?? 1));
  // mozaik: a régió ~14 blokk szélesre zsugorodik, majd pont-mintásan vissza —
  // a blokkméret így a régió MÉRETÉHEZ igazodik (felismerhetetlen arc), nem
  // fix pixelszámhoz
  const blocks = Math.max(4, Math.round(14 / strength));
  const effect = fb.pixelate
    ? `scale=${Math.max(2, blocks)}:${Math.max(
        2,
        Math.round((blocks * bh) / bw)
      )},scale=${bw}:${bh}:flags=neighbor`
    : `gblur=sigma=${(Math.min(bw, bh) * 0.09 * strength).toFixed(1)}`;

  // 🎯 KÖVETÉS: fix méretű régió, mozgó középpont — a crop/overlay x/y per-frame
  // T-kifejezés (T = szűrő-idő + skip = klip-lokális). Track nélkül statikus.
  const track = Array.isArray(fb.track) && fb.track.length > 0 ? [...fb.track].sort((a, b) => a.t - b.t) : null;
  let bxTok;
  let byTok;
  if (track) {
    const T = `(t+${skip.toFixed(3)})`;
    const px5 = (v) => Number(v).toFixed(5);
    const axisExpr = (axis, fb0) => {
      const fr = track.map((p) => ({ t: p.t, v: p[axis] ?? fb0 }));
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
    // középpont → bal-felső sarok, a képkeretre klippelve
    bxTok = `clip((${axisExpr('x', fb.x)})*${W}-${bw / 2},0,${W - bw})`;
    byTok = `clip((${axisExpr('y', fb.y)})*${H}-${bh / 2},0,${H - bh})`;
  } else {
    bxTok = String(even(Math.min(W - bw, Math.max(0, (fb.x - fb.w / 2) * W))));
    byTok = String(even(Math.min(H - bh, Math.max(0, (fb.y - fb.h / 2) * H))));
  }
  graph.push(`[${labelIn}]split[fbA${idx}][fbB${idx}]`);
  graph.push(`[fbB${idx}]crop=w=${bw}:h=${bh}:x='${bxTok}':y='${byTok}',${effect}[fbC${idx}]`);
  graph.push(`[fbA${idx}][fbC${idx}]overlay=x='${bxTok}':y='${byTok}'[${labelOut}]`);
  return true;
}

/**
 * 🎭 Track/luma/alpha matte: egy külső média (kép) fényereje (luma) vagy alfája
 * adja a klip átlátszóságát. A matte WxH-ra skálázva → gray/alphaextract (opc.
 * negate) → a fg-alfával szorozva (alphamerge). Visszaadja az új címkét, vagy a
 * bemenetit, ha nincs matte.
 */
function matteChain(clip, W, H, labelIn, idx, graph, addInput, dur) {
  const m = clip.matte;
  if (!m || !m.uri) {
    return labelIn;
  }
  // 🛡️ csak HELYI fájl mehet az `-i`-re (séma-előtag → a matte kimarad)
  const mattePath = localPathOnly(m.uri);
  if (!mattePath) {
    return labelIn;
  }
  const mIdx = addInput(['-loop', '1', '-t', dur.toFixed(3), '-i', mattePath]);
  const inv = m.invert ? ',negate' : '';
  if (m.type === 'alpha') {
    graph.push(`[${mIdx}:v]scale=${W}:${H},format=rgba,alphaextract${inv}[mta${idx}]`);
  } else {
    graph.push(`[${mIdx}:v]scale=${W}:${H},format=gray${inv}[mta${idx}]`);
  }
  graph.push(`[${labelIn}]split[mtf${idx}][mtfa${idx}]`);
  graph.push(`[mtfa${idx}]alphaextract[mtae${idx}]`);
  graph.push(`[mtae${idx}][mta${idx}]blend=all_mode=multiply:shortest=1[mtab${idx}]`);
  graph.push(`[mtf${idx}][mtab${idx}]alphamerge[mtm${idx}]`);
  return `mtm${idx}`;
}

/**
 * ✂️ Chroma-él igazítás (matte choke/grow): a kulcsolt fg alfáján `erosion`
 * (edge<0 = perem megevése) vagy `dilation` (edge>0 = növelés) |edge|·4 menetben.
 * Visszaadja az új címkét, vagy a bemenetit, ha nincs edge.
 */
function edgeChain(clip, labelIn, idx, graph) {
  const e = clip.chromaKey && clip.chromaKey.edge;
  if (!e) {
    return labelIn;
  }
  const passes = Math.min(4, Math.max(1, Math.round(Math.abs(e) * 4)));
  const op = Array(passes).fill(e < 0 ? 'erosion' : 'dilation').join(',');
  graph.push(`[${labelIn}]split[egf${idx}][egfa${idx}]`);
  graph.push(`[egfa${idx}]alphaextract,${op}[ega${idx}]`);
  graph.push(`[egf${idx}][ega${idx}]alphamerge[egm${idx}]`);
  return `egm${idx}`;
}

module.exports = { selectiveChain, faceBlurChain, matteChain, edgeChain };
