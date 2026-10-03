# 🎬 ReMix Video Editor — összhangosítási / fejlesztési terv

> Forrás-vízió: **EDITORS** — közös dokumentummodell (§9) + közös editor-nyelv (§17); a nyers forrás a doksi-konszolidációkor törölve (git-history).
> Testvér-tervek: [devs/tasks/AUDIO.md](./AUDIO.md) · [devs/tasks/IMAGE.md](./IMAGE.md).
> Cél-útvonal: `http://localhost:8081/editor/<projectId>` → [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx)

---

## 0. Kiindulás és cél

A videó-editor a legérettebb a három közül: **övé a command bus, az undo, a sáv/klip-modell, a lejátszó-óra, az előnézet-motor és a worker-render** — a hang- és képstúdió terve épp ezekre épül rá. A cél tehát NEM új funkció a videóba, hanem **összhang**: a videó-editor legyen a három-stúdiós rendszer **gazdája (hub)**, ne pedig saját, párhuzamos részszerkesztők tulajdonosa.

**A közös modellbe illesztés MEGTÖRTÉNT** (a régi egyedi modálok lecserélve — lásd Fázis A):

1. A videó-editor **a KÖZÖS, scoped stúdió-modálokat mountolja** a hang- és képszerkesztéshez:
   [src/app/editor/[id].tsx:630](../../src/app/editor/%5Bid%5D.tsx#L630) — `<ImageStudioModal />` + `<AudioStudioModal />`.
   - [src/components/studio/audio/AudioStudioModal.tsx](../../src/components/studio/audio/AudioStudioModal.tsx) — a KÖZÖS `AudioStudioBody`-t futtatja Modalként, a jelenlegi videó-projekt hang-sávjain (scoped mód, `mode="scoped"`), ugyanazon a store-on → azonnal visszahat a timeline-ra + undo-zható.
   - [src/components/studio/image/ImageStudioModal.tsx](../../src/components/studio/image/ImageStudioModal.tsx) — a KÖZÖS `ImageStudioBody`-t futtatja a kép-klip RÉTEG-fáján (nem-destruktív scene-graph); ha a klipnek nincs `docId`-ja, teljes-vásznas fotó-réteggel `ImageDoc`-ba csomagolja, mentéskor visszaírja az `uri`+`docId`-t egy undo-lépésben.
   A régi `HangStudio` / desztruktív `ImageStudio` ezekkel megszűnt (a testvér-tervek A/B fázisa szerint).
2. A belépők **már léteznek, de szétszórva és inkonzisztensen**:
   - hang: a `mix` panel + „Open Sound Studio” gomb ([AudioPanel.tsx:495](../../src/components/editor/panels/AudioPanel.tsx#L495)) → `openAudioStudio(clipId)`;
   - kép: kijelölt képklip → `openImageStudio(clipId)`, ill. videó-kockából a Toolbar frame-grabje **rögtön a Kép Stúdióba** viszi ([Toolbar.tsx:556](../../src/components/editor/Toolbar.tsx#L556));
   - de nincs egységes „Edit in Studio” minta, és a videóklip HANGJÁRA nincs belépő.

**Cél (a felhasználó kérése):** hozzuk a videó-editort összhangba a hang- és képstúdió tervével — delegálás (nem duplikálás), közös motor, egységes belépők, és a command bus mint **univerzális ReMix Editing API** (EDITORS.md § 17), amin a user ÉS az AI mindhárom szerkesztőt ugyanúgy vezérli.

**Vezérelvek** (EDITORS.md + [AGENTS.md](../../AGENTS.md)):

- **Egy projekt, három nézet.** A `Project` a közös állapot (§ 9): a videó-projekt MÁR hordoz music/voiceover/sfx sávot ÉS `imageDocs`-ot. A stúdiók ugyanezen az egy `useEditorStore` példányon dolgoznak → nincs adat-másolás, minden szerkesztés azonnal és undo-zhatóan visszahat.
- **Delegálás, nem duplikálás.** A videó-editor a részszerkesztést átadja a közös stúdióknak; nem tart fenn saját hang/kép modált.
- **Egy motor.** Az előnézet (natív rétegek) és a worker (Chromium-raszter + FFmpeg) KÖZÖS a három szerkesztőben — „amit a videóban látsz, azt látod a képben/hangban is”. A stúdiók ne forkolják.
- **Command bus = univerzális API** (§ 17). Minden szerkesztés parancson megy; a collab-szinkron és az AI is ezen keresztül hat — mindhárom médiatípusra egyformán.

---

## 1. Architektúra-döntések

### 1.1 A videó-editor = master timeline + stúdió-gazda
A videó-editor marad a fő idővonal; a hang/kép részszerkesztés **scoped stúdióként** nyílik belőle (Modalként, az editor állapotát megőrizve — a testvér-tervek is ezt ajánlják). A `kind: 'audio'` / `kind: 'image'` projekt ugyanazt a stúdió-komponenst nyitja `project` módban (route-ként) — **egy komponens, két mód**.

### 1.2 Egységes stúdió-belépő a store-ban
A mai két külön akció ([editorStore.ts:395](../../src/store/editorStore.ts#L395) `openImageStudio`, [:399](../../src/store/editorStore.ts#L399) `openAudioStudio`) helyett **egy** deklaratív belépő:

```ts
openStudio({ kind: 'audio' | 'image', target: { clipId?, docId?, range? } })
```

Így a belépés-logika egy helyen van, és az AI/collab is egységesen hívja. (A régi akciók vékony burkolóként megmaradhatnak a migrációhoz.)

### 1.3 Command bus mint univerzális szerkesztő-API (§ 17)
A videó-editor commandjai már ezt adják (`ADD_CLIP`/`UPDATE_CLIP`/`SPLIT_CLIP`/…, `UPSERT_IMAGE_DOC`). A harmonizálás: **minden** részszerkesztő ugyanezeken menjen (a desztruktív kép-bake kivétel megszűnik — lásd IMAGE.md), és a collab-live parancs-szinkron ([useCollabLive](../../src/app/editor/%5Bid%5D.tsx#L83)) így a stúdió-szerkesztéseket is AUTOMATIKUSAN átküldi (mert ugyanaz a busz).

### 1.4 Közös motor kiszervezése
A megjelenítők (alakzat/szöveg/kép-réteg, korrekció-tint) és a worker (Chromium-raszter, FFmpeg audio/videó) **közös modulok** legyenek, amiket a videó-editor ÉS a stúdiók is importálnak — ne másolat szülessen a stúdiókban.

---

## 2. Fázisok (mi változzon a videó-editorban)

### 🟦 Fázis A — A saját modálok lecserélése delegálásra
Cél: a videó-editor ne tartson fenn egyedi hang/kép modált. **Állapot: nagyrészt kész** — a mountok lecserélve, a régi modálok megszűntek; csak az `openStudio` egységes akció van hátra.

- [x] **A mountok cseréje** ([editor/[id].tsx:630](../../src/app/editor/%5Bid%5D.tsx#L630)): a régi `<ImageStudio />` + `<HangStudio />` helyett a KÖZÖS, scoped stúdió-Modalok mountolnak — [`<ImageStudioModal />`](../../src/components/studio/image/ImageStudioModal.tsx) + [`<AudioStudioModal />`](../../src/components/studio/audio/AudioStudioModal.tsx). Mindkettő a közös `*StudioBody`-t futtatja `mode="scoped"`-ban, ugyanazon a `useEditorStore`-on.
- [x] **`HangStudio.tsx` és a desztruktív `ImageStudio.tsx` nyugdíjazása** — a fájlok megszűntek; a logika a közös stúdióba költözött (a bevált vezérlők a [studio/audio/primitives.tsx](../../src/components/studio/audio/primitives.tsx) / [ClipEditSheet.tsx](../../src/components/studio/audio/ClipEditSheet.tsx)-ben élnek tovább, a kép scene-graph-/nem-destruktív módon).
- [ ] **Az `openStudio` egységes akció** bevezetése ([editorStore.ts](../../src/store/editorStore.ts)); a `imageStudioClipId`/`audioStudioClipId` ([editorStore.ts:394-400](../../src/store/editorStore.ts#L394)) egy közös `studioTarget` állapottá olvad. (Ma még két külön akció: `openImageStudio`/`openAudioStudio`.)

### 🟩 Fázis B — Egységes „Edit in Studio” belépők a kijelölésre
Cél: a videóból kiválasztott bármi (hang, kép, videóklip-hang) EGY konzisztens gesztussal a megfelelő stúdióban nyíljon.

- [ ] **Toolbar** ([src/components/editor/Toolbar.tsx](../../src/components/editor/Toolbar.tsx)): a kijelölt klip fajtájához egységes „Edit in Studio” gomb:
  - `audio` klip → Audio Studio (scoped, a klipre) — a mai `mix` panel „Open Sound Studio”-ja ide egységesül.
  - `image` klip → Image Studio (scoped); **`docId` round-trip** (IMAGE.md § B): van doc → azt nyitja, nincs → becsomagolja `ImageDoc`-ba.
  - `video` klip → **két művelet**: „Edit frame” (a meglévő frame-grab → Image Studio, [Toolbar.tsx:556](../../src/components/editor/Toolbar.tsx#L556)) ÉS **„Edit audio”** (a klip beágyazott hangja: in-place vagy **detach** a voiceover/sfx sávra → Audio Studio, AUDIO.md § B).
- [ ] **Kontextus-menü** (long-press a timeline-klipen): ugyanezek a belépők (EDITORS.md § 16 gesztus-elv).
- [ ] **PanelHost konzisztencia** ([src/components/editor/PanelHost.tsx](../../src/components/editor/PanelHost.tsx)): a `audio`/`imagedoc` panelek maradnak a gyors, „inline” finomhangoláshoz; a MÉLY szerkesztés a stúdióba visz. A kettő ugyanazt a modellt írja (nincs eltérés).

### 🟨 Fázis C — Közös motor kiszervezése (ne forkoljanak a stúdiók)
Cél: egy megjelenítő + egy worker, három szerkesztő.

- [ ] **Előnézet-rétegek** ([src/components/preview/](../../src/components/preview/) — `ShapeOverlay`, szöveg, kép-réteg, `adjustPreview` tint): olyan modulokká, amiket a kép-stúdió vászna is használ (a videó `PreviewSurface` és a stúdió-canvas KÖZÖS réteg-rajzot hív).
- [ ] **Audio-lejátszás** ([src/components/preview/AudioLayer.tsx](../../src/components/preview/AudioLayer.tsx)): a `TrackAudio`/`fadeFactor`/volume-kf logika közös hookká — a hang-stúdió és az editor előnézete ugyanazt hívja.
- [ ] **Worker-render** ([server/render.js](../../server/render.js), [server/voicechain.js](../../server/voicechain.js), [src/lib/imageDocClient.ts](../../src/lib/imageDocClient.ts)): a scene-graph-raszter és az audio-lánc a videó-renderrel KÖZÖS kód — a stúdió-export ne legyen külön pipeline. (Az audio-master és a kép-formátumok a testvér-tervek E fázisában csatlakoznak ehhez.)

### 🟧 Fázis D — Command bus mint univerzális API + AI (§ 17)
- [ ] **AI a stúdiókra** ([AssistantPanel](../../src/components/editor/panels/AssistantPanel.tsx)): az asszisztens a videó mellett a hang/kép szerkesztést is ugyanazokkal a commandokkal vezérli (audio: `UPDATE_CLIP`/master-lánc; kép: `UPSERT_IMAGE_DOC`). Igény esetén szemantikus parancsok (`SET_FILL`, `APPLY_EFFECT`, `MASTER`) az AI tiszta felületéhez.
- [ ] **Collab-szinkron ellenőrzés**: mivel a stúdió-szerkesztés ugyanazon a command buszon megy, a realtime parancs-szinkron ([editor/[id].tsx:83](../../src/app/editor/%5Bid%5D.tsx#L83)) automatikusan lefedi — tesztelni, hogy scoped stúdió-Modalból is átmegy.
- [ ] **Undo egységessége**: a stúdió-szerkesztés a videó-editor `past/future` history-jába megy (egy közös verem) — nincs külön undo-sziget.

### 🟥 Fázis E — Egységes projekt/navigáció + export + asset round-trip
- [ ] **Stúdió-váltó a projekten belül**: a videó-editorból közvetlen belépő a projekt hang- ill. kép-oldalára (scoped) — és fordítva a stúdiókból „vissza a videóba”. A stúdió-lista a `kind` szerint már routol ([`studioRoute`](../../src/lib/projectUtils.ts#L31) → `/studio/audio|image/<id>`, ill. stúdió nélküli fajta → `/editor/<id>`; használat: [studio/index.tsx:210](../../src/app/studio/index.tsx#L210)); ezt egészíti ki a projekten belüli váltás.
- [ ] **Egy Export panel három kimenetre** ([src/components/editor/panels/ExportPanel.tsx](../../src/components/editor/panels/ExportPanel.tsx)): videó (MP4), kép-projekt (PNG/SVG/…), hang-projekt (WAV/MP3/…) — a fajta szerint ugyanaz a belépő, ugyanaz a worker-pipeline.
- [ ] **Asset round-trip**: a kép-doc raszter már képklipként kerül be (`docId`-vel), a hang-projekt renderje asszet-ként a videóba (AUDIO.md § E) — a videó-editor mindkettőt „hivatkozott médiaként” kezelje (mint ma az `Asset`-eket).

---

## 3. Store / modell-változások (a videó-editor oldalán, minimál)

- [ ] `openStudio({ kind, target })` egységes akció + közös `studioTarget` állapot ([editorStore.ts](../../src/store/editorStore.ts)) — a két külön `open*Studio` helyett.
- [ ] A `docId` round-trip beépítése a képklip-beszúrásba (a mező magát az IMAGE.md § 3 vezeti be; a videó-editor oldali TEENDŐ a kitöltés + újranyitás).
- [ ] `extractAudioFromClip(videoClip)` segéd (demux → voiceover/sfx `AudioClip`) — a „video-selected audio” belépőhöz (AUDIO.md § B).
- [ ] Semmi új adat-alaptípus a videó-modellben; a változás nagyrészt **refaktor + belépő-egységesítés**.

---

## 4. Érintett fájlok

**Módosítani:**
- [src/app/editor/[id].tsx](../../src/app/editor/%5Bid%5D.tsx) — ✅ a mountok már a közös stúdiókra mutatnak ([`<ImageStudioModal />`](../../src/components/studio/image/ImageStudioModal.tsx) + [`<AudioStudioModal />`](../../src/components/studio/audio/AudioStudioModal.tsx), [:630](../../src/app/editor/%5Bid%5D.tsx#L630)).
- [src/store/editorStore.ts](../../src/store/editorStore.ts) — `openStudio` egységesítés, `studioTarget`.
- [src/components/editor/Toolbar.tsx](../../src/components/editor/Toolbar.tsx) — egységes „Edit in Studio” belépők (audio/image/video-klip-hang).
- [src/components/editor/PanelHost.tsx](../../src/components/editor/PanelHost.tsx) — inline panel ↔ mély stúdió konzisztencia.
- [src/components/editor/panels/AudioPanel.tsx](../../src/components/editor/panels/AudioPanel.tsx) + [ImageDocPanel.tsx](../../src/components/editor/panels/ImageDocPanel.tsx) — a „Open Studio” gombok az egységes akcióra; `docId` kitöltés.
- [server/render.js](../../server/render.js) — közös export-pipeline a három kimenetre.

**Kiszervezni (közös modul, hogy a stúdiók is használják):**
- [src/components/preview/](../../src/components/preview/) réteg-megjelenítők + [src/lib/adjustPreview.ts](../../src/lib/adjustPreview.ts).
- [src/components/preview/AudioLayer.tsx](../../src/components/preview/AudioLayer.tsx) audio-preview hook.

**Megszüntetve / átirányítva (✅ kész):**
- `src/components/editor/HangStudio.tsx` → megszűnt; helyette a közös [src/components/studio/audio/AudioStudioModal.tsx](../../src/components/studio/audio/AudioStudioModal.tsx) (scoped `AudioStudioBody`).
- `src/components/editor/ImageStudio.tsx` (desztruktív) → megszűnt; helyette a közös, scene-graph [src/components/studio/image/ImageStudioModal.tsx](../../src/components/studio/image/ImageStudioModal.tsx) (nem-destruktív `ImageStudioBody`).

---

## 5. Nyitott kérdések / kockázatok

- **Modal vs. route egységesen:** a három terv Modalt ajánl a videóból (állapot-megőrzés) és route-ot önálló projektnél. Az `openStudio` mindkettőt kezelje. → Közös döntés a testvér-tervek A/B határán.
- **Refaktor mértéke most:** a közös-motor kiszervezés (C fázis) a legnagyobb munka; megtehető fokozatosan (a stúdiók addig a meglévő megjelenítőket importálják), hogy ne blokkolja az A/B-t.
- **Regresszió-kockázat:** a videó-editor a legérettebb — a mountok/akciók cseréjekor a collab-szinkron, az undo és az autosave viselkedését végig kell tesztelni (`npm run audit` + kézi).
- **Kind-váltás:** egy `video` projektből „hang-only” vagy „kép-only” export nem kind-váltás, hanem nézet/kimenet — ne keverjük a projekt fajtájával.

---

## 6. Definition of Done (a harmonizáció)

1. A videó-editor **nem tart fenn saját** hang/kép modált — a kijelölt hang/kép a **közös** stúdióban nyílik (scoped), egy `openStudio` akcióval.
2. Konzisztens „Edit in Studio” belépő a Toolbaron/kontextus-menüben mindhárom esetre (audio klip · image klip `docId`-vel · video klip hang: in-place/detach).
3. A stúdió-szerkesztés a videó-editor **közös** command buszán / undo-verménén megy, és a collab-szinkron automatikusan átviszi.
4. Egy Export-belépő és egy worker-pipeline szolgálja ki a videó/kép/hang kimenetet; az asset round-trip (kép-doc, hang-render) működik.
5. `HangStudio.tsx` és a desztruktív `ImageStudio.tsx` megszűnt/átirányít — **egy** szerkesztő-motor és **három** nézet maradt.
6. `npm run audit` zöld (tsc + lint + jest); a collab/undo/autosave regresszió-mentes.
