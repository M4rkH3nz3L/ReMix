#!/usr/bin/env node
/**
 * 📈 Coverage-ratchet (QUALITY 5. fázis): a `jest --coverage --coverageReporters=json-summary` összesítőjét
 * a rögzített padlóhoz méri. A padló alá esés → exit 1 (a CI bukik). `--update`: a padlót a mostani értékre
 * EMELI (csak felfelé mozdul; lejjebb sosem).
 *
 *   node scripts/quality/coverage-ratchet.js [coverage/coverage-summary.json] [--update]
 *
 * A mérő a V8 (jest.config.js coverageProvider) — a padló is V8-ban értendő. 0,1 %-pont tűrés a
 * futtatók közti apró eltérésre (pl. időzítésfüggő ágak); ennél nagyobb esés hiba.
 */
const fs = require('fs');
const path = require('path');

const FLOOR_FILE = path.join(__dirname, 'coverage-floor.json');
const METRICS = ['lines', 'statements', 'functions', 'branches'];
const TOLERANCE = 0.1;

function main(argv) {
  const update = argv.includes('--update');
  const summaryFile = argv.find((a) => !a.startsWith('--')) || path.join(process.cwd(), 'coverage', 'coverage-summary.json');
  const total = JSON.parse(fs.readFileSync(summaryFile, 'utf8')).total;
  const floor = JSON.parse(fs.readFileSync(FLOOR_FILE, 'utf8'));
  const rows = METRICS.map((m) => ({ metric: m, now: total[m].pct, floor: floor[m] }));
  const failed = rows.filter((r) => r.now + TOLERANCE < r.floor);
  for (const r of rows) {
    const mark = r.now + TOLERANCE < r.floor ? '❌' : r.now > r.floor ? '⬆️' : '✅';
    console.log(`${mark} ${r.metric.padEnd(10)} ${r.now.toFixed(2)} % (padló: ${r.floor.toFixed(2)} %)`);
  }
  if (failed.length) {
    console.error(`\nA coverage a padló alá esett: ${failed.map((r) => r.metric).join(', ')}. Írj tesztet a változtatásodhoz.`);
    return 1;
  }
  if (update) {
    const next = { ...floor };
    for (const r of rows) next[r.metric] = Math.max(r.floor, Math.floor(r.now * 100) / 100);
    fs.writeFileSync(FLOOR_FILE, `${JSON.stringify(next, null, 2)}\n`);
    console.log('\nA padló frissítve (csak felfelé).');
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
module.exports = { main };
