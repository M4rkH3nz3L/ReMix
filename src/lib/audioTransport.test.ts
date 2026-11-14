import { beatGridForView, fitPxPerSec, followScrollX, nearestZoomIndex, rulerTicks, scrubTime } from '@/lib/audioTransport';
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

describe('rulerTicks (A42)', () => {
  it('egy órás projekt végén is van vonalzó, nem áll meg 180 mp-nél', () => {
    const ticks = rulerTicks(3500, 3600, 20);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[ticks.length - 1].sec).toBe(3600);
  });

  it('a kirajzolt jelek száma a látható szélességtől függ, nem a hossztól', () => {
    const visible = 1200 / 20; // 1200 px képernyő 20 px/mp-en
    expect(rulerTicks(0, visible, 20).length).toBeLessThanOrEqual(1200 / 12 + 1);
  });

  it('a lépés a zoomhoz igazodik: a jelek legalább 12, a feliratok legalább 56 px-re', () => {
    for (const pps of [2, 5, 20, 80, 300]) {
      const ticks = rulerTicks(0, 600, pps);
      expect((ticks[1].sec - ticks[0].sec) * pps).toBeGreaterThanOrEqual(12);
      const majors = ticks.filter((t) => t.major);
      if (majors.length > 1) {
        expect((majors[1].sec - majors[0].sec) * pps).toBeGreaterThanOrEqual(56);
      }
    }
  });
});

