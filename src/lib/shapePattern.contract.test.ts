/**
 * 🔗 Forma-minta CONTRACT-teszt — a kliens [shapePattern](./shapePattern.ts) TS-magja
 * és a worker-render JS-tükre (`server/text-render.js`) bitre egyezik. Ha szétcsúsznak,
 * az előnézet (react-native-svg) és a beégetett kép (Chromium SVG) eltérne. Lásd a
 * [contract](./contract.test.ts) indoklást.
 */
import { shapePatternSvgDef, type ShapePattern } from './shapePattern';

// a worker sima CommonJS JS — a jest-expo babellel betölti; a `require` any-t ad
// eslint-disable-next-line @typescript-eslint/no-var-requires
const worker = require('../../server/text-render.js');

const CASES: { label: string; p: ShapePattern; boxW: number; boxH: number }[] = [
  { label: 'dots alap', p: { preset: 'dots', fg: '#ffffff', size: 8 }, boxW: 500, boxH: 500 },
  { label: 'grid forgatva', p: { preset: 'grid', fg: '#00e5ff', size: 12, rotation: 30 }, boxW: 400, boxH: 800 },
  { label: 'stripes bg+opacity', p: { preset: 'stripes', fg: '#ff0000', bg: '#000000', size: 6, opacity: 0.5 }, boxW: 600, boxH: 300 },
  { label: 'checker nagy', p: { preset: 'checker', fg: '#39d98a', size: 20 }, boxW: 1080, boxH: 1080 },
];

describe('shapePattern contract (kliens TS ⇄ worker JS)', () => {
  it('shapePatternSvgDef — a két oldal UGYANAZT az SVG-stringet adja', () => {
    for (const { label, p, boxW, boxH } of CASES) {
      const ts = shapePatternSvgDef(p, 'pid', boxW, boxH);
      const js = worker.shapePatternSvgDefJs(p, 'pid', boxW, boxH);
      expect(`${label}: ${js}`).toBe(`${label}: ${ts}`);
    }
  });

  it('patternTile — azonos csempe-méret + primitív-szám', () => {
    for (const { p, boxH } of CASES) {
      const ts = require('./shapePattern').patternTile(p, boxH);
      const js = worker.patternTileJs(p, boxH);
      expect(js.tile).toBe(ts.tile);
      expect(js.prims.length).toBe(ts.prims.length);
    }
  });

  it('isRenderableShapePattern — azonos döntés', () => {
    const probes: (ShapePattern | undefined)[] = [
      undefined,
      { preset: 'dots', fg: '#fff', size: 8 },
      { preset: 'dots', fg: '#fff', size: 0 },
      { preset: 'dots', fg: '#fff', size: 8, opacity: 0 },
    ];
    const tsFn = require('./shapePattern').isRenderableShapePattern;
    for (const p of probes) {
      expect(worker.isRenderableShapePatternJs(p)).toBe(tsFn(p));
    }
  });
});
