import type { Session, User } from '@supabase/supabase-js';
import { t } from 'i18next';
import { create } from 'zustand';

import type { SignUpProfile } from '@/lib/accountValidation';
import { CONSENT_VERSION } from '@/constants/legal';
import { getInstallId, registerCurrentDevice } from '@/lib/deviceInfo';
import { loginNeedsMfa, verifyLoginTotp } from '@/lib/mfa';
import { isAllowedPhone, isValidOtp, normalizeE164 } from '@/lib/phoneAuth';
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
  /**
   * 📲 Telefonos regisztráció után: SMS-ben kapott 6 jegyű kód kell
   * (`verifyPhoneOtp`). A `phone` a NORMALIZÁLT E.164-szám — a UI ezt adja
   * vissza az ellenőrzésnél, hogy ne a nyers beírt alak menjen.
   */
  needsSmsOtp?: boolean;
  phone?: string;
  /** 🔐 a jelszó stimmelt, de a befejezéshez TOTP-kód kell (MFA) */
  needsMfa?: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  /** lefutott-e már az induló session-betöltés (guard-döntés előtt kell) */
  hydrated: boolean;
  /** van-e beállított Supabase-backend (config) */
  configured: boolean;
  /** 🔐 van session, de MFA (TOTP) még nincs teljesítve → még nem beléptetett */
  mfaPending: boolean;
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
  /** 📲 regisztráció TELEFONSZÁMMAL — SMS-OTP-t küld (Brevo hook) */
  signUpWithPhone: (
    phone: string,
    password: string,
    profile: SignUpProfile,
  ) => Promise<AuthResult>;
  /** 📲 az SMS-ben kapott 6 jegyű kód ellenőrzése → session */
  verifyPhoneOtp: (phone: string, token: string) => Promise<AuthResult>;
  /** 📲 OTP újraküldése (a Supabase rate-limit alá esik) */
  resendPhoneOtp: (phone: string) => Promise<AuthResult>;
  /** ✉️ e-mail-megerősítő link újraküldése (a Supabase rate-limit alá esik) */
  resendEmailConfirm: (email: string) => Promise<AuthResult>;
  /** 🔐 a login-kori TOTP-challenge teljesítése (needsMfa után) */
  verifyMfaLogin: (code: string) => Promise<AuthResult>;
  /** 🔐 az ÖSSZES TÖBBI munkamenet kiléptetése (ezt az eszközt megtartva) */
  signOutOtherSessions: () => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

/**
 * Supabase-hiba → rövid, LOKALIZÁLT, felhasználónak mutatható üzenet.
 * Elsődlegesen a stabil `error.code` alapján képez i18n-kulcsra (gotrue),
 * tartalékként a nyers `message` tartalmára illeszt; ha egyiket sem ismeri
 * fel, a nyers szerver-üzenetet adja (hogy ne nyeljük el az infót).
 */
const AUTH_ERROR_KEY_BY_CODE: Record<string, string> = {
  invalid_credentials: 'auth.errors.invalidCredentials',
  email_not_confirmed: 'auth.errors.emailNotConfirmed',
  email_exists: 'auth.errors.userAlreadyExists',
  user_already_exists: 'auth.errors.userAlreadyExists',
  phone_exists: 'auth.errors.phoneExists',
  weak_password: 'auth.errors.weakPassword',
  over_request_rate_limit: 'auth.errors.rateLimit',
  over_email_send_rate_limit: 'auth.errors.rateLimit',
  over_sms_send_rate_limit: 'auth.errors.rateLimit',
  otp_expired: 'auth.errors.otpExpired',
  user_not_found: 'auth.errors.userNotFound',
};

function keyByMessage(raw: string): string | undefined {
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials')) return 'auth.errors.invalidCredentials';
  if (m.includes('email not confirmed')) return 'auth.errors.emailNotConfirmed';
  if (m.includes('already registered') || m.includes('already exists')) {
    return 'auth.errors.userAlreadyExists';
  }
  if (m.includes('rate limit')) return 'auth.errors.rateLimit';
  if (m.includes('weak password')) return 'auth.errors.weakPassword';
  return undefined;
}

