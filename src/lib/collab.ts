import { cloudBaseUrl, ensureCloud } from '@/lib/backend';
import { pushProject } from '@/lib/cloudSync';
import { migrateProject } from '@/lib/projectUtils';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import type { Project } from '@/types/project';

/**
 * 👥 Projekt-kollaboráció kliens-rétege — tagok + szerepkörök.
 *
 * A megosztott projektet a `cloud_projects` sor (a tulaj felhő-másolata) hordozza,
 * a tagságot/szerepet a `project_members` ACL-tábla. A szerep-alapú írást az RLS
 * kényszeríti ki (a néző nem tud a felhőbe írni). A meghívás (e-mail → user) a
 * worker `POST /invite`-ján megy, mert a névfeloldáshoz service_role kell.
 *
 * Pro-funkció a TULAJNAK (`ensureCloud('collab')`); a meghívott ingyen csatlakozik.
 */

export type CollabRole = 'owner' | 'editor' | 'viewer';

export interface ProjectMember {
  ownerId: string;
  projectId: string;
  memberId: string;
  role: CollabRole;
  displayName?: string;
  email?: string;
  projectName?: string;
  createdAt: string;
}

export interface SharedProject {
  ownerId: string;
  projectId: string;
  projectName?: string;
  role: CollabRole;
  createdAt: string;
}

interface MemberRow {
  owner_id: string;
  project_id: string;
  member_id: string;
  role: CollabRole;
  display_name: string | null;
  email: string | null;
  project_name: string | null;
  created_at: string;
}

const MEMBER_COLUMNS =
  'owner_id, project_id, member_id, role, display_name, email, project_name, created_at';

function toMember(r: MemberRow): ProjectMember {
  return {
    ownerId: r.owner_id,
    projectId: r.project_id,
    memberId: r.member_id,
    role: r.role,
    displayName: r.display_name ?? undefined,
    email: r.email ?? undefined,
    projectName: r.project_name ?? undefined,
    createdAt: r.created_at,
  };
}

function requireUserId(): string {
  const id = useAuth.getState().user?.id;
  if (!id) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  return id;
}

/** Az aktuális user id-ja, vagy null (nem dob). */
export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/**
 * A projekt MEGOSZTÁSA: felhő-mentés + a tulaj tag-sorának létrehozása. Ezután
 * lehet tagokat meghívni. Pro-kapu (`collab`). Idempotens (upsert).
 */
export async function ensureShared(project: Project): Promise<void> {
  ensureCloud('collab'); // Pro-kapu a tulajnak
  await pushProject(project); // cloud_projects upsert (a projekt-JSON a felhőbe)
  const sb = requireSupabase();
  const uid = requireUserId();
  const user = useAuth.getState().user;
  let displayName: string | null = null;
  try {
    const { data } = await sb.from('profiles').select('full_name').eq('id', uid).maybeSingle();
    displayName = (data?.full_name as string | undefined) ?? null;
  } catch {
    // a profil-név opcionális
  }
  const { error } = await sb.from('project_members').upsert(
    {
      owner_id: uid,
      project_id: project.id,
      member_id: uid,
      role: 'owner',
      project_name: project.name,
      email: user?.email ?? null,
      display_name: displayName,
    },
    { onConflict: 'owner_id,project_id,member_id' }
  );
  if (error) {
    throw new Error(error.message);
  }
}

/** A projekt tagjai (bármely tag lekérdezheti — RLS: projekt-tagság). */
export async function listMembers(ownerId: string, projectId: string): Promise<ProjectMember[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('project_members')
    .select(MEMBER_COLUMNS)
    .eq('owner_id', ownerId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data as MemberRow[]).map(toMember);
}

/**
 * Az aktuális user tagsága egy projektben CSAK a projectId alapján (a tulaj
 * ismerete nélkül) — a szerkesztő ezzel deríti ki, megosztott projekt-e és mi a
 * szerepem. `null`, ha nem vagyok tag. (A project_id gyakorlatilag egyedi.)
 */
export async function myMembership(
  projectId: string
): Promise<{ ownerId: string; role: CollabRole } | null> {
  const uid = currentUserId();
  if (!supabase || !uid) {
    return null;
  }
  const { data } = await supabase
    .from('project_members')
    .select('owner_id, role')
    .eq('project_id', projectId)
    .eq('member_id', uid)
    .maybeSingle();
  if (!data) {
    return null;
  }
  return { ownerId: data.owner_id as string, role: data.role as CollabRole };
}

