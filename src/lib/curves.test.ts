import { curveSpec, isIdentityCurve, normalizeCurve, sampleCurvePath } from '@/lib/curves';
import type { CurvePoint } from '@/types/project';

// 🎚️ Szín-görbe (RGB curves; a color grading + ffmpeg `curves` közös magja) pure pajzsa.

describe('normalizeCurve', () => {
  it('rendez, 0–1-be zár, a két szél x-ét 0-ra és 1-re rögzíti', () => {
    const out = normalizeCurve([{ x: 0.9, y: 1.2 }, { x: -0.1, y: 0.2 }, { x: 0.5, y: 0.6 }]);
    expect(out[0].x).toBe(0);
    expect(out[out.length - 1].x).toBe(1);
    expect(out.map((p) => p.x)).toEqual([...out.map((p) => p.x)].sort((a, b) => a - b)); // rendezett
    expect(out.every((p) => p.y >= 0 && p.y <= 1)).toBe(true); // 1.2 → 1-re zárva
  });
  it('<2 pont → identitás', () => {
    expect(normalizeCurve([{ x: 0.5, y: 0.5 }])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
});

describe('isIdentityCurve', () => {
  it('y=x → igaz; eltérő → hamis; hiányzó → igaz', () => {
    expect(isIdentityCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
    expect(isIdentityCurve([{ x: 0, y: 0.2 }, { x: 1, y: 1 }])).toBe(false);
    expect(isIdentityCurve(undefined)).toBe(true);
  });
});

describe('curveSpec — ffmpeg curves pont-string', () => {
  it('identitás → null (a render kihagyja)', () => {
    expect(curveSpec([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
  it('nem-identitás → "x/y x/y" 3 tizedessel', () => {
    const spec = curveSpec([{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }]);
    expect(spec).toBe('0.000/0.100 1.000/0.900');
  });
});

describe('sampleCurvePath', () => {
  it('sűrű mintasort ad 0–1-ben (a kirajzoláshoz)', () => {
    const pts: CurvePoint[] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }];
    const path = sampleCurvePath(pts, 8);
    expect(path.length).toBeGreaterThan(8);
    expect(path.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
  });
});
