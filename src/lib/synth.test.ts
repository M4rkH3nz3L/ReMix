import {
  cycleNoteVelocity,
  DEFAULT_HIGH_MIDI,
  DEFAULT_LOW_MIDI,
  isBlackKey,
  isEmpty,
  noteAt,
  noteDurationSec,
  noteEndSec,
  noteFreq,
  noteStartSec,
  pitchRows,
  removeNote,
  synthDurationSec,
  toggleNote,
  type SynthNote,
} from '@/lib/synth';
import { renderSynthPcm } from '@/lib/instrumentRender';

let idc = 0;
const mkId = () => `n${idc++}`;
const note = (midi: number, startBeat: number, lengthBeats = 1): SynthNote =>
  ({ id: `${midi}-${startBeat}`, midi, startBeat, lengthBeats, velocity: 100 });

describe('synth — piano-roll mag', () => {
  it('pitchRows: magas→mély, teljes tartomány', () => {
    const rows = pitchRows();
    expect(rows[0]).toBe(DEFAULT_HIGH_MIDI);
    expect(rows[rows.length - 1]).toBe(DEFAULT_LOW_MIDI);
    expect(rows).toHaveLength(DEFAULT_HIGH_MIDI - DEFAULT_LOW_MIDI + 1);
  });

  it('isBlackKey: C#/D#/F#/G#/A#', () => {
    expect(isBlackKey(61)).toBe(true); // C#4
    expect(isBlackKey(60)).toBe(false); // C4
    expect(isBlackKey(69)).toBe(false); // A4
    expect(isBlackKey(70)).toBe(true); // A#4
  });

  it('noteFreq: A4=440, A5=880 (pitch.midiToFreq)', () => {
    expect(noteFreq(69)).toBeCloseTo(440, 3);
    expect(noteFreq(81)).toBeCloseTo(880, 3);
    expect(noteFreq(57)).toBeCloseTo(220, 3);
  });

  it('időzítés 120 BPM: 1 beat = 0.5s', () => {
    const n = note(60, 2, 1);
    expect(noteStartSec(n, 120)).toBe(1); // 2 beat
    expect(noteDurationSec(n, 120)).toBe(0.5);
    expect(noteEndSec(n, 120)).toBe(1.5);
  });

  it('synthDurationSec: a legkésőbbi hang vége', () => {
    expect(synthDurationSec([note(60, 0, 1), note(64, 3, 2)], 120)).toBe(2.5); // (3+2)*0.5
    expect(synthDurationSec([], 120)).toBe(0);
  });

  it('toggleNote: add üresre, toggle-off ha már ott van', () => {
    let notes: SynthNote[] = [];
    notes = toggleNote(notes, 60, 0, mkId);
    expect(notes).toHaveLength(1);
    expect(noteAt(notes, 60, 0)).toBeDefined();
    notes = toggleNote(notes, 60, 0, mkId); // ugyanaz a cella → törlés
    expect(notes).toHaveLength(0);
  });

  it('removeNote + isEmpty', () => {
    const notes = [note(60, 0), note(64, 1)];
    const n0 = notes[0].id;
    expect(removeNote(notes, n0)).toHaveLength(1);
    expect(isEmpty([])).toBe(true);
    expect(isEmpty(notes)).toBe(false);
  });
});

describe('🎹 velocity (R7)', () => {
  it('a hang erőssége hosszan nyomva: közepes → erős → halk → közepes; csak az a hang', () => {
    const notes = [
      { id: 'a', midi: 60, startBeat: 0, lengthBeats: 1 },
      { id: 'b', midi: 62, startBeat: 1, lengthBeats: 1, velocity: 100 },
    ];
    const v1 = cycleNoteVelocity(notes, 'a');
    expect(v1[0].velocity).toBe(127);
    expect(v1[1]).toBe(notes[1]);
    expect(cycleNoteVelocity(v1, 'a')[0].velocity).toBe(50);
    expect(cycleNoteVelocity(cycleNoteVelocity(v1, 'a'), 'a')[0].velocity).toBe(100);
    expect(toggleNote([], 60, 0, () => 'x', 1, 50)[0].velocity).toBe(50);
  });
  it('mérve: a csúcsszint a velocity-vel arányos (a hang közepén)', () => {
    const pk = (velocity: number) => renderSynthPcm([{ id: 'a', midi: 69, startBeat: 0, lengthBeats: 1, velocity }], 'sine', 120)[0].subarray(2000, 18000).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(pk(50) / pk(127)).toBeCloseTo(50 / 127, 2);
    expect(pk(100) / pk(127)).toBeCloseTo(100 / 127, 2);
  });
});

