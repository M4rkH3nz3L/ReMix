import { CANVAS_PRESETS } from '@/lib/canvasPresets';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { createEmptyProject } from '@/lib/projectUtils';
import { adaptLayer, variantDoc } from '@/lib/imageVariants';
import type { ImageClip, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer, TextLayer } from '@/types/project';

const from = { width: 1080, height: 1080 };
const to = { width: 1080, height: 1920 };
const circle = { kind: 'shape', id: 'c', shape: 'ellipse', position: { x: 0.5, y: 0.3 }, w: 0.4, h: 0.4, fill: '#f00' } as ImageLayer;

describe('méretváltozat', () => {
  it('a forma nem torzul: a pixel-aránya marad', () => {
    const l = adaptLayer(circle, from, to) as ShapeLayer;
    expect((l.w * to.width) / (l.h * to.height)).toBeCloseTo(1);
  });
  it('a kitöltő fotó az új vásznat is kitölti', () => {
    const photo = { kind: 'photo', id: 'p', uri: 'a', position: { x: 0.5, y: 0.5 }, w: 1, h: 1 } as ImageLayer;
    expect((adaptLayer(photo, from, to) as PhotoLayer).h).toBe(1);
  });
  it('a szöveg képpontban arányos marad a vászon szélességével', () => {
    const t = { kind: 'text', id: 't', text: 'x', fontSize: 10, position: { x: 0.5, y: 0.5 } } as ImageLayer;
    const l = adaptLayer(t, from, to) as TextLayer;
    expect((l.fontSize! / 100) * to.height).toBeCloseTo(108);
  });
  it('kisebb vászonra arányosan csökken', () => {
    const l = adaptLayer(circle, from, { width: 540, height: 540 }) as ShapeLayer;
    expect(l.w).toBeCloseTo(0.4);
  });
  it('új lap saját azonosítókkal, az eredeti érintetlen', () => {
    let n = 0;
    const doc = { id: 'd', name: 'n', width: 1080, height: 1080, aspectRatio: '1:1', layers: [circle] } as unknown as ImageDoc;
    const v = variantDoc(doc, 1080, 1920, 'Story', () => `id${++n}`);
    expect(v.id).not.toBe('d');
    expect(v.layers[0].id).not.toBe('c');
    expect([v.width, v.height, v.name]).toEqual([1080, 1920, 'Story']);
    expect(doc.layers[0]).toBe(circle);
  });
});

describe('platform-méretek és sablonok', () => {
  it('a presetek névvel, a határokon belül', () => {
    for (const p of CANVAS_PRESETS) {
      expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(4096);
      expect(p.label.length).toBeGreaterThan(2);
    }
    expect(CANVAS_PRESETS.some((p) => p.w === 1280 && p.h === 720)).toBe(true);
  });
  it.each(IMAGE_TEMPLATES.map((t) => [t.key, t] as const))('%s: a méret és a rétegek megvannak', (_k, tpl) => {
    let n = 0;
    const doc = docFromTemplate(tpl, 'x', () => `t${++n}`);
    expect([doc.width, doc.height]).toEqual([tpl.width, tpl.height]);
    expect(doc.layers.length).toBeGreaterThan(tpl.layers.length);
    expect(new Set(doc.layers.map((l) => l.id)).size).toBe(doc.layers.length);
  });
});

describe('kép a videóba', () => {
  it('a klip a dokumentumot hordozza, a rétegek megmaradnak', () => {
    const video = createEmptyProject('v', '16:9', undefined, 'video');
    const doc = { id: 'd', name: 'n', layers: [circle, { kind: 'photo', id: 'p', uri: 'file:///f.png', position: { x: 0.5, y: 0.5 }, w: 1, h: 1 } as ImageLayer] } as unknown as ImageDoc;
    const out = addImageDocToVideo(video, doc, 'file:///r.png');
    const clip = out.tracks.find((t) => t.type === 'video')!.clips[0] as ImageClip;
    expect(clip.docId).toBe('d');
    expect(clip.uri).toBe('file:///r.png');
    expect(out.imageDocs?.find((x) => x.id === 'd')?.layers).toHaveLength(2);
    expect(out.assets.map((a) => a.uri)).toEqual(expect.arrayContaining(['file:///r.png', 'file:///f.png']));
  });
});
