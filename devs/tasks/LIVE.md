# 🎥 ReMix Live Studio — OBS-stílusú élő produkció — fejlesztési terv

> Testvér-tervek: [VIDEO.md](./VIDEO.md) · [AUDIO.md](./AUDIO.md) · [IMAGE.md](./IMAGE.md) · [NATIVE.md](./NATIVE.md) · [PROD.md](./PROD.md) · [MISSING.md](./MISSING.md) · security-backlog: [remix/00-README.md](./remix/00-README.md).
> Cél-útvonal: `Feed → Live → „Go live”` már **nem** a csupasz kamera-szobát nyitja, hanem a **Live Studio** kompozitor-editort → [src/app/live/studio/[id].tsx](../../src/app/live/studio/%5Bid%5D.tsx) (ÚJ).

> **📌 Állapot (2026-10-03, `studio-social` branch) — a terv ÍRÁSAKOR csak a csupasz élő-szoba kész.**
> Ma: `startLive(title)` → `live_sessions` sor → [src/app/live/[id].tsx](../../src/app/live/%5Bid%5D.tsx) egyetlen host-kamerát publikál LiveKiten (WebRTC), + Supabase-realtime presence/chat/reakció. **Igazoltan működik Androidon** (lásd a memóriát + a 4 live-commitot). Ami EBBŐL a tervből hátravan: a **több-forrás kompozitor** (OBS-scene-ek, overlay/szöveg/logó, képernyő-megosztás), az **élő audio-mixer-UI**, a **feed-be-megosztás mint produkció**, és a **multistream** (YouTube/TikTok/… RTMP) a LiveKit Egressen át. Az `[ ]` jelölések a nyitott munkát mutatják.

---

## 0. Kiindulás és cél

**Kiindulási állapot (két külön dolog, amit egyesíteni kell):**

1. **Csupasz élő-szoba** — a mai [live/[id].tsx](../../src/app/live/%5Bid%5D.tsx) egyetlen nyers kamera-trackot publikál. Nincs jelenet, nincs overlay, nincs képernyő, nincs mixer, nincs külső platform. A `LiveStage` a `useTracks([Camera])`-ből rendereli a hostot/nézőt.
2. **Kész, de kihasználatlan editor-mag** — a ReMix-nek VAN erős vizuális kompozitora ([PreviewSurface.tsx](../../src/components/preview/PreviewSurface.tsx)), overlay-rétegei ([TextOverlay](../../src/components/preview/TextOverlay.tsx), [ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx), [PipLayer](../../src/components/preview/PipLayer.tsx)), audio-mixer-magja ([mixer.ts](../../src/lib/mixer.ts)), feed-publikáló folyama ([feed.ts](../../src/lib/feed.ts)) és parancsbusza ([commands.ts](../../src/lib/commands.ts)). Ezek ma csak az utómunka (VOD) editorban élnek.

**Cél (a felhasználó kérése):**

> A Live-ot úgy kell létrehozni, hogy **elsőnek egy editor nyílik meg, ami OBS Studioként üzemel** (jelenetek + források + overlay-ek + mixer), **aztán megosztjuk a liveot a saját feedünkbe is**, és **meg lehet osztani YouTube-on, TikTokon stb.** — mint az OBS Studióval.

Azaz: a „Go live” **NEM** a kamerát indítja, hanem a **Live Studiót**. Ott a user felépíti az adást (scene-ek, kamera/képernyő/kép/videó/szöveg/logó források, audio-mixer, cél-platformok), majd **„Start streaming”** → egyszerre megy a **ReMix feedre** (LiveKit, in-app nézők) és a **kiválasztott külső platformokra** (RTMP, LiveKit Egress fan-out).

### 0.1 A legfontosabb architektúra-felismerés
Mobilon az OBS-élmény azért reális, mert **nem a telefon komponál és enkódol N streamet**:

