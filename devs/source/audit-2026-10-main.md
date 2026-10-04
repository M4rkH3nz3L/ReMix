# ReMix — teljes funkcionalitási audit (forrás)

> **Ez a forrás-dokumentum.** A belőle levezetett, feladatokra bontott fejlesztési
> terv a [devs/tasks/](../tasks/00-README.md) alatt él (témánként számozott TODO-fájlok).
> **Audit-scope:** mobil editor + image studio + audio studio + social + collaboration
> + AI + storage + rendering + monetizáció + production.
> **Kiindulás:** a `main` 2026-09-29-i commit (`tsc 0` / lint 0 / 73 suite / 851 teszt
> zöld). ⚠️ A zöld audit **nem** jelenti a funkcionális teljességet: sok „pure core"
> kész, de az **UI / worker / backend / production** integráció hiányzik.

---

## 0. Rövid diagnózis

A ReMix nem egyszerű MVP. A kódban már létezik (feature-core szinten): multi-track
video editor, timeline, trim/split/duplicate/undo-redo, video/image/audio/text/
interactivity, playback clock, captions, speed, filters, transitions-modell, masks,
keyframe core, curves, scopes, LUT import core, audio mixer core, TTS, AI assistant,
auto-edit core, image editor core, SVG import/export, vector path core, adjustment
stack, layer effects, pattern fill, rulers/guides core, social feed, comments,
likes/saves, follows, remix, notifications, DM, group chat, collaboration presence,
live command sync, storage gateway, S3/WebDAV infra, cloud render queue, render
workers, billing foundation, creator profile, wallet/gifts/payout adatmodell,
Creator Memory / Asset Library / Workspace / Creative Graph core.

**A fő probléma — egyetlen mondatban:**

> A ReMixben jelenleg sokkal több a „feature core", mint a teljes, felhasználó által
> végigjárható (integrált) feature.

```text
PURE CORE → TEST → ❌ UI integráció → ❌ preview parity → ❌ render parity
          → ❌ cloud/sync → ❌ billing/RBAC → ❌ production QA
```

**A legnagyobb fejlesztési érték most nem újabb 100 AI-feature, hanem a meglévő magok
végigvezetése ezen a láncon.** Hét kritikus technikai fókusz:

1. **Asset architecture** — `uri → assetId`
2. **Command architecture** — minden módosítás: `UI → Command → Store → Event → Sync`
3. **Render parity** — `Preview == Export`
4. **Cloud asset architecture** — `Asset → Storage → CDN → Render → Publish`
5. **Capability system** — `Free → Basic → Pro → Ultra`
6. **Collaborative state** — `Operation → Sync → Conflict resolution`
7. **Production observability** — `User action → telemetry → cost → failure → recovery`

---

## 1. 🔴 Production / Go-Live — 7 hiány (P0)

1. **Hosztolt Supabase** — HIÁNYZIK: prod projekt, prod migration push, prod Storage,
   prod RLS-validáció, backup, restore-teszt, prod domain, prod secrets.
2. **Production render worker** — RÉSZBEN: van engine + BullMQ worker; hiányzik a prod
   Docker image (FFmpeg/Whisper/Chromium/ONNX runtime), persistent temp/storage
   stratégia, deployment, health monitoring, autoscaling, crash recovery, prod smoke-test.
3. **EAS production build** — HIÁNYZIK: EAS projekt-ID véglegesítés, prod environment,
   iOS/Android build, App Store / Google Play konfiguráció, push + IAP entitlementek,
   native render capability-tesztek.
4. **RevenueCat production** — FOUNDATION kész; hiányzik: App Store / Google Play
   products, havi/éves subscription, prod webhook, entitlement mapping, restore/
   cancellation/refund tesztek.
5. **Production secret management** — RÉSZBEN; hiányzik a prod véglegesítés: refresh
   token SecureStore, BYOK secret, worker secrets, service-role, Anthropic key, RC
   webhook secret, HTTPS-enforcement minden prod komponensen.
6. **Push notification production** — FOUNDATION; hiányzik: EAS ID, APNs, FCM, fizikai
   build, device-token prod-regisztráció, permission-flow, background notif teszt, deep-link.
7. **Production worker secrets** — HIÁNYZIK: Anthropic, service-role, RC webhook, S3,
   Redis, storage-provider secrets.

## 2. 💰 Monetizáció — 10 hiány

