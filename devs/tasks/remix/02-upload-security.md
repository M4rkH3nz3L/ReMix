# 🔴 02. Centralizált upload-security (`mediaUpload()`) — P0

> **Forrás:** [remix.md](../../source/remix.md) §7 (upload security), §34.2. OWASP File Upload Cheat Sheet.
> **Testvér:** ráépül [01](./01-worker-auth-policy.md)-re · együtt [03](./03-rate-limiting.md), [04](./04-ssrf-protection.md).
> **Érintett kód:** [server/index.js](../../../server/index.js) (`multer` @ [139](../../../server/index.js#L139)) · [server/mediastore.js](../../../server/mediastore.js) · új: `server/security/uploadPolicy.js`, `server/security/mediaPolicy.js`.

---

## 0. Kontextus & cél

Ma **~20 endpoint** ugyanazt a globális `upload.any()` multer-instance-t használja **2 GB fájlmérettel**, típus-/MIME-/darabszám-ellenőrzés nélkül. Ez OWASP **API4 (Unrestricted Resource Consumption)** + upload-abuse felület.

**Cél:** egyetlen, kötelező `mediaUpload(kind)` middleware, amely minden feltöltést egy determinisztikus **MediaSecurityPolicy pipeline-on** enged át — a többi endpoint sosem hívja közvetlenül a multert.

---

## 1. Jelenlegi állapot (bizonyíték)

```js
// server/index.js:139
const upload = multer({
  storage: multer.diskStorage({ ... }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },   // 2 GB, semmi más limit
});
```

- `upload.any()` — **bármennyi**, bármilyen mezőnevű, bármilyen típusú fájl (`/faces`, `/shotscore`, `/imagedoc`, `/color/*`, `/depth/*`, `/waveform`, `/voice/preview`, `/thumbnails/compose`, `/media/upload`, `/audio/*`, `/render`, `/scenes`, `/beats`, `/vision/index`, `/reframe`, `/silence`, `/proxy`, `/collect`, …).
- Nincs: extension-allowlist, magic-byte/MIME-sniff, darab- és összméret-limit, duration/resolution-limit, codec-allowlist, storage-izoláció endpoint-típusonként.

---

## 2. Megoldás — MediaSecurityPolicy pipeline

Az audit §7 pipeline-ja, kódra bontva:

```text
Upload → Auth → Authorization → Request-size → Multipart-limits →
Extension-allowlist → Magic-byte/MIME-sniff → Media-probe →
Duration-limit → Resolution-limit → Codec-allowlist →
Storage-isolation → Processing-queue
```

### 2.1 `mediaUpload(kind)` factory
`kind` = a hívó endpoint elvárt média-profilja → ehhez tartozik a szabályhalmaz:

| kind | Extension-allowlist | Max db | Max méret/fájl | Extra |
| --- | --- | --- | --- | --- |
| `image` | jpg/png/webp/heic | 1–8 | 40 MB | max felbontás (pl. 8k) |
| `video` | mp4/mov/webm | 1 | 500 MB | max duration + codec-allowlist (h264/hevc/vp9) |
| `audio` | mp3/m4a/wav/aac | 1–8 | 100 MB | max duration + sample-rate |
| `render-bundle` | json + assetek | — | policy szerint | csak `/render`, `/collect` |

```js
// server/security/uploadPolicy.js (VÁZ)
function mediaUpload(kind) {
  const rules = MEDIA_PROFILES[kind];               // extension/count/size/duration/codec
  const mw = multer({ storage: isolatedDiskStorage(kind), limits: rules.multerLimits });
  return [
    mw.fields(rules.fields),                          // NEM .any() — nevesített mezők
    (req, res, next) => mediaPolicy.verify(req, rules, next),  // magic-byte + probe + duration/codec
  ];
}
```

### 2.2 `mediaPolicy.verify()` — valódi tartalom-ellenőrzés
- **Magic-byte / MIME-sniff** (`file-type` v. saját header-check) — a kiterjesztésre **nem** bízunk semmit.
- **Media-probe** (`ffprobe`) → duration/resolution/codec kiolvasása, a `kind`-profil szerinti hard-limit; sértés → `413`/`415`.
- **Filename-kontroll:** path-traversal tiltás, random storage-név (a user-nevet sosem használjuk fájlnévként).

### 2.3 Storage-izoláció
Endpoint-típusonként külön temp-mappa + azonnali cleanup a handler végén (a jelenlegi `WORK`-mappa mintát követve), hogy egy endpoint ne tudja a másik feltöltéseit elérni.

---

## 3. Feladatok

### 🟦 Fázis A — Pipeline-mag
- [ ] `server/security/mediaPolicy.js`: magic-byte sniff + `ffprobe`-alapú duration/resolution/codec-check + hibakódok (`413`/`415`).
- [ ] `MEDIA_PROFILES` katalógus (image/video/audio/render-bundle) — méret/db/duration/codec limitek.
- [ ] `server/security/uploadPolicy.js`: `mediaUpload(kind)` factory (nevesített mezők, izolált storage).

### 🟦 Fázis B — Bekötés
- [ ] Minden `upload.any()` lecserélése `mediaUpload(<kind>)`-ra (kb. 20 endpoint) — a mezőneveket a tényleges handler-használatból kell kigyűjteni.
- [ ] A globális 2 GB `multer` instance ([index.js:139](../../../server/index.js#L139)) **megszüntetése** (csak profil-alapú marad).
- [ ] `/media/upload` ([index.js:1121](../../../server/index.js#L1121)) a `image`/`video`/`audio` profilra + a meglévő quota-check ([server/quota.js](../../../server/quota.js)) elé fűzve.

### 🟦 Fázis C — Megerősítés
- [ ] Malware-scan **hook** (env-gated, pl. ClamAV) — go-live opció, interfész most készüljön.
- [ ] Feltöltés-audit log (ki / mekkora / milyen kind / eredmény) → [14](./14-security-baseline-docs.md) `auditLog.js`.

---

## 4. Kész, ha
- [ ] Nincs több `upload.any()` a [server/index.js](../../../server/index.js)-ben (grep-teszt a CI-ben).
- [ ] Hibás magic-byte-ú fájl (pl. `.png` névre `.exe` tartalom) `415`-öt kap; túl hosszú/nagy felbontású média `413`-at.
- [ ] Egy `video`-profilú endpoint elutasít 2. fájlt / nem-video codecet.
- [ ] `npm run audit` zöld.

## 5. Teszt & ellenőrzés
- `server/security/uploadPolicy.test.js` — fixture-fájlok (jó kép, hamis-MIME, túl nagy, túl sok, rossz codec).
- CI grep-guard: `grep -R "upload.any()" server/*.js` → **üres** legyen.

## 6. Kockázat / függőség
- **`ffprobe` elérhetőség** a worker-környezetben (a render már használ FFmpeg-et → adott).
- **Függőség:** [01](./01-worker-auth-policy.md) (auth/authz a pipeline elején) — az upload sosem előzi meg a policy-t.