- **LiveKit RN már publikál kamera- ÉS képernyő-megosztás trackeket** (iOS Broadcast Extension / Android MediaProjection a `@livekit/react-native-webrtc`-ben) → a „forrás” = egy LiveKit track, a nehéz WebRTC-enkódolást a stack adja.
- **In-app nézőnél a kompozíció a kliensen történik** a meglévő [PreviewSurface](../../src/components/preview/PreviewSurface.tsx)-logikával: a kapott kamera/képernyő `VideoTrack`-ek fölé rétegezzük a szöveg/alakzat/logó overlay-eket a **jelenet-állapot** szerint (ingyen, nincs szerver-komponálás-költség).
- **Külső platformokra (YouTube/TikTok/…) a LiveKit Egress komponál szerveroldalon** (Room Composite + web-layout template), és **egy bemenetből RTMP-re fan-outol több célra** — a telefon csak EGYSZER tölt fel.
- A közös igazság-forrás a **jelenet-állapot** (mely forrás látszik, 0–1 transzformok, overlay-ek, aktív scene), amit a LiveKit **data channelen** broadcastolunk → a nézők ÉS az egress-template ugyanazt látják.

---

## 1. Architektúra-döntések

### 1.1 Compose-at-the-edge (in-app) + compose-in-egress (RTMP)
| Kimenet | Hol komponál | Hogyan |
| --- | --- | --- |
| **ReMix feed** (in-app néző) | a néző kliensén | `VideoTrack` rétegek (kamera/képernyő PiP-ként) + [TextOverlay](../../src/components/preview/TextOverlay.tsx)/[ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx)/logó a data-channel jelenet-állapot szerint → **[PreviewSurface](../../src/components/preview/PreviewSurface.tsx) újrahasznosítás** |
| **YouTube/TikTok/… (RTMP)** | LiveKit **Egress** (szerver) | Room Composite Egress + **web-layout template** (ugyanazt a kompozitort rendereli böngészőben) → H.264/AAC → RTMP fan-out a célokra |
| **VOD / felvétel** | LiveKit Egress **file** output VAGY utólagos render | felvétel → [publishRenderedProject](../../src/lib/feed.ts)-tel feed-poszt |

**Miért jó:** a telefon sávszélessége véges — EGY feltöltés a LiveKitbe, a fan-out szerveroldalon. A nézői kompozíció ingyenes és pixel-pontosan a meglévő preview-stacket használja (preview = render paritás, mint a VOD-editorban).

### 1.2 Live produkció adatmodell — új `kind: 'live'` projekt
A [három stúdió-kind](../../src/types/project.ts) (`video`/`image`/`audio`) mellé **`kind: 'live'`** (illeszkedik a meglévő scaffoldhoz). A live-doc **additív**, `schemaVersion`-migrációval:

```ts
// src/types/live.ts (ÚJ) — a Project-re lóg (project.live?: LiveDoc), vagy dedikált doc
LiveSource = {
  id: string;
  kind: 'camera' | 'screen' | 'image' | 'video' | 'text' | 'shape' | 'logo' | 'browser';
  // vizuális: 0–1 normalizált vászon-pozíció (mint a CanvasTransform)
  transform: { x: number; y: number; w: number; h: number; rotation: number; z: number };
  visible: boolean;
  // forrás-specifikus: trackSid (camera/screen), assetId/uri (image/video/logo),
  // textClipRef/shapeClipRef (a meglévő TextClip/ShapeClip modellt újrahasználva), url (browser)
  ref?: Record<string, unknown>;
};
LiveScene = { id: string; name: string; sources: LiveSource[]; transitionMs?: number };
LiveDestination = { id: string; platform: 'remix'|'youtube'|'tiktok'|'twitch'|'facebook'|'custom'; label: string; enabled: boolean };
LiveDoc = {
  scenes: LiveScene[];
  activeSceneId: string;
  mixer: MixerGraph;            // ← mixer.ts újrahasznosítás
  destinations: LiveDestination[];
  title: string; visibility: 'public'|'followers'|'unlisted';
};
```

**A szöveg/alakzat overlay-eket NEM modellezzük újra** — a [TextClip](../../src/types/project.ts)/[ShapeClip](../../src/types/project.ts) a maga keyframe/blend/3D/stílus-arzenáljával a `LiveSource.ref`-ben él, és a meglévő [TextOverlay](../../src/components/preview/TextOverlay.tsx)/[ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx) rendereli.

