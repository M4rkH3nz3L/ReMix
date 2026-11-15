import { HUM_MAX_NOTES, melodyBars, melodyFromSegments } from '@/lib/humToMelody';
import { keyFromName } from '@/lib/pitch';

describe('humToMelody — V8 dúdolásból dallam', () => {
  test('120 BPM-en a hangok tizenhatod-rácsra: kezdet és hossz beatben', () => {
    // 0,5 s = 1 beat 120 BPM-en
    const notes = melodyFromSegments(
      [
        { start: 0.02, end: 0.49, midi: 60.3 },
        { start: 0.51, end: 0.98, midi: 61.8 },
        { start: 1.13, end: 1.6, midi: 64.1 },
      ],
      { bpm: 120 }
    );
    expect(notes.map((n) => [n.midi, n.startBeat, n.lengthBeats])).toEqual([
      [60, 0, 1],
      [62, 1, 1],
      [64, 2.25, 1],
    ]);
    expect(melodyBars(notes)).toBe(1);
  });

  test('hangnemre húzás (C-dúr) és oktáv-eltolás', () => {
    const key = keyFromName('C', 'major')!;
    const notes = melodyFromSegments([{ start: 0, end: 0.5, midi: 61.2 }, { start: 0.5, end: 1, midi: 66 }], { bpm: 120, key, octave: -1 });
    expect(notes.every((n) => [0, 2, 4, 5, 7, 9, 11].includes(((n.midi % 12) + 12) % 12))).toBe(true);
    expect(notes[0].midi).toBeLessThan(60);
  });

  test('összeérő azonos hangok egybe, átfedés nincs, a tartományon kívüli kimarad; a kezdet a tartományhoz képest', () => {
    const notes = melodyFromSegments(
      [
        { start: 0.0, end: 0.24, midi: 67 },
        { start: 0.26, end: 0.5, midi: 67 },
        { start: 0.4, end: 0.9, midi: 69 },
        { start: 5, end: 6, midi: 72 },
      ],
      { bpm: 120, fromSec: 0, toSec: 2 }
    );
    expect(notes.map((n) => [n.midi, n.startBeat, n.lengthBeats])).toEqual([
      [67, 0, 0.75],
      [69, 0.75, 1],
    ]);
    const shifted = melodyFromSegments([{ start: 3, end: 3.5, midi: 60 }], { bpm: 120, fromSec: 2 });
    expect(shifted[0].startBeat).toBe(2);
    for (let i = 1; i < notes.length; i++) expect(notes[i].startBeat).toBeGreaterThanOrEqual(notes[i - 1].startBeat + notes[i - 1].lengthBeats);
  });

  test('a túl rövid hang legalább egy rácsnyi; plafon', () => {
    expect(melodyFromSegments([{ start: 0, end: 0.01, midi: 60 }], { bpm: 120 })[0].lengthBeats).toBe(0.25);
    const many = Array.from({ length: 3000 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, midi: 60 + (i % 2) }));
    expect(melodyFromSegments(many, { bpm: 120 })).toHaveLength(HUM_MAX_NOTES);
    expect(melodyBars([])).toBe(1);
  });
});
