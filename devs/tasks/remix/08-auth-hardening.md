# 🟠 08. Authentication hardening — P1

> **Forrás:** [remix.md](../../source/remix.md) §12 (auth), §13 (password policy), §14 (login-identifier / enumeration).
> **Érintett kód:** [src/lib/supabase.ts](../../../src/lib/supabase.ts) · Supabase `config.toml` · `resolve_login_email()` / `username_available()` RPC-k · [server/auth.js](../../../server/auth.js).

---

## 0. Kontextus & cél

Az auth **jó irányban** van: Supabase Auth, Keychain/Keystore secure storage ([supabase.ts:56](../../../src/lib/supabase.ts#L56)), token-refresh, `getUser(token)` worker-oldalon, CORS-allowlist. **A production-policy-k hiányoznak.**

**Cél:** production-grade auth-policy: erős jelszó, email-verifikáció, MFA/passkey, session-menedzsment, és enumeration-védelem a username/phone-login körül.

---

## 1. Jelenlegi állapot (bizonyíték)

Supabase `config.toml`:
```text
minimum_password_length = 6      # ⚠️ túl gyenge consumer-prodhoz
password_requirements   = ""     # ⚠️ nincs komplexitás
enable_confirmations    = false  # ⚠️ email-verifikáció kikapcsolva (launch-döntés volt)
secure_password_change  = false  # ⚠️ nincs re-auth jelszóváltásnál
```

- 🟢 Secure storage (Keychain/Keystore) — [supabase.ts](../../../src/lib/supabase.ts).
- 🟡 `resolve_login_email()` / `username_available()` — username/phone → email feloldás → **user-enumeration** kockázat (§14).
- ❌ Nincs: MFA, passkey, device/session-management UI, revoke-all-sessions, gyanús-login detektálás, login-attempt-védelem, CAPTCHA/abuse-protection.

---

## 2. Megoldás

### 2.1 Password & email (§13)
- `minimum_password_length = 12`, `password_requirements` bekapcsolva.
- **Breached-password check** (Supabase HIBP-integráció, ha elérhető, vagy saját).
- `secure_password_change = true` + re-authentication érzékeny műveletekhez.
- `enable_confirmations = true` **production**-profilon (dev maradhat off — a [hosted-supabase-prod] szerint launchre off volt; ez a P1-es „végleges” állapot).
- Password-reset throttling.

### 2.2 MFA / passkey
- TOTP-MFA (Supabase MFA) opcionálisan, **kötelező** admin/moderator szerepekhez.
- Passkey (WebAuthn) roadmap — legalább az interfész és a session-modell készüljön fel rá.

### 2.3 Session & device management
- Aktív session/device lista a prof ilban (a `user_devices` táblát használva, de adatminimalizálva — [09](./09-account-lifecycle-gdpr.md)).
- „Revoke all sessions” + egy eszköz kiléptetése.
- Gyanús-login jelzés (új eszköz/ország) → security-event ([14](./14-security-baseline-docs.md)).

### 2.4 Anti-enumeration (§14)
A `resolve_login_email()` / `username_available()` köré:
- **Azonos válaszidő** (constant-time) és **azonos hibaüzenet** minden ágra (nincs „nincs ilyen user” vs „rossz jelszó” különbség).
- Rate-limit az `auth`-osztályban ([03](./03-rate-limiting.md)) IP + account kulcson.
- CAPTCHA/abuse-protection a login/signup-flow-n.
- Audit-logging a feloldási kísérletekről.

---

## 3. Feladatok
### 🟦 Fázis A — Config-hardening
- [ ] `config.toml`: password-length 12, requirements, `secure_password_change=true`, prod-profilon `enable_confirmations=true`.
- [x] **E-mail-megerősítő link újraküldése** — `resendEmailConfirm` (authStore) + „Resend"
      gomb a check-email képernyőn (`supabase.auth.resend type:'signup'`). *(A prod-oldali
      `enable_confirmations=true` bekapcsolása továbbra is launch-config-döntés — §6.)*
- [ ] Re-authentication érzékeny műveletekhez (jelszóváltás, email-csere, account-törlés, payout).
- [ ] Password-reset + login throttling (`auth` rate-limit osztály).

### 🟦 Fázis B — Enumeration
- [x] **Egységes login-hiba** (uniform error): az ismeretlen felhasználónév/telefon
      ugyanazt a „hibás belépés" üzenetet adja, mint a rossz jelszó (`authStore.signIn`
      → `invalidCredentials`) — nem szivárog a fiók léte. *(Hátra: valódi constant-time
      időzítés + CAPTCHA.)*
- [ ] CAPTCHA a signup/login-on (abuse-protection).

### 🟦 Fázis C — MFA & session
- [x] **TOTP-MFA alap kész** (client): `src/lib/mfa.ts` (enroll/confirm/list/remove +
      `loginNeedsMfa`/`verifyLoginTotp`), beállító-képernyő `src/app/mfa.tsx` (profil →
      „Kétlépcsős hitelesítés"), és a **login-enforcement** az `authStore.mfaPending`-en át
      (`isAuthed = session && !mfaPending`) — **opt-in, nulla hatású a faktor nélküli
      userekre** → a belépés csak verifikált TOTP-faktornál kér kódot. i18n en/hu/de.
      ⚠️ **ÉLES előtt:** (1) a Supabase-projektben MFA engedélyezése, (2) valódi
      authenticator-appal eszköz-teszt. *(Hátra: admin/moderator-hoz KÖTELEZŐVÉ tenni.)*
- [x] **Többi munkamenet kiléptetése** (revoke-all-others): `signOutOtherSessions`
      (`supabase.auth.signOut scope:'others'` + a többi `user_devices`-sor törlése) +
      gomb a profil account-szekciójában. *(Hátra: teljes eszköz-lista UI + per-eszköz revoke.)*
- [ ] Gyanús-login detektálás → security-event.

---

## 4. Kész, ha
- [ ] 6-karakteres jelszó **elutasítva**; breached jelszó figyelmeztet/tilt.
- [ ] Prod-buildben email-verifikáció kötelező; login-throttling `429` brute-force-nál.
- [ ] Username/phone-feloldás nem szivárogtat létezést (időzítés + üzenet egységes).
- [ ] Admin fiók MFA nélkül nem léphet be; user revokálhatja a sessionjeit.

## 5. Teszt & ellenőrzés
- Supabase-config diff + manuális login/verify/MFA-flow `/verify`-vel.
- `resolve_login_email` időzítés-teszt (létező vs nem-létező identifier ~azonos).

## 6. Kockázat / függőség
- **Launch-döntés:** az email-confirmation ma tudatosan off ([hosted-supabase-prod]); ezt csak a P1-fázisban kapcsoljuk prodon, kommunikációval.
- **Függőség:** [03](./03-rate-limiting.md) (`auth` osztály), [09](./09-account-lifecycle-gdpr.md) (device-adatminimalizálás), [14](./14-security-baseline-docs.md) (security-event).
