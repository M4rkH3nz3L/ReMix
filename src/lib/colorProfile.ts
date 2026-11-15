/**
 * 🎨 A bevitt kép színprofilja és alfája (IMAGE-PROD S16) — pure, expo-mentes.
 *
 * Az iPhone-fotó Display P3-ban van. A telefon vászna színkezel (a P3-at sRGB-be váltja), a szerver
 * ffmpeg-je NEM (a nyers értékeket olvassa) → ugyanaz a fotó a két úton más színű volt (eszközön mérve:
 * sRGB 200,100,50 helyett 187,105,62). Ezért a bevitelkor egyszer sRGB-be váltunk, és utána minden
 * (vászon, telefonos és szerveres render, videó) ugyanazt a pixelt látja. A Skia offscreen felülete nem
 * színkezel (mérve), ezért a váltás saját: a Display P3 az sRGB átviteli görbéjét használja, csak a
 * primerek mások → linearizálás, 3×3 mátrix (D65), visszakódolás.
 */

/** Display P3 → sRGB, lineáris térben (mindkettő D65) */
export const P3_TO_SRGB: readonly [number, number, number][] = [
  [1.22494, -0.22494, 0],
  [-0.042057, 1.042057, 0],
  [-0.019638, -0.078636, 1.098274],
];

const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** egy P3-ban kódolt szín (0–255) sRGB-ben — a shader képletének referenciája (teszthez) */
export function p3ToSrgb(rgb: readonly [number, number, number]): [number, number, number] {
  const lin = rgb.map((c) => decode(c / 255));
  return P3_TO_SRGB.map((row) => {
    const v = row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2];
    return Math.round(encode(Math.min(1, Math.max(0, v))) * 255);
  }) as [number, number, number];
}

/** SkSL: a gyerek-kép (nyers, színkezeletlen mintavétellel) P3 → sRGB, az alfa érintetlen */
export const P3_TO_SRGB_SHADER = `
uniform shader image;
float dec(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float enc(float v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
half4 main(float2 xy) {
  half4 c = image.eval(xy);
  if (c.a <= 0.0) { return c; }
  float3 p = float3(c.rgb) / float(c.a);
  float3 l = float3(dec(p.r), dec(p.g), dec(p.b));
  float3 s = float3(
    1.22494 * l.r - 0.22494 * l.g,
    -0.042057 * l.r + 1.042057 * l.g,
    -0.019638 * l.r - 0.078636 * l.g + 1.098274 * l.b);
  s = clamp(s, 0.0, 1.0);
  return half4(half3(enc(s.r), enc(s.g), enc(s.b)) * c.a, c.a);
}`;

export type ProfileKind = 'none' | 'srgb' | 'display-p3' | 'other';

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, Math.min(b.length, o + n)));

/** az ICC-profil leírása (`desc` v2 ASCII vagy v4 `mluc` UTF-16BE), vagy null */
export function iccDescription(icc: Uint8Array): string | null {
  if (icc.length < 132) return null;
  const count = u32(icc, 128);
  for (let i = 0; i < count && 132 + i * 12 + 12 <= icc.length; i++) {
    const e = 132 + i * 12;
    if (ascii(icc, e, 4) !== 'desc') continue;
    const off = u32(icc, e + 4);
    const type = ascii(icc, off, 4);
    if (type === 'desc') {
      const n = u32(icc, off + 8);
      return ascii(icc, off + 12, Math.max(0, n - 1));
    }
    if (type === 'mluc' && u32(icc, off + 8) > 0) {
      const len = u32(icc, off + 20);
      const at = off + u32(icc, off + 24);
      let s = '';
      for (let k = 0; k + 1 < len && at + k + 1 < icc.length; k += 2) s += String.fromCharCode(u16(icc, at + k));
      return s;
    }
  }
  return null;
}

/** a JPEG beágyazott ICC-profilja (APP2 „ICC_PROFILE” darabok összefűzve), vagy null */
function jpegIcc(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const marker = b[o + 1];
    if (marker === 0xda || marker === 0xd9) break; // a képadat kezdete: a profil előtte van
    const len = u16(b, o + 2);
    if (marker === 0xe2 && ascii(b, o + 4, 11) === 'ICC_PROFILE') parts.push(b.subarray(o + 18, o + 2 + len));
    o += 2 + len;
  }
  if (parts.length === 0) return null;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** a PNG `iCCP` darabjának neve (a profil maga tömörített; az iOS a színtér nevét írja ide), vagy null */
function pngProfileName(b: Uint8Array): string | null {
  let o = 8;
  while (o + 12 <= b.length) {
    const n = u32(b, o);
    const type = ascii(b, o + 4, 4);
    if (type === 'iCCP') {
      const end = b.indexOf(0, o + 8);
      return end > o + 8 ? ascii(b, o + 8, end - (o + 8)) : '';
    }
    if (type === 'IDAT' || type === 'IEND') break;
    o += 12 + n;
  }
  return null;
}

/** a beágyazott profil neve (JPEG / PNG), vagy null, ha nincs profil */
export function embeddedProfileName(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const icc = jpegIcc(bytes);
    return icc ? iccDescription(icc) ?? '' : null;
  }
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return pngProfileName(bytes);
  return null;
}

/** a profil fajtája a nevéből (az iOS „Display P3” / „kCGColorSpaceDisplayP3” nevet ír) */
export function profileKind(name: string | null): ProfileKind {
  if (name == null) return 'none';
  if (/display\s*p3|displayp3/i.test(name)) return 'display-p3';
  if (/srgb/i.test(name)) return 'srgb';
  return 'other';
}

/** a HEIF/HEIC/AVIF fájlban van-e alfa-segédkép (az `auxC` alfa-URN-je a fejléc `meta` dobozában) */
export function heifHasAlpha(bytes: Uint8Array): boolean {
  const head = ascii(bytes, 0, Math.min(bytes.length, 1 << 16));
  return /urn:mpeg:hevc:2015:auxid:1|urn:mpeg:mpegB:cicp:systems:auxiliary:alpha/.test(head);
}
