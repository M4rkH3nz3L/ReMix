// 🧹 PRO-VIDEO B25 — a hátrahagyott munkakönyvtárak söprése
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sweepStaleWorkDirs } = require('./upload');

test('csak a régi vided-render-* könyvtárakat törli', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-test-'));
  const old = path.join(root, 'vided-render-old');
  const fresh = path.join(root, 'vided-render-fresh');
  const other = path.join(root, 'other-old');
  for (const d of [old, fresh, other]) fs.mkdirSync(d);
  const past = (Date.now() - 7 * 3600 * 1000) / 1000;
  fs.utimesSync(old, past, past);
  fs.utimesSync(other, past, past);
  expect(sweepStaleWorkDirs(Date.now(), 6 * 3600 * 1000, root)).toBe(1);
  expect(fs.existsSync(old)).toBe(false);
  expect(fs.existsSync(fresh)).toBe(true);
  expect(fs.existsSync(other)).toBe(true);
  fs.rmSync(root, { recursive: true, force: true });
});
