# 🚀 ReMix — üzleti terv (short-video alkotói platform)

> **Mi ez:** teljeskörű üzleti terv, amely a [prod-off.md](./prod-off.md) piaci gyengeségeit **célzottan**
> kiküszöböli azzal, hogy az appot **élesen a short-video (TikTok/Reels/Shorts) tartalomgyártókra** pozícionálja,
> és egy 5-szintű csomagstruktúrát (**Free · Amatőr · Haladó · Profi · Céges**) vezet be. Párja: [PROD.md](./PROD.md)
> (store-indulás), [02-monetization](./02-monetization.md), [ADR-013](../../DOCS/HU/decisions/ADR-013-storage-tiers-free-local-pro-r2.md) (tárolási szintek).

---

## 1. Vezetői összefoglaló

A ReMix ma technikailag erős, de **túl széles és differenciálatlan**. A megoldás: **egy közönség, egy munka.**

> **Pozicionálás:** *„A short-video alkotók operációs rendszere — ötlettől a vírusig."*
> Nem „még egy szerkesztő" (azt a CapCut ingyen viszi), hanem az **egész alkotói munkafolyamat** egy helyen:
> **ötlet → forgatás/import → vágás (AI-társsal) → minden platformra optimalizálás → publikálás/ütemezés → elemzés → növekedés.**

**Két tartó-pillér:**

1. **Először ESZKÖZ, másodszor közösség.** Az érték **egyetlen userrel** is megvan (nem kell hálózat) → ez megöli a
   legnagyobb kockázatot, a cold-startot. A social/remix/marketplace **növekedési hurok** a tetején, nem belépő.
2. **A „cloud" MAGA a fizetős határvonal.** A **Free 100%-ban a telefonon fut — ZÉRÓ felhő**: eszközön-render,
   eszközön-tárolás, eszközön-AI. A felhő (gyorsabb/4K render, biztonsági mentés + több-eszköz-szinkron, felhő-AI)
   a **fizetős** szinteken nyílik, **mért kvótával**. → a Free marginális költsége **≈ 0 €**, a skálázás biztonságos.

**Bevételi mag:** tiszta, store-kompatibilis **előfizetés** (5 szint). A kockázatos coin/cash-out/marketplace a jogi
tisztázásig **halasztva** (vagy később Business-funkcióként).

---

## 2. ⭐ A Free-modell — 100% eszközön (nulla cloud)

Ez a terv **sarokköve** (és a legnagyobb költség-/adatvédelmi előny):

