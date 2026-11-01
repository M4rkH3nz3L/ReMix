import {
  createPixelArt,
  decodeFrame,
  DEFAULT_PALETTE,
  encodeFrame,
  encodeGif,
  flipFrame,
  floodFill,
  frameRgba,
  paintLine,
  pixelLayerBox,
  removePaletteColor,
  shiftFrame,
  spriteSheetRgba,
} from '@/lib/pixelArt';

const none = { x: false, y: false };
const grid = (w: number, h: number) => new Uint8Array(w * h);
const on = (f: Uint8Array) => [...f.keys()].filter((i) => f[i] !== 0);

/** független GIF-olvasó: a kódolót nem a saját táblájával ellenőrizzük */
function readGif(bytes: Uint8Array) {
  let at = 6;
  const u16 = () => bytes[at++] | (bytes[at++] << 8);
  const [width, height] = [u16(), u16()];
  const flags = bytes[at];
  at += 3;
  const tableSize = 2 << (flags & 7);
  const table = bytes.slice(at, at + tableSize * 3);
  at += tableSize * 3;
  const frames: { delay: number; transparent: number; disposal: number; pixels: number[] }[] = [];
  let gce = { delay: 0, transparent: -1, disposal: 0 };
  for (;;) {
    const tag = bytes[at++];
    if (tag === 0x3b) {
      return { width, height, table, frames };
    }
    if (tag === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        at++;
        const packed = bytes[at++];
        const delay = u16();
        gce = { delay, transparent: packed & 1 ? bytes[at] : -1, disposal: (packed >> 2) & 7 };
        at += 2;
      } else {
        while (bytes[at] !== 0) at += bytes[at] + 1;
        at++;
      }
      continue;
    }
    if (tag !== 0x2c) {
      throw new Error(`váratlan blokk ${tag} @${at}`);
    }
    at += 9;
    const minCode = bytes[at++];
    const data: number[] = [];
    while (bytes[at] !== 0) {
      const n = bytes[at++];
      for (let i = 0; i < n; i++) data.push(bytes[at++]);
    }
    at++;
    const clear = 1 << minCode;
    const pixels: number[] = [];
    let [size, bits, nbits, p] = [minCode + 1, 0, 0, 0];
    let dict: number[][] = [];
    const reset = () => {
      dict = Array.from({ length: clear + 2 }, (_, i) => [i]);
      size = minCode + 1;
    };
    reset();
    let prev: number[] | null = null;
    for (;;) {
      while (nbits < size) {
        bits |= data[p++] << nbits;
        nbits += 8;
      }
      const code = bits & ((1 << size) - 1);
      bits >>>= size;
      nbits -= size;
      if (code === clear) {
        reset();
        prev = null;
        continue;
      }
      if (code === clear + 1) {
        break;
      }
      const entry: number[] = code < dict.length ? dict[code] : [...(prev as number[]), (prev as number[])[0]];
      pixels.push(...entry);
      if (prev && dict.length < 4096) {
        dict.push([...prev, entry[0]]);
        if (dict.length === 1 << size && size < 12) size++;
      }
      prev = entry;
    }
    frames.push({ ...gce, pixels });
  }
}

describe('RLE', () => {
  it('visszaalakítható, és a kihagyott rajz rövid', () => {
    const f = grid(128, 128);
    f[5] = 3;
    f[16383] = 9;
    const text = encodeFrame(f);
    expect(text.length).toBeLessThan(40);
    expect(decodeFrame(text, 128, 128)).toEqual(f);
  });

  it('a csonka szöveg nem ír a rácson kívülre', () => {
    expect(decodeFrame('zz:1', 4, 4)).toHaveLength(16);
  });
});

describe('rajz', () => {
  it('az átló pontosan egy pixel széles, élsimítás nélkül', () => {
    const f = grid(5, 5);
    paintLine(f, 5, 5, 0, 0, 4, 4, 2, none);
    expect(on(f)).toEqual([0, 6, 12, 18, 24]);
    expect(new Set(f)).toEqual(new Set([0, 2]));
  });

  it('a vízszintes tükör a másik oldalra is rajzol', () => {
    const f = grid(6, 2);
    paintLine(f, 6, 2, 1, 0, 1, 0, 1, { x: true, y: false });
    expect(on(f)).toEqual([1, 4]);
  });

  it('mindkét tükörrel négy pont lesz', () => {
    const f = grid(4, 4);
    paintLine(f, 4, 4, 0, 0, 0, 0, 1, { x: true, y: true });
    expect(on(f)).toEqual([0, 3, 12, 15]);
  });

  it('a kitöltés megáll a vonalnál', () => {
    const f = grid(5, 5);
    paintLine(f, 5, 5, 2, 0, 2, 4, 1, none);
    floodFill(f, 5, 5, 0, 0, 2, none);
    expect(f[0]).toBe(2);
    expect(f[4]).toBe(0);
    expect(f[2]).toBe(1);
  });

  it('a kitöltés nem csordul át a sor végén', () => {
    const f = grid(3, 3);
    paintLine(f, 3, 3, 0, 1, 2, 1, 1, none);
    floodFill(f, 3, 3, 2, 0, 2, none);
    expect(f[3]).toBe(1);
    expect(f[6]).toBe(0);
  });

  it('az azonos színű kitöltés nem akad el', () => {
    const f = grid(3, 3);
    floodFill(f, 3, 3, 0, 0, 0, none);
    expect(on(f)).toEqual([]);
  });

  it('tükrözés és eltolás visszaalakítható', () => {
    const f = grid(4, 3);
    f[1] = 5;
    expect(flipFrame(flipFrame(f, 4, 3, 'h'), 4, 3, 'h')).toEqual(f);
    expect(flipFrame(flipFrame(f, 4, 3, 'v'), 4, 3, 'v')).toEqual(f);
    expect(shiftFrame(shiftFrame(f, 4, 3, 2, 1), 4, 3, -2, -1)).toEqual(f);
  });

  it('az eltolás körbefordul', () => {
    const f = grid(3, 1);
    f[2] = 1;
    expect(on(shiftFrame(f, 3, 1, 1, 0))).toEqual([0]);
  });
});

