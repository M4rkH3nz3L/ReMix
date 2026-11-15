import { applyBrand, EMPTY_BRAND, type BrandStyle } from '@/lib/imageBrand';
import { createImageDoc } from '@/lib/imageDoc';
import { nearestAspect } from '@/lib/canvasPresets';
import type { FillLayer, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer, TextLayer } from '@/types/project';

/**
 * 🧩 Kép-sablonok (pure): szerkeszthető rétegekből állnak; a fotó helyén MÉDIA-HELYŐRZŐ lehet
 * (koppintásra kép a galériából, a kompozíció megmarad — IMAGE-PROD S9 · PRO-DESIGN DS1). Média
 * nélkül is azonnal nyithatók, offline.
 */
export type TemplateCategory = 'thumbnail' | 'post' | 'story' | 'banner' | 'cover' | 'poster' | 'invite';

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['thumbnail', 'post', 'story', 'banner', 'cover', 'poster', 'invite'];

type TemplateLayer = Omit<TextLayer | ShapeLayer | PhotoLayer | FillLayer, 'id'>;

export interface ImageTemplate {
  key: string;
  category: TemplateCategory;
  width: number;
  height: number;
  background: string;
  layers: TemplateLayer[];
  /** saját (felhasználói) sablon neve — a beépítetté i18n-kulcs (`studio.image.templates.<key>`) */
  name?: string;
  /** a felhasználó mentette (törölhető) */
  custom?: boolean;
}

/** saját font: a rendszer-font az előnézetben és az exportban eltérő méretű lenne */
const TEMPLATE_FONT = 'Poppins';

const text = (t: string, y: number, fontSize: number, color: string, extra: Partial<TextLayer> = {}) =>
  ({ kind: 'text', text: t, position: { x: 0.5, y }, fontSize, color, fontFamily: TEMPLATE_FONT, fontWeight: 'bold', textAlign: 'center', backgroundColor: null, ...extra }) as TemplateLayer;
const box = (x: number, y: number, w: number, h: number, fill: string, shape: ShapeLayer['shape'] = 'rectangle', extra: Partial<ShapeLayer> = {}) =>
  ({ kind: 'shape', shape, position: { x, y }, w, h, fill, ...extra }) as TemplateLayer;
/** média-helyőrző: üres fotó-réteg a kép helyén és méretében */
const ph = (x: number, y: number, w: number, h: number) =>
  ({ kind: 'photo', uri: '', placeholder: true, position: { x, y }, w, h, fit: 'cover' }) as TemplateLayer;

