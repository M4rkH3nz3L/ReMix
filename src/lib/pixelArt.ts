/**
 * 👾 Pixel art (pure): indexelt rács, képkockák, paletta, GIF. A 0. index mindig átlátszó, ezért a
 * paletta színe `palette[index - 1]`. A rétegen a tömör szöveges forma él, így újra megnyitható.
 */
export interface PixelArt {
  width: number;
  height: number;
  palette: string[];
  /** képkockánként RLE: `darab:index` vesszővel, 36-os számrendszerben */
  frames: string[];
  fps: number;
}

export type PixelFrame = Uint8Array;
export interface Mirror {
  x: boolean;
  y: boolean;
}

export const TRANSPARENT = 0;
export const MAX_PALETTE = 64;
export const PIXEL_SIZES = [16, 32, 64, 128];
export const MAX_FRAMES = 64;
/** PICO-8 paletta: kicsi, jól bevált kiindulás */
export const DEFAULT_PALETTE = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

export function createPixelArt(width: number, height: number): PixelArt {
  return { width, height, palette: [...DEFAULT_PALETTE], frames: [encodeFrame(new Uint8Array(width * height))], fps: 8 };
}

export function encodeFrame(frame: PixelFrame): string {
  const out: string[] = [];
  for (let i = 0; i < frame.length; ) {
    let j = i;
    while (j < frame.length && frame[j] === frame[i]) {
      j++;
    }
    out.push(`${(j - i).toString(36)}:${frame[i].toString(36)}`);
    i = j;
  }
  return out.join(',');
}

export function decodeFrame(text: string, width: number, height: number): PixelFrame {
  const frame = new Uint8Array(width * height);
  let at = 0;
  for (const run of text.split(',')) {
    const [count, value] = run.split(':').map((v) => parseInt(v, 36));
    if (count > 0) {
      frame.fill(value, at, Math.min(at + count, frame.length));
      at += count;
    }
  }
  return frame;
}

const setPixel = (frame: PixelFrame, w: number, h: number, x: number, y: number, value: number, mirror: Mirror) => {
  const xs = mirror.x ? [x, w - 1 - x] : [x];
  const ys = mirror.y ? [y, h - 1 - y] : [y];
  for (const px of xs) {
    for (const py of ys) {
      if (px >= 0 && py >= 0 && px < w && py < h) {
        frame[py * w + px] = value;
      }
    }
  }
};

