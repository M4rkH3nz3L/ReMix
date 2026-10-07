# ☁️ Cloudflare R2 — a ReMix ÉLES platform-tárhelye (setup + Chrome Claude prompt)

> **Cél:** a ReMix MINDEN user-adatát (média, render, feed-tartalom **és** a projekt-JSON)
> a Cloudflare R2-ben tárolja — ez a platform saját, éles tárhelye. (A per-user
> Drive/Dropbox/WebDAV/S3 külön, opt-in rendszer marad — `server/userStorage.js`.)

---

## 0. Rögzített tények (ÉLES)

| Mező | Érték |
| --- | --- |
| **Account ID** | `400d960bbfe3f83ffaf00b21dae61651` |
| **Jurisdiction** | **European Union** (GDPR + a prod Supabase eu-west-1) |
| **S3 API endpoint (EU)** | `https://400d960bbfe3f83ffaf00b21dae61651.eu.r2.cloudflarestorage.com` |
| **S3 region** | `auto` |
| **Döntés** | **minden** R2-ben: média + render + feed **+ projekt-JSON** |

> ⚠️ A standard (nem-EU) endpoint `...r2.cloudflarestorage.com` — mi az **EU**-sat
> (`...eu.r2.cloudflarestorage.com`) használjuk, mert EU-jurisdiction bucketöket hozunk létre.

---

## 1. Cél-architektúra — mit hová

| Adat | R2 bucket | Láthatóság | Kulcs-minta |
| --- | --- | --- | --- |
| Feed-média, renderelt videó, poszter, forrás | `remix-media` | **publikus** (custom domain) | `<projectId>/<kind>/<fájl>` |
| Felhő-render ideiglenes I/O | `remix-media` (prefix `tmp/`) | privát + lifecycle (7 nap) | `tmp/<jobId>/…` |
| Projekt-állapot (teljes editor-JSON) | `remix-projects` | **privát** (worker-proxy) | `<userId>/<projectId>.json` |

A `remix-media` a mai `renders` bucket szerepét veszi át (`server/mediastore.js`), a
`remix-projects` pedig a mai Postgres `cloud_projects` tábláét (`src/lib/cloudSync.ts`).

---

## 2. Követelmények (mi kell az R2-höz)

1. **Cloudflare-fiók R2-vel engedélyezve** — az R2 bekapcsolása bankkártyát igényel a fiókon
   (van ingyenes keret, de kártya kell). → *böngésző-agent nem tud kártyát megadni, embert kér.*
2. **2 bucket, EU-jurisdictionnel:** `remix-media`, `remix-projects`.
3. **R2 API-token** — „Object Read & Write", a 2 bucketre szűkítve → **Access Key ID + Secret
   Access Key** (ez a két S3-kulcs). A Secret **csak egyszer** látszik.
4. **Publikus hozzáférés a `remix-media`-hoz:** prodban **custom domain** (pl. `media.remix.app`,
   a domainnek a Cloudflare-fiókon kell lennie); fejlesztéshez elég az **r2.dev** menedzselt
   aldomain. Ebből lesz az `S3_PUBLIC_BASE`.
5. **CORS** a `remix-media`-n (web-lejátszás/`fetch()` + range-kérések).
6. **Lifecycle-szabály** a `remix-media` `tmp/` prefixén (7 nap után törlés).
7. **Nincs új npm-függőség** — a `@aws-sdk/client-s3` már megvan (`server/s3store.js`).

---

## 3. Kód-oldali handoff (a repóban, Claude Code csinálja — NEM a böngésző-agent)

A böngésző-agent csak a Cloudflare-oldalt állítja be és visszaadja a kulcsokat. A kódban:

- ✅ **KÉSZ — `server/mediastore.js`** — `STORAGE_BACKEND=r2` kapcsoló: ha be van állítva, az
  R2/S3-út az **elsődleges** (megelőzi a Supabase service_role-t). Env-kapuzott → amíg nincs
  beállítva, a mai viselkedés változatlan.
