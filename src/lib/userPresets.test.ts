import { emptyPattern, toggleStep } from '@/lib/drums';
import { PRESETS_PER_KIND_MAX, presetsOf, removePreset, renamePreset, sanitizePresets, upsertPreset, type UserPreset } from '@/lib/userPresets';

const now = '2026-11-07T20:00:00.000Z';
let n = 0;
const id = () => `p${n++}`;

describe('⭐ saját presetek', () => {
  it('mentés: az új elöl; azonos név (kis-nagybetű mindegy) felülíródik, az azonosító marad', () => {
    let list: UserPreset[] = [];
    list = upsertPreset(list, 'clipFx', 'Hangom', { compressor: true, reverb: 0.3 }, id(), now)!;
    list = upsertPreset(list, 'clipFx', 'Másik', { gate: true }, id(), now)!;
    const firstId = list[1].id;
    list = upsertPreset(list, 'clipFx', '  hangom ', { compressor: true, reverb: 0.5 }, id(), now)!;
    expect(list.map((p) => p.name)).toEqual(['hangom', 'Másik']);
    expect(list[0].id).toBe(firstId);
    expect(list[0].value).toEqual({ compressor: true, reverb: 0.5 });
  });
  it('a fajták függetlenek; a fajta-korlát felett a legrégebbi esik ki', () => {
    let list: UserPreset[] = [];
    list = upsertPreset(list, 'master', 'X', { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'punchy' }, id(), now)!;
    for (let i = 0; i < PRESETS_PER_KIND_MAX + 3; i++) list = upsertPreset(list, 'clipFx', `fx${i}`, { gate: true }, id(), now)!;
    const fx = presetsOf(list, 'clipFx');
    expect(fx).toHaveLength(PRESETS_PER_KIND_MAX);
    expect(fx[0].name).toBe(`fx${PRESETS_PER_KIND_MAX + 2}`);
    expect(fx.some((p) => p.name === 'fx0')).toBe(false);
    expect(presetsOf(list, 'master')).toHaveLength(1);
  });
  it('érvénytelen érték vagy üres név nem menthető; a szélsőértékek korlátozva', () => {
    expect(upsertPreset([], 'clipFx', '   ', { gate: true }, 'a', now)).toBeNull();
    expect(upsertPreset([], 'master', 'M', { target: 'nope', lufs: -14, truePeak: -1 }, 'a', now)).toBeNull();
    const p = upsertPreset([], 'clipFx', 'Túl', { reverb: 9, pitchSemitones: -40, eq: { low: 99, mid: 0, high: 0 }, bogus: 1 }, 'a', now)![0];
    expect(p.value).toEqual({ reverb: 1, pitchSemitones: -12, eq: { low: 12, mid: 0, high: 0 } });
  });
  it('dobminta és synth-dallam: a rács és a hangjegyek épen; a master halkítás-kulcsa nem kerül bele', () => {
    let pat = emptyPattern(2);
    pat = toggleStep(pat, 'kick', 0);
    pat = toggleStep(pat, 'snare', 20);
    const d = upsertPreset([], 'drums', 'Alap', { bars: 2, pattern: pat }, 'd', now)![0];
    expect(d.value).toEqual({ bars: 2, pattern: pat });
    const s = upsertPreset([], 'synth', 'Dal', { bars: 2, wave: 'square', notes: [{ midi: 60, startBeat: 0, lengthBeats: 1 }, { midi: 999, startBeat: 1, lengthBeats: 1 }] }, 's', now)![0];
    // a tartományon kívüli MIDI-hang (999) a 127-re korlátozódik
    expect(s.value).toEqual({ bars: 2, wave: 'square', notes: [{ midi: 60, startBeat: 0, lengthBeats: 1 }, { midi: 127, startBeat: 1, lengthBeats: 1 }] });
    const m = upsertPreset([], 'master', 'M', { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'natural', duckTrigger: 'sfx' }, 'm', now)![0];
    expect('duckTrigger' in (m.value as object)).toBe(false);
  });
  it('átnevezés (a foglalt név felülír) és törlés', () => {
    let list = upsertPreset([], 'clipFx', 'A', { gate: true }, 'a', now)!;
    list = upsertPreset(list, 'clipFx', 'B', { gate: true }, 'b', now)!;
    list = renamePreset(list, 'b', 'a');
    expect(list.map((p) => [p.id, p.name])).toEqual([['b', 'a']]);
    expect(removePreset(list, 'b')).toEqual([]);
  });
  it('sérült tárolt lista: csak az érvényes bejegyzések maradnak', () => {
    const raw = [null, 'x', { kind: 'clipFx', id: 'ok', name: 'Jó', value: { gate: true } }, { kind: 'clipFx', id: 'r', name: 'Rossz', value: 'x' }, { kind: 'weird', id: 'w', name: 'W', value: {} }, { kind: 'drums', id: 'd', name: 'D', value: { bars: 9, pattern: {} } }];
    expect(sanitizePresets(raw).map((p) => p.id)).toEqual(['ok', 'd']);
    expect(sanitizePresets('nem lista')).toEqual([]);
  });
});
