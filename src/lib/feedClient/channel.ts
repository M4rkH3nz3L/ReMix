import { reachableMediaUrl } from '@/lib/mediaUrl';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import type { Creator } from '@/types/social';
import type { ChannelData } from '@/lib/feedCore/channel';
import { POST_COLUMNS, toPost, type PostRow } from '@/lib/feedCore/postRows';
import { currentUserId, viewerEngagement } from '@/lib/feedClient/session';

export async function getChannel(userId: string): Promise<ChannelData> {
  const sb = requireSupabase();
  const me = currentUserId();
  const { data, error } = await sb
    .from('posts')
    .select(POST_COLUMNS)
    .eq('creator_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PostRow[];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  const posts = rows.map((r) => toPost(r, liked, saved));

  const { data: stats } = await sb.rpc('channel_stats', { p_user: userId });
  const s = (stats ?? {}) as { followers?: number; following?: number; posts?: number };

  let isFollowing = false;
  if (me && me !== userId) {
    const { data: fr } = await sb
      .from('follows')
      .select('follower_id')
      .eq('follower_id', me)
      .eq('following_id', userId)
      .maybeSingle();
    isFollowing = !!fr;
  }

  // A csatorna identitása (név/avatar/borító) a profiles-ból — a PUBLIKUS mezőket
  // BÁRKINEK a public_profile SECURITY DEFINER függvény adja (a privát mezők — telefon/
  // születésnap — nem szivárognak). Így poszt nélküli csatorna is helyes fejlécet kap.
  const { data: profRows } = await sb.rpc('public_profile', { p_user: userId });
  const prof = (Array.isArray(profRows) ? profRows[0] : profRows) as
    | {
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        cover_url: string | null;
        bio?: string | null;
        about_me?: string | null;
        what_i_make?: string | null;
        working_on?: string | null;
        creator_types?: string[] | null;
        skills?: string[] | null;
        interests?: string[] | null;
        languages?: string[] | null;
      }
    | undefined;
  const emailHandle = me === userId ? (useAuth.getState().user?.email?.split('@')[0] ?? null) : null;
  // az EGYEDI username a profiles-ból (public_profile); csak fallback a poszt/email
  const username = prof?.username ?? posts[0]?.creator.username ?? emailHandle ?? userId.slice(0, 8);
  const creator: Creator = {
    id: userId,
    username,
    displayName: prof?.full_name || posts[0]?.creator.displayName || username,
    avatarUri: reachableMediaUrl(prof?.avatar_url ?? null) ?? posts[0]?.creator.avatarUri,
  };
  const coverUri = reachableMediaUrl(prof?.cover_url ?? null) ?? undefined;

  return {
    userId,
    creator,
    coverUri,
    bio: prof?.bio ?? undefined,
    aboutMe: prof?.about_me ?? undefined,
    whatIMake: prof?.what_i_make ?? undefined,
    workingOn: prof?.working_on ?? undefined,
    creatorTypes: prof?.creator_types ?? undefined,
    skills: prof?.skills ?? undefined,
    interests: prof?.interests ?? undefined,
    languages: prof?.languages ?? undefined,
    posts,
    followers: s.followers ?? 0,
    following: s.following ?? 0,
    postCount: s.posts ?? posts.length,
    isFollowing,
    isMe: me === userId,
  };
}
