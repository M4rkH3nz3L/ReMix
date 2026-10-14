import { beatsToTimelineLines } from '@/lib/beatMarkers';

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
