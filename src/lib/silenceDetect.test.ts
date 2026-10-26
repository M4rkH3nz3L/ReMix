import { detectSilenceRanges, windowDb } from '@/lib/silenceDetect';

/**
 * 🔇 Eszközön futó csend-felismerés (a worker FFmpeg silencedetect megfelelője):
 * hangenergia-alapú — a zene/zaj nem csend, csak a valódi csend.
 */

const SR = 16_000;

/** hang (szinusz, adott amplitúdóval) és csend szakaszok összefűzése */
function signal(parts: { sec: number; amp: number }[]): Float32Array {
  const total = parts.reduce((s, p) => s + Math.round(p.sec * SR), 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    const n = Math.round(p.sec * SR);
    for (let i = 0; i < n; i += 1) {
      out[off + i] = p.amp * Math.sin((2 * Math.PI * 220 * i) / SR);
    }
    off += n;
  }
  return out;
}

describe('windowDb', () => {
  it('teljes kitérésű szinusz ≈ -3 dBFS, néma ablak -Infinity', () => {
    const s = signal([{ sec: 0.1, amp: 1 }]);
    expect(windowDb(s, 0, s.length)).toBeCloseTo(-3.01, 1);
    expect(windowDb(new Float32Array(160), 0, 160)).toBe(-Infinity);
  });
});

describe('detectSilenceRanges', () => {
  it('beszéd → 1,2 mp csend → beszéd: egy csend-tartomány, a helyén', () => {
    const s = signal([
      { sec: 2, amp: 0.5 },
      { sec: 1.2, amp: 0 },
      { sec: 2, amp: 0.5 },
    ]);
    const r = detectSilenceRanges(s, SR);
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeCloseTo(2, 1);
    expect(r[0].end).toBeCloseTo(3.2, 1);
  });

  it('a minSilence-nél rövidebb szünet (levegővétel) NEM csend', () => {
    const s = signal([
      { sec: 1, amp: 0.5 },
      { sec: 0.3, amp: 0 },
      { sec: 1, amp: 0.5 },
    ]);
    expect(detectSilenceRanges(s, SR)).toEqual([]);
  });

  it('a halk ZENE (küszöb fölött) nem csend — csak a valódi csend vágódik', () => {
    // -30 dBFS körüli halk alap (amp 0.045 ≈ -30 dB) → a -35 dB-es küszöb fölött
    const s = signal([
      { sec: 2, amp: 0.045 },
      { sec: 1, amp: 0.0005 }, // ≈ -69 dB: csend
      { sec: 2, amp: 0.045 },
    ]);
    const r = detectSilenceRanges(s, SR);
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeCloseTo(2, 1);
  });

  it('a fájl végéig tartó csendet is lezárja (mint a worker)', () => {
    const s = signal([
      { sec: 1, amp: 0.5 },
      { sec: 1.5, amp: 0 },
    ]);
    const r = detectSilenceRanges(s, SR);
    expect(r).toHaveLength(1);
    expect(r[0].end).toBeCloseTo(2.5, 2);
  });

  it('üres bemenet → nincs csend; teljesen néma fájl → egy tartomány a hosszig', () => {
    expect(detectSilenceRanges(new Float32Array(0), SR)).toEqual([]);
    const r = detectSilenceRanges(new Float32Array(SR * 2), SR);
    expect(r).toEqual([{ start: 0, end: 2 }]);
  });

  it('paraméterezhető küszöb és minimum (a worker noise/d paramétereinek mása)', () => {
    const s = signal([
      { sec: 1, amp: 0.5 },
      { sec: 0.3, amp: 0 },
      { sec: 1, amp: 0.5 },
    ]);
    expect(detectSilenceRanges(s, SR, { minSilenceSec: 0.2 })).toHaveLength(1);
  });
});
