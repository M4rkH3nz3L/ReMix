import { MidiParseError, parseMidi, writeMidi } from '@/lib/midiFile';

/** 🎼 V1 (MU5): MIDI-fájl — körbejárás, SMF 1 több sávval, futó állapot, Note On 0-s sebességgel. */
describe('🎼 MIDI-fájl', () => {
  it('körbejárás: export → import azonos hangokat ad (kezdet, hossz, erősség), a tempó és az ütemjelzés megmarad', () => {
    const notes = [
      { midi: 60, startBeat: 0, lengthBeats: 1, velocity: 100 },
      { midi: 64, startBeat: 1, lengthBeats: 0.5, velocity: 127 },
      { midi: 67, startBeat: 1.5, lengthBeats: 2 / 3, velocity: 50 },
      { midi: 60, startBeat: 1, lengthBeats: 1, velocity: 80 }, // ugyanaz a hang az előző végén kezdődik
    ];
    const song = parseMidi(writeMidi(notes, { bpm: 96, beatsPerBar: 3, beatUnit: 4 }));
    expect(song.format).toBe(0);
    expect(song.bpm).toBe(96);
    expect(song.timeSignature).toEqual({ beatsPerBar: 3, beatUnit: 4 });
    const got = song.notes.map((n) => [n.midi, n.startBeat, Math.round(n.lengthBeats * 1000) / 1000, n.velocity]);
    expect(got).toEqual([
      [60, 0, 1, 100],
      [60, 1, 1, 80],
      [64, 1, 0.5, 127],
      [67, 1.5, 0.667, 50],
    ]);
  });

  it('SMF 1 két sávval, futó állapottal és Note On 0-s sebességgel (Note Off-ként)', () => {
    const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0, 96];
    const t0 = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0xff, 0x2f, 0]; // 120 BPM
    // sáv 1: Note On 62, futó állapot: Note On 62 vel 0 (= off) 96 tick múlva, majd 65 on/off
    const t1 = [0, 0x91, 62, 90, 96, 62, 0, 0, 65, 70, 48, 0x81, 65, 0, 0, 0xff, 0x2f, 0];
    const trk = (b: number[]) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, b.length, ...b];
    const song = parseMidi(new Uint8Array([...hdr, ...trk(t0), ...trk(t1)]));
    expect(song.format).toBe(1);
    expect(song.bpm).toBe(120);
    expect(song.notes).toEqual([
      { midi: 62, startBeat: 0, lengthBeats: 1, velocity: 90, track: 1, channel: 1 },
      { midi: 65, startBeat: 1, lengthBeats: 0.5, velocity: 70, track: 1, channel: 1 },
    ]);
  });

  it('nem MIDI / SMPTE-időzítés: érthető hiba', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]))).toThrow(MidiParseError);
    const smpte = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 0x28]);
    expect(() => parseMidi(smpte)).toThrow('SMPTE');
  });
});
