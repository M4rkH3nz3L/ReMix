# UIA.md — a Studio UI anomáliái

> Cél: a Studio (szerkesztő-app, `src/`) felhasználói felületén talált
> **anomáliák** pontos, hivatkozott listája — placeholder-alertek, üres/halott
> linkek, semmit érő vagy félrevezető menük, éles UI-ban maradt dev/mock gombok,
> és halott UI-maradékok.
>
> - Készült: 2026-09-11, `studio-social` branch.
> - Módszer: mintakeresés (`onPress => {}`, `Alert.alert`, `TODO/coming soon`,
>   `mock*`, `openURL`, `https://`) + a találatok kézi ellenőrzése a forrásban.
> - Hatókör: `src/app`, `src/components/editor`, `src/components/preview`.
> - **Ami NEM anomália** (ellenőrizve, jogos): a ~170 `Alert.alert` túlnyomó része
>   valódi hibaüzenet, megerősítés vagy „nincs worker/nincs kijelölés" jellegű
>   védőkorlát — ezek nincsenek itt felsorolva. Lásd a végén a
>   [„Ellenőrzött, de nem anomália"](#ellenőrzött-de-nem-anomália) szakaszt.

## Összefoglaló

| # | Anomália | Hely | Kategória | Súlyosság |
|---|---|---|---|---|
| A1 | „Projektek" fül: no-op handler | [index.tsx:406](src/app/index.tsx#L406) | semmit érő menü | alacsony |
| A2 | „Sablonok" fül a Létrehozás-modált nyitja (félrevezető) | [index.tsx:407-411](src/app/index.tsx#L407-L411) | félrevezető menü | közepes |
| A3 | „AI eszközök" fül csak info-Alertet mutat | [index.tsx:412-416](src/app/index.tsx#L412-L416) | placeholder-alert | közepes |
| B1 | Hotspot URL alapértéke `https://` → üres link | [Toolbar.tsx:190](src/components/editor/Toolbar.tsx#L190), [HotspotPanel.tsx:26](src/components/editor/panels/HotspotPanel.tsx#L26) | üres link | magas |
| B2 | A lejátszó némán elnyeli az érvénytelen URL-t | [player/[id].tsx:73](src/app/player/[id].tsx#L73) | néma hiba | közepes |
| C1 | „Pro aktiválása" = `mockUpgrade()` (ingyen, azonnali Pro) | [PaywallSheet.tsx:33-34](src/components/PaywallSheet.tsx#L33-L34) | mock éles UI-ban | magas |
| C2 | Rejtett long-press = `mockDowngrade()` a Pro-jelvényen | [ExportPanel.tsx:192](src/components/editor/panels/ExportPanel.tsx#L192) | rejtett dev-gesztus | közepes |
| D1 | Halott `comingSoon` stílus + i18n (Image Stúdió) | [ImageStudio.tsx:383-384](src/components/editor/ImageStudio.tsx#L383-L384) | halott UI-maradék | alacsony |

## Állapot — MIND JAVÍTVA (2026-09-11, `studio-social`)

Senior UI/UX szemmel, `tsc` + `expo lint` tiszta, i18n kulcs-párhuzam (en/de/hu) ellenőrizve.

- **A1** Projektek fül → az aktív fül újra-koppintása a **lista tetejére** görget (iOS-minta).
- **A2** Sablonok fül → a **sablon-karusszelhez** görget (nem a create-modált nyitja).
- **A3** AI eszközök fül → a **legutóbbi projektet nyitja az AI-panellel** (`/editor/:id?panel=assistant`); ha nincs projekt, a create-modál nyílik. Új: az editor olvassa a `?panel=` mély-linket ([editor/[id].tsx](src/app/editor/[id].tsx)).
- **B1** Hotspot URL alapértéke immár **üres** (nem `https://`), + **inline validáció** a HotspotPanelen (piros mező + üzenet érvénytelen URL-re).
- **B2** A lejátszó **validál megnyitás előtt** ([url.ts](src/lib/url.ts) `isValidActionUrl`) és **visszajelez** üres/hibás linknél a néma bukás helyett.
- **C1** „Pro aktiválása": a `mockUpgrade()` **csak `__DEV__`-ben** fut (a gombon „(DEV)" jelölés); éles buildben nem oszt ingyen Prót, „hamarosan" üzenet.
- **C2** Export Pro-jelvény rejtett **long-press → `mockDowngrade` csak `__DEV__`-ben**.
- **D1** A halott `comingSoon` stílus + `imageStudio.comingSoon` i18n **törölve** (mindhárom locale).

Új i18n-kulcsok: `panels.hotspot.urlInvalid`, `playerScreen.link{Title,Invalid,Failed}`, `paywallSheet.comingSoon{Title,Body}`. Törölt (halott) kulcsok: `home.aiTools{Title,Message}`, `imageStudio.comingSoon`.

---

## A) Semmit érő / félrevezető menük — a kezdőképernyő alsó fülsáv

A `src/app/index.tsx` alsó fülsávja három fület mutat, de **háromból kettő nem
navigál sehova** — a fülsáv navigációt sugall, valójában dekoratív/félrevezető.

```tsx
[
  { icon: 'albums',          label: t('home.tabProjects'),  active: true, onPress: () => {} },
  { icon: 'grid-outline',    label: t('home.tabTemplates'), onPress: () => setCreating(true) },
  { icon: 'sparkles-outline',label: t('home.tabAiTools'),   onPress: () => Alert.alert(t('home.aiToolsTitle'), t('home.aiToolsMessage')) },
]
```

### A1 — „Projektek" fül: no-op handler
- **Hely:** [src/app/index.tsx:406](src/app/index.tsx#L406)
- **Viselkedés:** `onPress: () => {}` — a fülre koppintás semmit sem csinál.
- **Miért anomália:** üres handler; noha ez az aktív fül, a kód akkor is
  „halott" (nincs pl. lista-tetejére-görgetés vagy frissítés).
- **Súlyosság:** alacsony.
- **Javaslat:** vagy adj neki értelmet (scroll-to-top / refresh), vagy tedd nem
  kattinthatóvá (ne `Pressable`).

### A2 — „Sablonok" fül valójában az Új projekt modált nyitja
- **Hely:** [src/app/index.tsx:407-411](src/app/index.tsx#L407-L411)
- **Viselkedés:** a „Sablonok" (Templates) feliratú fül `setCreating(true)`-t
  hív → az **Új projekt** űrlap-modál nyílik meg, ami **nem** sablonokat mutat.
  A tényleges sablonok a lista láblécében lévő vízszintes karusszelben vannak
  ([index.tsx](src/app/index.tsx) `ListFooterComponent`).
- **Miért anomália:** a címke és a művelet nem fedi egymást → félrevezető menü.
- **Súlyosság:** közepes (várakozás-törés).
- **Javaslat:** a fül görgessen a sablon-karusszelhez, vagy nyisson egy dedikált
  sablon-nézetet; ha nincs ilyen, nevezd át a fület a valós műveletre.

### A3 — „AI eszközök" fül csak egy tájékoztató Alertet mutat
- **Hely:** [src/app/index.tsx:412-416](src/app/index.tsx#L412-L416)
- **Viselkedés:** `Alert.alert(t('home.aiToolsTitle'), t('home.aiToolsMessage'))`.
  Az üzenet szövege (en): *„The AI tools are available in the editor (AI button):
  Auto Edit, Smart Search, cutting tools."*
- **Miért anomália:** a fül nem vezet sehova — csak elmondja, hogy a funkció
  máshol van. Klasszikus „semmit érő menü" / placeholder-alert.
- **Súlyosság:** közepes.
- **Javaslat:** vagy vezessen közvetlenül a szerkesztő AI-paneljéhez (pl. utolsó/
  új projekt megnyitása az AI-panellel), vagy vedd ki a fület.

---

## B) Üres / halott linkek

### B1 — Az új hotspot URL-je alapból `https://` (üres link)
- **Hely (létrehozás):** [src/components/editor/Toolbar.tsx:190](src/components/editor/Toolbar.tsx#L190)
  — `action: { type: 'url', url: 'https://' }`
- **Hely (típusváltás a panelen):** [src/components/editor/panels/HotspotPanel.tsx:26](src/components/editor/panels/HotspotPanel.tsx#L26)
  — `setAction({ type: 'url', url: 'https://' })`
- **Viselkedés:** interaktív elem (hotspot) hozzáadásakor / URL-típusra
  váltáskor az URL alapértéke a **csupasz `https://`**. Ha a felhasználó nem írja
  át, egy érvénytelen/üres célú link marad a projektben.
- **Miért anomália:** a mentett hotspot „kész"-nek látszik, de a lejátszóban egy
  sehova sem mutató linket hordoz (lásd B2). Nincs validáció, ami megakadályozná
  az üres `https://` mentését.
- **Súlyosság:** magas (a kész projekt hibás interaktív elemet tartalmazhat).
- **Javaslat:** üres/`https://`-only URL esetén tiltsd a hotspot mentését vagy
  jelezz (mint a SEO-mezőknél a Létrehozás gombnál), és/vagy a lejátszóban adj
  visszajelzést érvénytelen URL-re.

### B2 — A lejátszó némán elnyeli az érvénytelen hotspot-URL-t
- **Hely:** [src/app/player/[id].tsx:73](src/app/player/[id].tsx#L73)
  — `Linking.openURL(clip.action.url).catch(() => {});`
- **Viselkedés:** URL-hotspotra koppintva a lejátszó megnyitja az URL-t, hiba
  esetén **csendben elnyeli** (`.catch(() => {})`). A B1 szerinti `https://`
  esetén tehát a koppintás **látszólag nem csinál semmit**, visszajelzés nélkül.
- **Miért anomália:** néma hiba → a néző számára a hotspot „halott".
- **Súlyosság:** közepes.
- **Javaslat:** validáld az URL-t megnyitás előtt (`Linking.canOpenURL`), és
  érvénytelen/üres esetén adj rövid visszajelzést a hiba elnyelése helyett.

---

## C) Mock / stub gombok az éles UI-ban

### C1 — „Pro aktiválása" ingyen, azonnal ad Prót
- **Hely:** [src/components/PaywallSheet.tsx:33-34](src/components/PaywallSheet.tsx#L33-L34)
  (`mockUpgrade()`), CTA felirat: [PaywallSheet.tsx:98](src/components/PaywallSheet.tsx#L98)
  (`t('paywallSheet.activatePro')`).
- **Viselkedés:** a paywall „Pro aktiválása" gombja a `mockUpgrade()`-et hívja,
  ami **azonnal, fizetés nélkül** Pro-ra állítja a lokális entitlementet. A
  forrás jelzi is: `// TODO(IAP): éles vásárlás — RevenueCat/StoreKit`.
- **Miért anomália:** dev-stub, ami az éles UI-ban valódi vásárlás-gombként
  jelenik meg — kiadott buildben bárki ingyen „megvenné" a Prót.
- **Súlyosság:** magas (ha éles buildbe kerül).
- **Javaslat:** natív IAP-réteg bekötése (RevenueCat/StoreKit), és a mock
  útvonalat `__DEV__`-hez kötni.

### C2 — Rejtett long-press a Pro-jelvényen visszavesz Prót
- **Hely:** [src/components/editor/panels/ExportPanel.tsx:192](src/components/editor/panels/ExportPanel.tsx#L192)
  — `<Pressable style={styles.proActive} onLongPress={mockDowngrade}>`
- **Viselkedés:** az Export panel „Pro aktív" jelvényét **hosszan nyomva**
  `mockDowngrade()` fut → visszaáll Free-re. Nincs jelölve az UI-n.
- **Miért anomália:** rejtett, dokumentálatlan dev-gesztus az éles felületen;
  a felhasználó véletlenül visszaveheti a saját Pro-státuszát.
- **Súlyosság:** közepes.
- **Javaslat:** `__DEV__`-hez kötni, vagy a dev-kapcsolót egy rejtett dev-menübe
  tenni.

---

## D) Halott UI-maradék (scaffolding)

### D1 — Használaton kívüli „Coming soon" stílus + i18n az Image Stúdióban
- **Hely:** [src/components/editor/ImageStudio.tsx:383-384](src/components/editor/ImageStudio.tsx#L383-L384)
  (`comingSoon`, `comingSoonText` stílusok) + `imageStudio.comingSoon`
  („Coming soon") mindhárom locale-ban.
- **Viselkedés:** a `styles.comingSoon` / `styles.comingSoonText` és a
  `imageStudio.comingSoon` i18n-kulcs **sehol nincs hivatkozva** a JSX-ben
  (ellenőrizve: `grep` a `src/`-ben 0 találat a locale-okon kívül). A „Rajz"
  (draw) eszköz valójában a valódi [ImageMarkupTool](src/components/editor/ImageMarkupTool.tsx)-t
  rendereli ([ImageStudio.tsx:158](src/components/editor/ImageStudio.tsx#L158)),
  tehát a „coming soon" egy korábbi placeholder maradéka.
- **Miért anomália:** halott kód/i18n, ami félrevezetheti a következő fejlesztőt
  (mintha lenne egy be nem fejezett „hamarosan" felület).
- **Súlyosság:** alacsony (tisztasági).
- **Javaslat:** töröld a `comingSoon`/`comingSoonText` stílusokat és az
  `imageStudio.comingSoon` kulcsot mindhárom locale-ból.

---

## Ellenőrzött, de NEM anomália

Ezeket megnéztem és **szándékos/jogos** — nehogy tévesen anomáliaként kezeljük:

- [LanguageSwitcher.tsx:27](src/components/LanguageSwitcher.tsx#L27) — `onPress={() => {}}`
  a kártyán: **szándékos**, a backdrop-koppintás terjedését állítja meg (a kártyán
  belüli koppintás ne zárja be a modált).
- A FilterPanel/CaptionsPanel/StickerPanel/TextPanel stb. „nincs elérhető /
  válassz videót / nincs felirat" alertjei: **valódi védőkorlátok**, nem
  placeholderek (pl. [FilterPanel.tsx:164](src/components/editor/panels/FilterPanel.tsx#L164)
  `skyUnavailable`, [SpeedPanel.tsx:41](src/components/editor/panels/SpeedPanel.tsx#L41)
  `rampNotApplicable`).
- Export „Posztolás" (TikTok/Reels/YouTube/Egyéb):
  [ExportPanel.tsx:161](src/components/editor/panels/ExportPanel.tsx#L161) `postTo`
  **valós** (render → Fotókba mentés → platform megnyitása a `renderAndPost`-tal),
  nem placeholder.

---

## Javasolt prioritás

1. **B1 + C1** (magas): a hibás-hotspot-mentés és az ingyenes „Pro aktiválása"
   éles szempontból a legfontosabbak.
2. **A2 + A3 + B2 + C2** (közepes): félrevezető fülek, néma hiba, rejtett dev-gesztus.
3. **A1 + D1** (alacsony): no-op fül-handler és halott `comingSoon` maradék.