2.1 **Free/Basic/Pro/Ultra tier** (capability.minTier, nem `if pro`) · 2.2 **Usage metering**
(AI token/credit, render minutes, storage GB, export count → `usage_counters`) · 2.3 **Havi
quota reset** (pg_cron + expired cleanup + failed payment) · 2.4 **Basic/Ultra csomagok**
(tényleges entitlementek) · 2.5 **AI credit top-up** (credit wallet + consumable IAP + ledger
+ overage + idempotency) · 2.6 **Queue priority** (Ultra>Pro>Basic>Free) · 2.7 **Marketplace
asset upload** (upload/preview/metadata/moderation/copyright/takedown/versioning) · 2.8 **Creator
payout** (Stripe Connect + KYC + tax + payout-status + fraud) · 2.9 **Promotion/influencer
codes** (coupon/creator-code/campaign/expiry/limit/attribution) · 2.10 **Anti-abuse/rate-limit**
(IP/user/endpoint + AI/render/upload/storage abuse + bot detection).

## 3. 👥 Collaboration — 6 hiány (a mag jó)

3.1 **Clip locking** (lock owner/TTL/heartbeat/release/stale-recovery) · 3.2 **Timeline
comments** (project/track/clip/timestamp/author/resolved) · 3.3 **Review mode** (reviewer/
approve/request-changes/revision) · 3.4 **Shared media sync** (asset upload/shared-id/cloud/
checksum/download+upload+conflict+offline state) · 3.5 **CRDT/OT** (operation log/conflict
resolution/deterministic merge/revision-id/rollback/replay — ma last-write-wins) · 3.6 **Finom
RBAC** (OWNER/EDITOR/COMMENTER/VIEWER + project/asset/chat/export/invite permissions).

## 4. 🌐 Social — 10 hiány

4.1 **Block/mute/restrict/mentions/communities** · 4.2 **Moderation UI** (reports/user/post/
comment/removal/ban/mute/appeal) · 4.3 **For You ranking v2** (watch-time/completion/rewatch/
likes/saves/shares/follows/affinity/negative/trending/freshness/diversity) · 4.4 **Collections/
Library** (folders/collections/playlists — like/save van) · 4.5 **Full search** (user/post/
template/hashtag + ranking/filters/autocomplete/typo-tolerance) · 4.6 **Template marketplace**
(publish/preview/version/attribution/remix-count/analytics/ranking) · 4.7 **Remix Graph**
(ancestry/descendants/chain/visualization) · 4.8 **Feed media pipeline** (render→upload→poster→
thumbnails→CDN→transcoding→moderation→publish) · 4.9 **Multi-platform publishing** (TikTok/IG/
YouTube/FB + aspect/title/desc/hashtags/thumbnail/scheduling/OAuth/status/retry) · 4.10 **Creator
Studio** (content/post/drafts + analytics/audience/views/retention/engagement/revenue).

## 5. 🤖 AI — 11 hiány (ma „AI-enabled editor", nem Creator OS)

