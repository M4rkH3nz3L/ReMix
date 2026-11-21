const { logCaught } = require('../../lib/caught');
// 🖼️ Kép-eszközök — PSD-import, PDF-import és PSD-export (Pro, felhő-kvótás) handlerek.
// A handlerek SZÁNDÉKOSAN `exports.X = (req, res) => …` alakúak: így névtelenek maradnak (a router.stack-ben
// `<anonymous>`, mint eredetileg); a route-tábla és a middleware-lánc a routes/imageTools.js-ben.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { callerId } = require('../../auth');
const { ownedMediaKey } = require('../../security/ownedKey');
const { renderImageDoc, resolveRemoteMedia, imageDocGuard } = require('../../imagedoc');
const { parsePsdToImageDoc } = require('../../psdImport');
const { buildPsdFromImageDoc, layerRasterizer } = require('../../psdExport');
const { parsePdfToImageDocs } = require('../../pdfImport');
const { mediaStoreEnabled, uploadMedia } = require('../../mediastore');
const { enforceQuota, trackUsage, userTier } = require('../../usage');
const { bindUploadedMedia } = require('../../lib/bindMedia');
const { remoteMediaOpts } = require('./remoteMediaOpts');
const { probePdfPageCount, openPdfForRaster, rasterPdfPage } = require('./pdfRaster');

/**
 * 🖼️ PSD-import (IMAGE 01.1): egy feltöltött .psd → `ImageDoc` réteg-fa, per-réteg
 * PNG-k a média-tárba töltve. A parser-mag (`parsePsdToImageDoc`) injektált
 * `uploadLayerPng`-del dolgozik → a valós feltöltés ITT (mediastore) megy.
 *
 * Tier-gate (IMAGE 01.4): Pro-only SZERVER-hitelesen (`proOnly` — a `/bgremove`
 * mintája); free user → 402. Siker → beszámít a `usage_counters`-be (`cloudJobs`).
 * A dev `ALLOW_INSECURE_DEV` bypass a `proOnly`/`enforceQuota`-ban automatikus
 * (a többi gate-tel konzisztens).
 */
exports.psdImportHandler = async (req, res) => {
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'Hiányzó PSD-fájl.' });
    return;
  }
  const cleanup = () => fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  const uid = callerId(req, req.body?.userId);
  try {
    if (!mediaStoreEnabled()) {
      cleanup();
      res.status(503).json({ error: 'A média-tár nincs konfigurálva (SUPABASE service_role vagy S3_* / R2).' });
      return;
    }
    // 📊 §2.2: a felhő-PSD-beolvasás havi `cloudJobs`-kvóta-gate (a hiteles tier a
    // subscriptionből; DB/service_role nélkül best-effort megenged — nincs regresszió).
    const gate = await enforceQuota(uid, await userTier(uid), 'cloudJobs', 1);
    if (!gate.ok) {
      cleanup();
      res.status(429).json({ error: `Elérted a havi felhő-művelet kvótád (hátralévő: ${gate.remaining}).` });
      return;
    }

    const buf = fs.readFileSync(f.path);
    const publicBase = `${req.protocol}://${req.get('host')}`;
    const projectId = String(req.body?.projectId || '').replace(/[^\w-]/g, '').slice(0, 64);
    const docId = crypto.randomUUID();

    // a réteg-PNG-k feltöltője: projekt-rendezett kulcs (u/<uid>/<projectId>/psd/<docId>/<layer>.png)
    const uploadLayerPng = async (png, layerId) => {
      const safe = String(layerId).replace(/[^\w-]/g, '').slice(0, 40) || crypto.randomUUID();
      const key = ownedMediaKey(uid, projectId, `psd/${docId}/${safe}.png`);
      const tmp = path.join(req.workDir, `${safe}.png`);
      fs.writeFileSync(tmp, png);
      const url = await uploadMedia(key, tmp, 'image/png', publicBase);
      // a kliens a `src`/`uri`-t egyformán renderelhető URL-ként kezeli
      return { src: url, uri: url };
    };

    const name = typeof req.body?.name === 'string' && req.body.name ? req.body.name.slice(0, 120) : undefined;
    const doc = await parsePsdToImageDoc(buf, { makeId: psdMakeId(), uploadLayerPng, name });

    // 🛡️ a kész doc átmegy a RENDER-guardon is (nagy-doc védőkorlát), hogy később
    // biztosan renderelhető legyen — inkább itt beszédes hiba, mint a rendernél.
    const guardError = imageDocGuard(doc);
    if (guardError) {
      cleanup();
      res.status(413).json({ error: guardError });
      return;
    }

    // 📊 §2.2: sikeres beolvasás → +1 `cloudJobs` (atomikus RPC; best-effort)
    void trackUsage(uid, 'cloudJobs', 1);
    cleanup();
    res.json({ doc });
  } catch (err) {
    logCaught('routes/imageTools.js', err);
    cleanup();
    const msg = String(err && err.message ? err.message : err).slice(0, 300);
    console.warn('psd/import hiba:', msg);
    // a parser barátságos (magyar) üzenetei → 400 (kliens-hiba: rossz/túl nagy PSD)
    res.status(400).json({ error: msg });
  }
};

