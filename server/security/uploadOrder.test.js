// 🔒 PRO-VIDEO B25 — a multipart feltöltés (lemezírás) SOHA nem fut a hitelesítés előtt.
// Statikus őr: minden route-definícióban a multer-middleware előtt ott a requireAuth /
// proOnly / paidOnly (különben hitelesítetlen kérés 2 GB-ot írhatna a lemezre).
const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'routes');
const UPLOAD = /\b(upload|uploadImage|uploadVideo|uploadAudio)\.(any|single|array|fields)\(/;
const AUTH = /\b(requireAuth|proOnly|paidOnly)\b/;

test('minden feltöltő route-on az auth a multer ELŐTT van', () => {
  const offenders = [];
  for (const file of fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROUTES, file), 'utf8');
    for (const line of src.split('\n')) {
      if (!/router\.(post|put|patch)\(/.test(line)) continue;
      const up = line.search(UPLOAD);
      if (up < 0) continue;
      const auth = line.search(AUTH);
      if (auth < 0 || auth > up) offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
    }
  }
  expect(offenders).toEqual([]);
});
