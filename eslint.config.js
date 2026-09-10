// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // a server/ Node-oldali CommonJS worker — nem az Expo-app lint-szabályai alá tartozik
    ignores: ["dist/*", "server/**"],
  },
  {
    rules: {
      // A Reanimated shared value-k (`sv.value = x` worklet-callbackben) és az
      // expo-video/expo-audio player-objektumok (`player.currentTime = x`)
      // mutálása a könyvtárak hivatalos használati mintája — a React Compiler
      // konzervatív szabályai ezekre hamis pozitívat adnak.
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
]);
