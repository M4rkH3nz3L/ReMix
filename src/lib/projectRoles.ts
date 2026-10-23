/**
 * 👥 Projekt-szintű role-ok és jogosultságok — tiszta mag.
 *
 * Termék-szabály: a kollaboráció NEM kapcsolható ki — a projekt-szoba (chat +
 * tagság) mindig él; a „nincs kollaboráció" egyszerűen azt jelenti, hogy a tulaj
 * még nem hívott be senkit. A TULAJ definiálja a role-okat és a hozzájuk tartozó
 * projekt-jogokat a projekt-beállításokon; a tagok egy-egy role-t kapnak, és a
 * chat-szoba UGYANEZEKET a jogokat örökli (olvasás=view, írás=chat).
 *
 * A beépített role-ok (owner/editor/viewer) nem törölhetők — az owner nem is
 * módosítható (mindig minden jog) —, de a tulaj újakat hozhat létre és a nem-owner
 * beépítettek jogait is hangolhatja. Expo-mentes, determinista → önmagában tesztelt;
 * a tárolás/hálózat a kliens-rétegben (collab/projectChat).
 */

export type ProjectPermission =
  /** a projekt megnyitása/olvasása + a szoba olvasása */
  | 'view'
  /** üzenet írása a projekt-szobába */
  | 'chat'
  /** szerkesztés (command-bus műveletek, collab-session) */
  | 'edit'
  /** render/export/.rp csomag készítése */
  | 'export'
  /** tag meghívása/eltávolítása */
  | 'invite'
  /** projekt-meta + role-definíciók kezelése (tulaj-szint) */
  | 'manageProject';

export const PROJECT_PERMISSIONS: ProjectPermission[] = [
  'view',
  'chat',
  'edit',
  'export',
  'invite',
  'manageProject',
];

export interface ProjectRole {
  /** 'owner' | 'editor' | 'viewer' | egyéni ('role_…') */
  id: string;
  name: string;
  permissions: ProjectPermission[];
  /** beépített role — nem törölhető (az 'owner' nem is módosítható) */
  builtin?: boolean;
}

export const OWNER_ROLE_ID = 'owner';
export const DEFAULT_MEMBER_ROLE_ID = 'viewer';

/** az alap role-készlet — minden projekt ezzel indul, a tulaj innen hangolja */
export function defaultProjectRoles(): ProjectRole[] {
  return [
    { id: OWNER_ROLE_ID, name: 'Tulajdonos', permissions: [...PROJECT_PERMISSIONS], builtin: true },
    {
      id: 'editor',
      name: 'Szerkesztő',
      permissions: ['view', 'chat', 'edit', 'export'],
      builtin: true,
    },
    { id: 'viewer', name: 'Megtekintő', permissions: ['view', 'chat'], builtin: true },
  ];
}

/** DB-ből/hálózatról jött érték biztonságos normalizálása (ismeretlen → alapok). */
export function normalizeProjectRoles(raw: unknown): ProjectRole[] {
  if (!Array.isArray(raw)) {
    return defaultProjectRoles();
  }
  const valid = new Set<string>(PROJECT_PERMISSIONS);
  const roles: ProjectRole[] = [];
  for (const r of raw as Partial<ProjectRole>[]) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') {
      continue;
    }
    roles.push({
      id: r.id,
      name: r.name,
      permissions: Array.isArray(r.permissions)
        ? (r.permissions.filter((p) => valid.has(p as string)) as ProjectPermission[])
        : [],
      ...(r.builtin ? { builtin: true } : {}),
    });
  }
  // a beépítettek MINDIG jelen vannak (az owner mindig teljes joggal)
  for (const d of defaultProjectRoles()) {
    const existing = roles.find((x) => x.id === d.id);
    if (!existing) {
      roles.push(d);
    } else {
      existing.builtin = true;
      if (d.id === OWNER_ROLE_ID) {
        existing.permissions = [...PROJECT_PERMISSIONS];
      }
    }
  }
  return roles;
}

export function roleById(roles: readonly ProjectRole[], roleId: string): ProjectRole | undefined {
  return roles.find((r) => r.id === roleId);
}

/**
 * 🔒 A jogosultság-kapu: van-e a role-nak adott joga. Ismeretlen role →
 * a legszűkebb (viewer) jogai — sosem tágabb a bizonytalan.
 */
export function hasProjectPermission(
  roles: readonly ProjectRole[],
  roleId: string,
  permission: ProjectPermission,
): boolean {
  if (roleId === OWNER_ROLE_ID) {
    return true; // a tulaj sosem zárható ki a saját projektjéből
  }
  const role = roleById(roles, roleId) ?? roleById(roles, DEFAULT_MEMBER_ROLE_ID);
  return role?.permissions.includes(permission) ?? false;
}

export type RoleEditResult = { ok: true; roles: ProjectRole[] } | { ok: false; reason: string };

/** egyszerű egyedi role-id (determinista bemenetből a hívó adja a sorszámot) */
export function makeRoleId(seed: number): string {
  return `role_${seed.toString(36)}`;
}

/**
 * Role felvétele/módosítása. Szabályok: az 'owner' nem módosítható; a név nem
 * lehet üres; minden role megtartja a 'view'-t (nézet nélkül a tagságnak nincs
 * értelme — a szoba olvasása ehhez kötött).
 */
export function upsertProjectRole(
  roles: readonly ProjectRole[],
  role: ProjectRole,
): RoleEditResult {
  if (role.id === OWNER_ROLE_ID) {
    return { ok: false, reason: 'owner_immutable' };
  }
  if (role.name.trim().length === 0) {
    return { ok: false, reason: 'empty_name' };
  }
  const permissions = [...new Set<ProjectPermission>(['view', ...role.permissions])];
  const next = roles.some((r) => r.id === role.id)
    ? roles.map((r) => (r.id === role.id ? { ...r, name: role.name.trim(), permissions } : r))
    : [...roles, { id: role.id, name: role.name.trim(), permissions }];
  return { ok: true, roles: next };
}

/**
 * Role törlése. Beépített nem törölhető; használatban lévő (van ilyen role-ú tag)
 * nem törölhető — előbb a tagokat kell átsorolni (a UI ezt kínálja fel).
 */
export function removeProjectRole(
  roles: readonly ProjectRole[],
  roleId: string,
  memberRoleIds: readonly string[],
): RoleEditResult {
  const role = roleById(roles, roleId);
  if (!role) {
    return { ok: false, reason: 'not_found' };
  }
  if (role.builtin) {
    return { ok: false, reason: 'builtin' };
  }
  if (memberRoleIds.includes(roleId)) {
    return { ok: false, reason: 'in_use' };
  }
  return { ok: true, roles: roles.filter((r) => r.id !== roleId) };
}
