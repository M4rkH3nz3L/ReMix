import {
  defaultProjectRoles,
  hasProjectPermission,
  makeRoleId,
  normalizeProjectRoles,
  removeProjectRole,
  upsertProjectRole,
} from '@/lib/projectRoles';

/**
 * 👥 Projekt-role mag: a tulaj mindig mindent; ismeretlen role a legszűkebb;
 * owner nem módosítható; használatban lévő role nem törölhető.
 */

describe('defaultProjectRoles + hasProjectPermission', () => {
  it('a tulaj mindig minden jogot megkap (role-lista állapotától függetlenül)', () => {
    expect(hasProjectPermission([], 'owner', 'manageProject')).toBe(true);
    expect(hasProjectPermission(defaultProjectRoles(), 'owner', 'edit')).toBe(true);
  });

  it('editor: szerkeszt+exportál+chatel, de nem hív meg és nem kezel projektet', () => {
    const roles = defaultProjectRoles();
    expect(hasProjectPermission(roles, 'editor', 'edit')).toBe(true);
    expect(hasProjectPermission(roles, 'editor', 'chat')).toBe(true);
    expect(hasProjectPermission(roles, 'editor', 'invite')).toBe(false);
    expect(hasProjectPermission(roles, 'editor', 'manageProject')).toBe(false);
  });

  it('a szoba mindenkinek él: a viewer is olvas (view) és ír (chat)', () => {
    const roles = defaultProjectRoles();
    expect(hasProjectPermission(roles, 'viewer', 'view')).toBe(true);
    expect(hasProjectPermission(roles, 'viewer', 'chat')).toBe(true);
    expect(hasProjectPermission(roles, 'viewer', 'edit')).toBe(false);
  });

  it('ismeretlen role → a viewer (legszűkebb) jogai', () => {
    expect(hasProjectPermission(defaultProjectRoles(), 'nincs_ilyen', 'edit')).toBe(false);
    expect(hasProjectPermission(defaultProjectRoles(), 'nincs_ilyen', 'view')).toBe(true);
  });
});

describe('normalizeProjectRoles', () => {
  it('szemét bemenet → alap role-ok', () => {
    expect(normalizeProjectRoles(null)).toEqual(defaultProjectRoles());
    expect(normalizeProjectRoles('x')).toEqual(defaultProjectRoles());
  });

  it('a beépítettek mindig visszakerülnek, az owner joga nem szűkíthető a tárolt adattal', () => {
    const roles = normalizeProjectRoles([
      { id: 'owner', name: 'Tulaj', permissions: ['view'] }, // szűkítési kísérlet
      { id: 'cutter', name: 'Vágó', permissions: ['view', 'edit', 'rossz_jog'] },
    ]);
    expect(roleIds(roles)).toEqual(expect.arrayContaining(['owner', 'editor', 'viewer', 'cutter']));
    expect(hasProjectPermission(roles, 'owner', 'manageProject')).toBe(true);
    const cutter = roles.find((r) => r.id === 'cutter')!;
    expect(cutter.permissions).toEqual(['view', 'edit']); // az ismeretlen jog kiszűrve
  });
});

function roleIds(roles: { id: string }[]): string[] {
  return roles.map((r) => r.id);
}

describe('upsertProjectRole / removeProjectRole', () => {
  it('egyéni role felvehető, a view jog mindig bekerül', () => {
    const res = upsertProjectRole(defaultProjectRoles(), {
      id: makeRoleId(1),
      name: 'Vágó',
      permissions: ['edit'],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const cutter = res.roles.find((r) => r.name === 'Vágó')!;
      expect(cutter.permissions).toEqual(expect.arrayContaining(['view', 'edit']));
    }
  });

  it('az owner nem módosítható, üres név nem megy', () => {
    expect(
      upsertProjectRole(defaultProjectRoles(), { id: 'owner', name: 'X', permissions: [] }).ok,
    ).toBe(false);
    expect(
      upsertProjectRole(defaultProjectRoles(), { id: 'x', name: '  ', permissions: [] }).ok,
    ).toBe(false);
  });

  it('beépített nem törölhető; használatban lévő nem törölhető; szabad igen', () => {
    const base = upsertProjectRole(defaultProjectRoles(), {
      id: 'cutter',
      name: 'Vágó',
      permissions: ['edit'],
    });
    if (!base.ok) {
      throw new Error('setup');
    }
    expect(removeProjectRole(base.roles, 'viewer', []).ok).toBe(false);
    expect(removeProjectRole(base.roles, 'cutter', ['cutter']).ok).toBe(false);
    const removed = removeProjectRole(base.roles, 'cutter', ['viewer']);
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.roles.find((r) => r.id === 'cutter')).toBeUndefined();
    }
  });
});