5.1 **AI Context Builder** (global/relevant/current context) · 5.2 **Semantic index**
(transcript/scene/clips/objects/people/topics/timestamps/embeddings) · 5.3 **AI memory**
(project-state/semantic/user-intent/conversation-decisions) · 5.4 **AI Understand** (diarization/
filler/quality/pacing/emotion/story) · 5.5 **AI Select** (semantic select/object/face/best-shot)
· 5.6 **AI Edit** („make it more engaging"/whitelist/rough-cut/auto-shorts/multi-variant) · 5.7
**AI Publish** (variants/localization/captions/translation/dubbing/music/B-roll/A-B) · 5.8 **Cloud
TTS** (voice/multilingual/metering/cache — a `macOS say` dev-only) · 5.9 **On-device AI** (on-
device/server/hybrid döntés — Whisper/ONNX/SLM) · 5.10 **AI model distribution** (registry/
download/checksum/version/cache) · 5.11 **AI Personas** (Director/Editor/Music/Color/Social/Producer).

## 6. 🎬 Video Editor — 11+ hiány (Premiere/CapCut-szint cél)

6.1 **Keyframe** (RÉSZBEN: rotation/opacity channel, Bézier render-pipeline, preview/render
parity) · 6.2 **Profi color grading** (RGB curves/HSL/3-way wheels/scopes-workflow/LUT-pipeline/
render parity) · 6.3 **Freeze frame + reverse** (HIÁNYZIK) · 6.4 **Animated masks** (geometry/
expansion/tracking/render parity) · 6.5 **Effect chain** (sorrendfüggő pipeline) · 6.6 **Transform**
(anchor/crop/skew/perspective) · 6.7 **Profi audio UI** (EQ/comp/limiter/pan/normalize/noise/
sidechain/automation — core kész) · 6.8 **GIF** (import/preview/timeline/render) · 6.9 **Proxy/
perf engine** (background proxy/lifecycle/cache/invalidation/size-mgmt) · 6.10 **Editor refactor**
(`uri→assetId` + Command Bus) · 6.11 **Creative Canvas** (crop/resize/perspective/outpaint/
retouch/tracking/depth-occlusion).

## 7. 🎨 Image Studio — 9 hiány (pure core erős, UI-bekötés hiányos)

7.1 **Vector pen UI** · 7.2 **Effects panel UI** · 7.3 **Adjustment stack UI** · 7.4 **Rulers/
guides UI** · 7.5 **Pattern picker UI** · 7.6 **Boolean ops UI** (union/subtract/intersect/
exclude/divide) · 7.7 **Align/distribute UI** · 7.8 **PSD import** (worker: PSD→layers→ImageDoc)
· 7.9 **Illustrator/PDF + PSD export**. (Az 1–7 CORE KÉSZ / UI HIÁNYZIK.)

## 8. 🗄️ Storage / Asset Management — 7 hiány (a MISSING.md ezen része részben ELAVULT)

8.1 **StorageProvider** (`storageProviders.ts` LÉTEZIK — hiány: upload/lifecycle/full-abstraction/
prod-hardening) · 8.2 **Asset state machine** (External→Cached→Imported + eviction/offline/stale)
· 8.3 **Drive/Dropbox/OneDrive/S3** (Drive/Dropbox/WebDAV/S3 VAN — **OneDrive adapter HIÁNYZIK**)
· 8.4 **WebDAV/NAS** (alap kész — credentials-lifecycle/reconnect/timeout/offline hardening) ·
8.5 **`.ReMix` projektfájl** (a `videdFile.ts` már `.remix`-et ad — doksi-egységesítés `.ReMix`-re)
· 8.6 **External file versioning** (remote-changed → use-new/keep/compare) · 8.7 **Collaborative
storage permissions** (project/personal/shared + asset-level).

## 9. ⚙️ Native / Rendering — 6 hiány

9.1 **Skia render backend** (a Chromium-text/shape nem ideális mobil-preview) · 9.2 **Native
FFmpeg** (mobil local render) · 9.3 **On-device ONNX** (szerver-ONNX van, mobil runtime nincs)
· 9.4 **Desktop shell** (Tauri/Electron — „telefonon és gépen ugyanaz") · 9.5 **AI avatar/voice-
clone/video-gen** (P2; voice-clone: consent/identity/abuse/watermark) · 9.6 **watchOS** (opcionális,
nem launch-blocker).

## 10. 🎨 Brand / UI — 8 hiány

10.1 **Unified design token system** (RÉSZBEN) · 10.2 **Component library** (Text/Button/Surface/
Chip/Sheet/Toast/Skeleton/VideoCard/CreatorCard/Badge) · 10.3 **Remix signature transition**
(chromatic split + blur + scale + haptic + sound) · 10.4 **Unified logo/icon system** (RÉSZBEN)
· 10.5 **Teljes screen redesign** (Feed/ForYou/Player/Editor/Timeline/Export/Profile/Discover/
Comments) · 10.6 **Loading/error/empty state system** (loading/success/empty/error/retry/offline)
· 10.7 **Motion system** (duration/easing scale/reduced-motion/gesture+screen transitions) ·
10.8 **Accessibility** (44pt targets/labels/screen-reader/contrast/focus/dynamic-text/reduced-motion).

## 11. 🚀 Performance — 5 hiány

11.1 **Timeline 60 Hz reconciliation** (selector-subscription/imperative-scroll/memoized ruler+
beat+gaps) · 11.2 **projectDuration cache** (`WeakMap<Project,duration>` / strukturális
invalidation) · 11.3 **Auto-version optimalizáció** (felesleges storage-read a throttle előtt) ·
11.4 **Preview player writes** (per-frame player/audio-state írás csökkentése) · 11.5 **HistoryModal**
(ne legyen mindig mountolva).

## 12. 🧱 Code quality / robustness — 9 hiány

12.1 **HTTP response validation** (`as SomeType` helyett unknown→schema→typed) · 12.2 **Retry/
backoff** (`netRetry.ts` VAN — hiány: egységes policy minden kritikus path-on: backoff/jitter/
idempotency/max-attempts/Retry-After) · 12.3 **Render cancellation** (AbortSignal → FFmpeg kill
→ temp cleanup → UI reset) · 12.4 **UI rollback** (like/save/follow/purchase optimistic után) ·
12.5 **Async race protection** (generation token/alive-guard/cancellation/stale-reject) · 12.6
**Timer cleanup** (CameraRecorder/editor-timeouts/polling/listeners) · 12.7 **Cache limits**
(globális LRU + max-bytes + max-items + TTL) · 12.8 **Event log size** (teljes `clips[]` snapshot
eventként veszélyes → patch-events/compaction/checkpoint/pruning) · 12.9 **Large-file refactor**
(`AssistantPanel.tsx` + editor store → UI→Command→Pure→Store).

## 13. 📚 Documentation / Engineering — 5 hiány

13.1 **ADR discipline** (ADR 001–010 van — új feature-ökhöz tovább) · 13.2 **Architecture docs**
(sync a kóddal) · 13.3 **Architecture diagrams** (Mermaid: Mobile→API→Supabase→Queue→Workers→
Storage/CDN; külön editor/AI/collab/render/storage) · 13.4 **Client/worker contract tests**
(/request//response//error//status séma-validáció — OpenAPI/JSON Schema) · 13.5 **Cost
observability** (revenue − render/storage/AI/bandwidth cost = margin; dashboard R2/S3/Supabase/
Redis/AI/render/CDN/RevenueCat).

## 14. 🔥 Legfontosabb rejtett hiány

**Feature ≠ integrated feature.** Pure-core kész, de az UI/render/product-workflow hiányzik:
vector-path/adjustment-stack/pattern-fill/boolean (UI), automation (render/UI), LUT (preview/
render pipeline), AI-core (product-workflow).

## 15–18. Prioritás-mátrix

- **P0 (go-live blokkoló):** prod Supabase, prod worker, EAS iOS+Android, RevenueCat prod, push
  prod, secure secrets, prod storage/CDN, render smoke-test, upload→render→publish pipeline,
  crash/error monitoring, rate-limiting, client/worker contract-tesztek.
- **P1 (valódi editor):** keyframe render-parity, color-grading, mask-animation, effect-chain,
  freeze/reverse, profi audio UI, proxy-engine, render-cache, Creative Canvas, Image Studio UI,
  SVG/vector-workflow, PSD-import, PDF/PSD-export, shared-media-collab, clip-locking, review-mode,
  full-RBAC, Creator Studio, search, recommendation-engine.
- **P2 (AI Creator OS):** Context Builder, Semantic Index, AI Memory, diarization, semantic-select,
  object-search, AI rough-cut, auto-shorts, social-variants, dubbing, cloud-TTS, AI-music/B-roll,
  AI-personas, on-device-AI, model-marketplace.
- **P3 (platform expansion):** desktop shell, native mobile FFmpeg, Skia backend, ONNX-mobile,
  AI-avatar, voice-clone, AI-video-gen, watchOS.

## 19. Audit-verdict (becsült készültség — NEM hivatalos pontszám)

```text
Editor core (alapfunkció)   ~70–80%
Profi NLE                   ~45–60%
Image editor                ~45–60%  (pure core magasabb)
Audio editor                ~40–55%
Social                      ~60–70%
Collaboration               ~60–70%
AI                          ~45–60%
Production infrastructure   ~35–50%
Monetization                ~30–40%
Production readiness        ~30–40%
```

## 20. Következtetés + a következő auditlépés

A ReMix nem a kevés kód miatt van messze a késztől — épp ellenkezőleg: sok irányban
elindult a „profi platform" magja, de a **következő réteg** (UI→parity→cloud→billing→QA)
nincs mindenhol kész. **A `MISSING.md` nem végleges truth-source** — több pontja elavult
vagy részben megvalósult (StorageProvider, Drive/Dropbox/WebDAV/S3, `.remix` fájl, retry
infra, SVG-import, LUT-core).

**A következő auditlépés:** a ~105 nyitott tételt egyenként összevetni a tényleges
forráskóddal (**kód → UI → backend → worker → DB → teszt**), és mindegyikre végleges
státuszt adni: **`DONE / PARTIAL / MOCK / UI-MISSING / BACKEND-MISSING / RENDER-MISSING /
NOT IMPLEMENTED`**, plusz fájl + függvény szintű implementációs feladatot.
