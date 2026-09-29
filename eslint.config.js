// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // a server/ Node-oldali CommonJS worker és a supabase/functions Deno Edge
    // Function-ök — más runtime (`Deno.*` globálisok, távoli `https://` importok),
    // ezért nem az Expo-app lint/tsc szabályai alá tartoznak
    ignores: ["dist/*", "server/**", "supabase/functions/**"],
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
