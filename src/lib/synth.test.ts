import {
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
