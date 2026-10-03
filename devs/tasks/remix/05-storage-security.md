# 🔴 05. Storage authorization + bucket-újratervezés — P0

> **Forrás:** [remix.md](../../source/remix.md) §10 (storage authz), §11 (public/private bucket), §34.5, §34.6.
> **Testvér:** Supabase-oldal, párhuzamosítható a worker-P0-kkal.
> **Érintett kód:** [supabase/migrations/20260926150000_renders_client_upload.sql](../../../supabase/migrations/20260926150000_renders_client_upload.sql) · [supabase/migrations/20260927130000_storage_quota_and_providers.sql](../../../supabase/migrations/20260927130000_storage_quota_and_providers.sql) · [server/mediastore.js](../../../server/mediastore.js) · [server/s3store.js](../../../server/s3store.js).

---

## 0. Kontextus & cél

Két baj:
1. **Túl széles storage-policy (API1 BOLA):** az authenticated user a `renders` bucketbe **bárhová** írhat, nem csak a saját mappájába.
2. **Túl sok public bucket:** a `renders` public-olvasásra van → egy creator-platformnál a teljes média-infra nyilvános.

**Cél:** path-alapú ownership RLS + private/public bucket-szeparáció + signed-URL hozzáférés a privát tartalomhoz.

---

## 1. Jelenlegi állapot (bizonyíték)

```sql
-- supabase/migrations/20260926150000_renders_client_upload.sql
create policy "renders_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'renders');          -- ⚠️ nincs path/owner-feltétel

create policy "renders_authenticated_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'renders')
  with check (bucket_id = 'renders');          -- ⚠️ bárki bármit felülírhat a bucketben
```

- A `20260927130000` migráció a `storage_objects`/`storage_quotas` (ledger) táblákra **helyes** `*_select_own` policy-kat ad — de a **fizikai** `storage.objects` bucket-policy a fenti túl széles marad.

---

## 2. Megoldás

### 2.1 Path-alapú ownership (a bucket-policy szűkítése)
Minden objektum útvonala kezdődjön az owner user-id-jével, és a policy ezt kényszerítse:

```sql
-- renders/{auth.uid()}/...
create policy "renders_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "renders_owner_update"
  on storage.objects for update to authenticated
  using  (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'renders' and (storage.foldername(name))[1] = auth.uid()::text);
```

> **Még jobb:** ownership-táblából ellenőrizni (project/job → owner), ha a path-konvenció nem elég (pl. megosztott projekt). A path-alapú a minimum; az ownership-tábla a `project_members`-szel a teljes megoldás.

### 2.2 Bucket-szeparáció (§11)
Az egyetlen public `renders` helyett:

```text
private   original-media       → csak owner, signed URL
private   project-assets       → owner + project-members, signed URL
private   renders  (draft)     → owner, signed URL
public    published-video      → CDN/publikus (csak megosztott poszt)
public    thumbnails           → CDN/publikus
```

Hozzáférési szabály:

```text
original media  → signed URL
draft render    → signed URL
private project → signed URL
published post  → CDN/public
```

### 2.3 Migrációs stratégia
- Új bucketek + policy-k **additív** migrációban (a `studio-social` konvenció: időbélyeges migráció, `brew supabase db push`).
- A meglévő `renders` objektumok **áthelyezése** owner-prefixes útvonalra (backfill-szkript a `server/`-ben, service-role) — vagy compat-időszak, amíg a régi útvonalak lejárnak.
- A kliens/worker feltöltő-kód a signed-URL flow-ra áll át (a `renders_client_upload` már signed-upload irányba megy — ezt kell owner-prefixesre húzni).

---

## 3. Feladatok

### 🟦 Fázis A — Ownership-szűkítés (leggyorsabb nyereség)
- [ ] Új migráció: a `renders_authenticated_*` policy-k lecserélése `renders_owner_*`-re (`storage.foldername(name)[1] = auth.uid()`).
- [ ] Kliens/worker feltöltés: az útvonal mindig `renders/{uid}/...` legyen.
- [ ] Meglévő objektumok backfill (service-role szkript) vagy compat-mapping.

### 🟦 Fázis B — Bucket-redesign
- [ ] Bucketek létrehozása: `original-media`, `project-assets`, `renders` (private), `published-video`, `thumbnails` (public).
- [ ] Per-bucket RLS: private → owner/member; public → csak publikált tartalom kerülhet bele (a poszt-megosztás write-ja).
- [ ] Signed-URL kiadás worker-oldalon a privát tartalomhoz (rövid TTL); publikálásnál a média a public bucketbe másolódik/mozog.

### 🟦 Fázis C — Bekötés
- [ ] A feed/poszt megosztás a `published-video`/`thumbnails` bucketet használja; a draft/original privát marad.
- [ ] A worker output-upload ([server/s3store.js](../../../server/s3store.js)/[mediastore.js](../../../server/mediastore.js)) a helyes bucketbe + owner-prefixbe ír.

---

## 4. Kész, ha
- [ ] User A **nem** tud írni `renders/{userB}/...` alá (RLS-teszt: `403`).
- [ ] Privát render csak **signed URL-lel** érhető el; közvetlen public-URL `403`/`404`.
- [ ] Publikált poszt médiája a public bucketből CDN-en jön.
- [ ] `npm run audit` zöld + a migráció felmegy prodra (`brew supabase db push`) és verifikált.

## 5. Teszt & ellenőrzés
- SQL/RLS-teszt (pgTAP vagy integrációs): idegen-prefix insert/update `403`.
- Kézi: signed-URL lejárat után `403`; public bucket olvasható, private nem.

## 6. Kockázat / függőség
- **Adat-migráció** a legkockázatosabb lépés (meglévő renderek útvonala) — először staging/dev (a dev **a prod DB-re mutat** — [hosted-supabase-prod] — óvatosan, előbb backup).
- **Függőség:** [07](./07-render-authorization.md) (a render-job ownership ugyanezt a user-id-t használja az útvonalhoz).
