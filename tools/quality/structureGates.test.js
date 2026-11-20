/**
 * A REFACTOR-kapuk (scripts/quality/cycles.js, api-surface.js) saját tesztje: a körkereső és az
 * import-felismerés helyessége — hogy a kapu se hamis zöldet, se hamis pirosat ne adjon.
 */
const { findCycles, runtimeSpecifiers, stripComments } = require('../../scripts/quality/cycles');
const { compact } = require('../../scripts/quality/api-surface');

describe('runtimeSpecifiers', () => {
  it('a futásidejű importokat, re-exportokat és require-t felismeri', () => {
    const src = [
      "import a from './a';",
      "import { b, type B } from '@/lib/b';",
      "export { c } from './c';",
      "export * from './d';",
      "import './side';",
      "const e = require('./e');",
    ].join('\n');
    expect(runtimeSpecifiers(src)).toEqual(['./a', '@/lib/b', './c', './d', './side', './e']);
  });

  it('a típus-importot, a csupa-típus kapcsos importot, a dinamikus importot és a kommentet kihagyja', () => {
    const src = [
      "import type { A } from './a';",
      "export type { B } from './b';",
      "import { type C, type D } from './cd';",
      "const m = import('./lazy');",
      "// import x from './commented';",
      "/* const y = require('./block'); */",
    ].join('\n');
    expect(runtimeSpecifiers(src)).toEqual([]);
  });

  it('a stringben lévő `//` nem vágja le a sort', () => {
    expect(stripComments("const u = 'http://x'; // k")).toBe("const u = 'http://x'; ");
  });
});

describe('findCycles', () => {
  it('a 2- és 3-tagú kört megtalálja, a DAG-ot nem jelzi', () => {
    const g = new Map([
      ['a', ['b']],
      ['b', ['a', 'c']],
      ['c', ['d']],
      ['d', ['e']],
      ['e', ['c']],
      ['f', ['a']],
    ]);
    expect(findCycles(g)).toEqual([
      ['a', 'b'],
      ['c', 'd', 'e'],
    ]);
    expect(findCycles(new Map([['x', ['y']], ['y', []]]))).toEqual([]);
  });

  it('mély láncon sem fut stack-túlcsordulásba', () => {
    const g = new Map();
    for (let i = 0; i < 50000; i++) g.set(`n${i}`, [`n${i + 1}`]);
    g.set('n50000', ['n0']);
    expect(findCycles(g)[0]).toHaveLength(50001);
  });
});

describe('api-surface compact', () => {
  it('fájl- és névsorrendben, fajta:hash alakban rögzít', () => {
    const out = compact({
      'src/b.ts': { z: { kind: 'v', hash: '1', text: '' }, a: { kind: 't', hash: '2', text: '' } },
      'src/a.ts': { x: { kind: 'v', hash: '3', text: '' } },
    });
    expect(Object.keys(out)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(Object.keys(out['src/b.ts'])).toEqual(['a', 'z']);
    expect(out['src/b.ts'].a).toBe('t:2');
  });
});
