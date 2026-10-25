#!/usr/bin/env node
/**
 * 🐞 Hiba-összesítő: a `server/bugs/` fájljai egy áttekinthető táblában —
 * előbb a nyitott/visszatért (regressed), azon belül a leggyakoribb.
 *   npm run bugs                → nyitottak
 *   npm run bugs -- --all       → a javítottak is
 * Egy hiba javítottra jelölése: a fájlban `"status": "fixed"` (+ `notes`). Ha
 * újra előfordul, a worker magától `regressed`-re állítja.
 */
const fs = require('fs');
const path = require('path');

const dir = process.env.BUGS_DIR || path.join(__dirname, '..', 'bugs');
const showAll = process.argv.includes('--all');

let files = [];
try {
  files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
} catch {
  console.log(`Nincs bug-mappa (${dir}) — még nem érkezett hibajelentés.`);
  process.exit(0);
}

const rank = { regressed: 0, open: 1, fixed: 2 };
const bugs = files
  .map((f) => {
    try {
      return { file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) };
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((b) => showAll || b.status !== 'fixed')
  .sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1) || (b.count || 0) - (a.count || 0));

if (bugs.length === 0) {
  console.log('✅ Nincs nyitott hiba.');
  process.exit(0);
}

for (const b of bugs) {
  const platforms = Object.entries(b.platforms || {})
    .map(([k, v]) => `${k}×${v}`)
    .join(' ');
  const flag = b.status === 'regressed' ? '🔁' : b.status === 'fixed' ? '✅' : '🐞';
  console.log(`${flag} ${String(b.count).padStart(4)}×  ${b.title}`);
  console.log(`        ${b.file} · utoljára ${b.lastSeen} · ${platforms}`);
}
console.log(`\n${bugs.length} hiba · mappa: ${dir}`);
