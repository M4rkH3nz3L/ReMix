import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🎨 Creator Profile — a „bemutatkozás" réteg adatmodellje és kliens-CRUD-ja.
 *
 * A profil kreatív mezői (bio, creator-típusok, készségek, érdeklődés) a
 * `profiles` táblán élnek (lásd `@/lib/profile`); a social platform-linkek és a
 * showcase-elemek külön táblákon (`profile_social_links`, `profile_showcase_items`).
 * Ez a modul: a KATALÓGUS-konstansok (típusok/platformok/javasolt tagek) + a
 * link/showcase lista-olvasás és teljes-lista-mentés.
 */

/** Mezőnkénti láthatóság. A 'friends' réteg (kölcsönös követés) jövőbeli. */
export type PrivacyLevel = 'public' | 'followers' | 'private';
export const PRIVACY_LEVELS: PrivacyLevel[] = ['public', 'followers', 'private'];

/** A privacy-szinthez tartozó ikon (Ionicons) — a UI-hoz. */
export const PRIVACY_ICON: Record<PrivacyLevel, string> = {
  public: 'earth',
  followers: 'people',
  private: 'lock-closed',
};

// ── Creator-típusok katalógusa (a label i18n: creatorProfile.types.<id>) ─────
export interface CreatorType {
  id: string;
  emoji: string;
}
export const CREATOR_TYPES: CreatorType[] = [
  { id: 'video', emoji: '🎬' },
  { id: 'photo', emoji: '📸' },
  { id: 'designer', emoji: '🎨' },
  { id: 'musician', emoji: '🎵' },
  { id: 'singer', emoji: '🎤' },
  { id: 'producer', emoji: '🎧' },
  { id: 'gamer', emoji: '🎮' },
  { id: 'writer', emoji: '✍️' },
  { id: 'podcaster', emoji: '🎙️' },
  { id: 'developer', emoji: '💻' },
  { id: 'ai', emoji: '🤖' },
  { id: 'streamer', emoji: '📡' },
  { id: 'artist', emoji: '🖌️' },
  { id: 'animator', emoji: '🎞️' },
];

/** Javasolt készség-tagek (a user szabadon vehet fel másikat is). */
export const SUGGESTED_SKILLS = [
  'Video Editing', 'Music', '3D', 'Photography', 'AI', 'Motion Design', 'Gaming',
  'Color Grading', 'Sound Design', 'Illustration', 'Writing', 'Streaming',
];

/** Javasolt érdeklődési tagek. */
export const SUGGESTED_INTERESTS = [
  'Film', 'Anime', 'Gaming', 'Music', 'AI', 'Photography', 'Design', 'Tech', 'Art',
];

/** Javasolt beszélt nyelvek (a user szabadon vehet fel másikat is). */
export const SUGGESTED_LANGUAGES = [
  'Magyar', 'English', 'Deutsch', 'Español', 'Français', 'Italiano', 'Português',
  'Polski', 'Русский', 'Türkçe', '中文', '日本語',
];

// ── Social platformok katalógusa + URL-generálás ─────────────────────────────
export interface SocialPlatform {
  id: string;
  label: string;
  /** Ionicons „logo-*" (vagy 'link' a customhoz/ismeretlenhez) */
  icon: string;
  /** a beírt username → teljes URL; ha nincs (custom), a user URL-t ad meg */
  toUrl?: (username: string) => string;
}

