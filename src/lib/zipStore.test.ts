import { utf8ToBytes } from '@/lib/sha256';
import {
  bytesToUtf8,
  crc32,
  localDataOffset,
  parseCentralDirectory,
  parseEocd,
  ZipStoreWriter,
} from '@/lib/zipStore';

/**
 * 📦 STORE-zip mag (.rp szabvány): ismert CRC-vektor + teljes kör (író → olvasó),
 * utf8 fájlnévvel és bináris tartalommal.
 */

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('crc32', () => {
  it('ismert vektor: "123456789" → 0xCBF43926', () => {
    expect(crc32(utf8ToBytes('123456789'))).toBe(0xcbf43926);
  });

  it('üres bemenet → 0', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('ZipStoreWriter → olvasó teljes kör', () => {
  function buildArchive(): { bytes: Uint8Array; fileA: Uint8Array; fileB: Uint8Array } {
    const w = new ZipStoreWriter();
    const parts: Uint8Array[] = [];
    // bináris tartalom >127 bájtokkal (CRC + méret próbája)
    const fileA = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    const fileB = utf8ToBytes('{"format":"remix-project"}');

    parts.push(w.beginFile('media/árvíztűrő 🎬.mp4'));
    // darabolt chunk-ok — a streamelés próbája
    parts.push(w.chunk(fileA.subarray(0, 333)));
    parts.push(w.chunk(fileA.subarray(333)));
    parts.push(w.endFile());

    parts.push(w.beginFile('project.json'));
    parts.push(w.chunk(fileB));
    parts.push(w.endFile());

    parts.push(w.finish());
    return { bytes: concat(parts), fileA, fileB };
  }

  it('EOCD + central directory visszaolvasható, nevek utf8-ban', () => {
    const { bytes } = buildArchive();
    const eocd = parseEocd(bytes, 0)!;
    expect(eocd).not.toBeNull();
    expect(eocd.count).toBe(2);
    const cd = bytes.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize);
    const entries = parseCentralDirectory(cd, eocd.count);
    expect(entries.map((e) => e.name)).toEqual(['media/árvíztűrő 🎬.mp4', 'project.json']);
    expect(entries.every((e) => e.method === 0)).toBe(true);
  });

  it('az adat a localDataOffset-nél bájtra pontosan az eredeti, a CRC egyezik', () => {
    const { bytes, fileA, fileB } = buildArchive();
    const eocd = parseEocd(bytes, 0)!;
    const entries = parseCentralDirectory(
      bytes.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize),
      eocd.count,
    );
    const contents = [fileA, fileB];
    entries.forEach((e, i) => {
      const header = bytes.subarray(e.headerOffset, e.headerOffset + 30);
      const start = localDataOffset(header, e.headerOffset);
      const data = bytes.subarray(start, start + e.size);
      expect(e.size).toBe(contents[i].length);
      expect(Array.from(data)).toEqual(Array.from(contents[i]));
      expect(crc32(data)).toBe(e.crc);
    });
  });

  it('determinista: két azonos építés bájtra azonos csomagot ad', () => {
    expect(Array.from(buildArchive().bytes)).toEqual(Array.from(buildArchive().bytes));
  });

  it('hibás sorrend (chunk beginFile nélkül / dupla begin) dob', () => {
    const w = new ZipStoreWriter();
    expect(() => w.chunk(new Uint8Array(1))).toThrow();
    w.beginFile('a');
    expect(() => w.beginFile('b')).toThrow();
  });

  it('bytesToUtf8 ↔ utf8ToBytes kör', () => {
    const s = 'árvíztűrő 🎬 / proj';
    expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
  });
});
