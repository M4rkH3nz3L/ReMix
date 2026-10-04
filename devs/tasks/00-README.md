# 🧭 ReMix — Funkcionalitási fejlesztési terv (index)

> **Forrás-audit:** [devs/source/audit-2026-10-main.md](../source/audit-2026-10-main.md)
> — a `main` (2026-09-29) teljes funkcionalitási auditja (editor/image/audio/social/
> collaboration/AI/storage/rendering/monetizáció/production).
> **Ez a mappa:** az auditból **feladatokra bontott** fejlesztési terv, **témánként
> számozott TODO-fájlokban**. Minden fájl önálló, szállítható epik:
> `Forrás → Érintett kód → Kontextus & cél → Jelenlegi állapot → Megoldás → feladatlista
> (státusz-taggel) → Kész, ha`.

---

## 0. Miért létezik ez a terv? (diagnózis)

Az audit egyetlen mondatban:

> A ReMixben jelenleg **sokkal több a „feature core", mint a teljes, felhasználó által
> végigjárható (integrált) feature**.

A legnagyobb fejlesztési érték most **nem** újabb feature, hanem a meglévő magok
végigvezetése a láncon:

```text
PURE CORE → TEST → UI integráció → preview parity → render parity
          → cloud/sync → billing/RBAC → production QA
```

Hét kritikus technikai fókusz (ezek húzzák a terv nagy részét):

| # | Fókusz | Elv |
| - | --- | --- |
| 1 | Asset architecture | `uri → assetId` |
| 2 | Command architecture | `UI → Command → Store → Event → Sync` |
| 3 | Render parity | `Preview == Export` |
| 4 | Cloud asset | `Asset → Storage → CDN → Render → Publish` |
| 5 | Capability system | `Free → Basic → Pro → Ultra` |
| 6 | Collaborative state | `Operation → Sync → Conflict resolution` |
| 7 | Observability | `Action → telemetry → cost → failure → recovery` |

### ⚠️ A terv a `main`-audit, a munka a `studio-social` ágon
A forrás-audit a `main`-t nézte. A `studio-social` ágon azóta **jelentős plusz készült**,
amit az audit nem tartalmaz — ezeket NEM ez a terv fedi, mert már kész:

- **Live Studio (OBS-szerű élő produkció) — A–F fázis KÉSZ** (kompozitor, audio-mixer,
  feed-megosztás, multistream RTMP-egress, VOD, hardening). Terv: a git-history `LIVE.md`-je.
- **Auth/Social/RBAC/GDPR/Pro-subscription/Shop/Wallet/Creator-profile** alapok + a sok
  **pure-core** (Creator OS platform-mag, grafikai magok, stúdió-magok).

Ahol tehát az audit „HIÁNYZIK"-ot mond, de a `studio-social`-on már van valami, ott a
fájl a **tényleges maradékot** célozza (nem a nulláról).

---

## 1. Státusz-taxonómia (minden TODO-tételen)

A feladatlista-tételek az audit §20 szerinti végleges státuszt kapják:

| Tag | Jelentés |
| --- | --- |
| ✅ **DONE** | Kész + integrált + (lehetőleg) tesztelt. |
| 🟡 **PARTIAL** | Részben kész (mag igen, teljes flow nem). |
| 🖼️ **UI-MISSING** | A mag/logika kész, a felhasználói felület hiányzik. |
| 🔌 **BACKEND-MISSING** | A kliens kész, a worker/DB/backend hiányzik. |
| 🎞️ **RENDER-MISSING** | Preview megvan, az export/render-parity hiányzik. |
| 🧪 **MOCK** | Dev/placeholder megoldás (nem production). |
| ⬜ **NOT-IMPL** | Nincs implementálva. |

---

## 2. Audit-összkép és a feladatfájlok

