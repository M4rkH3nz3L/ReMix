#!/usr/bin/env node
/**
 * 📏 Fájlméret-kapu (QUALITY 5. fázis): új forrásfájl nem lehet 1000 sornál hosszabb. A ma már nagyobb
 * fájlok a `large-files.json` listán vannak a mostani sorszámukkal — ezek NEM nőhetnek (csak
 * zsugorodhatnak; bontás után kikerülnek a listáról). Exit 1, ha sérül a szabály.
 *
 *   node scripts/quality/file-size.js            # ellenőrzés (CI)
 *   node scripts/quality/file-size.js --update   # a lista igazítása a csökkent méretekhez (csak lefelé)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_LINES = 1000;
const LIST_FILE = path.join(__dirname, 'large-files.json');
const SOURCE = /^(src|server|tools|scripts)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/;

function trackedSources(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => SOURCE.test(f) && !f.includes('node_modules/') && fs.existsSync(path.join(root, f)));
}

const countLines = (file) => fs.readFileSync(file, 'utf8').split('\n').length;

function main(argv, root = process.cwd()) {
  const update = argv.includes('--update');
  const allowed = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
  const problems = [];
  const next = {};
  for (const f of trackedSources(root)) {
    const n = countLines(path.join(root, f));
    if (n <= MAX_LINES) continue;
    if (!(f in allowed)) {
      problems.push(`${f}: ${n} sor — új fájl nem lehet ${MAX_LINES} sornál hosszabb (bontsd modulokra)`);
    } else if (n > allowed[f]) {
      problems.push(`${f}: ${n} sor — a lista szerint legfeljebb ${allowed[f]} (az óriásfájl nem nőhet; bontsd)`);
    }
    next[f] = Math.min(n, allowed[f] ?? n);
  }
  for (const p of problems) console.error(`❌ ${p}`);
  if (problems.length) return 1;
  const shrunk = Object.keys(allowed).filter((f) => next[f] !== allowed[f]);
  if (update) {
    fs.writeFileSync(LIST_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(next).sort()), null, 2)}\n`);
  } else if (shrunk.length) {
    console.log(`ℹ️ ${shrunk.length} listás fájl zsugorodott vagy megszűnt — futtasd: node scripts/quality/file-size.js --update`);
  }
  console.log(`✅ fájlméret: ${Object.keys(next).length} ismert óriásfájl, új nincs`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
module.exports = { main, MAX_LINES };
