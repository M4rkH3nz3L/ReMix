// 🟢 Megjelenés: chroma-kulcs (+despill), forgatás/átlátszóság (kulcskockával is), blur-kitöltésű háttér (a clipChains.js-ből).
const { kfChannelExpr } = require('../keyframeExpr');

/**
 * @param rc a render-környezet: { W, H } (a createClipChains-en át a renderProject-ből)
 */
function createAppearanceChains(rc) {
  const { W, H } = rc;

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

  return {
    chromaChain,
    appearanceChain,
    blurBackgroundChain,
  };
}

module.exports = { createAppearanceChains };
