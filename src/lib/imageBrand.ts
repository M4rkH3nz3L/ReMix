import type { ImageDoc, ImageLayer, ShapeLayer, TextLayer } from '@/types/project';

/** 🎨 Saját márka-színek és -font (pure): a sablonok ezekkel nyílnak, és minden színválasztóban ott vannak. */
export interface BrandStyle {
  colors: string[];
  fontFamily?: string;
}

export const EMPTY_BRAND: BrandStyle = { colors: [] };
export const MAX_BRAND_COLORS = 6;

/** az ennél kisebb színességű szín semleges: fekete-fehér alap, nem márka-elem */
const NEUTRAL_CHROMA = 64;
/** a nagy szöveg WCAG-minimuma */
const MIN_CONTRAST = 3;

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
};

export function isNeutral(hex: string): boolean {
  const c = rgb(hex);
  return !c || Math.max(...c) - Math.min(...c) < NEUTRAL_CHROMA;
}

function luminance(hex: string): number {
  const [r, g, b] = (rgb(hex) ?? [0, 0, 0]).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** az új szín előre kerül; a limit fölött a legrégebbi esik ki */
export function addBrandColor(style: BrandStyle, color: string): BrandStyle {
  const c = color.toLowerCase();
  return { ...style, colors: [c, ...style.colors.filter((x) => x !== c)].slice(0, MAX_BRAND_COLORS) };
}

export function removeBrandColor(style: BrandStyle, color: string): BrandStyle {
  return { ...style, colors: style.colors.filter((x) => x !== color.toLowerCase()) };
}

const colorOf = (l: ImageLayer): string | null =>
  l.kind === 'fill' || l.kind === 'shape' ? l.fill : l.kind === 'text' ? l.color : null;

const recolor = (l: ImageLayer, map: Map<string, string>): ImageLayer => {
  const next = map.get(colorOf(l)?.toLowerCase() ?? '');
  if (!next) {
    return l;
  }
  return l.kind === 'text' ? { ...l, color: next } : ({ ...l, fill: next } as ImageLayer);
};

/** a szöveg mögötti szín: a felülről első forma, ami alatta van, különben a háttér */
function backingOf(layers: ImageLayer[], index: number): string | null {
  const { x, y } = (layers[index] as TextLayer).position;
  for (let i = index - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.kind === 'fill') {
      return l.fill;
    }
    if (l.kind === 'shape') {
      const s = l as ShapeLayer;
      if (Math.abs(x - s.position.x) <= s.w / 2 && Math.abs(y - s.position.y) <= s.h / 2) {
        return s.fill;
      }
    }
  }
  return null;
}

const readable = (color: string, back: string): string =>
  contrast(color, back) >= MIN_CONTRAST ? color : contrast('#ffffff', back) >= contrast('#000000', back) ? '#ffffff' : '#000000';

/**
 * A márkát ráteszi a dokumentumra: a színes elemek sorban a márka-színeket kapják, a semlegesek
 * maradnak, a szöveg a márka-fontot. A szöveg olvasható marad: ha a mögötte lévő szín túl közel
 * kerül hozzá, fehér vagy fekete lesz.
 */
export function applyBrand(doc: ImageDoc, style: BrandStyle): ImageDoc {
  if (style.colors.length === 0 && !style.fontFamily) {
    return doc;
  }
  const accents = [...new Set(doc.layers.map((l) => colorOf(l)?.toLowerCase() ?? '').filter((c) => c && !isNeutral(c)))];
  const map = new Map(style.colors.length ? accents.map((c, i) => [c, style.colors[i % style.colors.length]]) : []);
  const layers = doc.layers.map((l) => recolor(l, map));
  const final = layers.map((l, i) => {
    if (l.kind !== 'text') {
      return l;
    }
    const back = backingOf(layers, i);
    return {
      ...l,
      color: back ? readable(l.color, back) : l.color,
      ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    };
  });
  return { ...doc, layers: final, renderedUri: undefined };
}