/** Bresenham: élsimítás nélküli vonal; helyben ír, mert húzás közben minden mozdulatnál fut. */
export function paintLine(frame: PixelFrame, w: number, h: number, x0: number, y0: number, x1: number, y1: number, value: number, mirror: Mirror): void {
  const [dx, dy] = [Math.abs(x1 - x0), -Math.abs(y1 - y0)];
  const [sx, sy] = [x0 < x1 ? 1 : -1, y0 < y1 ? 1 : -1];
  let [x, y, err] = [x0, y0, dx + dy];
  for (;;) {
    setPixel(frame, w, h, x, y, value, mirror);
    if (x === x1 && y === y1) {
      return;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Négyszomszédos kitöltés; a tükrözött pontból is indul. */
export function floodFill(frame: PixelFrame, w: number, h: number, x: number, y: number, value: number, mirror: Mirror): void {
  const fillFrom = (sx: number, sy: number) => {
    const start = sy * w + sx;
    const from = frame[start];
    if (from === value) {
      return;
    }
    const stack = [start];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      if (frame[i] !== from) {
        continue;
      }
      frame[i] = value;
      const cx = i % w;
      if (cx > 0) stack.push(i - 1);
      if (cx < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
  };
  fillFrom(x, y);
  if (mirror.x) fillFrom(w - 1 - x, y);
  if (mirror.y) fillFrom(x, h - 1 - y);
  if (mirror.x && mirror.y) fillFrom(w - 1 - x, h - 1 - y);
}

export function flipFrame(frame: PixelFrame, w: number, h: number, axis: 'h' | 'v'): PixelFrame {
  const out = new Uint8Array(frame.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = axis === 'h' ? frame[y * w + (w - 1 - x)] : frame[(h - 1 - y) * w + x];
    }
  }
  return out;
}

/** Egész-pixeles eltolás körbefordulással: sprite-animációhoz nem vész el semmi. */
export function shiftFrame(frame: PixelFrame, w: number, h: number, dx: number, dy: number): PixelFrame {
  const out = new Uint8Array(frame.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[((y + dy + h) % h) * w + ((x + dx + w) % w)] = frame[y * w + x];
    }
  }
  return out;
}

/** A szín törlése: a pixelei átlátszók lesznek, a magasabb indexek eggyel lejjebb csúsznak. */
export function removePaletteColor(frames: PixelFrame[], palette: string[], index: number): { frames: PixelFrame[]; palette: string[] } {
  const remap = (v: number) => (v === index ? TRANSPARENT : v > index ? v - 1 : v);
  return { frames: frames.map((f) => f.map(remap)), palette: palette.filter((_, i) => i !== index - 1) };
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** RGBA integer-nagyítással (nearest): a pixel éle éles marad. */
export function frameRgba(frame: PixelFrame, w: number, h: number, palette: string[], scale = 1): Uint8Array {
  const colors = palette.map(hexRgb);
  const out = new Uint8Array(w * scale * h * scale * 4);
  for (let y = 0; y < h * scale; y++) {
    for (let x = 0; x < w * scale; x++) {
      const v = frame[Math.floor(y / scale) * w + Math.floor(x / scale)];
      if (v === TRANSPARENT) {
        continue;
      }
      const at = (y * w * scale + x) * 4;
      const c = colors[v - 1] ?? [0, 0, 0];
      out[at] = c[0];
      out[at + 1] = c[1];
      out[at + 2] = c[2];
      out[at + 3] = 255;
    }
  }
  return out;
}

/** A kockák egy lapon, sorfolytonosan. */
export function spriteSheetRgba(frames: PixelFrame[], w: number, h: number, palette: string[], scale = 1, columns = Math.ceil(Math.sqrt(frames.length))): { rgba: Uint8Array; width: number; height: number } {
  const rows = Math.ceil(frames.length / columns);
  const [fw, fh] = [w * scale, h * scale];
  const [width, height] = [columns * fw, rows * fh];
  const rgba = new Uint8Array(width * height * 4);
  frames.forEach((frame, n) => {
    const cell = frameRgba(frame, w, h, palette, scale);
    const [ox, oy] = [(n % columns) * fw, Math.floor(n / columns) * fh];
    for (let y = 0; y < fh; y++) {
      rgba.set(cell.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * width + ox) * 4);
    }
  });
  return { rgba, width, height };
}

/** A réteg doboza: a pixel négyzet marad, a kép a vászon 80%-ába fér. */
export function pixelLayerBox(artW: number, artH: number, canvasW: number, canvasH: number): { w: number; h: number } {
  const side = 0.8 * Math.min(canvasW / artW, canvasH / artH);
  return { w: (side * artW) / canvasW, h: (side * artH) / canvasH };
}

/** a rétegre kerülő PNG nagyítása: a dokumentum-export se mossa el a pixelt */
export function pixelLayerScale(artW: number, artH: number): number {
  return Math.max(1, Math.ceil(1024 / Math.max(artW, artH)));
}

function lzw(indices: Uint8Array, minCode: number, write: (byte: number) => void): void {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let table = new Map<number, number>();
  let next = eoi + 1;
  let size = minCode + 1;
  let [bits, nbits] = [0, 0];
  const emit = (code: number) => {
    bits |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      write(bits & 255);
      bits >>>= 8;
      nbits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      size = minCode + 1;
    } else {
      table.set(key, next);
      if (next === 1 << size && size < 12) {
        size++;
      }
      next++;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) {
    write(bits & 255);
  }
}

/** Animált GIF függőség nélkül: minden kocka törli az előzőt, a 0. index átlátszó, végtelen ismétlés. */
export function encodeGif(frames: PixelFrame[], w: number, h: number, palette: string[], fps: number, scale = 1): Uint8Array {
  const [W, H] = [w * scale, h * scale];
  let tableBits = 1;
  while (1 << tableBits < palette.length + 1) {
    tableBits++;
  }
  const out: number[] = [];
  const word = (v: number) => out.push(v & 255, (v >> 8) & 255);
  for (const c of 'GIF89a') {
    out.push(c.charCodeAt(0));
  }
  word(W);
  word(H);
  out.push(0x80 | (tableBits - 1), 0, 0, 0, 0, 0);
  palette.forEach((hex) => out.push(...hexRgb(hex)));
  for (let i = palette.length + 1; i < 1 << tableBits; i++) {
    out.push(0, 0, 0);
  }
  out.push(0x21, 0xff, 11);
  for (const c of 'NETSCAPE2.0') {
    out.push(c.charCodeAt(0));
  }
  out.push(3, 1, 0, 0, 0);
  const delay = Math.max(2, Math.round(100 / fps));
  const minCode = Math.max(2, tableBits);
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, (2 << 2) | 1);
    word(delay);
    out.push(TRANSPARENT, 0, 0x2c, 0, 0, 0, 0);
    word(W);
    word(H);
    out.push(0, minCode);
    const scaled = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        scaled[y * W + x] = frame[Math.floor(y / scale) * w + Math.floor(x / scale)];
      }
    }
    let block: number[] = [];
    lzw(scaled, minCode, (byte) => {
      block.push(byte);
      if (block.length === 255) {
        out.push(255, ...block);
        block = [];
      }
    });
    if (block.length > 0) {
      out.push(block.length, ...block);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}
