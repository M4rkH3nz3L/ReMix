/**
 * Három külön teszt-projekt egy futtatóban:
 *
 *  • `client` — a `src/` TypeScript moduljai. A `jest-expo` preset intézi a
 *    React Native / Expo transzformációt. A `lib/` magok szándékosan
 *    expo-mentesek (lásd AGENTS.md), ezért többségük natív modul nélkül fut.
 *  • `server` — a `server/` worker sima Node-JS kódja: nincs RN-transzform,
 *    node környezet.
 *  • `build`  — a FORDÍTÁSI KIMENETET vizsgáló ellenőrzések (React Compiler
 *    memoizálás). Ezek maguk futtatják a babel-transzformot, ezért sima Node
 *    kell nekik — nem mehetnek a `client` RN-preset alá.
 *
 * Futtatás:  npm test        (egyszer, CI-barát)
 *            npm run test:watch
 */

// A jest-expo JS/TS-transzformja + a dinamikus `import()` átírása (CSAK jestben — a Metro nem olvassa
// ezt a fájlt; indoklás: tools/jest/babel-plugin-dynamic-import.js). A preset kulcsát írjuk felül, így
// a preset minden más beállítása (caller, root, babelrc) változatlan marad.
const EXPO_JS_TRANSFORM = '\\.[jt]sx?$';
const [babelJest, expoBabelOptions] = require('jest-expo/jest-preset').transform[EXPO_JS_TRANSFORM];
const clientJsTransform = [
  babelJest,
  {
    ...expoBabelOptions,
    plugins: [...(expoBabelOptions.plugins || []), require.resolve('./tools/jest/babel-plugin-dynamic-import')],
  },
];

module.exports = {
  // V8-alapú coverage: nem írja át a forrást. Az alapértelmezett (babel/istanbul) a
  // `page.evaluate`-nek átadott függvényekbe is `cov_…` számlálót injektál, ami a Chromiumban
  // nem létezik → a renderer-tesztek a coverage-futásban hamisan buktak (ReferenceError).
  coverageProvider: 'v8',
  projects: [
    {
      displayName: 'client',
      preset: 'jest-expo',
      transform: { [EXPO_JS_TRANSFORM]: clientJsTransform },
      testMatch:['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
      ],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    },
    {
      displayName: 'server',
      testEnvironment: 'node',
      // csak a SAJÁT teszteket futtatjuk; a worker node_modules-ában lévő
      // csomag-teszteket kihagyjuk (feloldani viszont kell tudni onnan!)
      testMatch: ['<rootDir>/server/**/*.test.js'],
      testPathIgnorePatterns: ['<rootDir>/server/node_modules/'],
    },
    {
      displayName: 'build',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tools/**/*.test.js'],
    },
  ],
};
