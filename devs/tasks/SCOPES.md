# 🎯 SCOPES.md — mit, hogyan scope-olunk (profi entitlement- & termék-scope)

> **Mi ez:** a [uzleti-terv.md](./uzleti-terv.md) (5 csomag, tool-first, **Free = 100% eszközön**) és a
> [prod-off.md](./prod-off.md) alapján **pontosan definiálja a scope-ot**: mi van benne / kint, és **minden fizetős
> képesség hogyan van kapuzva** (tier-mátrix), **hol fut** (eszközön vs felhő), és **hogyan kényszerítjük ki**
> (kliens-gate + szerver-enforce + kvóta-mérés). Ez a **termék- és entitlement-spec** — a mérnöki igazság forrása.
>
> **Valós kód-alap (amire épít):** [src/lib/tiers.ts](../../src/lib/tiers.ts) (`Tier`, `tierMeetsMin`),
> [src/lib/usageMeter.ts](../../src/lib/usageMeter.ts) (`TIER_QUOTAS`, `canUse`) ⇄ `server/usage.js` (contract-tesztelt),
> [src/store/entitlementStore.ts](../../src/store/entitlementStore.ts) (aktuális szint), [src/lib/subscription.ts](../../src/lib/subscription.ts)
> (**szerver-autoritatív**), `guardPro` (paywall), [src/lib/storageQuota.ts](../../src/lib/storageQuota.ts) (külön storage-kvóta).

---

## 1. A scope 4 rétege (elv)

1. **Termék-scope** — mit építünk MOST / halasztunk / kivágunk (fókusz a short-video workflow-ra).
2. **Entitlement-scope** — minden fizetős **képesség = nevesített entitlement**, tier-hez kötve (mátrix).
3. **Technikai scope** — **eszközön vs felhő**: a Free 100% eszközön; a „felhő" a fizetős határvonal.
4. **Enforcement-scope** — **kliens-gate** (UX-paywall) **+ szerver-enforce** (autoritatív) **+ kvóta-mérés**.
   Alapszabály: **a kliens-gate csak UX; a biztonság a szerveren dől el** (sosem bízunk a kliensben).

---

## 2. Termék-scope (IN / DEFERRED / OUT)

| Scope | Tartalom | Indok |
|-------|----------|-------|
| **IN (F0 launch)** | video-editor · **eszközön-render (Free)** · AI-copilot (felirat/hook/reframe) · 1-klikk multi-reframe · publish+ütemezés · alap-analitika · planner · creator-memory · 5 csomag · licencelt zene · **app-privát projekt-tár** | a short-video alkotó teljes core-workflow-ja |
| **TÁMOGATÓ (IN, de nem reklámozva)** | kép-stúdió (thumbnail) · hang-stúdió (hangjavítás/zene) | a shorts kiegészítői |
| **DEFERRED (v2+)** | social-feed/remix (**növekedési hurok**) · sablon-marketplace (tartalomként) · a többi „creator-studio" | előbb a tool-érték |
| **OUT / ZÁRVA (jogi gate)** | coin-pénztárca · valódi-pénz **cash-out** · user→user fizetés | pénzforgalmi engedély + store-politika |

### 2b. Tartalom-korlátok (hard limits)
| Korlát | Érték | Hol enforce-olva | Indok |
|--------|-------|------------------|-------|
| **Videó MAX hossza** | **10 perc (600 mp)** | kliens figyelmeztet ([projectUtils.ts](../../src/lib/projectUtils.ts) `MAX_PROJECT_DURATION_SEC`/`exceedsMaxDuration`) + **szerver HARD-GATE** (`/render` → 413, [render.js](../../server/render.js) `MAX_RENDER_DURATION_SEC`, **contract-tesztelt** tükör) | short-video fókusz + render-költség/plafon (TikTok-max = 600 is) |

> A 600 mp **globális felső határ** — tier-szinten **szigoríthatóbb** (pl. a Free rövidebb cap-et kaphat entitlementként), de **feljebb nem**.

---