- ✅ **KÉSZ — `server/s3store.js`** — `publicUrl` R2-re: `S3_PUBLIC_STYLE=domain` esetén a
  bucket-nevet NEM teszi az útba (`${PUBLIC_BASE}/${key}`); `bucket` (alap) a Supabase-konvenció.
- **`src/lib/cloudSync.ts` + worker-végpont** — a projekt-JSON mentése/olvasása a `remix-projects`
  bucketbe (worker-proxy, capability-tokennel — a `userStorage.js` `fileToken`-mintájára), a
  Postgres `cloud_projects` helyett. A projekt-lista innentől objektum-listázás, nem SQL.
- **Migráció/wipe** — lásd a §6-ot (a meglévő `cloud_projects` sorsa — függőben, megerősítés kell).
- A **kvóta-főkönyv** (`storageQuota`, byte-ledger) marad — most a valós R2-byte-okat méri.

---

## 4. 📋 A másolható Chrome Claude (böngésző-agent) PROMPT

> Illeszd be a Claude for Chrome (böngésző-agent) kiterjesztésbe, miután **bejelentkeztél** a
> Cloudflare dashboardra (`https://dash.cloudflare.com`). Az agent lépésről lépésre halad, és
> **megáll emberért** a kártya/domain lépéseknél.

```text
Te egy Cloudflare-dashboard beállító asszisztens vagy. A feladatod a ReMix nevű app ÉLES
objektum-tárhelyének (Cloudflare R2) teljes beállítása az alábbi fiókon, majd a kész konfig
visszaadása. Dolgozz lassan és megerősítéssel; SOHA ne adj meg bankkártyát és ne hagyd el az
oldalt titkos kulccsal. Minden lépés után írd le, mit látsz és mit csináltál.

FIX ADATOK:
- Cloudflare Account ID: 400d960bbfe3f83ffaf00b21dae61651
- Jurisdiction: European Union (MINDEN bucketnél ezt válaszd — GDPR)
- Bucketök: remix-media (publikus), remix-projects (privát)

LÉPÉSEK:

1) Menj a bal oldali menüben az "R2 Object Storage"-ra. Ha az R2 még NINCS bekapcsolva
   (fizetési adatot kér), ÁLLJ MEG és kérd meg a felhasználót, hogy adja hozzá a bankkártyát
   / fogadja el az R2 feltételeit, majd szólok, ha kész. Ne próbálj kártyát megadni.

2) Hozd létre az ELSŐ bucketet: "Create bucket".
   - Name: remix-media
   - Location: "Automatic"
   - Jurisdiction: "European Union"  ← FONTOS
   - Create. Erősítsd meg, hogy a bucket EU-jurisdictionnel jött létre.

3) Hozd létre a MÁSODIK bucketet ugyanígy:
   - Name: remix-projects
   - Jurisdiction: "European Union"
   - Create.

4) A remix-media PUBLIKUS elérése:
   - Nyisd meg a remix-media bucketet → "Settings".
   - Ha a felhasználónak van a Cloudflare-fiókján egy domainje (zónája): "Public access" →
     "Custom Domains" → "Connect Domain" → írd be: media.remix.app (vagy amit a felhasználó
     megad). Ha nincs ilyen zóna VAGY a domain nem a fiókon van, ÁLLJ MEG és kérdezd meg a
     felhasználótól a használandó domaint; ha nincs, használd ideiglenesen az "R2.dev
     subdomain"-t ("Allow Access" az r2.dev-hez) és jelezd, hogy ez csak fejlesztésre jó.
   - Jegyezd fel a kapott PUBLIKUS BÁZIS-URL-t (custom domain VAGY a pub-...r2.dev cím).

5) CORS a remix-media-n: a bucket "Settings" → "CORS Policy" → "Add CORS policy", és illeszd be
   EZT a JSON-t (a felhasználó app-origineire szűkítve; kérdezd meg az origineket, ha mások):
   [
     {
       "AllowedOrigins": ["https://studio.remix.app", "http://localhost:8081", "capacitor://localhost"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["Range", "Content-Type"],
       "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   Mentsd el.

6) Lifecycle a remix-media "tmp/" prefixen: "Settings" → "Object lifecycle rules" → "Add rule":
   - Prefix: tmp/
   - Action: "Delete objects" 7 nap után (Expire).
   - Mentsd.

7) API-token (a két S3-kulcs): menj az R2 főoldalára → "Manage R2 API Tokens" → "Create API
   Token".
   - Token name: remix-worker
   - Permissions: "Object Read & Write"
   - "Specify bucket(s)": válaszd KI csak a remix-media és remix-projects bucketöket.
   - TTL: "Forever" (vagy ahogy a felhasználó kéri).
   - "Create API Token".
   - A megjelenő oldalon MÁSOLD KI (ez EGYSZER látszik): "Access Key ID", "Secret Access Key",
     és az "Endpoint" (jurisdiction-specifikus — EU-s, .eu.r2.cloudflarestorage.com-ra kell
     végződnie). Ezeket add vissza a felhasználónak EGYSZER, egyértelműen megjelölve, hogy
     TITOK, és figyelmeztesd, hogy ezt BIZTONSÁGOS helyre tegye (EAS env / worker .env /
     secrets-manager), SOHA ne commitolja a repóba. Ne tedd be ezt a Secretet semmilyen másik
     weboldalba vagy űrlapba.

8) ELLENŐRZÉS: menj vissza a remix-media bucketbe, és erősítsd meg, hogy látod a bucketöt és a
   publikus hozzáférés + CORS + lifecycle aktív. Listázd a végén összefoglalóan:
   - a két bucket neve + hogy EU-jurisdiction,
   - a remix-media PUBLIKUS bázis-URL-je,
   - az EU S3 endpoint,
   - és (TITOK, egyszer) az Access Key ID + Secret Access Key.

Ha bármelyik lépésnél elakadsz vagy mást látsz a leírtnál, ÁLLJ MEG és kérdezz, ne találgass.
```

