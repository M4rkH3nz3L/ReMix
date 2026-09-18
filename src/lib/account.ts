import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

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

/**
 * 📤 GDPR adat-export (hozzáférés + hordozhatóság, Art. 15/20): a felhasználóról
 * tárolt ÖSSZES adat egy gépi olvasható JSON-ban, megosztva. Minden lekérés
 * own-scope RLS-en megy (csak a saját adatod). Az AI-kulcsokat BIZTONSÁGBÓL
 * kihagyjuk a megosztott fájlból. @returns a fájl uri-ja.
 */
export async function exportMyData(): Promise<string> {
  const sb = requireSupabase();
  const user = useAuth.getState().user;
  const uid = user?.id;
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  // best-effort: egy tábla hibája ne bukjon el az egész exporttal
  const pick = (p: PromiseLike<{ data: unknown }>): Promise<unknown> =>
    Promise.resolve(p).then(
      (r) => r.data ?? null,
      () => null
    );

  const [
    profile,
    consents,
    cloudProjects,
    subscription,
    aiProviders,
    notifications,
    posts,
    comments,
    likes,
    saves,
    follows,
    role,
  ] = await Promise.all([
    pick(sb.from('profiles').select('*').eq('id', uid).maybeSingle()),
    pick(sb.from('user_consents').select('*').eq('user_id', uid)),
    pick(sb.from('cloud_projects').select('project_id, name, data, updated_at').eq('user_id', uid)),
    pick(sb.from('subscriptions').select('*').eq('user_id', uid).maybeSingle()),
    // ⚠️ api_key SZÁNDÉKOSAN kihagyva a megosztott exportból
    pick(sb.from('user_ai_providers').select('id, label, provider, base_url, model, is_default').eq('user_id', uid)),
    pick(sb.from('notifications').select('*').eq('user_id', uid)),
    pick(sb.from('posts').select('*').eq('creator_id', uid)),
    pick(sb.from('post_comments').select('*').eq('author_id', uid)),
    pick(sb.from('post_likes').select('*').eq('user_id', uid)),
    pick(sb.from('post_saves').select('*').eq('user_id', uid)),
    pick(sb.from('follows').select('*').eq('follower_id', uid)),
    pick(sb.from('user_roles').select('*').eq('user_id', uid).maybeSingle()),
  ]);

  const bundle = {
    _meta: {
      app: 'ReMix',
      exportedAt: new Date().toISOString(),
      userId: uid,
      email: user?.email ?? null,
      note: 'GDPR adat-export (hozzáférés/hordozhatóság). Az AI-kulcsok biztonsági okból kihagyva.',
    },
    profile,
    consents,
    cloudProjects,
    subscription,
    aiProviders,
    notifications,
    posts,
    comments,
    likes,
    saves,
    follows,
    role,
  };

  const dir = new Directory(Paths.cache, 'export');
  if (!dir.exists) {
    dir.create();
  }
  const file = new File(dir, 'remix-adatexport.json');
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // a write úgyis felülírja
  }
  file.write(JSON.stringify(bundle, null, 2));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'ReMix adat-export',
    });
  }
  return file.uri;
}
