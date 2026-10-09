import { findMissingMedia, relinkCommandsFor } from '@/lib/videdFile';
import type { Asset, Clip, Project, VideoClip } from '@/types/project';

/**
 * A jest(-expo) környezetben nincs valódi fájlrendszer: a `new File(uri).exists`
 * elbukik → a `findMissingMedia` MINDEN helyi médiát „hiányzónak" vesz. Pont ez
 * kell ehhez a teszthez: azt igazolja, hogy a hiányzóként JELENTETT uri a feloldott
 * (asseten át), nem a klip elavult uri-cache-e (ADR-012 Fázis 2b).
 */

const vClip = (over: Partial<VideoClip> = {}): VideoClip =>
  ({
    id: 'c',
    kind: 'video',
    start: 0,
    duration: 4,
    uri: 'file:///stale.mp4',
    trimIn: 0,
    sourceDuration: 10,
    speed: 1,
    volume: 1,
    ...over,
  }) as VideoClip;

const proj = (clip: VideoClip, assets: Asset[]): Project =>
  ({
    id: 'p',
    name: 't',
    aspectRatio: '9:16',
    tracks: [{ id: 't1', type: 'video', name: 'v', clips: [clip] }],
    assets,
    schemaVersion: 6,
  }) as unknown as Project;

describe('findMissingMedia — a feloldott (asset) uri-t ellenőrzi (ADR-012)', () => {
  it('a hiányzóként jelentett uri az ASSET uri-ja (nem a klip elavult cache-e)', () => {
    const p = proj({ ...vClip({ assetId: 'ast1', uri: 'file:///stale.mp4' }) }, [
      { id: 'ast1', kind: 'video', uri: 'file:///fresh.mp4', provider: 'local' },
    ]);
    const missing = findMissingMedia(p);
    expect(missing.map((m) => m.uri)).toContain('file:///fresh.mp4');
    expect(missing.map((m) => m.uri)).not.toContain('file:///stale.mp4');
  });

  it('a http-forrást elérhetőnek veszi (nem jelenti hiányzónak)', () => {
    const p = proj({ ...vClip({ assetId: 'ast1', uri: 'file:///x.mp4' }) }, [
      { id: 'ast1', kind: 'video', uri: 'https://cdn/stream.m3u8', provider: 'remote' },
    ]);
    expect(findMissingMedia(p)).toHaveLength(0);
  });
});

describe('relinkCommandsFor — media→RELINK_ASSET, shape→RELINK_URI (ADR-012 Fázis 3)', () => {
  const withTracks = (clips: Clip[], assets: Asset[]): Project =>
    ({
      id: 'p',
      name: 't',
      aspectRatio: '9:16',
      tracks: [{ id: 't1', type: 'video', name: 'v', clips }],
      assets,
      schemaVersion: 6,
    }) as unknown as Project;

  it('media-assetre mutató uri → asset-centrikus RELINK_ASSET', () => {
    const p = withTracks([vClip({ assetId: 'ast1', uri: 'file:///old.mp4' })], [
      { id: 'ast1', kind: 'video', uri: 'file:///old.mp4', provider: 'local' },
    ]);
    const cmds = relinkCommandsFor(p, [{ oldUri: 'file:///old.mp4', newUri: 'file:///new.mp4' }]);
    expect(cmds).toEqual([{ type: 'RELINK_ASSET', assetId: 'ast1', newUri: 'file:///new.mp4' }]);
  });

  it('nem-asset uri (nincs találat) → RELINK_URI', () => {
    const p = withTracks([], []);
    const cmds = relinkCommandsFor(p, [{ oldUri: 'file:///x.png', newUri: 'file:///y.png' }]);
    expect(cmds).toEqual([{ type: 'RELINK_URI', oldUri: 'file:///x.png', newUri: 'file:///y.png' }]);
  });

  it('ha a uri-t shape.imageUri is használja → RELINK_URI (az nem asset-linkelt)', () => {
    const shape = { id: 's', kind: 'shape', start: 0, duration: 2, imageUri: 'file:///logo.png' } as unknown as Clip;
    const p = withTracks([shape], [{ id: 'ast1', kind: 'image', uri: 'file:///logo.png', provider: 'local' }]);
    const cmds = relinkCommandsFor(p, [{ oldUri: 'file:///logo.png', newUri: 'file:///logo2.png' }]);
    // még ha van is azonos uri-jú asset, a shape-involvement miatt a klip-uri-t átíró RELINK_URI megy
    expect(cmds[0].type).toBe('RELINK_URI');
  });
});
