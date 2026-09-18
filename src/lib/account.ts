import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🗑️ Fiók soft-delete (GDPR — deaktiválás, nem végleges törlés). A fiók/tartalom
 * megmarad, de `profiles.deleted_at` beáll → a tartalom eltűnik a platformról
 * (RLS `is_deleted` szűri), és a fiók VISSZAÁLLÍTHATÓ. A jogosultságot az RPC-k a
 * verifikált tokenből (auth.uid()) veszik — senki más fiókját nem érinti.
 */

/** A saját fiók soft-törlése (deaktiválás). Utána a hívó jellemzően kijelentkezik. */
export async function softDeleteAccount(): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('soft_delete_account');
  if (error) {
    throw new Error(error.message);
  }
}

/** A saját (deaktivált) fiók visszaállítása. */
export async function reactivateAccount(): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('reactivate_account');
  if (error) {
    throw new Error(error.message);
  }
}

/** Deaktiválva van-e a bejelentkezett fiók (a helyreállítás-prompthoz). */
export async function isMyAccountDeleted(): Promise<boolean> {
  const uid = useAuth.getState().user?.id;
  if (!supabase || !uid) {
    return false;
  }
  const { data } = await supabase.from('profiles').select('deleted_at').eq('id', uid).maybeSingle();
  return !!(data as { deleted_at?: string | null } | null)?.deleted_at;
}
