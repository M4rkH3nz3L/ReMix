/**
 * 🏷️ Hangfájl-címkék (PRO-AUDIO 17/1): a cím és az előadó a fájlból — MP3 (ID3v2.2–2.4),
 * M4A/MP4 (iTunes `©nam` / `©ART`), FLAC (Vorbis-komment), WAV (LIST/INFO). Pure, a fájl
 * ELEJÉT és VÉGÉT kapja (az MP4 `moov`-ja és a WAV LIST-je gyakran a végén van). A szöveg-
 * dekódolás saját (UTF-8, UTF-16 BOM-mal / BE, Latin-1), nem függ a futtatókörnyezettől.
 * Hibás vagy hiányos bájtokra nem dob: amit nem talál, az hiányzik.
 */
import { logCaught } from '@/lib/logCaught';

export interface AudioTags {
  title?: string;
  artist?: string;
}

/** A klip címkéje: „előadó – cím”, csak cím, vagy a fájlnév. */
export function tagLabel(tags: AudioTags, fileName: string): string {
  const title = tags.title?.trim();
  const artist = tags.artist?.trim();
  if (title && artist) {
    return `${artist} – ${title}`;
  }
  return title || fileName;
}

export function readAudioTags(head: Uint8Array, tail: Uint8Array): AudioTags {
  try {
    const found = (ascii(head, 0, 3) === 'ID3' && id3(head)) ||
      (ascii(head, 0, 4) === 'fLaC' && flac(head)) ||
      (ascii(head, 0, 4) === 'RIFF' && (wavInfo(head) || wavInfo(tail))) ||
      mp4(head) ||
      mp4(tail);
    return found ? clean(found) : {};
  } catch (caught) {
    // a címke opcionális: sérült fájlnál a fájlnév marad
    logCaught('lib/audioTags.ts:readAudioTags', caught);
    return {};
  }
}

function clean(t: AudioTags): AudioTags {
  const out: AudioTags = {};
  const title = t.title?.replace(/\0+$/g, '').trim();
  const artist = t.artist?.replace(/\0+$/g, '').trim();
  if (title) out.title = title;
  if (artist) out.artist = artist;
  return out.title || out.artist ? out : {};
}

// ── kódolás ─────────────────────────────────────────────────────────────────

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

function latin1(b: Uint8Array): string {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

function utf8(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    let cp = c;
    let n = 1;
    if (c >= 0xf0 && i + 3 < b.length) {
      cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      n = 4;
    } else if (c >= 0xe0 && i + 2 < b.length) {
      cp = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
      n = 3;
    } else if (c >= 0xc0 && i + 1 < b.length) {
      cp = ((c & 0x1f) << 6) | (b[i + 1] & 0x3f);
      n = 2;
    }
    s += String.fromCodePoint(cp);
    i += n;
  }
  return s;
}

function utf16(b: Uint8Array, littleEndian: boolean): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    const u = littleEndian ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1];
    if (u === 0) break;
    s += String.fromCharCode(u);
  }
  return s;
}

const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u32le = (b: Uint8Array, at: number) => b[at] + (b[at + 1] << 8) + (b[at + 2] << 16) + ((b[at + 3] << 24) >>> 0);
const syncsafe = (b: Uint8Array, at: number) => (b[at] << 21) | (b[at + 1] << 14) | (b[at + 2] << 7) | b[at + 3];

// ── ID3v2 ───────────────────────────────────────────────────────────────────

function id3Text(frame: Uint8Array): string {
  const enc = frame[0];
  const body = frame.subarray(1);
  if (enc === 1) {
    const le = body[0] === 0xff && body[1] === 0xfe;
    const be = body[0] === 0xfe && body[1] === 0xff;
    return utf16(le || be ? body.subarray(2) : body, !be);
  }
  if (enc === 2) return utf16(body, false);
  if (enc === 3) return utf8(body.subarray(0, body.indexOf(0) >= 0 ? body.indexOf(0) : body.length));
  return latin1(body.subarray(0, body.indexOf(0) >= 0 ? body.indexOf(0) : body.length));
}

