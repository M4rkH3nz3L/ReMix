/**
 * CSAK JEST: a `client` teszt-projekt babel-jest transzformja kapja meg (jest.config.js) — a Metro
 * és az éles bundle SOSEM (azok nem olvassák a jest-konfigot; babel.config.js nincs a repóban).
 *
 * Miért kell: a jest-expo a `babel-preset-expo`-t Metro-callerrel futtatja, ami az `import()`-ot
 * érintetlenül hagyja (a Metro maga oldja fel). A jest viszont `--experimental-vm-modules` nélkül nem
 * tud natív dinamikus importot → minden `await import('…')` mögötti ág csendben a catch-be esett, és
 * tesztelhetetlen volt.
 *
 * Hogyan: ugyanazt a jelzőt teszi a fájlra, mint a hivatalos `@babel/plugin-transform-dynamic-import`.
 * Erre a preset `@babel/plugin-transform-modules-commonjs`-e a saját, interop-helyes átírását
 * használja: `import('x')` → `Promise.resolve().then(() => _interopRequireWildcard(require('x')))`.
 * Így a `jest.mock('x')` a dinamikusan importált modulra is érvényes.
 */
module.exports = function jestDynamicImport() {
  return {
    name: 'remix-jest-dynamic-import',
    pre() {
      this.file.set('@babel/plugin-proposal-dynamic-import', '7.0.0-remix-jest');
    },
  };
};