describe('beatGridForView (A42)', () => {
  it('a rács a hosszú projekt végéig megy (régen 300 vonalnál megállt)', () => {
    const lines = beatGridForView(120, 4, 3590, 3600, 40);
    expect(lines[lines.length - 1].sec).toBeCloseTo(3600, 3);
  });

  it('sűrű nagyításnál minden beat, ritkánál csak az ütem-kezdők', () => {
    const dense = beatGridForView(120, 4, 0, 4, 40); // beat = 20 px
    expect(dense.map((l) => l.sec)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(dense.filter((l) => l.downbeat).map((l) => l.sec)).toEqual([0, 2, 4]);
    const sparse = beatGridForView(120, 4, 0, 8, 4); // beat = 2 px, ütem = 8 px
    expect(sparse.every((l) => l.downbeat)).toBe(true);
    expect(sparse.map((l) => l.sec)).toEqual([0, 2, 4, 6, 8]);
  });
});

describe('illeszd / scrub / követés (PRO-AUDIO 17/2)', () => {
  it('az egy órás projekt kifér egy 1240 px-es nézetbe', () => {
    const pps = fitPxPerSec(1240, 3600);
    expect(3600 * pps).toBeCloseTo(1200, 5);
  });

  it('rövid projektnél sem nyúlik a legnagyobb nagyítás fölé, üresnél az alap', () => {
    expect(fitPxPerSec(1240, 1)).toBe(220);
    expect(fitPxPerSec(1240, 0)).toBe(56);
  });

  it('az illesztés után a nagyítás a legközelebbi lépcsőről lép', () => {
    expect(nearestZoomIndex(0.3)).toBe(0);
    expect(nearestZoomIndex(50)).toBe(3);
    expect(nearestZoomIndex(1000)).toBe(6);
  });

  it('scrub: az ujj helye → idő, a projekten belül', () => {
    expect(scrubTime(560, 56, 60)).toBeCloseTo(10, 5);
    expect(scrubTime(-20, 56, 60)).toBe(0);
    expect(scrubTime(99999, 56, 60)).toBe(60);
  });

  it('követés: a jobb szélre érve lapoz, a nézeten belül nem', () => {
    expect(followScrollX(500, 0, 1000, 5000)).toBeNull();
    expect(followScrollX(900, 0, 1000, 5000)).toBe(750);
    expect(followScrollX(100, 2000, 1000, 5000)).toBe(0);
    expect(followScrollX(4990, 0, 1000, 5000)).toBe(4000);
  });
});


// ── 🎼 S13 (MU4): tempo-map — a rács, a snap, az ugrás, a kijelzés és az ütemre vágás a tempóváltásokat követi ──
import { barsBeatsLabelT, beatGridForTiming, beatSplitTimesT, bpmAt, hasTempoChanges, nextBeatSecT, normalizeTempoMap, prevBeatSecT, projectTiming, snapSecT, tempoChangeAt, tempoMapStep, tempoMapWith, tempoMapWithout } from '@/lib/audioTransport';

describe('audioTransport — S13: tempo-map', () => {
  const p = { bpm: 120, timeSignature: { beatsPerBar: 4, beatUnit: 4 as const }, tempoMap: [{ atBeat: 8, bpm: 90 }] };

  it('normalizálás: rendezve, csak atBeat > 0, érvényes BPM (20–300), egyedi beat', () => {
    expect(normalizeTempoMap([{ atBeat: 16, bpm: 60 }, { atBeat: 0, bpm: 100 }, { atBeat: 8, bpm: 400 }, { atBeat: 8, bpm: 90 }, { atBeat: -1, bpm: 80 }])).toEqual([{ atBeat: 8, bpm: 90 }, { atBeat: 16, bpm: 60 }]);
    expect(normalizeTempoMap(undefined)).toEqual([]);
    expect(hasTempoChanges({ bpm: 120 })).toBe(false);
    expect(hasTempoChanges(p)).toBe(true);
  });

  it('projectTiming: tempóváltás nélkül = állandó tempó; váltással a 8. beat (4 s) után 90 BPM (0,6667 s/beat)', () => {
    expect(projectTiming({ bpm: 120 }).tempoMap).toEqual([{ atBeat: 0, bpm: 120 }]);
    const t = projectTiming(p);
    expect(t.tempoMap).toEqual([{ atBeat: 0, bpm: 120 }, { atBeat: 8, bpm: 90 }]);
    expect(nextBeatSecT(t, 3.9)).toBeCloseTo(4, 9);
    expect(nextBeatSecT(t, 4.1)).toBeCloseTo(4 + 60 / 90, 9);
    expect(prevBeatSecT(t, 5.5)).toBeCloseTo(4 + 2 * (60 / 90), 9);
    // 6 s = 4 s (8. beat) + 2 s @ 90 BPM = +3 beat → 11. beat = 3. ütem 4. beat
    expect(barsBeatsLabelT(t, 6)).toBe('3.4');
    expect(bpmAt(p, 3.99)).toBe(120);
    expect(bpmAt(p, 4.0)).toBe(90);
    expect(tempoChangeAt(p, 2)).toBeNull();
    expect(tempoChangeAt(p, 5)).toEqual({ atBeat: 8, bpm: 90 });
    // /8-nál a beat-egység a nyolcad: a BPM negyedre értendő → a map BPM-je is skálázva
    expect(projectTiming({ ...p, timeSignature: { beatsPerBar: 6, beatUnit: 8 } }).tempoMap[1]).toEqual({ atBeat: 8, bpm: 180 });
  });

  it('snap és rács a tempo-mapen: 4 s előtt 0,5 s-onként, utána 0,667 s-onként; ütem-egy a downbeat', () => {
    const t = projectTiming(p);
    expect(snapSecT(4.3, 'beat', 30, t)).toBeCloseTo(4, 6); // 4,0 közelebb (0,3), mint 4,667 (0,367)
    expect(snapSecT(4.4, 'beat', 30, t)).toBeCloseTo(4 + 60 / 90, 6);
    expect(snapSecT(1.3, 'beat', 30, t)).toBeCloseTo(1.5, 6);
    expect(snapSecT(1.234, 'frame', 30, t)).toBeCloseTo(1.2333, 3);
    const grid = beatGridForTiming(t, 0, 8, 100);
    const secs = grid.map((g) => g.sec);
    expect(secs.slice(0, 9)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(secs[9]).toBeCloseTo(4 + 60 / 90, 6);
    expect(grid.filter((g) => g.downbeat).map((g) => g.sec).slice(0, 3)).toEqual([0, 2, 4]);
    // ritkítás sűrű nézetben: ütemenként
    expect(beatGridForTiming(t, 0, 8, 8).every((g) => g.downbeat)).toBe(true);
  });

  it('ütemre/beatre vágás a tempo-mapen: egy 0–8 s klipen 7 beat-vonal 4 s előtt és 6 utána', () => {
    const t = projectTiming(p);
    const beats = beatSplitTimesT({ start: 0, duration: 8 }, t, 'beat');
    expect(beats.filter((x) => x < 4).length).toBe(7); // 0,5 … 3,5
    expect(beats.filter((x) => x >= 4 - 1e-9).length).toBe(6); // 4, 4,667 … 7,333
    expect(beats[7]).toBeCloseTo(4, 6);
    expect(beats[8]).toBeCloseTo(4 + 60 / 90, 6);
    const bars = beatSplitTimesT({ start: 0, duration: 8 }, t, 'bar');
    expect(bars.map((x) => Math.round(x * 1000) / 1000)).toEqual([2, 4, 6.667]);
  });

  it('tempóváltás írása/törlése a lejátszófejnél: a legközelebbi egész beatre; a 0. beat nem váltás', () => {
    expect(tempoMapWith({ bpm: 120 }, 2.1, 100)).toEqual([{ atBeat: 4, bpm: 100 }]);
    expect(tempoMapWith(p, 4.2, 80)).toEqual([{ atBeat: 8, bpm: 80 }]); // felülírja a 8. beatet
    expect(tempoMapWith(p, 0.1, 80)).toEqual([{ atBeat: 8, bpm: 90 }]); // a 0. beat: változatlan lista
    expect(tempoMapWithout(p, 6)).toEqual([]);
    expect(tempoMapWithout(p, 1)).toEqual([{ atBeat: 8, bpm: 90 }]);
  });
});

describe('audioTransport — S13: a ± a lejátszófej szakaszát lépteti', () => {
  it('tempoMapStep: a szakasz BPM-je változik, új váltás nem jön létre; az induló szakaszon null', () => {
    const p = { bpm: 120, tempoMap: [{ atBeat: 8, bpm: 90 }, { atBeat: 16, bpm: 70 }] };
    expect(tempoMapStep(p, 5, 1)).toEqual([{ atBeat: 8, bpm: 91 }, { atBeat: 16, bpm: 70 }]);
    expect(tempoMapStep(p, 20, -1)).toEqual([{ atBeat: 8, bpm: 90 }, { atBeat: 16, bpm: 69 }]);
    expect(tempoMapStep(p, 1, 1)).toBeNull();
    expect(tempoMapStep({ bpm: 120 }, 3, 1)).toBeNull();
  });
});
