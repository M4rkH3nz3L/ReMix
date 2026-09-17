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
 * Ez a teszt a VALÓDI fordítási úton méri (`babel-preset-expo`,
 * `supportsReactCompiler: true`, ahogy a Metro hívja), és nem a fordító
 * naplójára hagyatkozik, hanem a KIMENETRE: a memoizált komponensben ott van a
 * `_c(n)` cache-hívás.
 *
 * A lista szándékosan „kirögzített": ha valami elromlik VAGY megjavul, a teszt
 * elbukik, és ide kell átvezetni. Így a bail-lista nem tud némán nőni.
 */

const ROOT = path.join(__dirname, '..');

/** a lejátszás/görgetés alatt folyamatosan dolgozó komponensek */
const MUST_BE_MEMOIZED = [
  'src/components/editor/TimelineClip.tsx',
  'src/components/preview/AudioLayer.tsx',
  'src/components/preview/PipLayer.tsx',
  'src/components/preview/TransitionLayer.tsx',
  'src/components/preview/ShapeOverlay.tsx',
];

/**
 * Ismert, ELFOGADOTT kimaradások — mindegyikhez az OK, hogy a következő olvasó
 * ne kezdje elölről a nyomozást. Ha valamelyik megjavul, a teszt szól.
 */
const KNOWN_BAILS = {
  'src/components/editor/Timeline.tsx':
    'a pinch-gesztus onStart/onUpdate closure-je refet ír — a gesztus-építő a render alatt fut',
  'src/components/preview/PreviewSurface.tsx':
    'expo-video player-mutáció (currentTime/volume/playbackRate) — hookból jövő érték módosítása',
  'src/components/preview/TextOverlay.tsx':
    'Reanimated shared value írása effekt-függőség után',
};

function memoCount(relPath) {
  const file = path.join(ROOT, relPath);
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    presets: [[require.resolve('babel-preset-expo'), {}]],
    configFile: false,
    babelrc: false,
    // pontosan azok a caller-jelzések, amikkel a Metro hívja a presetet;
    // a `supportsReactCompiler` kapcsolja be a fordítót (babel-preset-expo
    // build/common.js: getReactCompiler)
    caller: {
      name: 'metro',
      platform: 'ios',
      isDev: false,
      supportsStaticESM: true,
      supportsReactCompiler: true,
    },
  });
  return (code.match(/_c\(\d+\)/g) || []).length;
}

describe('React Compiler — a forró útvonal memoizálása', () => {
  it.each(MUST_BE_MEMOIZED)('%s memoizálva van', (rel) => {
    expect(memoCount(rel)).toBeGreaterThan(0);
  });

  it.each(Object.keys(KNOWN_BAILS))(
    '%s még mindig kimarad (ha megjavult, vezesd át a listán!)',
    (rel) => {
      expect(memoCount(rel)).toBe(0);
    }
  );

  it('a mérőműszer maga is működik (különben mindent „memoizáltnak" látnánk)', () => {
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
      expect(memoCount('tools/__probe.tsx')).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
