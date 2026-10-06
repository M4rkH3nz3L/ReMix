# 🌐 04. Social — P1

> **Forrás:** [audit](../source/audit-2026-10-main.md) §4. · **Testvér:** [02-monetization](./02-monetization.md) (template-marketplace), [01-production](./01-production-go-live.md) (feed-media/CDN), security-backlog `10` (moderation).
> **Érintett kód:** [src/lib/feed.ts](../../src/lib/feed.ts) · [src/lib/universalSearch*](../../src/lib/) · [src/app/index.tsx](../../src/app/) (feed) · [src/app/channel/[id].tsx](../../src/app/channel/) · [supabase/migrations/](../../supabase/migrations/) (posts/follows/reports).

---

## 0. Kontextus & cél
A social-core működik (feed, komment, like/save, follow, remix, DM, group-chat, notifications).
A **platform-szintű** réteg hiányzik: moderáció-UI, valódi recommendation-engine, keresés,
template-marketplace, remix-graph, multi-platform publishing, Creator Studio.

## 1. Jelenlegi állapot (bizonyíték)
- Feed = csatorna + TikTok-szerű feed; post = projekt VIEW-ja (snapshot→remix); média-upload +
  komment + owner-moderáció + remix soft-removal működik.
- Universal-search **core** van; like/save van; remix működik (de nincs teljes graph).
- **Nincs** block/mute/restrict/mention/community, moderation-UI, ranking-v2, collections,
  full-search, template-marketplace, multi-platform publish, Creator Studio.

## 2. Feladatlista

### 2.1 Block / mute / restrict / mentions / communities — P1
- [x] ✅ **Block/mute + feed/komment-szint + restrict MAG KÉSZ**: [blocks.ts](../../src/lib/blocks.ts) `isBlockedByMe`/`isMuted` (messaging, RLS-enforcement) **kiegészítve**: `filterBlocked` (a blokkolt szerzők elemeit elrejti feed/komment-szinten, kliens-oldalon) + `isCommentVisible` (**restrict** = lágy tiltás: a korlátozott szerző kommentje csak neki + a tulajnak látszik). `@mention`-kinyerés [collabComments.ts](../../src/lib/collabComments.ts) `extractMentions`. Teszt: `blocks.test.ts` (+4).
- [x] ✅ **Restrict-perzisztencia kód-komplett (2026-10-06)**: migráció [20261006140000_restricted_users.sql](../../supabase/migrations/20261006140000_restricted_users.sql) (`restricted_users` owner-only RLS, a `user_blocks`-mintát követve) + [blocks.ts](../../src/lib/blocks.ts) CRUD (`restrictUser`/`unrestrictUser`/`listMyRestrictedIds`) a kész `isCommentVisible` maghoz. ✅ **migráció LIVE prodon (2026-10-06, `restricted_users` létezik, REST-verifikált)**.
- [ ] 🖼️🔌 Hátra: a `filterBlocked`/`isCommentVisible` bekötése a feed/komment-lekérésbe (UI) + community + community-moderation.

