// 🔤 Betű-beágyazás a raszter-HTML-be: @font-face (beépített, „Alap” Inter, projekt-saját font) + font-family lánc.
const { logCaught } = require('../lib/caught');
const fs = require('fs');
const path = require('path');

/** a server/ gyökér — a beágyazott fontok a server/assets/fonts alatt */
const SERVER_DIR = path.join(__dirname, '..');

// Választható betűtípusok (a család-név egyezik az app expo-font kulcsával) — a
// render EGYETLEN forrása a függőség-mentes ./fonts (a kliens↔worker parity-t a
// src/lib/contract.test.ts zárolja). A TTF base64 data-URI-ként ágyazódik a HTML-be.
const { DEFAULT_FONT, FONT_FILES } = require('../fonts');
const FALLBACK_FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
const fontFaceCache = {};

/** a kliens-adott saját font-családnév: csak `u_` + betű/szám/aláhúzás (CSS-be kerül) */
const CUSTOM_FAMILY = /^u_[A-Za-z0-9_]{1,48}$/;
const customFaceCache = new Map();

/** 🔤 S10: a projekt saját fontja (a feltöltött fájlból) — érvényes családnév és létező fájl kell */
function customFace(family, fontPath) {
  if (!family || !fontPath || !CUSTOM_FAMILY.test(family) || /^https?:/i.test(fontPath)) {
    return null;
  }
  const key = `${family}|${fontPath}`;
  if (!customFaceCache.has(key)) {
    try {
      const buf = fs.readFileSync(fontPath);
      const otf = buf.slice(0, 4).toString('latin1') === 'OTTO';
      customFaceCache.set(key, `@font-face{font-family:'${family}';src:url(data:font/${otf ? 'otf' : 'ttf'};base64,${buf.toString('base64')}) format('${otf ? 'opentype' : 'truetype'}');font-display:block;}`);
    } catch (caught) {
      logCaught('text-render.js:customFace', caught);
      customFaceCache.set(key, '');
    }
  }
  return customFaceCache.get(key) || null;
}

function fontFaceCss(family, fontPath) {
  const custom = customFace(family, fontPath);
  if (custom) {
    return custom;
  }
  if (!family || family === DEFAULT_FONT.family || !FONT_FILES[family]) {
    return defaultFaceCss();
  }
  if (fontFaceCache[family] === undefined) {
    try {
      const b64 = fs.readFileSync(path.join(SERVER_DIR, 'assets', 'fonts', FONT_FILES[family])).toString('base64');
      fontFaceCache[family] = `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64}) format('truetype');font-display:block;}`;
    } catch (caught) {
      logCaught('text-render.js:fontFaceCss', caught);
      fontFaceCache[family] = '';
    }
  }
  return fontFaceCache[family];
}

function fontFamilyCss(family, fontPath) {
  if (customFace(family, fontPath)) {
    return `'${family}', ${FALLBACK_FONT}`;
  }
  return family && FONT_FILES[family] ? `'${family}', ${FALLBACK_FONT}` : `'${DEFAULT_FONT.family}', ${FALLBACK_FONT}`;
}

let defaultFace = null;

/** 🔤 az „Alap” betű (Inter) két vastagsága — a hiányzó/ismeretlen család is ezt kapja, mint a telefonon */
function defaultFaceCss() {
  if (defaultFace === null) {
    try {
      defaultFace = [['regular', 400], ['bold', 700]]
        .map(([k, w]) => {
          const b64 = fs.readFileSync(path.join(SERVER_DIR, 'assets', 'fonts', DEFAULT_FONT[k])).toString('base64');
          return `@font-face{font-family:'${DEFAULT_FONT.family}';font-weight:${w};src:url(data:font/ttf;base64,${b64}) format('truetype');font-display:block;}`;
        })
        .join('');
    } catch (caught) {
      logCaught('text-render.js:defaultFaceCss', caught);
      defaultFace = '';
    }
  }
  return defaultFace;
}

module.exports = { customFace, fontFaceCss, fontFamilyCss, defaultFaceCss };