function id3(b: Uint8Array): AudioTags | null {
  const major = b[3];
  const size = syncsafe(b, 6);
  const end = Math.min(b.length, 10 + size);
  let pos = 10;
  if (b[5] & 0x40) {
    pos += major === 4 ? syncsafe(b, 10) : u32be(b, 10) + 4;
  }
  const tags: AudioTags = {};
  const idLen = major === 2 ? 3 : 4;
  const head = major === 2 ? 6 : 10;
  while (pos + head <= end) {
    const id = ascii(b, pos, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const fsize = major === 2 ? (b[pos + 3] << 16) | (b[pos + 4] << 8) | b[pos + 5] : major === 4 ? syncsafe(b, pos + 4) : u32be(b, pos + 4);
    if (fsize <= 0 || pos + head + fsize > end) break;
    const frame = b.subarray(pos + head, pos + head + fsize);
    if (id === 'TIT2' || id === 'TT2') tags.title = id3Text(frame);
    if (id === 'TPE1' || id === 'TP1') tags.artist = id3Text(frame);
    pos += head + fsize;
  }
  return tags.title || tags.artist ? tags : null;
}

// ── MP4 / M4A ───────────────────────────────────────────────────────────────

function mp4Value(b: Uint8Array, key: number[]): string | undefined {
  for (let i = 4; i + 24 < b.length; i++) {
    if (b[i] !== key[0] || b[i + 1] !== key[1] || b[i + 2] !== key[2] || b[i + 3] !== key[3]) continue;
    // [méret][©nam] [méret][data][típus][nyelv][érték…]
    if (ascii(b, i + 8, 4) !== 'data') continue;
    const dsize = u32be(b, i + 4);
    if (dsize < 16 || i + 4 + dsize > b.length) continue;
    return utf8(b.subarray(i + 20, i + 4 + dsize));
  }
  return undefined;
}

function mp4(b: Uint8Array): AudioTags | null {
  const title = mp4Value(b, [0xa9, 0x6e, 0x61, 0x6d]);
  const artist = mp4Value(b, [0xa9, 0x41, 0x52, 0x54]);
  return title || artist ? { title, artist } : null;
}

// ── FLAC ────────────────────────────────────────────────────────────────────

function flac(b: Uint8Array): AudioTags | null {
  let pos = 4;
  while (pos + 4 <= b.length) {
    const header = b[pos];
    const type = header & 0x7f;
    const len = (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
    const start = pos + 4;
    if (type === 4 && start + len <= b.length) {
      let p = start + 4 + u32le(b, start);
      const count = u32le(b, p);
      p += 4;
      const tags: AudioTags = {};
      for (let k = 0; k < count && p + 4 <= start + len; k++) {
        const n = u32le(b, p);
        const entry = utf8(b.subarray(p + 4, p + 4 + n));
        const eq = entry.indexOf('=');
        const keyName = entry.slice(0, eq).toUpperCase();
        if (keyName === 'TITLE') tags.title = entry.slice(eq + 1);
        if (keyName === 'ARTIST') tags.artist = entry.slice(eq + 1);
        p += 4 + n;
      }
      return tags.title || tags.artist ? tags : null;
    }
    if (header & 0x80) break;
    pos = start + len;
  }
  return null;
}

// ── WAV LIST/INFO ───────────────────────────────────────────────────────────

function wavInfo(b: Uint8Array): AudioTags | null {
  for (let i = 0; i + 12 < b.length; i++) {
    if (ascii(b, i, 4) !== 'LIST' || ascii(b, i + 8, 4) !== 'INFO') continue;
    const end = Math.min(b.length, i + 8 + u32le(b, i + 4));
    const tags: AudioTags = {};
    let p = i + 12;
    while (p + 8 <= end) {
      const id = ascii(b, p, 4);
      const n = u32le(b, p + 4);
      const raw = b.subarray(p + 8, Math.min(end, p + 8 + n));
      const value = utf8(raw.subarray(0, raw.indexOf(0) >= 0 ? raw.indexOf(0) : raw.length));
      if (id === 'INAM') tags.title = value;
      if (id === 'IART') tags.artist = value;
      p += 8 + n + (n % 2);
    }
    return tags.title || tags.artist ? tags : null;
  }
  return null;
}
