// 🔌 Per-USER külső tárhely-források (Google Drive / Dropbox / WebDAV / S3).
//
// A user a SAJÁT felhőjét köti be a profilról; a média ott marad → NEM terheli a
// mi kvótánkat. A hitelesítés (OAuth token / kulcs) a `user_storage_providers`
// táblában van, és SOHA nem megy a kliensre — a worker (service_role) olvassa és
// PROXYZ. A kliens csak a `/storage/*` végpontokat látja (requireAuth, per-user).
//
// A WebDAV/S3 connectort a régi `storage.js`-ből hasznosítjuk újra; a Drive/Dropbox
// OAuth-connector itt van. Az OAuth env-kapuzott (mint a RevenueCat): kulcsok
// nélkül a `connect` végpont beszédes hibát ad, nem omlik össze.
//
// REFACTOR: a megvalósítás a server/userStorageLib/ alatt, felelősség szerint bontva; ez a homlokzat
// ugyanazt a module.exports-ot adja (kulcsok, sorrend, függvény-identitások).
const { OAUTH, oauthConfigured } = require('./userStorageLib/oauthConfig');
const { fileToken, verifyFileToken } = require('./userStorageLib/signing');
const { findUserSource, upsertProvider, disconnectSource } = require('./userStorageLib/sourcesDb');
const { oauthStartUrl, oauthCallback } = require('./userStorageLib/oauthFlow');
const {
  uploadToSource,
  describeUserSources,
  listConnected,
  getDefaultTarget,
  setDefaultTarget,
  listUserSource,
  streamUserSourceFile,
} = require('./userStorageLib/gateway');

module.exports = {
  OAUTH,
  oauthConfigured,
  oauthStartUrl,
  oauthCallback,
  fileToken,
  verifyFileToken,
  describeUserSources,
  listConnected,
  listUserSource,
  streamUserSourceFile,
  findUserSource,
  upsertProvider,
  disconnectSource,
  uploadToSource,
  getDefaultTarget,
  setDefaultTarget,
};
