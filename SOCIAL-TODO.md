# vided — SOCIAL fejlesztési TODO (TikTok-szerű feed, szerkeszthető videókkal)

> Architektúra: [devs/SOCIAL.md](devs/SOCIAL.md) · Fázisterv: [devs/full-plan.md](devs/full-plan.md) (F1 identity, F4 social MVP, F5 remix) · Állapot: [FUNC.md](FUNC.md)
>
> **A vided nem „TikTok-klón”.** A feed nem videókat, hanem **szerkeszthető projekteket** mutat.
> Minden poszttal utazik a `.vided` projekt (asset-ujjlenyomatokkal) — így a feed bármelyik
> videója egy koppintással megnyílik/remixelhető a **saját editorban**. Ez a differenciátor.
>
> ```
> EDITOR → Publish → FEED → (Like/Comment/Chat) → Remix → EDITOR → Publish …
> ```
> A hurok zárt: a fogyasztás és az alkotás ugyanaz a projektmodell két nézete.

## Vezérelvek (kötelező minden social-taskra)

1. **A Project Model az igazság forrása** — a poszt a projektre hivatkozik, nem egy különálló videórekord. A feed, a profil, a chat és a remix ugyanannak a `.vided`-nek a nézetei.
2. **Újrahasznosítás, nem újraírás** — a publish/remix a MEGLÉVŐ infrára épül: `.vided` export/import, `md5+méret` asset-identitás, auto-relink, Collect Project zip, render worker. Ne épüljön párhuzamos média-pipeline.
3. **Event-driven backend** — minden fontos történés event (`PostPublished`, `PostLiked`, `UserFollowed`, `ProjectRemixed`, `RenderFinished`); a notification / feed-ranking / analytics / AI erre iratkozik fel, nem hívogatják egymást.
4. **Safety az első adatmodellben** — `report`, `block`, `mute`, `moderation_status` már az M0 sémákban benne, nem utólag.
5. **Server-authoritative média** — a nyers asset és az auth a workeren/backenden marad, a kliens sosem lát titkot (a storage-gateway mintája szerint).

---

## Backend-stack döntés — ✅ Supabase (megvalósítva)

A realtime + valódi auth + „Postgres a lehető legoptimálisabban" + kevés boilerplate
alapján **Supabase** lett a backend (ez *maga* a Postgres, köré Auth/Realtime/Storage/RLS-sel).

- **DB:** PostgreSQL (Supabase) — RLS, denormalizált számlálók triggerrel, keyset-lapozás, feed-RPC-k.
- **Auth:** Supabase Auth (email+jelszó; OAuth bővíthető) — session AsyncStorage-ban, auto-refresh.
- **Realtime:** Supabase Realtime (`postgres_changes`) — élő számlálók (`posts` UPDATE),
  friss-poszt jelző (`posts` INSERT), élő kommentek (`comments` INSERT).
- **Storage:** Supabase Storage — `videos` + `posters` bucketek (publikus olvasás, hitelesített feltöltés).
- **Render/AI:** a meglévő Express worker marad — tiszta szétválasztás (compute vs. data/auth/realtime).
- **Futtatás (dev):** `supabase start` (Docker); a kliens az `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY`
  env-ből (`.env`, lásd `.env.example`). Séma: [supabase/migrations/](supabase/migrations/).
- **Push (később):** Expo Push Notifications a `notifications` táblára.

---

## Mérföldkövek áttekintés (build-sorrend)

| MK | Cím | Miért ekkor | Függ |
|----|-----|-------------|------|
| **M0** | Adatmodell + backend-csontváz | minden más előfeltétele | — |
| **M1** | Identity (fiók, profil, session) | social semmi sincs user nélkül | M0 |
| **M2** | Publish flow (editor → poszt) 🚩 | **a differenciátor magja** — a `.vided` a poszttal utazik | M1 |
| **M3** | Feed (TikTok-szerű függőleges) | a fogyasztási felület | M2 |
| **M4** | Remix / „Edit this video” 🚩 | **a második differenciátor** — feed-videó → editor | M2, M3 |
| **M5** | Engagement (like/save/komment) | interakció + algoritmus-jelek | M3 |
| **M6** | Social graph (follow/block/mute) | Following-feed + profil | M1, M3 |
| **M7** | Értesítések (event → in-app + push) | visszacsatolási hurok | M5, M6 |
| **M8** | Keresés + hashtag + felfedezés | discovery | M3, M6 |
| **M9** | Moderáció + admin | safety élesítés | M0, M5 |
| **M10** | Chat + editor-integráció (időbélyeges megosztás) | F5 — realtime | M6 |
| **M11** | Feed-ranking v2 (For You) + analytics | személyre szabás | M5, M6 |

