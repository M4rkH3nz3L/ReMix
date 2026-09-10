# vided — teljes fejlesztési terv

Összefoglaló terv a `devs/` dokumentumok alapján:
[PROJECT-LAYERS.md](PROJECT-LAYERS.md) · [AI-INTEGRATIONS.md](AI-INTEGRATIONS.md) ·
[CUSTOM-STORAGE.md](CUSTOM-STORAGE.md) · [SOCIAL.md](SOCIAL.md) —
a jelenlegi állapotra építve (lásd [FUNC.md](../FUNC.md)).

## Vezérelvek (minden fázisra érvényes)

1. **A Project Model az igazság forrása** — az editor, a social feed, a chat és az
   AI ugyanannak a projektmodellnek a különböző nézetei.
2. **Command-alapú szerkesztés** — minden művelet nevesített, undo-képes command;
   a user és az AI ugyanazt a Command Bus-t használja. Az AI sosem írja
   közvetlenül a state-et: `AI → Command → Validator → Engine → State`.
3. **AI-native, nem AI-ráépítés** — az adatmodell eleve úgy készül, hogy az AI
   értse (kontextus-rétegek, szemantikus index, event log).
4. **A projekt nem birtokolja a nyers fájlokat** — hivatkozik rájuk
   (external/cached/imported), proxy-val dolgozik, eredetivel renderel.
5. **Ne legyen minden külön sáv** — transition, filter, mask, animáció a klip
   property-je; csak a tartalom-típusok kapnak sávot.
6. **Event-driven backend** — minden fontos történés event, amire a notification,
   feed-ranking, analytics és AI egyaránt feliratkozik.

---

## Fázis 0 — Kliens-architektúra alapozás *(refaktor, backend nélkül)*

Cél: a meglévő editor felkészítése a storage-, AI- és social-rétegekre.

| Feladat | Forrás | Megjegyzés |
|---|---|---|
| **Asset-modell bevezetése**: a klip `uri` helyett `assetId`-t hivatkozik; asset = provider + externalId + hash + méret + metaadat | CUSTOM-STORAGE §3, §10 | minden későbbi fázis előfeltétele |
| **Command pattern refaktor**: a store `mutateProject` hívásai nevesített commandokká (ADD_CLIP, TRIM_CLIP, SPLIT_CLIP…) `execute/undo` párral | AI-INTEGRATIONS §9 | a meglévő undo/redo erre cserélődik |
| **Sáv-bővítés**: hang sáv szétválasztása Zene / Voiceover / SFX-re; Felirat (captions) külön sáv a szövegtől; Overlay/Grafika sáv | PROJECT-LAYERS | a matrica/emoji az Overlay sávra kerül |
| **Klip-property bővítés**: rotation, opacity, blend mode; később keyframe-ek (position/scale/opacity animáció) | PROJECT-LAYERS | transform (scale/x/y) már megvan |
| **Project event log**: `ProjectEvent {actor: user\|ai\|system, type, payload}` a store-ban, mentve a projekttel | AI-INTEGRATIONS §8 | az AI-memória alapja |

**Kész, ha:** a régi projektek migrálódnak, minden szerkesztés commandként fut,
és az event log visszajátszható.

---

## Fázis 1 — Backend alap: worker élesítés + identity

Cél: a dev-worker éles szolgáltatássá válik, a felhasználónak fiókja van.

- **Render worker élesítése**: job queue (pl. BullMQ + Redis), S3-kompatibilis
  tárhely a médiának/outputnak, párhuzamos workerek, retry, progress-percent.
- **Whisper élesítés**: nagyobb modell (small/medium) a szerveren; nyelvválasztó.
- **Auth/Identity minimum**: email+jelszó, Google/Apple login, session-kezelés,
  profil (username, avatar, bio). (SOCIAL §2–3 minimál szelete.)
- **Cloud sync**: projekt-JSON mentés/betöltés a backendre fiókhoz kötve;
  eszközök közti folytatás. Verziózott mentés (utolsó N verzió).
- **Zene-katalógus**: a server/music mappa helyett adatbázis-alapú katalógus
  (jogtiszta készlet), műfaj/hangulat címkékkel.

**Kész, ha:** telefonról regisztráció → projekt szerkesztés → felhő-mentés →
MP4-render a felhőben → letöltés, végig a saját fiókban.

---

## Fázis 2 — Storage / File Provider rendszer

Cél: a nyers média bárhol lehet, az editor mégis gyors marad. (CUSTOM-STORAGE)

- **StorageProvider interfész + Gateway**: `connect/list/get/download/upload…`;
  providerek: Local, S3 (saját), Google Drive, Dropbox, OneDrive, WebDAV.
- **Asset-állapotok**: External → Cached → Imported; automatikus cache a
  timeline-on aktív klipekhez (Smart Cache), a többi remote marad.
- **Proxy-rendszer**: a worker minden behúzott videóhoz 720p proxyt +
  thumbnailt + waveformot generál; a vágás proxyval, a render eredetivel fut.
- **Relink + file identity**: hiányzó média felismerése hash/méret/hossz
  alapján, „Relink Media” flow; asset-verziózás (külső fájl változott →
  Use New / Keep Current).
- **Projekt-fájl**: `.vided` export/import (projekt + asset-referenciák, nyers
  média nélkül) és **Collect Project** (minden összegyűjtve átadáshoz).

**Kész, ha:** egy Drive-on lévő videóból proxy-alapon vágható projekt készül,
és a render az eredeti fájllal fut le.

---

## Fázis 3 — AI-réteg (Project Intelligence)

Cél: az AI érti és command-okon át szerkeszti a projektet. (AI-INTEGRATIONS)

