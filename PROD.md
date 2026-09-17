# PROD.md — kiadható build készítése

> **Mire jó ez a fájl.** Ez a **build-runbook**: lépésről lépésre, ellenőrizhető
> módon leírja, hogyan készül a ReMixből kiadható build, és **mit kell előtte
> elintézni**. Nem duplikálja a szomszédait:
>
> | Dokumentum | Kérdés |
> |---|---|
> | **PROD.md** *(ez)* | Hogyan készítek kiadható buildet, és mi kell hozzá? |
> | [DEVOPS.md](DEVOPS.md) | Milyen szervereket/szolgáltatásokat kell üzemeltetni? |
> | [AUDITBUGS.md](AUDITBUGS.md) | Milyen minőségi adósság van nyitva? |
> | [Arch.md](Arch.md) | Hogyan épül fel a rendszer, és miért? |
>
> A ✅ jelölés azt jelenti: **ellenőrizve** (parancs lefuttatva, kimenet látva).

---

## 0. A projekt azonosítói

| Mező | Érték |
|---|---|
| EAS-projekt | **`@vided/remix`** · `42318da2-3155-4a07-b59e-8eadcf1580fb` |
| Expo-fiók | `vided` (tulajdonos: h3nz3l@gmail.com) |
| Bundle ID / package | `com.h3nz3l.remix` (mindkét platformon) |
| Verzió | `app.json` → `version: "1.0.0"` |
| Build-szám | **`appVersionSource: "remote"`** — az EAS tartja nyilván; a `production` profil `autoIncrement`-tel növeli. **Kézzel ne írd** az `ios.buildNumber` / `android.versionCode` mezőt. |
| Konzol | <https://expo.dev/accounts/vided/projects/remix> |

---

## 1. Minőségi kapu — a build ELŐTT

Ez a nem-alkuképes minimum. Mind a négynek zöldnek kell lennie:

```bash
npm run audit          # tsc --noEmit + expo lint + jest  → 0 hiba, 260 teszt
npx expo-doctor        # → 21/21 checks passed
git status             # → tiszta munkafa (a build a COMMITOLT állapotot tölti fel)
npx eas-cli whoami     # → h3nz3l@gmail.com
```

> **Miért `expo-doctor` is?** A `npm run audit` a TypeScriptet és a teszteket
> nézi, a natív/konfigurációs réteget nem. A doctor fogja meg a verzió-eltérést
> és a hibás plugin-konfigot — pont azt, amitől a build *lefut*, de az app nem
> működik.

A `npm run audit` része a **React Compiler-őr** is (`tools/reactCompiler.test.js`):
ha egy forró komponens kiesne a memoizálásból, itt bukik el, nem a felhasználónál.

---

## 2. Környezeti változók — ITT BUKIK EL A LEGTÖBB BUILD

A `EXPO_PUBLIC_*` értékek **build-időben a bundle-be égnek**. A helyi `.env`
gitignore-olt, ezért **a felhő-build NEM látja** — az értékeket az EAS
környezetébe kell felvenni.

### 2.1 🚨 A csapda, ami már egyszer elsült

A `.env` **lokális** Supabase-t tartalmazott (`http://127.0.0.1:54321`), és egy
`eas env:push` ezt egy az egyben feltöltötte. Következmény: a build **sikerül**,
az app **elindul**, és csak a bejelentkezésnél derül ki, hogy semmi nem megy —
telepített appban a `127.0.0.1` **magát a készüléket** jelenti, nem a fejlesztői
gépet. A `http://` ráadásul iOS-en az ATS miatt is tiltott (kivétel csak a helyi
hálózatra van).

**Szabály:** felhő-buildhez **mindig hosztolt** címek kellenek.

### 2.2 Mi kell melyik környezetbe

| Változó | development | preview | production | Ha hiányzik |
|---|:--:|:--:|:--:|---|
| `EXPO_PUBLIC_SUPABASE_URL` | ✔︎ | ✔︎ | ✔︎ | nincs auth, nincs social (`supabase === null`) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✔︎ | ✔︎ | ✔︎ | ugyanaz |
| `EXPO_PUBLIC_CLOUD_URL` | — | ✔︎ | ✔︎ | a Pro-funkciók a dev-workerre esnének vissza, ami felhőből elérhetetlen |
| `EXPO_PUBLIC_RC_IOS_KEY` | — | ajánlott | ✔︎ | az IAP kikapcsolt marad (nincs Pro-vásárlás) |
| `EXPO_PUBLIC_RC_ANDROID_KEY` | — | ajánlott | ✔︎ | ugyanaz |
| `EXPO_PUBLIC_SERVER_HOST` / `_URL` | csak lokálisan | **NE** | **NE** | — (ezek dev-worker címek) |

### 2.3 Parancsok

```bash
# egyenként (ajánlott — így nem csúszik be lokális érték)
npx eas-cli env:set --name EXPO_PUBLIC_SUPABASE_URL \
  --value "https://<projekt>.supabase.co" \
  --environment production --visibility plaintext

# vagy a teljes .env feltöltése — CSAK ha hosztolt értékeket tartalmaz!
npx eas-cli env:push production --path .env --force

# ELLENŐRZÉS (ezt mindig futtasd le build előtt)
npx eas-cli env:list production
```

> **Az anon key nem titok**, a kliensbe szánták — az RLS védi. Ezért
> `plaintext` a helyes láthatóság. A `service_role` kulcs **soha** nem kerülhet
> `EXPO_PUBLIC_*` alá.

---

## 3. Build-profilok

Az `eas.json` négy profilt ad:

