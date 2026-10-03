# 🛡️ ReMix — Production & Security fejlesztési terv (index)

> **Forrás-audit:** [devs/source/remix.md](../../source/remix.md) — a `main` statikus kód-auditja (struktúra, worker-API, Supabase/RLS, auth, billing, storage, AI, CI/CD, security).
> **Testvér-tervek (funkcionális):** [VIDEO.md](../VIDEO.md) · [AUDIO.md](../AUDIO.md) · [IMAGE.md](../IMAGE.md) · [NATIVE.md](../NATIVE.md) · [PROD.md](../PROD.md) · [MISSING.md](../MISSING.md).
> **Ez a mappa:** a security + production-readiness backlog **feladatokra bontva, számozott fájlokban**. Minden fájl egy önálló, szállítható epik: kontextus → jelenlegi állapot (bizonyítékkal) → megoldás → feladatlista → „Kész, ha” → teszt.

---

## 0. Miért létezik ez a terv?

Az audit egyetlen mondatban: **a ReMix funkcionálisan már túl van egy klasszikus MVP-n, de a *publikus production app + nyilvános worker-API* kombináció miatt a security-perimeter nincs kész.** A következő nagy lépés nem feature, hanem:

> **security + authorization + resource governance + production infrastructure** — különösen a worker körül.

A funkcionális hiányokat (video/audio/image/social/AI feature-ök — audit §39) **szándékosan NEM ez a terv fedi**, mert azok már a testvér-tervekben élnek. Ez a mappa a **kockázat-vezérelt** réteg: P0 (go-live blokkoló) → P1 (release előtt) → P2 (professzionális platform).

### ⚠️ A terv a `main`-audit, a munka a `studio-social` ágon
A forrás-audit a `main`-t nézte; ez a terv viszont a **jelenlegi `studio-social` ág valós kódját** ellenőrizte le, és csak a **tényleges maradékot** célozza. Ahol az audit óta már történt előrelépés, ott a fájl külön jelzi (pl. `server/ssrf.js`, `server/quota.js`, `server/auth.js` már léteznek — de nincsenek mindenhol bekötve).

---

## 1. Audit-összkép (kiindulás)

| Terület | Audit | Megjegyzés |
| --- | --- | --- |
| Editor / render-mag | 🟢 | Erős alap, marad |
| Supabase DB / RLS | 🟢 | Valódi RLS — jó alap, de storage-policy túl széles |
| **API security** | 🔴 | Legfontosabb javítandó → [01](./01-worker-auth-policy.md) |
| **Upload security** | 🔴 | Túl sok unrestricted multipart → [02](./02-upload-security.md) |
| **Rate limiting** | 🔴 | Nincs valódi rate-limit réteg → [03](./03-rate-limiting.md) |
| **SSRF** | 🔴 | WebDAV/S3/URL-import miatt kritikus → [04](./04-ssrf-protection.md) |
| **Storage authz** | 🔴 | Bucket-szintű, nem path-alapú → [05](./05-storage-security.md) |
| **AI security** | 🟡 | Sok endpoint, hardening kell → [06](./06-ai-endpoint-security.md) |
| **Render authz (BOLA)** | 🔴 | `/render/:id[/file]` nyitott → [07](./07-render-authorization.md) |
| Authentication | 🟡 | Jó irány, MFA/verify/password hiányzik → [08](./08-auth-hardening.md) |
| Privacy / GDPR | 🟡 | Soft-delete ≠ törlés → [09](./09-account-lifecycle-gdpr.md) |
| Messaging | 🟡 | Block/mute/report hiányzik → [10](./10-messaging-moderation.md) |
| Billing webhook | 🟡 | Replay/idempotency hiányzik → [11](./11-billing-webhook-hardening.md) |
| Dependency / CI security | 🔴 | Nincs security-gate → [12](./12-cicd-supply-chain.md) |
| Mobile / network / Expo | 🟡 | MASVS + permission-minimalizálás → [13](./13-mobile-network-hardening.md) |
| Security-standard compliance | 🔴 | Nincs verifikált baseline → [14](./14-security-baseline-docs.md) |
| Architektúra-evolúció | — | API-gateway + queue-szeparáció → [15](./15-target-architecture.md) |
| Trust & Safety | — | DRM/moderáció/anti-abuse → [16](./16-trust-safety-p2.md) |

Becsült készültség (az audit §40 alapján — **nem hivatalos pontszám**):

```text
PRODUCT CORE      ████████░░  ~80%
EDITOR            ████████░░  ~80%
SOCIAL            ██████░░░░  ~65%
AI                ██████░░░░  ~65%
BACKEND           ███████░░░  ~70%
PRODUCTION INFRA  █████░░░░░  ~50%   ← ez a terv célja
SECURITY          █████░░░░░  ~50%   ← ez a terv célja
COMPLIANCE        ████░░░░░░  ~40%   ← ez a terv célja
```

