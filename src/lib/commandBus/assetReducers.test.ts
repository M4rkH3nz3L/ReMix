import { applyCommand } from '@/lib/commands';
import { asset, clipsOf, expectChanged, makeProject, track, videoClip } from '@/test-utils/projectFixtures';
import type { Asset, VideoClip } from '@/types/project';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa — assetek és relink (assetReducers).
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract-tesztek).
 * (A korábbi egyetlen commands.test.ts reducer-tartományonként bontva; a fixture-ök: src/test-utils.)
 */

describe('applyCommand — assetek', () => {
  it('ADD_ASSET: hozzáad + null ha dup id/uri', () => {
    const p = makeProject();
    const withA = expectChanged(p, applyCommand(p, { type: 'ADD_ASSET', asset: asset('a1', 'file:///a.mp4') }));
    expect(withA.assets).toHaveLength(1);
    expect(applyCommand(withA, { type: 'ADD_ASSET', asset: asset('a1', 'file:///other.mp4') })).toBeNull();
    expect(applyCommand(withA, { type: 'ADD_ASSET', asset: asset('a2', 'file:///a.mp4') })).toBeNull();
  });
  it('UPDATE_ASSET: csak engedett mezők + null ha nincs engedett/ismeretlen', () => {
    const p = makeProject({ assets: [asset('a1', 'file:///a.mp4')] });
    const next = expectChanged(p, applyCommand(p, { type: 'UPDATE_ASSET', assetId: 'a1', patch: { favorite: true, rating: 4 } }));
    expect(next.assets[0].favorite).toBe(true);
    expect(next.assets[0].rating).toBe(4);
    // nem engedett mező (uri) → null
    expect(applyCommand(p, { type: 'UPDATE_ASSET', assetId: 'a1', patch: { uri: 'hack' } as Partial<Asset> })).toBeNull();
    expect(applyCommand(p, { type: 'UPDATE_ASSET', assetId: 'nincs', patch: { favorite: true } })).toBeNull();
  });
  it('REMOVE_ASSET: elvesz + null ha ismeretlen', () => {
    const p = makeProject({ assets: [asset('a1', 'file:///a.mp4')] });
    expect(expectChanged(p, applyCommand(p, { type: 'REMOVE_ASSET', assetId: 'a1' })).assets).toHaveLength(0);
    expect(applyCommand(p, { type: 'REMOVE_ASSET', assetId: 'nincs' })).toBeNull();
  });
});

describe('applyCommand — RELINK_URI', () => {
  it('lecseréli az uri-t az assetekben + klipeken, null ha azonos vagy nem érint', () => {
    const p = makeProject({
      tracks: [track('video', [videoClip('a')])],
      assets: [asset('ast', 'file:///clip-a.mp4')],
    });
    // a videoClip('a').uri = file:///clip-a.mp4 → az asset is erre mutat
    const next = expectChanged(p, applyCommand(p, { type: 'RELINK_URI', oldUri: 'file:///clip-a.mp4', newUri: 'file:///new.mp4' }));
    expect(next.assets[0].uri).toBe('file:///new.mp4');
    expect((clipsOf(next, 'video')[0] as VideoClip).uri).toBe('file:///new.mp4');
    expect(applyCommand(p, { type: 'RELINK_URI', oldUri: 'x', newUri: 'x' })).toBeNull();
    expect(applyCommand(p, { type: 'RELINK_URI', oldUri: 'file:///sehol.mp4', newUri: 'file:///y.mp4' })).toBeNull();
  });
});

describe('applyCommand — RELINK_ASSET (asset-centrikus, ADR-012)', () => {
  it('az asset uri-ját cseréli + a rá hivatkozó klipet is; null ha ismeretlen/azonos', () => {
    const p = makeProject({
      tracks: [track('video', [{ ...videoClip('a'), assetId: 'ast' } as VideoClip])],
      assets: [asset('ast', 'file:///clip-a.mp4')],
    });
    const next = expectChanged(
      p,
      applyCommand(p, { type: 'RELINK_ASSET', assetId: 'ast', newUri: 'file:///new.mp4' })
    );
    expect(next.assets[0].uri).toBe('file:///new.mp4');
    expect((clipsOf(next, 'video')[0] as VideoClip).uri).toBe('file:///new.mp4');
    // ismeretlen asset → null; azonos uri → null
    expect(applyCommand(p, { type: 'RELINK_ASSET', assetId: 'nincs', newUri: 'file:///y.mp4' })).toBeNull();
    expect(applyCommand(p, { type: 'RELINK_ASSET', assetId: 'ast', newUri: 'file:///clip-a.mp4' })).toBeNull();
  });
});
