import { roleLabelOf, rolePermKey, withPair, withUserRole } from '@/lib/adminScreenOps';

describe('adminScreenOps — az admin-panel tiszta magja', () => {
  it('a szerep→jog kulcs: `${role}|${perm}` (a pont és az üres rész is változatlan)', () => {
    expect(rolePermKey('admin', 'role.manage')).toBe('admin|role.manage');
    expect(rolePermKey('', '')).toBe('|');
  });

  it('withPair: új halmaz, a kulcs be- vagy kikerül; az eredeti érintetlen', () => {
    const prev = new Set(['a|x']);
    const added = withPair(prev, 'b|y', true);
    expect([...added]).toEqual(['a|x', 'b|y']);
    expect(added).not.toBe(prev);
    expect([...prev]).toEqual(['a|x']);
    expect([...withPair(prev, 'a|x', false)]).toEqual([]);
    expect([...withPair(prev, 'a|x', true)]).toEqual(['a|x']); // már benne → marad
    expect([...withPair(prev, 'nincs', false)]).toEqual(['a|x']); // nincs benne → marad
  });

  it('withPair: az optimista kapcsolás és a visszagörgetés az eredeti állapotot adja vissza', () => {
    const prev = new Set(['admin|role.manage']);
    const k = 'mod|role.manage';
    const on = !prev.has(k);
    expect([...withPair(withPair(prev, k, on), k, !on)]).toEqual([...prev]);
  });

  it('withUserRole: csak az adott user szerepe cserélődik, a többi elem ugyanaz a példány', () => {
    const u1 = { id: 'u1', name: 'Anna', role: 'admin' };
    const u2 = { id: 'u2', name: 'Béla', role: 'mod' };
    const next = withUserRole([u1, u2], 'u2', 'custom');
    expect(next).toEqual([u1, { id: 'u2', name: 'Béla', role: 'custom' }]);
    expect(next[0]).toBe(u1);
    expect(u2.role).toBe('mod');
    expect(withUserRole([u1], 'nincs', 'x')).toEqual([u1]);
  });

  it('roleLabelOf: ismert slugra a címke, ismeretlenre maga a slug', () => {
    const roles = [{ slug: 'admin', label: 'Admin', isSystem: true, sort: 0 }];
    expect(roleLabelOf(roles, 'admin')).toBe('Admin');
    expect(roleLabelOf(roles, 'ghost')).toBe('ghost');
    expect(roleLabelOf([], '')).toBe('');
  });
});
