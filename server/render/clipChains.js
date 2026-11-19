// 🧩 Klip-geometria és kompozit-láncok (dőlés, nyírás, perspektíva, chroma, maszk, megjelenés,
// kulcskocka-mozgás, 2.5D parallax, transzform). A renderProject zárványából kiemelve: a láncok a
// render-környezetet (W, H, FPS, graph, addInput) a `createClipChains(rc)` paraméterén át kapják.
const fs = require('fs');
const path = require('path');

const { depthLayerDir } = require('../depth');
const { perspectiveFilter } = require('../imageFilters');
const { shearPoint } = require('./effects');
const { kfChannelExpr } = require('./keyframeExpr');

/**
 * @param rc a render-környezet: { W, H, FPS, graph, addInput } (a renderProject-ből)
 */
function createClipChains(rc) {
  const { W, H, FPS, graph, addInput } = rc;

  const hasTilt = (clip) =>
    Boolean(
      clip.tilt3d && ((clip.tilt3d.rotX ?? 0) !== 0 || (clip.tilt3d.rotY ?? 0) !== 0)
    );

  // 📐 corner-pin / perspektíva-dőlés (VIDEOT §4) — a transform perspectiveX/Y-ja
  const hasPersp = (clip) =>
    Boolean(clip.transform && ((clip.transform.perspectiveX ?? 0) !== 0 || (clip.transform.perspectiveY ?? 0) !== 0));

  // a KLIP frame-jére (W×H-ra skálázva) a Kép Stúdió perspektíva-filtere (átlátszó OOB)
  const perspChain = (clip) =>
    hasPersp(clip) ? perspectiveFilter(clip.transform.perspectiveX, clip.transform.perspectiveY, W, H) : '';

  const hasTransform = (clip) =>
    (clip.transform &&
      (clip.transform.scale !== 1 ||
        clip.transform.x !== 0 ||
        clip.transform.y !== 0 ||
        (clip.transform.rotation ?? 0) !== 0)) ||
    (clip.opacity ?? 1) < 1 ||
    hasTilt(clip) ||
    hasPersp(clip);

  /** a döntött kép túlnyúlhat az eredeti kereten — ekkora átlátszó margót kap */
  const TILT_PAD = 1.3;

  /**
   * Térbeli döntés (🧊 3D V1): a kliens-előnézet CSS-konvenciójával megegyező
   * perspektivikus warp. A forrás átlátszó margót kap (a kereten kívülre
   * vetülő sarkok ne csorbuljanak, a négyszögön kívül alfa=0 maradjon), majd a
   * perspective szűrő sense=destination módban a NÉGY VETÍTETT SAROKRA képezi
   * a képet. A sarkok W/H-kifejezések (a fit-méret előre nem ismert); a
   * fókusztáv (W+H)*0.75 ≈ 1.2·max(W,H) — vesszőtlen kifejezés, mert a
   * filtergraphban a vessző szűrőhatár.
   */
  const tiltChain = (clip) => {
    if (!hasTilt(clip)) {
      return '';
    }
    const rad = (deg) => (Math.max(-45, Math.min(45, deg)) * Math.PI) / 180;
    const rx = rad(clip.tilt3d.rotX ?? 0);
    const ry = rad(clip.tilt3d.rotY ?? 0);
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const n = (v) => v.toFixed(6);
    const F = `(W+H)*0.75`;
    // CSS-sorrend: rotateY, majd rotateX; nézőpont +z-n, k = F/(F−z)
    const corner = (u, v) => {
      const g = 2 * TILT_PAD; // a tartalom fél-mérete a paddelt keretben: W/g, H/g
      const xw = (u * cosY) / g;
      const yw = (u * sinY * sinX) / g;
      const yh = (v * cosX) / g;
      const zw = (-u * sinY * cosX) / g;
      const zh = (v * sinX) / g;
      const K = `${F}/(${F}-(W*${n(zw)}+H*${n(zh)}))`;
      return {
        x: `W/2+W*${n(xw)}*${K}`,
        y: `H/2+(W*${n(yw)}+H*${n(yh)})*${K}`,
      };
    };
    const tl = corner(-1, -1);
    const tr = corner(1, -1);
    const bl = corner(-1, 1);
    const br = corner(1, 1);
    return (
      `,format=yuva444p,` +
      `pad=trunc(iw*${TILT_PAD}/2)*2:trunc(ih*${TILT_PAD}/2)*2:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,` +
      `perspective=x0='${tl.x}':y0='${tl.y}':x1='${tr.x}':y1='${tr.y}':` +
      `x2='${bl.x}':y2='${bl.y}':x3='${br.x}':y3='${br.y}':sense=destination,` +
      `format=rgba`
    );
  };

  // ⬛ Nyírás (skew/shear) — audit §6.6. KÜLÖN pass (a tiltChain-t NEM érinti → a
  // bizonyított tilt-render változatlan). A kliens `shearPoint`-jával azonos matek:
  //   us = u + v·tan(skewX),  vs = v + u·tan(skewY)   (centrált egységnégyzet u,v∈{-1,1})
  // majd a tiltChain-nel AZONOS perspektíva-filter + sarok-konvenció. Guardolt: skew
  // nélkül üres → nincs pass. ⚠️ Élő ffmpeg-gel verifikálandó (runtime-verify).
  const hasSkew = (clip) => {
    const t = clip.transform;
    return !!t && (((t.skewX ?? 0) !== 0) || ((t.skewY ?? 0) !== 0));
  };
  const skewPad = (clip) => {
    const t = clip.transform ?? {};
    const tx = Math.abs(Math.tan((Math.max(-45, Math.min(45, t.skewX ?? 0)) * Math.PI) / 180));
    const ty = Math.abs(Math.tan((Math.max(-45, Math.min(45, t.skewY ?? 0)) * Math.PI) / 180));
    return 1 + Math.max(tx, ty); // hogy a nyírt sarok beférjen a paddelt keretbe
  };
  const skewChain = (clip) => {
    if (!hasSkew(clip)) {
      return '';
    }
    const t = clip.transform;
    // a ±45° biztonsági clamp a workeré; a nyírás-matek a KÖZÖS `shearPoint` (== kliens)
    const cx = Math.max(-45, Math.min(45, t.skewX ?? 0));
    const cy = Math.max(-45, Math.min(45, t.skewY ?? 0));
    const PAD = skewPad(clip);
    const g = 2 * PAD;
    const n = (v) => v.toFixed(6);
    // centrált sarok (u,v) → nyírva → paddelt keret-pozíció (perspektíva-divide nincs: affin)
    const pt = (u, v) => {
      const s = shearPoint(u, v, cx, cy);
      return { x: `W/2+W*${n(s.x / g)}`, y: `H/2+H*${n(s.y / g)}` };
    };
    const tl = pt(-1, -1);
    const tr = pt(1, -1);
    const bl = pt(-1, 1);
    const br = pt(1, 1);
    return (
      `,format=yuva444p,` +
      `pad=trunc(iw*${PAD.toFixed(4)}/2)*2:trunc(ih*${PAD.toFixed(4)}/2)*2:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,` +
      `perspective=x0='${tl.x}':y0='${tl.y}':x1='${tr.x}':y1='${tr.y}':` +
      `x2='${bl.x}':y2='${bl.y}':x3='${br.x}':y3='${br.y}':sense=destination,` +
      `format=rgba`
    );
  };

  /** green screen (P0-10): a kulcs-szín átlátszóvá válik + opcionális spill-suppression */
  const chromaChain = (clip) => {
    const c = clip.chromaKey;
    if (!c) {
      return '';
    }
    const hex = String(c.color || '#00ff00').replace('#', '');
    const color = '0x' + hex;
    const sim = Math.min(0.45, Math.max(0.02, c.similarity ?? 0.18));
    const blend = Math.min(0.3, Math.max(0, c.blend ?? 0.05));
    let s = `,chromakey=color=${color}:similarity=${sim.toFixed(3)}:blend=${blend.toFixed(3)}`;
    // 🟢 spill-suppression: a kulcs-szín visszaverődésének (zöld/kék perem)
    // eltávolítása a témáról — az ffmpeg `despill` szűrőjével, a kulcs-szín
    // domináns csatornájából kikövetkeztetett típussal (green/blue)
    if (c.spill) {
      const r = parseInt(hex.slice(0, 2) || '0', 16);
      const g = parseInt(hex.slice(2, 4) || '0', 16);
      const b = parseInt(hex.slice(4, 6) || '0', 16);
      const type = b > g && b >= r ? 'blue' : 'green';
      const mix = Math.min(1, Math.max(0.1, typeof c.spill === 'number' ? c.spill : 0.5));
      s += `,despill=type=${type}:mix=${mix.toFixed(2)}:expand=${(mix * 0.4).toFixed(2)}`;
    }
    return s;
  };

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

  /**
   * forgatás + átlátszóság lánc az overlay-útvonal forrására (rgba-ban).
   * `skip` = a szegmens kezdete a klipen belül (mp) — a kulcskocka-idő
   * klip-lokális, a szűrő-idő szegmens-lokális, ezért T = szűrő-idő + skip.
   *
   * Kulcskockás forgatás/átlátszóság esetén PER-FRAME (a kliens
   * src/lib/keyframes.ts görbéivel megegyező kifejezés); a kimeret ilyenkor =
   * bemeret (nincs pad/overlay-ütközés a withKeyframeMotionnel). Kulcskocka
   * nélkül a régi statikus út fut — a meglévő renderek bitre változatlanok.
   */
  const appearanceChain = (clip, skip = 0) => {
    let s = chromaChain(clip) + ',format=rgba';
    const k = clip.keyframes ?? {};
    if (k.rotation && k.rotation.length > 0) {
      // rotate: a `t` a szűrő (szegmens-lokális) ideje → klip-idő = t + skip
      const T = `(t+${skip.toFixed(3)})`;
      const degExpr = kfChannelExpr(k.rotation, clip.transform?.rotation ?? 0, T);
      s += `,rotate=a='(${degExpr})*PI/180':c=black@0`;
    } else {
      const rotation = clip.transform?.rotation ?? 0;
      if (rotation !== 0) {
        const rad = ((rotation % 360) * Math.PI) / 180;
        s += `,rotate=${rad.toFixed(5)}:ow=rotw(${rad.toFixed(5)}):oh=roth(${rad.toFixed(5)}):c=black@0`;
      }
    }
    if (k.opacity && k.opacity.length > 0) {
      // geq per-frame alfa: a geq idő-változója `T` (nagybetű) → klip-idő = T + skip
      const Tg = `(T+${skip.toFixed(3)})`;
      const opExpr = kfChannelExpr(k.opacity, clip.opacity ?? 1, Tg);
      s += `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip((${opExpr}),0,1)*alpha(X,Y)'`;
    } else {
      const opacity = clip.opacity ?? 1;
      if (opacity < 1) {
        s += `,colorchannelmixer=aa=${opacity.toFixed(3)}`;
      }
    }
    return s;
  };

  /** elmosott, sötétített cover-változat háttérnek (blur-kitöltés) */
  const blurBackgroundChain =
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    `gblur=sigma=28,eq=brightness=-0.06,format=yuv420p,setsar=1`;

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
    hasTilt,
    hasPersp,
    perspChain,
    hasTransform,
    TILT_PAD,
    tiltChain,
    hasSkew,
    skewPad,
    skewChain,
    chromaChain,
    polyWExpr,
    staticPoly,
    withMask,
    appearanceChain,
    blurBackgroundChain,
    hasKf,
    withKeyframeMotion,
    withDepthParallax,
    withTransform,
  };
}

module.exports = { createClipChains };