| Profil | Mit ad | Apple-fiók kell? |
|---|---|:--:|
| `development` | dev-client, internal, APK | iOS-hez igen |
| `preview` | internal teszt-build, APK | iOS-hez **igen** (ad-hoc provisioning + 2FA) |
| `preview-sim` | **iOS-szimulátor** `.app` | **nem** |
| `production` | store-build, `autoIncrement` | igen |

```bash
npx eas-cli build --profile preview-sim  --platform ios       # Apple-fiók nélkül ✅
npx eas-cli build --profile preview      --platform android   # hitelesítő nélkül megy
npx eas-cli build --profile preview      --platform ios       # Apple Developer + 2FA
npx eas-cli build --profile production   --platform all       # kiadás
```

> **Az iOS `internal`/`store` build interaktív Apple-bejelentkezést és 2FA-t kér.**
> Ezt csak ember tudja elvégezni; automatizálni nem lehet. A `preview-sim` viszont
> teljesen automatizálható, és teljesítmény-méréshez elég.

### 3.1 Feltöltés mérete — `.easignore`

A repó tartalmazza a `server/` workert (~481 MB: saját `node_modules`, 3D
GLB-modellek, demó videó, onnxruntime), ami a mobil-buildhez **nem kell**. A
`.easignore` ezt kizárja.

> ⚠️ Az EAS a `.easignore`-t a `.gitignore` **helyett** használja, nem mellette.
> Ha szerkeszted, **minden** kizárást bele kell írni — különben a `node_modules`
> és az aláíró kulcsok (`*.p8`, `*.p12`, `*.mobileprovision`) is feltöltődnek.

---

## 4. Store-beadás — amit a konfig már elintéz

Ezek **be vannak állítva**, nem kell kézzel nyilatkozni:

| Tétel | Állapot |
|---|---|
| `ITSAppUsesNonExemptEncryption: false` | ✅ — enélkül minden TestFlight-feltöltésnél kézi export-compliance kérdés jönne |
| iOS usage description-ök | ✅ explicit `ios.infoPlist`-ben, **plugin-sorrendtől függetlenül** (bizonyítva: a sorrend megfordítása nem változtat rajtuk) |
| Lokalizált engedély-szövegek | ✅ `expo.locales` → `locales/hu.json`, `locales/de.json`; az alap **angol** (az App Review nyelve) |
| `NSFaceIDUsageDescription` | ✅ **törölve** — az app sehol nem hív `requireAuthentication`-t, nem használt jogosultságot nem deklarálunk |
| `ios.privacyManifests` | ✅ `NSPrivacyTracking: false` + 4 adattípus (e-mail, user ID, vásárlás, fotó/videó) |
| ATS | ✅ `NSAllowsLocalNetworking: true` — **csak** a helyi hálózatra; `NSAllowsArbitraryLoads` szándékosan **nincs** |

> ⚠️ **A privacy manifest jogi nyilatkozat.** Beadás előtt vesd össze az App
> Store Connect adatvédelmi kérdőívével — a kettőnek egyeznie kell.

---

## 5. Build után — ellenőrzés

```bash
npx eas-cli build:list --limit 1 --json --non-interactive
```

Nézd meg: `status: FINISHED`, a helyes `buildProfile`, és az `artifacts`-ban a
letöltési link.

**Kézi füstteszt a telepített appon** (ezt semmilyen CI nem pótolja):

1. Indul-e, és **bejelentkezés** működik-e? → ha nem, 99%-ban a 2. szakasz env-hibája.
2. Projekt létrehozása → klip importálása a galériából → **jogosultság-kérdés a helyes nyelven** jön-e?
3. Vágás, undo, mentés → app bezárás/újranyitás → **megvan-e a projekt?**
4. Export **eszközön** (ingyenes út) — ez szerver nélkül is menjen.
5. Pro-funkció → **paywall** jön-e (ha nincs előfizetés), nem hibaüzenet?

---

## 6. Ami MÉG NINCS KÉSZ — ezekre a build előtt dönteni kell

| # | Tétel | Miért számít |
|---|---|---|
| **9** | **EAS env** — a `preview` környezetben ma **lokális** Supabase van, és a `CLOUD_URL` + RevenueCat-kulcsok hiányoznak | e nélkül a build auth/social/Pro nélkül fut (lásd 2.1) |
| **10** | **`expo-updates` (OTA)** nincs beépítve → **minden javításhoz teljes store-review**. Bekapcsoláskor `runtimeVersion` fingerprint-policy kell. | architekturális döntés, nem hibajavítás |
| **10** | **`expo-dev-client`** nincs → a natív modulos funkciók (eszköz-render, IAP, push) fejlesztés közben nem tesztelhetők | fejlesztői sebesség |
| **11** | **Teljesítmény-mérés eszközön** — a `Timeline`, `TimelineClipInner`, `PreviewSurface`, `TextOverlay` kimarad a React Compiler memoizálásából (player-mutáció / Reanimated shared value, szándékos kivétel). Hogy ez **mérhetően** számít-e, csak futó buildben dől el. | az utolsó nyitott minőségi kérdés |

Részletek és a teljes haladás: [AUDITBUGS.md](AUDITBUGS.md) → „TODO — a maradék tételek".

---

## 7. Gyorslap

```bash
# 1. kapu
npm run audit && npx expo-doctor && git status

# 2. env ellenőrzés (NE hagyd ki)
npx eas-cli env:list production

# 3. build
npx eas-cli build --profile production --platform all

# 4. eredmény
npx eas-cli build:list --limit 1

# 5. beadás
npx eas-cli submit --profile production --platform ios
```
