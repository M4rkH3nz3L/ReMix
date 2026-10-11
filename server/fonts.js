// 🔤 Worker betűtípus-készlet — a render EGYETLEN forrása (függőség-mentes, hogy a
// kliens↔worker contract-teszt require-ölhesse a nehéz text-render.js nélkül).
//
// A `family` kulcs AZONOS az appban (expo-font `useFonts` kulcs, `_layout.tsx`) és a
// kliens UI-választékban (`src/constants/fonts.ts`), így az előnézet és a beégetett
// kép/videó UGYANAZT a fontot mutatja (Preview == Export). A TTF-ek az app
// `assets/fonts/` és a worker `server/assets/fonts/` mappáiban élnek — a parity-t a
// `src/lib/contract.test.ts` zárolja (drift → piros teszt).
const FONT_FILES = {
  Anton: 'Anton-Regular.ttf',
  BebasNeue: 'BebasNeue-Regular.ttf',
  Poppins: 'Poppins-Bold.ttf',
  Pacifico: 'Pacifico-Regular.ttf',
  Bungee: 'Bungee-Regular.ttf',
  Oswald: 'Oswald-Regular.ttf',
  ArchivoBlack: 'ArchivoBlack-Regular.ttf',
  Righteous: 'Righteous-Regular.ttf',
  Lobster: 'Lobster-Regular.ttf',
  PermanentMarker: 'PermanentMarker-Regular.ttf',
};

module.exports = { FONT_FILES };