### 1.3 Command bus — minden live-szerkesztés undo-zható
Új, kis `EditorCommand`-ok a [commands.ts](../../src/lib/commands.ts) unionhöz (a reducer-minta változatlan): `ADD_LIVE_SCENE`, `REMOVE_LIVE_SCENE`, `SET_ACTIVE_SCENE`, `ADD_LIVE_SOURCE`, `UPDATE_LIVE_SOURCE`, `REMOVE_LIVE_SOURCE`, `SET_LIVE_DESTINATIONS`. A Studio-szerkesztés `dispatch(cmd, actor)`-on megy → undo/redo ingyen, ÉS a dispatch élőben broadcastolható a data-channelre (a [editorStore.ts](../../src/store/editorStore.ts) `setLiveBroadcaster(fn)` már létező kampója pont erre való).

### 1.4 Belépő-folyam (a kérés magja)
```text
Feed ─► Live ─► „Go live”
                   │
                   ▼
         ┌─────────────────────────────┐
         │   LIVE STUDIO (OBS-szerű)    │   ← ITT ÉPÍT, MIELŐTT ADÁSBA MENNE
         │  scene-ek · források · mixer │
         │  overlay/szöveg/logó · célok │
         └──────────────┬──────────────┘
                 „Start streaming”
        ┌───────────────┼───────────────────────────┐
        ▼               ▼                           ▼
   live_sessions   LiveKit publish            LiveKit EGRESS
   + LIVE-kártya   (camera/screen track        (Room Composite
   a saját feeden   + data-channel scene)        → RTMP fan-out)
        │               │                           │
   followers       in-app nézők                YouTube / TikTok /
   notify          (PreviewSurface-             Twitch / Facebook /
   (már van         kompozíció a kliensen)       custom RTMP
    on_live_started
    trigger)
```

### 1.5 Pro-kapu (illeszkedik a [free-vs-pro](../../CLAUDE.md) modellhez)
- **Live a saját ReMix-feedre = INGYEN** (az in-app social-réteg ingyen, a kompozíció on-device/edge). Scene-ek, overlay, kamera+képernyő, mixer → ingyen.
- **Külső multistream (YouTube/TikTok/…) + HD-egress + VOD-felvétel-egress = Pro** — mert szerver-oldali egress **valós pénzbe kerül** (LiveKit Cloud egress-percdíj / self-host CPU). Ez konzisztens: a server-media-sync/HD-render/AI eddig is Pro.

### 1.6 Újrahasznosítási térkép (Explore-felmérés alapján)
| Épp kell | Van már? | Forrás | Teendő |
| --- | --- | --- | --- |
| Vászon-kompozitor (0–1 koord) | ✅ | [PreviewSurface.tsx](../../src/components/preview/PreviewSurface.tsx) | élő forrás-bemenetekkel bővíteni |
| Szöveg/alakzat/kép/PiP overlay | ✅ | [TextOverlay](../../src/components/preview/TextOverlay.tsx)/[ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx)/[PipLayer](../../src/components/preview/PipLayer.tsx) | VideoTrack fölé rétegezni |
| Kamera (élő filter-preview) | ✅ | [CameraRecorder.tsx](../../src/components/editor/CameraRecorder.tsx) | LiveKit camera-track publish |
| Képernyő-megosztás | ⚠️ spec | [captureCenter.ts](../../src/lib/captureCenter.ts) + LiveKit RN screen-share | LiveKit screen-track (iOS broadcast-ext config) |
| Audio-mixer (channel/bus/send/sidechain) | ✅ modell | [mixer.ts](../../src/lib/mixer.ts) + [audioMaster.ts](../../src/lib/audioMaster.ts) | élő I/O-bridge + mixer-UI (fader/VU) |
| Feed-poszt (render→upload→post) | ✅ | [feed.ts](../../src/lib/feed.ts) `publishRenderedProject` | VOD-poszt az adás végén |
| LiveKit session + chat/reakció | ✅ | [live.ts](../../src/lib/live.ts) + [livekit.ts](../../src/lib/livekit.ts) | több-track + data-channel scene |
| RTMP / egress / multistream | ❌ | — | LiveKit Egress + célkezelés (Fázis E) |
| Parancsbusz + undo + live-broadcast | ✅ | [commands.ts](../../src/lib/commands.ts) + [editorStore.ts](../../src/store/editorStore.ts) | live-command-ok hozzáadása |

