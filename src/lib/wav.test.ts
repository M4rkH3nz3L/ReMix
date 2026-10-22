import {
  bytesToBase64,
  downmixToMono,
  encodeWavPcm16,
  floatPcmToBytes,
  makeTestTone,
  resampleLinear,
} from '@/lib/wav';

/**
 * 🎚️ WAV/PCM kódolás (local-ai Fázis A): fejléc-mezők, kvantálás, base64 — a
 * whisper.rn bemenete ezen áll.
 */

function ascii(bytes: Uint8Array, from: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(from, from + len));
}

function u32(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(off, true);
}

function u16(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(off, true);
}

describe('encodeWavPcm16', () => {
  it('RIFF/WAVE fejléc helyes mezőkkel (16 kHz, mono, 16 bit)', () => {
    const wav = encodeWavPcm16(new Float32Array(16_000));
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(u16(wav, 20)).toBe(1); // PCM
    expect(u16(wav, 22)).toBe(1); // mono
    expect(u32(wav, 24)).toBe(16_000); // mintavételi ráta
    expect(u16(wav, 34)).toBe(16); // bit-mélység
    expect(u32(wav, 40)).toBe(32_000); // adat-bájtok (16000 minta · 2)
    expect(wav.length).toBe(44 + 32_000);
    expect(u32(wav, 4)).toBe(wav.length - 8);
  });

  it('kvantálás: ±1 → ±32767, túlcsordulás vágva', () => {
    const wav = encodeWavPcm16([1, -1, 0, 2, -2], 8000);
    const view = new DataView(wav.buffer, wav.byteOffset);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(32767); // 2 → vágva
    expect(view.getInt16(52, true)).toBe(-32767); // −2 → vágva
  });
});

describe('floatPcmToBytes', () => {
  it('little-endian float32 bájtok, visszaolvasva azonos', () => {
    const src = new Float32Array([0.5, -0.25, 1]);
    const bytes = floatPcmToBytes(src);
    expect(bytes.length).toBe(12);
    const view = new DataView(bytes.buffer);
    expect(view.getFloat32(0, true)).toBeCloseTo(0.5, 6);
    expect(view.getFloat32(4, true)).toBeCloseTo(-0.25, 6);
    expect(view.getFloat32(8, true)).toBe(1);
  });
});

describe('bytesToBase64', () => {
  it('ismert vektorok (RFC 4648)', () => {
    const enc = (s: string) => bytesToBase64(Uint8Array.from(s, (c) => c.charCodeAt(0)));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });
});

describe('downmixToMono + resampleLinear', () => {
  it('két csatorna átlaga; egy csatorna változatlan referencia', () => {
    const mono = downmixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
    const single = new Float32Array([0.3]);
    expect(downmixToMono([single])).toBe(single);
  });

  it('resample: fél ráta → fele hossz, kezdőpont megtartva; azonos ráta no-op', () => {
    const src = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25]);
    const out = resampleLinear(src, 16000, 8000);
    expect(out.length).toBe(4);
    expect(out[0]).toBe(0);
    expect(resampleLinear(src, 16000, 16000)).toBe(src);
  });
});

describe('makeTestTone', () => {
  it('determinista, nem csend, −1…1 között', () => {
    const tone = makeTestTone(0.5);
    expect(tone.length).toBe(8000);
    expect(Math.max(...tone)).toBeGreaterThan(0.05);
    expect(Math.min(...tone)).toBeLessThan(-0.05);
    expect(makeTestTone(0.5)).toEqual(tone);
  });
});
