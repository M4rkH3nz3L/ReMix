import type { ProjectVersion } from '@/lib/storage';
import { mergeVersionLists, pickVersionsToPush } from '@/lib/versionsSync';
import type { Project } from '@/types/project';

/**
 * 🕓 Verzió-szinkron mag: kézi snapshotok mennek a felhőbe (idempotensen), a
 * lista-nézet a lokális+felhő unió, idő-rendezve.
 */

const proj = { id: 'p', tracks: [], assets: [] } as unknown as Project;

function ver(id: string, at: string, kind: 'manual' | 'auto' = 'manual'): ProjectVersion {
  return { id, name: `V-${id}`, at, project: proj, kind };
}

describe('pickVersionsToPush', () => {
  it('csak a felhőből hiányzó KÉZI verziók mennek (auto sosem)', () => {
    const local = [ver('a', '2026-01-01T10:00:00Z'), ver('b', '2026-01-02T10:00:00Z'), ver('c', '2026-01-03T10:00:00Z', 'auto')];
    expect(pickVersionsToPush(local, new Set(['a'])).map((v) => v.id)).toEqual(['b']);
  });

  it('minden fent van → üres (idempotens újrahívás)', () => {
    expect(pickVersionsToPush([ver('a', '2026-01-01T00:00:00Z')], new Set(['a']))).toEqual([]);
  });
});

describe('mergeVersionLists', () => {
  it('lokális+felhő unió: a közös elem inCloud-os lokális, a csak-felhős letölthető', () => {
    const local = [ver('a', '2026-01-01T10:00:00Z'), ver('b', '2026-01-02T10:00:00Z')];
    const cloud = [
      { versionId: 'b', name: 'V-b', at: '2026-01-02T10:00:00Z', kind: 'manual' as const },
      { versionId: 'remote', name: 'Másik eszközről', at: '2026-01-03T10:00:00Z', kind: 'manual' as const },
    ];
    const merged = mergeVersionLists(local, cloud);
    expect(merged.map((m) => m.id)).toEqual(['a', 'b', 'remote']); // idő-rendezett
    expect(merged.find((m) => m.id === 'a')).toMatchObject({ inCloud: false });
    expect(merged.find((m) => m.id === 'b')).toMatchObject({ inCloud: true });
    const remote = merged.find((m) => m.id === 'remote')!;
    expect(remote.inCloud).toBe(true);
    expect(remote.local).toBeUndefined(); // visszaállítás letöltéssel
  });

  it('üres bemenetek biztonságosak', () => {
    expect(mergeVersionLists([], [])).toEqual([]);
  });
});
