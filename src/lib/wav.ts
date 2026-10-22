/**
 * 🎚️ WAV / PCM segédek — tiszta mag (local-ai Fázis A).
 *
 * A whisper.rn WAV-fájlt (vagy base64 float32 PCM-et) vár — ez a modul adja a
 * kódolást: PCM16 WAV bájtok (fejléc + adatok) és base64. Expo-mentes,
 * függőség nélküli → önmagában tesztelt; az FS-írás a hívó (`whisperClient`)
 * dolga. A dekódolás (videó/m4a → PCM) külön lépés (react-native-audio-api).
 */

/** a whisper.cpp elvárt mintavételi rátája */
export const WHISPER_SAMPLE_RATE = 16_000;

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i += 1) {
    view.setUint8(offset + i, s.charCodeAt(i));
  }
}

/**
 * Float32 PCM (−1…1) → mono PCM16 WAV bájtok (RIFF-fejléccel). A mintákat
 * [−1, 1]-re vágjuk, 16 bites little-endian egészekké kvantáljuk.
 */
export function encodeWavPcm16(
  samples: Float32Array | readonly number[],
  sampleRate: number = WHISPER_SAMPLE_RATE,
): Uint8Array {
  const n = samples.length;
  const dataBytes = n * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // fájlméret − 8
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt-chunk mérete
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte-ráta (mono · 16 bit)
  view.setUint16(32, 2, true); // blokk-igazítás
  view.setUint16(34, 16, true); // bit-mélység
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < n; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buf);
}

/** Float32 PCM → nyers little-endian float32 bájtok (whisper.rn `transcribeData`). */
export function floatPcmToBytes(samples: Float32Array | readonly number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setFloat32(i * 4, samples[i], true);
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 kódolás (saját, mert a Hermes `btoa`-ja nem garantált minden buildben). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/** Determinista teszt-hang: halk 440 Hz-es szinusz (a smoke-testhez — nem csend,
 *  hogy a dekóder tényleg dolgozzon rajta). */
export function makeTestTone(seconds = 1, sampleRate = WHISPER_SAMPLE_RATE): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return out;
}
