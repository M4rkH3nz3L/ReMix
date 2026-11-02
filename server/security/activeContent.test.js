const { isActiveContent, safeContentType, safeExt } = require('./mediaPolicy');

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const html = Buffer.from('<!DOCTYPE html><script>alert(1)</script>');

describe('S8: tárolt XSS elleni védelem', () => {
  test.each(['x.html', 'x.HTM', 'x.svg', 'x.js', 'x.xhtml'])('%s nem tölthető fel', (name) => {
    expect(isActiveContent(name, png)).toBe(true);
  });

  test('a név nem számít: a tartalom dönt', () => {
    expect(isActiveContent('kep.png', html)).toBe(true);
    expect(isActiveContent('rajz.dat', Buffer.from('  <svg xmlns="x">'))).toBe(true);
  });

  test('a valódi média és a projektfájl átmegy', () => {
    expect(isActiveContent('kep.png', png)).toBe(false);
    expect(isActiveContent('model.usdz', Buffer.from('PK\x03\x04'))).toBe(false);
  });

  test('a kliens MIME-ja csak egyező tartalommal marad', () => {
    expect(safeContentType('image/png', png)).toBe('image/png');
    expect(safeContentType('text/html', png)).toBe('application/octet-stream');
    expect(safeContentType('image/png', html)).toBe('application/octet-stream');
  });

  test('a kiterjesztés tiszta és nem aktív', () => {
    expect(safeExt('a.PNG')).toBe('.png');
    expect(safeExt('a.svg')).toBe('.bin');
    expect(safeExt('a')).toBe('.bin');
    expect(safeExt('a.p"ng')).toBe('.bin');
  });
});
