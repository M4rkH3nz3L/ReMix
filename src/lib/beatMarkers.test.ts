import { beatLinesForClips, beatsToTimelineLines } from '@/lib/beatMarkers';

describe('beatMarkers — detektált beatek → idővonal-vonalak', () => {
  it('klip-offset + frame-snap (30 fps)', () => {
    // forrás-beatek 0, 0.5, 1.0; a klip a 2s-nél kezdődik → 2.0, 2.5, 3.0
    expect(beatsToTimelineLines([0, 0.5, 1.0], 2, 30)).toEqual([2, 2.5, 3]);
  });

  it('frame-rácsra illeszt (nem rács-pontos beat)', () => {
    // 0.333s @30fps → 10/30 = 0.3333… ; a snap a legközelebbi frame-re visz
    const [t] = beatsToTimelineLines([0.333], 0, 30);
    expect(t).toBeCloseTo(Math.round(0.333 * 30) / 30, 6);
  });

  it('növekvő + duplikátum-mentes (a snap után egybeesők kiesnek)', () => {
    // két közeli beat ugyanarra a frame-re esik → egy vonal
    const lines = beatsToTimelineLines([0.5, 0.51], 0, 30);
    expect(lines).toEqual([0.5]);
  });

  it('negatív/érvénytelen beat kiszűrve', () => {
    expect(beatsToTimelineLines([-0.1, 0.5, NaN], 0, 30)).toEqual([0.5]);
  });

  it('üres bemenet → üres', () => {
    expect(beatsToTimelineLines([], 1, 30)).toEqual([]);
  });

  it('fps hiányában 30-cal számol', () => {
    expect(beatsToTimelineLines([1], 0, 0)).toEqual([1]);
  });
});

describe('beatMarkers — a vonalak a klip aktuális helyét követik (A5)', () => {
  const clip = (start: number, duration: number, trimIn?: number) => ({ start, duration, trimIn });

  it('a bal-vágás eltolja a vonalakat, a levágott beat eltűnik', () => {
    expect(beatLinesForClips([1, 2, 3, 4], [clip(10, 3, 2)], 30)).toEqual([10, 11, 12]);
  });

  it('a klip mozgatása után a vonalak is mozognak', () => {
    expect(beatLinesForClips([1, 2], [clip(0, 5)], 30)).toEqual([1, 2]);
    expect(beatLinesForClips([1, 2], [clip(4, 5)], 30)).toEqual([5, 6]);
  });

  it('split után mindkét fél vonalai megmaradnak, a klip vége után nincs vonal', () => {
    const left = clip(0, 2);
    const right = clip(2, 2, 2);
    expect(beatLinesForClips([1, 3, 9], [left, right], 30)).toEqual([1, 3]);
  });

  it('több klip vonalai időrendben, duplikátum nélkül', () => {
    expect(beatLinesForClips([1], [clip(5, 2), clip(0, 2), clip(0, 2)], 30)).toEqual([1, 6]);
  });

  it('nincs klip → nincs vonal', () => {
    expect(beatLinesForClips([1, 2], [], 30)).toEqual([]);
  });
});
