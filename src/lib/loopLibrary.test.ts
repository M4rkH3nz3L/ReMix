import hu from '@/i18n/locales/hu.json';
import en from '@/i18n/locales/en.json';
import de from '@/i18n/locales/de.json';
import { patternHits } from '@/lib/drums';
import { BUILTIN_LOOPS, LOOP_BARS, LOOP_CATEGORIES, loopDrums, loopNotes, loopsIn } from '@/lib/loopLibrary';

/** 🔁 V2: a beépített loop-csomag — érvényes, ütemhű minták, minden névvel. */
describe('🔁 beépített loopok', () => {
  it('20 loop, egyedi azonosítóval, kategóriánként legalább 4', () => {
    expect(BUILTIN_LOOPS.length).toBe(20);
    expect(new Set(BUILTIN_LOOPS.map((l) => l.id)).size).toBe(20);
    for (const c of LOOP_CATEGORIES) expect(loopsIn(c).length).toBeGreaterThanOrEqual(4);
  });

  it('minden minta a saját hosszán belül marad, és a 4 ütemre pontosan ismétlődik', () => {
    for (const l of BUILTIN_LOOPS) {
      if (l.def.kind === 'drums') {
        const span = l.def.len * 16;
        for (const steps of Object.values(l.def.steps)) for (const s of steps ?? []) expect(s).toBeLessThan(span);
        const { pattern } = loopDrums(l.def);
        const hits = patternHits(pattern);
        expect(hits.length).toBeGreaterThan(0);
        expect(Math.max(...hits.map((h) => h.step))).toBeLessThan(LOOP_BARS * 16);
        // a minta ütemenként (len-enként) azonos
        const per = hits.filter((h) => h.step < span).length;
        expect(hits.length).toBe(per * (LOOP_BARS / l.def.len));
      } else {
        const beats = l.def.len * 4;
        for (const [midi, start, len] of l.def.notes) {
          expect(start + len).toBeLessThanOrEqual(beats + 1e-9);
          expect(midi).toBeGreaterThanOrEqual(24);
          expect(midi).toBeLessThanOrEqual(96);
        }
        const notes = loopNotes(l.def);
        expect(notes.length).toBe(l.def.notes.length * (LOOP_BARS / l.def.len));
        expect(new Set(notes.map((n) => n.id)).size).toBe(notes.length);
        expect(Math.max(...notes.map((n) => n.startBeat + n.lengthBeats))).toBeLessThanOrEqual(LOOP_BARS * 4 + 1e-9);
      }
    }
  });

  it('a hangsúlyos és halk ütések a velocity-sorban, a swing a mintán', () => {
    const trap = BUILTIN_LOOPS.find((l) => l.id === 'trap')!;
    const { velocity } = loopDrums(trap.def as Parameters<typeof loopDrums>[0]);
    expect(velocity.hihat?.[1]).toBe(64);
    expect(loopDrums(BUILTIN_LOOPS.find((l) => l.id === 'lofi')!.def as Parameters<typeof loopDrums>[0]).swing).toBe(0.3);
  });

  it('minden loopnak és kategóriának van neve hu/en/de nyelven', () => {
    for (const loc of [hu, en, de] as Record<string, unknown>[]) {
      const loops = (loc as { studio: { audio: { loops: { name: Record<string, string>; cat: Record<string, string> } } } }).studio.audio.loops;
      for (const l of BUILTIN_LOOPS) expect(loops.name[l.id]).toBeTruthy();
      for (const c of LOOP_CATEGORIES) expect(loops.cat[c]).toBeTruthy();
    }
  });
});
