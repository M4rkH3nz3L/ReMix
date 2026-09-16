/**
 * Két külön teszt-projekt egy futtatóban:
 *
 *  • `client` — a `src/` TypeScript moduljai. A `jest-expo` preset intézi a
 *    React Native / Expo transzformációt. A `lib/` magok szándékosan
 *    expo-mentesek (lásd AGENTS.md), ezért többségük natív modul nélkül fut.
 *  • `server` — a `server/` worker sima Node-JS kódja: nincs RN-transzform,
 *    node környezet.
 *
 * Futtatás:  npm test        (egyszer, CI-barát)
 *            npm run test:watch
 */
module.exports = {
  projects: [
    {
      displayName: 'client',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
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
  ],
};
