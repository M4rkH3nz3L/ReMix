// 🔤 Az „Alap” betű: a hiányzó család a szerveren is a beágyazott Inter (nem a rendszerfont,
// ami a Linux-szerveren Arial lenne) — két vastagsággal, mint a telefonon.
const { DEFAULT_FONT, FONT_FILES } = require('./fonts');
const { fontFaceCss, fontFamilyCss } = require('./text-render');

test('hiányzó család és „Inter”: Inter @font-face 400 + 700, az Inter az első család', () => {
  for (const family of [undefined, '', 'Inter']) {
    const css = fontFaceCss(family);
    expect(css).toContain(`font-family:'${DEFAULT_FONT.family}';font-weight:400;`);
    expect(css).toContain(`font-family:'${DEFAULT_FONT.family}';font-weight:700;`);
    expect(fontFamilyCss(family).startsWith(`'${DEFAULT_FONT.family}',`)).toBe(true);
  }
});

test('a beépített fontok változatlanok (saját @font-face, saját család)', () => {
  for (const family of Object.keys(FONT_FILES)) {
    expect(fontFaceCss(family)).toContain(`font-family:'${family}';src:`);
    expect(fontFamilyCss(family).startsWith(`'${family}',`)).toBe(true);
  }
});
