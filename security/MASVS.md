# 📱 ReMix — OWASP MASVS baseline (mobil biztonsági checklist)

> Forrás-terv: [devs/tasks/remix/13](../devs/tasks/remix/13-mobile-network-hardening.md) (§29 permission, §30 network, §33 MASVS).
> Formátum: `STATUS: PASS / PARTIAL / FAIL / N/A — EVIDENCE: <fájl:sor> — TEST/NOTE`.
> Ez a go-live mobil-biztonsági kontroll-baseline; a kód-horgonyok a valóságból.

A MASVS a mobil biztonságot kontroll-csoportokba rendezi. Jelen állapot (2026-10-03):

## STORAGE — **PASS/PARTIAL**
- A session (access + **refresh** token) a **Keychain/Keystore** mögött, nem sima
  AsyncStorage-ban. `STATUS: PASS · EVIDENCE: src/lib/supabase.ts (secureStorage, ~L56) + src/lib/secureStorage.ts`
- A projekt-draftok AsyncStorage-ban (nem titok). `STATUS: N/A`
- Külső tár-provider OAuth-tokenek a WORKEREN maradnak, a kliens sosem látja.
  `STATUS: PASS · EVIDENCE: server/userStorage.js, server/storage.js (auth-proxy)`

## CRYPTO — **PARTIAL**
- A titkosítást a platform (Keychain/Keystore) + a TLS adja; saját kripto nincs.
  `STATUS: PASS · NOTE: nincs házi kripto (helyes)`
- Jelszó-hash: a Supabase/GoTrue oldalán (szerver). `STATUS: N/A (kliens)`

## AUTH — **PARTIAL**
- Supabase Auth (e-mail/felhasználónév/telefon), token-refresh, worker-oldali
  `getUser(token)` verifikáció. `STATUS: PASS · EVIDENCE: src/store/authStore.ts, server/auth.js`
- Erős regisztrációs jelszó (12+). `STATUS: PASS · EVIDENCE: src/lib/accountValidation.ts isStrongPassword (08)`
- Szerver-hiteles Pro-kapu (a kliens nem dönt). `STATUS: PASS · EVIDENCE: server/billing.js isPro`
- **Hátra (F):** MFA/passkey, breached-password (HIBP), re-auth érzékeny műveletre
  (a `secure_password_change=true` config megvan), anti-enumeration a login-feloldáson.
  `STATUS: FAIL/PARTIAL`

## NETWORK — **PASS (kód-szinten)**
- **Prod: csak HTTPS + nem-loopback** — kód-szinten kikényszerítve.
  `STATUS: PASS · EVIDENCE: src/lib/backend.ts assertSecureUrl (L73) + src/lib/envConfig.ts isLoopbackHost (L16), resolvePublicUrl (prod+loopback → nincs config)`
- Worker SSRF-védelem (remote fetch). `STATUS: PASS · EVIDENCE: server/ssrf.js assertSafeUrl/safeFetch (04)`
- iOS ATS: `NSAllowsLocalNetworking: true` a DEV LAN-workerhez.
  `STATUS: PARTIAL · NOTE: prodban használatlan (az app a HTTPS-felhőre megy); a tiszta megoldás app.config.js-szel build-profilonként kapcsolni — natív build szükséges a verifikációhoz.` `app.json L19-21`
- Certificate pinning: **N/A** (a threat-model nem indokolja; Supabase/CDN rotáló cert).

## PLATFORM — **PARTIAL**
- iOS usage-description-ök + Android runtime-permissionök deklaráltak.
  `EVIDENCE: app.json (ios.infoPlist, android.permissions)`
- **Permission-minimalizálás (§29) — HÁTRA (natív build kell a verifikációhoz):**
  az `android.permissions` tartalmazza a **legacy** `READ_EXTERNAL_STORAGE` +
  `WRITE_EXTERNAL_STORAGE`-ot. Android 13+ (API 33+) ezeket a `READ_MEDIA_*`
  váltja ki; a `WRITE_EXTERNAL_STORAGE` API 29+ alatt ignorált (scoped storage).
  - Javaslat: **`WRITE_EXTERNAL_STORAGE` eltávolítása** (API 29+ ignorálja; az
    expo-media-library scoped MediaStore-t használ). `READ_EXTERNAL_STORAGE`
    csak <13-as eszközök média-pickeréhez kell — ott a `READ_MEDIA_*` + a
    rendszer-photo-picker a modern út.
  - ⚠️ A változtatás **natív buildet + eszköz-tesztet** igényel (média-import
    Android 10/12/13/14-en) — ezért nem vakon módosítjuk az app.json-t.
  `STATUS: PARTIAL`
- Deep-link / exported component felület: expo-router scheme `remix`. `STATUS: PARTIAL · NOTE: deep-link-validáció külön`

## CODE — **PASS/PARTIAL**
- TypeScript strict + `npm run audit` (tsc + expo lint + jest) merge-kapu.
  `STATUS: PASS · EVIDENCE: package.json, .github/workflows/ci.yml`
- CI security-gate (npm audit critical + secret-scan). `STATUS: PASS · EVIDENCE: ci.yml security job (12)`
- Dependency-vuln: 19 tranzitív (expo) high/moderate triage. `STATUS: PARTIAL (J)`

## RESILIENCE — **FAIL/PARTIAL**
- Anti-tamper / root-jailbreak detektálás, kód-obfuszkáció: **nincs**.
  `STATUS: FAIL · NOTE: a reális szintet a threat-model döntse el; a session Keychain/Keystore mögött van (alap-védelem). Consumer-app → jellemzően alacsony RESILIENCE-prioritás, de a billing/Pro-kapu szerver-oldali, így a kliens-tamper nem ad ingyen Pro-t.`

## PRIVACY — **PARTIAL**
- GDPR consent (verziózott, auditált) + privacy/terms doksik + export + soft-delete
  + **hard-erasure** (storage+auth). `STATUS: PASS · EVIDENCE: migrations gdpr_consent/soft_delete, src/lib/account.ts exportMyData, server/security/accountErase.js (09)`
- Adat-export privacy-manifest az app.json-ban. `STATUS: PASS · EVIDENCE: app.json ios.privacyManifests`
- **Adatminimalizálás (§25) — HÁTRA:** a `user_devices.raw jsonb` (nyers mezők)
  elhagyása. `STATUS: PARTIAL (F)`

---

## Összegzés — go-live előtt kötelező (MASVS-szempontból)
| Csoport | Állapot | Fő teendő |
| --- | --- | --- |
| STORAGE | 🟢 | — |
| CRYPTO | 🟢 | — |
| AUTH | 🟡 | MFA/breached-check/anti-enum (F) |
| NETWORK | 🟢 | (opcionális) NSAllowsLocalNetworking build-profilonként |
| PLATFORM | 🟡 | permission-minimalizálás (natív build-bel verifikálva) |
| CODE | 🟢 | dependency-triage (J) |
| RESILIENCE | 🔴 | threat-model-döntés a szintről |
| PRIVACY | 🟡 | user_devices.raw adatminimalizálás (F) |

> A kód-szintű hardening (storage/network/auth/privacy-erasure) **nagyrészt kész**;
> a maradék natív-build-függő (permission, RESILIENCE) vagy szerver/dashboard (MFA).
