import { AHEAD_SEC, aheadSecFor, HEAVY_AHEAD_SEC, nextChunkCost } from '@/lib/engineAhead';

describe('engineAhead — költségfüggő előpuffer', () => {
  test('könnyű keverés: 0,75 s; nehéz (8 sáv ~21 ms/szelet): 1,5 s', () => {
    expect(aheadSecFor(0)).toBe(AHEAD_SEC);
    expect(aheadSecFor(5)).toBe(AHEAD_SEC);
    expect(aheadSecFor(21)).toBe(HEAVY_AHEAD_SEC);
  });

  test('a csúcs azonnal számít, a felejtés lassú: egy könnyű szelet nem kapcsol vissza', () => {
    let c = nextChunkCost(0, 21);
    expect(c).toBe(21);
    c = nextChunkCost(c, 3);
    expect(aheadSecFor(c)).toBe(HEAVY_AHEAD_SEC);
    // tartósan könnyű keverés után visszaáll (~11 szelet ≈ 1,4 s)
    for (let i = 0; i < 12; i++) c = nextChunkCost(c, 3);
    expect(aheadSecFor(c)).toBe(AHEAD_SEC);
  });
});
