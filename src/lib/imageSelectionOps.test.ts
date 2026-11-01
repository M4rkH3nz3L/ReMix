import { updateLayer } from '@/lib/imageDoc';
import { adjustSelection, copySelectionToLayer, deleteSelection, maskFromSelection, selectionTarget, shiftMask } from '@/lib/imageSelectionOps';
import { applyRing, invertSelection, rectRing, type Selection, selectionContains } from '@/lib/selection';
import type { ClipMask, ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

const pt = (x: number, y: number) => ({ x, y });
const sel = applyRing(null, rectRing(pt(0.2, 0.2), pt(0.6, 0.6)), 'new')!;
const photo = (id: string, extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id, uri: `${id}.png`, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'contain', ...extra }) as ImageLayer;
const doc = (...layers: ImageLayer[]) => ({ id: 'd', name: 'n', layers }) as unknown as ImageDoc;
const asSel = (m: ClipMask): Selection => ({ ops: m.ops!, feather: 0, invert: !!m.invert });
const maskOf = (d: ImageDoc, id: string) => (d.layers.find((l) => l.id === id) as PhotoLayer).mask!;

describe('másolás új rétegre', () => {
  it('az eredeti fölé kerül, az eredeti érintetlen', () => {
    const d = copySelectionToLayer(doc(photo('a'), photo('b')), 'a', sel, 'c')!;
    expect(d.layers.map((l) => l.id)).toEqual(['a', 'c', 'b']);
    expect((d.layers[0] as PhotoLayer).mask).toBeUndefined();
    expect(selectionContains(asSel(maskOf(d, 'c')), pt(0.3, 0.3))).toBe(true);
  });
  it('maszkolt rétegről csak a látható rész jön', () => {
    const visible: ClipMask = { shape: 'polygon', x: 0.3, y: 0.3, w: 0.2, h: 0.2, points: rectRing(pt(0.2, 0.2), pt(0.4, 0.4)) };
    const d = copySelectionToLayer(doc(photo('a', { mask: visible })), 'a', sel, 'c')!;
    const s = asSel(maskOf(d, 'c'));
    expect(selectionContains(s, pt(0.3, 0.3))).toBe(true);
    expect(selectionContains(s, pt(0.5, 0.5))).toBe(false);
  });
  it('lyukas réteg lyuka a másolatban is lyuk', () => {
    const holed = deleteSelection(doc(photo('a')), 'a', applyRing(null, rectRing(pt(0.3, 0.3), pt(0.4, 0.4)), 'new')!)!;
    const d = copySelectionToLayer(holed, 'a', sel, 'c')!;
    const s = asSel(maskOf(d, 'c'));
    expect(selectionContains(s, pt(0.35, 0.35))).toBe(false);
    expect(selectionContains(s, pt(0.5, 0.5))).toBe(true);
  });
  it('nem fotóra és leírhatatlan esetben nem nyúl a dokumentumhoz', () => {
    expect(copySelectionToLayer(doc({ kind: 'text', id: 't' } as ImageLayer), 't', sel, 'c')).toBeNull();
    const m: ClipMask = { shape: 'polygon', x: 0, y: 0, w: 1, h: 1, points: rectRing(pt(0, 0), pt(1, 1)) };
    expect(copySelectionToLayer(doc(photo('a', { mask: m })), 'a', invertSelection(sel), 'c')).toBeNull();
  });
  it('a másolat nem örökli a festett jelzőt: nem az ecset rétege', () => {
    const d = copySelectionToLayer(doc(photo('a', { paint: true })), 'a', sel, 'c')!;
    expect((d.layers[1] as PhotoLayer).paint).toBeUndefined();
  });
});

describe('törlés, maszk, korrekció', () => {
  it('a törlés a területet tünteti el, a fájl marad', () => {
    const d = deleteSelection(doc(photo('a')), 'a', sel)!;
    const s = asSel(maskOf(d, 'a'));
    expect(selectionContains(s, pt(0.3, 0.3))).toBe(false);
    expect(selectionContains(s, pt(0.8, 0.8))).toBe(true);
    expect((d.layers[0] as PhotoLayer).uri).toBe('a.png');
  });
  it('a maszk a kijelölés lesz', () => {
    expect(selectionContains(asSel(maskOf(maskFromSelection(doc(photo('a')), 'a', sel)!, 'a')), pt(0.3, 0.3))).toBe(true);
  });
  it('a korrekció maszkolt réteg a tetején', () => {
    const d = adjustSelection(doc(photo('a')), sel, 'adj');
    expect(d.layers[1]).toMatchObject({ kind: 'adjust', id: 'adj' });
    expect((d.layers[1] as unknown as { mask: ClipMask }).mask.ops).toEqual(sel.ops);
  });
});

describe('cél', () => {
  it('a kijelölt fotó, különben a legfelső látható', () => {
    const d = doc(photo('a'), photo('b'), photo('c', { hidden: true }), { kind: 'text', id: 't' } as ImageLayer);
    expect(selectionTarget(d, 'a')).toBe('a');
    expect(selectionTarget(d, 't')).toBe('b');
    expect(selectionTarget(d, null)).toBe('b');
    expect(selectionTarget(doc(), null)).toBeNull();
  });
});

describe('a maszk követi a réteget', () => {
  const m: ClipMask = { shape: 'polygon', x: 0.4, y: 0.4, w: 0.4, h: 0.4, points: sel.ops[0].points, ops: sel.ops };
  it('eltolja a középpontot, a pontokat és a műveleteket', () => {
    const s = shiftMask(m, 0.1, -0.1);
    expect(s.x).toBeCloseTo(0.5);
    expect(s.points![0].y).toBeCloseTo(0.1);
    expect(s.ops![0].points[0].x).toBeCloseTo(0.3);
  });
  it('a réteg mozgatása elviszi a maszkot, a lokális korrekcióét is', () => {
    const local = { mask: m, adjust: {} } as unknown as PhotoLayer['localAdjust'];
    const d = updateLayer<PhotoLayer>(doc(photo('a', { mask: m, localAdjust: local })), 'a', { position: { x: 0.6, y: 0.5 } });
    const l = d.layers[0] as PhotoLayer;
    expect(l.mask!.x).toBeCloseTo(0.5);
    expect(l.localAdjust!.mask!.x).toBeCloseTo(0.5);
  });
  it('más módosítás nem mozdítja a maszkot', () => {
    const d = updateLayer<PhotoLayer>(doc(photo('a', { mask: m })), 'a', { opacity: 0.5 });
    expect((d.layers[0] as PhotoLayer).mask).toBe(m);
  });
});
