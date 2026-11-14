import { audioFormatLabel, readAudioFormat } from '@/lib/audioFormat';

/** 🎚️ S16: a formátum-adatok a fejlécből (WAV, AIFF, FLAC, MP3, M4A) — natív kód nélkül. */
const bytes = (...parts: (number[] | string)[]) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

describe('🎚️ hang-formátum a fejlécből', () => {
  it('WAV: 48 kHz, sztereó, 24 bit (a LIST blokk a fmt előtt is lehet)', () => {
    const fmt = [...le16(1), ...le16(2), ...le32(48000), ...le32(48000 * 6), ...le16(6), ...le16(24)];
    const b = bytes('RIFF', le32(100), 'WAVE', 'LIST', le32(4), 'INFO', 'fmt ', le32(16), fmt, 'data', le32(0));
    expect(readAudioFormat(b)).toEqual({ container: 'wav', sampleRate: 48000, channels: 2, bitDepth: 24 });
  });

  it('AIFF: 44,1 kHz, mono, 16 bit (80 bites mintavétel)', () => {
    // 44100 = 0x400E AC44 0000 0000 0000
    const rate = [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0];
    const b = bytes('FORM', be32(50), 'AIFF', 'COMM', be32(18), be16(1), be32(1000), be16(16), rate);
    expect(readAudioFormat(b)).toEqual({ container: 'aiff', sampleRate: 44100, channels: 1, bitDepth: 16 });
  });

  it('FLAC: STREAMINFO — 96 kHz, sztereó, 24 bit', () => {
    // 96000 = 0x17700 → 20 bit; csatorna-1 = 1; bitmélység-1 = 23
    const sr = 96000;
    const b0 = (sr >> 12) & 0xff, b1 = (sr >> 4) & 0xff, b2 = ((sr & 0xf) << 4) | (1 << 1) | (23 >> 4), b3 = ((23 & 0xf) << 4);
    const b = bytes('fLaC', [0x80, 0, 0, 34], new Array(10).fill(0), [b0, b1, b2, b3], new Array(20).fill(0));
    expect(readAudioFormat(b)).toEqual({ container: 'flac', sampleRate: 96000, channels: 2, bitDepth: 24 });
  });

  it('MP3: az ID3 után az első frame — MPEG1, 44,1 kHz; joint stereo → 2, mono → 1; bitmélység nincs', () => {
    const id3 = bytes('ID3', [4, 0, 0, 0, 0, 0, 10], new Array(10).fill(0));
    const frame = (mode: number) => [0xff, 0xfb, 0x90, (mode << 6) | 0x04];
    expect(readAudioFormat(new Uint8Array([...id3, ...frame(1), 0, 0]))).toEqual({ container: 'mp3', sampleRate: 44100, channels: 2 });
    expect(readAudioFormat(new Uint8Array([...frame(3), 0, 0]))).toEqual({ container: 'mp3', sampleRate: 44100, channels: 1 });
    // MPEG2 (version 2), 24 kHz index 1
    expect(readAudioFormat(new Uint8Array([0xff, 0xf3, 0x94, 0x00, 0, 0]))).toEqual({ container: 'mp3', sampleRate: 24000, channels: 2 });
  });

  it('M4A: az mp4a minta-leíró a fájl végén (moov a végén) — 48 kHz, sztereó', () => {
    const head = bytes(be32(24), 'ftyp', 'M4A ', new Array(12).fill(0));
    const mp4a = bytes(be32(36), 'mp4a', new Array(6).fill(0), be16(1), new Array(8).fill(0), be16(2), be16(16), be16(0), be16(0), be16(48000), be16(0));
    const tail = new Uint8Array([...new Array(30).fill(0), ...mp4a]);
    expect(readAudioFormat(head, tail)).toEqual({ container: 'm4a', sampleRate: 48000, channels: 2 });
    expect(readAudioFormat(head)).toEqual({ container: 'm4a' });
  });

  it('ismeretlen / sérült: üres; felirat a felületnek', () => {
    expect(readAudioFormat(new Uint8Array([1, 2, 3, 4]))).toEqual({});
    expect(audioFormatLabel({ sampleRate: 48000, channels: 2, bitDepth: 24 }, { mono: 'mono', stereo: 'sztereó', channels: (n) => `${n} csatorna` })).toBe('48 kHz · sztereó · 24 bit');
    expect(audioFormatLabel({ sampleRate: 44100, channels: 1 }, { mono: 'mono', stereo: 'sztereó', channels: (n) => `${n} csatorna` })).toBe('44.1 kHz · mono');
  });
});
