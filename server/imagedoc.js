// 🎨 Kép-dokumentum rasterizáló (Creative Canvas V1): réteg-fa → PNG.
//
// ELV: a formákat és a feliratokat UGYANAZOK a generátorok rajzolják, mint az
// idővonalon (text-render.js) — nem külön HTML-lel, mert két külön generátor
// előbb-utóbb szétcsúszna, és a képben mást látnál, mint a videóban. A rétegek
// külön PNG-be mennek, majd ffmpeg-gel, RAJZOLÁSI SORRENDBEN egymásra
// komponálódnak; a fotó-rétegek skálázása/vágása is itt történik.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const { adjustChain } = require('./render');
const { renderShapePngs, renderTextPngs } = require('./text-render');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).slice(-1500))) : resolve()
    );
  });
}

/** a vászon mérete az arányból (a rövidebb oldal a megadott felbontás) */
function canvasSize(aspectRatio, height) {
  const [aw, ah] = String(aspectRatio || '9:16')
    .split(':')
    .map((v) => Number(v) || 1);
  const H = Math.round(height / 2) * 2;
  const W = Math.round((H * aw) / ah / 2) * 2;
  return { w: W, h: H };
}

/** a réteg rajzolódik-e (a klienssel AZONOS szabály — lásd imageDoc.ts) */
function isVisible(layer) {
  return !layer.hidden && (layer.opacity ?? 1) > 0.001;
}

/**
 * A `fill` réteg úgy megy át a forma-generátoron, mint egy vászon-méretű
 * téglalap — így a gradiens-kezelés is közös, nem kell külön ág.
 */
function fillAsShape(layer) {
  return {
    kind: 'shape',
    id: layer.id,
    shape: 'rectangle',
    position: { x: 0.5, y: 0.5 },
    w: 1,
    h: 1,
    fill: layer.fill,
    fillGradient: layer.fillGradient,
    gradient: layer.gradient,
  };
}

/**
 * A réteg-fa kirasterizálása.
 * @param doc {{aspectRatio, layers}}
 * @param height a vászon magassága pixelben
 * @param workDir munkakönyvtár (a hívó takarítja)
 * @returns {Promise<string>} a kész PNG útvonala
 */
async function renderImageDoc(doc, height, workDir) {
  const canvas = canvasSize(doc.aspectRatio, height);
  const layers = (doc.layers ?? []).filter(isVisible);
  if (layers.length === 0) {
    throw new Error('A dokumentumnak nincs látható rétege.');
  }

  // 1) a forma- és szöveg-rétegek a MEGLÉVŐ generátorokkal PNG-be
  const shapeLike = layers
    .filter((l) => l.kind === 'shape' || l.kind === 'fill')
    .map((l) => (l.kind === 'fill' ? fillAsShape(l) : { ...l, kind: 'shape' }));
  const textLike = layers
    .filter((l) => l.kind === 'text')
    .map((l) => ({ ...l, kind: 'text', animation: 'none', start: 0, duration: 1 }));

  const rendered = new Map(); // layer.id → png útvonal
  if (shapeLike.length > 0) {
    for (const entry of await renderShapePngs(shapeLike, canvas, workDir)) {
      rendered.set(entry.clip.id, entry.states[0].file);
    }
  }
  if (textLike.length > 0) {
    for (const entry of await renderTextPngs(textLike, canvas, workDir)) {
      rendered.set(entry.clip.id, entry.states[0].file);
    }
  }

  // 2) ffmpeg-kompozit rajzolási sorrendben
  const inputs = ['-f', 'lavfi', '-i', `color=black@0:s=${canvas.w}x${canvas.h}`];
  const filters = [];
  let last = '[0:v]';
  let idx = 1;

  filters.push(`${last}format=rgba[base]`);
  last = '[base]';

  for (const layer of layers) {
    const opacity = Math.min(1, Math.max(0, layer.opacity ?? 1));
    let prepared;

    if (layer.kind === 'photo') {
      if (!layer.uri || !fs.existsSync(layer.uri)) {
        continue; // hiányzó média — a réteg kimarad, a többi mehet
      }
      inputs.push('-i', layer.uri);
      const boxW = Math.max(2, Math.round((layer.w ?? 1) * canvas.w));
      const boxH = Math.max(2, Math.round((layer.h ?? 1) * canvas.h));
      // 'cover' kitölti a keretet (a túllógó rész levágódik), 'contain' belefér
      const fit =
        layer.fit === 'contain'
          ? `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,` +
            `pad=${boxW}:${boxH}:(ow-iw)/2:(oh-ih)/2:color=black@0`
          : `scale=${boxW}:${boxH}:force_original_aspect_ratio=increase,` +
            `crop=${boxW}:${boxH}`;
      const rotate = layer.rotation
        ? `,rotate=${((layer.rotation * Math.PI) / 180).toFixed(5)}:c=black@0:ow=rotw(iw):oh=roth(ih)`
        : '';
      prepared = `p${idx}`;
      filters.push(
        `[${idx}:v]${fit},format=rgba${adjustChain(layer)}${rotate}` +
          `,colorchannelmixer=aa=${opacity.toFixed(3)}[${prepared}]`
      );
      idx += 1;
    } else {
      const png = rendered.get(layer.id);
      if (!png || !fs.existsSync(png)) {
        continue;
      }
      inputs.push('-i', png);
      prepared = `p${idx}`;
      filters.push(
        `[${idx}:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[${prepared}]`
      );
      idx += 1;
    }

    // elhelyezés: a réteg KÖZÉPPONTJA a `position`, a fill a teljes vászon
    const out = `c${idx}`;
    if (layer.kind === 'fill') {
      filters.push(`${last}[${prepared}]overlay=0:0[${out}]`);
    } else {
      const cx = (layer.position?.x ?? 0.5) * canvas.w;
      const cy = (layer.position?.y ?? 0.5) * canvas.h;
      filters.push(
        `${last}[${prepared}]overlay=${Math.round(cx)}-overlay_w/2:` +
          `${Math.round(cy)}-overlay_h/2[${out}]`
      );
    }
    last = `[${out}]`;
  }

  const outFile = path.join(workDir, 'imagedoc.png');
  await run([
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    last,
    '-frames:v',
    '1',
    '-y',
    outFile,
  ]);
  return outFile;
}

module.exports = { renderImageDoc, canvasSize };
