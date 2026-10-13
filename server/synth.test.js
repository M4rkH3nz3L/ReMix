const { midiToFreq, synthNoteChains, synthFilterComplex, MAX_NOTES } = require('./synth');

describe('synth — hangjegy → frekvencia/időzítés', () => {
  test('midiToFreq: A4=440, A5=880, A3=220', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 3);
    expect(midiToFreq(81)).toBeCloseTo(880, 3);
    expect(midiToFreq(57)).toBeCloseTo(220, 3);
  });

  test('synthNoteChains: frekvencia + beat→mp időzítés (120 BPM)', () => {
    const { chains, labels, totalSec } = synthNoteChains(
      [
        { midi: 69, startBeat: 0, lengthBeats: 1 }, // A4, 0s, 0.5s
        { midi: 81, startBeat: 2, lengthBeats: 2 }, // A5, 1s, 1s
      ],
      { bpm: 120, wave: 'sine' }
    );
    expect(labels).toEqual(['n0', 'n1']);
    expect(chains[0]).toContain('frequency=440.000');
    expect(chains[0]).toContain('duration=0.500');
    expect(chains[0]).toContain('adelay=0|0');
    expect(chains[1]).toContain('frequency=880.000');
    expect(chains[1]).toContain('adelay=1000|1000'); // 2 beat @120 = 1s
    expect(totalSec).toBe(2); // (2+2)*0.5
  });

  test('synthFilterComplex: amix + limiter → [aout]', () => {
    const b = synthFilterComplex([{ midi: 60, startBeat: 0, lengthBeats: 1 }], { bpm: 120 });
    expect(b.fc).toContain('amix=inputs=1');
    expect(b.fc).toContain('alimiter');
    expect(b.fc).toContain('[aout]');
  });

  test('üres hangjegy-lista → null', () => {
    expect(synthFilterComplex([], { bpm: 120 })).toBeNull();
  });

  test('render-plafon: MAX_NOTES fölött levág', () => {
    const many = Array.from({ length: MAX_NOTES + 50 }, (_, i) => ({ midi: 60, startBeat: i, lengthBeats: 1 }));
    expect(synthNoteChains(many, { bpm: 120 }).labels.length).toBe(MAX_NOTES);
  });

  test('egyéb hullám: aevalsrc kifejezés', () => {
    const { chains } = synthNoteChains([{ midi: 69, startBeat: 0, lengthBeats: 1 }], { bpm: 120, wave: 'square' });
    expect(chains[0]).toContain('aevalsrc');
    expect(chains[0]).toContain('sgn(sin(');
  });
});
