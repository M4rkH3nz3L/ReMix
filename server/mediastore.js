// 🎞️ Renderelt/feltöltött média a feedhez — a PROD Supabase Storage `renders`
// bucketjébe, PROJEKT-rendezett kulccsal: `<projectId>/<kind>/<fájl>`
// (pl. `prj_abc/video/uuid.mp4`, `prj_abc/poster/uuid.jpg`, `prj_abc/media/uuid.mov`).
//
// Elsődlegesen a worker service_role Supabase-kliensével tölt (SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY — UGYANAZ, amit a notify használ) → a feed pontosan
// abból a prod-tárból olvassa a videót, amibe a szerver írta. Ha az nincs
// beállítva, az S3-útra (s3store) esik vissza (AWS/R2/MinIO). A service_role
// megkerüli a Storage-RLS-t, ezért a szerver bármely projekt-mappába tölthet.
const fs = require('fs');
const path = require('path');
const { adminClient } = require('./notify');
const s3 = require('./s3store');

const BUCKET = process.env.MEDIA_BUCKET || 'renders';

// 🗂️ LOKÁLIS dev-tár: a renderelt/feltöltött médiát a szerver egy BÖNGÉSZHETŐ
// mappájába írja (alap: <server>/media), és statikusan szolgálja (/m). Így a
// fájlok KÉZZELFOGHATÓAN ott vannak a server mappában, a böngésző LAN-on eléri
// őket — se Supabase Storage-RLS, se felhő-kulcs nem kell a helyi teszteléshez.
// Élesben ne legyen beállítva → a service_role Supabase-útra esik (lásd lentebb).
const LOCAL_DIR = (process.env.MEDIA_LOCAL_DIR || '').trim();

function localEnabled() {
  return Boolean(LOCAL_DIR);
}

/** van-e HOVÁ tölteni (lokális disk VAGY prod Supabase service_role VAGY S3) */
function mediaStoreEnabled() {
  return localEnabled() || Boolean(adminClient()) || s3.s3Enabled();
}

/**
 * Egy helyi fájl feltöltése a `key` alá → a publikus URL. A `key` a hívó által
 * felépített projekt-rendezett út (`<projectId>/<kind>/<fájl>`). A `publicBase` a
 * kliens által ELÉRHETŐ worker-origin (a lokális-disk URL-hez) — a hívó a kérésből
 * építi (`${req.protocol}://${req.get('host')}`), vagy a `MEDIA_PUBLIC_BASE` env.
 */
async function uploadMedia(key, localPath, contentType, publicBase) {
  // 0) EXPLICIT R2/S3 BACKEND (prod): ha a `STORAGE_BACKEND=r2` (vagy `s3`) be van
  // állítva, az S3-út az ELSŐDLEGES — megelőzi a Supabase service_role-t (ami
  // egyébként mindig nyerne, mert a notify/billing miatt úgyis bekötött). Így lesz
  // a Cloudflare R2 a ReMix saját, éles tárhelye MINDEN user-fájlhoz.
  const backend = (process.env.STORAGE_BACKEND || '').trim().toLowerCase();
  if (backend === 'r2' || backend === 's3') {
    if (!s3.s3Enabled()) {
      throw new Error('STORAGE_BACKEND=' + backend + ', de az S3_* kulcsok hiányoznak (S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY).');
    }
    await s3.uploadFile(key, localPath, contentType);
    return s3.publicUrl(key);
  }

  // 1) LOKÁLIS DISK (dev): a server mappába másol → a /m statikus úton szolgál.
  if (localEnabled()) {
    const dest = path.join(LOCAL_DIR, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(localPath, dest);
    const base = String(publicBase || process.env.MEDIA_PUBLIC_BASE || '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('MEDIA_PUBLIC_BASE / publicBase hiányzik a lokális média-URL-hez.');
    }
    return `${base}/m/${key}`;
  }
  const sb = adminClient();
  if (sb) {
    const body = fs.readFileSync(localPath);
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(key, body, { contentType: contentType || 'application/octet-stream', upsert: true });
    if (error) {
      throw new Error(error.message);
    }
    return sb.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
  }
  if (s3.s3Enabled()) {
    await s3.uploadFile(key, localPath, contentType);
    return s3.publicUrl(key);
  }
  throw new Error('media store nincs konfigurálva (SUPABASE service_role vagy S3_*)');
}

/** Egy objektum törlése ugyanabból a tárból, ahová az `uploadMedia` írta; a hiányzó fájl nem hiba. */
async function deleteMedia(key) {
  const backend = (process.env.STORAGE_BACKEND || '').trim().toLowerCase();
  if ((backend === 'r2' || backend === 's3') && s3.s3Enabled()) {
    await s3.deleteFile(key);
    return;
  }
  if (localEnabled()) {
    const root = path.resolve(LOCAL_DIR);
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) {
      throw new Error('Érvénytelen média-kulcs.');
    }
    fs.rmSync(file, { force: true });
    return;
  }
  const sb = adminClient();
  if (sb) {
    const { error } = await sb.storage.from(BUCKET).remove([key]);
    if (error) {
      throw new Error(error.message);
    }
    return;
  }
  if (s3.s3Enabled()) {
    await s3.deleteFile(key);
  }
}

