/**
 * 🛡️ Az admin-panel (src/app/admin.tsx) tiszta, expo-mentes magja: a szerep→jog mátrix
 * kulcsai és az optimista frissítések halmaz-/lista-lépései. A képernyőből kiemelve
 * (REFACTOR) — a viselkedés változatlan.
 */
import type { AppRole, UserWithRole } from '@/lib/roles';

/** a szerep→jog pár kulcsa a mátrix-halmazban: `${role}|${perm}` */
export function rolePermKey(role: string, perm: string): string {
  return `${role}|${perm}`;
}

/** a pár-halmaz új példánya, amelyben a kulcs `present` szerint benne van / nincs */
export function withPair(prev: Set<string>, k: string, present: boolean): Set<string> {
  const next = new Set(prev);
  if (present) next.add(k);
  else next.delete(k);
  return next;
}

/** a felhasználó-lista, amelyben az adott user szerepe kicserélve (a többi elem változatlan) */
export function withUserRole(prev: UserWithRole[], userId: string, slug: string): UserWithRole[] {
  return prev.map((x) => (x.id === userId ? { ...x, role: slug } : x));
}

/** a szerep megjelenített neve: ismert slugnál a címke, különben maga a slug */
export function roleLabelOf(roles: AppRole[], slug: string): string {
  return roles.find((r) => r.slug === slug)?.label ?? slug;
}
