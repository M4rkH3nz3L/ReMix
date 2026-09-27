import {
  TICKS_PER_BEAT,
  barGridTimes,
  barToTime,
  barsBeatsToBeat,
  beatAtTime,
  beatGridTimes,
  beatToBarsBeats,
  createTiming,
  loopFromBars,
  loopWrap,
  quantizeBeat,
  quantizeTime,
  timeAtBeat,
  timingFromBeatGrid,
  type MusicTiming,
} from '@/lib/musicTime';

describe('musicTime — állandó tempó konverzió', () => {
  const t = createTiming(120); // 0.5 mp / beat

  it('timeAtBeat / beatAtTime inverz', () => {
    expect(timeAtBeat(t, 4)).toBeCloseTo(2.0);
    expect(beatAtTime(t, 2.0)).toBeCloseTo(4);
    expect(beatAtTime(t, timeAtBeat(t, 7.3))).toBeCloseTo(7.3);
  });

  it('60 BPM → 1 mp/beat', () => {
    expect(timeAtBeat(createTiming(60), 3)).toBeCloseTo(3);
  });

  it('nulla/negatív BPM → 120-ra esik vissza', () => {
    expect(timeAtBeat(createTiming(0), 2)).toBeCloseTo(1.0);
  });
});

describe('musicTime — tempo-map', () => {
  const t: MusicTiming = {
    timeSignature: { beatsPerBar: 4, beatUnit: 4 },
    tempoMap: [
      { atBeat: 0, bpm: 120 }, // 0.5 mp/beat
      { atBeat: 8, bpm: 60 }, // 1.0 mp/beat a 8. beattől
    ],
  };

  it('a szegmens-váltás után a lassabb tempóval számol', () => {
    expect(timeAtBeat(t, 8)).toBeCloseTo(4.0); // 8 * 0.5
    expect(timeAtBeat(t, 12)).toBeCloseTo(8.0); // 4.0 + 4*1.0
  });

  it('beatAtTime inverz a tempo-mapen', () => {
    expect(beatAtTime(t, 8.0)).toBeCloseTo(12);
    expect(beatAtTime(t, 4.0)).toBeCloseTo(8);
  });

  it('rendezetlen/hiányos tempo-map is normalizálódik', () => {
    const messy: MusicTiming = {
      timeSignature: { beatsPerBar: 4, beatUnit: 4 },
      tempoMap: [{ atBeat: 8, bpm: 60 }, { atBeat: 0, bpm: 120 }],
    };
    expect(timeAtBeat(messy, 12)).toBeCloseTo(8.0);
  });
});

describe('musicTime — bars/beats', () => {
  const t = createTiming(120, { beatsPerBar: 4, beatUnit: 4 });

  it('beat 4 → 2. ütem 1. beat', () => {
    expect(beatToBarsBeats(t, 4)).toEqual({ bar: 2, beat: 1, tick: 0 });
  });

  it('törtbeat → tick', () => {
    expect(beatToBarsBeats(t, 1.5)).toEqual({ bar: 1, beat: 2, tick: TICKS_PER_BEAT / 2 });
  });

  it('barsBeatsToBeat inverz', () => {
    expect(barsBeatsToBeat(t, { bar: 2, beat: 3, tick: 0 })).toBe(6);
    expect(barsBeatsToBeat(t, beatToBarsBeats(t, 9.25))).toBeCloseTo(9.25);
  });

  it('barToTime a 3/4-ben', () => {
    const w = createTiming(120, { beatsPerBar: 3, beatUnit: 4 });
    expect(barToTime(w, 2)).toBeCloseTo(1.5); // 3 beat * 0.5
  });
});

describe('musicTime — rács', () => {
  const t = createTiming(120); // beat 0.5 mp

  it('beatGridTimes beat-felbontásban', () => {
    expect(beatGridTimes(t, 0, 2)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it('beatGridTimes nyolcad-felbontásban sűrűbb', () => {
    expect(beatGridTimes(t, 0, 1, 2)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('barGridTimes az ütem-kezdeteket adja', () => {
    expect(barGridTimes(t, 0, 4)).toEqual([0, 2, 4]); // 4/4 @120 → 2 mp/ütem
  });
});

describe('musicTime — quantize', () => {
  it('a legközelebbi rács-pozícióra húz (full strength)', () => {
    expect(quantizeBeat(0.6, { subdivision: 1 })).toBeCloseTo(1);
    expect(quantizeBeat(0.4, { subdivision: 1 })).toBeCloseTo(0);
  });

  it('strength részleges elmozdulást ad', () => {
    expect(quantizeBeat(0.6, { subdivision: 1, strength: 0.5 })).toBeCloseTo(0.8); // 0.6 + (1-0.6)*0.5
  });

  it('swing a páratlan pozíciókat késlelteti, a párosakat nem', () => {
    // nyolcad-rács: index 1 (0.5 beat) páratlan → swing késlelteti
    expect(quantizeBeat(0.5, { subdivision: 2, swing: 1 })).toBeCloseTo(0.75); // 0.5 + 1*0.5*0.5
    expect(quantizeBeat(1.0, { subdivision: 2, swing: 1 })).toBeCloseTo(1.0); // index 2 páros → nincs swing
  });

  it('quantizeTime beat-térben számol, majd mp-re vált', () => {
    const t = createTiming(120); // 0.5 mp/beat
    expect(quantizeTime(t, 0.28, { subdivision: 1 })).toBeCloseTo(0.5); // 0.56 beat → 1 beat → 0.5 mp
  });
});

describe('musicTime — loop', () => {
  const t = createTiming(120, { beatsPerBar: 4, beatUnit: 4 }); // 2 mp/ütem

  it('loopFromBars a megadott ütem-tartományt adja', () => {
    expect(loopFromBars(t, 1, 2)).toEqual({ startSec: 0, endSec: 4, enabled: true });
  });

  it('loopWrap a loopon belülre képezi a pozíciót', () => {
    const loop = { startSec: 2, endSec: 4, enabled: true }; // 2 mp hossz
    expect(loopWrap(loop, 5)).toBeCloseTo(3); // 2 + (5-2)%2 = 3
    expect(loopWrap(loop, 1)).toBe(1); // loop előtt → változatlan
  });

  it('kikapcsolt loop nem módosít', () => {
    expect(loopWrap({ startSec: 2, endSec: 4, enabled: false }, 5)).toBe(5);
  });
});

describe('musicTime — BeatGrid bridge', () => {
  it('a detektált BPM-ből állandó-tempójú timing', () => {
    const t = timingFromBeatGrid({ bpm: 90 });
    expect(timeAtBeat(t, 1)).toBeCloseTo(60 / 90);
  });
  it('0 BPM → 120 fallback', () => {
    expect(timeAtBeat(timingFromBeatGrid({ bpm: 0 }), 2)).toBeCloseTo(1.0);
  });
});
