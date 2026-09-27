/**
 * 🎨 Design system + SVG-export (S-DESIGN — MASTER §4) — a design-tokenek (colors/
 * typography/spacing/radius/shadows), a komponens/variáns/instancia modell, és a
 * vektor-SVG export TISZTA magja. A layout-geometria a [layout.ts](./layout)-ban;
 * ez a design-system + export réteg. Expo-mentes, determinisztikus.
 */

// ── Design tokenek ────────────────────────────────────────────────────────────

export interface TypeToken {
  family: string;
  size: number;
  weight?: number;
}

export interface DesignTokens {
  colors: Record<string, string>;
  typography: Record<string, TypeToken>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  shadows: Record<string, string>;
}

export function emptyTokens(): DesignTokens {
  return { colors: {}, typography: {}, spacing: {}, radius: {}, shadows: {} };
}

/** Token feloldása `"csoport.név"` hivatkozásból (pl. `"colors.primary"`). */
export function resolveToken(tokens: DesignTokens, ref: string): string | number | TypeToken | undefined {
  const [group, name] = ref.split('.');
  const g = (tokens as unknown as Record<string, Record<string, unknown>>)[group];
  return g ? (g[name] as string | number | TypeToken | undefined) : undefined;
}

// ── Komponens / variáns / instancia ──────────────────────────────────────────

export type PropValue = string | number | boolean;

export interface PropDef {
  name: string;
  default?: PropValue;
}

export interface Variant {
  id: string;
  name: string;
  props: Record<string, PropValue>;
}

export interface Component {
  id: string;
  name: string;
  props: PropDef[];
  variants: Variant[];
}

/**
 * Egy komponens-instancia feloldott property-jei: a prop-alapértékek ← a választott
 * variáns ← az instancia-felülírások (a később nyer). Ismeretlen variáns → csak
 * defaults+overrides.
 */
export function resolveInstance(
  component: Component,
  variantId?: string,
  overrides: Record<string, PropValue> = {}
): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const p of component.props) {
    if (p.default !== undefined) {
      out[p.name] = p.default;
    }
  }
  const variant = component.variants.find((v) => v.id === variantId);
  if (variant) {
    Object.assign(out, variant.props);
  }
  Object.assign(out, overrides);
  return out;
}

// ── SVG-export ────────────────────────────────────────────────────────────────

export type SvgShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill?: string; rx?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string }
  | { kind: 'text'; x: number; y: number; text: string; fontSize?: number; fill?: string; fontFamily?: string }
  | { kind: 'path'; d: string; fill?: string; stroke?: string; strokeWidth?: number };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const attr = (name: string, v: string | number | undefined): string => (v === undefined ? '' : ` ${name}="${typeof v === 'string' ? esc(v) : v}"`);

function shapeToSvg(s: SvgShape): string {
  switch (s.kind) {
    case 'rect':
      return `<rect${attr('x', s.x)}${attr('y', s.y)}${attr('width', s.width)}${attr('height', s.height)}${attr('rx', s.rx)}${attr('fill', s.fill ?? '#000')} />`;
    case 'ellipse':
      return `<ellipse${attr('cx', s.cx)}${attr('cy', s.cy)}${attr('rx', s.rx)}${attr('ry', s.ry)}${attr('fill', s.fill ?? '#000')} />`;
    case 'text':
      return `<text${attr('x', s.x)}${attr('y', s.y)}${attr('font-size', s.fontSize)}${attr('font-family', s.fontFamily)}${attr('fill', s.fill ?? '#000')}>${esc(s.text)}</text>`;
    case 'path':
      return `<path${attr('d', s.d)}${attr('fill', s.fill ?? 'none')}${attr('stroke', s.stroke)}${attr('stroke-width', s.strokeWidth)} />`;
  }
}

export interface SvgOptions {
  width: number;
  height: number;
  background?: string;
}

/** Vektor-alakzatok → SVG-string (artboard-export magja). */
export function shapesToSvg(shapes: SvgShape[], opts: SvgOptions): string {
  const body = shapes.map(shapeToSvg).join('\n  ');
  const bg = opts.background ? `\n  <rect x="0" y="0" width="${opts.width}" height="${opts.height}" fill="${esc(opts.background)}" />` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 ${opts.width} ${opts.height}">${bg}\n  ${body}\n</svg>`;
}
