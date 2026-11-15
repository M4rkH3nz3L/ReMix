import { clipBaseBelow, flattenRing, resolveClipMasks, shapeOutlineOnCanvas } from '@/lib/imageClip';
import { selectionContains } from '@/lib/selection';
import type { ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

const photo = (extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id: 'p', uri: 'a.png', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover', ...extra }) as ImageLayer;
const shape = (extra: Partial<ShapeLayer> = {}) => ({ kind: 'shape', id: 's', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, fill: '#fff', ...extra }) as ImageLayer;
const doc = (layers: ImageLayer[]) => ({ id: 'd', name: 'd', aspectRatio: '1:1', width: 400, height: 400, layers }) as unknown as ImageDoc;
const inMask = (d: ImageDoc, x: number, y: number) => {
  const m = (d.layers.find((l) => l.id === 'p') as PhotoLayer).mask!;
  return selectionContains({ ops: m.ops!, feather: 0, invert: !!m.invert }, { x, y });
};

describe('✂️ S18: vágómaszk', () => {
  it('a fotó a forma alakját kapja maszkként (ellipszis: a közép bent, a sarok kint)', () => {
    const r = resolveClipMasks(doc([shape(), photo({ clipTo: 's' })]));
    expect(inMask(r, 0.5, 0.5)).toBe(true);
    expect(inMask(r, 0.68, 0.5)).toBe(true);
    expect(inMask(r, 0.68, 0.68)).toBe(false);
    expect(inMask(r, 0.1, 0.1)).toBe(false);
  });

  it('a forma forgatása és a lekerekített sarok a vágásban is megjelenik', () => {
    const rot = resolveClipMasks(doc([shape({ shape: 'rectangle', w: 0.6, h: 0.2, rotation: 90 }), photo({ clipTo: 's' })]));
    expect(inMask(rot, 0.5, 0.75)).toBe(true); // 90°: a hosszú oldal függőleges
    expect(inMask(rot, 0.75, 0.5)).toBe(false);
    const round = resolveClipMasks(doc([shape({ shape: 'rectangle', cornerRadius: 0.5 }), photo({ clipTo: 's' })]));
    expect(inMask(round, 0.31, 0.31)).toBe(false); // a lekerekített sarok kint
    expect(inMask(round, 0.5, 0.31)).toBe(true);
  });

  it('élő kapcsolat: a forma elmozdítva a vágás is vele megy', () => {
    const moved = resolveClipMasks(doc([shape({ position: { x: 0.3, y: 0.3 } }), photo({ clipTo: 's' })]));
    expect(inMask(moved, 0.3, 0.3)).toBe(true);
    expect(inMask(moved, 0.6, 0.6)).toBe(false);
  });

  it('a saját maszkkal metszve: csak a kettő közös része látszik', () => {
    const own = { shape: 'rectangle' as const, x: 0.25, y: 0.5, w: 0.5, h: 1, feather: 0 };
    const r = resolveClipMasks(doc([shape(), photo({ clipTo: 's', mask: own })]));
    expect(inMask(r, 0.4, 0.5)).toBe(true);
    expect(inMask(r, 0.6, 0.5)).toBe(false); // a forma része, de a saját maszkon kívül
  });

  it('hiányzó, rejtett vagy nem-forma alap: nincs vágás; a dokumentum vágás nélkül változatlan', () => {
    const plain = doc([shape(), photo()]);
    expect(resolveClipMasks(plain)).toBe(plain);
    for (const d of [doc([photo({ clipTo: 'x' })]), doc([shape({ hidden: true }), photo({ clipTo: 's' })])]) {
      expect((resolveClipMasks(d).layers.find((l) => l.id === 'p') as PhotoLayer).mask).toBeUndefined();
    }
  });

  it('görbe forma: a Bézier-ív sűrítve; nyitott görbe nem alap', () => {
    const ring = flattenRing([{ x: 0, y: 0, h2: { x: 0.5, y: -0.5 } }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], 10);
    expect(ring.length).toBeGreaterThan(10);
    expect(Math.min(...ring.map((p) => p.y))).toBeLessThan(-0.2); // egy fogós ív csúcsa: 4/9 × (−0,5)
    const open = shape({ shape: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }) as ShapeLayer;
    expect(shapeOutlineOnCanvas(open, { width: 400, height: 400 })).toBeNull();
    expect(clipBaseBelow(doc([open as ImageLayer, photo()]), 'p')).toBeNull();
    expect(clipBaseBelow(doc([shape(), photo()]), 'p')?.id).toBe('s');
    expect(clipBaseBelow(doc([photo(), shape()]), 'p')).toBeNull(); // a forma fölötte van
  });
});
