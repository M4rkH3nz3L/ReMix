/**
 * 🔐 SHA-256 — tiszta, inkrementális JS-implementáció (FIPS 180-4).
 *
 * A modell-registry letöltés-ellenőrzéséhez kell (local-ai BP-2): a letöltött
 * modell-fájl DARABONKÉNT hash-elhető (`update` többször), így a nagy bináris
 * nem igényel egyben-memóriát a hash-hez. Expo-mentes, függőség nélküli →
 * önmagában tesztelt (ismert NIST-tesztvektorok). Natív gyorsítás később
 * cserélhető alá (azonos interfész), a hívók nem változnak.
 */

// a 64 kör-konstans (az első 64 prím köbgyökeinek tört-részei)
const K = new Int32Array([
  0x428a2f98, 0x71374491, -0x4a3f0431, -0x164a245b, 0x3956c25b, 0x59f111f1, -0x6dc07d5c, -0x54e3a12b,
  -0x27f85568, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, -0x7f214e02, -0x6423f959, -0x3e640e8c,
  -0x1b64963f, -0x1041b87a, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  -0x67c1aeae, -0x57ce3993, -0x4ffcd838, -0x40a68039, -0x391ff40d, -0x2a586eb9, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, -0x7e3d36d2, -0x6d8dd37b,
  -0x5d40175f, -0x57e599b5, -0x3db47490, -0x3893ae5d, -0x2e6d17e7, -0x2966f9dc, -0x0bf1ca7b, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, -0x7b3787ec, -0x7338fdf8, -0x6f410006, -0x5baf9315, -0x41065c09, -0x398e870e,
]);

/** UTF-8 kódolás (saját, mert a Hermes TextEncoder-e nem garantált minden buildben). */
export function utf8ToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    let cp = s.codePointAt(i)!;
    if (cp > 0xffff) {
      i += 1; // surrogate-pár második fele
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Inkrementális SHA-256 (egyszer használatos: a `digestHex` lezárja). */
export class Sha256 {
  private h0 = 0x6a09e667;
  private h1 = -0x4498517b; // 0xbb67ae85
  private h2 = 0x3c6ef372;
  private h3 = -0x5ab00ac6; // 0xa54ff53a
  private h4 = 0x510e527f;
  private h5 = -0x64fa9774; // 0x9b05688c
  private h6 = 0x1f83d9ab;
  private h7 = 0x5be0cd19;

  private readonly buf = new Uint8Array(64);
  private bufLen = 0;
  /** feldolgozott bájtok (64 bit, két 32-bites szóban) */
  private lenLo = 0;
  private lenHi = 0;
  private readonly w = new Int32Array(64);
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) {
      throw new Error('Sha256: a digest után nincs update');
    }
    const n = data.length;
    const lo = this.lenLo + n; // n < 2^53 → pontos floatként
    this.lenLo = lo >>> 0;
    this.lenHi = (this.lenHi + Math.floor(lo / 4294967296)) >>> 0;

    let i = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, n);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen === 64) {
        this.block(this.buf, 0);
        this.bufLen = 0;
      }
    }
    for (; i + 64 <= n; i += 64) {
      this.block(data, i);
    }
    if (i < n) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = n - i;
    }
    return this;
  }

  /** Lezárás + hex digest (kisbetűs, 64 karakter). */
  digestHex(): string {
    if (this.finished) {
      throw new Error('Sha256: a digest csak egyszer kérhető le');
    }
    this.finished = true;
    // bit-hossz MÉG a padding előtt (a padding nem számít bele)
    const bitsHi = ((this.lenHi << 3) | (this.lenLo >>> 29)) >>> 0;
    const bitsLo = (this.lenLo << 3) >>> 0;

    // 0x80 + nullák az 56 mod 64 határig
    const pad = new Uint8Array(this.bufLen < 56 ? 64 - this.bufLen : 128 - this.bufLen);
    pad[0] = 0x80;
    // a 64 bites bit-hossz big-endianban a blokk végére
    const tail = pad.length - 8;
    pad[tail] = (bitsHi >>> 24) & 0xff;
    pad[tail + 1] = (bitsHi >>> 16) & 0xff;
    pad[tail + 2] = (bitsHi >>> 8) & 0xff;
    pad[tail + 3] = bitsHi & 0xff;
    pad[tail + 4] = (bitsLo >>> 24) & 0xff;
    pad[tail + 5] = (bitsLo >>> 16) & 0xff;
    pad[tail + 6] = (bitsLo >>> 8) & 0xff;
    pad[tail + 7] = bitsLo & 0xff;

    // a paddinget blokkonként dolgozzuk fel (a hossz-számlálót már nem bántjuk)
    let off = 0;
    if (this.bufLen > 0) {
      const take = 64 - this.bufLen;
      this.buf.set(pad.subarray(0, take), this.bufLen);
      this.block(this.buf, 0);
      off = take;
    }
    for (; off + 64 <= pad.length; off += 64) {
      this.block(pad, off);
    }

    const hex = (x: number) => (x >>> 0).toString(16).padStart(8, '0');
    return (
      hex(this.h0) + hex(this.h1) + hex(this.h2) + hex(this.h3) +
      hex(this.h4) + hex(this.h5) + hex(this.h6) + hex(this.h7)
    );
  }

  private block(p: Uint8Array, off: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const j = off + i * 4;
      w[i] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = this.h0;
    let b = this.h1;
    let c = this.h2;
    let d = this.h3;
    let e = this.h4;
    let f = this.h5;
    let g = this.h6;
    let h = this.h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    this.h0 = (this.h0 + a) | 0;
    this.h1 = (this.h1 + b) | 0;
    this.h2 = (this.h2 + c) | 0;
    this.h3 = (this.h3 + d) | 0;
    this.h4 = (this.h4 + e) | 0;
    this.h5 = (this.h5 + f) | 0;
    this.h6 = (this.h6 + g) | 0;
    this.h7 = (this.h7 + h) | 0;
  }
}

/** Kényelmi hívás: teljes bemenet → hex digest. */
export function sha256Hex(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? utf8ToBytes(data) : data;
  return new Sha256().update(bytes).digestHex();
}
