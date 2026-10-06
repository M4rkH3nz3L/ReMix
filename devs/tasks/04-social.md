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
- [ ] 🟡 Block/mute (DM-oldalon részben van) → feed/komment-szintre is; ⬜ restrict + `@mention` + community + community-moderation.

### 2.2 Moderation UI — P1
- [ ] 🔌 DB-report-rendszer van → **admin UX**: reports/user/post/comment-moderáció + removal/ban/mute/**appeal** (security-backlog `10`).

### 2.3 For You ranking v2 — P1 (nagy)
- [x] ✅ **Ranker-mag + teszt**: [src/lib/feedRanking.ts](../../src/lib/feedRanking.ts) — `scorePost` (súlyozott engagement + completion + creator-/topic-affinity + exponenciális **freshness**-csökkenés half-life-fal + negatív-jel-büntetés) + `rankBy` (csökkenő pontszám, stabil) + `applyDiversity` (nem klaszterez egy alkotót). Teszt: `feedRanking.test.ts` (9). A hiteles scoring, amit a server-ranking/kliens használ. (A mai feed csak `promoted`+`created_at`.)
- [x] ✅ **BEKÖTVE (kliens)**: [feed.ts](../../src/lib/feed.ts) `rankForYou` — a `listFeed('foryou')` mostantól **rangsorol** (nem kronológikus): `postSignals` (engagement + frissesség az elérhető adatokból) → `rankBy` + `applyDiversity`; a `promoted` posztok elöl. A `latest`/`following` időrendi marad. Teszt: `feed.test.ts` (3) — promoted-first + engagement-rangsor + diverzitás.
- [ ] ⬜ **Hátra**: a hiányzó jelek GYŰJTÉSE (watch-time/completion/rewatch/affinity → a `PostSignals` feltöltése) + a ranking server-oldalra költöztetése (globális, nem csak a lap) + trending.

### 2.4 Collections / Library — P1
- [ ] 🟡 Like/save van → ⬜ **folders/collections/playlists** + creator-follow-preferences + personalized notifications.

### 2.5 Full search — P1
- [x] ✅ **Typo-tolerancia + autocomplete KÉSZ (2026-10-06)**: [universalSearch.ts](../../src/lib/universalSearch.ts) — korlátos Levenshtein (`editDistance` + `bestFuzzy`, hossz-függő hibaküszöb) → `scoreDocFuzzy` (a pontos egyezés szuperhalmaza, a fuzzy max 0.9 → exact mindig nyer) + a `search` **fuzzy-fallback**ja (csak ha a pontos keresés 0 találatot ad → a meglévő viselkedés változatlan) + `suggest` autocomplete (cím/kulcsszó-prefix + fuzzy-prefix, rangsorolva). **Bekötve** a ⌘K-palettába ([command.tsx](../../src/app/command.tsx): a fallback automatikus, a `suggest` „Erre gondoltál?" chipekként). Teszt: `universalSearch.test.ts` (+10: fuzzy-score + fallback + suggest).
- [ ] 🟡 Hátra: user/post/template/**hashtag search + hashtag-oldalak** + explicit filters + a feed-oldali (server) kereső typo-toleranciája (ma `searchFeed` ilike).

### 2.6 Template marketplace — P1
- [ ] ⬜ Template publish/preview/version + attribution + remix-count + analytics + marketplace-ranking (összeér [02](./02-monetization.md) §2.7-tel).

### 2.7 Remix Graph — P1
- [x] ~ **Graph-mag kész**: [src/lib/creativeGraph.ts](../../src/lib/creativeGraph.ts) — `lineage` (ancestry, ciklus-védett) + `descendants` + `remixOf`-élek a projekt-modellből, tesztelt ([[code-diff-core]] szomszéd: [[versions-core]]). (Az audit `main`-je elavult.)
- [ ] ⬜ **Hátra**: a graph **vizualizáció-UI** (fa-nézet) + poszt-szintű remix-lánc (a feed `remix_of_post_id`-ből) + attribution-badge.

### 2.8 Feed media pipeline — P1
- [ ] 🟡 Metaadat-oldal kész → 🎞️/🔌 **render→upload→poster→thumbnails→CDN→transcoding→moderation→publish** teljes prod-pipeline.

### 2.9 Multi-platform publishing — P1
- [ ] ⬜ TikTok/IG/YouTube/FB + aspect/title/desc/hashtags/thumbnail/**scheduling/OAuth/status/retry**. (A Live-multistream RTMP-útja ehhez mintát ad.)

### 2.10 Creator Studio — P1 (kritikus)
- [ ] ⬜ Content/post-management + **drafts** + analytics (views/retention/engagement/follower-growth/revenue/remix-analytics).

## 3. Kész, ha
A feed valódi **jelek** alapján rangsorol; a keresés user/post/template/hashtag fölött megy
autocomplete-tel; a template-marketplace-be publikálni + onnan remixelni lehet; a tartalom
multi-platformra ütemezhető; a Creator Studio-ban a kreátor látja a tartalom + közönség +
bevétel analitikáját; a moderáció admin-UI-ból kezelhető (block/mute/report/appeal).
