import { createGroup, effectiveLayerOpacity, groupChain, nestGroup, ungroup, visibleLayers } from '@/lib/imageDoc';
import type { ImageDoc, ImageLayer } from '@/types/project';

const l = (id: string, groupId?: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'shape', id, shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.1, h: 0.1, fill: '#000', groupId, ...extra }) as unknown as ImageLayer;
const doc = (layers: ImageLayer[], groups: ImageDoc['groups'] = []) => ({ id: 'd', name: 'D', aspectRatio: '1:1', layers, groups }) as unknown as ImageDoc;

describe('🗂️ S18: beágyazott csoportok', () => {
  it('a csoporton belül csoportosítva az új csoport abba ágyazódik', () => {
    const d = createGroup(doc([l('a', 'G'), l('b', 'G'), l('c', 'G')], [{ id: 'G', name: 'G' }]), ['a', 'b'], 'H', 'H');
    expect(d.groups!.find((g) => g.id === 'H')!.parentId).toBe('G');
    expect(groupChain(d, 'H').map((g) => g.id)).toEqual(['H', 'G']);
    // vegyes eredetű rétegekből gyökér-csoport lesz
    const mixed = createGroup(doc([l('a', 'G'), l('b')], [{ id: 'G', name: 'G' }]), ['a', 'b'], 'H', 'H');
    expect(mixed.groups!.find((g) => g.id === 'H')!.parentId).toBeUndefined();
  });

  it('az ős rejtettsége és áttetszősége öröklődik', () => {
    const groups = [{ id: 'G', name: 'G', opacity: 0.5 }, { id: 'H', name: 'H', parentId: 'G', opacity: 0.4 }];
    const d = doc([l('a', 'H', { opacity: 0.5 }), l('b')], groups);
    expect(effectiveLayerOpacity(d, d.layers[0])).toBeCloseTo(0.1);
    const hidden = doc(d.layers, [{ ...groups[0], hidden: true }, groups[1]]);
    expect(visibleLayers(hidden).map((x) => x.id)).toEqual(['b']);
  });

  it('a felbontás egy szinttel feljebb viszi a tagokat és az al-csoportokat', () => {
    const d = doc([l('a', 'H'), l('b', 'G')], [{ id: 'R', name: 'R' }, { id: 'G', name: 'G', parentId: 'R' }, { id: 'H', name: 'H', parentId: 'G' }]);
    const u = ungroup(d, 'G');
    expect(u.layers.find((x) => x.id === 'b')!.groupId).toBe('R');
    expect(u.groups!.find((g) => g.id === 'H')!.parentId).toBe('R');
    expect(u.groups!.some((g) => g.id === 'G')).toBe(false);
  });

  it('körkörös beágyazás nem lehetséges; kiemelés a gyökérbe', () => {
    const d = doc([l('a', 'H')], [{ id: 'G', name: 'G' }, { id: 'H', name: 'H', parentId: 'G' }]);
    expect(nestGroup(d, 'G', 'H')).toBe(d); // a szülő a saját leszármazottjába nem kerülhet
    expect(nestGroup(d, 'G', 'G')).toBe(d);
    expect(nestGroup(d, 'H', undefined).groups!.find((g) => g.id === 'H')!.parentId).toBeUndefined();
    // a hibás (körkörös) adat sem akasztja meg a láncot
    const loop = doc([l('a', 'X')], [{ id: 'X', name: 'X', parentId: 'Y' }, { id: 'Y', name: 'Y', parentId: 'X' }]);
    expect(groupChain(loop, 'X').map((g) => g.id)).toEqual(['X', 'Y']);
  });

  it('beágyazáskor a szülő blokkja összefüggő lesz (a z-rend értelmes marad)', () => {
    const d = doc([l('a', 'G'), l('x'), l('b', 'H')], [{ id: 'G', name: 'G' }, { id: 'H', name: 'H' }]);
    const n = nestGroup(d, 'H', 'G');
    const ids = n.layers.map((x) => x.id).join('');
    expect(ids).not.toMatch(/ax b|axb/);
    expect(Math.abs(ids.indexOf('a') - ids.indexOf('b'))).toBe(1);
  });

});