---

## 5. A végső env-blokk (worker `.env` / EAS — a token megszerzése UTÁN)

A böngésző-agent által visszaadott kulcsokkal töltsd ki, és tedd a **worker** környezetébe
(NEM a kliensbe, NEM a repóba):

```bash
# ── R2 = a ReMix éles platform-tárhelye ──────────────────────────────
STORAGE_BACKEND=r2
S3_ENDPOINT=https://400d960bbfe3f83ffaf00b21dae61651.eu.r2.cloudflarestorage.com
S3_ACCESS_KEY=<R2 token Access Key ID>
S3_SECRET_KEY=<R2 token Secret Access Key>
S3_REGION=auto
S3_BUCKET=remix-media
MEDIA_BUCKET=remix-media
PROJECTS_BUCKET=remix-projects
# a remix-media-hoz KÖTÖTT publikus domain (bucket-szegmens NÉLKÜL!):
S3_PUBLIC_BASE=https://media.remix.app
# FONTOS: R2 custom domain / r2.dev → a bucket NINCS az útban → 'domain' stílus:
S3_PUBLIC_STYLE=domain
# prodban NE legyen beállítva (ez a lokális dev-disk út, ma a server/.env-ben AKTÍV):
# MEDIA_LOCAL_DIR=
```

> A `STORAGE_BACKEND`, `PROJECTS_BUCKET` és a `publicUrl` bucket-nélküli viselkedése a §3
> kód-változásokat igényli — ezek nélkül a worker a mai Supabase-Storage úton marad.

---

## 6. Biztonság + nyitott döntés

- **Secret:** a Secret Access Key egyszer látszik; EAS env / worker `.env` / secrets-manager,
  SOHA repóba. A `remix-projects` **privát** — a kliens sosem éri el közvetlenül, csak a
  worker-proxyn át (capability-token, mint a `userStorage.js`).
- **🗑️ Meglévő projektek törlése — FÜGGŐBEN:** a `cloud_projects` törlése a jelenlegi séma
  szerint **láncolhat a feed-posztokra** (post↔project delete cascade). Törlés csak explicit
  scope (összes user / csak teszt-adat?) + **backup** után, külön megerősítéssel.