---

## 2. Fázisok

### 🟦 Fázis A — Live Studio belépő + scene/source adatmodell (UI-váz)
Cél: a „Go live” a **Live Studiót** nyitja, a `kind: 'live'` doc-kal; a vászon szerkeszthető (OBS-scene-lista + forrás-lista), de még nem megy adásba.

- [ ] **Adatmodell** [src/types/live.ts](../../src/types/live.ts) (`LiveDoc`/`LiveScene`/`LiveSource`/`LiveDestination`) + `kind: 'live'` + `schemaVersion`-migráció ([projectUtils.ts](../../src/lib/projectUtils.ts)).
- [ ] **Live-command-ok** a [commands.ts](../../src/lib/commands.ts) unionhöz + pure reducer-ágak + teszt (`commands.test.ts` mintára).
- [ ] **Live Studio képernyő** [src/app/live/studio/[id].tsx](../../src/app/live/studio/%5Bid%5D.tsx):
  - **Program-vászon** (a [PreviewSurface](../../src/components/preview/PreviewSurface.tsx) `mode: 'live-edit'` változata): források rétegezése, drag/resize 0–1-ben.
  - **Scene-strip** (OBS-jelenetlista): scene-ek hozzáadása/átnevezése/váltása.
  - **Source-lista + „+ Forrás” menü**: Kamera / Képernyő / Kép / Videó-klip / Szöveg / Alakzat / Logó / Böngésző-forrás.
  - **Alsó akció-sáv**: „Start streaming” + cél-platform-chipek (ReMix alapból be) + cím/láthatóság.
- [ ] A „Go live” a [live.tsx](../../src/app/live.tsx) hubban átirányít a Studióra (új live-doc létrehozása), a régi direkt-szoba marad a **nézői** útnak.

**Kész, ha:** új live-projekt létrehozható, scene-ek/források szerkeszthetők és undo-zhatók, a vászon a preview-stacket használja; `npm run audit` zöld.

### 🟦 Fázis B — Élő kompozitor + LiveKit több-forrás publish
Cél: a Studióból adásba lehet menni; kamera + képernyő track publikálódik, a jelenet-állapot a data-channelen megy, a néző a kompozíciót látja.

- [ ] **Több-track publish**: kamera (`Track.Source.Camera`) + képernyő (`Track.Source.ScreenShare`) a LiveKit RN-nel; forrás ki/be = track mute/unmute + `visible`.
- [ ] **Jelenet-állapot broadcast**: a `LiveDoc` aktív jelenet + transzformok + overlay-ek a LiveKit **data channelen** (`publishData`), throttle-olva; a store-dispatch → broadcaster kampó ([editorStore.ts](../../src/store/editorStore.ts)).
- [ ] **Nézői kompozitor** (a mai [live/[id].tsx](../../src/app/live/%5Bid%5D.tsx) `LiveStage` kibővítése): a kapott `VideoTrack`-ek PiP-rétegként + [TextOverlay](../../src/components/preview/TextOverlay.tsx)/[ShapeOverlay](../../src/components/preview/ShapeOverlay.tsx)/logó a data-channel állapot szerint.
- [ ] **Scene-váltás élőben** (opcionális studio-mode: Preview→Program „cut”/„fade” a [TransitionLayer](../../src/components/preview/TransitionLayer.tsx)-rel).

**Kész, ha:** két eszközön (host Studio + néző) a host látható kamera+képernyő+overlay kompozícióként, scene-váltás élőben átmegy; `npm run audit` zöld + kézi e2e (mint a kamera-e2e-nél).

### 🟦 Fázis C — Élő audio-mixer
Cél: OBS-szerű audio-keverő — mikrofon + zene + eszköz/party-hang külön csatornán, faderrel, némítással, VU-val, auto-duckinggel.

