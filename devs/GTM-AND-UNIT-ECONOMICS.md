# vided — Go-to-Market + Unit Economics

> Stratégiai munkadokumentum. Minden szám **becslés, tartományokkal** — a
> feltevések explicit módon jelölve, hogy te a saját adataiddal felülírhasd.
> Cél: creatoroknak szánt remix-natív rövidvideó-eszköz + feed.
>
> **Egymondatos tézis:** *nem TikTok-versenyt nyerünk, hanem a legjobb
> remix-natív mobil editort adjuk egy szűk creator-niche-nek — tool-first,
> exporttal kifelé — és a feed a template/inspiráció-réteg, ami idővel közösséggé
> sűrűsödik.*

---

# RÉSZ A — Go-to-Market

## A0. A stratégiai döntés: tool-first, social-second

Két hard problémát ne oldj meg egyszerre. A social háló cold-startja (nincs néző →
nincs alkotó) tőke- és időigényes; az eszköz viszont **közönség nélkül is értékes**,
mert a kész videót a creator a saját TikTok/YouTube/IG-közönségének exportálja.

- **Fázis 1 (most):** a legjobb remix-natív editor egy niche-nek → **fizető
  creatorok**, export kifelé. A feed = template/inspiráció-marketplace.
- **Fázis 2 (ha az 1 beválik):** a feed önálló fogyasztási felület lesz, mert
  addigra van tartalom-kínálat (a Fázis 1 creatorai gyártják).

Ez megfordítja a cold-startot: **előbb a kínálat (creatorok + template-ek),
utána a kereslet (nézők)** — a template-ek pedig egyben a te feeded magja.

## A1. A wedge-niche (elsődleges + 2 tartalék)

A wedge legyen olyan, ami **egyszerre**: (a) remix-natív viselkedésű, (b) fizet
eszközért, (c) elkerüli a zene-licenc aknamezőt, (d) hozza a saját közönségét
(cold-start-mentes).

