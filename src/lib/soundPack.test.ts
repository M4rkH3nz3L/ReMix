import { drumsDoc, synthDoc } from '@/lib/instrumentDoc';
import { emptyPattern } from '@/lib/drums';
import { BUILTIN_LOOPS, loopDrums, loopNotes, type DrumDef, type SynthDef } from '@/lib/loopLibrary';
import { packFromProject, parseSoundPack, SOUND_PACK_MAX_LOOPS, synthCategory } from '@/lib/soundPack';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const clip = (id: string, docId: string, label: string): AudioClip => ({ kind: 'audio', id, uri: `file:///${id}.wav`, label, start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', instrumentDocId: docId });

function projectWithDocs(): Project {
  const base = createEmptyProject('Saját beat', '9:16', undefined, 'audio');
  const pat = emptyPattern(4);
  pat.kick[0] = pat.kick[8] = pat.kick[16] = true;
  pat.snare[4] = pat.snare[12] = true;
  pat.hihat[63] = true;
  const drums = drumsDoc('d1', 120, 4, pat, { kick: [127], snare: [undefined, undefined, undefined, undefined, 60] }, 0.1);
  const bass = synthDoc('s1', 120, 2, 'sawtooth', [
    { id: 'a', midi: 36, startBeat: 0, lengthBeats: 1 },
    { id: 'b', midi: 43, startBeat: 2, lengthBeats: 9, velocity: 90 },
  ]);
  const sampler = { id: 'x1', kind: 'sampler' as const, bpm: 120, bars: 1, sampler: { sampleUri: 'file:///s.wav', pattern: [true] } };
  return {
    ...base,
    instrumentDocs: [drums, bass, sampler],
    tracks: base.tracks.map((t) =>
      t.type === 'music' ? { ...t, clips: [clip('c1', 'd1', 'Dob 1'), clip('c2', 'd1', 'Dob 1 másolat'), clip('c3', 's1', 'Basszus'), clip('c4', 'x1', 'Minta')] } : t
    ),
  };
}

describe('soundPack — V4 hangcsomag', () => {
  test('projektből: a dob- és szinti-minták (egyszer), a sampler kimarad; a hosszak a loop-rácson', () => {
    const pack = packFromProject(projectWithDocs(), 'Első csomag')!;
    expect(pack.name).toBe('Első csomag');
    expect(pack.loops.map((l) => [l.name, l.category, l.def.kind, l.def.len])).toEqual([
      ['Dob 1', 'drums', 'drums', 4],
      ['Basszus', 'bass', 'synth', 2],
    ]);
    const d = pack.loops[0].def as DrumDef;
    expect(d.steps.kick).toEqual([0, 8, 16]);
    expect(d.steps.hihat).toEqual([63]);
    expect(d.accent).toEqual({ kick: [0] });
    expect(d.soft).toEqual({ snare: [4] });
    expect(d.swing).toBe(0.1);
    // a 2 ütemen túllógó hang a minta végénél vágva
    expect((pack.loops[1].def as SynthDef).notes).toEqual([[36, 0, 1], [43, 2, 6, 90]]);
  });

  test('nincs hangszer-minta → null', () => {
    expect(packFromProject(createEmptyProject('üres', '9:16', undefined, 'audio'), 'x')).toBeNull();
  });

  test('oda-vissza: a csomag a parszeren át változatlan, és a motor ugyanazt a mintát kapja', () => {
    const pack = packFromProject(projectWithDocs(), 'P')!;
    const back = parseSoundPack(JSON.parse(JSON.stringify(pack)))!;
    expect(back).toEqual(pack);
    expect(loopDrums(back.loops[0].def as DrumDef).pattern.kick.filter(Boolean)).toHaveLength(3);
    expect(loopNotes(back.loops[1].def as SynthDef)).toHaveLength(4);
  });

  test('idegen payload: rossz mezők eldobva, számok tartományban, plafonok', () => {
    expect(parseSoundPack(null)).toBeNull();
    expect(parseSoundPack({ type: 'project', loops: [] })).toBeNull();
    expect(parseSoundPack({ type: 'soundPack', loops: [{ def: { kind: 'drums', len: 3, steps: { kick: [0] } } }] })).toBeNull();
    const evil = {
      type: 'soundPack',
      name: '\u0000x'.repeat(100),
      extra: 'drop me',
      loops: [
        { name: 'ok', category: 'drums', def: { kind: 'drums', len: 1, steps: { kick: [0, 0, 15, 16, -1, 2.5, 'x'], bogus: [1] }, swing: 9 } },
        { name: 5, category: 'nope', def: { kind: 'synth', wave: 'sine', len: 1, notes: [[60, 0, 1, 500], [200, 0, 1], [60, -1, 1], [61, 3.5, 4], ['a', 0, 1], [62, 0, 0]] } },
        { def: { kind: 'synth', wave: 'evil', len: 1, notes: [[60, 0, 1]] } },
      ],
    };
    const p = parseSoundPack(evil)!;
    expect(p.name.length).toBeLessThanOrEqual(60);
    expect(p).not.toHaveProperty('extra');
    expect(p.loops).toHaveLength(2);
    expect((p.loops[0].def as DrumDef).steps).toEqual({ kick: [0, 15] });
    expect((p.loops[0].def as DrumDef).swing).toBe(0.5);
    expect(p.loops[1].name).toBe('Loop 2');
    expect((p.loops[1].def as SynthDef).notes).toEqual([[60, 0, 1, 127], [61, 3.5, 0.5]]);
    const many = { type: 'soundPack', name: 'm', loops: Array.from({ length: 100 }, () => ({ def: { kind: 'drums', len: 1, steps: { kick: [0] } } })) };
    expect(parseSoundPack(many)!.loops).toHaveLength(SOUND_PACK_MAX_LOOPS);
  });

  test('szinti-kategória: mély → basszus, ≥ 3 egyszerre → akkord, különben dallam', () => {
    expect(synthCategory([[36, 0, 1], [40, 1, 1]])).toBe('bass');
    expect(synthCategory([[60, 0, 1], [64, 0, 1], [67, 0, 1]])).toBe('chords');
    expect(synthCategory([[72, 0, 1], [74, 1, 1]])).toBe('melody');
    // oktávot ugráló basszus (a beépített bassPulse)
    expect(synthCategory([[45, 0, 1], [57, 0.5, 1], [45, 1, 1], [57, 1.5, 1]])).toBe('bass');
  });

  test('a felismerő a beépített szinti-loopokat a saját kategóriájukba sorolja', () => {
    for (const l of BUILTIN_LOOPS) {
      if (l.def.kind === 'synth') expect([l.id, synthCategory(l.def.notes)]).toEqual([l.id, l.category]);
    }
  });
});
