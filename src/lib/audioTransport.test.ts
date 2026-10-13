import {
  barsBeatsLabel,
  beatLines,
  DEFAULT_BPM,
  DEFAULT_ZOOM_INDEX,
  nextBeatSec,
  prevBeatSec,
  pxPerSecAt,
  secPerBeat,
  snapSec,
  ZOOM_LEVELS,
  zoomIn,
  zoomOut,
} from '@/lib/audioTransport';

describe('audioTransport — zenei transport-mag', () => {
  it('secPerBeat: 120 BPM → 0.5s; érvénytelen → default', () => {
    expect(secPerBeat(120)).toBe(0.5);
    expect(secPerBeat(60)).toBe(1);
    expect(secPerBeat(0)).toBe(60 / DEFAULT_BPM);
    expect(secPerBeat(undefined)).toBe(0.5);
  });

  it('barsBeatsLabel: 120 BPM, 4/4 → ütem.beat', () => {
    // 120 BPM → 0.5s/beat, 4 beat/ütem → 2s/ütem
    expect(barsBeatsLabel(120, 0)).toBe('1.1');
    expect(barsBeatsLabel(120, 0.5)).toBe('1.2');
    expect(barsBeatsLabel(120, 2)).toBe('2.1');
    expect(barsBeatsLabel(120, 2.5)).toBe('2.2');
  });

  it('snapSec: frame-re és beatre igazít, off = változatlan', () => {
    expect(snapSec(1.234, 'off', 30, 120)).toBeCloseTo(1.234, 6);
    expect(snapSec(1.02, 'frame', 30, 120)).toBeCloseTo(31 / 30, 6); // 1.0333…
    // 120 BPM: beatek 0,0.5,1,… → 0.6 → 0.5
    expect(snapSec(0.6, 'beat', 30, 120)).toBeCloseTo(0.5, 6);
    expect(snapSec(0.8, 'beat', 30, 120)).toBeCloseTo(1.0, 6);
  });

  it('nextBeatSec / prevBeatSec: 120 BPM', () => {
    expect(nextBeatSec(120, 0)).toBeCloseTo(0.5, 6);
    expect(nextBeatSec(120, 0.6)).toBeCloseTo(1.0, 6);
    expect(prevBeatSec(120, 0.6)).toBeCloseTo(0.5, 6);
    expect(prevBeatSec(120, 1.0)).toBeCloseTo(0.5, 6); // a beat elején → előző beat
    expect(prevBeatSec(120, 0)).toBe(0);
  });

  it('beatLines: a tartomány beat-időpontjai', () => {
    const lines = beatLines(120, 0, 2);
    expect(lines[0]).toBeCloseTo(0, 6);
    expect(lines).toContainEqual(expect.closeTo(0.5, 6));
    expect(lines).toContainEqual(expect.closeTo(1.5, 6));
  });

  it('zoom: szintek, clamp, px/mp', () => {
    expect(pxPerSecAt(DEFAULT_ZOOM_INDEX)).toBe(56);
    expect(zoomIn(ZOOM_LEVELS.length - 1)).toBe(ZOOM_LEVELS.length - 1); // clamp felül
    expect(zoomOut(0)).toBe(0); // clamp alul
    expect(pxPerSecAt(zoomIn(DEFAULT_ZOOM_INDEX))).toBe(88);
    expect(pxPerSecAt(zoomOut(DEFAULT_ZOOM_INDEX))).toBe(44);
  });
});
