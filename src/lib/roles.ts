import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🛡️ Globális szerep/jogosultság (RBAC) kliens-réteg. A GLOBÁLIS governance-jogok
 * a DB-ből jönnek (app_permissions/app_roles/role_permissions/user_roles); a
 * TARTALOM-KÖTÖTT jogok (saját projekt/poszt) a meglévő ownership/membership-ből
 * — a kettőt a hívó helyek VAGY-ozzák (lásd `can*` segédek lentebb).
 */

/** A globális governance-jogok kulcsai (a DB app_permissions tükre). */
export type PermissionKey =
  | 'post.moderate'
  | 'comment.moderate'
  | 'report.review'
  | 'post.feature'
  | 'project.moderate'
  | 'user.manage'
  | 'role.manage';

export interface AppPermission {
  key: string;
  label: string;
  description: string | null;
  sort: number;
}
export interface AppRole {
  slug: string;
  label: string;
  isSystem: boolean;
  sort: number;
}
export interface UserWithRole {
  id: string;
  name: string;
  role: string;
}

/** A bejelentkezett user GLOBÁLIS jogai (a `current_user_permissions` RPC). */
export async function fetchMyPermissions(): Promise<string[]> {
  if (!supabase || !useAuth.getState().user?.id) {
    return [];
  }
  const { data, error } = await supabase.rpc('current_user_permissions');
  if (error || !data) {
    return [];
  }
  return (data as { permission_key: string }[]).map((r) => r.permission_key);
}

export async function listPermissions(): Promise<AppPermission[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('app_permissions')
    .select('key, label, description, sort')
    .order('sort');
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as AppPermission[];
}

export async function listRoles(): Promise<AppRole[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('app_roles').select('slug, label, is_system, sort').order('sort');
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r: { slug: string; label: string; is_system: boolean; sort: number }) => ({
    slug: r.slug,
    label: r.label,
    isSystem: r.is_system,
    sort: r.sort,
  }));
}

/** Az összes szerep→jog pár (a mátrixhoz). */
export async function listRolePermissions(): Promise<{ role: string; permission: string }[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('role_permissions').select('role_slug, permission_key');
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r: { role_slug: string; permission_key: string }) => ({
    role: r.role_slug,
    permission: r.permission_key,
  }));
}

/** Egy szerep→jog pár be/ki (RLS: csak `role.manage` birtokosa). */
export async function setRolePermission(role: string, permission: string, on: boolean): Promise<void> {
  const sb = requireSupabase();
  if (on) {
    const { error } = await sb.from('role_permissions').upsert({ role_slug: role, permission_key: permission });
    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await sb
      .from('role_permissions')
      .delete()
      .eq('role_slug', role)
      .eq('permission_key', permission);
    if (error) {
      throw new Error(error.message);
    }
  }
}

/** Egyedi szerep létrehozása. */
export async function createRole(slug: string, label: string): Promise<void> {
  const sb = requireSupabase();
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (!clean) {
    throw new Error('Érvénytelen szerep-azonosító.');
  }
  const { error } = await sb
    .from('app_roles')
    .insert({ slug: clean, label: label.trim() || clean, is_system: false });
  if (error) {
    throw new Error(error.message);
  }
}

/** Egyedi (nem beépített) szerep törlése. */
export async function deleteRole(slug: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('app_roles').delete().eq('slug', slug).eq('is_system', false);
  if (error) {
    throw new Error(error.message);
  }
}

/** Felhasználók + szerepük (a `user.manage` birtokosa látja — profiles RLS bővítve). */
export async function listUsersWithRoles(): Promise<UserWithRole[]> {
  const sb = requireSupabase();
  const [{ data: profs }, { data: roles }] = await Promise.all([
    sb.from('profiles').select('id, full_name'),
    sb.from('user_roles').select('user_id, role'),
  ]);
  const roleById = new Map(
    ((roles ?? []) as { user_id: string; role: string }[]).map((r) => [r.user_id, r.role])
  );
  return ((profs ?? []) as { id: string; full_name: string | null }[]).map((p) => ({
    id: p.id,
    name: p.full_name ?? p.id.slice(0, 8),
    role: roleById.get(p.id) ?? 'user',
  }));
}

/** Szerep kiosztása egy usernek (RLS: csak `user.manage` birtokosa). */
export async function assignRole(userId: string, role: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('user_roles')
    .upsert({ user_id: userId, role, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    throw new Error(error.message);
  }
}

/** Globális poszt-moderáció (RPC): a `post.moderate` birtokosa BÁRMELY posztot removed/ok-ra állít. */
export async function moderatePostGlobal(postId: string, status: 'ok' | 'removed'): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('moderate_post', { p_post: postId, p_status: status });
  if (error) {
    throw new Error(error.message);
  }
}
