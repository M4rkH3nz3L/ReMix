import { utf8ToBytes } from '@/lib/sha256';

/**
 * 📦 Minimális ZIP (STORE) író/olvasó — tiszta mag a `.rp` projekt-csomaghoz.
 *
 * A `.rp` (RemixProject) a SZABVÁNYOS teljes-projekt formátumunk: szabályos
 * ZIP-konténer `.rp` kiterjesztéssel, tömörítés NÉLKÜL (STORE) — a média (mp4/
 * jpg/m4a) már tömörített, a deflate csak CPU-t égetne. A STORE-zip formátum
 * egyszerű és determinista: local header + adat + data descriptor fájlonként,
 * a végén central directory + EOCD. Így bármely zip-eszköz kibontja, mi pedig
 * dependency nélkül, CHUNKONKÉNT írjuk/olvassuk (nagy videónál sem kell a
 * teljes fájl a memóriába — az FS-oldal a `rpFile.ts`).
 *
 * Korlátok (szándékosan): nincs zip64 (max ~4 GB csomag), olvasni is csak
 * STORE-t olvasunk (idegen, tömörített zip → értelmes hiba). Expo-mentes.
 */

/* ── CRC-32 (IEEE) ────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** Inkrementális CRC-32 (a zip kötelező ellenőrzőösszege). */
export class Crc32 {
  private crc = -1;

  update(data: Uint8Array): this {
    let c = this.crc;
    for (let i = 0; i < data.length; i += 1) {
      c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    }
    this.crc = c;
    return this;
  }

  /** a kész érték (unsigned 32 bit) */
  value(): number {
    return (this.crc ^ -1) >>> 0;
  }
}

export function crc32(data: Uint8Array): number {
  return new Crc32().update(data).value();
}

/* ── byte-írás segédek ────────────────────────────────────────────────────── */

function le16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function u16(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}

