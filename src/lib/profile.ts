import type { PrivacyLevel } from '@/lib/creatorProfile';
import { pickImage } from '@/lib/media';
import { uploadMedia } from '@/lib/render';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 👤 Profil-adatok olvasása/írása a `public.profiles` táblához.
 *
 * A sort a `handle_new_user` trigger hozza létre regisztrációkor; itt csak
 * olvassuk és frissítjük. RLS: mindenki csak a sajátját (`auth.uid() = id`).
 */

export interface AccountProfile {
  /** 🔑 EGYEDI login-handle (@username) — ezzel is be lehet lépni. NEM a display name. */
  username: string;
  /** megjelenített név a csatornán/feedben (nem egyedi) */
  fullName: string;
  phone: string;
  /** ISO dátum: YYYY-MM-DD (üres, ha nincs) */
  birthday: string;
  country: string;
  city: string;
  /** 🖼️ profilkép publikus Storage-URL (üres, ha nincs) — a csatornán/feedben látszik */
  avatarUrl: string;
  /** 🖼️ borítókép publikus Storage-URL (üres, ha nincs) — a csatorna-fejlécben */
  coverUrl: string;
  // ── 🎨 Creator réteg (bemutatkozás) ──
  /** rövid bemutatkozás (≈160–500) — a creator-page fejlécében */
  bio: string;
  /** „Rólam" */
  aboutMe: string;
  /** „Mit készítek?" */
  whatIMake: string;
  /** „Jelenleg ezen dolgozom…" */
  workingOn: string;
  /** creator-típus id-k (lásd CREATOR_TYPES) — több is választható */
  creatorTypes: string[];
  /** készség-tagek (pl. Video Editing, AI) */
  skills: string[];
  /** érdeklődési tagek */
  interests: string[];
  /** beszélt nyelvek */
  languages: string[];
  /** IANA időzóna (pl. Europe/Budapest) */
  timezone: string;
  /** mezőnkénti láthatóság; hiányzó kulcs = az adott mező alapértelmezése */
  fieldPrivacy: Record<string, PrivacyLevel>;
}

const EMPTY: AccountProfile = {
  username: '',
  fullName: '',
  phone: '',
  birthday: '',
  country: '',
  city: '',
  avatarUrl: '',
  coverUrl: '',
  bio: '',
  aboutMe: '',
  whatIMake: '',
  workingOn: '',
  creatorTypes: [],
  skills: [],
  interests: [],
  languages: [],
  timezone: '',
  fieldPrivacy: {},
};

/** Friss, üres profil (a szerkesztő kezdőállapotához) — új tömb/objektum-példányokkal. */
export function emptyProfile(): AccountProfile {
  return {
    ...EMPTY,
    creatorTypes: [],
    skills: [],
    interests: [],
    languages: [],
    fieldPrivacy: {},
  };
}

function currentUserId(): string {
  const id = useAuth.getState().user?.id;
  if (!id) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  return id;
}

/** A bejelentkezett user profilja (hiányzó sor esetén üres mezők). */
export async function fetchProfile(): Promise<AccountProfile> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'username, full_name, phone, birthday, country, city, avatar_url, cover_url, bio, about_me, what_i_make, working_on, creator_types, skills, interests, languages, timezone, field_privacy'
    )
    .eq('id', currentUserId())
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return { ...EMPTY };
  }
  return {
    username: data.username ?? '',
    fullName: data.full_name ?? '',
    phone: data.phone ?? '',
    birthday: data.birthday ?? '',
    country: data.country ?? '',
    city: data.city ?? '',
    avatarUrl: data.avatar_url ?? '',
    coverUrl: data.cover_url ?? '',
    bio: data.bio ?? '',
    aboutMe: data.about_me ?? '',
    whatIMake: data.what_i_make ?? '',
    workingOn: data.working_on ?? '',
    creatorTypes: (data.creator_types as string[] | null) ?? [],
    skills: (data.skills as string[] | null) ?? [],
    interests: (data.interests as string[] | null) ?? [],
    languages: (data.languages as string[] | null) ?? [],
    timezone: data.timezone ?? '',
    fieldPrivacy: (data.field_privacy as Record<string, PrivacyLevel> | null) ?? {},
  };
}

/** A profil mentése (upsert — ha a trigger-sor valamiért hiányozna, létrejön). */
export async function saveProfile(profile: AccountProfile): Promise<void> {
  const supabase = requireSupabase();
  const username = profile.username.trim();
  if (!username) {
    // a username KÖTELEZŐ (NOT NULL + egyedi) — a képernyő is validál előtte
    throw new Error('USERNAME_REQUIRED');
  }
  const { error } = await supabase.from('profiles').upsert(
    {
      id: currentUserId(),
      username,
      full_name: profile.fullName.trim() || null,
      phone: profile.phone.trim() || null,
      birthday: profile.birthday.trim() || null,
      country: profile.country.trim() || null,
      city: profile.city.trim() || null,
      avatar_url: profile.avatarUrl.trim() || null,
      cover_url: profile.coverUrl.trim() || null,
      bio: profile.bio.trim() || null,
      about_me: profile.aboutMe.trim() || null,
      what_i_make: profile.whatIMake.trim() || null,
      working_on: profile.workingOn.trim() || null,
      creator_types: profile.creatorTypes,
      skills: profile.skills,
      interests: profile.interests,
      languages: profile.languages,
      timezone: profile.timezone.trim() || null,
      field_privacy: profile.fieldPrivacy,
    },
    { onConflict: 'id' },
  );
  if (error) {
    // 23505 = egyedi-index ütközés → foglalt felhasználónév (beszédes hiba a UI-nak)
    if ((error as { code?: string }).code === '23505' || /username|duplicate key/i.test(error.message)) {
      throw new Error('USERNAME_TAKEN');
    }
    throw new Error(error.message);
  }
}

/** Szabad-e a felhasználónév? (regisztráció/profil előtt, session nélkül is) */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('username_available', { p_username: username });
  if (error) {
    // hiba esetén ne blokkoljunk (a DB unique-index úgyis véd) — engedjük tovább
    return true;
  }
  return data === true;
}

/**
 * 🖼️ Profil- vagy borítókép választása + feltöltése → publikus Storage-URL (a
 * worker /media/upload-ján). `null`, ha a felhasználó mégsem választott. A
 * megjelenítés a URL-t `reachableMediaUrl`-lel oldja fel (dev-host).
 */
export async function pickAndUploadProfileImage(): Promise<string | null> {
  const picked = await pickImage();
  if (!picked) {
    return null;
  }
  // profilkép/borító — nem projekthez tartozik → `profile/<fájl>`
  return uploadMedia(picked.uri, { kind: 'profile' });
}

/** Csak KIVÁLASZTÁS (feltöltés nélkül) — a borító-igazítóhoz. `null`, ha mégse. */
export async function pickProfileImageLocal(): Promise<string | null> {
  const picked = await pickImage();
  return picked?.uri ?? null;
}

/** Egy (esetleg már bevágott) helyi kép feltöltése → publikus Storage-URL. */
export async function uploadProfileImage(uri: string): Promise<string> {
  return uploadMedia(uri, { kind: 'profile' });
}
