# 🔴 07. Render-job authorization (BOLA) — P0

> **Forrás:** [remix.md](../../source/remix.md) §5 (render security nem egységes), §34.8 (render authorization / BOLA).
> **Testvér:** ráépül [01](./01-worker-auth-policy.md)-re · közös user-id [05](./05-storage-security.md)-tel.
> **Érintett kód:** [server/index.js](../../../server/index.js) (`/render`, `/render/:id`, `/render/:id/file`, `/render/queue`) · [server/queue.js](../../../server/queue.js) · [server/render-worker.js](../../../server/render-worker.js).

---

## 0. Kontextus & cél

A `/render` maga védve van (`...proOnly`), **de a job-státusz és a fájl-letöltés nyitott, és nincs ownership-ellenőrzés** → bárki, aki ismer/kitalál egy job-ID-t, lekérheti/letöltheti más renderjét. Ez tankönyvi **API1 BOLA (Broken Object Level Authorization)**.

**Cél:** minden render-job legyen **ownershiphez kötve**, és minden job-endpoint ellenőrizze: `job.user_id === auth.uid()`.

---

## 1. Jelenlegi állapot (bizonyíték)

```js
// server/index.js:2148  — NINCS auth, NINCS ownership
app.get('/render/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) { res.json({ state: job.state, ... }); return; }   // ⚠️ bárki bármely job státuszát
  ...
});

// server/index.js:2170  — NINCS auth, NINCS ownership
app.get('/render/:id/file', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) { ...; res.sendFile(job.file); return; }           // ⚠️ bárki letölti más renderjét
  ...
  if (j?.returnvalue?.outKey) { res.redirect(publicUrl(...)); } // ⚠️ + public-URL redirect
});
```

- `/render` ([1427](../../../server/index.js#L1427)) `...proOnly` 🟢, de a job-objektumhoz **nem tárol `user_id`-t**, amit később ellenőrizni lehetne.
- `/render/queue` ([2013](../../../server/index.js#L2013)) `requireAuth` 🟡, de a queue-lista nem szűkül a hívó saját jobjaira (ellenőrizendő).

---

## 2. Megoldás

### 2.1 Job-ownership adatmodell
A render-job létrehozásakor ([/render](../../../server/index.js#L1427)) minden jobhoz **kötelezően** eltároljuk:

```text
job.user_id      = auth.uid()   (a tokenből, nem body-ból)
job.project_id   = validált, owner/editor a projekten
job.created_by   = auth.uid()
job.subscription = a hívó tier-je (a credit-elszámoláshoz)
job.credit_cost  = levont credit
```

- **In-memory `jobs`-map:** az objektum kapjon `user_id` mezőt.
- **BullMQ queue-job:** a `data`-ban `user_id`/`project_id` (a [queue.js](../../../server/queue.js) `addRenderJob` payloadjában), így a `getRenderJob` visszaadja az ownert.

### 2.2 Ownership-ellenőrzés minden job-endpointon
```js
app.get('/render/:id', authenticated(), rateLimit('render'), async (req, res) => {
  const job = await loadJob(req.params.id);           // in-memory VAGY queue
  if (!job) return res.status(404).json({ error: 'Ismeretlen job.' });
  if (job.user_id !== req.auth.uid) return res.status(404).json({ error: 'Ismeretlen job.' }); // 404 ≠ 403 (ne szivárogtass létezést)
  res.json({ state: ..., progress: ... });
});
```

- Ugyanez `/render/:id/file`-re: ownership-check **a `sendFile`/redirect előtt**.
- **Nem BOLA-szivárgás:** más jobjára `404` (nem `403`), hogy a job-ID létezése se derüljön ki.
- A publikus-URL redirect ([2185](../../../server/index.js#L2185)) csak owner- nek; a privát render signed-URL-t kapjon ([05](./05-storage-security.md)), ne örök public-URL-t.

### 2.3 Queue-lista szűkítés
`/render/queue` ([2013](../../../server/index.js#L2013)) csak a **hívó saját** jobjait adja vissza (`where user_id = auth.uid()`).

---

## 3. Feladatok

### 🟦 Fázis A — Ownership tárolás
- [ ] `/render` job-létrehozás: `user_id`/`project_id`/`created_by`/`subscription`/`credit_cost` eltárolása (in-memory job + BullMQ `data`).
- [ ] `project_id` validáció: a hívó owner/editor a projekten (a [01](./01-worker-auth-policy.md) `projectOwner`/`projectEditor` policy-jével).
- [ ] `loadJob(id)` helper (in-memory ∪ queue), ami visszaadja az ownert is.

### 🟦 Fázis B — Ellenőrzés bekötése
- [ ] `/render/:id` + `/render/:id/file`: `authenticated()` + ownership-check (`404` idegen jobra) a válasz előtt.
- [ ] `/render/queue`: csak saját jobok.
- [ ] Privát render → signed URL ([05](./05-storage-security.md)) az örök public-URL helyett.

---

## 4. Kész, ha
- [ ] User A **nem** kérheti le/le nem töltheti User B render-jobját (idegen job-ID → `404`) — jest-teszt bizonyítja.
- [ ] `/render/queue` csak a saját jobokat listázza.
- [ ] Minden render-jobhoz tartozik `user_id` + `project_id` + `credit_cost`.
- [ ] `npm run audit` zöld.

## 5. Teszt & ellenőrzés
- `server/render.authz.test.js` — job létrehozás user A-ként, lekérés user B tokennel → `404`; user A → `200`.
- Kézi: `curl .../render/<idegen-id>` token nélkül → `401`; más tokennel → `404`.

## 6. Kockázat / függőség
- **Regresszió:** a kliens ma token nélkül poll-ozza a `/render/:id`-t → a poll-hívások Authorization-fejlécet kell kapjanak (kliens-oldali render-poll frissítés).
- **Függőség:** [01](./01-worker-auth-policy.md) (policy + `projectOwner`), [05](./05-storage-security.md) (signed URL), [03](./03-rate-limiting.md) (`render` osztály + credit).
