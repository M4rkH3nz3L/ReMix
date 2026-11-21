import { reachableMediaUrl } from '@/lib/mediaUrl';
import { supabase } from '@/lib/supabase';
import type { ChatPeer } from '@/lib/chatCore/model';
import { currentUserId } from '@/lib/chatClient/session';

/**
 * A KÖVETETT userek mint jelöltek (csoportba hívható emberek). Nincs nyilvános
 * user-kereső (GDPR: a profilok privátak), ezért a jelölt-halmaz az, akiket
 * KÖVETEK — az ő publikus adataik a public_profile-lal jönnek.
 */
export async function listFollowingPeers(): Promise<ChatPeer[]> {
  const sb = supabase;
  const uid = currentUserId();
  if (!sb || !uid) {
    return [];
  }
  const { data } = await sb.from('follows').select('following_id').eq('follower_id', uid);
  const ids = [...new Set((data ?? []).map((r: { following_id: string }) => r.following_id))];
  if (ids.length === 0) {
    return [];
  }
  const peers = await resolvePeers(ids);
  return ids.map((id) => peers.get(id) ?? { id, name: null, avatar: null });
}

// ── partner-feloldás (DM) ──────────────────────────────────────────────────
/** Publikus profil (név+avatar) feloldása id-kra — a profiles owner-only RLS-t a
 * public_profile SECURITY DEFINER kerüli meg (privát mezők nem szivárognak). */
export async function resolvePeers(ids: string[]): Promise<Map<string, ChatPeer>> {
  const sb = supabase;
  const out = new Map<string, ChatPeer>();
  if (!sb || ids.length === 0) {
    return out;
  }
  const unique = [...new Set(ids)];
  const rows = await Promise.all(
    unique.map(async (id) => {
      const { data } = await sb.rpc('public_profile', { p_user: id });
      const p = (Array.isArray(data) ? data[0] : data) as
        | { full_name: string | null; avatar_url: string | null }
        | undefined;
      return {
        id,
        name: p?.full_name ?? null,
        avatar: reachableMediaUrl(p?.avatar_url ?? null),
      } as ChatPeer;
    })
  );
  rows.forEach((p) => out.set(p.id, p));
  return out;
}
