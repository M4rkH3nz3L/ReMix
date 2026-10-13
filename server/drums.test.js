const { stepSec, voiceSource, drumHitChains, drumFilterComplex, MAX_HITS } = require('./drums');

describe('drums — ütés → időzítés/generátor', () => {
  test('stepSec: 120 BPM → 0.125s', () => {
    expect(stepSec(120)).toBeCloseTo(0.125, 6);
    expect(stepSec(60)).toBeCloseTo(0.25, 6);
  });

  test('voiceSource: a négy hang generátora', () => {
    expect(voiceSource('kick')).toContain('aevalsrc');
    expect(voiceSource('kick')).toContain('sin(');
    expect(voiceSource('hihat')).toContain('highpass=f=8000');
    expect(voiceSource('snare')).toContain('anoisesrc');
    expect(voiceSource('clap')).toContain('bandpass');
    expect(voiceSource('nope')).toBeNull();
  });

  test('drumHitChains: lépés → késleltetés (120 BPM, 16-od)', () => {
    const { chains, labels, totalSec } = drumHitChains(
      [
        { voice: 'kick', step: 0 },
        { voice: 'kick', step: 4 }, // egy beat = 0.5s = 500ms
        { voice: 'hihat', step: 2 }, // 0.25s = 250ms
      ],
      { bpm: 120, bars: 1 }
    );
    expect(labels).toEqual(['d0', 'd1', 'd2']);
    expect(chains[0]).toContain('adelay=0|0');
    expect(chains[1]).toContain('adelay=500|500');
    expect(chains[2]).toContain('adelay=250|250');
    expect(totalSec).toBe(2); // 16 × 0.125
  });

  test('drumFilterComplex: amix + limiter → [aout]; üres → null', () => {
    const b = drumFilterComplex([{ voice: 'kick', step: 0 }], { bpm: 120, bars: 1 });
    expect(b.fc).toContain('amix=inputs=1');
    expect(b.fc).toContain('alimiter');
    expect(b.fc).toContain('[aout]');
    expect(drumFilterComplex([], { bpm: 120 })).toBeNull();
  });

  test('render-plafon: MAX_HITS fölött levág', () => {
    const many = Array.from({ length: MAX_HITS + 20 }, (_, i) => ({ voice: 'hihat', step: i }));
    expect(drumHitChains(many, { bpm: 120, bars: 40 }).labels.length).toBe(MAX_HITS);
  });
});