| # | Terület | Fő prioritás | Fájl |
| - | --- | --- | --- |
| 01 | Production / Go-Live | 🔴 P0 | [01-production-go-live.md](./01-production-go-live.md) |
| 02 | Monetizáció | 🔴 P0 / 🟠 P1 | [02-monetization.md](./02-monetization.md) |
| 03 | Collaboration | 🟠 P1 | [03-collaboration.md](./03-collaboration.md) |
| 04 | Social | 🟠 P1 | [04-social.md](./04-social.md) |
| 05 | AI (Creator OS) | 🟡 P2 | [05-ai.md](./05-ai.md) |
| 06 | Video Editor (NLE) | 🟠 P1 | [06-video-editor.md](./06-video-editor.md) |
| 07 | Image Studio | 🟠 P1 | [07-image-studio.md](./07-image-studio.md) |
| 08 | Storage / Asset | 🟠 P1 | [08-storage.md](./08-storage.md) |
| 09 | Native / Rendering | 🟢 P3 | [09-native-rendering.md](./09-native-rendering.md) |
| 10 | Brand / UI | 🟠 P1 | [10-brand-ui.md](./10-brand-ui.md) |
| 11 | Performance | 🟠 P1 | [11-performance.md](./11-performance.md) |
| 12 | Code quality / robustness | 🟠 P1 | [12-code-quality.md](./12-code-quality.md) |
| 13 | Documentation / Engineering | 🟡 P2 | [13-documentation.md](./13-documentation.md) |

> **Security + production-readiness backlog:** a `main`-audit security-rétege (worker-auth,
> upload, rate-limit, SSRF, storage-authz, AI-endpoint, render-authz, auth-hardening, GDPR,
> moderation, billing-webhook, CI/CD, mobile-network, baseline) a git-history
> `devs/tasks/remix/` számozott fájljaiban él — a P0 go-live azokra is épít.

---

## 3. Becsült készültség (audit §19 — NEM hivatalos pontszám)

```text
Editor core (alapfunkció)   ████████░░  ~70–80%
Profi NLE                   █████░░░░░  ~45–60%
Image editor (UI)           █████░░░░░  ~45–60%   (pure core magasabb)
Audio editor                █████░░░░░  ~40–55%
Social                      ██████░░░░  ~60–70%
Collaboration               ██████░░░░  ~60–70%
AI                          █████░░░░░  ~45–60%
Production infrastructure   ████░░░░░░  ~35–50%
Monetization                ███░░░░░░░  ~30–40%
Production readiness        ███░░░░░░░  ~30–40%
```

---

## 4. Prioritás-modell (go-live sorrend)

- **🔴 P0 — kötelező a launchhez:** prod Supabase · prod worker · EAS iOS+Android ·
  RevenueCat prod · push prod · secure secrets · prod storage/CDN · render smoke-test ·
  upload→render→publish pipeline · crash/error monitoring · rate-limiting · client/worker
  contract-tesztek → főként [01](./01-production-go-live.md) + [02](./02-monetization.md) §2.10.
- **🟠 P1 — hogy valódi editor + platform legyen:** [06](./06-video-editor.md) (keyframe/
  color/mask/effect-chain/audio-UI/proxy) · [07](./07-image-studio.md) (UI-bekötés + PSD) ·
  [03](./03-collaboration.md) (locking/review/RBAC) · [04](./04-social.md) (search/
  recommendation/Creator-Studio) · [10](./10-brand-ui.md) · [11](./11-performance.md) ·
  [12](./12-code-quality.md) · [08](./08-storage.md).
- **🟡 P2 — AI Creator OS:** [05](./05-ai.md) (Context/Memory/Semantic/Select/Publish/
  personas) · [13](./13-documentation.md).
- **🟢 P3 — platform expansion:** [09](./09-native-rendering.md) (desktop/Skia/native-FFmpeg/
  ONNX-mobile/avatar/voice-clone).

---

## 5. Hogyan használd
1. Egy fájl = egy epik. A tetején `Érintett kód` + `Kontextus`.
2. A feladatlista-tételek státusz-taggel (§1) — **először a 🟡/🖼️/🔌-eket** zárd (a mag már
   megvan, csak a következő réteg hiányzik → a legjobb ár/érték).
3. Minden tétel akkor „kész", ha végigmegy a láncon (§0) a tesztig; az epik `Kész, ha`-ja az
   elfogadási kritérium.
4. Új munkát ADR-rel + a kódhoz igazított doksival vezess ([13](./13-documentation.md)).
