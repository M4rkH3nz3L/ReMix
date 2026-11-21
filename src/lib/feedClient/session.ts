import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** A néző like/save halmazai a megadott poszt-id-kre (egy körben). */
export async function viewerEngagement(postIds: string[]): Promise<{ liked: Set<string>; saved: Set<string> }> {
  const uid = currentUserId();
  const liked = new Set<string>();
  const saved = new Set<string>();
  if (!supabase || !uid || postIds.length === 0) {
    return { liked, saved };
  }
  const [{ data: l }, { data: s }] = await Promise.all([
    supabase.from('post_likes').select('post_id').eq('user_id', uid).in('post_id', postIds),
    supabase.from('post_saves').select('post_id').eq('user_id', uid).in('post_id', postIds),
  ]);
  (l ?? []).forEach((row: { post_id: string }) => liked.add(row.post_id));
  (s ?? []).forEach((row: { post_id: string }) => saved.add(row.post_id));
  return { liked, saved };
}

export async function creatorFields(): Promise<{
  username: string | null;
  name: string | null;
  avatar: string | null;
}> {
  const user = useAuth.getState().user;
  const email = user?.email ?? null;
  const emailHandle = email ? email.split('@')[0] : null;
  // a poszt „username"-je az EGYEDI login-handle (profiles.username), NEM az
  // email-előtag; a display name a full_name (a kettő szándékosan külön mező)
  let username: string | null = emailHandle;
  let name: string | null = null;
  let avatar: string | null = null;
  if (supabase && user?.id) {
    const { data } = await supabase
      .from('profiles')
      .select('username, full_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    username = (data?.username as string | undefined) || emailHandle;
    name = (data?.full_name as string | undefined) || username;
    avatar = (data?.avatar_url as string | undefined) ?? null;
  }
  return { username, name, avatar };
}