/** szerver-oldali id-generátor a PSD-mag `makeId`-jéhez (prefix + ütközésbiztos). */
function psdMakeId() {
  let n = 0;
  return (prefix) => `${prefix}_${(n++).toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * 📄 PDF-import (IMAGE 01.3): egy feltöltött PDF → oldalanként EGY `ImageDoc` (galéria-
 * lapok). A parser-mag (`parsePdfToImageDocs`) PURE — a struktúrát (oldal-szám +
 * oldal-méret) `pdf-lib`-bel olvassa, a lap→PNG rasterizálás INJEKTÁLT: itt a worker-
 * oldali `pdfjs-dist` (legacy, worker nélkül) + `@napi-rs/canvas` (prebuilt — NINCS
 * build-lépés) renderel, és a kész oldal-PNG a média-tárba (`mediastore`) tölt.
 *
 * Tier-gate (IMAGE 01.4): Pro-only SZERVER-hitelesen (`proOnly`, mint a `/psd/import`);
 * free user → 402. A PDF oldalanként drága (külön render + feltöltés), ezért a
 * `cloudJobs`-kvótát OLDAL-SZÁM szerint mérjük (enforceQuota(pages) + trackUsage(pages)),
 * nem fix 1 job/import. A dev `ALLOW_INSECURE_DEV` bypass a gate-ekben automatikus.
 */
exports.pdfImportHandler = async (req, res) => {
  const f = (req.files ?? [])[0];
  if (!f) {
    res.status(400).json({ error: 'Hiányzó PDF-fájl.' });
    return;
  }
  const cleanup = () => fs.rm(req.workDir, { recursive: true, force: true }, () => {});
  const uid = callerId(req, req.body?.userId);
  try {
    if (!mediaStoreEnabled()) {
      cleanup();
      res.status(503).json({ error: 'A média-tár nincs konfigurálva (SUPABASE service_role vagy S3_* / R2).' });
      return;
    }

    const buf = fs.readFileSync(f.path);
    // 📄 az oldal-szám ELŐRE (a kvóta-gate oldal-szám alapú); ha olvashatatlan a PDF,
    // ez beszédes hibát dob → 400 (nem crash, nem fölösleges kvóta-terhelés).
    const { pageCount } = await probePdfPageCount(buf);

    // 📊 §2.2: a felhő-PDF-beolvasás havi `cloudJobs`-kvóta-gate OLDAL-SZÁM szerint
    // (oldalanként render+feltöltés → oldalanként 1 job). A hiteles tier a subscriptionből.
    const gate = await enforceQuota(uid, await userTier(uid), 'cloudJobs', pageCount);
    if (!gate.ok) {
      cleanup();
      res.status(429).json({ error: `Elérted a havi felhő-művelet kvótád (hátralévő: ${gate.remaining}).` });
      return;
    }

    const publicBase = `${req.protocol}://${req.get('host')}`;
    const projectId = String(req.body?.projectId || '').replace(/[^\w-]/g, '').slice(0, 64);
    const importId = crypto.randomUUID();
    const name = typeof req.body?.name === 'string' && req.body.name ? req.body.name.slice(0, 120) : undefined;

    // a lap→PNG rasterizáló (injektált): pdfjs+canvas → PNG → média-tár-feltöltés.
    // A pdfjs-munkamenetet CSAK az első hívásnál nyitjuk meg (lusta), és a hívások
    // közt újrahasználjuk (egy getDocument / PDF több oldalhoz).
    let pdfSession = null;
    const renderPageToPng = async (pdfBuf, pageIndex, size) => {
      if (!pdfSession) {
        pdfSession = await openPdfForRaster(pdfBuf);
      }
      const png = await rasterPdfPage(pdfSession, pageIndex, size);
      const key = ownedMediaKey(uid, projectId, `pdf/${importId}/page-${pageIndex + 1}.png`);
      const tmp = path.join(req.workDir, `page-${pageIndex + 1}.png`);
      fs.writeFileSync(tmp, png);
      const url = await uploadMedia(key, tmp, 'image/png', publicBase);
      return { src: url, uri: url };
    };

    const docs = await parsePdfToImageDocs(buf, { makeId: psdMakeId(), renderPageToPng, name });

    // 🛡️ minden kész doc átmegy a RENDER-guardon (nagy-doc védőkorlát), hogy később
    // biztosan renderelhető legyen — inkább itt beszédes hiba, mint a rendernél.
    for (const doc of docs) {
      const guardError = imageDocGuard(doc);
      if (guardError) {
        cleanup();
        res.status(413).json({ error: guardError });
        return;
      }
    }

    // 📊 §2.2: sikeres beolvasás → +oldal-szám `cloudJobs` (atomikus RPC; best-effort)
    void trackUsage(uid, 'cloudJobs', docs.length);
    cleanup();
    // a kliens oldalanként EGY `UPSERT_IMAGE_DOC`-ot tesz a command-busra (undo-barát)
    res.json({ docs });
  } catch (err) {
    logCaught('routes/imageTools.js', err);
    cleanup();
    const msg = String(err && err.message ? err.message : err).slice(0, 300);
    console.warn('pdf/import hiba:', msg);
    // a parser barátságos (magyar) üzenetei → 400 (kliens-hiba: rossz/túl nagy PDF)
    res.status(400).json({ error: msg });
  }
};

