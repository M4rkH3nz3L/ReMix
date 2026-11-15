import { STRAIGHTEN_MAX, straightenZoom } from '@/lib/imageStraighten';

/* eslint-disable @typescript-eslint/no-require-imports */
const server = require('../../server/imageFilters');

describe('📐 S18: kiegyenesítés', () => {
  it('0°-nál nincs nagyítás; négyzetnél 45°-nál √2', () => {
    expect(straightenZoom(400, 300, 0)).toBe(1);
    expect(straightenZoom(100, 100, 45)).toBeCloseTo(Math.SQRT2);
    expect(straightenZoom(400, 300, -7)).toBeCloseTo(straightenZoom(400, 300, 7));
  });

  it('a doboz minden sarka az elforgatott, nagyított tartalmon belül van (üres sarok nincs)', () => {
    for (const [w, h] of [[400, 300], [300, 400], [1000, 200]]) {
      for (const deg of [1, 5, 12, 30, 45]) {
        const k = straightenZoom(w, h, deg);
        const a = (deg * Math.PI) / 180;
        for (const [x, y] of [[w / 2, h / 2], [-w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]]) {
          // a sarok a tartalom saját (elforgatott) terében
          const u = x * Math.cos(a) + y * Math.sin(a);
          const v = -x * Math.sin(a) + y * Math.cos(a);
          expect(Math.abs(u)).toBeLessThanOrEqual((k * w) / 2 + 1e-6);
          expect(Math.abs(v)).toBeLessThanOrEqual((k * h) / 2 + 1e-6);
        }
      }
    }
  });

  it('a szög korlátos; a szerver képlete ugyanaz (contract)', () => {
    expect(straightenZoom(400, 300, 80)).toBeCloseTo(straightenZoom(400, 300, STRAIGHTEN_MAX));
    for (const deg of [-30, -3.5, 0, 2, 17, 45, 60]) {
      expect(server.straightenZoom(640, 360, deg)).toBeCloseTo(straightenZoom(640, 360, deg), 10);
    }
    expect(server.straightenChain(0, 100, 100)).toBe('');
    expect(server.straightenChain(10, 100, 80)).toContain('rotate=0.174533');
  });
});
