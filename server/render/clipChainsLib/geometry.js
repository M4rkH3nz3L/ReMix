// 📐 Klip-geometria: 3D-dőlés, corner-pin perspektíva, nyírás (skew), transzform-detektálás (a clipChains.js-ből).
const { perspectiveFilter } = require('../../imageFilters');
const { shearPoint } = require('../effects');

/**
 * @param rc a render-környezet: { W, H } (a createClipChains-en át a renderProject-ből)
 */
function createGeometryChains(rc) {
  const { W, H } = rc;

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
  };
}

module.exports = { createGeometryChains };
