# vided — teljes feladatlista és állapot (2026-09-04)

Jelölés: ✅ kész · 🔶 részben kész · ⬜ hátravan
Források: FUNC.md (funkció-állapot) · devs/full-plan.md (F0–F6 roadmap)

---

## Szerkesztő (kliens) — ✅ KÉSZ

- ✅ Projektek: létrehozás (16:9 / 9:16 / 1:1), lista, átnevezés, duplikálás,
  törlés, autosave (AsyncStorage)
- ✅ 8 sávos idővonal (videó/kép · szöveg · felirat · matrica · interaktív ·
  zene · voiceover · SFX), üres sávok rejtve
- ✅ Trim-fogantyúk, húzás + mágneses snap, split, duplikálás, undo/redo,
  pinch-zoom, precíziós panel (±0,1 mp), transport-léptetők, loop-lejátszás
- ✅ Filmstrip-előnézet a videó/kép klipeken (trim/sebesség-helyes képkockák,
  cache-elve)
- ✅ Hullámforma a hangklipeken (worker számolja, lemez-cache; worker nélkül
  címkés)
- ✅ Sebesség 0,25–4× (idővonal-hossz együtt skálázódik)
- ✅ Vászon-transzform: pinch-zoom/pan + forgatás + átlátszóság
- ✅ 10 szűrő erősség-szabályzóval; fade in/out áttűnések (két szomszédos
  klipen = átúszás)
- ✅ Szöveg: 4 stíluspreset (sima/buborék/kontúr/neon), 8 animáció (fade,
  slide, pulse, typewriter, pop, shake, karaoke…), dupla koppintás = szerkesztő
- ✅ Feliratok: gyors felirat (sorok → elosztott caption-ök), SRT import/export,
  AI auto-caption (Whisper, trim/sebesség-helyes időzítés)
- ✅ Matrica-panel (24 emoji)
- ✅ Hang: zene-import, hang-könyvtár (8 generált SFX + saját mappa),
  voiceover-felvétel, hangerő + fade keverés, többsávos együttszólás
- ✅ Interaktív hotspotok: URL / ugrás időpontra / kvíz — vásznon
  rajzolható/méretezhető, sidecar-JSON-nal
- ✅ Interaktív lejátszó (hotspot-kattintás, kvíz-modal, progress-sáv)
- ✅ Sablonok: 6 sablon felirat-koreográfiával, 🔥 TREND jelölés (lokális adat)
- ✅ Reszponzív + fekvő elrendezés (preview balra, vezérlők jobbra)

## Architektúra (full-plan F0) — ✅ KÉSZ

- ✅ Command-alapú szerkesztés (nevesített, validált, undo-zható műveletek)
- ✅ Projekt-eseménynapló (actor: user/ai — az AI-memória alapja)
- ✅ Asset-registry (klipek assetId-vel, séma-migráció betöltéskor)

## Render worker (server/, dev) — ✅ KÉSZ

- ✅ MP4-render: konkatenáció (lyukak feketével), sebesség, szűrők, fade,
  vászon-transzform, többsávos hangkeverés (amix), felirat-beégetés
  (Chromium-rasterizálás, pixelre egyező stílusokkal)
- ✅ Szöveganimációk a renderelt MP4-ben (fade/slide alpha-rámpa, pop/pulse
  valódi per-frame skálázás, shake, typewriter-prefixek, karaoke szó-kiemelés)
- ✅ Whisper auto-caption végpont (/captions)
- ✅ Hang-könyvtár végpont (/music: generált SFX + server/music mappa)
- ✅ Hullámforma végpont (/waveform: FFmpeg → normalizált csúcslista)
- ✅ AI-asszisztens végpont (/ai/assist: Claude structured output,
  parancs-whitelist)
- ✅ Export: MP4 + SRT + projekt-JSON + hotspot-JSON megosztás

## AI-réteg (full-plan F3) — 🔶 RÉSZBEN

- ✅ Rétegzett Context Builder (Global + Relevant + Current + Memory,
  nem a teljes JSON)
- ✅ AI → Command → Validator → Engine út (whitelist, minden undo-zható)
- ✅ Assistant-panel a szerkesztőben (utasítás → jóváhagyható parancsok)
- ✅ Caption AI alapja (Whisper-transcript → időzített felirat)
- ✅ Editor AI cut-lista: „Holtidő kivágása" az Assistant panelen — FFmpeg
  silencedetect a workeren (AI-kulcs nélkül is), trim/speed-helyes vágásterv,
  a videósáv egy undo-lépésben épül újra (REPLACE_TRACK_CLIPS command)
- ⬜ Szemantikus index: jelenet-váltás detektálás, klip-tartalom címkék
  (vision a proxy képkockáin), knowledge graph ← **következő lépés**
