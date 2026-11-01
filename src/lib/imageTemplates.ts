import { applyBrand, EMPTY_BRAND, type BrandStyle } from '@/lib/imageBrand';
import { createImageDoc } from '@/lib/imageDoc';
import { nearestAspect } from '@/lib/canvasPresets';
import type { ImageDoc, ImageLayer, ShapeLayer, TextLayer } from '@/types/project';

/** 🧩 Kép-sablonok (pure): szerkeszthető rétegekből állnak, média nélkül, így bárhol azonnal nyithatók. */
export interface ImageTemplate {
  key: string;
  width: number;
  height: number;
  background: string;
  layers: Omit<TextLayer | ShapeLayer, 'id'>[];
}

/** saját font: a rendszer-font az előnézetben és az exportban eltérő méretű lenne */
const TEMPLATE_FONT = 'Poppins';

const text = (t: string, y: number, fontSize: number, color: string, extra: Partial<TextLayer> = {}) =>
  ({ kind: 'text', text: t, position: { x: 0.5, y }, fontSize, color, fontFamily: TEMPLATE_FONT, fontWeight: 'bold', textAlign: 'center', backgroundColor: null, ...extra }) as ImageTemplate['layers'][number];
const box = (x: number, y: number, w: number, h: number, fill: string, shape: ShapeLayer['shape'] = 'rectangle') =>
  ({ kind: 'shape', shape, position: { x, y }, w, h, fill }) as ImageTemplate['layers'][number];

export const IMAGE_TEMPLATES: ImageTemplate[] = [
  {
    key: 'youtubeThumb',
    width: 1280,
    height: 720,
    background: '#101018',
    layers: [box(0.82, 0.5, 0.5, 0.9, '#ff2d55', 'ellipse'), text('NAGY CÍM', 0.42, 20, '#ffffff', { position: { x: 0.36, y: 0.42 }, textAlign: 'left' }), text('alcím ide', 0.68, 8, '#ffcc00', { position: { x: 0.3, y: 0.68 }, textAlign: 'left' })],
  },
  {
    key: 'instaPost',
    width: 1080,
    height: 1080,
    background: '#f7f3ea',
    layers: [box(0.5, 0.5, 0.86, 0.86, '#1c1c28'), text('Mondd el', 0.42, 11, '#ffffff'), text('egy mondatban', 0.56, 6, '#ffcc00')],
  },
  {
    key: 'story',
    width: 1080,
    height: 1920,
    background: '#5b3df5',
    layers: [box(0.5, 0.82, 0.8, 0.09, '#ffffff'), text('ÚJDONSÁG', 0.3, 8, '#ffffff'), text('Írd ide', 0.42, 6, '#ffcc00'), text('Nézd meg', 0.82, 3.6, '#5b3df5')],
  },
  {
    key: 'banner',
    width: 1500,
    height: 500,
    background: '#0c2340',
    layers: [box(0.13, 0.5, 0.2, 0.6, '#39d98a', 'star'), text('A MÁRKÁD NEVE', 0.42, 18, '#ffffff'), text('rövid szlogen', 0.72, 8, '#39d98a')],
  },
];

/** A sablonból új lap: friss azonosítók, a rétegek azonnal szerkeszthetők. */
export function docFromTemplate(tpl: ImageTemplate, name: string, makeId: () => string, brand: BrandStyle = EMPTY_BRAND): ImageDoc {
  const doc = createImageDoc(name, nearestAspect(tpl.width, tpl.height), makeId, { width: tpl.width, height: tpl.height, background: tpl.background });
  return applyBrand({ ...doc, layers: [...doc.layers, ...tpl.layers.map((l) => ({ ...(l as object), id: makeId() }) as ImageLayer)] }, brand);
}
