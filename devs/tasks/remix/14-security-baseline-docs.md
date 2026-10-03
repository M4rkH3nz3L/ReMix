# 🔧 14. Security-baseline dokumentáció & audit-infra — kereszt-réteg

> **Forrás:** [remix.md](../../source/remix.md) §32 (ASVS 5.0), §22 (RLS / SECURITY DEFINER audit), §41 (Security Baseline v1 + `server/security/` modulok).
> **Ez a fájl a „ragasztó”:** a doksik + az audit-log/security-event infra, amit a többi feladat használ (`auditLog.js`, `securityEventLog`).
> **Cél-hely:** `security/` (repo-gyökér doksik) + `server/security/` (kód-modulok).

---

## 0. Kontextus & cél

Az audit szerint a ReMixnek nincs **verifikált security-baseline-je** (compliance 🔴), és a `server/security/` modulréteg részben hiányzik. Ez a fájl teremti meg a **közös governance-réteget**: a doksikat (threat-model, ASVS/MASVS checklist, incident-response) és a **futó audit-infrastruktúrát** (audit-log, security-event log), amelyekre a P0/P1 feladatok hivatkoznak.

---

## 1. Jelenlegi állapot (bizonyíték)
- 🟢 Valódi RLS + több `SECURITY DEFINER` függvény `set search_path = ''`-szel (audit §22 pozitívum).
- ❌ Nincs `security/` doksi-réteg; nincs központi `auditLog.js`/`securityEventLog`; a `server/security/` mappa **nem létezik** (a P0-fájlok hozzák létre — [01](./01-worker-auth-policy.md)–[07](./07-render-authorization.md)).

---

## 2. Megoldás

### 2.1 `security/` doksik (§41)
```text
security/
├── SECURITY.md            # felelős disclosure, kontakt, scope
├── THREAT-MODEL.md        # aktor/eszköz/adat/attack-surface (worker, storage, AI, social)
├── DATA-FLOW.md           # média/PII adatáramlás (kliens→worker→storage→CDN)
├── ASVS-5.0.md            # OWASP ASVS 5.0 checklist (backend/API)
├── MASVS.md               # OWASP MASVS checklist (mobil) — [13]
├── API-SECURITY.md        # OWASP API Top 10 leképezés + endpoint-inventory
├── INCIDENT-RESPONSE.md   # eszkaláció, kulcs-rotáció, kommunikáció
├── PRIVACY-DATA-MAP.md    # milyen PII hol él (GDPR — [09])
├── RETENTION.md           # megőrzési idők (billing/log/backup — [09])
└── SECURITY-TESTS.md      # a security-jest-suite-ok katalógusa
```
Checklist-formátum minden kontrollra: `V<id> — STATUS: PASS/PARTIAL/FAIL/N/A — EVIDENCE: <fájl:sor> — TEST: <hogyan>`.

### 2.2 `server/security/` kód-modulok (§41)
A P0-fájlok által létrehozott/érintett modulok **egy helyen**:
```text
server/security/
├── authorization.js   # [01]  endpoint-policy + inventory
├── rateLimit.js       # [03]
├── uploadPolicy.js    # [02]
├── mediaPolicy.js     # [02]
├── ssrfPolicy.js      # [04]  (a meglévő ssrf.js általánosítása)
├── quota.js           # (van) + aiQuota [06]
├── auditLog.js        # ÚJ — ez a fájl
└── securityHeaders.js # ÚJ — helmet-szerű fejlécek
```

### 2.3 Audit-log & security-event infra
- `auditLog.js`: strukturált, append-only audit (ki / mit / mikor / eredmény) — upload ([02](./02-upload-security.md)), AI ([06](./06-ai-endpoint-security.md)), billing/payout ([11](./11-billing-webhook-hardening.md)), account-deletion ([09](./09-account-lifecycle-gdpr.md)), moderation ([10](./10-messaging-moderation.md)) ide ír.
- `securityEventLog`: rate-limit-hit, auth-failure, gyanús-login ([08](./08-auth-hardening.md)), SSRF-block ([04](./04-ssrf-protection.md)) → riasztható.
- `securityHeaders.js`: `helmet`-alapú fejlécek (HSTS, no-sniff, frame-options) minden worker-válaszra.

### 2.4 SECURITY DEFINER audit (§22)
- Minden `SECURITY DEFINER` függvény felülvizsgálata: `search_path` (van), `EXECUTE` grantok, `auth.uid()` használat, input-validáció, object-ownership — checklistként az `ASVS-5.0.md`-ben.

---

## 3. Feladatok
### 🟦 Fázis A — Infra (a P0-kkal együtt)
- [ ] `server/security/auditLog.js` + `securityEventLog` + `securityHeaders.js`.
- [ ] Minden P0/P1 mutáció/biztonsági-esemény bekötése az audit-logba.

### 🟦 Fázis B — Doksik
- [ ] `security/` mappa a 10 doksival; `SECURITY.md` + `THREAT-MODEL.md` + `DATA-FLOW.md` először.
- [ ] `ASVS-5.0.md` + `MASVS.md` checklist-váz, majd folyamatos kitöltés a P0/P1 haladtával.
- [ ] `API-SECURITY.md` = a route-inventory ([01](./01-worker-auth-policy.md)) + OWASP API Top 10 leképezés.

### 🟦 Fázis C — SECURITY DEFINER audit
- [ ] Minden definer-függvény checklistes átvizsgálása → `ASVS-5.0.md`.

---

## 4. Kész, ha
- [ ] A `security/` doksik léteznek, és az ASVS/MASVS checklist minden kontrollhoz STATUS+EVIDENCE-t ad.
- [ ] Minden érzékeny művelet audit-logba ír; a security-event-ek riaszthatók.
- [ ] Minden `SECURITY DEFINER` függvény átvizsgálva (checklist PASS/indoklás).
- [ ] `securityHeaders` minden worker-válaszon jelen (teszt).

## 5. Teszt & ellenőrzés
- `server/security/auditLog.test.js` + header-teszt.
- Doksik review; a checklistek EVIDENCE-mezői valós fájl:sor-hivatkozások.

## 6. Kockázat / függőség
- **Kereszt-függőség:** minden más fájl ide ír (audit) és innen olvas (doksi-baseline) — érdemes a P0-val **párhuzamosan** indítani, hogy az audit-log kész legyen, mire a P0-mutációk bekötnék.
