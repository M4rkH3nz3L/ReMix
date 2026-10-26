import {
  addTombstones,
  MAX_TOMBSTONES,
  pendingCloudDeletes,
  removeTombstones,
  restorableIds,
} from '@/lib/projectTombstones';

describe('projectTombstones — a törölt projekt nem jön vissza a felhőből', () => {
  it('a törölt (sírköves) projekt NEM töltődik vissza, a valóban hiányzó igen', () => {
    const cloud = ['a', 'b', 'c'];
    const local = new Set(['a']);
    const tomb = new Set(['b']);
    expect(restorableIds(cloud, local, tomb)).toEqual(['c']);
  });

  it('a felhőben maradt törölt projektek újratörlésre kerülnek (öngyógyulás)', () => {
    expect(pendingCloudDeletes(['a', 'b', 'c'], new Set(['b', 'x']))).toEqual(['b']);
  });

  it('hozzáadás: duplikáció nélkül, a legújabb a végén', () => {
    expect(addTombstones(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('korlátos: a legrégebbiek esnek ki', () => {
    const many = Array.from({ length: MAX_TOMBSTONES }, (_, i) => `p${i}`);
    const next = addTombstones(many, ['új']);
    expect(next).toHaveLength(MAX_TOMBSTONES);
    expect(next[next.length - 1]).toBe('új');
    expect(next).not.toContain('p0');
  });

  it('eltávolítás: csak a megadottak', () => {
    expect(removeTombstones(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
});
