/**
 * 🎼 MIDI-fájl (Standard MIDI File, SMF 0/1) — pure, expo-mentes (PRO-MUSIC MU5 · AUDIO-PROD V1).
 *
 * Adatcsere, nem vezérlés (a 2026-11-01-es szabály: MIDI-billentyűzet nem kell): a piano roll dallama
 * kiírható `.mid`-be, egy külső programból hozott `.mid` hangjai behúzhatók. Olvasás: SMF 0 és 1,
 * minden sáv Note On/Off eseménye (a futó állapot / running status is), a tempó (Set Tempo) és az
 * ütemjelzés (Time Signature) az első előfordulásból; a beat-pozíció a PPQ-ból (a tempóváltás a
 * beat-pozíciót nem érinti). Írás: SMF 0, egy sáv, 480 PPQ, a tempó és 4/4.
 */

export interface MidiNote {
  midi: number;
  /** kezdet negyedhangokban (beat) */
  startBeat: number;
  lengthBeats: number;
  velocity: number;
  /** 0-alapú sáv-index (SMF 1-nél) */
  track: number;
  channel: number;
}

export interface MidiSong {
  format: 0 | 1 | 2;
  ppq: number;
  /** az első Set Tempo (BPM), hiányzó = 120 */
  bpm: number;
  timeSignature?: { beatsPerBar: number; beatUnit: number };
  notes: MidiNote[];
}

export class MidiParseError extends Error {}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];

/** változó hosszú szám (VLQ) → [érték, új pozíció] */
function vlq(b: Uint8Array, at: number): [number, number] {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    if (at >= b.length) throw new MidiParseError('csonka VLQ');
    const x = b[at++];
    v = (v << 7) | (x & 0x7f);
    if (!(x & 0x80)) return [v, at];
  }
  throw new MidiParseError('túl hosszú VLQ');
}

/** `.mid` bájtok → hangok (beatben), tempó, ütemjelzés */
export function parseMidi(bytes: Uint8Array): MidiSong {
  if (bytes.length < 14 || ascii(bytes, 0) !== 'MThd') throw new MidiParseError('nem MIDI-fájl (nincs MThd)');
  const hlen = u32(bytes, 4);
  const format = u16(bytes, 8);
  const ntracks = u16(bytes, 10);
  const division = u16(bytes, 12);
  if (format > 2) throw new MidiParseError(`ismeretlen formátum: ${format}`);
  if (division & 0x8000) throw new MidiParseError('SMPTE-időzítés nem támogatott');
  const ppq = division || 480;
  let at = 8 + hlen;
  let bpm = 0;
  let ts: MidiSong['timeSignature'];
  const notes: MidiNote[] = [];
  for (let t = 0; t < ntracks && at + 8 <= bytes.length; t++) {
    if (ascii(bytes, at) !== 'MTrk') throw new MidiParseError(`hiányzó MTrk (${t}. sáv)`);
    const len = u32(bytes, at + 4);
    const end = Math.min(bytes.length, at + 8 + len);
    let p = at + 8;
    let tick = 0;
    let status = 0;
    const open = new Map<number, { tick: number; vel: number }[]>();
    while (p < end) {
      const [dt, np] = vlq(bytes, p);
      p = np;
      tick += dt;
      let st = bytes[p];
      if (st & 0x80) {
        p++;
        if (st < 0xf0) status = st;
      } else {
        st = status; // futó állapot
        if (!st) throw new MidiParseError('futó állapot előzmény nélkül');
      }
      if (st === 0xff) {
        const type = bytes[p++];
        const [mlen, mp] = vlq(bytes, p);
        p = mp;
        if (type === 0x51 && mlen === 3 && !bpm) bpm = 60000000 / ((bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]);
        if (type === 0x58 && mlen >= 2 && !ts) ts = { beatsPerBar: bytes[p], beatUnit: 2 ** bytes[p + 1] };
        p += mlen;
        if (type === 0x2f) break;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        const [slen, sp] = vlq(bytes, p);
        p = sp + slen;
        continue;
      }
      const kind = st & 0xf0;
      const ch = st & 0x0f;
      const d1 = bytes[p];
      const two = kind !== 0xc0 && kind !== 0xd0;
      const d2 = two ? bytes[p + 1] : 0;
      p += two ? 2 : 1;
      const key = ch * 128 + d1;
      if (kind === 0x90 && d2 > 0) {
        const list = open.get(key) ?? [];
        list.push({ tick, vel: d2 });
        open.set(key, list);
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const list = open.get(key);
        const on = list?.shift();
        if (on && tick > on.tick) notes.push({ midi: d1, startBeat: on.tick / ppq, lengthBeats: (tick - on.tick) / ppq, velocity: on.vel, track: t, channel: ch });
      }
    }
    at = at + 8 + len;
  }
  notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  return { format: format as 0 | 1 | 2, ppq, bpm: bpm ? Math.round(bpm * 100) / 100 : 120, ...(ts ? { timeSignature: ts } : {}), notes };
}

function writeVlq(out: number[], v: number): void {
  const stack = [v & 0x7f];
  let x = v >> 7;
  while (x > 0) {
    stack.push((x & 0x7f) | 0x80);
    x >>= 7;
  }
  for (let i = stack.length - 1; i >= 0; i--) out.push(stack[i]);
}

/** hangok (beatben) → SMF 0 bájtok (480 PPQ, a tempó és az ütemjelzés a sáv elején) */
export function writeMidi(
  notes: readonly { midi: number; startBeat: number; lengthBeats: number; velocity?: number }[],
  opts: { bpm: number; beatsPerBar?: number; beatUnit?: number; ppq?: number } = { bpm: 120 }
): Uint8Array {
  const ppq = opts.ppq ?? 480;
  const events: { tick: number; order: number; bytes: number[] }[] = [];
  for (const n of notes) {
    const on = Math.max(0, Math.round(n.startBeat * ppq));
    const off = Math.max(on + 1, Math.round((n.startBeat + n.lengthBeats) * ppq));
    const key = Math.max(0, Math.min(127, Math.round(n.midi)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity ?? 100)));
    events.push({ tick: on, order: 1, bytes: [0x90, key, vel] });
    events.push({ tick: off, order: 0, bytes: [0x80, key, 0] });
  }
  // azonos időpontban előbb a Note Off (a szomszédos azonos hangok ne nyeljék el egymást)
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const trk: number[] = [];
  const us = Math.round(60000000 / (opts.bpm > 0 ? opts.bpm : 120));
  trk.push(0, 0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);
  const bpb = opts.beatsPerBar ?? 4;
  const unit = opts.beatUnit ?? 4;
  trk.push(0, 0xff, 0x58, 4, bpb, Math.round(Math.log2(unit)), 24, 8);
  let last = 0;
  for (const e of events) {
    writeVlq(trk, e.tick - last);
    last = e.tick;
    trk.push(...e.bytes);
  }
  trk.push(0, 0xff, 0x2f, 0);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const len = trk.length;
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...trk]);
}
