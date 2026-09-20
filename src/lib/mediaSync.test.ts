import { mediaRemoteMap, needsBackup } from '@/lib/mediaSync';
import type { Asset, Project } from '@/types/project';

const asset = (over: Partial<Asset>): Asset => ({
  id: 'a',
  kind: 'video',
  uri: 'file:///x.mp4',
  provider: 'local',
  ...over,
});

describe('mediaRemoteMap', () => {
  it('csak a remoteUrl-lel bíró asseteket teszi a térképbe', () => {
    const p = {
      assets: [
        asset({ uri: 'file:///a.mp4', remoteUrl: 'https://s/a.mp4' }),
        asset({ uri: 'file:///b.mp4' }),
      ],
    } as unknown as Project;
    expect(mediaRemoteMap(p)).toEqual({ 'file:///a.mp4': 'https://s/a.mp4' });
  });
});

describe('needsBackup', () => {
  it('helyi / library asset remote nélkül → kell', () => {
    expect(needsBackup(asset({ provider: 'local' }), {})).toBe(true);
    expect(needsBackup(asset({ provider: 'library' }), {})).toBe(true);
  });
  it('már van remoteUrl VAGY ismert (known) remote → nem kell', () => {
    expect(needsBackup(asset({ remoteUrl: 'https://s/x' }), {})).toBe(false);
    expect(needsBackup(asset({ uri: 'file:///x.mp4' }), { 'file:///x.mp4': 'https://s/x' })).toBe(
      false
    );
  });
  it('http-forrás / remote provider → nem kell (már a szerveren van)', () => {
    expect(needsBackup(asset({ uri: 'https://cdn/x.mp4' }), {})).toBe(false);
    expect(needsBackup(asset({ provider: 'remote' }), {})).toBe(false);
  });
});
