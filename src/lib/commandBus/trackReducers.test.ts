import { applyCommand } from '@/lib/commands';
import { canHostClip, compatibleTracksFor } from '@/lib/projectUtils';
import { asset, audioClip, clipsOf, expectChanged, makeProject, track, videoClip } from '@/test-utils/projectFixtures';
import type { VideoClip } from '@/types/project';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa — sáv- és klip-parancsok (trackReducers).
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract-tesztek).
 * (A korábbi egyetlen commands.test.ts reducer-tartományonként bontva; a fixture-ök: src/test-utils.)
 */

describe('applyCommand — ADD_CLIP', () => {
  it('a klipet a megadott sávra teszi', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['a']);
    // immutabilitás: a bemenet sávja érintetlen
    expect(clipsOf(p, 'video')).toHaveLength(0);
  });

  it('asset-tel: új assetet ad + assetId-t állít', () => {
    const p = makeProject();
    const next = expectChanged(
      p,
      applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a'), asset: asset('ast1', 'file:///x.mp4') })
    );
    expect(next.assets.map((a) => a.id)).toEqual(['ast1']);
    expect((clipsOf(next, 'video')[0] as VideoClip & { assetId?: string }).assetId).toBe('ast1');
  });

  it('asset azonos uri-val: a meglévőre mutat, nem duplikál', () => {
    const p = makeProject({ assets: [asset('astOld', 'file:///x.mp4')] });
    const next = expectChanged(
      p,
      applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a'), asset: asset('astNew', 'file:///x.mp4') })
    );
    expect(next.assets.map((a) => a.id)).toEqual(['astOld']);
    expect((clipsOf(next, 'video')[0] as VideoClip & { assetId?: string }).assetId).toBe('astOld');
  });

  it('null, ha a sáv-típus nem létezik', () => {
    const p = makeProject({ tracks: [track('video')] });
    expect(applyCommand(p, { type: 'ADD_CLIP', trackType: 'music', clip: audioClip('a') })).toBeNull();
  });
});

describe('applyCommand — ADD_CLIPS', () => {
  it('több klipet ad egyszerre', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'ADD_CLIPS', trackType: 'video', clips: [videoClip('a'), videoClip('b', 10)] }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('null, ha üres a lista', () => {
    const p = makeProject();
    expect(applyCommand(p, { type: 'ADD_CLIPS', trackType: 'video', clips: [] })).toBeNull();
  });
});

describe('applyCommand — UPDATE_CLIP', () => {
  it('a patch-et alkalmazza a klipre', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'UPDATE_CLIP', clipId: 'a', patch: { duration: 4 } }));
    expect(clipsOf(next, 'video')[0].duration).toBe(4);
    expect(clipsOf(p, 'video')[0].duration).toBe(10); // bemenet érintetlen
  });
  it('null, ha a klip ismeretlen', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a')])] });
    expect(applyCommand(p, { type: 'UPDATE_CLIP', clipId: 'nincs', patch: { duration: 4 } })).toBeNull();
  });
});

describe('applyCommand — REMOVE_CLIP', () => {
  it('eltávolítja a klipet', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a'), videoClip('b', 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'REMOVE_CLIP', clipId: 'a' }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['b']);
  });
  it('null, ha a klip nem létezik', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a')])] });
    expect(applyCommand(p, { type: 'REMOVE_CLIP', clipId: 'nincs' })).toBeNull();
  });
});

describe('applyCommand — SPLIT_CLIP', () => {
  it('kettévágja a klipet a megadott időpontban', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'SPLIT_CLIP', clipId: 'a', time: 4 }));
    const parts = clipsOf(next, 'video');
    expect(parts).toHaveLength(2);
    expect(parts[0].duration).toBeCloseTo(4);
    expect(parts[1].start).toBeCloseTo(4);
  });
  it('null, ha a klip ismeretlen', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    expect(applyCommand(p, { type: 'SPLIT_CLIP', clipId: 'nincs', time: 4 })).toBeNull();
  });
  it('null, ha a vágás a klip szélére esik (túl rövid rész)', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    expect(applyCommand(p, { type: 'SPLIT_CLIP', clipId: 'a', time: 0 })).toBeNull();
  });
});

