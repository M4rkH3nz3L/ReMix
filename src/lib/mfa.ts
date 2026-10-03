import { requireSupabase, supabase } from '@/lib/supabase';

/**
 * 🔐 MFA (TOTP) — kétlépcsős hitelesítés a Supabase GoTrue MFA-API-ján.
 *
 * ⚠️ ÉLES bekapcsolás előtt: (1) a Supabase-projektben engedélyezni kell az MFA-t
 * (Auth → MFA), (2) valódi authenticator-appal (Google Authenticator / 1Password
 * stb.) eszközön le kell tesztelni az enroll + login-challenge folyamatot. A
 * kód additív és opt-in: a login AAL-ellenőrzése CSAK annak kér TOTP-t, akinek már
 * van verifikált faktora — a többi userre nincs hatása.
 */

export interface TotpEnrollment {
  factorId: string;
  /** `otpauth://…` URI — ezt olvassa be az authenticator-app (QR nélkül is beírható) */
  uri: string;
  /** a nyers titkos kulcs (manuális beírásra) */
  secret: string;
}

export interface MfaFactor {
  id: string;
  friendlyName: string | null;
  status: 'verified' | 'unverified';
  createdAt: string;
}

/** Van-e MFA-képesség (konfigurált Supabase). */
export function mfaAvailable(): boolean {
  return supabase != null;
}

/** Új TOTP-faktor felvétele (még NEM aktív — a `confirmTotp` erősíti meg a kóddal). */
export async function enrollTotp(friendlyName = 'ReMix'): Promise<TotpEnrollment> {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error || !data) {
    throw new Error(error?.message ?? 'MFA enroll sikertelen.');
  }
  return { factorId: data.id, uri: data.totp.uri, secret: data.totp.secret };
}

/** Az enroll megerősítése a user által beírt 6 jegyű kóddal → a faktor `verified`. */
export async function confirmTotp(factorId: string, code: string): Promise<void> {
  const sb = requireSupabase();
  const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId });
  if (chErr || !ch) {
    throw new Error(chErr?.message ?? 'MFA challenge sikertelen.');
  }
  const { error } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
  if (error) {
    throw new Error(error.message);
  }
}

/** A user TOTP-faktorai (a beállítás-képernyőhöz). */
export async function listTotpFactors(): Promise<MfaFactor[]> {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) {
    throw new Error(error.message);
  }
  return (data?.totp ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    status: f.status,
    createdAt: f.created_at,
  }));
}

/** Faktor eltávolítása (MFA kikapcsolása az adott faktorra). */
export async function removeFactor(factorId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Kell-e a login befejezéséhez TOTP? Igaz, ha a user AAL-szintje aal1, de a
 * (verifikált faktor miatt) elvárt szint aal2. MFA nélküli usernél mindig false.
 */
export async function loginNeedsMfa(): Promise<boolean> {
  if (!supabase) {
    return false;
  }
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) {
      return false;
    }
    return data.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel;
  } catch {
    return false;
  }
}

/** A login-kori TOTP-challenge teljesítése (az első verifikált faktorral). */
export async function verifyLoginTotp(code: string): Promise<void> {
  const sb = requireSupabase();
  const { data: factors, error: listErr } = await sb.auth.mfa.listFactors();
  if (listErr) {
    throw new Error(listErr.message);
  }
  const factor = (factors?.totp ?? []).find((f) => f.status === 'verified') ?? factors?.totp?.[0];
  if (!factor) {
    throw new Error('Nincs beállított TOTP-faktor.');
  }
  const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: factor.id });
  if (chErr || !ch) {
    throw new Error(chErr?.message ?? 'MFA challenge sikertelen.');
  }
  const { error } = await sb.auth.mfa.verify({ factorId: factor.id, challengeId: ch.id, code: code.trim() });
  if (error) {
    throw new Error(error.message);
  }
}