function u32(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

/** egyszerű UTF-8 dekóder a zip-nevekhez (a Hermes TextDecoder-e nem garantált) */
export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

/* ── író ──────────────────────────────────────────────────────────────────── */

const SIG_LOCAL = 0x04034b50;
const SIG_DESCRIPTOR = 0x08074b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** bit3: data descriptor (a CRC/méret az adat UTÁN) · bit11: UTF-8 fájlnév */
const FLAGS = 0x0808;

interface PendingEntry {
  nameBytes: Uint8Array;
  headerOffset: number;
  crc: Crc32;
  size: number;
}

interface DoneEntry {
  nameBytes: Uint8Array;
  headerOffset: number;
  crc: number;
  size: number;
}

/**
 * Streamelő STORE-zip író: a hívó a visszaadott byte-darabokat SORBAN kiírja
 * (fájlba vagy pufferbe) — a writer csak a könyveléshez tart állapotot, az
 * adat átfolyik rajta (CRC+méret számolással). Használat:
 * `beginFile(név)` → N× `chunk(adat)` → `endFile()` … végül `finish()`.
 */
export class ZipStoreWriter {
  private offset = 0;
  private current: PendingEntry | null = null;
  private readonly done: DoneEntry[] = [];

  private emit(bytes: Uint8Array): Uint8Array {
    this.offset += bytes.length;
    return bytes;
  }

  beginFile(name: string): Uint8Array {
    if (this.current) {
      throw new Error('zipStore: az előző fájl nincs lezárva (endFile)');
    }
    const nameBytes = utf8ToBytes(name);
    this.current = { nameBytes, headerOffset: this.offset, crc: new Crc32(), size: 0 };
    // local header — bit3 miatt a CRC/méretek itt 0-k, a descriptor hozza őket
    return this.emit(
      Uint8Array.from([
        ...le32(SIG_LOCAL),
        ...le16(20), // version needed
        ...le16(FLAGS),
        ...le16(0), // STORE
        ...le16(0), // mod time
        ...le16(0), // mod date
        ...le32(0), // crc
        ...le32(0), // compressed size
        ...le32(0), // uncompressed size
        ...le16(nameBytes.length),
        ...le16(0), // extra len
        ...nameBytes,
      ]),
    );
  }

  /** az adat változatlanul megy tovább — a writer csak CRC-t/méretet számol */
  chunk(data: Uint8Array): Uint8Array {
    if (!this.current) {
      throw new Error('zipStore: chunk beginFile nélkül');
    }
    this.current.crc.update(data);
    this.current.size += data.length;
    return this.emit(data);
  }

  endFile(): Uint8Array {
    const cur = this.current;
    if (!cur) {
      throw new Error('zipStore: endFile beginFile nélkül');
    }
    this.current = null;
    const crc = cur.crc.value();
    this.done.push({ nameBytes: cur.nameBytes, headerOffset: cur.headerOffset, crc, size: cur.size });
    return this.emit(
      Uint8Array.from([...le32(SIG_DESCRIPTOR), ...le32(crc), ...le32(cur.size), ...le32(cur.size)]),
    );
  }

  /** central directory + EOCD — ezzel zárul a csomag */
  finish(): Uint8Array {
    if (this.current) {
      throw new Error('zipStore: finish lezáratlan fájllal');
    }
    const cdOffset = this.offset;
    const parts: number[] = [];
    for (const e of this.done) {
      parts.push(
        ...le32(SIG_CENTRAL),
        ...le16(20), // version made by
        ...le16(20), // version needed
        ...le16(FLAGS),
        ...le16(0), // STORE
        ...le16(0),
        ...le16(0),
        ...le32(e.crc),
        ...le32(e.size),
        ...le32(e.size),
        ...le16(e.nameBytes.length),
        ...le16(0), // extra
        ...le16(0), // comment
        ...le16(0), // disk
        ...le16(0), // internal attrs
        ...le32(0), // external attrs
        ...le32(e.headerOffset),
        ...e.nameBytes,
      );
    }
    const cdSize = parts.length;
    parts.push(
      ...le32(SIG_EOCD),
      ...le16(0),
      ...le16(0),
      ...le16(this.done.length),
      ...le16(this.done.length),
      ...le32(cdSize),
      ...le32(cdOffset),
      ...le16(0), // comment len
    );
    return this.emit(Uint8Array.from(parts));
  }
}

/* ── olvasó ───────────────────────────────────────────────────────────────── */

export interface ZipEntry {
  name: string;
  /** 0 = STORE (csak ezt támogatjuk) */
  method: number;
  crc: number;
  size: number;
  /** a local header kezdete a fájlban */
  headerOffset: number;
}

/**
 * EOCD keresése a fájl VÉGÉRŐL olvasott darabban (komment miatt hátulról
 * pásztázva). `tail` a fájl utolsó darabja, `tailStart` a darab kezdő-offsete.
 */
export function parseEocd(
  tail: Uint8Array,
  tailStart: number,
): { cdOffset: number; cdSize: number; count: number } | null {
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (u32(tail, i) === SIG_EOCD) {
      return {
        count: u16(tail, i + 10),
        cdSize: u32(tail, i + 12),
        cdOffset: u32(tail, i + 16),
      };
    }
  }
  void tailStart; // az aláírás kedvéért (a hívó offset-számításához)
  return null;
}

/** A central directory bejegyzései (a `cdSize` hosszú, `cdOffset`-nél olvasott darabból). */
export function parseCentralDirectory(cd: Uint8Array, count: number): ZipEntry[] {
  const out: ZipEntry[] = [];
  let off = 0;
  for (let n = 0; n < count && off + 46 <= cd.length; n += 1) {
    if (u32(cd, off) !== SIG_CENTRAL) {
      break;
    }
    const nameLen = u16(cd, off + 28);
    const extraLen = u16(cd, off + 30);
    const commentLen = u16(cd, off + 32);
    out.push({
      method: u16(cd, off + 10),
      crc: u32(cd, off + 16),
      size: u32(cd, off + 24),
      headerOffset: u32(cd, off + 42),
      name: bytesToUtf8(cd.subarray(off + 46, off + 46 + nameLen)),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Az adat kezdő-offsete a fájlban a local header (≥30 bájt) alapján. */
export function localDataOffset(localHeader: Uint8Array, headerOffset: number): number {
  const nameLen = u16(localHeader, 26);
  const extraLen = u16(localHeader, 28);
  return headerOffset + 30 + nameLen + extraLen;
}
