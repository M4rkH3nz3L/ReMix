import {
  BUILTIN_NATURAL_LEADING,
  DEFAULT_NATURAL_LEADING,
  naturalLeading,
  naturalLeadingFromFont,
  registerFontLeading,
  tightLeadingShift,
} from '@/lib/fontMetrics';

/* eslint-disable @typescript-eslint/no-require-imports */
// a kliens-tsconfig-ban nincs node-típus → a bevált minta (TextOverlay.test.ts)
const fs = require('fs');
const path = require('path');
const { FONT_FILES } = require('../../server/fonts');
declare const __dirname: string;

describe('📏 fontok természetes sormagassága', () => {
  it('a beépített tábla = a TTF-ek hhea-értéke (app és worker)', () => {
    for (const [family, file] of Object.entries(FONT_FILES as Record<string, string>)) {
      for (const dir of ['assets/fonts', 'server/assets/fonts']) {
        const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '../..', dir, file)));
        expect([family, naturalLeadingFromFont(bytes)]).toEqual([family, BUILTIN_NATURAL_LEADING[family]]);
      }
    }
    expect(Object.keys(BUILTIN_NATURAL_LEADING).sort()).toEqual(Object.keys(FONT_FILES).sort());
  });

  it('a hibás fájl nem ad értéket', () => {
    expect(naturalLeadingFromFont(new Uint8Array(4))).toBeNull();
    expect(naturalLeadingFromFont(new Uint8Array(64))).toBeNull();
  });

  it('ismeretlen család: a rendszerfont értéke; a saját font regisztrálható', () => {
    expect(naturalLeading(undefined)).toBe(DEFAULT_NATURAL_LEADING);
    expect(naturalLeading('u_ismeretlen')).toBe(DEFAULT_NATURAL_LEADING);
    registerFontLeading('u_sajat', 1.6);
    expect(naturalLeading('u_sajat')).toBe(1.6);
    registerFontLeading('u_rossz', null);
    expect(naturalLeading('u_rossz')).toBe(DEFAULT_NATURAL_LEADING);
  });

  it('csak a természetesnél szorosabb sor tolódik, a különbség felével', () => {
    expect(tightLeadingShift('Poppins', 1.25)).toBeCloseTo(0.075);
    expect(tightLeadingShift('Poppins', 1.6)).toBe(0);
    expect(tightLeadingShift(undefined, 1)).toBeCloseTo(0.1);
  });
});
