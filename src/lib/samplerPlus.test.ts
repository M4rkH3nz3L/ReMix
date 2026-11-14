import { detectSlices, emptyPads, midiName, renderPadsPcm, renderSamplerNotesPcm, resizePads } from '@/lib/samplerPlus';

/** 🎛️ V2.3: Sampler 2.0 — kromatikus játék, szeletelés tranziensre, 4 pad. */
const SR = 44100;
const sine = (hz: number, sec: number, amp = 0.5) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const freqOf = (x: Float32Array, from: number, to: number) => {
  let zc = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) zc++;
  return (zc * SR) / (to - from);
};

describe('🎛️ Sampler 2.0', () => {
  const a440 = sine(440, 1);

  it('az alaphangon a minta változatlanul szól; egy oktávval feljebb 880 Hz és fele olyan hosszú', () => {
    const [l] = renderSamplerNotesPcm([a440], [{ id: 'a', midi: 69, startBeat: 0, lengthBeats: 4, velocity: 127 }], 69, 120);
    let d = 0;
    for (let i = 200; i < 40000; i++) d = Math.max(d, Math.abs(l[i] - a440[i]));
    expect(d).toBeLessThan(1e-6);
    const [h] = renderSamplerNotesPcm([a440], [{ id: 'b', midi: 81, startBeat: 0, lengthBeats: 4, velocity: 127 }], 69, 120);
    expect(freqOf(h, 1000, 20000)).toBeCloseTo(880, -1);
    // a minta 1 s → oktávval feljebb 0,5 s (+10 ms lecsengés)
    expect(h.length).toBeLessThanOrEqual(Math.round(0.5 * SR) + Math.round(0.01 * SR) + 1);
    expect(h.length).toBeGreaterThan(Math.round(0.49 * SR));
  });

  it('kvint lefelé (−7) ≈ 293,7 Hz; a hangjegy a beat-időpontjánál kezdődik', () => {
    const [l] = renderSamplerNotesPcm([a440], [{ id: 'c', midi: 62, startBeat: 1, lengthBeats: 1, velocity: 127 }], 69, 120);
    let first = 0;
    while (first < l.length && Math.abs(l[first]) < 1e-4) first++;
    expect(Math.abs(first - 0.5 * SR)).toBeLessThan(40);
    expect(freqOf(l, Math.round(0.6 * SR), Math.round(0.9 * SR))).toBeCloseTo(440 * Math.pow(2, -7 / 12), -1);
  });

  it('a szeletelés a négy ütés kezdetét találja (± 1 ablak)', () => {
    const x = new Float32Array(SR);
    for (const at of [0, 0.25, 0.5, 0.75]) {
      for (let i = 0; i < 0.08 * SR; i++) x[Math.round(at * SR) + i] = 0.7 * Math.exp(-i / 800) * Math.sin(i / 3);
    }
    const s = detectSlices([x]);
    expect(s.length).toBe(4);
    [0, 0.25, 0.5, 0.75].forEach((at, k) => expect(Math.abs(s[k] - at * SR)).toBeLessThanOrEqual(441));
  });

  it('a padek a lépéseiken a saját szeletüket játsszák; a rács méretezhető', () => {
    const x = new Float32Array(SR);
    x.fill(0.2, 0, 22050);
    x.fill(-0.4, 22050);
    const pads = emptyPads(1);
    pads[0][0] = true;
    pads[1][8] = true;
    const [l] = renderPadsPcm([x], [0, 22050], pads, 1, 120);
    expect(l[1000]).toBeCloseTo(0.2, 5);
    expect(l[Math.round(8 * 0.125 * SR) + 1000]).toBeCloseTo(-0.4, 5);
    expect(l.length).toBe(Math.round(16 * 0.125 * SR));
    expect(resizePads(pads, 2)[1].length).toBe(32);
    expect(resizePads(pads, 2)[1][8]).toBe(true);
    expect(midiName(60)).toBe('C4');
  });
});