### 2.2 Moderation UI — P1
- [ ] 🔌 DB-report-rendszer van → **admin UX**: reports/user/post/comment-moderáció + removal/ban/mute/**appeal** (security-backlog `10`).

### 2.3 For You ranking v2 — P1 (nagy)
- [x] ✅ **Ranker-mag + teszt**: [src/lib/feedRanking.ts](../../src/lib/feedRanking.ts) — `scorePost` (súlyozott engagement + completion + creator-/topic-affinity + exponenciális **freshness**-csökkenés half-life-fal + negatív-jel-büntetés) + `rankBy` (csökkenő pontszám, stabil) + `applyDiversity` (nem klaszterez egy alkotót). Teszt: `feedRanking.test.ts` (9). A hiteles scoring, amit a server-ranking/kliens használ. (A mai feed csak `promoted`+`created_at`.)
- [x] ✅ **BEKÖTVE (kliens)**: [feed.ts](../../src/lib/feed.ts) `rankForYou` — a `listFeed('foryou')` mostantól **rangsorol** (nem kronológikus): `postSignals` (engagement + frissesség az elérhető adatokból) → `rankBy` + `applyDiversity`; a `promoted` posztok elöl. A `latest`/`following` időrendi marad. Teszt: `feed.test.ts` (3) — promoted-first + engagement-rangsor + diverzitás.
- [x] ✅ **Trending (felkapott) mag + bekötés KÉSZ (2026-10-06)**: [feedRanking.ts](../../src/lib/feedRanking.ts) `trendingScore` (engagement-SEBESSÉG: `weightedEngagement / (ageHours+offset)^gravity`, Reddit/HN-stílus — nem személyre szabott) + `rankTrending`; **bekötve** a `'trending'` FeedMode-ba ([feed.ts](../../src/lib/feed.ts) `rankTrendingFeed` + `listFeed('trending')`, promoted-first + diverzitás). Teszt: `feedRanking.test.ts` (+6) + `feed.test.ts` (+2 — a friss-gyűjtő megelőzi a régi-nagyot).
- [x] ✅ **Jel-aggregáló mag KÉSZ (2026-10-06)**: [src/lib/viewSignals.ts](../../src/lib/viewSignals.ts) — a nyers nézési eseményekből (`ViewEvent`: watched/duration/viewer) `aggregateViews` (végignézés = min(1, watched/duration) átlag + újranézés-arány az egyedi nézőkből; anonim nézés nem hamis rewatch) + `aggregateByPost` + `mergeViewSignals` (a `completionRate`-et a feedRanking `PostSignals`-jébe fűzi). Teszt: `viewSignals.test.ts` (8). Lezárja a ranking jel-kontraktusát.
- [x] ✅ **Nézési-esemény tárolás kód-komplett (2026-10-06)**: migráció [20261006150000_post_view_events.sql](../../supabase/migrations/20261006150000_post_view_events.sql) (`post_view_events`: viewer-insert-own + owner/self-select RLS) + [feed.ts](../../src/lib/feed.ts) `recordViewEvent` (best-effort write) + `fetchViewEvents` (owner-analitika → `viewSignals` aggregálja). ✅ **migráció LIVE prodon (2026-10-06, `post_view_events` létezik, REST-verifikált)**.
- [ ] 🔌🖼️ Hátra: a lejátszó-instrumentálás (`recordViewEvent` hívása a nézéskor) + affinity-jel + a ranking server-oldalra költöztetése.

### 2.4 Collections / Library — P1
- [x] ✅ **Kód-komplett vertikum (2026-10-06)**: `folders/collections/playlists` a mentett posztokra — migráció [20261006130000_post_collections.sql](../../supabase/migrations/20261006130000_post_collections.sql) (`post_collections` owner + `post_collection_items`, owner-only RLS, kaszkád) + kliens [postCollections.ts](../../src/lib/postCollections.ts) (`normalizeCollectionName` pure + `parseCollections` §12.1-guard + CRUD). Teszt: `postCollections.test.ts` (6). Audit zöld.
- [x] ✅ **Migráció LIVE prodon (2026-10-06)**: a user `supabase db push --linked`-je felvitte; a `post_collections` + `post_collection_items` táblák **léteznek** (REST-verifikáció a service_role-lal, mert a CLI direct-connection innen IPv6-lóg).
- [ ] 🖼️ Hátra: collections-UI (a mentés-flow-ba) + creator-follow-preferences + personalized notifications.

### 2.5 Full search — P1
- [x] ✅ **Typo-tolerancia + autocomplete KÉSZ (2026-10-06)**: [universalSearch.ts](../../src/lib/universalSearch.ts) — korlátos Levenshtein (`editDistance` + `bestFuzzy`, hossz-függő hibaküszöb) → `scoreDocFuzzy` (a pontos egyezés szuperhalmaza, a fuzzy max 0.9 → exact mindig nyer) + a `search` **fuzzy-fallback**ja (csak ha a pontos keresés 0 találatot ad → a meglévő viselkedés változatlan) + `suggest` autocomplete (cím/kulcsszó-prefix + fuzzy-prefix, rangsorolva). **Bekötve** a ⌘K-palettába ([command.tsx](../../src/app/command.tsx): a fallback automatikus, a `suggest` „Erre gondoltál?" chipekként). Teszt: `universalSearch.test.ts` (+10: fuzzy-score + fallback + suggest).
- [x] ✅ **Hashtag-mag KÉSZ (2026-10-06)**: [src/lib/hashtags.ts](../../src/lib/hashtags.ts) — `extractHashtags` (szövegből `#tag`, kis-betű-érzéketlen dedup) + `canonicalTag` (csoportosító kulcs) + `countHashtags`/`topHashtags` (posztonként egyszer) + `filterByHashtag` (hashtag-oldal: kanonikus egyezés) + `trendingHashtags` (frissesség-súlyozott `1/(ageHours+offset)`, a feed-trendinggel összhangban). A `publishTargets.normalizeHashtag`-ot újrahasználja (egy forrás a tisztításra). Teszt: `hashtags.test.ts` (7).
- [x] ✅ **Hashtag-oldal UI KÉSZ (2026-10-06)**: [src/app/hashtag/[tag].tsx](../../src/app/hashtag/) — egy `#tag` publikus posztjai rácsban ([feed.ts](../../src/lib/feed.ts) `listPostsByHashtag` + `canonicalTag`), a feed-captionből a hashtagek **koppinthatók** (`/hashtag/<tag>`). tsc+lint zöld; futás az appban.
- [ ] 🖼️🔌 Hátra: trending-tagek a hashtag-oldalon (`trendingHashtags`) + user/template search + explicit filters + a feed-oldali (server) kereső typo-toleranciája.

### 2.6 Template marketplace — P1
- [x] ✅ **Marketplace-ranking mag KÉSZ (2026-10-06)**: [src/lib/marketplaceRank.ts](../../src/lib/marketplaceRank.ts) — `bayesianRating` (a kevés-szavazatú tétel a globális átlag felé húzva → 5★/1-review nem ver 4.8★/500-at) + `marketplaceScore` (letöltés-SEBESSÉG × minőség-szorzó × frissesség; a minőség sosem nullázza a sebességet → új tétel is látszik) + `rankListings`. A shop-adatból (`downloads`/`rating`) dolgozik; a `feedRanking` engagement-alapjától külön. Teszt: `marketplaceRank.test.ts` (7).
- [ ] 🖼️🔌 Hátra: template publish/preview/**version** (semver) + attribution (a `remixGraph`-ból) + a ranking bekötése a shop-listázásba (UI).

### 2.7 Remix Graph — P1
- [x] ~ **Graph-mag kész**: [src/lib/creativeGraph.ts](../../src/lib/creativeGraph.ts) — `lineage` (ancestry, ciklus-védett) + `descendants` + `remixOf`-élek a projekt-modellből, tesztelt ([[code-diff-core]] szomszéd: [[versions-core]]). (Az audit `main`-je elavult.)
- [x] ✅ **Poszt-szintű remix-lineage MAG KÉSZ (2026-10-06)**: [src/lib/remixGraph.ts](../../src/lib/remixGraph.ts) — a feed `remixOfId` (= `remix_of_post_id`) linkekből `buildRemixGraph` (gyökerek + gyerek-élek; a halmazon kívüli szülő gyökér) + `ancestorChain`/`remixDepth` + `descendants`/`descendantCount`/`directRemixCount` + `attribution` (eredeti mű + alkotó + mélység a badge-hez). **Minden bejárás ciklus-biztos** (köröző/önhurkos adat nem végtelen ciklus). Teszt: `remixGraph.test.ts` (6). (Külön a `creativeGraph.ts` AI-kontextus-gráftól.)
- [x] ✅ **Attribution-badge MÁR KÉSZ** (verify-first): a feed-poszt mutatja a `🔀 feed.remixOf {remixOfCreator}` jelzést ([index.tsx](../../src/app/index.tsx) caption-blokk) az immediate forrásra. A `remixGraph.ts` a MÉLYEBB fát (teljes lineage/depth/descendants) adja hozzá.
- [ ] 🖼️ **Hátra**: a graph **vizualizáció-UI** (fa-nézet a `remixGraph`-ból) — a sima badge-en túl.

### 2.8 Feed media pipeline — P1
- [ ] 🟡 Metaadat-oldal kész → 🎞️/🔌 **render→upload→poster→thumbnails→CDN→transcoding→moderation→publish** teljes prod-pipeline.

### 2.9 Multi-platform publishing — P1
- [x] ✅ **Platform-adapter mag KÉSZ (2026-10-06)**: [src/lib/publishTargets.ts](../../src/lib/publishTargets.ts) — `PLATFORM_SPECS` (TikTok/IG/YouTube/FB: cím/leírás-limit, hashtag-plafon, ajánlott aspect, short-form max hossz) + `normalizeHashtag(s)` (vezető-#/érvénytelen-karakter szűrés + case-insensitive dedup) + `adaptForPlatform` (a posztot a platform szabályaihoz igazítja: cím külön mezőbe VAGY a leírás elejére, hashtagek a leírás végére a limit megtartásával, **kemény** szöveg-vágás + figyelmeztetés; aspect/hossz csak warn) + `adaptAll`. Így a feltöltés ELŐTT látszik, mi megy fel + mit vágott. Teszt: `publishTargets.test.ts` (13).
- [ ] 🔌 Hátra: **scheduling + OAuth + feltöltés + státusz/retry** per platform (backend; a Live-multistream RTMP-útja mintát ad) + a preview-UI a variánsokra/figyelmeztetésekre.

### 2.10 Creator Studio — P1 (kritikus)
- [x] ~ **Analitika-magok KÉSZ**: a TARTALOM-teljesítmény [analytics.ts](../../src/lib/analytics.ts) (`summarize`/`breakdownBy`/`topPerformers`/`whyItWorked`/retention/engagement; [[analytics-core]]) + a CSATORNA-szint [src/lib/creatorAnalytics.ts](../../src/lib/creatorAnalytics.ts) (2026-10-06): `remixAnalytics` (totalRemixes/remixRate/remixedShare/topRemixed a saját posztokból) + `followerGrowth` (nettó + napi ráta + legjobb felfutás egy pillanatkép-sorozatból, determinisztikus). Teszt: `creatorAnalytics.test.ts` (7).
- [x] ~ **Alap-összesítő MÁR megjelenik** (verify-first): a csatorna ([channel/[id].tsx](../../src/app/channel/)) mutatja a `▶ views · ♥ likes · 🔀 remixes` stripet ([promotion.ts](../../src/lib/promotion.ts) `creatorTotals`).
- [ ] 🖼️🔌 Hátra: dedikált **dashboard-UI** a mélyebb magokra (`creatorAnalytics` remix-ráta/followerGrowth, `analytics.summarize`) + content/post-management + **drafts** + a follower-pillanatképek/revenue-sorozat gyűjtése (perzisztencia).

## 3. Kész, ha
A feed valódi **jelek** alapján rangsorol; a keresés user/post/template/hashtag fölött megy
autocomplete-tel; a template-marketplace-be publikálni + onnan remixelni lehet; a tartalom
multi-platformra ütemezhető; a Creator Studio-ban a kreátor látja a tartalom + közönség +
bevétel analitikáját; a moderáció admin-UI-ból kezelhető (block/mute/report/appeal).
