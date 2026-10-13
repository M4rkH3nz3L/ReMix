# 🛠️ TECH-TOP.md — mit kell javítani az ALAPSZABÁLYOKHOZ

> **Mi ez:** a felhasználó **alapszabályai** (tartalom-tulajdon, 3 projekt-típus, megosztás, jogok, coin,
> szerver, UI) alapján a **konkrét technikai teendő-lista** — szabályonként: **Szabály · Ma (kód) · Javítás · Prio**.
> Párja: [SCOPES.md](./SCOPES.md) (entitlement-scope, a `free=eszközön` már kódolva+tesztelve), [uzleti-terv.md](./uzleti-terv.md),
> [PROD.md](./PROD.md). **Prio:** 🔴 P0 (identitás/prod-blokkoló) · 🟠 P1 (core-teljesség) · 🟡 P2 (UX/finomítás).

---

## 🧭 HALADÁS (lépésről lépésre, bizonyítva — 2026-10-13)

| Lépés | Tétel | Állapot |
|------|-------|---------|
| 1 | **Routing-magok** (`shouldWatermark`/`canCloudRender`/`canCloudStore`) kliens+szerver, unit + **contract-lock** | ✅ **KÉSZ** (40 teszt) |
| 2 | **Szerver render-routing enforce**: `/render` → `paidOnly` (**min Amatőr**, free→402 „eszközön"); + **`isPro` bug-fix** (eddig a Profi/Céges usert is elutasította!) + `server/tiers.js` mirror + contract | ✅ **KÉSZ** (audit 177/1915) |
| 3a | **Free-vízjel — KÉP** (`/imagedoc`, **szerver-hiteles** tier; a kliens nem kapcsolhatja ki) | ✅ **KÉSZ** — élő-verifikált (free→„Made with ReMix", pro→nincs) |
| 3b | Free-vízjel — **videó/hang** | 🔗 **az Android on-device render-motorhoz KÖTÖTT** (lenn): a `/render` worker `paidOnly` → free nem éri el, a fizetős kimenet vízjel-mentes → a free videó/hang-vízjel **az eszközön-render-motor dolga**. A vízjel-MECHANIZMUST a kép már bizonyította (közös `shouldWatermark`). |
| 4 | **Content-típus publish-célok** (`targetsForKind`: videó→TikTok/IG/YT/FB · kép→FB/Pinterest · hang→SoundCloud/Spotify) | ✅ **KÉSZ** (specek + teszt; az OAuth/feltöltés-wiring a fiókokhoz kötött) |
| 5 | **Tartalom-tulajdon ToS** (anti-CapCut klauzula + vízjel-kivétel) | ✅ **KÉSZ** (legal.ts §3 + 6 teszt) |
| 6 | **Collab-gate + owner=Admin + Céges-gate** (`collabAccess`: `canCollaborate`=Amatőr+ · `collabCan` owner=minden · `canManageCompany`=Céges) + szerver `/invite` → `paidOnly` | ✅ **KÉSZ** (collabAccess.test +6; /invite enforce) |
| 7+ | kép-galéria · hang-album · cross-editor · coin-recurring · UI-drawer · **Android on-device render-motor** (+ a free videó/hang-vízjel vele) | ⬜ |

> **Eddig bizonyítva:** az `ENTITLEMENTS`-re kötött routing (Free=eszközön, felhő=Amatőr+) él, szerver-enforce-olt és
> kliens≡szerver contract-tesztelt. Menet közben **valódi bug** javítva: a `isPro` csak a `'pro'`-t fogadta el → a
> **Profi (ultra) és Céges (business)** usert is kizárta a worker-ből; most rang-alapú (`tierMeetsMin`).

---

## 0. ⭐ Alap-direktíva — a tartalom a USERé (anti-CapCut)

> **Szabály:** a CapCut „magáévá teszi" a user tartalmát — **MI NEM.** Minden a useré marad. **Kivétel: a vízjeles
> (ingyenes) exportok a MIEINK — de a user szabadon használhatja.**

- **Javítás:**
  - [x] ✅ **ToS/jogi KÉSZ** ([legal.ts](../../src/constants/legal.ts) §3): „a tartalom a TE tulajdonod marad" + **nem-kizárólagos**
    licenc + **nyomatékos anti-CapCut** (nincs tulajdon-elvétel, nincs hozzájárulás nélküli reklám/AI-tanítás) +
    **vízjel-kivétel** (a „Made with ReMix" free-export a platformé, de **korlátozás nélkül** használható). **Bizonyítva:**
    [legal.test.ts](../../src/constants/legal.test.ts) (6 teszt zárolja a klauzulákat).
  - [ ] 🔴 **Kötelező free-vízjel mind a 3 típuson** — KÉP ✅ (lásd [§1](#1-kötelező-free-vízjel--minden-típuson)); videó/hang 🔗 az Android on-device render-motorral.

---

## 1. Kötelező free-vízjel — MINDEN típuson

> **Szabály:** ingyenesben a **videó, a kép ÉS a hang is** vízjelezve. (A vízjel entitlement már kész: `watermark=true` free-n.)

- **Ma:** az [entitlements.ts](../../src/lib/entitlements.ts) `watermark` gate **kész+tesztelt**, de a **render-láncban nincs beégetve**;
  a meglévő `buildWatermarkClip` (brandKit) a user LOGÓJA, nem a kötelező platform-vízjel.
- **Javítás:**
  - 🔴 **Videó-vízjel** a render-láncban (eszközön ÉS worker), a **szerver-hiteles** `watermark` entitlement szerint (kliensből NEM kikapcsolható).
  - 🔴 **Kép-vízjel**: az `/imagedoc` + eszközön-raszter a free-exportra ráégeti a „Made with ReMix"-et.
  - 🔴 **Hang-vízjel**: free-audio exportra **branded hang-tag (stinger)** vagy periodikus halk jelzés + metaadat-branding.
  - 🟠 **Egy közös `applyWatermark(kind, tier)`** mag (pure, tesztelt), amit mind a 3 renderelő hív.

---

## 2. A 3 projekt-típus — TELJES scope

A `kind: 'video' | 'image' | 'audio'` már megvan, de a kép/hang **nem teljes** a szabályokhoz:

### 2.1 🎬 Videó — teljes short, max 10 perc
- **Ma:** ✅ editor + **10 perc hard-cap** kész ([projectUtils](../../src/lib/projectUtils.ts) `MAX_PROJECT_DURATION_SEC` + `/render` gate + contract).
- **Javítás:** 🟠 a cross-editor szerkesztés bekötése (lásd 2.4).

### 2.2 🖼️ Kép — teljes GALÉRIA (nem egy-doc)
- **Szabály:** a user **teljes galériát** hoz létre, a hírfolyamba megosztható (mint a videó), **zenei illusztrációval + diavetítés-funkcióval**.
- **Ma:** az image-stúdió **egy `ImageDoc`** (egy vászon) — nincs több-képes galéria/album, se diavetítés, se háttérzene.
- **Javítás:**
  - 🟠 **Galéria-projekt**: több `ImageDoc`/kép egy projektben (rendezhető lista).
  - 🟠 **Diavetítés-mód**: a galériából időzített slideshow (áttűnés/időzítés) → megosztható videó-szerű poszt.
  - 🟠 **Háttérzene** a diavetítéshez (a hang-mag újrahasználásával).
  - 🟠 **Feed-megosztás**: a galéria **lapozható** posztként (mint a remix-pager).

### 2.3 🎧 Hang — teljes ALBUM + borító
- **Szabály:** a user **teljes albumokat** hoz létre + **borítót** ad hozzá; a projekt a share-be a **TELJES albumot** osztja meg.
  Több tartalomnál **lapozható** (mint egy videó remixelésekor). A **borítót/albumot a KÉPSZERKESZTŐVEL** szerkeszti.
- **Ma:** az audio-stúdió **egy multi-track projekt** (egy „szám") — nincs **album** (több szám) + **borító** + album-share + pager.
- **Javítás:**
  - 🟠 **Album-projekt**: több hang-track/„szám" egy albumban (rendezhető).
  - 🟠 **Borító**: az albumhoz kép-borító, a **kép-szerkesztővel** szerkesztve (cross-editor).
  - 🟠 **Album-share**: a feedbe a **teljes album** egy **lapozható** posztként.

### 2.4 🔁 Cross-editor szerkesztés (KÖTELEZŐ)
- **Szabály:** a **videó tartalmait** szükség esetén az **audió- és kép-szerkesztőben is** tudja szerkeszteni.
- **Ma:** részleges (videó-hang leválasztás, frame-capture); nincs teljes cross-editor út.
- **Javítás:** 🟠 egységes híd: a videó **hang-sávja → Hang Stúdió**, a videó **képkockái/képei → Kép Stúdió**, majd vissza a videóba.

---

## 3. Platform-megosztás TARTALOM-TÍPUS szerint

> **Szabály:** a user a tartalom-típustól függően a **megfelelő platformra** oszt meg.

| Típus | Cél-platformok (szabály) | Állapot |
|-------|--------------------------|---------|
| **Videó** | YouTube, TikTok, Reels, Facebook | ✅ `targetsForKind('video')` |
| **Kép** | Facebook, **Pinterest** | ✅ `targetsForKind('image')` |
| **Hang** | **SoundCloud, Spotify** | ✅ `targetsForKind('audio')` (Spotify: disztribútor-note) |

> ✅ **Specek + kiválasztás kész** ([publishTargets.ts](../../src/lib/publishTargets.ts) `PublishPlatform`+`kinds`+`targetsForKind`, tesztelt).
> Hátra: az **OAuth + feltöltés-wiring** platformonként (fiók-függő, külön kör).

- **Ma:** [publishTargets.ts](../../src/lib/publishTargets.ts) `PublishPlatform = tiktok|instagram|youtube|facebook` — **csak videó**, nem content-type-aware.
- **Javítás:**
  - 🟠 **Content-type-aware target-lista**: a projekt `kind`-je szerint a releváns platformok (videó/kép/hang külön készlet).
  - 🟠 **Új adapterek**: Pinterest (kép), SoundCloud + Spotify (hang) — OAuth + feltöltési szabályok (Spotify: disztribúció-korlát → jelezni).
  - Entitlement: `publish.maxAccounts`/`publishSchedule` már kész (SCOPES §5).

---

## 4. Együttműködés & jogok (owner = Admin)

> **Szabály:** a user a **saját tartalmánál mindig Admin**, és **jogokat oszthat a barátainak** (pl. projektek, live).
> **Amatőr** előfizetésnél már tud **collabolni** projektekben. **Cégesnél** a user **létrehozza a cégét**, hozzáadja és
> **szakszerűen jogosultság-kezeli a dolgozóit**.

- **Ma:** RBAC + workspace + collaboration **magok készek** ([rbac]/workspace); az entitlement `rbac` + `team.seats` a Céges-en kész (SCOPES §5).
- **Javítás:**
  - [x] ✅ **Owner=Admin** + **collab-gate** + **Céges-gate** MAG ([collabAccess.ts](../../src/lib/collabAccess.ts) + 6 teszt):
    `collabCan('owner', *)` = minden jog · `canCollaborate` = Amatőr+ · `canManageCompany` = Céges. Szerver: `/invite` → `paidOnly`
    (a meghívó min. Amatőr). *(Hátra: a barát-meghívás/jog-osztás UI + a Céges szervezet-modell [org + dolgozók] implementálása.)*

---

## 5. Coin-gazdaság + tárhely-csatolt előfizetés

> **Szabály:** az app fizető-eszköze a **coin** (pénzért vehető). Az **előfizetés + extrák** (extra AI, extra **tárhely**)
> coinnal növelhető **havidíjban**, és a **havi ár automatikusan nő** — mert különben a user **elveszti a tartalmait**,
> ha a tárhely leesik.

- **Ma:** coin-pénztárca kész; a storage-kvóta külön ([storageQuota](../../src/lib/storageQuota.ts)); **nincs** coin→recurring-extra csatolás, se tárhely-védelem.
- **Javítás:**
  - 🟠 **Coin-vásárlás pénzért** (IAP; a cash-out továbbra is **jogi gate** mögött — SCOPES).
  - 🟠 **Extra-csomagok havidíjban** (extra tárhely/AI): a coin-vásárlás **megemeli a recurring havidíjat** (nem egyszeri) → az entitlement `storageQuotaGB`/`aiTokens` dinamikusan nő.
  - 🔴 **Tárhely-védelem (adatvesztés-tiltás):** ha a tárhely csökkenne a tartalom alá, **ne törlődjön** — a rendszer **figyelmeztet** + a havidíj tartja a tárhelyet (grace + banner), összhangban az ADR-013 data-loss-elvvel.

---

## 6. Szerver / worker szabályok

> **Szabály:** a **Worker (Hetzner)** és a **Storage (R2)** **min. Amatőr** előfizetés — a **Free-ben MINDENT az eszköz
> végez** (render, tárhely, minden). YT/TikTok-importnál **megadható a -tól–-ig tartomány** (max 10 perc).

- **Ma:** az entitlement `renderEngine=device` (free) + `storageLocation=device` (free) **kész+tesztelt**; a **routing-enforce
  hiányzik** (a free-nek device-ra kell esnie, a worker/R2 csak Amatőr+). On-device YouTube-import van, **range-választó nincs**.
- **Javítás:**
  - 🔴 **Render-routing enforce**: a free render **kötelezően eszközön** (worker-submit csak `tierMeetsMin('basic')`-nél) — a szerver `/render` is utasítsa el a free felhő-submitet. **Előfeltétel: Android eszközön-render-motor** (NATIVE.md, #1 technikai út).
  - 🔴 **Storage-routing enforce**: free = eszköz-tár; R2 csak Amatőr+ (`storage.location`/`cloudBackup` entitlement).
  - 🟠 **Import-range**: a YouTube/TikTok-importnál **-tól–-ig** (max 600 mp) választó → csak a kért szakasz importálódik.

---

## 7. UI-újratervezés (érintő-first, telefon + tablet)

> **Szabály:** az **alsó menü túlzsúfolt mindenhol** → **érintő-barát** elrendezés: **jobbról behúzható** (eszközök) /
> **balról bejön** (beállítások); telefonon **behúzható**, iPaden/tableten **dokkolt/elérhető**. A **videó/kép-szerkesztő
> borzalmasan zsúfolt** (az alsó menü miatt). A **profil + annak szerkesztője** túl zsúfolt → **lapokra** (user-adatok,
> tárca, AI-agentek…).

- **Ma:** sűrű alsó eszköztár az editorokban (kép/videó); a [useLayout](../../src/hooks/useLayout.ts) size-class-rendszer megvan
  (`isExpanded` iPad-dokkolt) — az alap adott, de a **menü-információsűrűség** a probléma.
- **Javítás:**
  - 🟡🟠 **Behúzható panel-rendszer (drawer):** telefon = **swipe/behúzható** bal (beállítások) + jobb (eszközök); tablet/iPad =
    **dokkolt oldalsáv** (`isExpanded`). Közös komponens, size-class-vezérelt → **editor-declutter**.
  - 🟡 **Editor-declutter**: az alsó eszköztár helyett **kategorizált, behúzható** eszköz-csoportok (kevesebb egyszerre látszó gomb).
  - 🟡 **Profil tab-okra bontása:** *User-adatok* · *Tárca (coin/előfizetés/tárhely)* · *AI-agentek* (melyik agent milyen
    feladatra) · *Tartalmak/projektek* · *Beállítások* — logikus lapokkal a mai egy-zsúfolt oldal helyett.

---

## 8. Prioritás-összegzés (mivel kezdjük)

| Prio | Teendő |
|------|--------|
| 🔴 **P0** | tartalom-tulajdon ToS · **free-vízjel (videó/kép/hang)** a render-láncban · **render/storage-routing enforce** (free=eszköz, worker/R2=Amatőr+) · **Android eszközön-render-motor** (a free alapja) · tárhely-védelem (adatvesztés-tiltás) |
| 🟠 **P1** | kép-**galéria**+diavetítés+zene · hang-**album**+borító+pager · cross-editor szerkesztés · content-típus-**megosztás** (Pinterest/SoundCloud/Spotify) · **owner=Admin + collab (Amatőr+) + Céges-cégkezelés** · coin→recurring extra (tárhely/AI) · import-range |
| 🟡 **P2** | **UI-drawer** (érintő, telefon+tablet) + **editor-declutter** · **profil tab-okra** |

> **A kritikus út** (identitás + a modell alapja): a **free-vízjel + az Android eszközön-render-motor + a render/storage-routing
> enforce** — e nélkül a „Free = eszközön, vízjellel" alapszabály nem áll. A többi erre épül.
