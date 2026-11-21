import { applyCommand } from '@/lib/commands';
import { expectChanged, makeProject } from '@/test-utils/projectFixtures';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa — skalár projekt-mezők (projectMetaReducers).
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract-tesztek).
 * (A korábbi egyetlen commands.test.ts reducer-tartományonként bontva; a fixture-ök: src/test-utils.)
 */

describe('applyCommand — skalár projekt-mezők', () => {
  it('SET_ASPECT: vált + null ha azonos', () => {
    const p = makeProject({ aspectRatio: '9:16' });
    expect(expectChanged(p, applyCommand(p, { type: 'SET_ASPECT', aspectRatio: '16:9' })).aspectRatio).toBe('16:9');
    expect(applyCommand(p, { type: 'SET_ASPECT', aspectRatio: '9:16' })).toBeNull();
  });
  it('SET_FPS: kerekít + null ha azonos vagy <=0', () => {
    const p = makeProject({ fps: 30 });
    expect(expectChanged(p, applyCommand(p, { type: 'SET_FPS', fps: 24 })).fps).toBe(24);
    expect(applyCommand(p, { type: 'SET_FPS', fps: 30 })).toBeNull();
    expect(applyCommand(p, { type: 'SET_FPS', fps: 0 })).toBeNull();
  });
  it('RENAME_PROJECT: trimmel + null ha üres/azonos', () => {
    const p = makeProject({ name: 'Teszt' });
    expect(expectChanged(p, applyCommand(p, { type: 'RENAME_PROJECT', name: '  Új  ' })).name).toBe('Új');
    expect(applyCommand(p, { type: 'RENAME_PROJECT', name: '   ' })).toBeNull();
    expect(applyCommand(p, { type: 'RENAME_PROJECT', name: 'Teszt' })).toBeNull();
  });
  it('SET_PARTICLES: beállít + null ha ugyanaz', () => {
    const p = makeProject();
    const withP = expectChanged(p, applyCommand(p, { type: 'SET_PARTICLES', particles: { preset: 'confetti', beatSync: false } }));
    expect(withP.particles?.preset).toBe('confetti');
    expect(applyCommand(withP, { type: 'SET_PARTICLES', particles: { preset: 'confetti', beatSync: false } })).toBeNull();
  });
});
