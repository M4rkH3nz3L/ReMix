# 🔴 04. SSRF-védelem (remote fetch) — P0

> **Forrás:** [remix.md](../../source/remix.md) §9 (SSRF), §19 (AI provider URL), §34.4. OWASP API7.
> **Testvér:** ráépül [01](./01-worker-auth-policy.md)-re.
> **Érintett kód:** [server/ssrf.js](../../../server/ssrf.js) (**már létezik!**) · [server/storage.js](../../../server/storage.js) · [server/youtube.js](../../../server/youtube.js) · [server/s3store.js](../../../server/s3store.js) · [server/userStorage.js](../../../server/userStorage.js) · [server/ai.js](../../../server/ai.js).

---

## 0. Kontextus & cél

A ReMix számos ponton **user által vezérelt remote resource-ot** fetch-el a workerről: YouTube-import, WebDAV, S3, custom storage-endpoint, custom AI-provider URL. Ez klasszikus **SSRF (API7)** — a legveszélyesebb célpont a felhő-metadata endpoint (`http://169.254.169.254`).

**Jó hír:** a `server/ssrf.js` **már létezik** (`assertSafeAiBaseUrl`, `isPrivateAddress`, `hostAllowed`) és van rá teszt (`server/ssrf.test.js`). **A baj:** csak az **AI base-URL-re** van bekötve ([server/ai.js:8](../../../server/ai.js#L8)) — a **storage/youtube/s3/userStorage** remote-fetch **nincs védve**.

**Cél:** a meglévő `ssrf.js`-t **minden** user-vezérelt remote fetch elé bekötni, egységes `ssrfPolicy`-vá általánosítva (nem csak AI-base-URL).

---

## 1. Jelenlegi állapot (bizonyíték)

```text
grep "require('./ssrf')"  →  csak server/ai.js
```

- `server/ssrf.js` ✅ tartalmaz: private-IP tartomány-tiltás (`isPrivateAddress`), host-allowlist (`hostAllowed`), `assertSafeAiBaseUrl` (DNS-feloldás + private-cím ellenőrzés).
- **Nincs bekötve:** [server/storage.js](../../../server/storage.js) (WebDAV/S3 user-config), [server/youtube.js](../../../server/youtube.js) (URL-import), [server/s3store.js](../../../server/s3store.js), [server/userStorage.js](../../../server/userStorage.js) (per-user Drive/Dropbox/WebDAV/S3 — OAuth endpointok).

---

## 2. Megoldás — `server/security/ssrfPolicy.js` (a `ssrf.js` általánosítása)

### 2.1 Egységes `assertSafeUrl(url, { context })`
A meglévő `assertSafeAiBaseUrl` logikáját kiemeljük egy általános `assertSafeUrl`-be, amely **minden** remote fetch előtt fut:

```text
allow:  csak https:// (prod), context-specifikus allowlist (pl. youtube.com az importhoz)
deny:   localhost, 127.0.0.1, 0.0.0.0, ::1,
        169.254.169.254 (AWS/GCP metadata),
        10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7,
        file://, gopher://, ftp://, dict:// és minden nem-http(s) séma
```

### 2.2 DNS-rebinding védelem
A `ssrf.js` már DNS-t old fel — meg kell erősíteni: **a feloldott IP-re** kell csatlakozni (pin), nem hagyni, hogy a fetch újra-feloldjon egy másik (belső) IP-re a check után. A `context` (ai / storage / youtube / webdav) dönti el az allowlist szigorúságát.

### 2.3 aiConfig hardening (§19)
A custom AI-provider URL (`aiConfig`) esetén a `sanitizeAiConfig()` mellé kötelező `assertSafeUrl(baseUrl, { context: 'ai' })` — tiltva `file://`, `localhost`, private/metadata IP, tetszőleges belső endpoint.

---

## 3. Feladatok

### 🟦 Fázis A — Általánosítás
- [ ] `assertSafeUrl(url, { context, allowlist })` kiemelése a `ssrf.js`-ből (a jelenlegi `assertSafeAiBaseUrl` ennek egy `context: 'ai'` wrappere marad — visszafelé kompatibilis).
- [ ] DNS-rebinding: feloldott IP-re pinnelt fetch-helper (`safeFetch(url, opts, ctx)`).
- [ ] Séma-allowlist (csak `https`, prodban `http` tiltva).

### 🟦 Fázis B — Bekötés minden remote fetch elé
- [ ] [server/youtube.js](../../../server/youtube.js) URL-import → `assertSafeUrl(..., 'youtube')`.
- [ ] [server/storage.js](../../../server/storage.js) + [server/userStorage.js](../../../server/userStorage.js) WebDAV/S3/custom-endpoint → `assertSafeUrl(..., 'storage')` a hívás előtt.
- [ ] [server/s3store.js](../../../server/s3store.js) custom S3-endpoint (nem-AWS host) → `assertSafeUrl`.
- [ ] `/proxy` endpoint ([index.js:1873](../../../server/index.js#L1873)) — ha user-URL-t fetch-el → `assertSafeUrl`.

### 🟦 Fázis C — Guard a jövőre
- [ ] CI grep-guard: minden `fetch(`/`axios(`/`got(` a workerben vagy konstans-URL, vagy `safeFetch`-en át megy (allowlist a belső hostokra).

---

## 4. Kész, ha
- [ ] `POST /youtube` / storage-connect egy `http://169.254.169.254/...` vagy `http://127.0.0.1` URL-re **elutasít** (`400`), nem fetch-el.
- [ ] DNS-rebinding fixture (host, ami előbb publikus, majd private IP-t ad) elhasal a pin miatt.
- [ ] aiConfig `file://`/private-URL → elutasítva.
- [ ] `npm run audit` zöld (a `ssrf.test.js` kiterjesztve az új contextekre).

## 5. Teszt & ellenőrzés
- `server/ssrf.test.js` bővítése: metadata-IP, minden private-tartomány, séma-allowlist, DNS-rebinding, context-allowlist.
- Kézi: `curl -X POST .../storage/connect -d '{"url":"http://169.254.169.254/latest/meta-data/"}'` → `400`.

## 6. Kockázat / függőség
- **Legitim self-hosted WebDAV** (user saját LAN-ja) — prodban a private-IP tiltás ezt is blokkolja; ez **tudatos döntés** (a worker felhőben fut, LAN-elérés = SSRF-vektor). Ha kell, külön „user-tunneled” megoldás P2.
- **Függőség:** [01](./01-worker-auth-policy.md) (a storage-endpointok már `authenticated()` mögött).
