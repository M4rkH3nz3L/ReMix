# 🟡 16. Trust & Safety / content-protection — P2

> **Forrás:** [remix.md](../../source/remix.md) §36 (P2 — professzionális platform), részben §39 (social/AI feature-blokkok).
> **Előfeltétel:** a P0/P1 réteg — ez a fázis a **professzionális creator-platform** trust-rétege, nem go-live blokkoló.
> **Kapcsolódó:** [rbac-roles-permissions] (moderator/admin) · [10](./10-messaging-moderation.md) (moderation-alapok) · [social-feed-architecture].

---

## 0. Kontextus & cél

A P0/P1 után a ReMix biztonságos alap. A **professzionális platform** szintje viszont még kér egy trust & safety + content-protection réteget — ez különbözteti meg egy „jól megírt appot” egy éles creator-platformtól.

**Cél (§36):** content-protection (DRM/watermark/fingerprint/copyright), abuse-prevention (anti-bot, AI-abuse, device-reputation), és a teljes trust & safety pipeline (moderation-queue, appeals, legal-request-handling, creator-verification).

---

## 1. Terület-térkép (§36)

| Blokk | Tartalom |
| --- | --- |
| **Content protection** | DRM / signed playback (ahol kell), advanced media rights, watermarking, content-fingerprinting, copyright-workflow |
| **Abuse prevention** | abuse-detection, AI-abuse-prevention, anti-bot, device-reputation, suspicious-account-detection |
| **Trust & safety** | creator-verification, trust&safety-pipeline, content-moderation-queue, appeals, legal-request-handling |
| **Data & enterprise** | data-export-automation ([09](./09-account-lifecycle-gdpr.md) továbbfejlesztése), enterprise security-controls |

---

## 2. Megoldás (fázisos, prioritás szerint a blokkokon belül)

### 2.1 Content protection
- **Signed playback** a privát/prémium tartalomra (a signed-URL alap már [05](./05-storage-security.md)); DRM csak ha a jogi/üzleti modell megköveteli.
- **Watermarking** (látható + opcionálisan forensic) a publikált renderre — a render-pipeline-ba fűzve.
- **Content-fingerprinting** (perceptual hash) a remix-lineage + copyright-workflow-hoz (a `remixOf`/lineage-modell már létezik — [social-feed-architecture]).

### 2.2 Abuse-prevention
- **Anti-bot** (a signup/login CAPTCHA [08](./08-auth-hardening.md) kiterjesztése) + **device-reputation** (a `user_devices` adat-minimalizált verziójából — [09](./09-account-lifecycle-gdpr.md)).
- **AI-abuse-prevention:** a [06](./06-ai-endpoint-security.md) quota + policy-engine fölé anomália-detektálás.
- **Suspicious-account-detection** → a security-event-log ([14](./14-security-baseline-docs.md)) fölé.

### 2.3 Trust & safety pipeline
- **Moderation-queue** kiterjesztése ([10](./10-messaging-moderation.md)) a teljes tartalom-típusra (poszt/komment/DM/asset); **appeals**-folyamat.
- **Creator-verification** (identitás/badge — a [creator-profile-architecture] fölé).
- **Legal-request-handling** (takedown, adatkiadás) dokumentált folyamat ([14](./14-security-baseline-docs.md) INCIDENT-RESPONSE-szal összhangban).

### 2.4 DM E2E-titkosítás — stratégia (P2, csak ha a threat-model indokolja)
**Döntés:** az E2E alapból **NEM kell** — a DM ma `messages` táblában, service_role-lal
írt, RLS-sel és moderációval ([10](./10-messaging-moderation.md)) védve; a platform a
tartalomhoz fér (ez a moderáció/legal-request előfeltétele is). E2E bevezetése
**kizárja a szerver-oldali moderációt** a titkosított csatornán → ütközik a trust &
safety céllal. Ezért E2E **csak** egy dedikált, opt-in „titkos csevegés" módra, ha
jogszabály/piac megköveteli.
**Ha mégis kell (vázlat):**
- **Kulcsmodell:** eszközönkénti identitás-kulcspár (a privát kulcs az eszközön,
  `expo-secure-store`; a publikus a `user_devices`-hoz kötve); üzenet-kulcs X25519
  (ECDH) + a tartalom XChaCha20-Poly1305. Könyvtár: `libsodium` (natív, dev-build —
  illik a [NATIVE.md] vonalba).
- **Multi-device:** sender-key / per-eszköz re-encrypt; a `user_devices` már hordozza
  az eszköz-leltárt (kulcs-rotációhoz + „többi munkamenet kiléptetése"-hez, 08).
- **Hatás a meglévőkre:** a `messages.body` titkosított blob lesz → a szerver-oldali
  moderáció (DM-report tartalom) CSAK a feladó/címzett kliens-oldali report-jával megy
  (a kliens dekódol + csatol); a worker-push csak metaadatot lát.
- **Backup/elvesztés:** opcionális, jelszóból származtatott kulcs-escrow (külön döntés,
  GDPR-hatással).
**Kész, ha:** dokumentált döntés (bevezetjük-e); ha igen, külön epik a fenti vázlatból.

---

## 3. Feladatok (nagy blokkok — a fázisban tovább bontandók)
- [ ] **Content:** signed-playback prémium tartalomra · watermarking a publikált renderbe · perceptual-hash fingerprinting + copyright-workflow.
- [ ] **Abuse:** anti-bot + device-reputation · AI-abuse anomália-detektálás · suspicious-account-detektálás.
- [ ] **Trust&safety:** teljes moderation-queue + appeals · creator-verification · legal-request-folyamat.
- [ ] **Data/enterprise:** data-export-automatizálás · enterprise-controls (SSO/audit-export) igény szerint.

---

## 4. Kész, ha (blokkonként)
- [ ] Publikált tartalom watermarkolt; prémium tartalom signed-playbackkel véd.
- [ ] Ismételt copyright-ütközést a fingerprinting jelzi a lineage ellen.
- [ ] A moderation-queue lefedi az összes tartalom-típust, van appeals-út.
- [ ] Van dokumentált creator-verification + legal-request folyamat.

## 5. Teszt & ellenőrzés
- Watermark/fingerprint unit + integrációs tesztek.
- Trust&safety pipeline end-to-end (`/verify`) reportált→moderált→appeal.

## 6. Kockázat / függőség
- **Terjedelem:** ez egy **program**, nem egyetlen sprint — a blokkokat üzleti prioritás szerint kell ütemezni a P0/P1 után.
- **Előfeltétel:** [05](./05-storage-security.md), [06](./06-ai-endpoint-security.md), [08](./08-auth-hardening.md), [09](./09-account-lifecycle-gdpr.md), [10](./10-messaging-moderation.md), [14](./14-security-baseline-docs.md).
