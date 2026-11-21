// 🗂️ ReMix Storage — a műveletek gyára (userId-hez kötve): a fájl-, a Lomtár- és a darabolt
// feltöltés-műveleteket egy közös backend + kvóta-főkönyv fölé köti.
const { PART_SIZE } = require('./constants');
const { UserFilesError } = require('./errors');
const { createFileOps } = require('./fileOps');
const { createTrashOps } = require('./trashOps');
const { createTreeOps } = require('./treeOps');
const { createUploadSessionOps } = require('./uploadSessionOps');

// ── műveletek (userId-hez kötve) ───────────────────────────────────────────────

/**
 * @param {object} deps `{ backend, ledger }` — a ledger a kvóta-főkönyv
 *   (`recordObject`, `forgetObject`, `moveObject`, `wouldExceed`); dev-ben/tesztben
 *   lehet no-op. A `bucket` a főkönyvi címke (a mediastore BUCKET-je).
 */
function createUserFiles({ backend, ledger, bucket = 'renders', partSize = PART_SIZE }) {
  if (!backend) {
    throw new UserFilesError(503, 'storage_unconfigured', 'A ReMix Storage nincs konfigurálva.');
  }

  const tree = createTreeOps({ backend, ledger, bucket });
  const { list, mkdir, upload, remove, move, open } = createFileOps({ backend, ledger, bucket }, tree);
  const { trash, listTrash, restoreTrash, purgeTrash } = createTrashOps({ backend, ledger, bucket }, tree);
  const { uploadInit, uploadStatus, uploadPart, uploadComplete, uploadAbort } = createUploadSessionOps({
    backend,
    ledger,
    bucket,
    partSize,
  });

  return {
    list,
    mkdir,
    upload,
    remove,
    move,
    open,
    trash,
    listTrash,
    restoreTrash,
    purgeTrash,
    uploadInit,
    uploadStatus,
    uploadPart,
    uploadComplete,
    uploadAbort,
  };
}

module.exports = { createUserFiles };
