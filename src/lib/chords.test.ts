import { chordName, chordParts, diatonicTriad, PROGRESSIONS, romanNumeral, voiceLead } from '@/lib/chords';
import type { MusicKey } from '@/lib/pitch';

/** 🎼 V3.1: akkordmenet — diatonikus hármashangzatok, nevek, hangvezetés, négy rész. */
const C: MusicKey = { root: 0, scale: 'major' };
const Am: MusicKey = { root: 9, scale: 'naturalMinor' };

describe('🎼 akkordok', () => {
  it('C-dúr diatonikus akkordjai és római számai', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => chordName(C, d))).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => romanNumeral(C, d))).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(diatonicTriad(C, 5)).toEqual([55, 59, 62]);
  });

  it('A-moll: i iv v és a III dúr', () => {
    expect([1, 3, 4, 5, 6, 7].map((d) => chordName(Am, d))).toEqual(['Am', 'C', 'Dm', 'Em', 'F', 'G']);
    expect(romanNumeral(Am, 1)).toBe('i');
    expect(romanNumeral(Am, 2)).toBe('ii°');
  });

  it('hangvezetés: a fordítás az előző akkordhoz legközelebbi, a hangok megmaradnak (pitch-class)', () => {
    const c = voiceLead(diatonicTriad(C, 1), null);
    const g = voiceLead(diatonicTriad(C, 5), c);
    expect(new Set(g.map((m) => m % 12))).toEqual(new Set([7, 11, 2]));
    const center = (v: number[]) => v.reduce((s, m) => s + m, 0) / 3;
    expect(Math.abs(center(g) - center(c))).toBeLessThan(4);
  });

  it('a pop-menet (I–V–vi–IV) négy része: 4 ütem, 12 akkordhang, 32 basszus, 64 arpeggio, dob minden ütemben', () => {
    const p = chordParts(C, PROGRESSIONS.pop);
    expect(p.bars).toBe(4);
    expect(p.labels.map((l) => l.name)).toEqual(['C', 'G', 'Am', 'F']);
    expect(p.chords.length).toBe(12);
    expect(p.bass.length).toBe(32);
    expect(p.arp.length).toBe(64);
    // a basszus az akkord alaphangja a 2. oktávban (C2=36…), az arpeggio a 3 akkordhang + oktáv
    expect(p.bass[0].midi % 12).toBe(0);
    expect(p.bass[8].midi % 12).toBe(7);
    expect(new Set(p.arp.slice(16, 20).map((n) => n.midi % 12))).toEqual(new Set([7, 11, 2]));
    expect(p.drums.pattern.kick.filter(Boolean).length).toBe(12);
    expect(Math.max(...p.chords.map((n) => n.startBeat + n.lengthBeats))).toBeLessThanOrEqual(16);
    expect(new Set([...p.chords, ...p.bass, ...p.arp].map((n) => n.id)).size).toBe(12 + 32 + 64);
  });
});