- [ ] **Élő I/O-bridge**: a [mixer.ts](../../src/lib/mixer.ts) `MixerGraph`-ot élő forrásokra kötni (local mic, háttérzene-lejátszás, LiveKit audio-trackek) — a nehéz DSP-paritás a worker/egress oldalon, az élő gain/pan/mute a kliensen.
- [ ] **Mixer-UI** (fader/VU/mute/solo) a Studióban; sidechain auto-duck (zene halkul, ha a mikrofon aktív) a meglévő modellből.
- [ ] A master-lánc a [audioMaster.ts](../../src/lib/audioMaster.ts)-ből (LUFS-cél) az egress-enkódhoz.

**Kész, ha:** több audio-forrás élőben keverhető, a némítás/fader hallható a nézőnél; `npm run audit` zöld.

### 🟦 Fázis D — Feed-megosztás + „LIVE now” a saját csatornán
Cél: a „Start streaming” a saját feedre/csatornára is kiteszi az élőt, a követők értesülnek, az adás vége után opcionális VOD-poszt.

- [ ] **LIVE-kártya a saját feeden/csatornán** az indításkor (a `live_sessions` már megvan; a [social-feed](../../src/lib/feed.ts) feedbe egy „élő” elem-típus). A `on_live_started` follower-notify **trigger már létezik** (migráció `20261003190000`).
- [ ] **VOD az adás után**: LiveKit Egress **file** output VAGY utólagos render → [publishRenderedProject](../../src/lib/feed.ts) → rendes feed-poszt (remixelhető, mint bármely videó).
- [ ] Belépés a nézőnek: feed LIVE-kártya → a mai [live/[id].tsx](../../src/app/live/%5Bid%5D.tsx) néző-út (Fázis B kompozícióval).

**Kész, ha:** indításkor a követők értesülnek + a csatornán ott a LIVE-jelző; a vége után VOD-poszt jön létre; `npm run audit` zöld.

### 🟦 Fázis E — Multistream: YouTube / TikTok / Twitch / Facebook / custom RTMP (LiveKit Egress)
Cél: a kompozit adás egyszerre megy több külső platformra, szerveroldali fan-outtal. **Pro-kapu.**

- [ ] **Cél-tár** `live_destinations` migráció: `(user_id, platform, label, rtmp_url, stream_key, enabled)` — **szigorú RLS (owner-only)**, a `stream_key` **titkosítva**, a kliensnek SOHA nem adjuk vissza (csak szerver használja). Illeszkedik a [secrets-kezelés](./remix/14-security-baseline-docs.md) elvhez.
- [ ] **Worker egress-endpointok** [server/live.js](../../server/live.js) (ÚJ): `/live/egress/start` (LiveKit `EgressClient` Room Composite → RTMP-cél-lista + opc. file-record), `/live/egress/stop`, státusz. **Ownership-verify**: csak a `live_sessions.host_id === auth.uid()` indíthat egresst a saját szobájára.
- [ ] **Egress web-layout template** (a kompozitort böngészőben rendereli livekit-client-tel a data-channel scene-állapotból) — a worker szolgálja ki / hosztoljuk.
- [ ] **Platform-konnektorok**:
  - **Custom RTMP** (URL + kulcs) — mindent lefed, ez a minimum.
  - **YouTube Live** — OAuth + YouTube Live Streaming API (liveBroadcast+liveStream auto-létrehozás, RTMP ingest-URL lekérés).
  - **Twitch** — RTMP ingest + stream-key (OAuth vagy kézi kulcs).
  - **Facebook Live** — Graph API Live Video → RTMP-URL.
  - **TikTok** — ⚠️ **policy-kapuzott**: a TikTok nyilvános RTMP-je korlátozott (TikTok LIVE jogosultság / Live Studio hozzáférés kell); custom-RTMP-ként kezeljük, ahol a user maga adja a kulcsot. (A tervben őszintén jelezve.)
- [ ] **Pro-gate**: a külső multistream + egress-felvétel a meglévő `guardPro(...)` mögött; a ReMix-feed-live marad ingyen.

**Kész, ha:** egy custom-RTMP cél (pl. egy teszt-RTMP-szerver vagy YouTube) élőben megkapja a kompozit streamet; a kulcsok sosem szivárognak a kliensre; `npm run audit` zöld + worker-teszt (`server/live.test.js`).

### 🟦 Fázis F — Hardening + production
Cél: prod-képes élő-infra, biztonság, költségkontroll.

