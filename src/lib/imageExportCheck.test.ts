import { expectsAlpha, type ExportFacts, exportProblems, layerOnlyDoc, selectionOnlyDoc } from '@/lib/imageExportCheck';
import { applyRing, rectRing } from '@/lib/selection';
import type { ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

const expect1 = { width: 100, height: 100, format: 'png' as const, wantsAlpha: true };
const good: ExportFacts = { opened: true, width: 100, height: 100, bytes: 500, hasAlpha: true };

describe('minőségkapu', () => {
  it('a jó fájl átmegy', () => {
    expect(exportProblems(good, expect1)).toEqual([]);
  });
  it('a nem nyitható fájl csak ezt jelzi', () => {
    expect(exportProblems({ ...good, opened: false }, expect1)).toEqual(['unreadable']);
  });
  it('rossz méret, üres fájl, elveszett alfa külön hiba', () => {
    expect(exportProblems({ ...good, width: 90 }, expect1)).toEqual(['size']);
    expect(exportProblems({ ...good, bytes: 0 }, expect1)).toEqual(['empty']);
    expect(exportProblems({ ...good, hasAlpha: false }, expect1)).toEqual(['alpha']);
  });
  it('a páros kerekítés nem hiba', () => {
    expect(exportProblems({ ...good, width: 102 }, expect1)).toEqual([]);
  });
  it('alfa csak fedő háttér nélkül és alfát tudó formátumban kell', () => {
    const fill = { kind: 'fill', id: 'f', fill: '#fff' } as ImageLayer;
    const photo = { kind: 'photo', id: 'p' } as ImageLayer;
    expect(expectsAlpha({ layers: [photo] }, 'png')).toBe(true);
    expect(expectsAlpha({ layers: [photo] }, 'jpg')).toBe(false);
    expect(expectsAlpha({ layers: [fill, photo] }, 'png')).toBe(false);
  });
});

describe('rész-export', () => {
  const photo = { kind: 'photo', id: 'p', uri: 'a', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, hidden: true } as PhotoLayer;
  const doc = { id: 'd', name: 'n', layers: [{ kind: 'fill', id: 'f', fill: '#fff' } as ImageLayer, photo], grain: 0.5 } as unknown as ImageDoc;
  const sel = applyRing(null, rectRing({ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }), 'new')!;
  it('a réteg önmagában, a háttér és a dokumentum-effektek nélkül, rejtett réteg is', () => {
    const out = layerOnlyDoc(doc, 'p')!;
    expect(out.layers.map((l) => l.id)).toEqual(['p']);
    expect((out.layers[0] as PhotoLayer).hidden).toBe(false);
    expect(out.grain).toBeUndefined();
  });
  it('ismeretlen rétegre nincs export', () => {
    expect(layerOnlyDoc(doc, 'x')).toBeNull();
  });
  it('a kijelölés a réteg maszkja lesz', () => {
    expect((selectionOnlyDoc(doc, sel, 'p')!.layers[0] as PhotoLayer).mask?.ops).toEqual(sel.ops);
  });
});