const strip = (u: string) => u.trim().replace(/^@+/, '');

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  { id: 'instagram', label: 'Instagram', icon: 'logo-instagram', toUrl: (u) => `https://instagram.com/${strip(u)}` },
  { id: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', toUrl: (u) => `https://tiktok.com/@${strip(u)}` },
  { id: 'youtube', label: 'YouTube', icon: 'logo-youtube', toUrl: (u) => `https://youtube.com/@${strip(u)}` },
  { id: 'twitch', label: 'Twitch', icon: 'logo-twitch', toUrl: (u) => `https://twitch.tv/${strip(u)}` },
  { id: 'x', label: 'X', icon: 'logo-twitter', toUrl: (u) => `https://x.com/${strip(u)}` },
  { id: 'facebook', label: 'Facebook', icon: 'logo-facebook', toUrl: (u) => `https://facebook.com/${strip(u)}` },
  { id: 'discord', label: 'Discord', icon: 'logo-discord', toUrl: (u) => `https://discord.com/users/${strip(u)}` },
  { id: 'reddit', label: 'Reddit', icon: 'logo-reddit', toUrl: (u) => `https://reddit.com/user/${strip(u)}` },
  { id: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin', toUrl: (u) => `https://linkedin.com/in/${strip(u)}` },
  { id: 'github', label: 'GitHub', icon: 'logo-github', toUrl: (u) => `https://github.com/${strip(u)}` },
  { id: 'behance', label: 'Behance', icon: 'logo-behance', toUrl: (u) => `https://behance.net/${strip(u)}` },
  { id: 'dribbble', label: 'Dribbble', icon: 'logo-dribbble', toUrl: (u) => `https://dribbble.com/${strip(u)}` },
  { id: 'spotify', label: 'Spotify', icon: 'musical-notes', toUrl: (u) => `https://open.spotify.com/user/${strip(u)}` },
  { id: 'soundcloud', label: 'SoundCloud', icon: 'logo-soundcloud', toUrl: (u) => `https://soundcloud.com/${strip(u)}` },
  { id: 'bandcamp', label: 'Bandcamp', icon: 'musical-note', toUrl: (u) => `https://${strip(u)}.bandcamp.com` },
  { id: 'applemusic', label: 'Apple Music', icon: 'logo-apple', toUrl: (u) => `https://music.apple.com/profile/${strip(u)}` },
  { id: 'steam', label: 'Steam', icon: 'logo-steam', toUrl: (u) => `https://steamcommunity.com/id/${strip(u)}` },
  { id: 'playstation', label: 'PlayStation', icon: 'logo-playstation' },
  { id: 'xbox', label: 'Xbox', icon: 'logo-xbox' },
  { id: 'bluesky', label: 'Bluesky', icon: 'cloud', toUrl: (u) => `https://bsky.app/profile/${strip(u)}` },
  { id: 'threads', label: 'Threads', icon: 'at', toUrl: (u) => `https://threads.net/@${strip(u)}` },
  { id: 'pinterest', label: 'Pinterest', icon: 'logo-pinterest', toUrl: (u) => `https://pinterest.com/${strip(u)}` },
  { id: 'website', label: 'Website', icon: 'globe' },
  { id: 'custom', label: 'Custom', icon: 'link' },
];

export function socialPlatform(id: string): SocialPlatform {
  return SOCIAL_PLATFORMS.find((p) => p.id === id) ?? SOCIAL_PLATFORMS[SOCIAL_PLATFORMS.length - 1];
}

/** A megjelenítendő/megnyitandó URL: a beírt teljes URL, vagy a username-ből generált. */
export function socialUrl(link: Pick<SocialLink, 'platform' | 'username' | 'url'>): string {
  const p = socialPlatform(link.platform);
  if (link.url && /^https?:\/\//i.test(link.url)) {
    return link.url;
  }
  if (p.toUrl && link.username) {
    return p.toUrl(link.username);
  }
  return link.url ?? '';
}

// ── Social linkek ────────────────────────────────────────────────────────────
export interface SocialLink {
  id: string;
  platform: string;
  /** @handle (platformoknál); custom/website esetén üres */
  username: string;
  /** teljes URL (custom/website kötelező; másnál generálható) */
  url: string;
  /** egyedi cím (custom link kártyához, pl. „My portfolio") */
  displayName: string;
  isPublic: boolean;
  sortOrder: number;
}

interface SocialLinkRow {
  id: string;
  platform: string;
  username: string | null;
  url: string | null;
  display_name: string | null;
  is_public: boolean;
  sort_order: number;
}

function currentUserId(): string {
  const id = useAuth.getState().user?.id;
  if (!id) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  return id;
}

const toLink = (r: SocialLinkRow): SocialLink => ({
  id: r.id,
  platform: r.platform,
  username: r.username ?? '',
  url: r.url ?? '',
  displayName: r.display_name ?? '',
  isPublic: r.is_public,
  sortOrder: r.sort_order,
});

/** Egy user social linkjei (sorrendben). Idegen usernél az RLS csak a publikusakat adja. */
export async function listSocialLinks(userId: string): Promise<SocialLink[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('profile_social_links')
    .select('id, platform, username, url, display_name, is_public, sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as SocialLinkRow[]).map(toLink);
}

/** A saját linklista TELJES lecserélése (delete-mine + bulk insert), a szerkesztő „mentés"-éhez. */
export async function replaceSocialLinks(links: SocialLink[]): Promise<void> {
  const sb = requireSupabase();
  const uid = currentUserId();
  const del = await sb.from('profile_social_links').delete().eq('user_id', uid);
  if (del.error) {
    throw new Error(del.error.message);
  }
  if (links.length === 0) {
    return;
  }
  const rows = links.map((l, i) => ({
    user_id: uid,
    platform: l.platform,
    username: l.username.trim() || null,
    url: socialUrl(l).trim() || null,
    display_name: l.displayName.trim() || null,
    is_public: l.isPublic,
    sort_order: i,
  }));
  const ins = await sb.from('profile_social_links').insert(rows);
  if (ins.error) {
    throw new Error(ins.error.message);
  }
}

// ── Showcase elemek ──────────────────────────────────────────────────────────
export type ShowcaseKind = 'video' | 'project' | 'image' | 'music' | 'movie' | 'game' | 'link';

/** Showcase-típus katalógus (label i18n: showcase.kinds.<id>). */
export const SHOWCASE_KINDS: { id: ShowcaseKind; icon: string }[] = [
  { id: 'video', icon: 'videocam' },
  { id: 'project', icon: 'cube' },
  { id: 'image', icon: 'image' },
  { id: 'music', icon: 'musical-notes' },
  { id: 'movie', icon: 'film' },
  { id: 'game', icon: 'game-controller' },
  { id: 'link', icon: 'link' },
];

export interface ShowcaseItem {
  id: string;
  kind: ShowcaseKind;
  /** ReMix-tartalom hivatkozás (post_id / project_id), ha van */
  refId: string;
  title: string;
  subtitle: string;
  thumbUrl: string;
  url: string;
  sortOrder: number;
}

interface ShowcaseRow {
  id: string;
  kind: ShowcaseKind;
  ref_id: string | null;
  title: string | null;
  subtitle: string | null;
  thumb_url: string | null;
  url: string | null;
  sort_order: number;
}

const toItem = (r: ShowcaseRow): ShowcaseItem => ({
  id: r.id,
  kind: r.kind,
  refId: r.ref_id ?? '',
  title: r.title ?? '',
  subtitle: r.subtitle ?? '',
  thumbUrl: r.thumb_url ?? '',
  url: r.url ?? '',
  sortOrder: r.sort_order,
});

/** Egy user showcase-elemei (opcionálisan típusra szűrve). */
export async function listShowcase(userId: string, kind?: ShowcaseKind): Promise<ShowcaseItem[]> {
  const sb = requireSupabase();
  let q = sb
    .from('profile_showcase_items')
    .select('id, kind, ref_id, title, subtitle, thumb_url, url, sort_order')
    .eq('user_id', userId);
  if (kind) {
    q = q.eq('kind', kind);
  }
  const { data, error } = await q.order('sort_order', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as ShowcaseRow[]).map(toItem);
}

/** A TELJES (vegyes típusú) showcase-lista lecserélése egy közös sorrendben. */
export async function replaceAllShowcase(items: ShowcaseItem[]): Promise<void> {
  const sb = requireSupabase();
  const uid = currentUserId();
  const del = await sb.from('profile_showcase_items').delete().eq('user_id', uid);
  if (del.error) {
    throw new Error(del.error.message);
  }
  if (items.length === 0) {
    return;
  }
  const rows = items.map((it, i) => ({
    user_id: uid,
    kind: it.kind,
    ref_id: it.refId.trim() || null,
    title: it.title.trim() || null,
    subtitle: it.subtitle.trim() || null,
    thumb_url: it.thumbUrl.trim() || null,
    url: it.url.trim() || null,
    sort_order: i,
  }));
  const ins = await sb.from('profile_showcase_items').insert(rows);
  if (ins.error) {
    throw new Error(ins.error.message);
  }
}

/** Egy adott TÍPUS showcase-listájának teljes lecserélése (a szerkesztő „mentés"-éhez). */
export async function replaceShowcase(kind: ShowcaseKind, items: ShowcaseItem[]): Promise<void> {
  const sb = requireSupabase();
  const uid = currentUserId();
  const del = await sb.from('profile_showcase_items').delete().eq('user_id', uid).eq('kind', kind);
  if (del.error) {
    throw new Error(del.error.message);
  }
  if (items.length === 0) {
    return;
  }
  const rows = items.map((it, i) => ({
    user_id: uid,
    kind,
    ref_id: it.refId.trim() || null,
    title: it.title.trim() || null,
    subtitle: it.subtitle.trim() || null,
    thumb_url: it.thumbUrl.trim() || null,
    url: it.url.trim() || null,
    sort_order: i,
  }));
  const ins = await sb.from('profile_showcase_items').insert(rows);
  if (ins.error) {
    throw new Error(ins.error.message);
  }
}
