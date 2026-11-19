/**
 * A Stryker-sandbox jest-konfigja: a gyökér-konfig, de a `server` projekt a worker függőségeit az
 * EREDETI `server/node_modules`-ból oldja fel (a sandbox azt nem másolja — 500+ MB).
 */
const path = require('path');

const base = require('./jest.config');

const SERVER_MODULES = path.resolve(process.env.REMIX_ROOT || path.join(__dirname), 'server', 'node_modules');

module.exports = {
  ...base,
  // a watchman nem figyeli a tmp-ben lévő sandboxot → enélkül a jest egy tesztet sem talál
  watchman: false,
  // a Stryker objektumként adja tovább a konfigot → a <rootDir>-t explicit kell rögzíteni
  rootDir: __dirname,
  projects: base.projects.map((p) => ({
    ...p,
    rootDir: __dirname,
    ...(p.displayName === 'server' ? { moduleDirectories: ['node_modules', SERVER_MODULES] } : {}),
  })),
};
