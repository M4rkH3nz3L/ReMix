/**
 * 📄 Offline PDF a telefonon (IMAGE-PROD S14 · PRO-DESIGN DS7) — pure mag, függőség nélkül.
 *
 * A lap a telefonos kész képéből (JPEG, `DCTDecode`) egyoldalas PDF-be kerül: net és szerver nélkül,
 * Free-ben is; a kép pixelre az, amit a vászon mutat, a betűk is helyesek (be vannak égetve). A
 * vektoros PDF (kijelölhető szöveg) a szerveres út marad.
 */

const enc = new TextEncoder();

/** JPEG mérete a SOF-jelölőből (0xFFC0–0xFFCF, kivéve C4/C8/CC); null, ha nem JPEG */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * Egyoldalas PDF egy JPEG-ből. Az oldal pontban (1 pt = 1/72 hüvelyk) a kép pixelméretéből `dpi`
 * felbontással (alap 150 dpi: nyomtatásra jó, képernyőn éles).
 */
export function jpegToPdf(jpeg: Uint8Array, opts: { dpi?: number; title?: string } = {}): Uint8Array {
  const size = jpegSize(jpeg);
  if (!size) throw new Error('nem JPEG');
  const dpi = opts.dpi ?? 150;
  const pw = +(size.width * (72 / dpi)).toFixed(2);
  const ph = +(size.height * (72 / dpi)).toFixed(2);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  // a cím UTF-16BE hex-szövegként (BOM-mal): az ékezet minden PDF-nézőben helyes
  const title = `<FEFF${Array.from(opts.title ?? 'ReMix').map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase()}>`;
  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: string | Uint8Array) => {
    parts.push(p);
    length += typeof p === 'string' ? enc.encode(p).length : p.length;
  };
  const obj = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const b of Array.isArray(body) ? body : [body]) push(b);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${size.width} /Height ${size.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  obj(5, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
  obj(6, `<< /Title ${title} /Producer (ReMix) >>`);
  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    const b = typeof p === 'string' ? enc.encode(p) : p;
    out.set(b, at);
    at += b.length;
  }
  return out;
}
