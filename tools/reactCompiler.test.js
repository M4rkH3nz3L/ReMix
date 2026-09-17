const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

/**
 * 🧭 Őr a React Compiler memoizálására a FORRÓ útvonalon.
 *
 * A projektnek nincs kézi `useMemo`-ja a szerkesztőben: az EGYETLEN memoizálási
 * stratégia a fordító. Ha egy komponens kiesik az optimalizálásból, azt ma
 * semmi nem jelzi — a lint hallgat, a build zöld, csak a telefon lesz lassabb.
 *
 * KOMPONENSENKÉNT mér, nem fájlonként. Ez lényeges: egy fájlban együtt élhet
 * lefordult és kimaradt függvény (a `TimelineClip.tsx`-ben például a kis
 * `EdgeThumb` segéd lefordul, miközben a FŐ `TimelineClip` kimarad), ezért a
 * fájl-szintű „van-e benne `_c(`" mérés HAMIS biztonságot ad.
 *
 * A mérés a VALÓDI fordítási úton történik (`babel-preset-expo`,
 * `caller.supportsReactCompiler: true`, ahogy a Metro hívja), és nem a fordító
 * naplójára hagyatkozik, hanem a KIMENETRE: a memoizált függvény törzse
 * `$ = _c(n)`-nel kezdődik.
 *
 * A lista szándékosan kétirányúan „kirögzített": elbukik, ha valami visszaesik,
 * ÉS akkor is, ha egy ismert kimaradó megjavul — így nem tud sem némán nőni,
 * sem elavulni.
 */

const ROOT = path.join(__dirname, '..');

/** fájl → a benne memoizálandó komponensek (a lejátszás alatt dolgozók) */
const MUST_BE_MEMOIZED = [
  ['src/components/preview/AudioLayer.tsx', 'AudioLayer'],
  ['src/components/preview/PipLayer.tsx', 'PipLayer'],
  ['src/components/preview/PipLayer.tsx', 'PipClipFrame'],
  ['src/components/preview/TransitionLayer.tsx', 'TransitionLayer'],
  ['src/components/preview/TransitionLayer.tsx', 'IncomingClip'],
  ['src/components/preview/ShapeOverlay.tsx', 'ShapeOverlay'],
];

/**
 * Ismert, ELFOGADOTT kimaradások — mindegyikhez az OK, hogy a következő olvasó
 * ne kezdje elölről a nyomozást.
 *
 * Közös nevező: expo-video/expo-audio player-mutáció vagy Reanimated shared
 * value írása. Ezekre az `AGENTS.md` szándékosan kikapcsolta a
 * `react-hooks/immutability` és `react-hooks/refs` szabályokat — a fordító
 * viszont ugyanezeket látja, és emiatt hagyja ki a komponenst.
 */
const KNOWN_BAILS = [
  ['src/components/editor/Timeline.tsx', 'Timeline', 'pinch-gesztus closure refet ír'],
  // a komponens neve a forrásban TimelineClipInner; a `TimelineClip` a memo() burkolat
  ['src/components/editor/TimelineClip.tsx', 'TimelineClipInner', 'Reanimated shared value mutációk'],
  ['src/components/preview/PreviewSurface.tsx', 'PreviewSurface', 'expo-video player-mutáció'],
  ['src/components/preview/TextOverlay.tsx', 'TextOverlay', 'Reanimated shared value írása'],
];

const cache = new Map();
function transformed(relPath) {
  if (cache.has(relPath)) {
    return cache.get(relPath);
  }
  const file = path.join(ROOT, relPath);
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [[require.resolve('babel-preset-expo'), {}]],
    configFile: false,
    babelrc: false,
    // pontosan azok a caller-jelzések, amikkel a Metro hívja a presetet; a
    // fordítót a `supportsReactCompiler` kapcsolja be, NEM preset-opció
    // (babel-preset-expo build/common.js: getReactCompiler)
    caller: {
      name: 'metro',
      platform: 'ios',
      isDev: false,
      supportsStaticESM: true,
      supportsReactCompiler: true,
    },
  });
  cache.set(relPath, code);
  return code;
}

/** a memoizált függvény törzse `$ = _c(n)`-nel nyit */
function isMemoized(relPath, fnName) {
  const code = transformed(relPath);
  if (!new RegExp(`function\\s+${fnName}\\s*\\(`).test(code)) {
    throw new Error(`${fnName} nem található a ${relPath} kimenetében — átnevezték?`);
  }
  return new RegExp(
    `function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{\\s*(?:var|const|let)\\s+\\$\\s*=\\s*_c\\(`
  ).test(code);
}

describe('React Compiler — a forró útvonal memoizálása', () => {
  it.each(MUST_BE_MEMOIZED)('%s · %s memoizálva van', (file, fn) => {
    expect(isMemoized(file, fn)).toBe(true);
  });

  it.each(KNOWN_BAILS)('%s · %s még mindig kimarad (%s)', (file, fn) => {
    // ha ez elbukik, az JÓ hír: vedd ki a KNOWN_BAILS-ből, és tedd át a
    // MUST_BE_MEMOIZED-ba, hogy ne tudjon visszaesni
    expect(isMemoized(file, fn)).toBe(false);
  });

  it('a mérőműszer maga is működik (különben mindent „kimaradtnak" látnánk)', () => {
    const probe = path.join(ROOT, 'tools', '__probe.tsx');
    fs.writeFileSync(
      probe,
      `import { Text } from 'react-native';
       export function Probe({ items }: { items: string[] }) {
         return <Text>{items.map((s) => s.toUpperCase()).join(', ')}</Text>;
       }`
    );
    try {
      // egy triviálisan fordítható komponens MUSZÁJ hogy memoizálódjon — ha nem,
      // akkor a caller-konfig romlott el, és a fenti állítások értéktelenek
      expect(isMemoized('tools/__probe.tsx', 'Probe')).toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
