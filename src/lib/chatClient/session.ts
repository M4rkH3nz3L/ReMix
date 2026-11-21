import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/** Az aktuális user id-ja, vagy null. */
export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/**
 * A saját denormalizált feladó-adatok (username/name/avatar) — az üzenetre
 * mentjük, hogy a másik fél név+kép szerint lássa, cross-profil olvasás nélkül
 * (ugyanaz a minta, mint a feed poszt/komment szerzőjénél).
 */
export async function senderFields(): Promise<{
  username: string | null;
  name: string | null;
  avatar: string | null;
}> {
  const user = useAuth.getState().user;
  const email = user?.email ?? null;
  const username = email ? email.split('@')[0] : null;
  let name: string | null = username;
  let avatar: string | null = null;
  if (supabase && user?.id) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    name = (data?.full_name as string | undefined) || username;
    avatar = (data?.avatar_url as string | undefined) ?? null;
  }
  return { username, name, avatar };
}
