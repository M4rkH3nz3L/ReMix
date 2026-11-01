import { applyRing, ellipseRing, invertSelection, maskWithout, rectRing, type Selection, selectionBounds, selectionContains, selectionToMask } from '@/lib/selection';
import type { ClipMask } from '@/types/project';

const pt = (x: number, y: number) => ({ x, y });
const box = rectRing(pt(0.2, 0.2), pt(0.8, 0.8));
const inner = rectRing(pt(0.4, 0.4), pt(0.6, 0.6));
const base = applyRing(null, box, 'new')!;

describe('gyűrűk', () => {
  it('a húzás iránya nem számít', () => {
    expect(rectRing(pt(0.8, 0.8), pt(0.2, 0.2))).toEqual(box);
  });
  it('az ellipszis a befoglaló téglalapba ír, a sarka kívül marad', () => {
    const sel = applyRing(null, ellipseRing(pt(0.2, 0.2), pt(0.8, 0.8)), 'new')!;
    expect(selectionContains(sel, pt(0.5, 0.5))).toBe(true);
    expect(selectionContains(sel, pt(0.22, 0.22))).toBe(false);
  });
});

describe('módok', () => {
  it('a kivonás lyukat hagy', () => {
    const s = applyRing(base, inner, 'subtract')!;
    expect(selectionContains(s, pt(0.5, 0.5))).toBe(false);
    expect(selectionContains(s, pt(0.3, 0.3))).toBe(true);
  });
  it('a hozzáadás bővít, a metszet szűkít', () => {
    const far = rectRing(pt(0.85, 0.85), pt(0.95, 0.95));
    expect(selectionContains(applyRing(base, far, 'add')!, pt(0.9, 0.9))).toBe(true);
    const s = applyRing(base, rectRing(pt(0, 0), pt(0.5, 0.5)), 'intersect')!;
    expect(selectionContains(s, pt(0.3, 0.3))).toBe(true);
    expect(selectionContains(s, pt(0.7, 0.7))).toBe(false);
  });
  it('az új mód cserél, és a lágy szél megmarad', () => {
    const s = applyRing({ ...base, feather: 0.04 }, inner, 'new')!;
    expect(s.ops).toHaveLength(1);
    expect(s.feather).toBe(0.04);
  });
  it('a sorrend számít: kivonás után a hozzáadás visszatölti a lyukat', () => {
    const s = applyRing(applyRing(base, inner, 'subtract'), inner, 'add')!;
    expect(selectionContains(s, pt(0.5, 0.5))).toBe(true);
  });
  it('kijelölés nélkül a kivonásnak nincs mit tennie, a véletlen érintés nem töröl', () => {
    expect(applyRing(null, box, 'subtract')).toBeNull();
    expect(applyRing(base, rectRing(pt(0.5, 0.5), pt(0.501, 0.501)), 'new')).toBe(base);
    expect(applyRing(base, [pt(0, 0), pt(1, 1)], 'new')).toBe(base);
  });
  it('homorú lasszó: a bemélyedés nincs benne', () => {
    const u = [pt(0.1, 0.1), pt(0.9, 0.1), pt(0.9, 0.9), pt(0.6, 0.9), pt(0.6, 0.3), pt(0.4, 0.3), pt(0.4, 0.9), pt(0.1, 0.9)];
    const s = applyRing(null, u, 'new')!;
    expect(selectionContains(s, pt(0.5, 0.6))).toBe(false);
    expect(selectionContains(s, pt(0.2, 0.6))).toBe(true);
  });
});

describe('invertálás és befoglaló', () => {
  it('az invertálás megfordít, kétszer alkalmazva az eredeti', () => {
    const s = invertSelection(base);
    expect(selectionContains(s, pt(0.5, 0.5))).toBe(false);
    expect(selectionContains(s, pt(0.05, 0.05))).toBe(true);
    expect(invertSelection(s)).toEqual(base);
  });
  it('a befoglaló a hozzáadott részt követi, invertáltan a teljes vászon', () => {
    expect(selectionBounds(base).w).toBeCloseTo(0.6);
    expect(selectionBounds(invertSelection(base))).toEqual({ x: 0.5, y: 0.5, w: 1, h: 1 });
  });
});

describe('maszk', () => {
  it('a maszk a műveleteket és a lágy szelet is viszi', () => {
    const m = selectionToMask({ ...applyRing(base, inner, 'subtract')!, feather: 0.02 });
    expect(m.shape).toBe('polygon');
    expect(m.ops).toHaveLength(2);
    expect(m.feather).toBe(0.02);
  });
  it('törlés maszk nélküli rétegből: a területen kívül marad látható', () => {
    const m = maskWithout(undefined, base)!;
    expect(m.invert).toBe(true);
    expect(m.ops).toEqual(base.ops);
  });
  it('második törlés: a két lyuk összeadódik', () => {
    const second = applyRing(null, rectRing(pt(0.85, 0.85), pt(0.95, 0.95)), 'new')!;
    const m = maskWithout(maskWithout(undefined, base)!, second)!;
    const s: Selection = { ops: m.ops!, feather: 0, invert: !!m.invert };
    expect(selectionContains(s, pt(0.5, 0.5))).toBe(false);
    expect(selectionContains(s, pt(0.9, 0.9))).toBe(false);
    expect(selectionContains(s, pt(0.05, 0.05))).toBe(true);
  });
  it('törlés meglévő maszkból: a látható rész szűkül', () => {
    const existing: ClipMask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.6, h: 0.6, feather: 0.01 };
    const m = maskWithout(existing, applyRing(null, inner, 'new')!)!;
    const s: Selection = { ops: m.ops!, feather: 0, invert: false };
    expect(selectionContains(s, pt(0.5, 0.5))).toBe(false);
    expect(selectionContains(s, pt(0.3, 0.3))).toBe(true);
    expect(m.feather).toBe(0.01);
  });
  it('invertált vagy összetett kijelölés meglévő maszkból nem írható le: jelzi, nem ront el', () => {
    const existing: ClipMask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.6, h: 0.6 };
    expect(maskWithout(existing, invertSelection(base))).toBeNull();
    expect(maskWithout(existing, applyRing(base, inner, 'subtract')!)).toBeNull();
  });
});