export const IMAGE_TEMPLATES: ImageTemplate[] = [
  // ── thumbnail 1280×720 ──
  {
    key: 'youtubeThumb',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    background: '#101018',
    layers: [box(0.82, 0.5, 0.5, 0.9, '#ff2d55', 'ellipse'), text('NAGY CÍM', 0.42, 20, '#ffffff', { position: { x: 0.36, y: 0.42 }, textAlign: 'left' }), text('alcím ide', 0.68, 8, '#ffcc00', { position: { x: 0.3, y: 0.68 }, textAlign: 'left' })],
  },
  {
    key: 'thumbFace',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    background: '#0e0e14',
    layers: [ph(0.72, 0.5, 0.56, 1), box(0.22, 0.5, 0.44, 1, '#0e0e14'), text('EZT NEM HISZED', 0.4, 16, '#ffffff', { position: { x: 0.24, y: 0.4 }, boxWidth: 0.42 }), text('új videó', 0.72, 8, '#ffcc00', { position: { x: 0.24, y: 0.72 } })],
  },
  {
    key: 'thumbVersus',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    background: '#14141c',
    layers: [ph(0.25, 0.5, 0.5, 1), ph(0.75, 0.5, 0.5, 1), box(0.5, 0.5, 0.2, 0.36, '#ff2d55', 'ellipse'), text('VS', 0.5, 16, '#ffffff')],
  },
  {
    key: 'thumbList',
    category: 'thumbnail',
    width: 1280,
    height: 720,
    background: '#ffcc00',
    layers: [ph(0.74, 0.5, 0.46, 0.84), text('TOP 5', 0.36, 26, '#101018', { position: { x: 0.27, y: 0.38 } }), text('amit tudnod kell', 0.66, 8, '#101018', { position: { x: 0.27, y: 0.66 } })],
  },
  // ── post 1080×1080 ──
  {
    key: 'instaPost',
    category: 'post',
    width: 1080,
    height: 1080,
    background: '#f7f3ea',
    layers: [box(0.5, 0.5, 0.86, 0.86, '#1c1c28'), text('Mondd el', 0.42, 11, '#ffffff'), text('egy mondatban', 0.56, 6, '#ffcc00')],
  },
  {
    key: 'postQuote',
    category: 'post',
    width: 1080,
    height: 1080,
    background: '#1c1c28',
    layers: [text('“', 0.26, 30, '#ff2d95'), text('Egy gondolat, ami megállít.', 0.5, 8, '#ffffff', { boxWidth: 0.8 }), text('— a neved', 0.74, 5, '#ff2d95')],
  },
  {
    key: 'postPhoto',
    category: 'post',
    width: 1080,
    height: 1080,
    background: '#000000',
    layers: [ph(0.5, 0.5, 1, 1), box(0.5, 0.88, 1, 0.24, '#000000', 'rectangle', { opacity: 0.6 }), text('Itt a cím', 0.88, 8, '#ffffff')],
  },
  {
    key: 'postSale',
    category: 'post',
    width: 1080,
    height: 1080,
    background: '#ff2d55',
    layers: [box(0.5, 0.44, 0.62, 0.62, '#ffcc00', 'star'), text('-30%', 0.44, 16, '#101018'), text('csak a hétvégén', 0.84, 6, '#ffffff')],
  },
  // ── story 1080×1920 ──
  {
    key: 'story',
    category: 'story',
    width: 1080,
    height: 1920,
    background: '#5b3df5',
    layers: [box(0.5, 0.82, 0.8, 0.09, '#ffffff'), text('ÚJDONSÁG', 0.3, 8, '#ffffff'), text('Írd ide', 0.42, 6, '#ffcc00'), text('Nézd meg', 0.82, 3.6, '#5b3df5')],
  },
  {
    key: 'storyPhoto',
    category: 'story',
    width: 1080,
    height: 1920,
    background: '#101018',
    layers: [ph(0.5, 0.32, 1, 0.64), text('Mai nap', 0.74, 8, '#ffffff'), text('pár szó a képhez', 0.82, 4.5, '#ffcc00')],
  },
  {
    key: 'storyPoll',
    category: 'story',
    width: 1080,
    height: 1920,
    background: '#0c2340',
    layers: [text('Melyik?', 0.18, 8, '#ffffff'), ph(0.5, 0.42, 0.8, 0.26), ph(0.5, 0.74, 0.8, 0.26), box(0.14, 0.42, 0.12, 0.068, '#39d98a', 'ellipse'), text('A', 0.42, 4, '#0c2340', { position: { x: 0.14, y: 0.42 } }), box(0.14, 0.74, 0.12, 0.068, '#ff2d95', 'ellipse'), text('B', 0.74, 4, '#0c2340', { position: { x: 0.14, y: 0.74 } })],
  },
  {
    key: 'storyEvent',
    category: 'story',
    width: 1080,
    height: 1920,
    background: '#ff2d95',
    layers: [text('15', 0.3, 30, '#ffffff'), text('NOVEMBER', 0.42, 7, '#ffffff'), box(0.5, 0.68, 0.8, 0.22, '#ffffff'), text('Az esemény neve', 0.66, 5, '#ff2d95'), text('helyszín · időpont', 0.72, 3.6, '#101018')],
  },
  // ── banner ──
  {
    key: 'banner',
    category: 'banner',
    width: 1500,
    height: 500,
    background: '#0c2340',
    layers: [box(0.13, 0.5, 0.2, 0.6, '#39d98a', 'star'), text('A MÁRKÁD NEVE', 0.42, 18, '#ffffff'), text('rövid szlogen', 0.72, 8, '#39d98a')],
  },
  {
    key: 'ytBanner',
    category: 'banner',
    width: 2560,
    height: 1440,
    background: '#101018',
    layers: [box(0.5, 0.5, 0.6, 0.18, '#ff2d55'), text('CSATORNA NEVE', 0.48, 9, '#ffffff'), text('új videó minden héten', 0.6, 3.6, '#ffcc00')],
  },
  {
    key: 'fbCover',
    category: 'banner',
    width: 1640,
    height: 624,
    background: '#f7f3ea',
    layers: [ph(0.76, 0.5, 0.48, 1), text('Üdv nálunk!', 0.42, 14, '#1c1c28', { position: { x: 0.28, y: 0.42 } }), text('miről szól az oldal', 0.66, 7, '#5b3df5', { position: { x: 0.28, y: 0.66 } })],
  },
  {
    key: 'linkedinBanner',
    category: 'banner',
    width: 1584,
    height: 396,
    background: '#0a66c2',
    layers: [box(0.86, 0.5, 0.28, 1, '#ffffff', 'rectangle', { opacity: 0.12 }), text('Szakterület · Tapasztalat', 0.44, 14, '#ffffff', { position: { x: 0.56, y: 0.44 } }), text('egy mondat rólad', 0.7, 7, '#cfe3ff', { position: { x: 0.56, y: 0.7 } })],
  },
  // ── cover ──
  {
    key: 'albumCover',
    category: 'cover',
    width: 1400,
    height: 1400,
    background: '#000000',
    layers: [ph(0.5, 0.5, 1, 1), text('ELŐADÓ', 0.82, 5, '#ffffff'), text('Lemez címe', 0.9, 8, '#ffffff')],
  },
  {
    key: 'podcastCover',
    category: 'cover',
    width: 1400,
    height: 1400,
    background: '#5b3df5',
    layers: [box(0.5, 0.38, 0.46, 0.46, '#ffcc00', 'ellipse'), text('ON AIR', 0.38, 9, '#101018'), text('A PODCAST NEVE', 0.76, 8, '#ffffff', { boxWidth: 0.86 }), text('epizódok minden kedden', 0.88, 4, '#ffcc00')],
  },
  {
    key: 'ebookCover',
    category: 'cover',
    width: 1600,
    height: 2560,
    background: '#1c1c28',
    layers: [ph(0.5, 0.42, 1, 0.56), text('A KÖNYV CÍME', 0.8, 9, '#ffffff', { boxWidth: 0.86 }), text('Szerző Neve', 0.9, 4.5, '#ffcc00')],
  },
  // ── poster 1240×1754 ──
  {
    key: 'posterEvent',
    category: 'poster',
    width: 1240,
    height: 1754,
    background: '#101018',
    layers: [ph(0.5, 0.34, 1, 0.68), text('KONCERT', 0.76, 12, '#ffffff'), text('november 15. · 20:00', 0.84, 4.5, '#ff2d95'), text('helyszín', 0.9, 3.6, '#ffffff')],
  },
  {
    key: 'posterMinimal',
    category: 'poster',
    width: 1240,
    height: 1754,
    background: '#f7f3ea',
    layers: [box(0.5, 0.38, 0.7, 0.5, '#ff2d55', 'ellipse'), text('EGY SZÓ', 0.74, 12, '#1c1c28'), text('és egy alcím', 0.82, 4.5, '#1c1c28')],
  },
  {
    key: 'posterSale',
    category: 'poster',
    width: 1240,
    height: 1754,
    background: '#ffcc00',
    layers: [text('NAGY', 0.22, 16, '#101018'), text('VÁSÁR', 0.34, 16, '#101018'), ph(0.5, 0.62, 0.84, 0.36), text('-50%-ig', 0.9, 7, '#ff2d55')],
  },
  // ── invite 1080×1350 ──
  {
    key: 'inviteParty',
    category: 'invite',
    width: 1080,
    height: 1350,
    background: '#1c1c28',
    layers: [box(0.2, 0.14, 0.24, 0.19, '#ff2d95', 'star'), box(0.84, 0.86, 0.2, 0.16, '#ffcc00', 'star'), text('BULI!', 0.38, 18, '#ffffff'), text('Gyere el!', 0.54, 7, '#ffcc00'), text('dátum · helyszín', 0.68, 4.5, '#ffffff')],
  },
  {
    key: 'inviteWedding',
    category: 'invite',
    width: 1080,
    height: 1350,
    background: '#fbf7f0',
    layers: [ph(0.5, 0.3, 0.6, 0.38), text('Anna & Péter', 0.62, 9, '#5a4a3a'), text('összeházasodunk', 0.72, 4.5, '#a08060'), text('2027. június 12.', 0.82, 4.5, '#5a4a3a')],
  },
  {
    key: 'inviteBirthday',
    category: 'invite',
    width: 1080,
    height: 1350,
    background: '#39d98a',
    layers: [box(0.5, 0.3, 0.42, 0.34, '#ffffff', 'ellipse'), text('30', 0.3, 22, '#39d98a'), text('Születésnap', 0.6, 9, '#101018'), text('dátum · helyszín', 0.72, 4.5, '#101018')],
  },
];

