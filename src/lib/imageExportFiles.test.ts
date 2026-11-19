import { imageMimeForUri, pdfExportFileName, svgExportFileName } from '@/lib/imageExportFiles';

describe('📁 export-fájlnevek', () => {
  it('SVG: csak \\w . - marad, az ékezet is _ lesz; üres név → image', () => {
    expect(svgExportFileName('Plakát 2026 v1.2')).toBe('Plak_t_2026_v1.2.svg');
    expect(svgExportFileName('')).toBe('image.svg');
    expect(svgExportFileName(undefined)).toBe('image.svg');
  });
  it('PDF: Unicode-betű és -szám marad, a pont és szóköz _ lesz', () => {
    expect(pdfExportFileName('Plakát 2026 v1.2')).toBe('Plakát_2026_v1_2.pdf');
    expect(pdfExportFileName('')).toBe('image.pdf');
  });
  it('MIME a kiterjesztésből', () => {
    expect(imageMimeForUri('file:///a/b.PNG')).toBe('image/png');
    expect(imageMimeForUri('file:///a/b.webp')).toBe('image/webp');
    expect(imageMimeForUri('file:///a/b.jpeg')).toBe('image/jpeg');
    expect(imageMimeForUri('file:///a/b')).toBe('image/jpeg');
  });
});
