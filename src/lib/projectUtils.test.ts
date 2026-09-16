import { applyCommand } from '@/lib/commands';
import { projectDuration } from '@/lib/projectUtils';
import type { Project } from '@/types/project';

const mkProject = (clipDuration: number): Project =>
  ({
    id: 'p',
    name: 'teszt',
    aspectRatio: '9:16',
    tracks: [
      {
        id: 't1',
        type: 'video',
        name: 'v',
        clips: [{ id: 'c1', kind: 'video', start: 0, duration: clipDuration }],
      },
      { id: 't2', type: 'captions', name: 'f', clips: [] },
    ],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 5,
  }) as unknown as Project;

describe('projectDuration — memoizált hossz', () => {
  it('a leghosszabb sáv végét adja', () => {
    expect(projectDuration(mkProject(7.5))).toBe(7.5);
  });

  it('üres projekt hossza 0', () => {
    const empty = { ...mkProject(1), tracks: [] } as unknown as Project;
    expect(projectDuration(empty)).toBe(0);
  });

  it('ugyanarra az objektumra ugyanazt adja (cache-találat)', () => {
    const p = mkProject(4);
    expect(projectDuration(p)).toBe(projectDuration(p));
  });

  it('⚠️ A HELYESSÉG FELTÉTELE: a command bus ÚJ objektumot ad → friss hossz', () => {
    const p = mkProject(4);
    expect(projectDuration(p)).toBe(4);

    // a klip meghosszabbítása a command buson át
    const next = applyCommand(p, {
      type: 'UPDATE_CLIP',
      clipId: 'c1',
      patch: { duration: 9 },
    });

    expect(next).not.toBeNull();
    expect(next).not.toBe(p); // ÚJ objektum — enélkül a cache elavulna
    expect(projectDuration(next!)).toBe(9);
    expect(projectDuration(p)).toBe(4); // a régi példány hossza változatlan
  });

  it('klip hozzáadása után is friss az érték', () => {
    const p = mkProject(3);
    const next = applyCommand(p, {
      type: 'ADD_CLIPS',
      trackType: 'video',
      clips: [{ id: 'c2', kind: 'video', start: 3, duration: 5 } as never],
    });
    expect(projectDuration(next!)).toBe(8);
  });
});