function messageOf(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? e.code : undefined;
    const raw = typeof e.message === 'string' ? e.message : '';
    const key = (code ? AUTH_ERROR_KEY_BY_CODE[code] : undefined) ?? keyByMessage(raw);
    if (key) return t(key);
    if (raw) return raw;
  }
  return t('auth.errors.unknown');
}

let subscribed = false;

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  hydrated: false,
  configured: hasSupabaseConfig(),
  mfaPending: false,

  // 🔐 belépett = van session ÉS nincs függő MFA. MFA-faktor nélküli usernél a
  // mfaPending sosem lesz true → a viselkedés a korábbival azonos.
  isAuthed: () => get().session != null && !get().mfaPending,

  hydrate: async () => {
    if (!supabase) {
      // nincs backend-config → nem lehet bejelentkezni; a guard az auth-képernyőt
      // mutatja, ami konfig-hiányt jelez
      set({ hydrated: true, configured: false });
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      let session = data.session;
      // 🔄 A tárolt session SZÁRMAZHAT egy MÁSIK backendről (pl. DEV→PROD váltás után
      // a lokális Supabase tokenje) — a prod ELUTASÍTJA, és az írások némán `anon`-ként
      // futnának (RLS-hiba a megosztásnál). Ezért a szerveren validáljuk: érvénytelen
      // auth (401/403) → kijelentkezés, hogy tiszta prod-session-nel lehessen belépni.
      if (session) {
        const { error } = await supabase.auth.getUser();
        if (error && (error.status === 401 || error.status === 403)) {
          await supabase.auth.signOut().catch(() => {});
          session = null;
        }
      }
      set({ session, user: session?.user ?? null });
      // 🔐 app-újraindításkor: ha a tárolt session aal1, de MFA kell (félbehagyott
      // belépés) → függőben marad, a guard nem enged tovább a TOTP-ig
      set({ mfaPending: session ? await loginNeedsMfa() : false });
      // 💳 Pro-szint szinkronja a bejelentkezett userhez (offline-cache + Supabase)
      void useEntitlement.getState().syncFromUser(session?.user?.id ?? null);
      void useRoles.getState().refresh(); // 🛡️ governance-jogok betöltése
      // már bejelentkezett user: aktuális eszköz frissítése (last_seen + adatok)
      if (session?.user) {
        void registerCurrentDevice(session.user.id);
      }
    } catch {
      // best-effort; session nélkül indulunk (auth-képernyő)
    }
    // változás-figyelő (login/logout/token-refresh) — csak egyszer iratkozunk fel
    if (!subscribed) {
      subscribed = true;
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null });
        // 🔐 MFA-függőség újraszámolása auth-váltáskor (logout → false)
        if (session) {
          void loginNeedsMfa().then((p) => set({ mfaPending: p }));
        } else {
          set({ mfaPending: false });
        }
        // 💳 minden auth-váltásnál újraszinkron: login → user szintje, logout → Free
        void useEntitlement.getState().syncFromUser(session?.user?.id ?? null);
        void useRoles.getState().refresh(); // 🛡️ jogok újratöltése auth-váltáskor
      });
    }
    set({ hydrated: true });
  },

  signUp: async (email, password, profile) => {
    if (!supabase) {
      return { error: t('auth.errors.notConfigured') };
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
      return { error: t('auth.errors.notConfigured') };
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
        // 🛡️ Enumeration-védelem (08 §B): ismeretlen felhasználónév/telefon ne
        // legyen megkülönböztethető a rossz jelszótól — EGYSÉGES „hibás belépés"
        // üzenet (a nyers „nincs ilyen user" elárulná, hogy létezik-e a fiók).
        return { error: t('auth.errors.invalidCredentials') };
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
    // 🔐 MFA: ha a usernek van verifikált TOTP-faktora, a session még csak aal1 →
    // a belépés a TOTP-challenge teljesítéséig FÜGGŐBEN marad (a guard nem enged
    // tovább). MFA-faktor nélkül `pending` mindig false → a flow a korábbival azonos.
    const pending = await loginNeedsMfa();
    set({ mfaPending: pending });
    if (pending) {
      return { needsMfa: true };
    }
    if (data.user) {
      void registerCurrentDevice(data.user.id);
    }
    return {};
  },

  signUpWithPhone: async (phone, password, profile) => {
    if (!supabase) {
      return { error: t('auth.errors.notConfigured') };
    }
    // E.164 + országkód-kapu MÁR a hálózat előtt: az SMS valódi pénz (előre
    // fizetett Brevo-kredit), a hook szerver-oldalon is ellenőrzi ugyanezt.
    const e164 = normalizeE164(phone);
    if (!e164) {
      return { error: t('auth.errors.invalidPhone') };
    }
    if (!isAllowedPhone(e164)) {
      return { error: t('auth.errors.phoneCountryUnsupported') };
    }
    const { data, error } = await supabase.auth.signUp({
      phone: e164,
      password,
      options: {
        data: {
          full_name: profile.fullName.trim(),
          username: profile.username.trim(),
          phone: e164,
          birthday: profile.birthday.trim(),
          country: profile.country.trim(),
          city: profile.city.trim(),
          consent_version: CONSENT_VERSION,
        },
      },
    });
    if (error) {
      return { error: messageOf(error) };
    }
    // telefonos úton alapból NINCS azonnali session → jön az SMS-kód
    if (!data.session) {
      return { needsSmsOtp: true, phone: e164 };
    }
    if (data.user) {
      void registerCurrentDevice(data.user.id);
    }
    return {};
  },

  verifyPhoneOtp: async (phone, token) => {
    if (!supabase) {
      return { error: t('auth.errors.notConfigured') };
    }
    const e164 = normalizeE164(phone);
    if (!e164) {
      return { error: t('auth.errors.invalidPhone') };
    }
    const code = token.replace(/\D/g, '');
    if (!isValidOtp(code)) {
      return { error: t('auth.errors.otpLength') };
    }
    const { data, error } = await supabase.auth.verifyOtp({
      phone: e164,
      token: code,
      type: 'sms',
    });
    if (error) {
      return { error: messageOf(error) };
    }
    if (data.user) {
      void registerCurrentDevice(data.user.id);
    }
    return {};
  },

  resendPhoneOtp: async (phone) => {
    if (!supabase) {
      return { error: t('auth.errors.notConfigured') };
    }
    const e164 = normalizeE164(phone);
    if (!e164 || !isAllowedPhone(e164)) {
      return { error: t('auth.errors.invalidPhone') };
    }
    const { error } = await supabase.auth.resend({ type: 'sms', phone: e164 });
    if (error) {
      return { error: messageOf(error) };
    }
    return { needsSmsOtp: true, phone: e164 };
  },

  resendEmailConfirm: async (email) => {
    if (!supabase) {
      return { error: t('auth.errors.notConfigured') };
    }
    const addr = email.trim();
    if (!addr.includes('@')) {
      return { error: t('auth.errors.invalidEmail') };
    }
    const { error } = await supabase.auth.resend({ type: 'signup', email: addr });
    if (error) {
      return { error: messageOf(error) };
    }
    return { needsEmailConfirm: true };
  },

  verifyMfaLogin: async (code) => {
    if (!supabase) {
      return { error: t('auth.errors.notConfigured') };
    }
    try {
      await verifyLoginTotp(code);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    // sikeres TOTP → a session aal2, a belépés befejezve
    set({ mfaPending: await loginNeedsMfa() });
    const uid = get().user?.id;
    if (uid) {
      void registerCurrentDevice(uid);
    }
    return {};
  },

  signOutOtherSessions: async () => {
    if (!supabase) {
      return { error: t('auth.errors.notConfigured') };
    }
    // a Supabase szerver-oldalon visszavonja a TÖBBI eszköz refresh-tokenjeit
    // (ez az eszköz bejelentkezve marad)
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    if (error) {
      return { error: messageOf(error) };
    }
    // a többi eszköz sorának takarítása a user_devices-ből (best-effort)
    try {
      const uid = get().user?.id;
      const fingerprint = await getInstallId();
      if (uid) {
        await supabase.from('user_devices').delete().eq('user_id', uid).neq('fingerprint', fingerprint);
      }
    } catch {
      // best-effort; a token-visszavonás a lényeg, a telemetria-sor másodlagos
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
