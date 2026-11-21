// 🖼️ Kép-eszközök — a távoli réteg-média feloldó-opciói (SSRF-védett fetch + a saját média-tár a lemezről).
const fs = require('fs');
const path = require('path');
const { safeFetchFollow } = require('../../ssrf');
const { LOCAL_DIR } = require('../../mediastore');

/** távoli média feloldása: a saját (lokális) média-tár a lemezről jön, a fetch belső címnek tiltaná */
function remoteMediaOpts(req) {
  return {
    // 🛡️ az átirányítás minden hopja SSRF-validált (a sima `redirect: 'follow'` belső címre is követett)
    fetchUrl: (u) => safeFetchFollow(u),
    localPath: (url) => {
      const m = /^\/m\/(.+)$/.exec(new URL(url).pathname);
      if (!LOCAL_DIR || !m || new URL(url).host !== req.get('host')) {
        return null;
      }
      const file = path.resolve(LOCAL_DIR, decodeURIComponent(m[1]));
      return file.startsWith(path.resolve(LOCAL_DIR) + path.sep) && fs.existsSync(file) ? file : null;
    },
  };
}

module.exports = { remoteMediaOpts };
