// 🔤 I32: minden beépített font tartalmazza a teljes magyar ékezetkészletet (cmap-ból olvasva).
const fs = require('fs');
const path = require('path');

/** a font format-4 cmap-táblájának kódpontjai */
function codepoints(file) {
  const b = fs.readFileSync(file);
  const tables = b.readUInt16BE(4);
  let cmap = 0;
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (b.toString('latin1', rec, rec + 4) === 'cmap') cmap = b.readUInt32BE(rec + 8);
  }
  const out = new Set();
  const subtables = b.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const at = cmap + b.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (b.readUInt16BE(at) !== 4) continue;
    const segs = b.readUInt16BE(at + 6) / 2;
    const end = at + 14;
    const start = end + segs * 2 + 2;
    for (let s = 0; s < segs; s++) {
      const e = b.readUInt16BE(end + s * 2);
      for (let c = b.readUInt16BE(start + s * 2); c <= e && c < 0xffff; c++) out.add(c);
    }
  }
  return out;
}

// a kliens és a worker saját másolata is (a parity miatt mindkettőnek egyeznie kell)
const dirs = [path.join(__dirname, '..', 'assets', 'fonts'), path.join(__dirname, 'assets', 'fonts')];
const fonts = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.ttf')).map((f) => path.join(d, f)));

test.each(fonts)('%s: teljes magyar ékezetkészlet', (file) => {
  const have = codepoints(file);
  const missing = [...'áéíóöőúüűÁÉÍÓÖŐÚÜŰ'].filter((c) => !have.has(c.codePointAt(0)));
  expect(missing).toEqual([]);
});
