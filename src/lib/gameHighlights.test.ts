import {
  buildMontage,
  detectHighlights,
  filterByMarker,
  momentsToSegments,
  type HighlightSegment,
} from '@/lib/gameHighlights';

describe('gameHighlights — detectHighlights', () => {
  it('audio-energia lokális csúcsokat talál a küszöb fölött', () => {
    // blockSec 1 → csúcs a 3. blokknál (idő 3.5)
    const energy = [0.1, 0.1, 0.1, 0.9, 0.1, 0.1, 0.1];
    const moments = detectHighlights({ duration: 7, energy, blockSec: 1 }, { minScore: 0.4 });
    expect(moments).toHaveLength(1);
    expect(moments[0].time).toBeCloseTo(3.5);
    expect(moments[0].reasons).toContain('audio');
  });

  it('a markerek (kill) erős jelöltek, indokkal', () => {
    const moments = detectHighlights({ duration: 60, markers: [{ time: 10, kind: 'kill' }] });
    expect(moments[0]).toMatchObject({ time: 10, reasons: ['kill'] });
    expect(moments[0].score).toBeCloseTo(1.0);
  });

  it('a közeli jelölteket EGY pillanattá vonja össze (pontszám-összeg, indok-unió)', () => {
    // kill @10 + jelenet-váltás @10.5 → egy klaszter, magasabb pont
    const moments = detectHighlights(
      { duration: 60, markers: [{ time: 10, kind: 'kill' }], sceneChanges: [10.5] },
      { mergeSec: 1.5 }
    );
    expect(moments).toHaveLength(1);
    expect(moments[0].reasons).toEqual(expect.arrayContaining(['kill', 'scene']));
    expect(moments[0].score).toBeCloseTo(1.3); // 1.0 + 0.3
  });

  it('a minScore alattiak kiesnek (egy magányos jelenet-váltás)', () => {
    const moments = detectHighlights({ duration: 60, sceneChanges: [5] }, { minScore: 0.5 });
    expect(moments).toHaveLength(0);
  });
});

describe('gameHighlights — momentsToSegments', () => {
  it('pre/post keretet ad és a duration-be vág', () => {
    const segs = momentsToSegments([{ time: 10, score: 1, reasons: ['kill'] }], 60, { preSec: 3, postSec: 2 });
    expect(segs[0]).toMatchObject({ start: 7, end: 12 });
  });

  it('a 0 elé és a duration mögé nem lóg túl', () => {
    const segs = momentsToSegments([{ time: 1, score: 1, reasons: ['kill'] }], 5, { preSec: 3, postSec: 10 });
    expect(segs[0]).toMatchObject({ start: 0, end: 5 });
  });

  it('az átfedő szegmenseket összevonja (pontszám-összeg)', () => {
    const segs = momentsToSegments(
      [
        { time: 10, score: 1, reasons: ['kill'] },
        { time: 12, score: 0.6, reasons: ['round'] },
      ],
      60,
      { preSec: 3, postSec: 2 }
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 7, end: 14 });
    expect(segs[0].score).toBeCloseTo(1.6);
  });
});

describe('gameHighlights — buildMontage', () => {
  const segs: HighlightSegment[] = [
    { start: 0, end: 5, score: 0.5, reasons: ['a'] },
    { start: 20, end: 25, score: 0.9, reasons: ['b'] },
    { start: 40, end: 45, score: 0.7, reasons: ['c'] },
  ];

  it('a legütősebbeket válogatja a cél-hosszig, majd IDŐREND szerint rendez', () => {
    const plan = buildMontage(segs, 10, { trimToTarget: false });
    // score-sorrend: b(0.9), c(0.7) → 10 mp; időrendben [b(20), c(40)]
    expect(plan.segments.map((s) => s.start)).toEqual([20, 40]);
    expect(plan.totalSec).toBeCloseTo(10);
  });

  it('trimToTarget az utolsó (időrendi) szegmenst a cél-hosszra vágja', () => {
    const plan = buildMontage(segs, 8, { trimToTarget: true });
    expect(plan.totalSec).toBeCloseTo(8);
    const last = plan.segments[plan.segments.length - 1];
    expect(last.end - last.start).toBeLessThan(5);
  });

  it('üres bemenetre üres montázs', () => {
    expect(buildMontage([], 30)).toEqual({ segments: [], totalSec: 0 });
  });
});

describe('gameHighlights — filterByMarker', () => {
  it('„mutasd az összes killt"', () => {
    const markers = [
      { time: 1, kind: 'kill' as const },
      { time: 2, kind: 'death' as const },
      { time: 3, kind: 'kill' as const },
    ];
    expect(filterByMarker(markers, 'kill').map((m) => m.time)).toEqual([1, 3]);
  });
});