// ── 🎹 S11 (MU2): hanghossz koppintással, rács-felbontás, skála, oktáv ──────────────────────────
import { inScale, noteCovering, OCTAVE_MAX_MIDI, OCTAVE_MIN_MIDI, shiftOctave, STEP_GRIDS, stepBeats, tapCell } from '@/lib/synth';

describe('synth — S11: hanghossz koppintással, rács, skála, oktáv', () => {
  it('rácsok: negyed, nyolcad, tizenhatod, triola — a lépés ütemben', () => {
    expect(STEP_GRIDS).toEqual([1, 2, 4, 3]);
    expect(stepBeats(1)).toBe(1);
    expect(stepBeats(4)).toBe(0.25);
    expect(stepBeats(3)).toBeCloseTo(1 / 3, 9);
  });

  it('koppintás: új hang egy lépés hosszan; a vége után koppintva hosszabbodik; belül rövidül; a kezdetén törlődik', () => {
    let n: SynthNote[] = [];
    n = tapCell(n, 60, 0, 4, mkId, 100);
    expect(n).toEqual([{ id: expect.any(String), midi: 60, startBeat: 0, lengthBeats: 0.25, velocity: 100 }]);
    n = tapCell(n, 60, 0.25, 4, mkId); // a vége utáni cella → +1 lépés
    n = tapCell(n, 60, 0.5, 4, mkId);
    n = tapCell(n, 60, 0.75, 4, mkId);
    expect(n[0].lengthBeats).toBeCloseTo(1, 9);
    n = tapCell(n, 60, 0.5, 4, mkId); // belül → itt végződik
    expect(n[0].lengthBeats).toBeCloseTo(0.5, 9);
    expect(noteCovering(n, 60, 0.3)?.id).toBe(n[0].id);
    expect(noteCovering(n, 60, 0.5)).toBeUndefined();
    // más sor nem érintett; új hang a következő negyeden
    n = tapCell(n, 64, 1, 4, mkId, 127);
    expect(n).toHaveLength(2);
    expect(n[1]).toMatchObject({ midi: 64, startBeat: 1, lengthBeats: 0.25, velocity: 127 });
    n = tapCell(n, 60, 0, 4, mkId); // a kezdő cella → törlés
    expect(n.map((x) => x.midi)).toEqual([64]);
    // triola-rácson a lépés 1/3
    const tri = tapCell([], 62, 1 / 3, 3, mkId);
    expect(tri[0].lengthBeats).toBeCloseTo(1 / 3, 9);
  });

  it('skála: a kulcs nélkül minden hang „benne van"; C-dúrban a C# nincs; a pentaton szűkebb', () => {
    expect(inScale(61, null)).toBe(true);
    expect(inScale(60, { root: 0, scale: 'major' })).toBe(true);
    expect(inScale(61, { root: 0, scale: 'major' })).toBe(false);
    expect(inScale(65, { root: 0, scale: 'pentatonicMajor' })).toBe(false); // F nincs a C dúr pentatonban
    expect(inScale(69, { root: 9, scale: 'naturalMinor' })).toBe(true);
  });

  it('oktáv-görgetés: az ablak hossza marad, a határ C1…C7', () => {
    expect(shiftOctave(48, 84, 1)).toEqual({ lowMidi: 60, highMidi: 96 });
    expect(shiftOctave(60, 96, 1)).toEqual({ lowMidi: 60, highMidi: 96 }); // a tetőn marad
    expect(shiftOctave(48, 84, -1)).toEqual({ lowMidi: 36, highMidi: 72 });
    expect(shiftOctave(36, 72, -1)).toEqual({ lowMidi: OCTAVE_MIN_MIDI, highMidi: 60 });
    expect(OCTAVE_MAX_MIDI - OCTAVE_MIN_MIDI).toBe(72);
  });
});