describe('applyCommand — MOVE_CLIP', () => {
  it('kompatibilis sávra mozgat (music → voiceover) új kezdettel', () => {
    const p = makeProject({ tracks: [track('music', [audioClip('a', 0, 10)]), track('voiceover')] });
    const next = expectChanged(p, applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'voiceover', start: 3 }));
    expect(clipsOf(next, 'music')).toHaveLength(0);
    expect(clipsOf(next, 'voiceover').map((c) => c.id)).toEqual(['a']);
    expect(clipsOf(next, 'voiceover')[0].start).toBe(3);
  });
  it('ugyanazon a sávon új kezdet', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'video', start: 5 }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['a']);
    expect(clipsOf(next, 'video')[0].start).toBe(5);
  });
  it('null: inkompatibilis cél (videó klip → text sáv)', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a')]), track('text')] });
    expect(applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'text', start: 0 })).toBeNull();
  });
  it('null: ismeretlen klip', () => {
    const p = makeProject();
    expect(applyCommand(p, { type: 'MOVE_CLIP', clipId: 'nincs', toTrackType: 'video', start: 0 })).toBeNull();
  });
  it('null: ugyanott (azonos sáv + azonos kezdet)', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 2, 10)])] });
    expect(applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'video', start: 2 })).toBeNull();
  });
});

describe('canHostClip — sáv ↔ klip-fajta kompatibilitás', () => {
  it('a kanonikus párosítás', () => {
    expect(canHostClip('video', 'video')).toBe(true);
    expect(canHostClip('video', 'image')).toBe(true);
    expect(canHostClip('pip', 'video')).toBe(true);
    expect(canHostClip('voiceover', 'audio')).toBe(true);
    expect(canHostClip('text', 'text')).toBe(true);
    expect(canHostClip('overlay', 'shape')).toBe(true);
    // inkompatibilis
    expect(canHostClip('video', 'audio')).toBe(false);
    expect(canHostClip('text', 'video')).toBe(false);
    expect(canHostClip('music', 'text')).toBe(false);
  });
  it('compatibleTracksFor: a fajtát fogadó sávok kanonikus sorrendben', () => {
    expect(compatibleTracksFor('video')).toEqual(['video', 'pip']);
    expect(compatibleTracksFor('image')).toEqual(['video', 'pip', 'overlay']); // kép-matrica az overlay-re is
    expect(compatibleTracksFor('audio')).toEqual(['music', 'voiceover', 'sfx']);
    expect(compatibleTracksFor('text')).toEqual(['text', 'captions']);
    expect(compatibleTracksFor('adjust')).toEqual(['adjust']);
  });
});

describe('applyCommand — sáv-újraépítés', () => {
  it('REPLACE_TRACK_CLIPS: cseréli a sáv klipjeit + null ha a sáv hiányzik', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('old')])] });
    const next = expectChanged(p, applyCommand(p, { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: [videoClip('new')] }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['new']);
    expect(applyCommand(p, { type: 'REPLACE_TRACK_CLIPS', trackType: 'music', clips: [] })).toBeNull();
  });
  it('REPLACE_TRACKS: több sáv + új assetek egy lépésben, null ha üres', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, {
      type: 'REPLACE_TRACKS',
      tracks: [{ trackType: 'video', clips: [videoClip('v')] }, { trackType: 'music', clips: [audioClip('m')] }],
      assets: [asset('a1', 'file:///a.mp4')],
    }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['v']);
    expect(clipsOf(next, 'music').map((c) => c.id)).toEqual(['m']);
    expect(next.assets).toHaveLength(1);
    expect(applyCommand(p, { type: 'REPLACE_TRACKS', tracks: [] })).toBeNull();
  });
});
