import { docLimitProblem, MAX_DOC_LAYERS, MAX_DOC_POINTS } from '@/lib/imageDocLimits';
import type { ImageDoc } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const { imageDocGuard, MAX_LAYERS, MAX_TOTAL_POINTS } = require('../../server/imagedoc');

const shapes = (n: number, extra: object = {}) => ({ layers: Array.from({ length: n }, (_, i) => ({ id: `${i}`, kind: 'shape', ...extra })) }) as unknown as ImageDoc;
const points = (n: number) => Array.from({ length: n }, () => ({ x: 0, y: 0 }));

describe('dokumentum-korlátok', () => {
  it('a kliens határai egyeznek a szerverrel', () => {
    expect(MAX_DOC_LAYERS).toBe(MAX_LAYERS);
    expect(MAX_DOC_POINTS).toBe(MAX_TOTAL_POINTS);
  });

  it.each([
    ['határon a réteg', shapes(MAX_LAYERS)],
    ['túl sok réteg', shapes(MAX_LAYERS + 1)],
    ['határon a pont', shapes(1, { points: points(MAX_TOTAL_POINTS) })],
    ['túl sok pont', shapes(1, { points: points(MAX_TOTAL_POINTS + 1) })],
    ['alút-pontok', shapes(2, { subpaths: [points(MAX_TOTAL_POINTS / 2 + 1)] })],
    ['maszk-pontok', shapes(1, { mask: { ops: [{ points: points(MAX_TOTAL_POINTS + 1) }] } })],
    ['helyi korrekció maszkja', shapes(1, { localAdjust: { mask: { ops: [{ points: points(MAX_TOTAL_POINTS + 1) }] } } })],
  ])('%s: ugyanazt dönti, mint a szerver', (_name, doc) => {
    expect(docLimitProblem(doc) !== null).toBe(imageDocGuard(doc) !== null);
  });
});
