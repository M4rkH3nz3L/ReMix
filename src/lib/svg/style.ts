import type { XmlNode } from './xml';

// ── Stílus ───────────────────────────────────────────────────────────────────

export interface Style {
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  textAnchor?: string;
  fillRule?: 'nonzero' | 'evenodd';
}

const INHERIT: (keyof Style)[] = [
  'fill',
  'fillRule',
  'stroke',
  'strokeWidth',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'textAnchor',
  'fillOpacity',
];

export function resolveStyle(node: XmlNode, parent: Style): Style {
  const s: Style = {};
  for (const k of INHERIT) if (parent[k] !== undefined) (s as Record<string, unknown>)[k] = parent[k];
  // az `opacity` nem öröklődik, hanem SZORZÓDIK a csoportokon át
  const inherited = parent.opacity ?? 1;
  if (inherited !== 1) s.opacity = inherited;
  const set = (key: string, val: string) => {
    const v = val.trim();
    switch (key) {
      case 'fill':
        s.fill = v;
        break;
      case 'fill-opacity':
        s.fillOpacity = parseFloat(v);
        break;
      case 'fill-rule':
        s.fillRule = v === 'evenodd' ? 'evenodd' : 'nonzero';
        break;
      case 'stroke':
        s.stroke = v;
        break;
      case 'stroke-width':
        s.strokeWidth = parseLen(v);
        break;
      case 'opacity':
        s.opacity = inherited * parseFloat(v);
        break;
      case 'font-size':
        s.fontSize = parseLen(v);
        break;
      case 'font-family':
        s.fontFamily = v.replace(/['"]/g, '').split(',')[0].trim();
        break;
      case 'font-weight':
        s.fontWeight = v;
        break;
      case 'text-anchor':
        s.textAnchor = v;
        break;
      default:
        break;
    }
  };
  for (const [k, v] of Object.entries(node.attrs)) set(k, v);
  // inline style felülír
  if (node.attrs.style) {
    for (const decl of node.attrs.style.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) set(decl.slice(0, i).trim(), decl.slice(i + 1));
    }
  }
  return s;
}

export function parseLen(v: string): number {
  return parseFloat(String(v).replace(/px|pt|em|%/g, '')) || 0;
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const round = (v: number) => Math.round(v * 1e4) / 1e4;
export const urlId = (v?: string): string | null => {
  const m = v && /url\(#([^)]+)\)/.exec(v);
  return m ? m[1] : null;
};