/** a kategória sablonjai (a saját sablonokkal együtt, azok elöl) */
export function templatesIn(category: TemplateCategory | 'all', custom: readonly ImageTemplate[] = []): ImageTemplate[] {
  const all = [...custom, ...IMAGE_TEMPLATES];
  return category === 'all' ? all : all.filter((t) => t.category === category);
}

/** a lap méretéből a legközelebbi kategória (a saját sablon besorolásához) */
export function categoryForSize(width: number, height: number): TemplateCategory {
  const a = width / Math.max(1, height);
  if (a > 2.2) return 'banner';
  if (a > 1.4) return 'thumbnail';
  if (a < 0.62) return 'story';
  if (a < 0.8) return 'poster';
  if (a < 0.95) return 'invite';
  return 'post';
}

/**
 * Saját sablon egy lapból (S9 „Mentés sablonként”): a rétegek azonosító nélkül; a fotókból
 * helyőrző lesz (a kép nem kerül a sablonba — nincs törött hivatkozás, és a sablon tényleg
 * újrahasználható). A háttér a lap saját kitöltő-rétege.
 */
export function templateFromDoc(doc: ImageDoc, key: string, name: string): ImageTemplate {
  const width = doc.width ?? 1080;
  const height = doc.height ?? 1080;
  const layers = doc.layers
    .filter((l) => l.kind === 'text' || l.kind === 'shape' || l.kind === 'photo' || l.kind === 'fill')
    .map((l) => {
      const { id: _id, ...rest } = l as ImageLayer & Record<string, unknown>;
      if (l.kind !== 'photo') return rest as TemplateLayer;
      const p = l as PhotoLayer;
      return ph(p.position.x, p.position.y, p.w, p.h) as TemplateLayer;
    });
  return { key, category: categoryForSize(width, height), width, height, background: 'transparent', layers, name, custom: true };
}

/** A sablonból új lap: friss azonosítók, a rétegek azonnal szerkeszthetők. */
export function docFromTemplate(tpl: ImageTemplate, name: string, makeId: () => string, brand: BrandStyle = EMPTY_BRAND): ImageDoc {
  const doc = createImageDoc(name, nearestAspect(tpl.width, tpl.height), makeId, { width: tpl.width, height: tpl.height, background: tpl.background });
  return applyBrand({ ...doc, layers: [...doc.layers, ...tpl.layers.map((l) => ({ ...(l as object), id: makeId() }) as ImageLayer)] }, brand);
}
