// 🎬 Mozgás és kompozit: kulcskocka zoom/pan, 2.5D parallax, transzformált overlay (a clipChains.js-ből).
const fs = require('fs');
const path = require('path');

const { depthLayerDir } = require('../../depth');
const { kfChannelExpr } = require('../keyframeExpr');

/**
 * @param rc a render-környezet: { W, H, FPS, graph, addInput } (a createClipChains-en át a renderProject-ből)
 * @param geo a createGeometryChains(rc) eredménye (dőlés/nyírás-margó a pad-mérethez)
 */
function createMotionChains(rc, geo) {
  const { W, H, FPS, graph, addInput } = rc;
  const { hasTilt, TILT_PAD, hasSkew, skewPad } = geo;

  const hasKf = (clip) => {
    const k = clip.keyframes;
    // a forgatás/átlátszóság kulcskocka is ide sorolja a klipet, hogy az
    // appearanceChain per-frame úton fusson (a motion scale/pan no-op marad)
    return Boolean(
      k &&
        ['scale', 'x', 'y', 'rotation', 'opacity'].some(
          (c) => Array.isArray(k[c]) && k[c].length > 0
        )
    );
  };

  /**
   * Animált zoom/pan lánc: a fit-méretű (rgba) forrás per-frame skálázást kap,
   * fix méretű átlátszó padbe kerül (a változó frame-méret overlay-be nem
   * mehet — lásd a pop-animáció tanulságait), majd az alapra overlay-eződik
   * t-függő x/y kifejezéssel. T = t + skip (a szegmens a klip belsejében is
   * kezdődhet takarás miatt).
   */
  const withKeyframeMotion = (i, fitLabel, clip, seg, suffix, baseLabel, dur) => {
    const T = `(t+${seg.skip.toFixed(3)})`;
    const k = clip.keyframes ?? {};
    const base = clip.transform ?? { scale: 1, x: 0, y: 0 };
    const maxScale = Math.min(
      Math.max(base.scale ?? 1, ...(k.scale ?? []).map((kf) => kf.value), 1),
      4
    );
    const tiltGrow = hasTilt(clip) ? TILT_PAD : 1;
    const skewGrow = hasSkew(clip) ? skewPad(clip) : 1; // ⬛ a nyírt tartalom se vágódjon le
    const padW = Math.ceil((W * maxScale * tiltGrow * skewGrow) / 2) * 2 + 2;
    const padH = Math.ceil((H * maxScale * tiltGrow * skewGrow) / 2) * 2 + 2;
    const S = kfChannelExpr(k.scale, base.scale ?? 1, T);
    const OX = `(${kfChannelExpr(k.x, base.x ?? 0, T)})*${W}`;
    const OY = `(${kfChannelExpr(k.y, base.y ?? 0, T)})*${H}`;
    let baseIn = baseLabel;
    if (!baseIn) {
      baseIn = `kbase${i}`;
      graph.push(
        `color=black:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuv420p,setsar=1[${baseIn}]`
      );
    }
    graph.push(
      `[${fitLabel}]scale=w='max(2,trunc(iw*${S}))':h='max(2,trunc(ih*${S}))':eval=frame,` +
        `pad=${padW}:${padH}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame,format=rgba[kfg${i}]`
    );
    graph.push(
      `[${baseIn}][kfg${i}]overlay=x='(${W}-w)/2+${OX}':y='(${H}-h)/2+${OY}':shortest=0` +
        suffix +
        `[seg${i}]`
    );
  };

  /**
   * 🏔️ 2.5D parallax (🧊 3D V1): a fotó worker-oldalon készült fg/mid/bg
   * rétegei EGY kameramozgást kapnak eltérő erővel (bg 0,35× · mid 0,7× ·
   * fg 1×) — a mélység illúzióját a rétegek egymáshoz képesti elmozdulása
   * adja. A bg kis extra zoomot kap, hogy a mozgásnál ne lásson ki a széle.
   * A rétegek cover-fitben pontosan fedik egymást (mint a lapos fotó), a
   * mozgás a kulcskocka-motor t-kifejezéseivel megy. Visszatérés: sikerült-e
   * (ha a rétegek hiányoznak, a hívó lapos fotóként rendereli).
   */
  const withDepthParallax = (i, clip, seg, suffix, label) => {
    const dp = clip.depthParallax;
    const dir = depthLayerDir(dp.id);
    const names = ['bg', 'mid', 'fg'];
    if (!names.every((n) => fs.existsSync(path.join(dir, `${n}.png`)))) {
      return false;
    }
    const strength = Math.min(1.5, Math.max(0.3, dp.strength ?? 1));
    const T = `(t+${seg.skip.toFixed(3)})`;
    const hasMotion = hasKf(clip);
    // kameramozgás nélkül is éljen a mélység: lágy push-in + oldalpan az alap
    const base = hasMotion
      ? clip.keyframes
      : {
          scale: [
            { time: 0, value: 1.04, easing: 'easeInOut' },
            { time: clip.duration, value: 1.16, easing: 'easeInOut' },
          ],
          x: [
            { time: 0, value: 0.03, easing: 'easeInOut' },
            { time: clip.duration, value: -0.03, easing: 'easeInOut' },
          ],
        };
    // csatorna gyengítése a semleges felé + szorzó (bg extra zoom)
    const damp = (kfs, neutral, f, mul = 1) =>
      (kfs ?? []).map((kf) => ({
        ...kf,
        value: (neutral + (kf.value - neutral) * f) * mul,
      }));
    const layerSpecs = [
      { name: 'bg', f: 0.35 * strength, zoom: 1.09 },
      { name: 'mid', f: 0.7 * strength, zoom: 1 },
      { name: 'fg', f: 1.0 * strength, zoom: 1 },
    ];
    let acc = `dpbase${i}`;
    graph.push(
      `color=black:s=${W}x${H}:r=${FPS}:d=${seg.duration.toFixed(3)},format=yuv420p,setsar=1[${acc}]`
    );
    layerSpecs.forEach((spec, li) => {
      const idx = addInput([
        '-loop', '1',
        '-t', seg.duration.toFixed(3),
        '-i', path.join(dir, `${spec.name}.png`),
      ]);
      const scaleKfs = damp(base.scale, 1, spec.f, spec.zoom);
      const xKfs = damp(base.x, 0, spec.f);
      const yKfs = damp(base.y, 0, spec.f);
      const maxScale = Math.min(
        Math.max(spec.zoom, ...scaleKfs.map((kf) => kf.value), 1),
        4
      );
      const padW = Math.ceil((W * maxScale) / 2) * 2 + 2;
      const padH = Math.ceil((H * maxScale) / 2) * 2 + 2;
      const S = kfChannelExpr(scaleKfs, spec.zoom, T);
      const OX = `(${kfChannelExpr(xKfs, 0, T)})*${W}`;
      const OY = `(${kfChannelExpr(yKfs, 0, T)})*${H}`;
      graph.push(
        `[${idx}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H},setsar=1,format=rgba,` +
          `scale=w='max(2,trunc(iw*${S}))':h='max(2,trunc(ih*${S}))':eval=frame,` +
          `pad=${padW}:${padH}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame,format=rgba[dpl${i}_${li}]`
      );
      const last = li === layerSpecs.length - 1;
      const out = last ? label : `dpacc${i}_${li}`;
      graph.push(
        `[${acc}][dpl${i}_${li}]overlay=x='(${W}-w)/2+${OX}':y='(${H}-h)/2+${OY}':shortest=0` +
          (last ? suffix : '') +
          `[${out}]`
      );
      acc = out;
    });
    return true;
  };

  /**
   * A transzformált klip az alapjára kerül overlay-jel: a méretezés után a
   * középponthoz képest x·W / y·H eltolással — az app előnézetével megegyező
   * módon. Az alap fekete, vagy blur-kitöltésnél a klip elmosott cover-je
   * (baseLabel).
   */
  const withTransform = (i, srcLabel, clip, dur, suffix, baseLabel) => {
    const t = clip.transform;
    let ox = Math.round((t?.x ?? 0) * W);
    let oy = Math.round((t?.y ?? 0) * H);
    // ⚓ anchor-pivot (§2.6): az ffmpeg `rotate` a KÖZÉP körül forgat; a pivot körüli forgatás =
    // középforgatás + egy overlay-eltolás  delta = (I − Rθ)·d,  d = (anchor − 0.5)·box.
    // Csak STATIKUS forgatás + EGYEDI anchorra (kf-forgatás/alap-közép = bitre változatlan).
    const rot = t?.rotation ?? 0;
    const kfRot = clip.keyframes?.rotation?.length;
    const customAnchor = (t?.anchorX !== undefined && t.anchorX !== 0.5) || (t?.anchorY !== undefined && t.anchorY !== 0.5);
    if (rot !== 0 && !kfRot && customAnchor) {
      const scale = t?.scale ?? 1;
      const dx = ((t.anchorX ?? 0.5) - 0.5) * W * scale;
      const dy = ((t.anchorY ?? 0.5) - 0.5) * H * scale;
      const th = ((rot % 360) * Math.PI) / 180;
      const cos = Math.cos(th);
      const sin = Math.sin(th);
      ox += Math.round(dx - (dx * cos - dy * sin));
      oy += Math.round(dy - (dx * sin + dy * cos));
    }
    let base = baseLabel;
    if (!base) {
      base = `tbase${i}`;
      graph.push(
        `color=black:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuv420p,setsar=1[${base}]`
      );
    }
    const out = `seg${i}`;
    graph.push(
      `[${base}][${srcLabel}]overlay=x=(${W}-w)/2+${ox}:y=(${H}-h)/2+${oy}:shortest=0` +
        suffix +
        `[${out}]`
    );
    return out;
  };

  return {
    hasKf,
    withKeyframeMotion,
    withDepthParallax,
    withTransform,
  };
}

module.exports = { createMotionChains };