---

## 2. Prioritás-modell és a feladatfájlok

**Jelölés:** 🔴 P0 = production/go-live blokkoló · 🟠 P1 = release előtt · 🟡 P2 = professzionális platform · 🔧 = kereszt-réteg (infra/governance).

| # | Fájl | Prioritás | Audit-szekció | Egymondatos cél |
| --- | --- | --- | --- | --- |
| 01 | [worker-auth-policy](./01-worker-auth-policy.md) | 🔴 P0 | §6, §15, §16, §34.1, §31 | Minden worker-endpoint **explicit policy** mögé (`public/authenticated/pro/owner/…`) + API-inventory |
| 02 | [upload-security](./02-upload-security.md) | 🔴 P0 | §7, §34.2 | Egyetlen `mediaUpload()` MediaSecurityPolicy pipeline (típus/MIME/méret/duration/codec/izoláció) |
| 03 | [rate-limiting](./03-rate-limiting.md) | 🔴 P0 | §8, §34.3 | Redis-alapú rate-limit endpoint-osztályonként (IP/user/device/subscription) |
| 04 | [ssrf-protection](./04-ssrf-protection.md) | 🔴 P0 | §9, §19, §34.4 | Remote-fetch allowlist + metadata-IP tiltás + DNS-rebinding — **storage/youtube/aiConfig** bekötve |
| 05 | [storage-security](./05-storage-security.md) | 🔴 P0 | §10, §11, §34.5, §34.6 | Path-alapú RLS ownership + private/public bucket-újratervezés + signed URL |
| 06 | [ai-endpoint-security](./06-ai-endpoint-security.md) | 🔴 P0 | §18, §19, §34.7 | AI endpoint auth/quota/provider-allowlist + **AI ≠ authorization boundary** (command policy engine) |
| 07 | [render-authorization](./07-render-authorization.md) | 🔴 P0 | §5, §34.8 | Render-job **ownership** (BOLA): `job.user_id === auth.uid()` a status/file endpointon |
| 08 | [auth-hardening](./08-auth-hardening.md) | 🟠 P1 | §12, §13, §14 | MFA/passkey, email-verify, password-policy (12+), session-mgmt, enumeration-védelem |
| 09 | [account-lifecycle-gdpr](./09-account-lifecycle-gdpr.md) | 🟠 P1 | §24, §25 | Valódi account-deletion pipeline + adat-export + retention + adatminimalizálás |
| 10 | [messaging-moderation](./10-messaging-moderation.md) | 🟠 P1 | §23 | Block/mute/report, attachment-security, spam-throttling, moderation-tooling |
| 11 | [billing-webhook-hardening](./11-billing-webhook-hardening.md) | 🟠 P1 | §17 | Webhook idempotency + replay-protection + event-audit + atomic entitlement |
| 12 | [cicd-supply-chain](./12-cicd-supply-chain.md) | 🟠 P1 | §26, §27, §28 | CI security-gate: SAST/SCA/secret-scan/SBOM/CodeQL/Semgrep |
| 13 | [mobile-network-hardening](./13-mobile-network-hardening.md) | 🟠 P1 | §29, §30, §33 | MASVS baseline, permission-minimalizálás, network-profil, App Store readiness |
| 14 | [security-baseline-docs](./14-security-baseline-docs.md) | 🔧 | §32, §41, §22 | `security/` doksik (SECURITY/THREAT-MODEL/ASVS/MASVS/IR) + audit-log + security-event infra |
| 15 | [target-architecture](./15-target-architecture.md) | 🟡 P2 | §20, §37 | API-gateway + queue-szétválasztás + MCP boundary |
| 16 | [trust-safety-p2](./16-trust-safety-p2.md) | 🟡 P2 | §36 | DRM/watermark/fingerprint/moderation-queue/appeals/anti-bot/creator-verify |

---

## 3. Ajánlott végrehajtási sorrend (függőségek)

A P0 fájlok **részben egymásra épülnek** — a policy-réteg ([01](./01-worker-auth-policy.md)) az alap, amelyre a többi ráköt:

```text
                    ┌──────────────────────────────┐
                    │ 01 · Endpoint policy-réteg    │  ← ELŐSZÖR (a többi erre ül)
                    │   server/security/authorization.js │
                    └───────────────┬──────────────┘
        ┌───────────────┬───────────┼───────────────┬───────────────┐
        ▼               ▼           ▼               ▼               ▼
   02 · upload    03 · rate-limit  04 · SSRF    06 · AI-endpoint  07 · render authz
   mediaUpload()  rateLimit()      ssrfPolicy() quota+allowlist   job ownership
        │               │           │               │               │
        └───────────────┴───────────┴───────────────┴───────────────┘
                                    │
                    05 · storage (RLS + bucket redesign)  ← Supabase-oldal, párhuzam
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
   08 auth-hardening         09 GDPR / lifecycle          10 messaging-safety
   11 billing-webhook        12 CI security-gate          13 mobile/network
                                    │
                    14 · security baseline docs + audit-log (kereszt, folyamatos)
                                    │
                    15 · target architecture  →  16 · trust & safety   (P2)
```

