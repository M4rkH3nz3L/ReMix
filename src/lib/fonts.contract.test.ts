import { DEFAULT_FONT, DEFAULT_FONT_BOLD_FAMILY, fontFiles, fontOptions, renderFontFamily } from '@/constants/fonts';

/**
 * 🔗 Kliens ⇄ worker CONTRACT-tesztek (01-production §2.7) — betű-paritás.
 *
 * A platformon több logika szándékosan "tükrözve" él mindkét oldalon: a **kliens**
 * TypeScript a preview/UI/soft-warn-hoz, a **worker** JavaScript a render/enforce-hoz.
 * A kettőnek bitre egyeznie KELL (preview == export, kliens-becslés == server-enforce),
 * különben csendben szétcsúsznak. Az egyes oldalak külön unit-tesztjei HARDCODE-olt
 * elvárásokkal dolgoznak — ezek viszont MINDKÉT oldalt importálják és EGYMÁShoz kötik,
 * így a drift azonnal piros tesztként jelentkezik (a CI-ben is).
 *
 * Megjegyzés: a worker-modulok sima CommonJS JS-ek — a kliens (jest-expo) projekt
 * babellel betölti őket; a `require` visszatérése `any`, ezért a tsc nem lép be a .js-be.
 * (A korábbi egyetlen contract.test.ts tartományonként bontva: *.contract.test.ts.)
 */

/* eslint-disable @typescript-eslint/no-require-imports -- a server/ CommonJS JS-modulja (típus nélkül), a kliens–worker szerződésteszt require-rel tölti */
const workerFonts = require('../../server/fonts');
const fs = require('fs');
const path = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('contract: font-parity (constants/fonts.ts ⇄ server/fonts.js ⇄ _layout useFonts ⇄ TTF-ek)', () => {
  const ROOT = process.cwd(); // a jest a repo-gyökérből fut

  it('a kliens fontFiles bitre egyezik a worker FONT_FILES-szel (nincs drift)', () => {
    // a preview (app @font-face) és az export (worker @font-face) UGYANABBÓL a
    // family→TTF leképezésből dolgozik → bármelyik oldal bővítése a másik nélkül piros
    expect(fontFiles).toEqual(workerFonts.FONT_FILES);
  });

  it('minden UI font-opció (family-vel) szerepel a render-készletben (Preview == Export)', () => {
    for (const opt of fontOptions) {
      if (opt.family) {
        expect(Object.keys(fontFiles)).toContain(opt.family);
      }
    }
  });

  it('minden family TTF-je LÉTEZIK az appban ÉS a workerben is (nincs néma fallback)', () => {
    for (const [family, file] of Object.entries(fontFiles)) {
      expect(typeof file === 'string' && file.endsWith('.ttf')).toBe(true);
      const appTtf = path.join(ROOT, 'assets', 'fonts', file);
      const workerTtf = path.join(ROOT, 'server', 'assets', 'fonts', file);
      expect({ family, app: fs.existsSync(appTtf) }).toEqual({ family, app: true });
      expect({ family, worker: fs.existsSync(workerTtf) }).toEqual({ family, worker: true });
    }
  });

  it('minden family regisztrálva van az app expo-font useFonts-ban (_layout.tsx) → a preview megjeleníti', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'src', 'app', '_layout.tsx'), 'utf8');
    for (const [family, file] of Object.entries(fontFiles)) {
      expect({ family, registered: layout.includes(`${family}: require(`) }).toEqual({ family, registered: true });
      expect({ family, file, present: layout.includes(file) }).toEqual({ family, file, present: true });
    }
  });
  it('az „Alap” betű (Inter, két vastagság) ugyanaz az appban és a workerben, mindkét TTF megvan és be van töltve', () => {
    expect(DEFAULT_FONT).toEqual(workerFonts.DEFAULT_FONT);
    const layout = fs.readFileSync(path.join(ROOT, 'src', 'app', '_layout.tsx'), 'utf8');
    for (const file of [DEFAULT_FONT.regular, DEFAULT_FONT.bold]) {
      expect({ file, app: fs.existsSync(path.join(ROOT, 'assets', 'fonts', file)) }).toEqual({ file, app: true });
      expect({ file, worker: fs.existsSync(path.join(ROOT, 'server', 'assets', 'fonts', file)) }).toEqual({ file, worker: true });
      expect({ file, present: layout.includes(file) }).toEqual({ file, present: true });
    }
    expect(layout.includes(`${DEFAULT_FONT.family}: require(`)).toBe(true);
    expect(layout.includes(`'${DEFAULT_FONT_BOLD_FAMILY}': require(`)).toBe(true);
    // a hiányzó család és az „Inter” a vastagság szerinti fájlt kapja; a többi család változatlan
    expect([renderFontFamily(undefined), renderFontFamily(undefined, 'bold'), renderFontFamily('Inter', '900'), renderFontFamily('Poppins', 'bold')]).toEqual(['Inter', 'Inter-Bold', 'Inter-Bold', 'Poppins']);
  });
});
