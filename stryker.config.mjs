// 🧬 Mutációs tesztelés (QUALITY 2. fázis) — csak a pénz- és projektintegritás-kritikus magokra.
// Futtatás: npm run test:mutation   (lassú; a CI éjszakai jobként futtatja)
//
// A sandbox a projekten KÍVÜL (OS tmp) van: a futó Metro így nem látja a mutált fájlokat. Az inPlace
// mód tilos — a mutált forrást a Metro azonnal az élő eszközökre töltené.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'jest',
  jest: { configFile: 'jest.stryker.config.js', enableFindRelatedTests: true },
  coverageAnalysis: 'perTest',
  mutate: [
    'src/lib/commands.ts',
    'src/lib/tiers.ts',
    'server/tiers.js',
    'server/billing.js',
    'server/coinSettle.js',
    'server/payouts.js',
    'server/payoutRunner.js',
    'server/quota.js',
    'server/usage.js',
    'server/security/*.js',
    '!**/*.test.js',
  ],
  // a nagy, tesztekhez nem kellő mappák nem kerülnek a sandboxba (a worker node_modules-át a
  // jest.stryker.config.js az eredeti helyéről oldja fel)
  ignorePatterns: ['/ios', '/android', '/devs', '/.expo', '/.audio-smoke', '/.render-smoke', '/.imagedoc-smoke', '/server/node_modules', '/server/media', '/server/models', '/server/bugs', '/reports', '/ChatGPT Image*'],
  // realpath: macOS-en a /var → /private/var link miatt a jest findRelatedTests különben nem talál egyezést
  tempDirName: path.join(fs.realpathSync(os.tmpdir()), 'remix-stryker'),
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 90, low: 80, break: 80 },
  concurrency: 6,
  timeoutMS: 20000,
};
