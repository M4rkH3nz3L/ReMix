import { applyCommand } from '@/lib/commands';
import { masterPreset } from '@/lib/audioMaster';
import { expectChanged, makeProject } from '@/test-utils/projectFixtures';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa — hang-keverés és tempó (audioReducers).
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract-tesztek).
 * (A korábbi egyetlen commands.test.ts reducer-tartományonként bontva; a fixture-ök: src/test-utils.)
 */

describe('applyCommand — audio-mix', () => {
  it('SET_AUDIO_MASTER: beállít + null ha változatlan', () => {
    const p = makeProject();
    const master = masterPreset('podcast');
    const next = expectChanged(p, applyCommand(p, { type: 'SET_AUDIO_MASTER', audioMaster: master }));
    expect(next.audioMaster).toEqual(master);
    expect(applyCommand(next, { type: 'SET_AUDIO_MASTER', audioMaster: master })).toBeNull();
  });
  it('SET_TRACK_GAIN: 0..1-re vág + null ha azonos', () => {
    const p = makeProject();
    // -0.5 → 0 (eltér az alap 1-től → változás)
    const down = expectChanged(p, applyCommand(p, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: -0.5 }));
    expect(down.trackMix!.music!.gain).toBe(0);
    // 2 → 1 (eltér a 0-tól → változás)
    const up = expectChanged(down, applyCommand(down, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 2 }));
    expect(up.trackMix!.music!.gain).toBe(1);
    // 1.5 → 1 (azonos a jelenlegi 1-gyel) → null
    expect(applyCommand(up, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 1.5 })).toBeNull();
  });
});

describe('applyCommand — SET_BPM', () => {
  it('beállít + 20–300 közé szorít', () => {
    const p = makeProject();
    expect(expectChanged(p, applyCommand(p, { type: 'SET_BPM', bpm: 90 })).bpm).toBe(90);
    expect(expectChanged(p, applyCommand(p, { type: 'SET_BPM', bpm: 5 })).bpm).toBe(20);
    expect(expectChanged(p, applyCommand(p, { type: 'SET_BPM', bpm: 999 })).bpm).toBe(300);
  });
  it('változatlan → null', () => {
    const p = makeProject({ bpm: 120 });
    expect(applyCommand(p, { type: 'SET_BPM', bpm: 120 })).toBeNull();
  });
});
