import { CANVAS_PRESETS } from '@/lib/canvasPresets';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { createEmptyProject } from '@/lib/projectUtils';
import { brandLogoLayer } from '@/lib/imageBrand';
import { textSize as textSizeOf } from '@/lib/imageLayerLayout';
import { adaptLayer, anchorOf, variantDoc } from '@/lib/imageVariants';
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

describe('📐 S12: reszponzív változat (horgonyok)', () => {
  const SIZES = [
    [1080, 1920],
    [1280, 720],
    [1080, 1080],
    [1500, 500],
    [1080, 1350],
  ] as const;
  const inside = (l: TextLayer, W: number, H: number) => {
    const { w, h } = textSizeOf(l, W / H);
    return l.position.x - w / 2 >= -1e-6 && l.position.x + w / 2 <= 1 + 1e-6 && l.position.y - h / 2 >= -1e-6 && l.position.y + h / 2 <= 1 + 1e-6 && w <= 0.92 + 1e-6;
  };

  it.each(IMAGE_TEMPLATES.map((t) => [t.key, t] as const))('%s: minden formátumban a szöveg a vásznon belül, legfeljebb 92% széles', (_k, tpl) => {
    let n = 0;
    const doc = docFromTemplate(tpl, 'x', () => `t${++n}`);
    for (const [W, H] of SIZES) {
      const v = variantDoc(doc, W, H, 'v', () => `v${++n}`);
      for (const l of v.layers) {
        if (l.kind === 'text') expect([tpl.key, W, H, inside(l, W, H)]).toEqual([tpl.key, W, H, true]);
      }
    }
  });

  it('YouTube-indexkép → story: a sarok-logó a sarokban marad, a középre tett cím középen', () => {
    let n = 0;
    const tpl = IMAGE_TEMPLATES.find((t) => t.key === 'youtubeThumb')!;
    const doc = docFromTemplate(tpl, 'x', () => `t${++n}`);
    const logo = brandLogoLayer('file:///logo.png', 'logo', { width: 1280, height: 720 });
    const center = { kind: 'text', id: 'c', text: 'Közép', fontSize: 8, position: { x: 0.5, y: 0.5 } } as TextLayer;
    const v = variantDoc({ ...doc, layers: [...doc.layers, logo, center] }, 1080, 1920, 'story', () => `v${++n}`);
    const lg = v.layers[v.layers.length - 2] as PhotoLayer;
    const ct = v.layers[v.layers.length - 1] as TextLayer;
    // a logó jobb alsó sarka a vászon jobb alsó sarkától ugyanannyira (skálázott margó), négyzet marad
    expect(1 - (lg.position.x + lg.w / 2)).toBeLessThan(0.06);
    expect(1 - (lg.position.y + lg.h / 2)).toBeLessThan(0.06);
    expect((lg.w * 1080) / (lg.h * 1920)).toBeCloseTo(1);
    expect(ct.position).toEqual({ x: 0.5, y: 0.5 });
  });

  it('a horgony a harmadokból', () => {
    expect([anchorOf(0.1), anchorOf(0.5), anchorOf(0.9)]).toEqual(['start', 'center', 'end']);
  });

  it('a csak az egyik tengelyen kitöltő fotó azon a tengelyen kitölt marad', () => {
    const band = { kind: 'photo', id: 'p', uri: 'a', position: { x: 0.72, y: 0.5 }, w: 0.56, h: 1 } as ImageLayer;
    const l = adaptLayer(band, { width: 1280, height: 720 }, { width: 1080, height: 1920 }) as PhotoLayer;
    expect(l.h).toBe(1);
    expect(l.position.y).toBe(0.5);
    expect(l.position.x + l.w / 2).toBeCloseTo(1, 5); // a jobb szélhez tapadt (a margó 0 volt)
  });
});
