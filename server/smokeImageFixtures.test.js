const { buildSmokeDocs, mediaUrisOf, SMOKE_IMAGE_MEDIA, W, H } = require('./smokeImageFixtures');

describe('smokeImageFixtures', () => {
  const docs = buildSmokeDocs();

  test('egyedi nevek + van legalább egy réteg mindenhol', () => {
    const names = docs.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(docs.length).toBeGreaterThanOrEqual(13);
    for (const { doc } of docs) {
      expect(Array.isArray(doc.layers)).toBe(true);
      expect(doc.layers.length).toBeGreaterThan(0);
    }
  });

  test('determinisztikus (kétszeri build ugyanaz)', () => {
    expect(JSON.stringify(buildSmokeDocs())).toBe(JSON.stringify(buildSmokeDocs()));
  });

  test('minden réteg-id egyedi egy doc-on belül', () => {
    for (const { doc } of docs) {
      const ids = doc.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('a fotó-rétegek a szimbolikus PHOTO-ra hivatkoznak + mediaUrisOf kigyűjti', () => {
    const photoDoc = docs.find((d) => d.name === 'photo').doc;
    expect(mediaUrisOf(photoDoc)).toEqual([SMOKE_IMAGE_MEDIA.PHOTO]);
    expect(mediaUrisOf(docs.find((d) => d.name === 'baseline-fill').doc)).toEqual([]);
  });

  test('a méret a canvas-szal egyezik', () => {
    for (const { doc } of docs) {
      expect(doc.width).toBe(W);
      expect(doc.height).toBe(H);
    }
  });

  test('lefedi a kulcs-funkciókat (gradient/pattern/glow/stroke/path/boolean/text/alpha/blend)', () => {
    const flat = docs.flatMap((d) => d.doc.layers);
    expect(flat.some((l) => l.gradient)).toBe(true);
    expect(flat.some((l) => l.pattern)).toBe(true);
    expect(flat.some((l) => l.glow)).toBe(true);
    expect(flat.some((l) => l.borderWidth)).toBe(true);
    expect(flat.some((l) => l.shape === 'path' && l.points)).toBe(true);
    expect(flat.some((l) => l.subpaths && l.fillRule === 'evenodd')).toBe(true);
    expect(flat.some((l) => l.kind === 'text')).toBe(true);
    expect(flat.some((l) => l.blendMode)).toBe(true);
    // átlátszó-háttér fixture: nincs fill-réteg
    const alpha = docs.find((d) => d.name === 'transparent-bg').doc;
    expect(alpha.layers.some((l) => l.kind === 'fill')).toBe(false);
  });
});
