// 🗂️ ReMix Storage — egy lokális fájl MD5-je (stream-elve; integritás-ellenőrzéshez).
const crypto = require('crypto');
const fs = require('fs');

function md5OfFile(localPath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(localPath)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

module.exports = { md5OfFile };
