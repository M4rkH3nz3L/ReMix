// 🖼️ Szövegklipek rasterizálása átlátszó PNG-kké headless Chromiummal (állapotonként egy PNG) + Text → Shape bake.
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findChromium } = require('./chromium');
const { fontFaceCss, fontFamilyCss } = require('./fontFaces');
const { typographyCss, textStyleCss, presetCss, textTransformCss } = require('./textCss');
const { statesFor } = require('./textStates');
const { text3dHtml, textPathHtml } = require('./textHtml');

/**
 * @param textClips a projekt szövegklipjei
 * @param canvas {w,h} render-felbontás
 * @param outDir ide kerülnek a PNG-k
 * @returns [{clip, states: [{file, from, to}]}]
 */
async function renderTextPngs(textClips, canvas, outDir) {
  if (textClips.length === 0) {
    return [];
  }
  // a forgatott doboz túlnyúlhat a vásznon → ilyenkor a raszter-ablak az átló négyzete
  const needsRoom = textClips.some((c) => textTransformCss(c));
  const roomSide = Math.ceil(Math.hypot(canvas.w, canvas.h));
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('Nincs elérhető Chromium a felirat-rasterizáláshoz (CHROMIUM_PATH?)');
  }
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({
    viewport: needsRoom ? { width: roomSide, height: roomSide } : { width: canvas.w, height: canvas.h },
    deviceScaleFactor: 1,
  });
  const results = [];
  try {
    for (let i = 0; i < textClips.length; i++) {
      const clip = textClips[i];
      const fontPx = (clip.fontSize / 100) * canvas.h;

      // 3D szöveg: saját kétrétegű HTML, egyetlen állapottal (a typewriter/
      // karaoke fázisok 3D-ben v1-ben nem kombinálódnak)
      if (clip.text3d) {
        await page.setContent(text3dHtml(clip, fontPx, canvas.w));
        await page.evaluate((text) => {
          document.querySelector('.d').textContent = text;
          document.querySelector('.f').textContent = text;
        }, clip.text);
        const el3 = page.locator('#t');
        await page.evaluate(() => document.fonts.ready);
        const file3 = path.join(outDir, `text_${i}_0.png`);
        const box3 = await el3.boundingBox();
        await el3.screenshot({ path: file3, omitBackground: true });
        results.push({
          clip,
          states: [
            {
              file: file3,
              from: 0,
              to: null,
              w: Math.ceil(box3?.width ?? 0),
              h: Math.ceil(box3?.height ?? 0),
            },
          ],
        });
        continue;
      }

      // 🛤️ Szöveg görbe mentén (text path): SVG textPath, egyetlen állapot
      if (clip.textPath) {
        await page.setContent(textPathHtml(clip, fontPx, canvas.w));
        await page.evaluate(() => document.fonts.ready);
        const elp = page.locator('#t');
        const filep = path.join(outDir, `text_${i}_0.png`);
        const boxp = await elp.boundingBox();
        await elp.screenshot({ path: filep, omitBackground: true });
        results.push({
          clip,
          states: [
            {
              file: filep,
              from: 0,
              to: null,
              w: Math.ceil(boxp?.width ?? 0),
              h: Math.ceil(boxp?.height ?? 0),
            },
          ],
        });
        continue;
      }

      const tf = textTransformCss(clip);
      const html = `<!doctype html><html><body style="margin:0;background:transparent;display:flex;${
        tf ? 'align-items:center;justify-content:center;width:100vw;height:100vh;' : 'align-items:flex-start;justify-content:flex-start;'
      }">
        <style>${fontFaceCss(clip.fontFamily, clip.fontUri)}</style>
        <div id="t" style="
          display:inline-block;
          ${clip.boxWidth > 0 ? `width:${Math.round(clip.boxWidth * canvas.w)}px;box-sizing:border-box;` : `max-width:${Math.round(canvas.w * 0.92)}px;`}
          font-family: ${fontFamilyCss(clip.fontFamily, clip.fontUri)};
          font-size:${fontPx}px;
          font-weight:${clip.fontWeight === 'bold' ? 700 : 400};
          font-style:${clip.fontStyle === 'italic' ? 'italic' : 'normal'};
          color:${clip.color};
          text-align:${['left', 'right', 'justify'].includes(clip.textAlign) ? clip.textAlign : 'center'};
          line-height:1.25;
          white-space:pre-wrap;
          word-wrap:break-word;
          ${presetCss(clip, fontPx)}
          ${typographyCss(clip)}
          ${textStyleCss(clip, fontPx)}
          ${tf ? `transform:${tf};transform-origin:50% 50%;` : ''}
        "></div>
      </body></html>`;
      const states = statesFor(clip);
      const rendered = [];
      for (let s = 0; s < states.length; s++) {
        await page.setContent(html);
        await page.evaluate((content) => {
          const el = document.getElementById('t');
          if (content.mode === 'plain') {
            el.textContent = content.text;
            return;
          }
          el.textContent = '';
          const hasEmp = content.words.some((w) => w.emp);
          if (hasEmp) {
            // a 3D-be pattanó szó túlnyúlik a sorközön — legyen hely a dobozban
            el.style.padding = '0.45em 0.5em';
          }
          content.words.forEach((w, wi) => {
            const span = document.createElement('span');
            span.textContent = w.word + (wi < content.words.length - 1 ? ' ' : '');
            if (w.state === 'active') {
              span.style.color = content.accent;
            }
            if (w.state === 'next') {
              span.style.opacity = '0.45';
            }
            // 🧊 3D caption: a kiemelt szó extrudált, döntött, előre ugró —
            // karaoke aktív állapotban a legerősebb pop (a fázis-PNG-kbe ég)
            if (w.emp) {
              const active = w.state === 'active';
              const steps = active ? 6 : 4;
              const shadows = [];
              for (let i = 1; i <= steps; i++) {
                shadows.push(`${i * 0.02}em ${i * 0.02}em 0 #8f0f5c`);
              }
              span.style.color = '#ff2ea6';
              span.style.fontWeight = '900';
              span.style.fontSize = '1.14em';
              span.style.textShadow = shadows.join(', ');
              span.style.display = 'inline-block';
              span.style.transform =
                `perspective(8em) rotateX(10deg) scale(${active ? 1.3 : 1.12})`;
              if (w.state === 'next') {
                span.style.opacity = '0.6';
              }
            }
            el.appendChild(span);
          });
        }, states[s].content);
        const el = page.locator('#t');
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(outDir, `text_${i}_${s}.png`);
        const box = await el.boundingBox();
        await el.screenshot({ path: file, omitBackground: true });
        rendered.push({
          file,
          from: states[s].from,
          to: states[s].to,
          w: Math.ceil(box?.width ?? 0),
          h: Math.ceil(box?.height ?? 0),
        });
      }
      results.push({ clip, states: rendered });
    }
  } finally {
    await browser.close();
  }
  return results;
}

/**
 * 🔁 Text → Shape: egyetlen szövegklipet a TELJES stílusával (font, tipográfia,
 * gradient, kontúr, glow, path, 3D) átlátszó hátterű PNG-vé süt, hogy forma-
 * klip kép-kitöltéseként (imageUri) tovább animálható/stílusozható legyen a
 * forma-eszköztárral. Az animációt/kinetic-et a bake-hez kikapcsoljuk (statikus
 * kép kell). @returns { pngBase64, w, h }
 */
async function bakeTextPng(clip, canvas) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txtbake-'));
  try {
    const bakeClip = { ...clip, animation: 'none', textMotion: undefined, maskReveal: undefined };
    const res = await renderTextPngs([bakeClip], canvas, outDir);
    const st = res[0] && res[0].states && res[0].states[0];
    if (!st) {
      throw new Error('Nem sikerült a szöveget képpé alakítani.');
    }
    return {
      pngBase64: fs.readFileSync(st.file).toString('base64'),
      w: st.w,
      h: st.h,
    };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

module.exports = { renderTextPngs, bakeTextPng };