🚩 = a vided-egyedi érték. Ha szűkösen indulunk, a **minimum életképes social = M0→M1→M2→M3→M4→M5** (feed + publish + remix + like/komment).

---

## ✅ Implementáció (kész — valódi Supabase backend)

A **feed-nézet + a Studio→publish→feed→remix hurok valódi backenddel** működik:
Postgres + Auth + Realtime + Storage. A backendet REST/curl smoke-teszt igazolta
(signup → profil-trigger → RLS-insert → feed-RPC → like/komment-számlálók → értesítés).

| Terület | Fájl | Mi működik |
|---|---|---|
| **DB-séma (M0)** | [supabase/migrations/](supabase/migrations/20260907120000_social_core.sql) | profiles/posts/follows/likes/saves/comments/views/notifications/reports; számláló-triggerek; RLS mindenhol; realtime-publikáció; feed-RPC-k; Storage-bucketek+policy |
| Adatmodell (kliens) | [src/types/social.ts](src/types/social.ts) | `FeedPost` (a projektre mutat: `projectSnapshot`), `Creator`, `Comment`, engagement, `remixOf`, `moderationStatus` |
| Supabase-kliens | [src/lib/supabase.ts](src/lib/supabase.ts) | URL a hostUri-ból (:54321) / env; AsyncStorage-session, auto-refresh |
| **Auth (M1)** | [src/store/authStore.ts](src/store/authStore.ts) · [src/app/auth/index.tsx](src/app/auth/index.tsx) | signUp/signIn/signOut, session-figyelő; belépés/regisztráció képernyő; **gate** a feeden/profilon |
| Feed-repo (M3/M5/M6) | [src/lib/social/feedRepo.ts](src/lib/social/feedRepo.ts) | `get_feed`/`get_for_you` RPC (poszt+szerző+liked/saved egy körben), like/save/view, follow, komment |
| Publish (M2 🚩) | [src/lib/social/publish.ts](src/lib/social/publish.ts) | **render/gyors választó** (teljes worker-render **vagy** nyers klip), videó→`videos`, borító→`posters`, **projekt-média→`assets`** (hash-dedup), poszt-insert (cloud-snapshot JSONB) |
| Cross-device asset (M4 🚩) | [src/lib/social/assets.ts](src/lib/social/assets.ts) | `uploadProjectAssets` (md5-kulcs + HEAD-dedup, uri→felhő-URL) · `rehydrateProjectAssets` (letöltés → uri→lokális) |
| Remix (M4 🚩) | [src/lib/social/publish.ts](src/lib/social/publish.ts) | poszt → **új projekt bármely eszközön** (rehidratálás), `register_remix` RPC (számláló+értesítés) |
| Feed-nézet (M3) | [src/app/feed/index.tsx](src/app/feed/index.tsx) | függőleges lapozó, Neked/Követett/Friss, **realtime** (élő számlálók + friss-poszt pill), view-tracking |
| Videó-item (M3) | [src/components/feed/FeedVideoItem.tsx](src/components/feed/FeedVideoItem.tsx) | `expo-video` autoplay, dupla-kopp = like, akciósor + **✂️ Remix**, némítás, progress |
| Kommentek (M5) | [src/components/feed/CommentsSheet.tsx](src/components/feed/CommentsSheet.tsx) | lista + hozzászólás, **realtime INSERT** a nyitott posztra |
| Profil (M1) | [src/app/profile/index.tsx](src/app/profile/index.tsx) | avatar/statisztika (videó/követő/követett) + saját posztok rács + kijelentkezés |
| Belépési pontok | [src/app/index.tsx](src/app/index.tsx) · [src/app/editor/[id].tsx](src/app/editor/[id].tsx) | home **Feed** tab + gomb; editor **Közzététel** gomb (bejelentkezés-ellenőrzéssel) |
| **Értesítés-központ (M7)** | [src/lib/social/notifications.ts](src/lib/social/notifications.ts) · [src/app/notifications/](src/app/notifications/index.tsx) | lista (típus-ikon+actor+poszt-bélyeg), olvasott/olvasatlan, **élő badge** a feed tetején, markAllRead |
| **Profilok (M6)** | [src/components/profile/ProfileView.tsx](src/components/profile/ProfileView.tsx) · [src/app/profile/[id].tsx](src/app/profile/[id].tsx) · [src/lib/social/profile.ts](src/lib/social/profile.ts) | bármely user (get_profile RPC), Követés + Üzenet, videó-rács; a feed creatorja koppintható |
| **Kereső (M8)** | [src/app/search/](src/app/search/index.tsx) · [src/app/hashtag/[tag].tsx](src/app/hashtag/[tag].tsx) · [src/app/post/[id].tsx](src/app/post/[id].tsx) | Userek/Hashtagek/Videók (search_hashtags RPC + ilike), hashtag-oldal, single-videó nézet |
| **Chat (M10)** | [src/lib/social/chat.ts](src/lib/social/chat.ts) · [src/app/chat/](src/app/chat/index.tsx) · [src/app/chat/[id].tsx](src/app/chat/[id].tsx) | DM (get_or_create_dm), **realtime** üzenetek, olvasás-jelölés, **poszt-megosztás** csatolmányként |
| **Moderáció (M9)** | [src/lib/social/moderation.ts](src/lib/social/moderation.ts) · migráció | letiltás/némítás (feed-RPC szűr, kétirányú), jelentés (profil „…"/feed long-press/komment long-press), **auto-elrejtés 3 jelentésnél** (trigger) |
| **For You-ranker v2 (M11)** | migráció (`get_for_you`) | személyre szabott: +follow-boost, +hashtag-affinitás, −seen-levonás (kliens-változás nélkül) |
| **Komment-szálak + kedvelés (M5)** | [src/components/feed/CommentsSheet.tsx](src/components/feed/CommentsSheet.tsx) · migráció | válasz (parent_id, 2 szint, behúzva), komment-kedvelés (`comment_likes` + trigger), `get_comments` RPC (author+liked) |

**Hátra (backend-igényes/következő):** OAuth (Google/Apple), cloud project-sync,
push-értesítések (M7), keresés/hashtag (M8), admin/moderáció-UI (M9), chat (M10),
For You-ranker finomítás (M11). *(A render-on-publish és a cross-device remix
asset-rehidratálás **kész** — a teljes idővonal renderelhető közzétételkor, és a
remixelt projekt bármely eszközön szerkeszthető.)*

---

## M0 — Adatmodell + backend-csontváz

- [ ] **DB-séma v1** (PostgreSQL, migrációkkal): `users`, `profiles`, `sessions`, `posts`, `post_media`, `post_project` (a `.vided`-re mutat), `post_tags`, `likes`, `saves`, `comments`, `follows`, `blocks`, `mutes`, `notifications`, `reports`, `moderation_actions`, `remix_edges` (remix-lánc). (SOCIAL §26)
- [ ] **Poszt ↔ projekt kötés a sémában**: `posts.project_id` + `posts.project_snapshot_uri` (a publikált `.vided` verzió) + `posts.remix_of_post_id`. **Ez a differenciátor sémaszinten.**
- [ ] **Event tábla + kibocsátó**: `events(actor, type, payload, created_at)` — minden mutáció eventet ír; a fan-out (notification/feed/analytics) erre iratkozik.
- [ ] **NestJS csontváz**: modulok `auth / users / posts / feed / engagement / social / notifications / moderation`; közös `AuthGuard`, hibaformátum, rate-limit.
- [ ] **S3 + queue init**: bucket-konvenció (`renders/`, `thumbnails/`, `projects/`, `assets/`), BullMQ-sorok (`render`, `transcode`, `notify`).
- [ ] **Kliens API-réteg**: `src/lib/api/` (fetch-wrapper token-kezeléssel, típusok a `src/types/`-ből), env-alapú base-URL (mint a worker `hostUri`).

**Kész, ha:** üres NestJS fut, migráció lemegy, egy dummy `POST /posts` sorba tesz egy eventet, a kliens el tudja érni.

---

## M1 — Identity (fiók · profil · session)

*(full-plan F1 „Auth/Identity minimum” + SOCIAL §2–3)*

- [x] **Regisztráció**: email+jelszó (Supabase Auth), username-foglalás + ütközés-feloldás a DB-triggerben, display name. *(Google/Apple: bővíthető.)*
- [x] **Belépés + session**: Supabase JWT access+refresh, session AsyncStorage-ban, auto-refresh. *(aktív sessionök/„minden eszközről ki”: később.)*
- [x] **Profil (creator)**: avatar-badge, statisztika (videó/követő/követett), saját posztok rácsa, kijelentkezés. *(cover/bio-szerkesztő: hátra.)*
- [x] **Kliens auth-store** (zustand): bejelentkezett user + profil, session-figyelő, gate a social-képernyőkön, kijelentkezés.
- [ ] **Cloud project-sync**: a projekt-`.vided` mentése a fiókhoz — a poszt már hordozza a snapshotot; a teljes eszközök-közti sync hátra.

**Kész, ha:** telefonról regisztráció → belépés → profil → közzététel a fiókban. **(Backend + kliens kész; a teljes UI-loop kézi teszttel.)**

🔑 **Döntés (later):** OAuth-szolgáltató (Google/Apple kulcsok), email-verifikáció élesben (dev-ben kikapcsolva).

---

## M2 — Publish flow (editor → poszt) 🚩

*A differenciátor magja. A poszt nem „egy MP4”, hanem MP4 + thumbnail + a szerkeszthető `.vided` projekt + asset-ujjlenyomatok.*

- [x] **„Közzététel” gomb** (editor-fejléc) render/gyors választóval: **🎬 Teljes render** (a worker legyártja a kész vágott MP4-et, progressz-overlay, graceful fallback ha a worker nem fut) **vagy ⚡ gyors előnézet** (nyers első klip) → poszt a feedbe, a projekt **snapshotjával a remixhez**.
- [x] **Poszt-metaadat**: cím + címből képzett hashtagek + borító (első kocka), láthatóság alapból `public`. *(teljes űrlap — leírás/zene/thumbnail-választó: hátra.)*
- [x] **Publish-állapotok + `moderationStatus`**: a poszt `public`/`ok` alapból; a `visibility`/`moderationStatus` mező kész. *(Draft/Scheduled: backend.)*
- [x] **`remixable` jelző** a poszton (M4 kapuja).
- [ ] **`PostPublished` event** → thumbnail/transcode + feed-index + értesítés. *(backend.)*
- [x] **Kliens publish-visszajelzés**: „Közzétéve 🎉” → „Megnézem a feedben”. *(render/upload-progressz: backend.)*

**Kész, ha:** egy szerkesztett projekt egy gombbal publikus poszt lesz, és a poszt mögött ott a letölthető/remixelhető `.vided`.

> **Miért erős:** a „video = szerkeszthető projekt” nem külön feature, hanem a publish sémája. A meglévő `.vided` + Collect Project + md5-identitás pontosan erre készült.

---

## M3 — Feed (TikTok-szerű függőleges lejátszó)

- [x] **Full-screen függőleges feed** (`src/app/feed/`): `FlatList` pager, 9:16 autoplay, snap-lapozás, láthatóság-alapú play/pause. *(FlashList/előtöltés-finomítás: backendnél.)*
- [x] **Videólejátszó a feedben**: `expo-video`, loop, némítás-váltó, dupla-kopp = like. *(buffer-spinner: hátra.)*
- [x] **Feed-módok tabjai**: **Neked** (For You-heurisztika), **Követett**, **Friss**. *(valódi ranker M11.)*
- [x] **Poszt-overlay UI**: creator-avatar+név, cím/leírás/hashtagek, jobb oldali akciósor (❤️/💬/🔖/↗️) **és a `✂️ Remix` gomb**.
- [x] **View-tracking**: első-megtekintés számlálás (algoritmus-jel) lokálisan. *(watch-time/completion: backend.)*
- [ ] **Feed-API**: kurzoros lapozás, seen-filter, `GET /feed?mode=foryou|following|latest`. *(most: lokális `listPosts(mode)` azonos alakkal.)*

**Kész, ha:** a feed görgethető, a videók autoplay-elnek, és minden poszton ott a Remix-gomb.

---

## M4 — Remix / „Edit this video” 🚩

*A második differenciátor: a feed bármelyik videója megnyílik a saját editorban — a meglévő `.vided` import + auto-relink útvonalon.*

- [x] **„Remix” akció a feed-posztról** (cross-device): publikáláskor a projekt **minden médiája a `assets` Storage-bucketbe** tölt (tartalom-hash kulcs, HEAD-dedup), a snapshot uri-jai felhő-URL-re íródnak; remixkor a snapshot **letöltődik az eszközre** (`rehydrateProjectAssets`) és lokális útra íródik → **más eszközön is szerkeszthető** ÚJ projektként (`remixOfPostId` beállítva, letöltés-progresszel).
- [x] **Remix-jogosultság**: csak `remixable: true` poszt remixelhető; egyébként a gomb „Zárt”.
- [x] **Attribúció + remix-lánc**: `remixOfPostId`/`remixOfCreator` a poszton, „Remix ebből: @creator” az overlayen; a forrás-poszt remix-számlálója nő.
- [ ] **`ProjectRemixed` event** → értesítés az eredeti creatornek. *(most: lokális remix-számláló nő; event a backendnél.)*
- [ ] **Sablon-ág (opcionális M4-ben)**: ha a poszt `type = Template`, a remix a **saját média behelyettesítését** kéri (a `.vided` a stílust/koreográfiát hozza, a klipek üres helyőrzők) — a meglévő relink-választó UI-t használva.

**Kész, ha:** a feedben egy videóra kattintva a `✂️ Remix` megnyitja a projektet az editorban, kész az összes réteggel, és publikálva a remix-lánc követi.

> **Miért erős:** nincs új „remix engine” — a `.vided` import + auto-relink MÁR ezt csinálja lokálisan. A social réteg csak a hálózati forrást adja hozzá.

---

## M5 — Engagement (like · save · view · komment · megosztás)

- [x] **Like + Save + Share**: optimista UI, számlálók, rendszer-share. *(reakció-készlet ❤️😂🔥…: hátra.)*
- [x] **Kommentek (v1)**: hozzászólás + lista; az adatmodell tud nested reply/pin/mention-t. *(reply/pin/edit UI + report: hátra.)*
- [x] **Komment-UI**: alsó sheet-panel, valós idejű darabszám.
- [x] **Megosztás**: rendszer-share (`Share.share`). *(chat-deep-link: M10.)*
- [ ] **Saves → Collections** alap: „Mentett” lista a profilon (mappák M8-ban). *(a save állapot már tárolódik.)*

**Kész, ha:** egy poszt like-olható, menthető, kommentelhető (válaszokkal), és minden interakció eventet ír (algoritmus-jelek).

---

## M6 — Social graph (follow · block · mute)

- [ ] **Follow/Unfollow**: `follows(follower, following, notify_level)`; követő/követett számok, gomb-állapotok.
- [ ] **Following-feed bekötése**: az M3 „Following” tabja a graph alapján.
- [ ] **Block / Mute / Restrict**: tartalom- és interakció-szűrés mindenhol (feed, komment, chat). (SOCIAL §7, §20)
- [ ] **Profil-nézet másokénak**: identity + creator-tartalom (publikált videók, sablonok, statisztika-alap), follow-gomb.
- [ ] **Követési szintek**: 🔔 All / 🔕 Personalized / 🚫 None értesítés creatoronként. (SOCIAL §19)

**Kész, ha:** követés után a Following-feed megtelik, a blokkolt user eltűnik mindenhonnan.

---

## M7 — Értesítések (event → in-app központ + push)

*(SOCIAL §14–15 — központi event-rendszerre építve)*

- [ ] **Notification-service**: az M0 event-fan-out → `notifications` rekordok (social: follow/like/comment/reply/mention; creator: „render kész”, „export kész”; remix: „valaki remixelte a videódat”; AI: „AI kész”).
- [ ] **In-app értesítés-központ** (`src/app/notifications/`): read/unread, „mind olvasott”, csoportosítás, koppintás = deep-link a poszthoz/kommenthez.
- [ ] **Push** (Expo): token-regisztráció, kézbesítés, értesítés-preferenciák (mit kérek push-ban).
- [ ] **Badge/számláló** a tab-sávon.

**Kész, ha:** like/komment/follow/remix után az érintett valós idejű in-app + push értesítést kap, preferenciák szerint.

---

## M8 — Keresés + hashtag + felfedezés

- [ ] **Globális kereső** (SOCIAL §16): userek, videók, hashtagek, sablonok, hangok — külön szekciók egy találati oldalon.
- [ ] **Hashtag-oldal** (SOCIAL §17): `#tag` → posztok rácsa, követhető hashtag, kapcsolódó tagek, trending tagek.
- [ ] **Collections/Library** (SOCIAL §18): ❤️ Liked + 🔖 Saved + saját mappák; jelek az algoritmusnak.
- [ ] **Felfedező-fül**: trending videók/creatorök/hangok rácsa (a `src/components` Tár/Sablon minta szerint).

**Kész, ha:** `cinematic budapest` keresésre creator + videó + hashtag + sablon találatok jönnek, és a hashtag-oldal görgethető.

---

## M9 — Moderáció + admin + safety

*(SOCIAL §20–22 — az adatmodell M0 óta készül rá)*

- [ ] **Report-flow** minden content-objektumon (spam/harassment/copyright/…); `moderation_status` állapotgép.
- [ ] **Block/Mute/Restrict** teljes körű érvényesítés (M6-ra építve).
- [ ] **Admin-felület** (web, minimál): user-keresés/suspend/ban/verify, report-sor, tartalom-eltávolítás, audit-log.
- [ ] **Privacy-beállítások** (SOCIAL §22): profil-láthatóság (public/followers/private); ki követhet/üzenhet/kommentelhet/említhet.
- [ ] **(Később) AI-moderáció**: komment-előszűrés a meglévő provider-független AI-réteggel (a worker `ai.js` mintája).

**Kész, ha:** egy poszt bejelenthető, moderátor eltávolíthatja, a blokkolt user semmit nem lát/tehet.

---

## M10 — Chat + editor-integráció (F5)

*(SOCIAL §10–12 — a vided-egyedi rész a §12: időbélyeges projekt-megosztás)*

- [ ] **DM + csoport** realtime (WebSocket): szöveg, kép, videó, reakció, typing/read receipt. (SOCIAL §10–11)
- [ ] **Projekt-megosztás chatben** 🚩: az üzenet hordozhat `{ projectId/postId, timestamp }`-et — a címzett rákoppint, és **pontosan a 15,2 mp-nél nyílik meg az editorban/lejátszóban**. (SOCIAL §12)
- [ ] **Shared Projects jogosultságok**: PRIVATE/UNLISTED/PUBLIC/SHARED + OWNER/EDITOR/COMMENTER/VIEWER — a közös projekt-storage az S3-on. (SOCIAL §13, full-plan F5)

**Kész, ha:** „Nézd meg a 15. mp-nél” üzenet linkje az editort a pontos időpontnál nyitja.

---

## M11 — Feed-ranking v2 (For You) + Creator Studio analytics

*(full-plan F5 — csak ha az engagement-jelek gyűlnek)*

- [ ] **Feed-ranker**: following + interests + watch history + engagement + trending + content-similarity → személyre szabott For You. (SOCIAL §6)
- [ ] **Creator Studio** (SOCIAL §4): published/draft/scheduled/archived kezelés; analytics (views, watch time, likes, komment, követő-növekedés).
- [ ] **Trend-backend**: a jelenlegi lokális trend-adat helyett valós trending (hashtag/hang/videó).

**Kész, ha:** a For You mérhetően relevánsabb a Latest-nél, és a creator látja a videói statisztikáit.

---

## Vided-egyedi ellenőrzőlista (ne csússzon el a differenciátor)

- [ ] A feed minden posztján ott a **Remix/Szerkesztés** gomb (M4), nem csak a saját videókon.
- [ ] A publikált poszt mögött **valódi `.vided` projekt** van, asset-ujjlenyomatokkal (M2) — nem csak egy MP4.
- [ ] A remix a **meglévő import + auto-relink** úton fut (M4), nincs párhuzamos média-pipeline.
- [ ] A remix-lánc **követhető és attribuált** (M4) — „remix ebből: @creator”.
- [ ] A publish/collect/relink **egyetlen forrás-igazságra** (Project Model) épül — a social csak nézet.

---

## Sorrend és függőségek

```text
M0 ──► M1 ──► M2 🚩 ──► M3 ──► M4 🚩 ──► M5 ──► M6 ──► M7 ──► M8 ──► M9
                                    └────────► M10 ──► M11
```

- **Minimum életképes social:** M0→M1→M2→M3→M4→M5 (publish + feed + remix + engagement).
- M6 (graph) a Following-feedhez és a profilhoz kell; M7 (értesítés) az M5/M6 eventjeire ül.
- M9 (moderáció) a séma M0 óta készül rá — élesíteni az M5 után kell, publikus indulás ELŐTT.
- M10/M11 az F5/F6 szint — a többi működése után.

## Anti-célok

- ❌ Külön „social videórekord” a projektmodell mellett — a poszt a projektre mutat.
- ❌ Új remix-motor — a `.vided` import + auto-relink MÁR ezt csinálja.
- ❌ Nyers média duplikálása — asset-referencia + S3, a meglévő identity-vel.
- ❌ Feature-ek közvetlen egymás-hívogatása — minden fontos történés event.
- ❌ Moderáció utólag — a `moderation_status` már az M0 sémákban.