## 3. Tier-modell (5 csomag → kód-tier)

| Csomag (terv) | Kód-`Tier` | Fizetős? | Fő jelleg |
|---------------|------------|:--:|-----------|
| **Free** | `free` | — | 100% eszközön |
| **Amatőr** | `basic` | ✅ | vízjel-mentes + 1080p + felhő-mentés |
| **Haladó** | `pro` | ✅ | felhő-AI + 4K + publish + analitika |
| **Profi** | `ultra` | ✅ | max-kvóta + prioritás + A/B |
| **Céges** | **`business`** (ÚJ) | ✅ | csapat/seat + RBAC + governance |

> A kód ma `free/basic/pro/ultra` (4). **Teendő:** a `Tier` kiegészítése **`business`**-szel (5.), a seat/RBAC-scope hozzá
> (lásd [§8](#8-megvalósítási-delta-mi-van--mi-hiányzik)). A `tierMeetsMin`/`TIER_ORDER` monoton marad: `free<basic<pro<ultra<business`.

---

## 4. Capability-katalógus (nevesített entitlement-ek)

Minden fizetős dolog **egy stabil kulcs** → kliens-gate + szerver-enforce ugyanarra hivatkozik. Típus: `bool` / enum / szám.

| Kulcs | Típus | Mit kapuz |
|-------|-------|-----------|
| **Render & export** | | |
| `render.engine` | `device \| cloud` | hol renderel (Free: device) |
| `render.maxRes` | `720 \| 1080 \| 2160` | max felbontás |
| `export.watermark` | `bool` | rákerül-e a „Made with ReMix" |
| `render.priority` | `bool` | prioritásos felhő-sor |
| **Tárolás** | | |
| `storage.location` | `device \| cloud` | projekt elsődleges helye |
| `storage.cloudBackup` | `bool` | auto felhő-biztonsági-mentés |
| `storage.sync` | `bool` | több-eszköz-szinkron |
| `storage.quotaGB` | `szám` | felhő-tárhely (külön rendszer: storageQuota) |
| **AI** | | |
| `ai.onDevice` | `bool` | eszközön-felirat/vízió (Free is) |
| `ai.cloud` | `bool` | felhő-AI (hook/script/trend/B-roll) |
| **Multi-platform** | | |
| `publish.enabled` | `bool` | publikálás egyáltalán |
| `publish.maxAccounts` | `szám` | összekötött fiókok száma |
| `publish.schedule` | `bool` | ütemezés |
| `platformProfiles` | `none\|1\|all` | per-platform felirat/hossz-profil |
| **Növekedés** | | |
| `analytics.level` | `none\|basic\|full\|insights` | elemzés mélysége |
| `planner` | `bool` | tartalom-naptár |
| `creatorMemory` | `bool` | tanul a stílusodból |
| **Csapat & márka (Céges)** | | |
| `team.seats` | `szám` | ülések |
| `rbac` | `bool` | szerepkörök/jogosultságok |
| `brandGovernance` | `none\|single\|multi\|team-lock` | brand-kit zárolás/jóváhagyás |
| `clientManagement` | `bool` | ügyfél-/fiók-kezelés, bulk |
| `support.sla` | `bool` | prioritásos support/SLA |
| `api.whitelabel` | `bool` | API / white-label export |
| **Mért kvóták** (usageMeter, havi) | | |
| `renderMinutes` · `aiTokens` · `cloudJobs` · `exports` | `szám` (`-1`=∞) | felhő-erőforrás plafon |

---

## 5. ⭐ Entitlement-mátrix (tier → capability) — az AUTORITATÍV gating

> Ez a spec: a kliens-gate ÉS a szerver-enforce ebből dolgozik. (`-1` = korlátlan.)

| Entitlement | **Free** | **Amatőr** | **Haladó** | **Profi** | **Céges** |
|---|:--:|:--:|:--:|:--:|:--:|
| `render.engine` | **device** | device+cloud | cloud | cloud | cloud |
| `render.maxRes` | **720** | 1080 | 2160 | 2160 | 2160 |
| `export.watermark` | **true** | false | false | false | false |
| `render.priority` | — | — | — | ✅ | ✅ |
| `storage.location` | **device** | device+cloud | cloud | cloud | cloud |
| `storage.cloudBackup` | **—** | ✅ | ✅ | ✅ | ✅ |
| `storage.sync` | — | — | ✅ | ✅ | ✅ |
| `storage.quotaGB` | **0 (eszközön)** | 10 | 50 | 200 | pool |
| `ai.onDevice` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ai.cloud` | **—** | ízelítő | ✅ | ✅ (A/B) | ✅ |
| `publish.enabled` | — | ✅ | ✅ | ✅ | ✅ |
| `publish.maxAccounts` | 0 | 1 | 3 | 10 | **-1** |
| `publish.schedule` | — | ✅ | ✅ | ✅ | ✅ |
| `platformProfiles` | — | 1 | all | all | all |
| `analytics.level` | none | basic | full | **insights** | team |
| `planner` | — | ✅ | ✅ | ✅ | ✅ |
| `creatorMemory` | — | — | ✅ | ✅ | ✅ |
| `team.seats` | 1 | 1 | 1 | 1 | **N** |
| `rbac` | — | — | — | — | ✅ |
| `brandGovernance` | — | — | single | multi | **team-lock** |
| `support.sla` | — | — | — | ✅ | ✅ |
| **`renderMinutes`/hó** | **0 (device ∞)** | 30 | 120 | 400 | pool |
| **`aiTokens`/hó** | **0 (cloud)** | kicsi | nagy | max | pool |
| **`cloudJobs`/hó** | **0** | közepes | nagy | -1 | -1 |
| **`exports`/hó** | **∞ (device)** | 100 | -1 | -1 | -1 |

> **Megjegyzés:** a Free `renderMinutes=0` a **felhő**-renderre vonatkozik — eszközön **korlátlanul** renderel (saját CPU).
> Az `exports` a Free-ben eszközön ∞, mert nem terheli az infrát; a felhős kvóták csak a fizető kohorszra esnek.

---

## 6. Technikai scope — eszközön vs felhő

| Képesség | **Free (eszközön)** | **Fizetős (felhő)** |
|----------|---------------------|---------------------|
| Render | **MediaCodec (Android) / AVFoundation (iOS)**, 720p, vízjel | ffmpeg-worker, 1080p/4K, gyors/prioritás |
| Tárolás | **app-privát sandbox** (`Paths.document`), galérián kívül, csak appból törölhető | R2 felhő-mentés + szinkron (ADR-013) |
| AI | **eszközön** (Whisper-felirat, helyi vízió) | Anthropic (hook/script/trend/B-roll), mért token |
| Publish | — | OAuth + ütemezés (worker) |

> **⚠️ KRITIKUS ÚT:** a Free egésze az **Android eszközön-render-motoron** áll ([NATIVE.md](./NATIVE.md); iOS v1 kész, Android a hiány).
> Nélküle nincs „eszközön-720p-vízjel" Free → a teljes modell megbicsaklik. Ez a **#1 technikai scope-prioritás**.

---

## 7. Enforcement-scope (HOGYAN kapuzunk) — profi minta

Minden entitlementnek **két kapuja** van (és csak így „profi"):

1. **Kliens-gate (UX):** az [entitlementStore](../../src/store/entitlementStore.ts) tartja a user szintjét; a `tierMeetsMin`/
   `guardPro` **paywallt nyit** a zárt funkción (szürke/lakat + „Upgrade"). A felhő-kvóta elfogyásánál a `canUse` **soft-warn**.
   *A kliens-gate SOHA nem biztonsági határ — csak kényelem/UX.*
2. **Szerver-enforce (autoritatív):** a tényleges felhő-művelet (render-submit, `/ai/*`, `/tts`, publish, storage-write)
   a szerveren ellenőrzi a **szerver-oldali** szintet ([subscription.ts](../../src/lib/subscription.ts) → Supabase, server-authoritative)
   ÉS a **kvótát** (`server/usage.js` `TIER_QUOTAS`/`canUse`, contract-tesztelt a klienssel) → túllépés = **402/403/429**.
3. **Vízjel-enforce:** a **render-láncban** dől el (`export.watermark=true` a Free-nél) — az eszközön-render-motor és a
   felhő-worker is a user **szerver-hiteles** szintje szerint teszi/nem teszi rá. *(A kliens nem „kapcsolhatja ki" a vízjelet.)*
4. **Storage-enforce:** a felhő-mentés/szinkron csak `storage.cloudBackup/sync` entitlementtel; a byte-plafon a külön
   [storageQuota](../../src/lib/storageQuota.ts) + `server/quota.js` (hard-block).

**Egyetlen forrás:** a mátrix (§5) → egy **`ENTITLEMENTS[tier]`** tábla a kliensen ÉS a szerveren (tükrözve,
**contract-teszttel zárolva**, mint a `TIER_QUOTAS` ma) — így nem csúszik szét.

---

## 8. Megvalósítási delta (mi van / mi hiányzik)

| Terület | Ma (kód) | Teendő a scope-hoz |
|---------|----------|---------------------|
| Tier-ek | `free/basic/pro/ultra` | **+`business`** (5.) a `Tier`-be + `TIER_ORDER`/`tierMeetsMin` |
| Kvóta-mérés | ✅ usageMeter + server/usage (contract) | kvóta-számok a mátrixra hangolva (§5) |
| Entitlement-tábla | részleges (tier + guardPro + storageQuota) | **explicit `ENTITLEMENTS[tier]`** tábla (kliens⇄szerver, contract-tesztelt) a §4 kulcsokkal |
| Szerver-autoritás | ✅ subscription.ts (Supabase) | a `business`/seat-ek + RBAC-scope bekötése |
| **Eszközön-render + vízjel** | iOS v1; **Android hiány** | **Android MediaCodec-motor** + **Free-vízjel** a render-láncban (#1 prioritás) |
| App-privát tár | ✅ `Paths.document` (sandbox) | data-loss-banner + „csak appból törölhető" UX megerősítés |
| Publish/ütemezés | részleges/scaffold | `publish.*` entitlement + OAuth-fiók-limit enforce |
| Analitika/planner/memory | magok készek (creator-OS) | `analytics.level`/`planner`/`creatorMemory` gate-elés |
| Céges (seats/RBAC/governance) | RBAC + workspace magok | `team.*`/`brandGovernance` entitlement + billing (per-seat) |

---

## 9. „Profi, ha" — Definition of Done a scope-ra

A scope **profi**, ha MINDEN fizetős képességre igaz:

- [ ] **nevesített entitlement** van rá (§4 kulcs), nem szórt `if (isPro)`;
- [ ] **egyetlen forrás** (`ENTITLEMENTS[tier]`) kliensen ÉS szerveren, **contract-teszttel** zárolva (nincs drift);
- [ ] **kliens-gate** (paywall/soft-warn) + **szerver-enforce** (autoritatív, kvóta) — a kliens sosem biztonsági határ;
- [ ] a **Free út 100% eszközön** megy (render/tár/AI), nulla felhő-függés;
- [ ] a **vízjel a render-láncban**, a szerver-hiteles szint szerint (kliensből nem kikapcsolható);
- [ ] a **felhő-művelet** (render/AI/publish/storage) túllépésnél **beszédes hibát** ad (nem néma), és paywallra visz;
- [ ] a tier-váltás (upgrade/downgrade) **azonnal** és **helyesen** nyit/zár minden entitlementet.

---

### Egy mondatban
**Minden fizetős dolog egy nevesített entitlement, egyetlen tier-mátrixból (kliens-gate UX-re, szerver-enforce +
kvóta a biztonságra, contract-teszttel zárolva); a Free pedig definíció szerint 100% eszközön fut (720p+vízjel,
app-privát tár) — ez a „felhő = fizetős" határvonal teszi a scope-ot egyszerre profivá és költség-biztonságossá.**
