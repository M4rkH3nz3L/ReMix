import { borderAlignOf, shapeOutlineD, strokeJoinOf, strokeSpec } from '@/lib/shapeStroke';

/* eslint-disable @typescript-eslint/no-require-imports -- a server/ CommonJS JS-modulja (típus nélkül), a kliens–worker szerződésteszt require-rel tölti */
const server = require('../../server/shapeStroke');

const SHAPES = [
  { shape: 'rectangle' },
  { shape: 'rectangle', cornerRadius: 0.2 },
  { shape: 'rectangle', cornerRadius: 0.9 },
  { shape: 'ellipse' },
  { shape: 'star' },
  { shape: 'star', starPoints: 7, innerRadius: 0.3 },
  { shape: 'polygon', sides: 5 },
  { shape: 'arrow' },
  { shape: 'path', closed: true, points: [{ x: 0, y: 0, h2: { x: 0.5, y: -0.3 } }, { x: 1, y: 0.2 }, { x: 0.6, y: 1, h1: { x: 0.9, y: 0.9 } }] },
  { shape: 'path', subpaths: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.3, y: 0.4 }]] },
  { shape: 'path', closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  { shape: 'line' },
];

describe('🖊️ S18: körvonal-igazítás — a vászon és a szerver ugyanazt rajzolja (contract)', () => {
  it('a körvonal `d` szó szerint egyezik minden formán', () => {
    for (const s of SHAPES) {
      expect([s.shape, server.shapeOutlineD(s, 240, 160)]).toEqual([s.shape, shapeOutlineD(s, 240, 160)]);
    }
  });
  it('a vonal-szélesség, a margó, a vágás / maszk és a csatlakozás egyezik', () => {
    for (const a of ['inside', 'center', 'outside'] as const) {
      expect(server.strokeSpec(a, 6)).toEqual(strokeSpec(a, 6));
    }
    for (const s of SHAPES) expect(server.strokeJoinOf(s)).toBe(strokeJoinOf(s));
    expect(borderAlignOf('outside')).toBe('outside');
    expect(borderAlignOf('x')).toBeNull();
    expect(server.borderAlignOf('x')).toBeNull();
  });
  it('belül: dupla szélesség vágással; kívül: dupla szélesség maszkkal, a vonal szélessége a margó; középen: a fele', () => {
    expect(strokeSpec('inside', 4)).toEqual({ width: 8, pad: 0, clip: true, mask: false });
    expect(strokeSpec('outside', 4)).toEqual({ width: 8, pad: 4, clip: false, mask: true });
    expect(strokeSpec('center', 4)).toEqual({ width: 4, pad: 2, clip: false, mask: false });
  });
  it('nyitott görbe és vonal: nincs körvonal-alak', () => {
    expect(shapeOutlineD({ shape: 'line' }, 10, 10)).toBeNull();
    expect(shapeOutlineD({ shape: 'path', closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 10, 10)).toBeNull();
  });
});
