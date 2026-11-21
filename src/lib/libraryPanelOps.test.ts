import {
  entryRemoteUrl,
  formatSize,
  importAtSec,
  libraryQuery,
  loadingStates,
  matchesQuery,
  visibleEntries,
} from '@/lib/libraryPanelOps';
import type { StorageEntry } from '@/lib/storageProviders';

const entries: StorageEntry[] = [
  { id: 'a', name: 'Beach Clip.mp4', kind: 'video', url: '/a' },
  { id: 'b', name: 'song.mp3', kind: 'audio', url: '/b' },
  { id: 'c', name: 'Clip model.glb', kind: 'model', url: '/c' },
];

describe('libraryPanelOps — kijelzés és állapot', () => {
  it('a méret MB-ban, egy tizedessel; hiányzó vagy 0 bájt → üres', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatSize(123456)).toBe('0.1 MB');
    expect(formatSize(0)).toBe('');
    expect(formatSize(undefined)).toBe('');
  });

  it('minden forrás „töltődik" állapotból indul', () => {
    expect(loadingStates([{ id: 'x' }, { id: 'y' }])).toEqual({ x: { state: 'loading' }, y: { state: 'loading' } });
    expect(loadingStates([])).toEqual({});
  });
});

describe('libraryPanelOps — szűrés', () => {
  it('a kifejezés kisbetűs és levágott; az üres mindenre illik', () => {
    expect(libraryQuery('  CLIP ')).toBe('clip');
    expect(matchesQuery('Beach Clip.mp4', 'clip')).toBe(true);
    expect(matchesQuery('song.mp3', 'clip')).toBe(false);
    expect(matchesQuery('bármi', '')).toBe(true);
  });

  it('csak a kész forrás tételei látszanak, a 3D-modell soha', () => {
    expect(visibleEntries({ state: 'ready', entries }, '').map((e) => e.id)).toEqual(['a', 'b']);
    expect(visibleEntries({ state: 'ready', entries }, 'clip').map((e) => e.id)).toEqual(['a']);
    expect(visibleEntries({ state: 'loading' }, '')).toEqual([]);
    expect(visibleEntries({ state: 'error', message: 'x' }, '')).toEqual([]);
  });
});

describe('libraryPanelOps — import', () => {
  it('a http(s) forrás maga a remoteUrl, különben a worker-cím + út (a címet csak ekkor kéri)', () => {
    const server = jest.fn(() => 'http://w:8787');
    expect(entryRemoteUrl('https://cdn/x.mp4', '/files/x', server)).toBe('https://cdn/x.mp4');
    expect(entryRemoteUrl('HTTP://cdn/y.mp4', '/files/y', server)).toBe('HTTP://cdn/y.mp4');
    expect(server).not.toHaveBeenCalled();
    expect(entryRemoteUrl('file:///imp/x.mp4', '/files/x', server)).toBe('http://w:8787/files/x');
    expect(server).toHaveBeenCalledTimes(1);
  });

  it('a képkocka-időpont érvénytelen vagy 0 értéknél 1 mp; más fajtánál nincs', () => {
    expect(importAtSec('image', '2.5')).toBe(2.5);
    expect(importAtSec('image', '')).toBe(1);
    expect(importAtSec('image', 'abc')).toBe(1);
    expect(importAtSec('image', '0')).toBe(1);
    expect(importAtSec('video', '2.5')).toBeUndefined();
    expect(importAtSec('audio', '')).toBeUndefined();
  });
});
