import type { BlendMode, ShapeLayer, TextLayer } from '@/types/project';

/**
 * 🎛️ A Kép Stúdió réteg-tulajdonság szerkesztőjének
 * (`components/studio/image/LayerInspector.tsx`) tiszta, expo-mentes magja: a chip-sorok
 * opció-listái és a körvonal alap-igazítása — önmagukban tesztelhetők.
 */

export const BLENDS: (BlendMode | 'normal')[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'softlight',
  'hardlight',
  'difference',
  'exclusion',
  'colordodge',
  'colorburn',
];
export const SHAPES: ShapeLayer['shape'][] = ['rectangle', 'ellipse', 'line', 'arrow', 'star', 'polygon'];
export const TEXT_ALIGNS: { key: NonNullable<TextLayer['textAlign']> }[] = [{ key: 'left' }, { key: 'center' }, { key: 'right' }, { key: 'justify' }];
export const DASHES: { value: number; labelKey: string }[] = [
  { value: 0, labelKey: 'studio.image.stroke.solid' },
  { value: 1, labelKey: 'studio.image.stroke.dotted' },
  { value: 3, labelKey: 'studio.image.stroke.dashed' },
];
export const CAPS: NonNullable<ShapeLayer['strokeCap']>[] = ['round', 'butt', 'square'];
export const JOINS: NonNullable<ShapeLayer['strokeJoin']>[] = ['round', 'miter', 'bevel'];

/** a régi (igazítás nélküli) körvonal helye formánként — a chip ezt mutatja aktívnak */
export function defaultBorderAlign(l: ShapeLayer): 'inside' | 'center' | 'outside' {
  return l.shape === 'rectangle' || l.shape === 'ellipse' ? 'inside' : l.shape === 'path' ? 'center' : 'outside';
}
