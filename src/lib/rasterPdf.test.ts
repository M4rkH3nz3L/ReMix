import { jpegSize, jpegToPdf } from '@/lib/rasterPdf';

// minimális JPEG-fej: SOI + APP0 + SOF0 (8 bit, 300×200, 3 komponens) + EOI — a PDF a bájtokat érintetlenül ágyazza
const fakeJpeg = () =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 44, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);

describe('📄 S14: offline PDF a telefonos képből', () => {
  it('a JPEG mérete a SOF-ból; nem-JPEG-re null', () => {
    expect(jpegSize(fakeJpeg())).toEqual({ width: 300, height: 200 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('érvényes egyoldalas PDF: fejléc, oldalméret pontban, a kép érintetlenül, helyes xref-eltolások', () => {
    const jpeg = fakeJpeg();
    const pdf = jpegToPdf(jpeg, { dpi: 150, title: 'Borító (x)' });
    // bájt → karakter (latin1-szerűen), hogy a szöveg-index = bájt-index legyen
    const text = Array.from(pdf, (b) => String.fromCharCode(b)).join('');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 144 96]'); // 300 px @150 dpi = 2 hüvelyk = 144 pt
    expect(text).toContain('/Width 300 /Height 200');
    expect(text).toContain('/Title <FEFF0042006F007200ED007400F30020002800780029>'); // „Borító (x)” UTF-16BE
    // a kép bájtjai változatlanul benne
    const at = text.indexOf('stream\n', text.indexOf('/DCTDecode')) + 'stream\n'.length;
    expect(Array.from(pdf.slice(at, at + jpeg.length))).toEqual(Array.from(jpeg));
    // minden xref-eltolás egy „N 0 obj” sor elejére mutat
    const startxref = Number(text.slice(text.lastIndexOf('startxref') + 10).trim().split('\n')[0]);
    const rows = text.slice(startxref).split('\n').slice(3, 9);
    rows.forEach((row, i) => {
      const off = Number(row.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('nem-JPEG bemenetre hiba', () => {
    expect(() => jpegToPdf(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
