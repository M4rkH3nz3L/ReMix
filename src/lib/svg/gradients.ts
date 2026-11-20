import type { GradientStop, ShapeGradient } from '@/types/project';
import { clamp01, resolveStyle } from './style';
import type { XmlNode } from './xml';

// ── Gradiensek ───────────────────────────────────────────────────────────────

export function collectGradients(root: XmlNode): Record<string, ShapeGradient> {
  const raw: Record<string, XmlNode> = {};
  const walk = (n: XmlNode) => {
    if ((n.tag === 'linearGradient' || n.tag === 'radialGradient') && n.attrs.id) raw[n.attrs.id] = n;
    n.children.forEach(walk);
  };
  walk(root);
  const out: Record<string, ShapeGradient> = {};
  const stopsOf = (n: XmlNode): GradientStop[] => {
    const href = (n.attrs['xlink:href'] || n.attrs.href || '').replace('#', '');
    const src = n.children.some((c) => c.tag === 'stop') || !href ? n : raw[href] ?? n;
    return src.children
      .filter((c) => c.tag === 'stop')
      .map((c) => {
        const st = resolveStyle(c, {});
        const stopColor = c.attrs['stop-color'] || parseStyleProp(c, 'stop-color') || st.fill || '#000000';
        return { color: stopColor, at: clamp01(parseOffset(c.attrs.offset)) };
      })
      .sort((a, b) => a.at - b.at);
  };
  for (const [id, n] of Object.entries(raw)) {
    const stops = stopsOf(n);
    if (stops.length < 2) continue;
    if (n.tag === 'radialGradient') {
      out[id] = { type: 'radial', stops };
    } else {
      const x1 = parseFloat(n.attrs.x1 ?? '0');
      const y1 = parseFloat(n.attrs.y1 ?? '0');
      const x2 = parseFloat(n.attrs.x2 ?? '1');
      const y2 = parseFloat(n.attrs.y2 ?? '0');
      const angle = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
      out[id] = { type: 'linear', angle, stops };
    }
  }
  return out;
}

function parseStyleProp(n: XmlNode, prop: string): string | undefined {
  const style = n.attrs.style;
  if (!style) return undefined;
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0 && decl.slice(0, i).trim() === prop) return decl.slice(i + 1).trim();
  }
  return undefined;
}

const parseOffset = (v: string | undefined): number => {
  if (v == null) return 0;
  return v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
};
