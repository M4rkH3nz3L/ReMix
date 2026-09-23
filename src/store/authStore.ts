import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import type { SignUpProfile } from '@/lib/accountValidation';
import { CONSENT_VERSION } from '@/constants/legal';
import { registerCurrentDevice } from '@/lib/deviceInfo';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useEntitlement } from '@/store/entitlementStore';
import { useRoles } from '@/store/roleStore';

/**
 * 🔐 Auth-store — a bejelentkezett felhasználó EGYETLEN forrása.
 *
 * A session-t a Supabase-kliens perzisztálja (AsyncStorage); ez a store csak
 * a React-oldali tükre + a be-/kijelentkező műveletek. A gyökér-layout
 * (`src/app/_layout.tsx`) hydrálja indításkor, és amíg `!hydrated`, még nem
 * dönthető el, be van-e jelentkezve a user — ezért addig splash/loading megy,
 * hogy ne villanjon fel az auth-képernyő.
 *
 * Mintája az `entitlementStore`-é (zustand + egyszeri hydrate). A tényleges
 * kapuzás a `Stack.Protected guard={isAuthed}` az Expo Router layoutban.
 */

/** Egy auth-művelet eredménye: siker, hiba, vagy „erősítsd meg az e-mailt". */
export interface AuthResult {
  error?: string;
  /** regisztráció után: e-mail-megerősítés kell (nincs azonnali session) */
  needsEmailConfirm?: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  /** lefutott-e már az induló session-betöltés (guard-döntés előtt kell) */
  hydrated: boolean;
  /** van-e beállított Supabase-backend (config) */
  configured: boolean;
  /** be van-e jelentkezve (nem-reaktív döntésekhez is) */
  isAuthed: () => boolean;
  /** app-indításkor egyszer: session betöltése + változás-figyelő */
  hydrate: () => Promise<void>;
  signUp: (
    email: string,
    password: string,
    profile: SignUpProfile,
  ) => Promise<AuthResult>;
  /** belépés e-maillel, felhasználónévvel VAGY telefonnal (azonosító → e-mail feloldás) */
  signIn: (identifier: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

/** Supabase-hiba → rövid, felhasználónak mutatható üzenet. */
function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Ismeretlen hiba';
}

let subscribed = false;

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  hydrated: false,
  configured: hasSupabaseConfig(),

  isAuthed: () => get().session != null,

  hydrate: async () => {
    if (!supabase) {
      // nincs backend-config → nem lehet bejelentkezni; a guard az auth-képernyőt
      // mutatja, ami konfig-hiányt jelez
      set({ hydrated: true, configured: false });
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      set({ session: data.session, user: data.session?.user ?? null });
      // 💳 Pro-szint szinkronja a bejelentkezett userhez (offline-cache + Supabase)
      void useEntitlement.getState().syncFromUser(data.session?.user?.id ?? null);
      void useRoles.getState().refresh(); // 🛡️ governance-jogok betöltése
      // már bejelentkezett user: aktuális eszköz frissítése (last_seen + adatok)
      if (data.session?.user) {
        void registerCurrentDevice(data.session.user.id);
      }
    } catch {
      // best-effort; session nélkül indulunk (auth-képernyő)
    }
    // változás-figyelő (login/logout/token-refresh) — csak egyszer iratkozunk fel
    if (!subscribed) {
      subscribed = true;
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null });
        // 💳 minden auth-váltásnál újraszinkron: login → user szintje, logout → Free
        void useEntitlement.getState().syncFromUser(session?.user?.id ?? null);
        void useRoles.getState().refresh(); // 🛡️ jogok újratöltése auth-váltáskor
      });
    }
    set({ hydrated: true });
  },

  signUp: async (email, password, profile) => {
    if (!supabase) {
      return { error: 'Supabase nincs konfigurálva.' };
    }
    // A profil-mezők user-metadataként mennek; a profiles-sort belőlük az
    // auth.users trigger (handle_new_user) hozza létre — e-mail-megerősítés
    // esetén is, még session előtt.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: profile.fullName.trim(),
          username: profile.username.trim(),
          phone: profile.phone.trim(),
          birthday: profile.birthday.trim(),
          country: profile.country.trim(),
          city: profile.city.trim(),
          // 📜 GDPR: a regisztrációkor adott hozzájárulás verziója — a trigger
          // ebből rögzíti a user_consents naplóba (időbélyeggel).
          consent_version: CONSENT_VERSION,
        },
      },
    });
    if (error) {
      return { error: messageOf(error) };
    }
    // ha be van kapcsolva az e-mail-megerősítés, nincs azonnali session
    if (!data.session) {
      return { needsEmailConfirm: true };
    }
    // azonnali session: az eszköz rögtön rögzíthető (RLS: auth.uid() megvan)
    if (data.user) {
      void registerCurrentDevice(data.user.id);
    }
    return {};
  },

  signIn: async (identifier, password) => {
    if (!supabase) {
      return { error: 'Supabase nincs konfigurálva.' };
    }
    // e-mail → közvetlen; felhasználónév/telefon → e-mailre feloldás (RPC, belépés
    // előtt fut, anon szerepként). A profiles owner-only RLS-t a definer kerüli meg.
    let email = identifier.trim();
    if (!email.includes('@')) {
      const resolved = await supabase.rpc('resolve_login_email', { p_identifier: email });
      if (resolved.error) {
        return { error: messageOf(resolved.error) };
      }
      if (!resolved.data) {
        return { error: 'Nincs ilyen felhasználó (e-mail, felhasználónév vagy telefon).' };
      }
      email = resolved.data as string;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return { error: messageOf(error) };
    }
    if (data.user) {
      void registerCurrentDevice(data.user.id);
    }
    return {};
  },

  signOut: async () => {
    if (!supabase) {
      return;
    }
    try {
      await supabase.auth.signOut();
    } catch {
      // best-effort; a lokális session-t az onAuthStateChange úgyis törli
    }
  },
}));
