// 🗂️ ReMix Storage — a user SAJÁT fájl-tára a MI tárhelyünkön (élesben Cloudflare R2).
//
// Projekt-független, mappás fájlkezelő: minden user egy saját prefix alatt
// (`files/<userId>/<mappa>/<fájl>`) tárol. Mappa = kulcs-prefix; az ÜRES mappát egy
// `.folder` jelölő-objektum tartja életben (az S3-nak nincsenek valódi mappái).
//
// A bájtok a meglévő `storage_objects` főkönyvbe kerülnek (project_id = null) → a
// fájlok UGYANAZT a kvótát terhelik, mint a projekt-média (free 1 GiB / Pro 5 GiB
// + koin-boost), és a felhasználó NEM tud kvótán felül tárolni.
//
// Backend (a mediastore-ral azonos sorrend):
//   STORAGE_BACKEND=r2|s3 → S3/R2 · különben USER_FILES_LOCAL_DIR/MEDIA_LOCAL_DIR
//   (dev/teszt, lokális disk) · különben S3, ha be van kötve · különben nincs (503).
// Az objektumokhoz SOHA nem adunk ki publikus URL-t: a letöltés a hitelesített
// `/files/download` proxyn megy (a jogosultságot minden kérésnél a szerver dönti el).
//
// A modulcsalád a server/userFilesLib/ alatt: constants (korlátok), errors (UserFilesError),
// paths (pure út-segédek), md5 (fájl-MD5), localBackend / s3Backend / resolveBackend (tárolók),
// treeOps (mappa-fa, áthelyezés), fileOps / trashOps / uploadSessionOps (műveletek),
// createUserFiles (a gyár).
const { MARKER, TRASH_RETENTION_DAYS, PART_SIZE } = require('./userFilesLib/constants');
const { UserFilesError } = require('./userFilesLib/errors');
const { normalizePath, cleanSegment, joinPath, parentOf, userRoot, nextFreeName } = require('./userFilesLib/paths');
const { md5OfFile } = require('./userFilesLib/md5');
const { localBackend } = require('./userFilesLib/localBackend');
const { filesBucket } = require('./userFilesLib/s3Backend');
const { resolveBackend } = require('./userFilesLib/resolveBackend');
const { createUserFiles } = require('./userFilesLib/createUserFiles');

module.exports = {
  MARKER,
  TRASH_RETENTION_DAYS,
  PART_SIZE,
  UserFilesError,
  normalizePath,
  cleanSegment,
  joinPath,
  parentOf,
  userRoot,
  nextFreeName,
  md5OfFile,
  localBackend,
  resolveBackend,
  filesBucket,
  createUserFiles,
};
