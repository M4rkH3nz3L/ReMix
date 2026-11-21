// 🗂️ ReMix Storage — a futás-időben érvényes backend kiválasztása (a mediastore-ral azonos sorrend):
//   STORAGE_BACKEND=r2|s3 → S3/R2 · különben USER_FILES_LOCAL_DIR/MEDIA_LOCAL_DIR
//   (dev/teszt, lokális disk) · különben S3, ha be van kötve · különben nincs (503).
const s3 = require('../s3store');
const { localBackend } = require('./localBackend');
const { s3Backend } = require('./s3Backend');

/** A futás-időben érvényes backend (a env-et lustán olvassuk → tesztelhető). */
function resolveBackend() {
  const backend = (process.env.STORAGE_BACKEND || '').trim().toLowerCase();
  if ((backend === 'r2' || backend === 's3') && s3.s3Enabled()) {
    return s3Backend();
  }
  const localDir = (process.env.USER_FILES_LOCAL_DIR || process.env.MEDIA_LOCAL_DIR || '').trim();
  if (localDir) {
    return localBackend(localDir);
  }
  if (s3.s3Enabled()) {
    return s3Backend();
  }
  return null;
}

module.exports = { resolveBackend };
