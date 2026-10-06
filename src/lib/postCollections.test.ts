import { normalizeCollectionName, parseCollections } from '@/lib/postCollections';

describe('normalizeCollectionName', () => {
  it('trim + egyszeres szóköz + max hossz', () => {
    expect(normalizeCollectionName('  Nyári   vlogok  ')).toBe('Nyári vlogok');
    expect(normalizeCollectionName('x'.repeat(100))).toHaveLength(80);
  });
  it('üres / csak-szóköz → alapnév', () => {
    expect(normalizeCollectionName('')).toBe('Gyűjtemény');
    expect(normalizeCollectionName('   ')).toBe('Gyűjtemény');
  });
});

describe('parseCollections (§12.1 guard)', () => {
  it('a jó sorokat adja, a hibásat (nincs id/name) kiejti', () => {
    const out = parseCollections([
      { id: 'c1', name: 'Kedvencek', created_at: '2026-10-01T00:00:00Z' },
      { id: 'c2' }, // nincs name → kiesik
      { name: 'névtelen' }, // nincs id → kiesik
      'nem objektum',
    ]);
    expect(out).toEqual([{ id: 'c1', name: 'Kedvencek', createdAt: '2026-10-01T00:00:00Z' }]);
  });

  it('beágyazott count (post_collection_items:[{count}]) → itemCount', () => {
    const out = parseCollections([
      { id: 'c1', name: 'A', created_at: '', post_collection_items: [{ count: 7 }] },
    ]);
    expect(out[0].itemCount).toBe(7);
  });

  it('lapos item_count is támogatott', () => {
    expect(parseCollections([{ id: 'c1', name: 'A', item_count: 3 }])[0].itemCount).toBe(3);
  });

  it('null / nem-tömb → []', () => {
    expect(parseCollections(null)).toEqual([]);
    expect(parseCollections({})).toEqual([]);
  });
});
