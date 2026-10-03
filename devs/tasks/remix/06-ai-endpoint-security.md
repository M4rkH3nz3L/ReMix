# 🔴 06. AI endpoint-security + AI ≠ authorization boundary — P0

> **Forrás:** [remix.md](../../source/remix.md) §18 (AI mint command-generátor), §19 (provider-security), §34.7.
> **Testvér:** ráépül [01](./01-worker-auth-policy.md), [03](./03-rate-limiting.md), [04](./04-ssrf-protection.md)-re.
> **Érintett kód:** [server/ai.js](../../../server/ai.js) · [server/index.js](../../../server/index.js) (`/ai/*`) · [src/lib/commands.ts](../../../src/lib/commands.ts) (command-bus, kliens) · [src/lib/aiProviders.ts](../../../src/lib/aiProviders.ts).

---

## 0. Kontextus & cél

Az AI-réteg iránya jó (command-generátor, nem közvetlen mutáció — illik a repo command-bus DNS-éhez, [AGENTS.md](../../../AGENTS.md)). Két dolgot kell production-szintre hozni:

1. **Minden AI-endpoint teljes védelmi profilt kapjon** (auth + rate-limit + quota + provider-allowlist + input-size + output-schema-validation).
2. **Az AI soha ne legyen authorization boundary** — az AI által generált commandot **determinisztikus policy-engine** validálja mutáció előtt.

---

## 1. Jelenlegi állapot (bizonyíték)

`/ai/*` endpointok a [server/index.js](../../../server/index.js)-ben:

| Endpoint | Mai védelem |
| --- | --- |
| `/ai/translate`, `/ai/highlights`, `/ai/story`, `/ai/autoedit` | `...proOnly` 🟢 |
| `/ai/hooks` ([354](../../../server/index.js#L354)), `/ai/probe` ([369](../../../server/index.js#L369)), `/ai/thumbheadlines` ([573](../../../server/index.js#L573)), `/ai/captionstudio` ([613](../../../server/index.js#L613)), `/ai/assist` ([964](../../../server/index.js#L964)) | **NYITOTT** 🔴 |

- **SSRF (provider-URL):** `assertSafeAiBaseUrl` már bekötve [server/ai.js:8](../../../server/ai.js#L8) 🟢 (a bővítés [04](./04-ssrf-protection.md)-ben).
- **Quota:** nincs AI-specifikus token/hívás-quota; a Pro-kapu bináris (Pro ↔ nem-Pro), de a Pro-user is korlátlanul égetheti a modell-költséget.
- **Output-validation:** az AI-válasz → command leképezésnél nincs kikényszerített séma-validáció a workeren (a kliens `commands.ts` reducer defenzív, de a **command-forrás** nincs policy-zva).

---

## 2. Megoldás

### 2.1 Egységes AI-védelmi profil
Minden `/ai/*` endpoint:

```text
policy: authenticated() (v. pro())      ← [01]
+ rateLimit('ai')                        ← [03]
+ aiQuota(user, subscription)            ← ÚJ (token/hívás budget)
+ assertSafeUrl(providerBaseUrl,'ai')    ← [04]
+ input-size limit (már részben: express.json limitek)
+ output-schema validation               ← ÚJ (zod/JSON-schema a válaszra)
```

- A nyitott AI-endpointok (`/ai/hooks|probe|thumbheadlines|captionstudio|assist`) **minimum `authenticated()`** + `rateLimit('ai')` + `aiQuota`.
- `aiQuota`: per-user/subscription token- vagy hívás-budget Redisben (a [03](./03-rate-limiting.md) infra fölött), credit-integrációval (a `/tts`/`/render` credit-mintát követve).

### 2.2 AI ≠ authorization boundary (command policy-engine)
A helyes lánc (audit §18):

```text
User → Auth → Authorization → AI → Structured command →
Command validator → Capability check → Project-ownership check → Mutation
```

- Az AI kimenete **mindig** strukturált command (nem szabad szöveg → közvetlen művelet).
- A commandot egy **determinisztikus validátor** ellenőrzi: séma + capability ([src/lib/capabilities.ts](../../../src/lib/capabilities.ts) `where`/`pro`) + projekt-ownership — **mielőtt** a command-bus végrehajtaná.
- Destruktív command (pl. „delete project”) sosem mehet AI-forrásból közvetlenül — ugyanaz a policy-engine bírálja, mint a user-commandokat.

### 2.3 Provider-security (§19)
- `sanitizeAiConfig()` + `assertSafeUrl(...,'ai')` (SSRF, [04](./04-ssrf-protection.md)).
- Provider-allowlist: csak jóváhagyott base-URL-ek (env), custom-URL prodban tiltva vagy szigorú allowlisttel.
- Prompt-injection tudatosság: a modell-válasz **nem** kap közvetlen jogosultságot — a §2.2 policy-engine a védelem.

---

## 3. Feladatok

### 🟦 Fázis A — Endpoint-profil
- [ ] A nyitott `/ai/*` endpointok bejelölése `authenticated()`/`pro()` + `rateLimit('ai')`.
- [ ] `server/security/aiQuota.js` (v. `quota.js` bővítés): per-user/subscription AI-budget Redisben + `429`/`402` túllépéskor.
- [ ] Input-size limitek egységesítése (a `express.json({limit})` értékek profilhoz igazítása).

### 🟦 Fázis B — Command policy-engine
- [ ] Worker-oldali AI-válasz → strukturált command **séma-validáció** (zod/JSON-schema); érvénytelen kimenet elutasítva.
- [ ] Command-validátor: capability-check ([capabilities.ts](../../../src/lib/capabilities.ts)) + projekt-ownership + destruktív-command tiltás AI-forrásból.
- [ ] A validátor a kliens command-bus ([commands.ts](../../../src/lib/commands.ts)) elé/mellé — közös policy mind a user-, mind az AI-commandokra.

### 🟦 Fázis C — Provider
- [ ] Provider-allowlist env-katalógus; custom-URL prod-tiltás/allowlist.
- [ ] AI-hívás audit log (user / endpoint / provider / token-becslés) → [14](./14-security-baseline-docs.md).

---

## 4. Kész, ha
- [ ] Token nélkül minden `/ai/*` → `401`; budget-túllépés → `429`/`402`.
- [ ] Egy manipulált AI-válasz, ami „delete project” commandot ad, a policy-engine-en **elhasal** (nincs mutáció) — jest-teszt bizonyítja.
- [ ] Custom provider-URL private/metadata IP-re → elutasítva ([04](./04-ssrf-protection.md)).
- [ ] `npm run audit` zöld.

## 5. Teszt & ellenőrzés
- `server/ai.security.test.js` — auth-mátrix + quota-túllépés + provider-allowlist.
- `src/lib/commandPolicy.test.ts` — AI-forrású destruktív/jogosulatlan command elutasítása; jogos command átmegy.

## 6. Kockázat / függőség
- **Regresszió:** a ma nyitott AI-endpointokat a kliens auth nélkül hívhatja → token-fejléc pótlása kell ([01](./01-worker-auth-policy.md) B-fázissal együtt).
- **Függőség:** [01](./01-worker-auth-policy.md), [03](./03-rate-limiting.md), [04](./04-ssrf-protection.md).