- **AI Context Builder**: nem a teljes JSON megy a modellnek, hanem rétegek:
  Global (projekt-célok, stílus) + Relevant (érintett klipek) + Current
  (playhead környéke). AI-olvasható reprezentáció (story, tone, pace, tracks
  emberi leírással).
- **Szemantikus index**: transcript (Whisper — megvan), jelenet-váltás
  detektálás, klip-tartalom címkék (vision modell a proxy képkockáin);
  knowledge graph: esemény → asset → időpont.
- **AI-memória 4 szinten**: project state · semantic understanding · project
  intent (cél, platform, hossz) · beszélgetés/döntések (elutasított javaslatok
  betartása!). Az event log a forrása.
- **Command Validator**: az AI kimenete `{operation, target, parameters}` —
  validálás, végrehajtás a Fázis 0 Command Bus-on, minden AI-művelet undo-zható.
- **Első AI-profilok** (szűk scope-pal indulva):
  1. ✍️ **Caption AI** — transcript → stílusozott, időzített felirat (a
     meglévő auto-caption kiterjesztése szerkesztési javaslatokkal),
  2. ✂️ **Editor AI** — „vágd ki a holtidőt”, „legyen 30 mp alatt”, cut-lista
     javaslat + jóváhagyás,
  3. később: 🎬 Director, 🎵 Music, 🎨 Color, 📱 Social AI — mind saját
     context-scope-pal és tool-készlettel.

**Kész, ha:** „Vágd rövidebbre és feliratozd” egy chat-utasításból
végrehajtható, jóváhagyási lépéssel és teljes undo-val.

---

## Fázis 4 — Social platform MVP

Cél: publikálás és felfedezés — a creator nem hagyja el a platformot. (SOCIAL)

- **Publish flow**: projekt → render → poszt (videó + cím + leírás + tagek +
  használt sablon/zene linkelve). Post-típusok először: Video, Template.
- **Feed**: Following + Latest + Trending (algoritmus később; az adatmodell —
  watch history, engagement — már most eszerint épül).
- **Engagement v1**: Like + Save + View; kommentek (nested reply, @mention,
  creator-pin/törlés, report).
- **Social graph**: follow/block/mute; profil = identity + creator tartalom
  (publikált videók, sablonok, statisztika-alap).
- **Értesítések**: központi event → in-app értesítés-központ + push
  (like, komment, follow, „render kész”, „AI kész”).
- **Keresés v1**: user, videó, sablon, hashtag; hashtag-oldalak.
- **Safety alapok az adatmodellben**: report, block, moderation_status minden
  content-objektumon; egyszerű admin-felület.

**Kész, ha:** a teljes hurok működik: szerkesztés → publikálás → feed →
like/komment → értesítés → a sablonból más remixel.

---

## Fázis 5 — Közösség, kollaboráció, remix-ökoszisztéma

- **Template marketplace**: sablon publikálása a projektből, „Használd” →
  saját média behelyettesítése; remix-lánc követése (ki miből készített mit).
- **Chat**: DM + csoport, realtime; **editor-integráció**: projekt megosztása
  üzenetben időbélyeggel — a címzett a linkre kattintva a 15,2 mp-nél nyílik
  meg az editorban.
- **Shared Projects**: PRIVATE/UNLISTED/PUBLIC/SHARED + OWNER/EDITOR/
  COMMENTER/VIEWER jogosultságok; közös Project Storage + személyes storage
  (CUSTOM-STORAGE §14–15) — az AI csak olvasási jogot kap az eredetikhez.
- **Feed-ranking v2**: interests + watch history + engagement + trending →
  For You; AI-ajánlások.
- **Collections/Library**: liked/saved + mappák; creator-követési szintek
  (All/Personalized/None értesítés).
- **Creator Studio**: tartalom-kezelés (published/draft/scheduled), analytics
  (views, watch time, followers).

---

## Fázis 6 — Pro és skálázás

- **Realtime kollaboratív szerkesztés**: CRDT a timeline-on, presence,
  kurzorok, inline kommentek a klipeken (a Command Bus erre már felkészült).
- **Editor Pro funkciók**: keyframe-animáció UI, maszkok/chroma key,
  blend mode-ok, adjustment (LUT) réteg — renderoldali támogatással.
- **RAW/proxy pro workflow**: ProRes/MXF támogatás, több felbontású proxy.
- **AI-moderáció**: komment- és tartalom-előszűrés; AI comment-szűrők a
  creatoröknek.
- **Monetizáció** (Creator Studio-ban): előfizetés/tipp/marketplace-jutalék.
- **AI-profilok személyre szabása**: saját nevű/memóriájú agentek
  („az én vágóm, ismeri a stílusomat”).

---

## Sorrend és függőségek

```text
F0 Kliens-alapozás ──► F2 Storage ──► F5 Kollaboráció
       │                    │
       └──► F3 AI-réteg ◄───┘
F1 Backend-alap ──► F4 Social MVP ──► F5 ──► F6
```

- F0 és F1 párhuzamosan indítható; F0 tisztán kliens, F1 tisztán backend.
- F3 (AI) az F0 command-rendszerére és az F1 workerére épül.
- F4 (social) csak az F1 identity-re épül — storage nélkül is indítható.
- F5/F6 az összes korábbira.

## Anti-célok (amit tudatosan NEM csinálunk)

- ❌ Minden effektnek/át­menetnek külön timeline-sáv (klip-property marad).
- ❌ A teljes projekt-JSON beküldése az AI-nak minden promptnál.
- ❌ Nyers fájlok automatikus felmásolása/duplikálása a saját storage-ba.
- ❌ Social funkciók az editor-projektmodelltől független, külön silóban.
- ❌ AI közvetlen state-írása validátor és undo nélkül.
