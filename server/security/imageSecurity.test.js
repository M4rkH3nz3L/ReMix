const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { renderSvgToPdf, sanitizeSvg } = require('../svgPdf');
const { findChromium } = require('../text-render');
const { validateUploads } = require('./mediaPolicy');
const { ownedMediaKey } = require('./ownedKey');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('I44 — sanitizeSvg', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

  it('az ép SVG átmegy, az XML-prolog lekerül', () => {
    expect(sanitizeSvg(`<?xml version="1.0"?>\n${ok}`)).toBe(ok);
  });
  it('kiveszi a szkriptet, a foreignObjectet és az eseménykezelőket', () => {
    const out = sanitizeSvg('<svg onload="x()"><script>fetch("x")</script><foreignObject><iframe src="http://a"/></foreignObject><rect onclick=\'y()\'/></svg>');
    expect(out).toBe('<svg><rect/></svg>');
  });
  it('nem-SVG gyökér, kitörés és entitás → null', () => {
    expect(sanitizeSvg('<html><svg></svg></html>')).toBeNull();
    expect(sanitizeSvg('<svg></svg><script>x</script>')).toBeNull();
    expect(sanitizeSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')).toBeNull();
  });
});

describe('I44 — a Chromium nem ér el hálózatot', () => {
  const chromium = findChromium();
  (chromium ? it : it.skip)('a beágyazott külső kép nem kér a belső címről, a PDF elkészül', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.end('x');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svgpdf-test-'));
    try {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="50" height="50"><image href="http://127.0.0.1:${port}/meta" width="50" height="50"/><style>@import url("http://127.0.0.1:${port}/css");</style></svg>`;
      const file = await renderSvgToPdf(svg, { width: 50, height: 50, workDir });
      expect(fs.statSync(file).size).toBeGreaterThan(100);
      expect(hits).toBe(0);
    } finally {
      server.close();
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe('I45 — imagedoc feltöltés-profil', () => {
  it('réteg-kép nélküli doc érvényes', () => {
    expect(validateUploads([], 'imagedoc').ok).toBe(true);
  });
  it('kép és .cube mehet, bináris .cube és exe nem', () => {
    expect(validateUploads([{ originalname: 'a.png', size: 10, header: PNG }], 'imagedoc').ok).toBe(true);
    expect(validateUploads([{ originalname: 'l.cube', size: 10, header: Buffer.from('TITLE "x"\nLUT_3D_SIZE 2') }], 'imagedoc').ok).toBe(true);
    expect(validateUploads([{ originalname: 'l.cube', size: 10, header: Buffer.from([1, 0, 2]) }], 'imagedoc').status).toBe(415);
    expect(validateUploads([{ originalname: 'a.exe', size: 10, header: PNG }], 'imagedoc').status).toBe(415);
  });
  it('a többi profil üres feltöltésre továbbra is 400', () => {
    expect(validateUploads([], 'image').status).toBe(400);
  });
});

describe('I46 — ownedMediaKey', () => {
  it('a kulcs a hívó prefixe alatt van, a projekt csak alatta', () => {
    expect(ownedMediaKey('user-1', 'proj', 'psd/d/l.png')).toBe('u/user-1/proj/psd/d/l.png');
    expect(ownedMediaKey('user-1', '', 'x.png')).toBe('u/user-1/x.png');
  });
  it('a projektId nem törhet ki a prefixből', () => {
    expect(ownedMediaKey('user-1', '../user-2', 'x.png')).toBe('u/user-1/user-2/x.png');
  });
});
