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
}

const EMPTY: AccountProfile = {
  fullName: '',
  phone: '',
  birthday: '',
  country: '',
  city: '',
  avatarUrl: '',
  coverUrl: '',
};

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
    .select('full_name, phone, birthday, country, city, avatar_url, cover_url')
    .eq('id', currentUserId())
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return { ...EMPTY };
  }
  return {
    fullName: data.full_name ?? '',
    phone: data.phone ?? '',
    birthday: data.birthday ?? '',
    country: data.country ?? '',
    city: data.city ?? '',
    avatarUrl: data.avatar_url ?? '',
    coverUrl: data.cover_url ?? '',
  };
}

/** A profil mentése (upsert — ha a trigger-sor valamiért hiányozna, létrejön). */
export async function saveProfile(profile: AccountProfile): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('profiles').upsert(
    {
      id: currentUserId(),
      full_name: profile.fullName.trim() || null,
      phone: profile.phone.trim() || null,
      birthday: profile.birthday.trim() || null,
      country: profile.country.trim() || null,
      city: profile.city.trim() || null,
      avatar_url: profile.avatarUrl.trim() || null,
      cover_url: profile.coverUrl.trim() || null,
    },
    { onConflict: 'id' },
  );
  if (error) {
    throw new Error(error.message);
  }
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
  return uploadMedia(picked.uri);
}