/** Az aktuális user szerepe a projektben (vagy null, ha nem tag). */
export async function myRole(ownerId: string, projectId: string): Promise<CollabRole | null> {
  const uid = currentUserId();
  if (!supabase || !uid) {
    return null;
  }
  const { data } = await supabase
    .from('project_members')
    .select('role')
    .eq('owner_id', ownerId)
    .eq('project_id', projectId)
    .eq('member_id', uid)
    .maybeSingle();
  return (data?.role as CollabRole | undefined) ?? null;
}

export type InviteResult = { status: 'added' | 'pending' | 'self' } & Record<string, unknown>;

/**
 * Tag meghívása e-mail alapján (a worker /invite-ján át). A `role` csak
 * editor/viewer. Létező user → azonnal tag + értesítés; egyébként pending invite.
 */
export async function inviteMember(input: {
  ownerId: string;
  projectId: string;
  projectName?: string;
  email: string;
  role: Exclude<CollabRole, 'owner'>;
}): Promise<InviteResult> {
  ensureCloud('collab'); // Pro-kapu a tulajnak
  const res = await fetch(`${cloudBaseUrl()}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, invitedBy: currentUserId() }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Meghívás sikertelen (${res.status}).`);
  }
  return (await res.json()) as InviteResult;
}

/** Szerep-váltás (csak a tulaj — RLS). */
export async function changeRole(
  ownerId: string,
  projectId: string,
  memberId: string,
  role: CollabRole
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('project_members')
    .update({ role })
    .eq('owner_id', ownerId)
    .eq('project_id', projectId)
    .eq('member_id', memberId);
  if (error) {
    throw new Error(error.message);
  }
}

/** Tag eltávolítása (csak a tulaj — RLS). */
export async function removeMember(
  ownerId: string,
  projectId: string,
  memberId: string
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('project_members')
    .delete()
    .eq('owner_id', ownerId)
    .eq('project_id', projectId)
    .eq('member_id', memberId);
  if (error) {
    throw new Error(error.message);
  }
}

/** Kilépés a projektből (a saját tag-sor törlése — RLS engedi). */
export async function leaveProject(ownerId: string, projectId: string): Promise<void> {
  const uid = requireUserId();
  await removeMember(ownerId, projectId, uid);
}

/** A VELEM megosztott projektek (ahol tag vagyok, de nem tulaj). */
export async function listSharedWithMe(): Promise<SharedProject[]> {
  const uid = currentUserId();
  if (!supabase || !uid) {
    return [];
  }
  const { data, error } = await supabase
    .from('project_members')
    .select(MEMBER_COLUMNS)
    .eq('member_id', uid)
    .neq('role', 'owner')
    .order('created_at', { ascending: false });
  if (error) {
    return [];
  }
  return (data as MemberRow[]).map((r) => ({
    ownerId: r.owner_id,
    projectId: r.project_id,
    projectName: r.project_name ?? undefined,
    role: r.role,
    createdAt: r.created_at,
  }));
}

/** Egy megosztott projekt felhő-verziójának letöltése (tag olvashatja — RLS). */
export async function pullSharedProject(
  ownerId: string,
  projectId: string
): Promise<Project | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('cloud_projects')
    .select('data')
    .eq('user_id', ownerId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return migrateProject(data.data as Project);
}

/** Monoton számláló egyedi realtime-topic-hoz (lásd `subscribeMembers`). */
let channelSeq = 0;

/**
 * REALTIME feliratkozás a projekt tagságának változásaira (meghívás/szerep/
 * eltávolítás). Bármely változásnál meghívja a callbacket (a hívó újratölti a
 * listát). `() => void` leiratkozót ad.
 *
 * A topic KÖTELEZŐEN egyedi (`:${++channelSeq}` utótag): a `sb.channel(topic)` a
 * MÁR meglévő, azonos topic-ú csatornát adná vissza (a `removeChannel` aszinkron),
 * és a már `subscribe()`-olt csatornán a `.on('postgres_changes', …)` dobna
 * („cannot add … callbacks after `subscribe()`"). Egyedi topic-kal a gyors
 * projekt-újranyitás is mindig friss, `closed` állapotú csatornát kap.
 */
export function subscribeMembers(projectId: string, onChange: () => void): () => void {
  const sb = supabase;
  if (!sb) {
    return () => {};
  }
  const channel = sb
    .channel(`project_members:${projectId}:${++channelSeq}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${projectId}` },
      () => onChange()
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}