### ✅ Elsődleges: „faceless" / template-alapú rövidvideó-creatorok
A leggyorsabban növő short-form szegmens (AI/faceless csatornák, listás/tippes
tartalom, idézet-videók, „X dolog amit…"). **Miért pont ez:**
- **A template = remixelhető projekt** — pontosan a te modelled. Egy közzétett
  poszt egy peer számára egy remixelhető sablon. A remix nálad *natív*, nem plugin.
- **Fizetnek** eszközért (CapCut Pro, Opus, Veed, Captions előfizetők).
- **Nincs saját közönség-igény** — TikTok/YT-ra exportálnak, tehát nem kell
  előbb feedet építened, hogy értéket adj.
- **Nagy volumen** (napi több videó) → a remix-loop gyakran pörög.

### Tartalék 1: mikro-oktatók / explainer-creatorok
Magyarázó rövidvideók (tanárok, coachok, „hogyan"-tartalom). Remixelik egymás
formátumait; magas willingness-to-pay; kevés jogdíj-kockázat. Kevésbé virális.

### Tartalék 2: helyi vertikum (ingatlanos / edző / vendéglátó)
B2B-közeli, magas fizetőképesség, volumen-igény (heti több short), a nyerő
formátumokat remixelnék. Könnyű monetizálni, de nem „virális" — inkább SaaS.

> **Amit tudatosan NEM célzol az elején:** a „music edits"/anime-edit szubkultúra —
> hatalmas és remix-natív, DE zene-copyright rémálom és nulla fizetőképesség; és a
> meme-kultúra — virális, de csak reklámmal monetizálható (MAU-milliókat kíván).

## A2. North Star + metrika-fa

**North Star: heti Remix-Aktiváció** — *a nézők/megnyitók hány %-a lesz alkotó
egy remixen keresztül*. Ez az EGYETLEN szám, ami eldönti, van-e „cég" vagy csak
„jó editor". Ha magas → van viral-loop és tartalom-motor.

```
North Star: Remix-arány (viewer → creator)
├── Aktiváció:  új user → 1. közzétett/exportált videó  (< 10 perc, „aha")
├── Remix-loop: közzétett videó → hány remix születik belőle (K-faktor)
├── Retention:  D1 / D7 / D30 megtartás (creator-oldal)
├── Habit:      heti aktív creator / heti published videó/fő
└── Monetizáció: free→paid konverzió, ARPPU, churn
```

Kiegészítő: **Time-to-first-export** (< 10 perc a cél) és **Remix-completion**
(a remixet elkezdők hány %-a teszi közzé) — ha ez alacsony, az editor túl nehéz
a nézőből-lett-alkotónak → egyszerűsíteni kell a remix-belépőt.

## A3. Cold-start: a kínálat-oldal megoldása

1. **Seed-template-ek kézzel:** 30–50 profi, remixelhető template a niche
   nyerő formátumaira (te/1-2 creator gyártja). A feed nem üres, és mindegyik
   egy koppintással remixelhető — ez a demó *és* a termék.
2. **10–20 „alapító creator":** kézzel toborzott niche-creatorok, akik cserébe
   korai pro-hozzáférésért gyártanak template-eket. Ők a magját adják a feednek.
3. **Export-vízjel (opcionális, halk):** a kifelé exportált videón diszkrét
   „made with vided" — organikus felfedezés a niche-en belül. (Kikapcsolható a
   Pro-ban → egyben monetizációs ösztönző.)

## A4. A 90 napos terv (3 × 30 nap)

### Nap 1–30 — „Aktiváció" (működik-e az aha?)
- **Cél:** 20 alapító creator, 50 seed-template, **time-to-first-export < 10 perc**.
- **Tennivaló:** onboarding-flow (regisztráció → első remix → export 3 lépésben);
  a 3 legfontosabb niche-formátum template-je; 1:1 interjú mind a 20 creatorral.
- **Mérd:** aktiváció %, time-to-first-export, hol akadnak el (funnel).
- **Kill-kritérium:** ha < 40% aktiválódik VAGY a remix-completion < 30% →
  az editor túl nehéz a belépőnek; állj le a feature-ökkel, egyszerűsítsd a remixet.

### Nap 31–60 — „Loop" (pörög-e a remix?)
- **Cél:** K-faktor mérhető; **≥ 1 remix / közzétett template**; D7 retention ≥ 20%.
- **Tennivaló:** remix-attribúció UI (már megvan), „remixeld ezt" CTA, heti
  template-kihívás a niche-ben, értesítések (a `notifications` tábla kész).
- **Mérd:** remix-arány, K-faktor, D1/D7, heti published/fő.
- **Kill-kritérium:** ha a remix-arány < 0.2 (alig remixelnek) → a wedge rossz,
  válts a Tartalék 1/2 niche-re.

### Nap 61–90 — „Willingness to pay" (fizetnek-e?)
- **Cél:** Pro-csomag élesítése, **≥ 5% free→paid** a legaktívabb kohorszon.
- **Tennivaló:** Pro = 4K/hosszabb export, vízjel le, prémium template-ek,
  gyorsabb render-sor; árazás-teszt (2 ársáv A/B).
- **Mérd:** konverzió, ARPPU, churn, CAC (ha fizetsz hirdetésért).
- **Kill-kritérium:** ha < 2% fizet a heavy-userek közt sem → a niche nem fizet
  eszközért; vagy vertikum-váltás (Tartalék 2), vagy más monetizáció.

## A5. Csatornák (hol találod ezt a niche-t)

- **TikTok/YT „how I edit" tartalom** alatt (a te niche-ed creatorai ott tanulnak).
- **Discord/Reddit** niche-közösségek (faceless-channel, capcut-template, editing).
- **Template-creator partnerségek** — aki template-et árul CapCuthoz, annak a
  te remix-modelled jobb; behozza a követőit.
- **„Build in public"** — magyar/nemzetközi indie-hacker + creator-tér; a te
  egyedülálló remix-tézised jó horog.
- **Kezdd 1 csatornán**, ne szórd szét — a niche szűk, a szájreklám gyors.

## A6. Monetizáció

- **Creator-subscription** (NEM reklám — az MAU-milliókat kíván):
  - **Free:** vízjeles export, 720p, alap template-ek, alap render-sor.
  - **Pro (~$8–12/mo):** vízjel le, 1080p/4K, hosszabb videó, prémium template-ek,
    prioritásos render, AI-kvóták.
- **Később:** template-marketplace jutalék (creator elad egy template-et → %),
  brand/csapat-csomag a Tartalék 2 vertikumnak.
- **Miért subscription:** kiszámítható ARR, a unit-economics (lásd B rész) még
  szerény konverzió mellett is pozitív tool-skálán.

## A7. Amit még NE építs

- ❌ Chat/DM, csoportok (M10) — nincs elég user, hogy értelme legyen.
- ❌ For-You ML-ranker (M11) — kevés adaton felesleges; latest+following elég.
- ❌ Reklám-rendszer — MAU-milliók kellenének hozzá.
- ❌ Több platformra natív app egyszerre — 1 platform (iOS VAGY Android), 1 niche.
- ❌ 4K/long-form render alapból — drága (lásd B rész); Pro-fal kapuzd.

---

# RÉSZ B — Unit Economics (1000 aktív creator)

> **Cél:** mennyibe kerül 1000 aktív creator a JELENLEGI úton (Supabase +
> FFmpeg render worker + felhő-storage/egress), és hol robban a költség.

## B1. Feltevések (explicit — írd felül a saját adataiddal)

| Paraméter | Érték | Megjegyzés |
|---|---|---|
| Aktív creator | „≥ 4 videó/hó"; a modellben **8 videó/hó** | egy szolid aktív creator |
| Videó-hossz | 30 s | rövid formátum (a default) |
| Renderelt feed-videó | 720p H.264 ≈ **8 MB** | ~2 Mbps × 30 s |
| Nyers forrás-assetek/videó | ≈ **60 MB** | 1–2 klip, 1080p — a **cross-device remix** ára |
| Render-compute/videó | ≈ **60 CPU-mp** | ffmpeg + Chromium-raszter + filterek |
| Storage-díj | **$0.021/GB-hó** | Supabase/S3 nagyságrend |
| Egress-díj | **$0.09/GB** (naiv) … **$0.00–0.01/GB** (R2/Bunny) | *a legnagyobb tétel* |
| Render-compute-díj | ~**$0.04/vCPU-óra** | on-demand kis mag (spot ~1/3) |
| Retenció | 12 hó (steady-state storage ≈ 12× havi) | régi tartalom megőrzése |

## B2. Költség / creator / hó (a fix részek)

- **Render:** 8 videó × (60 CPU-mp = 0,0167 CPU-óra × $0.04 ≈ $0.0007) + orchestration/
  retry felár → **≈ $0.005/videó → $0.04/creator/hó**.
- **Storage (havi hozzáadott):** (8×8 MB + 8×60 MB) = 0,544 GB × $0.021 = **$0.011**.
  - **Steady-state (12 hó megőrzés):** ≈ 6,5 GB × $0.021 = **$0.137/creator/hó**.
  - *Dedup:* a hash-kulcsos asset-tár (már megvan) csökkenti, ha ugyanazt a forrást
    többen remixelik — a valós szám ennél kisebb lehet.
- **Platform (Supabase DB/auth/realtime allokáció):** ~**$0.10–0.20/creator/hó**.

Ez a **fix mag ≈ $0.18–0.38/creator/hó** — olcsó. A robbanás az **egress**, ami a
**nézettségtől** függ (nem a creator-számtól).

## B3. Egress — a nagy változó (nézettség-függő)

| Forgatókönyv | Nézés/videó | In-app egress/creator/hó | Naiv CDN ($0.09) | R2/Bunny (~$0.01) |
|---|---|---|---|---|
| **Tool-first** (export kifelé, alig van in-app nézés) | ~50–100 | ~4–6 GB | ~$0.40–0.55 | ~$0.04–0.06 (R2: ~$0) |
| **Kis social** | ~500 | ~32 GB | ~$2.9 | ~$0.32 (R2: ~$0) |
| **Növő social** | ~2000 | ~128 GB | **~$11.5** | ~$1.3 (R2: ~$0) |

> 1 videó × 1 nézés ≈ 8 MB egress. In-app egress = videó/hó × nézés/videó × 8 MB.

## B4. Összesített: 1000 aktív creator / hó

| Forgatókönyv | /creator/hó | **1000 creator/hó** | Éves |
|---|---|---|---|
| **1. Tool-first, optimalizált infra (R2/Bunny)** | **$0.25–0.40** | **$250–400** | ~$3–5k |
| **2. Növő social, NAIV infra (Supabase/CloudFront egress)** | **~$12** | **~$12 000** | ~$144k ⚠️ |
| **3. Növő social, optimalizált infra (R2 free egress)** | **$0.5–1.7** | **$500–1 700** | ~$6–20k |

**Következtetés:** a jelenlegi stack a **tool-skálán / kis közönségnél teljesen
rendben** (1000 creator ≈ pár száz dollár/hó). A social-oldal növekedésekor **két
dolog robban**: a naiv egress és a nyers-asset-upload — de mindkettő olcsón javítható.

## B5. A két „költség-bomba" és a fix

1. **Egress (messze a legnagyobb).** A Supabase/CloudFront egress ($0.09/GB) videóra
   drága. **Fix:** a videót tedd **Cloudflare R2-be (ingyen egress)** vagy **Bunny
   CDN-re (~$0.01/GB)**, a Supabase maradjon DB/auth/realtime. Ez a legnagyobb
   tétel **5–90×-esét** vágja le. → **egysoros architektúra-döntés, óriási hatás.**
2. **Nyers-asset-upload a cross-device remixhez.** Minden közzététel ~60 MB nyers
   médiát tölt fel — ez hízlalja a storage-ot. **Fix opciók:**
   - **Proxy-remix:** ne a nyers eredetit töltsd fel, hanem a **720p proxyt** (már
     generálod!); az eredetit csak *igény szerint* (ha valaki tényleg pro-remixel).
   - **Opt-in „remixelhető":** alapból csak a lejátszható videó megy fel; a teljes
     projekt-asset csak ha a creator bekapcsolja a remixelhetőséget.
   - **Dedup** (már megvan, hash-kulcs) + **retenció-politika** (régi, nem
     remixelt assetek évülése).

## B6. Render-on-publish skálázása

A render-compute maga **olcsó** ($0.04/creator/hó) — DE a jelenlegi **egy Node
worker** dev-műtermék. Skálán: **job-queue (BullMQ/Redis) + autoskálázó worker-pool**,
retry, prioritásos sor (Pro elöl). **4K/long-form drasztikusan drágít** (storage +
egress + compute ~10–20×) → **kapuzd Pro mögé** (ez egyben monetizáció).

## B7. Break-even (miért működik tool-skálán)

- Tegyük fel: minden creator ingyenes, a költség **$0.30/creator/hó** (1. forgatókönyv).
- 1000 creator → **$300/hó** költség.
- **5% fizet** $8/hó Prót → 50 × $8 = **$400/hó** bevétel → **pozitív** (a 950
  ingyenes user $285 költségét fedezi 50 fizető).
- **2% konverziónál** ($160 bevétel) még enyhén negatív → **a konverzió és az
  egress-optimalizálás a két kritikus tényező**, nem a feature-mélység.

> Éles következtetés: **a termék sorsát a konverzió (A rész) és az egress-fix (B5)
> dönti el — nem a következő szerkesztő-funkció.** A unit-economics tool-skálán már
> most életképes; a social-skála csak az egress+asset-fix után az.

## B8. Konkrét architektúra-ajánlások (fontossági sorrendben)

1. **Videó + asset → Cloudflare R2** (ingyen egress) vagy Bunny; Supabase marad
   DB/auth/realtime. *(Legnagyobb hatás, legkisebb munka.)*
2. **Proxy-remix**: a 720p proxyt töltsd fel a snapshothoz, ne a nyers eredetit;
   eredeti csak on-demand.
3. **Render-queue + autoskálázó worker** (BullMQ/Redis), prioritásos sor.
4. **Retenció + dedup-politika** az asset-táron.
5. **Megfigyelés**: költség/creator és egress/videó dashboard **az első naptól** —
   a unit-economics romlását korán lásd.

---

## TL;DR

- **GTM:** tool-first, remix-natív editor egy szűk niche-nek (elsődleges:
  faceless/template-creatorok), export kifelé, a feed = template-marketplace.
  **North Star: viewer→creator remix-arány.** 90 nap: aktiváció → loop → fizetés,
  minden fázisban kill-kritériummal.
- **Unit economics:** a jelenlegi stack **tool-skálán olcsó** (~$0.3/creator/hó,
  1000 creator ≈ $300/hó). A social-növekedésnél **az egress és a nyers-asset-upload
  robban** — mindkettő olcsón javítható (**R2/Bunny + proxy-remix**). Break-even
  már ~5% free→paid konverziónál. **A sikert a konverzió és az egress-fix dönti el,
  nem a következő funkció.**
