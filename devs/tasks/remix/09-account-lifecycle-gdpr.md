# 🟠 09. Account-lifecycle & GDPR — P1

> **Forrás:** [remix.md](../../source/remix.md) §24 (GDPR / account deletion pipeline), §25 (privacy — `user_devices` adatminimalizálás).
> **Kapcsolódó memória:** [gdpr-compliance] — consent + privacy/terms **kész**; erasure/export **NEM**; auth.users delete-cascade ~95%-ot fed, az S3-média a rés.
> **Érintett kód:** `user_consents` / `user_devices` táblák + migrációk · [server/userStorage.js](../../../server/userStorage.js) · [server/mediastore.js](../../../server/mediastore.js) · [05](./05-storage-security.md) bucketek.

---

## 0. Kontextus & cél

Van consent-tábla (verziózott, auditált) + soft-delete (`deleted_at`) + privacy/terms doksik. **De a soft-delete ≠ GDPR-törlés**, és nincs adat-export. A memória szerint az `auth.users` delete-cascade ~95%-ot fed — **a rés az S3/storage-média** és a külső provider-configok.

**Cél:** valódi, auditált **account-deletion pipeline** + **adat-export** (data portability) + **retention-policy** + **adatminimalizálás**.

---

## 1. Jelenlegi állapot (bizonyíték)
- 🟢 `user_consents` (verzió + audit), privacy/terms doksik, `deleted_at` soft-delete, report/moderation-metaadat.
- 🟡 `user_devices` — sok adat: device/manufacturer/model/OS/API-level/screen/memory/CPU-arch/locale/region/timezone/currency + **`raw jsonb`** → adatminimalizálás kell (§25).
- ❌ Nincs: törlés-pipeline, storage-objektum-törlés, sessions/devices/AI-config takarítás, adat-export, retention-policy (a billing-adat külön retention alá esik).

---

## 2. Megoldás — deletion pipeline (§24)

```text
DELETE REQUEST → cooldown → disable account → delete personal data →
delete private media → delete sessions → delete devices →
delete AI provider configs → delete private projects →
anonymize public content (ahol jogilag kell) →
delete storage objects → delete backups (retention szerint) → audit completion
```

### 2.1 Törlés-pipeline (worker + DB)
- **Request + cooldown** (pl. 14/30 nap visszavonható), közben account „disabled”.
- **Adat-törlés sorrend** a fenti lánc szerint; a DB-oldalt az `auth.users` cascade adja, a **storage-oldalt** ([05](./05-storage-security.md) bucketek) explicit worker-szkript törli (ez a memória szerinti rés).
- **Publikus tartalom anonimizálás** ahol a remix-lineage/jogi kötelezettség ezt kívánja (nem hard-delete, hanem owner-anonimizálás).
- **Audit-completion** rekord ([14](./14-security-baseline-docs.md) auditLog).

### 2.2 Adat-export (portability)
- `POST /account/export` → aszinkron job (queue) → a user projektjei/posztjai/consent-jei/profil-adatai gépi formátumban (JSON + média-linkek signed-URL-lel), letölthető csomag.

### 2.3 Retention-policy
- `security/RETENTION.md` ([14](./14-security-baseline-docs.md)): mit meddig tartunk (billing/accounting külön, jogszabály szerint; logok; backupok).

### 2.4 Adatminimalizálás (§25)
- `user_devices`: a `raw jsonb` **megszüntetése/redukálása**; csak a ténylegesen használt mezők (analytics-cél dokumentálva); a többi ne kerüljön tárolásra („ne gyűjts, hátha kell”).

---

## 3. Feladatok
### 🟦 Fázis A — Törlés-pipeline
- [ ] `POST /account/delete` (re-auth, [08](./08-auth-hardening.md)) → request + cooldown-állapot.
- [ ] Worker-job: storage-objektum-törlés (minden bucket, [05](./05-storage-security.md)) + AI-provider-config + external-storage-token ([userStorage.js](../../../server/userStorage.js)) törlés.
- [ ] Publikus-tartalom anonimizálás (remix-lineage-safe).
- [ ] Audit-completion rekord + a felhasználó értesítése.

### 🟦 Fázis B — Export & retention
- [ ] `POST /account/export` aszinkron export-job + letölthető csomag (signed-URL).
- [ ] `security/RETENTION.md` + a billing-adat külön retention-kezelése.

### 🟦 Fázis C — Adatminimalizálás
- [ ] `user_devices.raw jsonb` eltávolítása/redukálása; migráció + kliens-küldés szűkítése.

---

## 4. Kész, ha
- [ ] Törlési kérés után a cooldown lejártával a személyes adat + **privát média (S3)** ténylegesen eltűnik (verifikálva a bucketben).
- [ ] Az export-csomag teljes (projektek/posztok/consent/profil) és letölthető.
- [ ] `user_devices` nem tárol `raw jsonb`-t; a mezők dokumentált célúak.
- [ ] `npm run audit` zöld + migrációk prodon verifikálva.

## 5. Teszt & ellenőrzés
- Integrációs: teszt-account létrehozás → média-feltöltés → törlés → storage-objektum **nincs** (service-role list).
- Export-job smoke-teszt.

## 6. Kockázat / függőség
- **Visszafordíthatatlan művelet** — cooldown + re-auth + audit kötelező; dev a prod DB-re mutat ([hosted-supabase-prod]) → teszt-accountokkal, óvatosan.
- **Függőség:** [05](./05-storage-security.md) (bucket-struktúra), [08](./08-auth-hardening.md) (re-auth), [14](./14-security-baseline-docs.md) (audit/retention).
