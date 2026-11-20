// 💾 WAV-kódolás: fejlécek és PCM-minták (16/24 bit, 32 bites lebegőpontos)

/**
 * 32 bites lebegőpontos WAV fejléc (WAVE_FORMAT_IEEE_FLOAT) — a Pro szerveres export
 * köztes keveréke: veszteségmentes, a 24 bites kimenethez is (nincs 16 bites kerekítés).
 */
export function wavHeaderF32(frames: number, channels: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  const data = frames * channels * 4;
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  return bytes;
}

/** összefésült (interleaved) 32 bites lebegőpontos minták */
export function pcmF32(channels: Float32Array[]): Uint8Array {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const out = new Float32Array(n * ch);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) out[i * ch + c] = channels[c][i];
  }
  return new Uint8Array(out.buffer);
}

/** 16 bites PCM WAV fejléc (`frames` minta csatornánként). */
export function wavHeader16(frames: number, channels: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  const data = frames * channels * 2;
  text(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, data, true);
  return bytes;
}

/** 24 bites PCM WAV fejléc */
export function wavHeader24(frames: number, channels: number, sampleRate: number): Uint8Array {
  const bytes = wavHeader16(frames, channels, sampleRate);
  const view = new DataView(bytes.buffer);
  const data = frames * channels * 3;
  view.setUint32(4, 36 + data, true);
  view.setUint32(28, sampleRate * channels * 3, true);
  view.setUint16(32, channels * 3, true);
  view.setUint16(34, 24, true);
  view.setUint32(40, data, true);
  return bytes;
}

/** a lebegőpontos minták 24 bites PCM-ként (a kvantálási zaj −144 dB: dither nélkül) */
export function pcm24(channels: Float32Array[]): Uint8Array {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const bytes = new Uint8Array(n * ch * 3);
  let at = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-8388608, Math.min(8388607, Math.round(channels[c][i] * 8388607)));
      bytes[at] = v & 0xff;
      bytes[at + 1] = (v >> 8) & 0xff;
      bytes[at + 2] = (v >> 16) & 0xff;
      at += 3;
    }
  }
  return bytes;
}

/**
 * A lebegőpontos minták 16 bites PCM-ként, TPDF-ditherrel (mint a szerveres WAV-export).
 * Darabonként hívható; a `rand` cserélhető (teszthez determinisztikus).
 */
export function pcm16(channels: Float32Array[], rand: () => number = Math.random): Uint8Array {
  const n = channels[0]?.length ?? 0;
  const ch = channels.length;
  const bytes = new Uint8Array(n * ch * 2);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const dither = (rand() - rand()) / 32768;
      const v = Math.round((channels[c][i] + dither) * 32767);
      view.setInt16(at, Math.max(-32768, Math.min(32767, v)), true);
      at += 2;
    }
  }
  return bytes;
}

/** Teljes WAV egyben (rövid mixhez és teszthez). */
export function encodeWav16(channels: Float32Array[], sampleRate: number, rand: () => number = Math.random): Uint8Array {
  const head = wavHeader16(channels[0]?.length ?? 0, channels.length, sampleRate);
  const body = pcm16(channels, rand);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}
