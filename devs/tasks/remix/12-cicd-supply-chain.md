# 🟠 12. CI/CD security-gate & supply-chain — P1

> **Forrás:** [remix.md](../../source/remix.md) §26 (CI/CD), §27 (secret-scanning), §28 (dependency-security), §41 (cél-pipeline).
> **Érintett kód:** [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) · [package.json](../../../package.json) (`npm run audit`) · `server/package.json`.

---

## 0. Kontextus & cél

Van **minőség-kapu** (typecheck · lint · test · worker-syntax · expo-doctor), de **nincs security-gate**. A projekt sok natív + szerveroldali dependencyt húz (expo, react-native, supabase, reanimated, onnxruntime, playwright, three, bullmq, redis, aws-sdk, anthropic, express, multer) → jelentős supply-chain felület.

**Cél:** a CI legyen production security-pipeline: SAST + SCA + secret-scan + SBOM; a release **ne menjen ki** kritikus sérülékenységgel.

---

## 1. Jelenlegi állapot (bizonyíték)

```yaml
# .github/workflows/ci.yml — mai jobok:
#  typecheck · lint · test (--ci) · worker syntax (node -c) · expo-doctor (nem blokkoló)
```
- `npm run audit` = `typecheck && lint && test` ([package.json:78](../../../package.json#L78)) — **nincs** benne `npm audit`/SAST/secret-scan.
- ❌ Nincs: `npm audit`/OSV, Dependabot/Renovate, Semgrep, CodeQL, secret-scanning, SBOM, license-scan, container-scan, DAST.

---

## 2. Megoldás — a cél-pipeline (§41)

```text
typecheck → lint → unit → integration →
SAST (Semgrep/CodeQL) → dependency-scan (npm audit + OSV) →
secret-scan (gitleaks/trufflehog) → security-tests →
build → EAS release
```

### 2.1 Dependency (SCA)
- **`npm audit --audit-level=high`** kliens + `server/` — kritikus/high → **build-fail**.
- **OSV-Scanner** a lockfile-okra.
- **Dependabot/Renovate** heti PR-ekkel.
- **SBOM** generálás (CycloneDX) release-artefaktként.

### 2.2 SAST
- **Semgrep** (JS/TS ruleset) + **CodeQL** (GitHub-natív) a PR-eken.

### 2.3 Secret-scan
- **gitleaks** + **trufflehog** a **teljes git-historyra** (a `.gitignore`/`.easignore` csak a jövőt védi — a repo **public**, [no-claude-coauthor-trailer]).
- GitHub **secret-scanning** + push-protection bekapcsolva.

### 2.4 Security-tesztek
- A worker-security jest-suite-ok ([01](./01-worker-auth-policy.md)–[07](./07-render-authorization.md)) külön CI-lépésként; policy-inventory-teljesség guard ([01](./01-worker-auth-policy.md)).
- Grep-guardok: `upload.any()` ([02](./02-upload-security.md)), nyers `fetch(` allowlist nélkül ([04](./04-ssrf-protection.md)).

---

## 3. Feladatok
### 🟦 Fázis A — SCA & secret
- [ ] `npm audit` (kliens + server) CI-lépés, high/critical → fail; `npm run audit` bővítése vagy külön job.
- [ ] OSV-Scanner + SBOM (CycloneDX) artefakt.
- [ ] gitleaks + trufflehog a teljes historyra; GitHub secret-scanning + push-protection.
- [ ] Dependabot/Renovate config.

### 🟦 Fázis B — SAST
- [ ] Semgrep (JS/TS) job + CodeQL bekapcsolása.

### 🟦 Fázis C — Security-tesztek & release-gate
- [ ] Worker-security jest-suite + policy-inventory + grep-guardok CI-lépésként.
- [ ] Release/EAS-pipeline: security-gate zöld nélkül nincs build.

---

## 4. Kész, ha
- [ ] Egy szándékosan bevitt high-severity dependency **elbuktatja** a CI-t.
- [ ] Bevitt teszt-secret-et a secret-scan **megfog**.
- [ ] Az SBOM legenerálódik minden release-re.
- [ ] A security-jest-suite + grep-guardok kötelező CI-lépések.

## 5. Teszt & ellenőrzés
- Próba-PR sérülékeny csomaggal / fake-secrettel → CI piros.
- History-scan futtatása egyszer lokálisan (`gitleaks detect`) a jelenlegi állapotra.

## 6. Kockázat / függőség
- **History-secret:** ha a scan találatot ad a múltból → kulcs-rotáció szükséges (a DB-jelszó-rotáció már ismert teendő — [hosted-supabase-prod]).
- **Zaj:** a SAST/SCA kezdetben sok találat → triage + baseline (allowlist a false-positive-okra), hogy a gate ne legyen megkerülve.
