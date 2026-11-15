/** 🔤 IMAGE-PROD S10: a saját font a kép-renderhez — tartalom alapján engedve, csak feltöltött fájlként kötve, CSS-biztos családnévvel. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateUploads } = require('./mediaPolicy');
const { bindUploadedMedia } = require('../lib/bindMedia');

const TTF = Buffer.from([0, 1, 0, 0, 0, 12, 0, 128, 0, 3, 0, 64, 0, 0]);
const OTF = Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(10)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('🔤 font a kép-render feltöltésében', () => {
  it('TTF és OTF tartalommal átmegy, a font-kiterjesztésű nem-font nem', () => {
    expect(validateUploads([{ originalname: 'a.ttf', size: 100, header: TTF }], 'imagedoc').ok).toBe(true);
    expect(validateUploads([{ originalname: 'a.otf', size: 100, header: OTF }], 'imagedoc').ok).toBe(true);
    expect(validateUploads([{ originalname: 'a.ttf', size: 100, header: Buffer.from('#!/bin/sh echo hi') }], 'imagedoc').status).toBe(415);
    expect(validateUploads([{ originalname: 'a.png', size: 10, header: PNG }], 'imagedoc').ok).toBe(true);
  });

  it('a `fontUri` csak a most feltöltött fájlra köthető (szerver-útvonal nem olvastatható)', () => {
    const doc = { layers: [{ kind: 'text', fontUri: 'file:///x.ttf' }, { kind: 'text', fontUri: '/etc/passwd' }] };
    bindUploadedMedia(doc, [{ fieldname: 'f0', path: '/tmp/up/f0' }], { 'file:///x.ttf': 'f0' });
    expect(doc.layers[0].fontUri).toBe('/tmp/up/f0');
    expect(doc.layers[1].fontUri).toBeUndefined();
  });

  it('a saját font @font-face-e csak érvényes családnévvel és létező fájllal készül', () => {
    jest.isolateModules(() => {
      // a text-render-t csak a CSS-segédekért töltjük (Chromiumot nem indít)
      const tr = require('../text-render');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'font-'));
      const file = path.join(dir, 'f.ttf');
      fs.writeFileSync(file, TTF);
      const ok = tr.__fontCss('u_Saját_1', file);
      expect(ok).toBe(null); // ékezet a családnévben → elutasítva
      const css = tr.__fontCss('u_Sajat_1', file);
      expect(css).toContain("font-family:'u_Sajat_1'");
      expect(css).toContain("format('truetype')");
      expect(tr.__fontCss("u_x');}body{color:red", file)).toBe(null);
      expect(tr.__fontCss('u_Sajat_1', 'https://evil/x.ttf')).toBe(null);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