**Konkrét sprint-javaslat:**

1. **Sprint P0-a (perimeter):** [01](./01-worker-auth-policy.md) policy-réteg + [07](./07-render-authorization.md) render-BOLA → azonnal bezárja a legnagyobb rést (nyitott compute + más renderjének letöltése).
2. **Sprint P0-b (resource governance):** [02](./02-upload-security.md) upload + [03](./03-rate-limiting.md) rate-limit + [04](./04-ssrf-protection.md) SSRF → DoS/költség-attack felület bezárása.
3. **Sprint P0-c (data safety):** [05](./05-storage-security.md) bucket/RLS + [06](./06-ai-endpoint-security.md) AI-policy → adat- és AI-perimeter.
4. **Sprint P1:** [08](./08-auth-hardening.md)–[13](./13-mobile-network-hardening.md) párhuzamosítható; [14](./14-security-baseline-docs.md) végig fut.
5. **P2:** [15](./15-target-architecture.md)–[16](./16-trust-safety-p2.md) a skálázódás fázisában.

---

## 4. Cél-architektúra (az audit §37 nyomán)

A mai worker lényegében közvetlen `Mobile → Express → {FFmpeg, AI, Storage}`. A cél (részletek: [15](./15-target-architecture.md)):

```text
  Mobile ─► API Gateway ─► Auth ─► Rate-Limit ─► Authorization ─► Quota/Billing
                                      │
                              ┌───────▼────────┐
                              │ Command / API  │
                              └───────┬────────┘
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              Render Queue        AI Queue         Media Queue
                    ▼                 ▼                 ▼
                Workers          AI Workers       Media Workers
                    └─────────────────┼─────────────────┘
                                      ▼
                              Object Store ─► CDN
```

A P0 munka ennek az **első három rétegét** (Auth · Rate-Limit · Authorization) építi meg `server/security/` alatt, endpoint-szintű policy-jelöléssel — a queue-szétválasztás P2.

---

## 5. Közös vezérelvek (minden feladatra)

- **`server/security/` kap egy dedikált policy-réteget.** A cél-modulok (az audit §41 nyomán): `authorization.js` · `rateLimit.js` · `uploadPolicy.js` · `ssrfPolicy.js` · `mediaPolicy.js` · `quota.js` (van) · `auditLog.js` · `securityHeaders.js`. Minden endpoint **explicit** policy-t kap — nincs „alapból nyitott”.
- **AI ≠ authorization boundary.** Az AI csak **command-generátor**; a jogosultságot mindig determinisztikus policy-engine dönti el (illeszkedik a repo meglévő command-bus filozófiájához — [AGENTS.md](../../../AGENTS.md)).
- **A kliens sosem authoritatív.** Pro-státusz, credit, ownership mind server-side (ez már így van a billingnél — ne törjük meg).
- **Minden security-változás tesztelhető.** Új teszt: `server/**/*.test.js` (worker) vagy `src/**/*.test.ts` (kliens); a `server/ssrf.test.js` + `server/billing.test.js` már mintát ad. Ellenőrzés: `npm run audit`.
- **Nincs regresszió a free/on-device rétegen.** A security-hardening **nem** kapuzhat Pro mögé eddig-ingyen, on-device funkciót (lásd [free-vs-pro](../../../CLAUDE.md) modell) — az auth ≠ paywall.
- **Bizonyíték-alapú „Kész”.** Statikus audit nem elég: minden P0-nak van futtatható/verifikálható elfogadási kritériuma (§ „Kész, ha”).

---

## 6. Standard-hivatkozás

- **Backend/API:** OWASP **ASVS 5.0** kontroll-baseline → [14](./14-security-baseline-docs.md) `ASVS-5.0.md` checklist.
- **API-kockázatok:** OWASP **API Security Top 10 (2023)** — API4 (resource consumption), API6 (sensitive business flow), API7 (SSRF), API9 (inventory) a fő gócok.
- **Mobil:** OWASP **MASVS** → [13](./13-mobile-network-hardening.md).
- **Upload:** OWASP **File Upload Cheat Sheet** → [02](./02-upload-security.md).

> A checklist-fájlok formátuma: `V<kontroll-id> — STATUS: PASS/PARTIAL/FAIL/N/A — EVIDENCE: <fájl:sor> — TEST: <hogyan>`.
