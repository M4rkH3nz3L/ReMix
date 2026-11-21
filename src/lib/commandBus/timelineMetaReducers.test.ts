import { applyCommand } from '@/lib/commands';
import { expectChanged, makeProject } from '@/test-utils/projectFixtures';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa — idővonal-meta (timelineMetaReducers).
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract-tesztek).
 * (A korábbi egyetlen commands.test.ts reducer-tartományonként bontva; a fixture-ök: src/test-utils.)
 */

describe('applyCommand — idővonal-meta (rendezve + no-op kiszűrve)', () => {
  it('SET_MARKERS: idő szerint rendez + null ha ugyanaz', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_MARKERS', markers: [
      { id: 'm2', time: 5, label: 'B' }, { id: 'm1', time: 1, label: 'A' },
    ] }));
    expect(next.markers!.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(applyCommand(next, { type: 'SET_MARKERS', markers: [
      { id: 'm1', time: 1, label: 'A' }, { id: 'm2', time: 5, label: 'B' },
    ] })).toBeNull();
  });
  it('SET_CHAPTERS: start szerint rendez', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_CHAPTERS', chapters: [
      { id: 'c2', start: 10, kind: 'cta' }, { id: 'c1', start: 0, kind: 'hook' },
    ] }));
    expect(next.chapters!.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
  it('SET_REGIONS: start szerint rendez', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_REGIONS', regions: [
      { id: 'r2', start: 10, end: 12, label: 'B', color: '#f00' },
      { id: 'r1', start: 0, end: 2, label: 'A', color: '#0f0' },
    ] }));
    expect(next.regions!.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
  it('SET_LINKS: 1-elemű csoportokat kiszűr + null ha ugyanaz', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_LINKS', links: [['a', 'b'], ['x']] }));
    expect(next.links).toEqual([['a', 'b']]);
    expect(applyCommand(next, { type: 'SET_LINKS', links: [['b', 'a']] })).toBeNull();
  });
});
