import {
  centsBetween,
  diatonicStep,
  freqToMidi,
  harmonize,
  harmonyLine,
  keyFromName,
  midiToFreq,
  midiToNoteName,
  noteNameToMidi,
  pitchCorrectionPlan,
  scaleMidiSequence,
  snapMidiToScale,
  type MusicKey,
} from '@/lib/pitch';

const C_MAJOR: MusicKey = { root: 0, scale: 'major' };
const A_MINOR: MusicKey = { root: 9, scale: 'naturalMinor' };

describe('pitch — konverziók', () => {
  it('A4 = 440 Hz = MIDI 69', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(freqToMidi(440)).toBeCloseTo(69);
  });
  it('egy oktáv = duplázás', () => {
    expect(midiToFreq(81)).toBeCloseTo(880);
  });
  it('unvoiced (hz<=0) → -Infinity', () => {
    expect(freqToMidi(0)).toBe(-Infinity);
  });
  it('MIDI → hangnév (C4=60, A4=69)', () => {
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(69)).toBe('A4');
    expect(midiToNoteName(61)).toBe('C#4');
  });
  it('hangnév → MIDI (# és b is)', () => {
    expect(noteNameToMidi('A4')).toBe(69);
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('Db4')).toBe(61);
    expect(noteNameToMidi('xyz')).toBeNull();
  });
  it('centsBetween: félhang = 100 cent', () => {
    expect(centsBetween(midiToFreq(60), midiToFreq(61))).toBeCloseTo(100);
  });
});

describe('pitch — skálák', () => {
  it('keyFromName A natural minor → root 9', () => {
    expect(keyFromName('A', 'naturalMinor')).toEqual({ root: 9, scale: 'naturalMinor' });
  });

  it('scaleMidiSequence C-dúr csak fehér billentyűket ad', () => {
    const seq = scaleMidiSequence(C_MAJOR).filter((m) => m >= 60 && m <= 72);
    expect(seq).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('snapMidiToScale a legközelebbi skálahangra húz', () => {
    // C# (61) C-dúrban → C (60) a legközelebbi (döntetlennél lefelé)
    expect(snapMidiToScale(61, C_MAJOR)).toBe(60);
    expect(snapMidiToScale(60.4, C_MAJOR)).toBe(60);
    expect(snapMidiToScale(63.6, C_MAJOR)).toBe(64); // közel E-hez
  });
});

describe('pitch — pitchCorrectionPlan (auto-tune)', () => {
  it('teljes strength a skála-hangra húz', () => {
    const hz = midiToFreq(60.5); // félúton C és C# közt
    const [pt] = pitchCorrectionPlan([{ time: 0, hz }], C_MAJOR, { strength: 1 });
    expect(pt.targetHz).toBeCloseTo(midiToFreq(60), 1);
    expect(pt.correctedHz).toBeCloseTo(midiToFreq(60), 1);
  });

  it('strength 0 nem mozdít', () => {
    const hz = midiToFreq(60.5);
    const [pt] = pitchCorrectionPlan([{ time: 0, hz }], C_MAJOR, { strength: 0 });
    expect(pt.correctedHz).toBeCloseTo(hz, 1);
    expect(pt.shiftCents).toBeCloseTo(0, 0);
  });

  it('félút strength ~fél elmozdulás (cent)', () => {
    const hz = midiToFreq(60.5); // 50 cent a C fölött
    const [pt] = pitchCorrectionPlan([{ time: 0, hz }], C_MAJOR, { strength: 0.5 });
    // fele a -50 centnek ≈ -25 cent
    expect(pt.shiftCents).toBeCloseTo(-25, 0);
  });

  it('unvoiced pont változatlanul átmegy', () => {
    const [pt] = pitchCorrectionPlan([{ time: 1, hz: 0 }], C_MAJOR);
    expect(pt).toMatchObject({ hz: 0, correctedHz: 0, targetHz: 0, shiftCents: 0 });
  });
});

describe('pitch — diatonikus harmónia', () => {
  it('diatonicStep +2 = terc (C→E a C-dúrban)', () => {
    expect(diatonicStep(60, 2, C_MAJOR)).toBe(64); // C4 → E4
  });
  it('+4 = kvint (C→G)', () => {
    expect(harmonize(60, C_MAJOR, 4)).toBe(67); // C4 → G4
  });
  it('+7 = oktáv (7-fokú skálán)', () => {
    expect(harmonize(60, C_MAJOR, 7)).toBe(72);
  });
  it('lefelé is (-2)', () => {
    expect(harmonize(64, C_MAJOR, -2)).toBe(60); // E4 → C4
  });
  it('A-mollban a terc C→E marad diatonikus', () => {
    expect(harmonize(noteNameToMidi('A3')!, A_MINOR, 2)).toBe(noteNameToMidi('C4'));
  });

  it('harmonyLine az unvoiced pontokat átengedi', () => {
    const line = harmonyLine([{ time: 0, hz: midiToFreq(60) }, { time: 1, hz: 0 }], C_MAJOR, 2);
    expect(line[0].hz).toBeCloseTo(midiToFreq(64), 0); // terc
    expect(line[1].hz).toBe(0);
  });
});
