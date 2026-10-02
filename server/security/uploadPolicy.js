// 🧰 Upload-guard middleware a mediaPolicy köré.
//
// SZÁNDÉKOSAN post-multer, ADDITÍV guard: a meglévő `upload.any()` mezőkezelését
// NEM változtatja meg (a handlerek továbbra is `req.files` tömböt kapnak) — csak
// a feltöltött fájlok TARTALMÁT (magic-byte), méretét és darabszámát ellenőrzi,
// és a rosszindulatú/hibás feltöltést 415/413/400-zal elutasítja + letörli a
// lemezről. Így törés nélkül húzható rá a nyitott upload-endpointokra.
//
// A teljes `mediaUpload(kind)` (nevesített mezők + szigorított multer-limit, a
// globális 2 GB kiváltása) a cutover következő lépése (devs/tasks/remix/02) —
// ez a guard a biztonságos első réteg.
const fs = require('fs');
const { validateUploads } = require('./mediaPolicy');

const HEADER_BYTES = 32; // elég a ftyp-brandig (offset 8–11)

/** egy fájl első bájtjai a lemezről (magic-byte-hoz); hibánál üres buffer */
function readHeader(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const n = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** a (rossz) feltöltött fájlok törlése a lemezről */
function cleanup(files) {
  for (const f of files || []) {
    if (f && f.path) {
      try {
        fs.unlinkSync(f.path);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Express-middleware: a `req.files` (multer upload.any() kimenete) tartalmi
 * validálása a `kind` profil ellen. Siker → next(); hiba → 4xx + cleanup.
 */
function mediaGuard(kind) {
  return (req, res, next) => {
    const files = (req.files || []).map((f) => ({
      originalname: f.originalname,
      size: f.size,
      path: f.path,
      header: readHeader(f.path),
    }));
    const r = validateUploads(files, kind);
    if (!r.ok) {
      cleanup(req.files);
      res.status(r.status || 400).json({ error: r.error });
      return;
    }
    next();
  };
}

module.exports = { mediaGuard, readHeader };
