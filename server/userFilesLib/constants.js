// 🗂️ ReMix Storage — a fájl-tár korlátai és állandói (a userFiles.js modulcsaládja).
const MARKER = '.folder';
const MAX_SEGMENT = 120;
const MAX_DEPTH = 20;
const MAX_PATH = 512;
/** egy mappa-törlés/átnevezés legfeljebb ennyi objektumot érint (védőkorlát) */
const MAX_TREE = 1000;
/** 🗑️ a Lomtár megőrzési ideje (nap) — utána a listázáskor véglegesen törlődik */
const TRASH_RETENTION_DAYS = 30;
const TRASH_META = '.meta.json';
/** 🧩 darabolt (multipart) feltöltés darabmérete — az S3 minimuma 5 MiB (az utolsó kisebb lehet) */
const PART_SIZE = 8 * 1024 * 1024;
/** a félbehagyott feltöltés-munkamenetek ennyi nap után takarítódnak */
const UPLOAD_SESSION_DAYS = 7;

module.exports = {
  MARKER,
  MAX_SEGMENT,
  MAX_DEPTH,
  MAX_PATH,
  MAX_TREE,
  TRASH_RETENTION_DAYS,
  TRASH_META,
  PART_SIZE,
  UPLOAD_SESSION_DAYS,
};