- ⬜ AI-memória 4 szinten (intent + elutasított javaslatok betartása)
- ⬜ További AI-profilok: Director, Music, Color, Social AI

## Fázis 1 — Backend-alap — ⬜ HÁTRAVAN

- ⬜ Worker élesítése: hoszting, job queue (BullMQ+Redis), S3 tárhely,
  párhuzamos workerek, retry, progress-percent
- ⬜ Whisper élesítés: nagyobb modell a szerveren, nyelvválasztó
- ⬜ Auth/identity: email+jelszó, Google/Apple login, session, profil
- ⬜ Cloud sync: projekt-mentés fiókhoz kötve, eszközök közti folytatás,
  verziózott mentés
- ⬜ Zene-katalógus: adatbázis-alapú, jogtiszta készlet címkékkel

## Fázis 2 — Storage / File Provider — 🔶 RÉSZBEN

- ✅ Thumbnail (filmstrip) + waveform szelet (kliens + worker)
- ✅ `.vided` projektfájl export/import (validálás + séma-migráció betöltéskor,
  hiányzó média felismerése, újracsatolás-flow) + Collect Project (zip a
  workeren: project.vided + media/, relatív uri-kkal)
- ✅ StorageProvider interfész + Gateway (Tár panel a szerkesztőben; első
  adapter: szerver-tár — `server/library` + `/library` végpont; natívan
  Imported letöltés, weben External stream)
- 🔶 Asset-állapotok: External/Imported megvan a provider-útvonalon;
  ⬜ Cached köztes szint + Smart Cache
- ⬜ További provider-adapterek: S3, Google Drive, Dropbox, WebDAV
  (OAuth/kulcs-kezeléssel — F1 auth után érdemes)
- ✅ Proxy-rendszer: 720p vágási proxy a workeren (kis forrásnál skip),
  előnézet + filmstrip proxyval, render az eredetivel; eszköz-lokális
  lemez-cache, előmelegítés megnyitáskor/hozzáadáskor
- ✅ Relink hash-alapú file identity-vel: a .vided/Collect export md5+méret
  ujjlenyomatot tesz az assetekre; importkor autoRelink (méret-előszűrés +
  md5-igazolás a Documents/media fájljain), kézi választó csak a maradékra

## Fázis 4 — Social platform MVP — ⬜ HÁTRAVAN

- ⬜ Publish flow: projekt → render → poszt (cím, leírás, tagek, sablon/zene
  linkelve)
- ⬜ Feed: Following + Latest + Trending
- ⬜ Engagement v1: like, save, view; kommentek (reply, @mention, pin, report)
- ⬜ Social graph: follow/block/mute; profil + creator-tartalom
- ⬜ Értesítések: in-app központ + push (like, komment, „render kész"…)
- ⬜ Keresés v1: user, videó, sablon, hashtag
- ⬜ Safety-alapok: report, moderation_status, admin-felület
- ⬜ Trend-backend (a sablonok TREND-adata ma lokális)

## Fázis 5 — Közösség, kollaboráció, remix — ⬜ HÁTRAVAN

- ⬜ Template marketplace + remix-lánc követése
- ⬜ Chat (DM + csoport) editor-integrációval (időbélyeges projekt-link)
- ⬜ Shared Projects: láthatóság + OWNER/EDITOR/COMMENTER/VIEWER jogok
- ⬜ Feed-ranking v2 (For You, AI-ajánlások)
- ⬜ Collections/Library + követési szintek
- ⬜ Creator Studio: tartalom-kezelés + analytics

## Fázis 6 — Pro és skálázás — ⬜ HÁTRAVAN

- ⬜ Realtime kollaboratív szerkesztés (CRDT, presence, inline kommentek)
- ⬜ Editor Pro: keyframe-UI, maszkok/chroma key, blend mode-ok, LUT-réteg
- ⬜ RAW/proxy pro workflow (ProRes/MXF, több felbontású proxy)
- ⬜ AI-moderáció (komment/tartalom-előszűrés)
- ⬜ Monetizáció (előfizetés/tipp/jutalék)
- ⬜ Személyre szabott AI-profilok (saját memóriájú agentek)

---

## Ismert korlátok (tudatos, dev-fázis)

- Az MP4-render dev-workeren fut (queue/S3 nélkül) — élesítése az F1 része
- A szűrők az app-előnézetben overlay-közelítések (a render pontos)
- Hotspotok szándékosan sidecar-JSON-ban (nem égnek a videóba) — ez design-döntés

## Anti-célok (amit tudatosan NEM csinálunk)

- ❌ Külön idővonal-sáv minden effektnek (klip-property marad)
- ❌ Teljes projekt-JSON az AI-nak minden promptnál
- ❌ Nyers fájlok automatikus duplikálása a saját storage-ba
- ❌ Social funkciók külön silóban az editor-modelltől
- ❌ AI közvetlen state-írása validátor és undo nélkül