- [ ] **LiveKit prod**: Cloud vagy self-host **+ egress-szolgáltatás** creds (env-csere); dev: `livekit-server --dev` nem tud egresst → a multistream dev-tesztje LiveKit Cloud/self-host-egress kell.
- [ ] **`/live/token` host-ownership verify** (a mai dev-fallback helyett prod-ban a `publish` szerepet a `live_sessions.host_id` ellen döntjük — ez a meglévő live-TODO is).
- [ ] **Képernyő-megosztás natív**: iOS Broadcast Upload Extension config-plugin (LiveKit screen-share), Android MediaProjection permission; natív rebuild (mint a WebRTC-nél).
- [ ] **Rate-limit + költségkontroll**: egress-indítás rate-class ([remix/03-rate-limiting.md](./remix/03-rate-limiting.md)), max párhuzamos egress/felhasználó, max adás-hossz, Pro-kvóta.
- [ ] **Biztonsági illesztés**: RTMP-kulcs titkosítás, egress-authz, data-channel-flood védelem — bekötés a [remix/](./remix/00-README.md) security-backlogba.

**Kész, ha:** prod LiveKit+egress creds-szel egy valós YouTube/Twitch adás végigmegy; a kulcsok titkosítva; rate-limit + Pro-kvóta aktív.

---

## 3. Kockázatok és nyitott kérdések

- **Mobil sávszélesség**: a több-track (kamera+képernyő) + data-channel feltöltés 1×; a fan-out szerveroldali — de gyenge hálón a forrás-feltöltés is szűk lehet → adaptív bitráta (LiveKit simulcast).
- **Egress-költség**: szerveroldali komponálás+enkódolás valós pénz → ezért Pro + kvóta + max-hossz. Dev-ben nincs egress (`--dev`), csak Cloud/self-host.
- **TikTok**: nyilvános RTMP-live korlátozott; nem ígérünk „egy-kattintásos TikTok-live”-ot, csak custom-RTMP-utat ahol a platform engedi.
- **Screen-share iOS**: Broadcast Upload Extension külön natív target + app-group — config-plugin kell (mint a WeakLet), és natív rebuild.
- **Előnézet = egress paritás**: a nézői (RN) és az egress (web) kompozitor UGYANAZT a jelenet-állapotot rendezze — két renderelő, egy modell; a vizuális paritást tesztelni kell (mint a VOD preview=render elvnél).

---

## 4. Végrehajtási sorrend (függőségek)

```text
A (Studio-váz + modell + command) ──► B (élő kompozitor + LiveKit multi-track)
                                           │
                                           ├──► C (élő audio-mixer)
                                           └──► D (feed-megosztás + VOD)
                                                     │
                                                     ▼
                                           E (multistream RTMP · Pro)
                                                     │
                                                     ▼
                                           F (hardening + prod + natív screen-share)
```

**Sprint-javaslat:** A+B egy MVP-kör (OBS-szerű Studio → ReMix-feed-live kompozícióval) — ez ingyen, on-device/edge, azonnal demózható. C+D a produkció-élmény. E+F a külső multistream + prod (Pro + költség + biztonság).

---

## 5. Vezérelvek (minden fázisra)

- **Command bus mindenhez** — a live-szerkesztés is `dispatch(cmd, actor)`, undo-zható, és élőben broadcastolható ([AGENTS.md](../../AGENTS.md)).
- **Egy jelenet-modell, két renderelő** — a néző (RN, [PreviewSurface](../../src/components/preview/PreviewSurface.tsx)) és az egress (web) UGYANABBÓL a `LiveDoc`-ból dolgozik; nincs duplikált kompozitor-logika.
- **A kliens sosem authoritatív** — RTMP-kulcs, Pro-státusz, egress-indítás mind server-side; a `/live/token` és `/live/egress/*` ownership-verifikál.
- **Nincs regresszió a free-rétegen** — a ReMix-feed-live ingyen marad; csak a külső multistream + szerver-egress Pro.
- **Bizonyíték-alapú „Kész”** — minden fázisnak futtatható/e2e elfogadási kritériuma (mint a kamera-e2e-nél: logcat + screenshot).
