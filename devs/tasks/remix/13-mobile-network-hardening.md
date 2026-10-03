# 🟠 13. Mobil, network & Expo hardening (MASVS) — P1

> **Forrás:** [remix.md](../../source/remix.md) §29 (Expo-config / permissions), §30 (network-security), §33 (MASVS).
> **Érintett kód:** [app.json](../../../app.json) · [eas.json](../../../eas.json) · `.env.{development,production}` · [src/lib/supabase.ts](../../../src/lib/supabase.ts).

---

## 0. Kontextus & cél

Az `app.json` már komoly (iOS/Android permissions, privacy-manifest, secure-store, typed-routes, React Compiler). A kliens secure-storage-a helyes (Keychain/Keystore, [supabase.ts](../../../src/lib/supabase.ts)). **A production-hardening hiányzik:** túl sok Android-permission, dev-network-engedmények a prod-buildben, és nincs verifikált MASVS-baseline.

**Cél:** OWASP **MASVS**-baseline; permission-minimalizálás; környezet-szeparált network-config (dev/preview/prod); App Store release-grade beállítások.

---

## 1. Jelenlegi állapot (bizonyíték)
- 🟢 Privacy-manifest, secure-store, Keychain/Keystore session-tárolás.
- 🟡 Android-permissionök bővek: `READ/WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_AUDIO/IMAGES/VIDEO`, `READ_MEDIA_VISUAL_USER_SELECTED` — prod-minimalizálás kell.
- 🟡 `NSAllowsLocalNetworking` (dev-hez érthető) — **prod-buildben tiltandó**; nincs külön network-profil dev/preview/prod.
- MASVS-önértékelés (audit §33): STORAGE 🟢/🟡, CRYPTO 🟡, AUTH 🟡, NETWORK 🟡, PLATFORM 🟡, CODE 🟢/🟡, **RESILIENCE 🔴**, PRIVACY 🟡.

---

## 2. Megoldás

### 2.1 Permission-minimalizálás
- Az Android-media-permissionöket a tényleges használathoz szűkíteni (Android 13+ scoped-media + `READ_MEDIA_VISUAL_USER_SELECTED` a photo-pickerhez); a `WRITE_EXTERNAL_STORAGE` elhagyása modern API-szinten.
- iOS: csak a valóban használt usage-description-ök.

### 2.2 Network-profil (dev/preview/prod)
- **Prod:** HTTPS-only, TLS, **nincs** `NSAllowsLocalNetworking`, nincs localhost/LAN-worker, nincs HTTP.
- **Dev/preview:** a jelenlegi engedmények maradnak (a [eas.json](../../../eas.json) profilokhoz kötve).
- Certificate-pinning **csak ha** a threat-model indokolja (nem alap).

### 2.3 MASVS-resilience (a 🔴 pont)
- Alapszintű anti-tamper/roots-jailbreak-tudatosság a session-védelemhez (a Keychain/Keystore már jó irány); a resilience-kontrollok dokumentálása és a reális szint kiválasztása a threat-modellben ([14](./14-security-baseline-docs.md) `MASVS.md`).

### 2.4 App Store readiness
- Privacy-manifest + adat-gyűjtés-nyilatkozat konzisztens a tényleges adatkezeléssel ([09](./09-account-lifecycle-gdpr.md)).
- Debug-artefaktok / verbose-logok kikapcsolása prod-buildben.

---

## 3. Feladatok
### 🟦 Fázis A — Permissions & network
- [ ] Android-permissionök szűkítése az `app.json`-ban; iOS usage-description audit.
- [ ] Network-profilok: prod HTTPS-only, `NSAllowsLocalNetworking` csak dev/preview; env-szeparáció ([eas.json](../../../eas.json)).

### 🟦 Fázis B — MASVS baseline
- [ ] `security/MASVS.md` checklist ([14](./14-security-baseline-docs.md)) kitöltése (STORAGE/CRYPTO/AUTH/NETWORK/PLATFORM/CODE/RESILIENCE/PRIVACY) STATUS+EVIDENCE-szel.
- [ ] RESILIENCE reális szint kiválasztása + a minimum kontrollok bekötése.

### 🟦 Fázis C — Release
- [ ] Prod-build: debug-log kikapcsolás, privacy-manifest ↔ tényleges adatkezelés konzisztencia.
- [ ] `/verify` prod-profilú buildel: nincs localhost/HTTP-hívás.

---

## 4. Kész, ha
- [ ] Prod-build **nem** tartalmaz `NSAllowsLocalNetworking`-et és nem hív HTTP/LAN-t.
- [ ] Az Android-permission-lista a ténylegesen használtakra szűkül.
- [ ] `MASVS.md` minden csoportra PASS/PARTIAL/FAIL + evidence.
- [ ] Az App Store adat-nyilatkozat egyezik a valós adatkezeléssel.

## 5. Teszt & ellenőrzés
- Prod-profilú build hálózati forgalmának ellenőrzése (`/verify`).
- `app.json` diff-review a permission-listára.

## 6. Kockázat / függőség
- **Dev-workflow:** a LAN-worker fejlesztéshez kell — a szeparáció úgy készüljön, hogy dev-ben megmaradjon ([dev-stack-needs-render-worker]).
- **Függőség:** [08](./08-auth-hardening.md) (CRYPTO/AUTH), [09](./09-account-lifecycle-gdpr.md) (PRIVACY), [14](./14-security-baseline-docs.md) (MASVS-checklist).
