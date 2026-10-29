// 📤 Multer feltöltés-konfig — kiemelve az index.js-ből (01-api-architecture §01.1/§01.5).
//
// A korábbi GLOBÁLIS `fileSize: 2 GB` blanket-limit helyett endpoint-PROFIL
// szerinti limit (a bufferelés ELŐTT csap le a túl nagy feltöltésre, nem csak a
// post-multer mediaGuard). A profilok a security/mediaPolicy MEDIA_PROFILES
// méreteit tükrözik. A `upload` (2 GB) a még-nem-profilozott route-ok fallbackja.

const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');

const MB = 1024 * 1024;
const GB = 1024 * MB;

// a tár-konfig VÁLTOZATLAN: kérésenkénti workDir, a fieldname a kulcs, a
// kiterjesztést megőrizzük az ffmpeg formátum-döntéséhez
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    if (!req.workDir) {
      req.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vided-render-'));
    }
    cb(null, req.workDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${file.fieldname}${path.extname(file.originalname) || ''}`);
  },
});

/** multer-példány adott méret-plafonnal (ugyanazon a disk-storage-on). */
function makeUpload(limitBytes) {
  return multer({ storage, limits: { fileSize: limitBytes } });
}

// endpoint-profilok (a MEDIA_PROFILES tükre) + a blanket fallback
const upload = makeUpload(2 * GB); // fallback (még-nem-profilozott route-ok)
const uploadImage = makeUpload(40 * MB);
const uploadVideo = makeUpload(500 * MB);
const uploadAudio = makeUpload(100 * MB);

// 🧹 B25: tmp-söprés — a kérésenkénti `vided-render-*` munkakönyvtárak, amiket egy
// elhasalt / félbeszakadt kérés ott hagyott (eddig örökre gyűltek → disk-fill). A
// feltöltés mostantól a hitelesítés MÖGÖTT fut, így idegen kérés nem is hoz létre ilyet.
const WORKDIR_PREFIX = 'vided-render-';
const STALE_MS = 6 * 60 * 60 * 1000;

function sweepStaleWorkDirs(now = Date.now(), maxAgeMs = STALE_MS, root = os.tmpdir()) {
  let removed = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.startsWith(WORKDIR_PREFIX)) continue;
    const dir = path.join(root, name);
    try {
      const st = fs.statSync(dir);
      if (st.isDirectory() && now - st.mtimeMs > maxAgeMs) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // párhuzamosan törölt / nem olvasható → kihagyjuk
    }
  }
  return removed;
}

if (!process.env.JEST_WORKER_ID) {
  setInterval(() => sweepStaleWorkDirs(), 30 * 60 * 1000).unref();
}

module.exports = { upload, uploadImage, uploadVideo, uploadAudio, makeUpload, storage, sweepStaleWorkDirs };