- **Render a telefonon** — a kész short **eszközön** készül el, **720p**, **vízjellel** („Made with ReMix").
  Nincs felhő-render-perc, nincs szerver-költség. *(Tech-előfeltétel: eszközön-render-motor — iOS AVFoundation v1 kész,
  az **Android MediaCodec-motor a kulcs-teendő**, lásd [09-native-rendering.md](./09-native-rendering.md). A Free ezen áll vagy bukik.)*
- **Projekt-tárolás a telefonon, app-privát (sandbox) helyen** — **NEM a galériában/képek közt**, hanem az app saját,
  védett tárában ([expo-file-system](../../src/lib) `Paths.document`), ahonnan **közvetlenül nem törölhető** (fájlkezelő/
  galéria nem éri el), **csak az appból**. iOS: app-sandbox; Android: app-belső tár. → a user munkája nem vész el egy
  véletlen galéria-takarítástól.
- **Adatvédelmi/adatvesztési szabály (ADR-013):** Free-ben **nincs automatikus felhő-mentés** → ha a user **letörli/
  újratelepíti az appot**, a projektek elvesznek. Ezt **proaktív figyelmeztető-banner** jelzi, és a **felhő-mentés
  (biztonsági + több-eszköz-szinkron) a fizetős upgrade egyik fő értéke.**
- **AI a telefonon** — a Free-ben csak **eszközön futó** modellek (pl. auto-felirat/alap-vízió helyi Whisper/vision);
  **felhő-AI-token NINCS** (az a fizetős szinteken).
- **Import/export** — a kész videót a user a galériába/más appba **exportálhatja/megoszthatja** (az már az ő médiája);
  a **szerkeszthető projekt** viszont a védett app-tárban marad.

→ Ennek következménye a termékre: a **Free valóban ingyenes üzemeltetni** (nincs felhő a hátán), így **agresszíven
terjeszthető** akvizíciós hurokként (lásd [§7](#7-go-to-market--növekedési-hurkok-a-cold-start-megoldása)).

---

## 3. Célpiac & szegmensek (a csomagokhoz kötve)

| Szegmens | Ki ő | Fő igény | Csomag |
|----------|------|----------|--------|
| Kezdő | kipróbálja, néha posztol | gyors, ingyen, egyszerű, **eszközön** | **Free** |
| Hobbi-alkotó | rendszeresen posztol, nő | vízjel-mentes, több sablon, alap-felhő | **Amatőr** |
| Növekvő alkotó | közönséget épít | AI-társ, multi-platform publish, analitika, felhő-mentés | **Haladó** |
| Full-time alkotó | ebből él, monetizál | max-AI, batch, A/B, prioritásos felhő-render, trend-intel | **Profi** |
| Márka / ügynökség / SMM | több fiók/ügyfél, csapat | együttműködés, brand-governance, jóváhagyás, több seat | **Céges** |

---

## 4. A csomagstruktúra (Free · Amatőr · Haladó · Profi · Céges)

> Árak: havi, EUR, **éves fizetésnél ~2 hónap kedvezmény**. **A Free zéró-cloud (eszközön).** A felhő-funkciók
> (gyorsabb/4K render, biztonsági mentés + szinkron, felhő-AI) a fizetős szinteken, **mért kvótával** → a költség a bevételhez kötve.

| Funkció | **Free** €0 | **Amatőr** €4,99 | **Haladó** €12,99 | **Profi** €24,99 | **Céges** €59/seat |
|---|:--:|:--:|:--:|:--:|:--:|
| **Alapmodell** | | | | | |
| Render helye | **eszközön** | eszközön + felhő | felhő (gyors) | felhő (prioritás) | felhő (prioritás) |
| Export-vízjel | **VAN** | nincs | nincs | nincs | nincs |
| Felbontás | **720p** | 1080p | **4K** | 4K | 4K |
| Projekt-tárolás | **app-privát (eszközön)** | eszközön + **felhő-mentés** | felhő-mentés + szinkron | felhő + szinkron | team-pool + szinkron |
| **Alkotó** | | | | | |
| Eszközön-vágás (teljes editor) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sablonok | alap | kibővített | összes + prémium | összes | összes + branded |
| Licencelt zene-könyvtár | safe beépített | alap | teljes | teljes | teljes + kereskedelmi |
| **AI-társ (short-video copilot)** | | | | | |
| Auto-felirat (eszközön) | ✅ napi limit | ✅ | ✅ | ✅ | ✅ |
| Felhő-AI (hook/script/ötlet) | **— (nincs cloud)** | ízelítő | ✅ | ✅ + A/B | ✅ |
| Trend-/hashtag-intel | — | — | ✅ | ✅ | ✅ |
| B-roll / stock / stem-szeparáció | — | — | ✅ | ✅ | ✅ |
| **Multi-platform** | | | | | |
| 1-klikk reframe (9:16/1:1/16:9) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Platform-profilok (per-platform felirat/hossz) | — | 1 | összes | összes | összes |
| Publikálás + **ütemezés** (TikTok/Reels/Shorts/YT) | — | 1 fiók | 3 fiók | 10 fiók | **korlátlan** |
| **Növekedés** | | | | | |
| Analitika | — | alap | ✅ | **„miért működött"** | csapat-riport |
| Content-planner / naptár | — | ✅ | ✅ | ✅ | ✅ (team) |
| Creator-memory (tanul a stílusodból) | — | — | ✅ | ✅ | ✅ |
| **Felhő-kvóta** (csak fizetős) | | | | | |
| Felhő-render perc / hó | **0** | 30 | 120 | 400 | pool/seat |
| Felhő-AI-token / hó | **0** | kicsi | nagy | max | pool/seat |
| Felhő-tárhely (mentés/szinkron) | **0 (eszközön)** | 10 GB | 50 GB | 200 GB | team-pool |
| **Csapat & márka** | | | | | |
| Több seat + szerepkörök (RBAC) | — | — | — | — | ✅ |
| Brand-kit governance (zárolt) / jóváhagyás | — | — | 1 kit | több kit | **csapat + lock** |
| Ügyfél-/fiók-kezelés, bulk | — | — | — | — | ✅ |
| Prioritásos render + support | — | — | — | ✅ | ✅ + SLA |
| (Opció) White-label export / API | — | — | — | — | ✅ |

**A csomag-logika (a felhő a határvonal):**
- **Free** = **100% eszközön** (720p+vízjel, app-privát tár, eszközön-AI). Üzemeltetési költség ≈ 0 → **akvizíciós motor + vízjel-hurok**.
- **Amatőr** = az első fizetési ok: **vízjel-mentes + 1080p + felhő-biztonsági-mentés** (nem vész el a munka). Alacsony ár → magas konverzió.
- **Haladó** = a **bevételi gerinc**: **felhő-AI-társ + gyors 4K felhő-render + multi-platform publish + analitika + szinkron**.
- **Profi** = full-time: max-kvóta, A/B, trend-intel, prioritásos render — magas ARPU.
- **Céges** = legmagasabb ARPU/seat: csapat, brand-governance, ügynökségi workflow — itt értékesül a kész RBAC/workspace/collaboration mag.

---

## 5. Hogyan oldja meg a gyengeségeket (→ [prod-off.md](./prod-off.md))

| Gyengeség | Megoldás a tervben |
|-----------|--------------------|
| #2 tisztázatlan value prop | „A short-video alkotók OS-e" + „készítsd egyszer, posztold mindenhová". |
| #3 scope-szétszórtság | A 10 studio **egy job köré** (short-video workflow); a többi háttérbe/később. |
| #6/#7 cold-start / tartalom | **Tool-first**: érték hálózat nélkül. A social csak növekedési hurok. |
| #10 unit economics | **Free = zéró-cloud (eszközön)** → ≈0 költség; a felhő csak fizetős, mért kvótával. **Ez a legnagyobb javítás.** |
| #12 CAC / disztribúció | **Termék-vezérelt**: ingyen-eszközön-Free → vízjel-hurok + „posztold mindenhová" + sablonok. |
| #13 store-politika | **Előfizetés-first**; coin/cash-out **halasztva**. |
| #15 zenei jogok | **Licencelt zene-könyvtár** a fizetős szinteken; Free = safe beépített készlet. |
| #2/#4 moat | AI-társ + multi-platform publish + analitika + **creator-memory** = workflow- + adat-moat. |
| #21 üzemeltetési kockázat | A **Free nem terheli a szervert** (eszközön) → a felhő-infra csak a fizető kohorszot szolgálja ki, kisebb/olcsóbb. |

---

## 6. Termékstratégia — fókusz (mit tartunk / halasztunk / vágunk)

- **MAG (most):** video-editor + **eszközön-render (Free)** + **AI short-copilot** (felirat/hook/script/trend) +
  **1-klikk multi-reframe** + **publish/ütemezés** + **analitika** + planner + creator-memory.
- **TÁMOGATÓ:** kép-/hang-stúdió mint a shorts kiegészítői (thumbnail, hangjavítás, zene) — nem külön reklámozva.
- **HALASZT (v2+):** social-feed/remix **növekedési hurokként**; marketplace **tartalom**ként (sablonok), nem cash-outtal.
- **JOGI TISZTÁZÁSIG ZÁRVA:** coin-pénztárca + valódi-pénz cash-out.
- **KRITIKUS TECH-ELŐFELTÉTEL:** **Android eszközön-render-motor** (MediaCodec) — a Free egésze ezen áll ([09-native-rendering.md](./09-native-rendering.md)).
- **NICHE-ÉLESÍTÉS (opció):** indulj EGY alkotói szegmenssel (pl. talking-head/edukációs shorts, vagy e-commerce/UGC-ads), légy ott a legjobb.

---

## 7. Go-to-market & növekedési hurkok (a cold-start megoldása)

1. **Termék-vezérelt (PLG):** erős, **ingyen-üzemeltethető** Free (eszközön) → szokás → fizetős upgrade. Alacsony CAC.
2. **Vízjel-hurok:** minden Free-export **720p + „Made with ReMix"** → organikus reach a néző-oldalon.
3. **„Posztold mindenhová":** a kész short + a tool-említés maga a disztribúció.
4. **Sablon-ökoszisztéma:** megosztható sablonok/presetek, ASO/SEO-tartalom („hogyan csinálj X shortot").
5. **Alkotó-partnerség/affiliate:** közép-kategóriás alkotók revenue-share-rel.
6. **Közösség (fázis 2):** remix/collab + kihívások a tool-érték fölé építve.

**Az upgrade-fő-triggerek (Free→fizetős):** (a) **vízjel eltüntetése**, (b) **1080p/4K**, (c) **ne vesszen el a munka →
felhő-biztonsági-mentés + szinkron**, (d) **felhő-AI-társ**, (e) **publish/ütemezés**. A (c) különösen erős, mert a Free
szándékosan csak eszközön tárol — a „biztonság" természetes fizetési ok.

---

## 8. Zene, jog & moderáció (a landmine-ok semlegesítése)

- **Zene:** licencelt könyvtár (royalty-free/stock partner-API) a fizetős szinteken; Free = beépített **safe** készlet → nincs jogsértő-tartalom kockázat.
- **Moderáció/DSA:** a social **fázis 2**, addig tool-only → kevés UGC-kockázat. Amikor jön: kész **jelentés+blokk** + ToS + notice-and-action + korhatár.
- **Fogyasztóvédelem:** átlátszó, store-natív előfizetés-lemondás.

---

## 9. Monetizáció & unit economics

- **Előfizetés-first** (5 szint), **éves kedvezmény** a retencióért/cash-flow-ért.
- **Free = zéró marginális költség** (100% eszközön: render, tárolás, alap-AI) → **korlátlanul, biztonságosan skálázható akvizíció**.
- **A felhő-költség csak a fizető kohorszra esik**, és **kvóta-mérve** (már kész usage-metering: render-perc + AI-token + tárhely) → a költség a bevételhez kötve.
- **Cél-mutatók (irány):** Free→fizetős **3–6%**, a fizetős kohorsz bruttó-margin **>75%** (a Free nem terheli az infrát + kvóta-gate),
  Business a legmagasabb ARPU. A cash-out/marketplace csak jogilag tiszta ÉS pozitív hozzájárulás esetén nyílik.

---

## 10. Roadmap / fázisok

- **F0 — Launch (tool-first, eszközön-Free):** editor + **Android eszközön-render-motor** + AI-copilot (felirat/hook/reframe) +
  publish/ütemezés + alap-analitika + 5 csomag + licencelt zene + **app-privát projekt-tár + data-loss-banner**. Store-ban, a fizető-kohorsz backendje deployolva.
- **F1 — Növekedés:** trend-intel, A/B, creator-memory, bővített analitika, sablon-ökoszisztéma, affiliate.
- **F2 — Céges:** csapat/seat, brand-governance, ügyfél-kezelés, SLA, (opc.) API/white-label.
- **F3 — Közösség (hurok):** remix/collab, kihívások, sablon-megosztás; **jogi tisztázás után** esetleg marketplace/monetizáció.

---

## 11. KPI-k & kockázat-mérséklés

- **KPI:** aktiválás (első **eszközön-**export), 1-klikk-publish arány, Free→fizetős konverzió (fő trigger: biztonsági-mentés + vízjel),
  D7/D30 retenció, ARPU/szint, a fizető-kohorsz bruttó-margin, CAC-payback.
- **Fő kockázatok & mérséklés:** verseny → **workflow+adat-moat**; költség → **Free eszközön + kvóta-gate**; store-politika →
  **előfizetés-first**; jog → **licencelt zene + halasztott cash-out**; cold-start → **tool-first**; **tech → az Android eszközön-render-motor
  a kritikus út** (nélküle a Free nem áll).

---

### Egy mondatban
**A ReMix nem a CapCuttal versenyez a vágásban — a short-video alkotó EGÉSZ munkáját (ötlet→export→publish→növekedés)
oldja meg egy helyen, AI-társsal; a Free 100%-ban a telefonon fut (eszközön-render 720p+vízjel, app-privát tár), így
ingyen üzemeltethető akvizíciós motor, a „felhő" pedig maga a fizetős érték — költség-biztonságos, cold-start nélkül.**