function useS3() {
  const backend = (process.env.STORAGE_BACKEND || '').trim().toLowerCase();
  return (backend === 'r2' || backend === 's3') && s3.s3Enabled();
}

function localFile(key) {
  const root = path.resolve(LOCAL_DIR);
  const file = path.resolve(root, key);
  if (!file.startsWith(root + path.sep)) {
    throw new Error('Érvénytelen média-kulcs.');
  }
  return file;
}

/** ⬇️ Egy objektum letöltése helyi fájlba ugyanabból a tárból, ahová az `uploadMedia` írta (PRO-CASH C2.7). */
async function downloadMedia(key, localPath) {
  if (useS3()) {
    return s3.downloadFile(key, localPath);
  }
  if (localEnabled()) {
    fs.copyFileSync(localFile(key), localPath);
    return localPath;
  }
  const sb = adminClient();
  if (sb) {
    const { data, error } = await sb.storage.from(BUCKET).download(key);
    if (error) {
      throw new Error(error.message);
    }
    fs.writeFileSync(localPath, Buffer.from(await data.arrayBuffer()));
    return localPath;
  }
  if (s3.s3Enabled()) {
    return s3.downloadFile(key, localPath);
  }
  throw new Error('media store nincs konfigurálva');
}

/**
 * 🔐 Egy objektum kiszolgálása HTTP-válaszba, nyilvános link nélkül (a hívó route ellenőrizte a
 * jogosultságot / aláírást). `filename`: letöltésként (Content-Disposition). `false`, ha nincs meg.
 */
async function serveMedia(key, res, filename) {
  if (filename) {
    res.setHeader('Content-Disposition', `attachment; filename="${String(filename).replace(/[^\w.-]/g, '_')}"`);
  }
  res.setHeader('Cache-Control', 'private, no-store');
  if (useS3() || (!localEnabled() && !adminClient() && s3.s3Enabled())) {
    return s3.streamFile(key, res);
  }
  if (localEnabled()) {
    const file = localFile(key);
    if (!fs.existsSync(file)) {
      return false;
    }
    await new Promise((resolve, reject) => res.sendFile(file, (err) => (err ? reject(err) : resolve())));
    return true;
  }
  const sb = adminClient();
  if (!sb) {
    throw new Error('media store nincs konfigurálva');
  }
  const { data, error } = await sb.storage.from(BUCKET).download(key);
  if (error) {
    return false;
  }
  res.setHeader('Content-Type', data.type || 'video/mp4');
  res.end(Buffer.from(await data.arrayBuffer()));
  return true;
}

module.exports = { deleteMedia, mediaStoreEnabled, uploadMedia, downloadMedia, serveMedia, BUCKET, LOCAL_DIR };