/**
 * 🖼️ PSD-export (IMAGE 01.2): a kliens elküldi az `ImageDoc`-ot (JSON), a worker a
 * fotó-rétegek PNG-jeit a média-tárból letölti (SSRF-védett `safeFetch`), majd a
 * `buildPsdFromImageDoc` mag RÉTEG-MEGŐRZÉSSEL (NEM flatten!) felépíti a .psd-t,
 * és a buffert FELTÖLTI a média-tárba → letölthető URL-t ad vissza (a kliens
 * menti/megosztja). A `/psd/import` PÁRJA, UGYANAZZAL a tier-gate-tel.
 *
 * Tier-gate (IMAGE 01.4): Pro-only SZERVER-hitelesen (`proOnly`) + havi `cloudJobs`
 * kvóta (`enforceQuota`) + siker → `trackUsage` — pontosan mint a `/psd/import`.
 * A dev `ALLOW_INSECURE_DEV` bypass a gate-ekben automatikus (konzisztens).
 */
exports.psdExportHandler = async (req, res) => {
  const uid = callerId(req, req.body?.userId);
  let workDir = req.workDir;
  const cleanup = () => {
    if (workDir) {
      fs.rm(workDir, { recursive: true, force: true }, () => {});
    }
  };
  try {
    let doc = null;
    let uriMap = {};
    try {
      doc = JSON.parse(req.body?.doc ?? 'null');
      uriMap = JSON.parse(req.body?.uriMap ?? '{}');
    } catch (caught) {
      logCaught('routes/imageTools.js', caught);
      doc = null;
    }
    if (!doc || !Array.isArray(doc.layers)) {
      cleanup();
      res.status(400).json({ error: 'Hiányzó vagy hibás ImageDoc.' });
      return;
    }
    if (!mediaStoreEnabled()) {
      cleanup();
      res.status(503).json({ error: 'A média-tár nincs konfigurálva (SUPABASE service_role vagy S3_* / R2).' });
      return;
    }
    // 🛡️ a doc átmegy a RENDER-guardon (nagy-doc védőkorlát) a PSD-építés ELŐTT
    const guardError = imageDocGuard(doc);
    if (guardError) {
      cleanup();
      res.status(413).json({ error: guardError });
      return;
    }

    // 📊 §2.2: a felhő-PSD-export havi `cloudJobs`-kvóta-gate (a `/psd/import` mintája)
    const gate = await enforceQuota(uid, await userTier(uid), 'cloudJobs', 1);
    if (!gate.ok) {
      cleanup();
      res.status(429).json({ error: `Elérted a havi felhő-művelet kvótád (hátralévő: ${gate.remaining}).` });
      return;
    }

    if (!workDir) {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
    }
    bindUploadedMedia(doc, req.files, uriMap);
    await resolveRemoteMedia(doc, workDir, remoteMediaOpts(req));
    // 🖨️ I29: minden réteg a /imagedoc renderén megy át, átlátszó, teljes vásznas PNG-ként —
    // az opacity/blend/rejtettség a PSD-rétegen marad, így Photoshopban is állítható
    const rasterizeLayerPng = layerRasterizer(doc, workDir, renderImageDoc);
    const fetchLayerPng = async () => null; // a rasterizáló fedi a fotókat is

    const psdBuf = await buildPsdFromImageDoc(doc, { fetchLayerPng, rasterizeLayerPng });

    // a PSD-t a média-tárba töltjük → letölthető URL (projekt-rendezett kulcs)
    const publicBase = `${req.protocol}://${req.get('host')}`;
    const projectId = String(req.body?.projectId || '').replace(/[^\w-]/g, '').slice(0, 64);
    const exportId = crypto.randomUUID();
    const safeName = (String(doc.name || 'image').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image');
    const key = ownedMediaKey(uid, projectId, `psd-export/${exportId}/${safeName}.psd`);
    const tmp = path.join(workDir, `${safeName}.psd`);
    fs.writeFileSync(tmp, psdBuf);
    const url = await uploadMedia(key, tmp, 'image/vnd.adobe.photoshop', publicBase);

    // 📊 §2.2: sikeres export → +1 `cloudJobs` (atomikus RPC; best-effort)
    void trackUsage(uid, 'cloudJobs', 1);
    cleanup();
    res.json({ url, name: `${safeName}.psd`, bytes: psdBuf.length });
  } catch (err) {
    logCaught('routes/imageTools.js', err);
    cleanup();
    const msg = String(err && err.message ? err.message : err).slice(0, 300);
    console.warn('psd/export hiba:', msg);
    res.status(400).json({ error: msg });
  }
};
