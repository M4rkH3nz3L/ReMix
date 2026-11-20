import { captureViewSize, isEmbeddablePhoto, linkableVideoProjects, pdfRasterHeight, rasterHeightOf } from '@/lib/imageExportPlan';

/**
 * 🖨️ A Kép Stúdió export-rétegének tiszta magja (REFACTOR: a `useImageExport`-ból kiemelve) — a
 * jelenlegi viselkedés rögzítve, a szélekkel együtt.
 */

describe('rasterHeightOf', () => {
  it('a kért magasság nyer (a 0 is — `??`, nem `||`)', () => {
    expect(rasterHeightOf({ height: 900 }, 777)).toBe(777);
    expect(rasterHeightOf({ height: 900 }, 0)).toBe(0);
  });
  it('kérés nélkül a lap magassága, ha az sincs: 1280', () => {
    expect(rasterHeightOf({ height: 900 }, undefined)).toBe(900);
    expect(rasterHeightOf({}, undefined)).toBe(1280);
  });
});

describe('captureViewSize', () => {
  it('képpontban: a magasság / pixelarány, a szélesség a vászon arányával, kerekítve', () => {
    expect(captureViewSize(1350, { width: 1080, height: 1350 }, 3)).toEqual({ width: 360, height: 450 });
    expect(captureViewSize(1000, { width: 1920, height: 1080 }, 2)).toEqual({ width: 889, height: 500 });
  });
  it('a kulcsok sorrendje width, height (a view-shot opciói így mennek tovább)', () => {
    expect(Object.keys(captureViewSize(10, { width: 1, height: 1 }, 1))).toEqual(['width', 'height']);
  });
  it('a félértékek Math.round szerint kerekednek', () => {
    expect(captureViewSize(5, { width: 1, height: 1 }, 2)).toEqual({ width: 3, height: 3 });
  });
});

describe('pdfRasterHeight', () => {
  it('legfeljebb 4096 px', () => {
    expect(pdfRasterHeight(1350)).toBe(1350);
    expect(pdfRasterHeight(4096)).toBe(4096);
    expect(pdfRasterHeight(5000)).toBe(4096);
  });
});

describe('isEmbeddablePhoto', () => {
  it('csak a helyi (file://) fotó-réteg ágyazható be', () => {
    expect(isEmbeddablePhoto({ kind: 'photo', uri: 'file:///a.png' })).toBe(true);
    expect(isEmbeddablePhoto({ kind: 'photo', uri: 'https://x/a.png' })).toBe(false);
    expect(isEmbeddablePhoto({ kind: 'photo', uri: 'data:image/png;base64,AA' })).toBe(false);
    expect(isEmbeddablePhoto({ kind: 'photo', uri: undefined })).toBe(false);
    expect(isEmbeddablePhoto({ kind: 'photo', uri: 42 })).toBe(false);
    expect(isEmbeddablePhoto({ kind: 'shape', uri: 'file:///a.png' })).toBe(false);
  });
  it('kis-nagybetű érzékeny (a FILE:// nem számít helyinek)', () => {
    expect(isEmbeddablePhoto({ kind: 'photo', uri: 'FILE:///a.png' })).toBe(false);
  });
});

describe('linkableVideoProjects', () => {
  const metas = [
    { id: 'self', kind: 'video' },
    { id: 'v1', kind: 'video' },
    { id: 'old' },
    { id: 'img', kind: 'image' },
    { id: 'aud', kind: 'audio' },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, kind: 'video' })),
  ];
  it('videó (a fajta nélküli régi is), önmaga nélkül, sorrendtartóan, legfeljebb 8', () => {
    expect(linkableVideoProjects(metas, 'self').map((m) => m.id)).toEqual(['v1', 'old', 'm0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  });
  it('ismeretlen saját azonosító: semmit nem zár ki magáért', () => {
    expect(linkableVideoProjects(metas.slice(0, 3), undefined).map((m) => m.id)).toEqual(['self', 'v1', 'old']);
  });
  it('üres lista → üres', () => {
    expect(linkableVideoProjects([], 'x')).toEqual([]);
  });
  it('az elemeket változatlanul adja vissza (ugyanaz az objektum)', () => {
    const m = { id: 'v', kind: 'video', name: 'V' };
    expect(linkableVideoProjects([m], 'x')[0]).toBe(m);
  });
});