describe('paletta', () => {
  it('a törölt szín átlátszó lesz, a többi a saját színén marad', () => {
    const f = Uint8Array.from([1, 2, 3]);
    const out = removePaletteColor([f], ['#111111', '#222222', '#333333'], 2);
    expect([...out.frames[0]]).toEqual([1, 0, 2]);
    expect(out.palette).toEqual(['#111111', '#333333']);
  });
});

describe('kép', () => {
  it('az átlátszó index alfája 0, a szín pontos, a nagyítás éles', () => {
    const rgba = frameRgba(Uint8Array.from([0, 9]), 2, 1, DEFAULT_PALETTE, 2);
    expect(rgba).toHaveLength(2 * 2 * 2 * 4);
    expect(rgba[3]).toBe(0);
    expect([...rgba.slice(8, 12)]).toEqual([255, 0, 77, 255]);
    expect([...rgba.slice(12, 16)]).toEqual([255, 0, 77, 255]);
  });

  it('sprite-lap: a kockák a helyükön vannak', () => {
    const sheet = spriteSheetRgba([Uint8Array.from([1]), Uint8Array.from([0]), Uint8Array.from([9])], 1, 1, DEFAULT_PALETTE);
    expect([sheet.width, sheet.height]).toEqual([2, 2]);
    expect(sheet.rgba[3]).toBe(255);
    expect(sheet.rgba[7]).toBe(0);
    expect([...sheet.rgba.slice(8, 11)]).toEqual([255, 0, 77]);
  });

  it('a réteg pixele négyzet marad széles vásznon is', () => {
    const box = pixelLayerBox(32, 32, 1600, 900);
    expect((box.w * 1600) / (box.h * 900)).toBeCloseTo(1);
    expect(box.h).toBeCloseTo(0.8);
  });
});

describe('GIF', () => {
  const noise = (w: number, h: number, seed: number) => {
    const f = grid(w, h);
    let s = seed;
    for (let i = 0; i < f.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      f[i] = (s >> 16) % 17;
    }
    return f;
  };

  it.each([[16, 1], [64, 1], [128, 2]])('%i px, %i× nagyítás: minden pixel visszaolvasható', (size, scale) => {
    const frames = [noise(size, size, 1), noise(size, size, 2), noise(size, size, 3)];
    const gif = readGif(encodeGif(frames, size, size, DEFAULT_PALETTE, 8, scale));
    expect([gif.width, gif.height]).toEqual([size * scale, size * scale]);
    expect(gif.frames).toHaveLength(3);
    frames.forEach((f, n) => {
      const got = gif.frames[n].pixels;
      expect(got).toHaveLength(size * size * scale * scale);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (got[y * scale * (size * scale) + x * scale] !== f[y * size + x]) {
            throw new Error(`eltérés ${n}: ${x},${y}`);
          }
        }
      }
    });
  });

  it('átlátszóság, időzítés és képkocka-törlés', () => {
    const gif = readGif(encodeGif([grid(4, 4)], 4, 4, DEFAULT_PALETTE, 10));
    expect(gif.frames[0]).toMatchObject({ transparent: 0, delay: 10, disposal: 2 });
  });

  it('a 0. palettahely üres, az 1. az első szín', () => {
    const gif = readGif(encodeGif([grid(2, 2)], 2, 2, ['#ff0000'], 8));
    expect([...gif.table.slice(0, 6)]).toEqual([0, 0, 0, 255, 0, 0]);
  });

  it('a 16 színű paletta 32 helyes táblát kap (a 0. index miatt)', () => {
    expect(readGif(encodeGif([grid(2, 2)], 2, 2, DEFAULT_PALETTE, 8)).table).toHaveLength(32 * 3);
  });

  it('nagy, sok képkockás munka is elkészül', () => {
    const frames = Array.from({ length: 8 }, (_, i) => noise(128, 128, i + 1));
    expect(readGif(encodeGif(frames, 128, 128, DEFAULT_PALETTE, 8, 4)).frames).toHaveLength(8);
  });
});

describe('createPixelArt', () => {
  it('üres, átlátszó első kockával indul', () => {
    const art = createPixelArt(16, 16);
    expect(on(decodeFrame(art.frames[0], 16, 16))).toEqual([]);
  });
});
