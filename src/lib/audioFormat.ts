/**
 * 🎚️ Hang-fájl formátum-adatai a fejlécből (AUDIO-PROD S16) — pure, expo-mentes. Mintavétel, csatornák,
 * bitmélység a fájl elejéből/végéből (natív kód és teljes dekódolás nélkül): WAV (`fmt `), AIFF (`COMM`),
 * FLAC (STREAMINFO), MP3 (az első érvényes frame-fejléc), M4A/MP4 (`mp4a` minta-leíró — a `moov` a fájl
 * elején VAGY végén lehet, ezért a vég is). Ismeretlen / sérült → üres objektum (a hívó nem mutat semmit).
 */

export interface AudioFormatInfo {
  container?: 'wav' | 'aiff' | 'flac' | 'mp3' | 'm4a';
  sampleRate?: number;
  channels?: number;
  /** csak a veszteségmentes formátumoknál (PCM / FLAC) — a tömörítettnél nincs értelme */
  bitDepth?: number;
}

const ascii = (b: Uint8Array, at: number, n: number): string => {
  let s = '';
  for (let i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]);
  return s;
};
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** IEEE 754 80 bites kiterjesztett (az AIFF mintavétele) → szám */
function ext80(b: Uint8Array, at: number): number {
  const exp = ((b[at] & 0x7f) << 8) | b[at + 1];
  let mant = 0;
  for (let i = 0; i < 8; i++) mant = mant * 256 + b[at + 2 + i];
  if (exp === 0 && mant === 0) return 0;
  return mant * Math.pow(2, exp - 16383 - 63);
}

const ok = (sr?: number, ch?: number) => !!sr && sr >= 4000 && sr <= 768000 && !!ch && ch >= 1 && ch <= 32;

function wav(b: Uint8Array): AudioFormatInfo | null {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = ascii(b, at, 4);
    const size = u32le(b, at + 4);
    if (id === 'fmt ' && at + 24 <= b.length) {
      const channels = u16le(b, at + 10);
      const sampleRate = u32le(b, at + 12);
      const bitDepth = u16le(b, at + 22);
      return ok(sampleRate, channels) ? { container: 'wav', sampleRate, channels, bitDepth } : { container: 'wav' };
    }
    at += 8 + size + (size & 1);
  }
  return { container: 'wav' };
}

function aiff(b: Uint8Array): AudioFormatInfo | null {
  if (ascii(b, 0, 4) !== 'FORM' || !/^AIF[FC]$/.test(ascii(b, 8, 4))) return null;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = ascii(b, at, 4);
    const size = u32be(b, at + 4);
    if (id === 'COMM' && at + 26 <= b.length) {
      const channels = u16be(b, at + 8);
      const bitDepth = u16be(b, at + 14);
      const sampleRate = Math.round(ext80(b, at + 16));
      return ok(sampleRate, channels) ? { container: 'aiff', sampleRate, channels, bitDepth } : { container: 'aiff' };
    }
    at += 8 + size + (size & 1);
  }
  return { container: 'aiff' };
}

function flac(b: Uint8Array): AudioFormatInfo | null {
  if (ascii(b, 0, 4) !== 'fLaC' || b.length < 8 + 34) return null;
  // az első metaadat-blokk a STREAMINFO (típus 0): 20 bit mintavétel, 3 bit csatorna-1, 5 bit bitmélység-1
  if ((b[4] & 0x7f) !== 0) return { container: 'flac' };
  const p = 8 + 10;
  const sampleRate = (b[p] << 12) | (b[p + 1] << 4) | (b[p + 2] >> 4);
  const channels = ((b[p + 2] >> 1) & 0x07) + 1;
  const bitDepth = (((b[p + 2] & 0x01) << 4) | (b[p + 3] >> 4)) + 1;
  return ok(sampleRate, channels) ? { container: 'flac', sampleRate, channels, bitDepth } : { container: 'flac' };
}

const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function mp3(b: Uint8Array): AudioFormatInfo | null {
  let at = 0;
  // ID3v2 átugrása (szinkron-biztos méret)
  if (ascii(b, 0, 3) === 'ID3' && b.length > 10) {
    at = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  const looksMp3 = ascii(b, 0, 3) === 'ID3';
  for (let i = at; i + 4 <= b.length && i < at + 64 * 1024; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (b[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[i + 1] >> 1) & 0x03;
    const rateIdx = (b[i + 2] >> 2) & 0x03;
    const bitrateIdx = b[i + 2] >> 4;
    if (version === 1 || layer === 0 || rateIdx === 3 || bitrateIdx === 0 || bitrateIdx === 15) continue;
    const sampleRate = MP3_RATES[version][rateIdx];
    const channels = ((b[i + 3] >> 6) & 0x03) === 3 ? 1 : 2;
    return { container: 'mp3', sampleRate, channels };
  }
  return looksMp3 ? { container: 'mp3' } : null;
}

/** az `mp4a` minta-leíró (a `stsd` dobozban): csatorna a 24., mintavétel a 32. bájton (16.16 fixpontos) */
function mp4a(b: Uint8Array): AudioFormatInfo | null {
  for (let i = 4; i + 32 <= b.length; i++) {
    if (b[i] !== 0x6d || ascii(b, i, 4) !== 'mp4a') continue;
    const box = i - 4;
    const channels = u16be(b, box + 24);
    const sampleRate = u16be(b, box + 32);
    if (ok(sampleRate, channels)) return { container: 'm4a', sampleRate, channels };
  }
  return null;
}

/**
 * A formátum-adatok a fájl elejéből (`head`) és végéből (`tail`). Ismeretlen formátum → `{}`.
 */
export function readAudioFormat(head: Uint8Array, tail: Uint8Array = new Uint8Array(0)): AudioFormatInfo {
  const direct = wav(head) ?? aiff(head) ?? flac(head);
  if (direct) return direct;
  const isMp4 = ascii(head, 4, 4) === 'ftyp';
  if (isMp4) return mp4a(head) ?? mp4a(tail) ?? { container: 'm4a' };
  return mp3(head) ?? {};
}

/** rövid felirat a felületnek, pl. „48 kHz · sztereó · 24 bit” (a csatorna-szó a hívó fordítása) */
export function audioFormatLabel(f: AudioFormatInfo, words: { mono: string; stereo: string; channels: (n: number) => string }): string {
  const parts: string[] = [];
  if (f.sampleRate) parts.push(`${f.sampleRate % 1000 === 0 ? f.sampleRate / 1000 : (f.sampleRate / 1000).toFixed(1)} kHz`);
  if (f.channels) parts.push(f.channels === 1 ? words.mono : f.channels === 2 ? words.stereo : words.channels(f.channels));
  if (f.bitDepth) parts.push(`${f.bitDepth} bit`);
  return parts.join(' · ');
}
