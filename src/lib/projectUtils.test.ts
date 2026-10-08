import { applyCommand } from '@/lib/commands';
import {
  isProjectEmpty,
  maxVideoDuration,
  projectDuration,
  projectMediaBytes,
  sourceTimeAt,
} from '@/lib/projectUtils';
import type { Asset, Project, VideoClip } from '@/types/project';

/** VideoClip-fixture a source-idő tesztekhez. */
const mkVideo = (over: Partial<VideoClip> = {}): VideoClip =>
  ({
    id: 'v',
    kind: 'video',
    start: 2,
    duration: 4,
    uri: 'file://x.mp4',
    trimIn: 1,
    sourceDuration: 10,
    speed: 1,
    volume: 1,
    ...over,
  }) as VideoClip;

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

describe('isProjectEmpty — onboarding-kapu (EDITOR-UX §2.5)', () => {
  it('false, ha van legalább egy klip bármelyik sávon', () => {
    expect(isProjectEmpty(mkProject(4))).toBe(false);
  });

  it('true, ha minden sáv üres', () => {
    const empty = {
      ...mkProject(1),
      tracks: [
        { id: 't1', type: 'video', name: 'v', clips: [] },
        { id: 't2', type: 'captions', name: 'f', clips: [] },
      ],
    } as unknown as Project;
    expect(isProjectEmpty(empty)).toBe(true);
  });

  it('true, ha egyáltalán nincs sáv', () => {
    const noTracks = { ...mkProject(1), tracks: [] } as unknown as Project;
    expect(isProjectEmpty(noTracks)).toBe(true);
  });

  it('a klip eltávolítása után újra üres (command bus → friss állapot)', () => {
    const p = mkProject(4);
    const next = applyCommand(p, { type: 'REMOVE_CLIP', clipId: 'c1' });
    expect(next).not.toBeNull();
    expect(isProjectEmpty(next!)).toBe(true);
  });
});

describe('projectMediaBytes', () => {
  const ast = (over: Partial<Asset>): Asset => ({
    id: 'a',
    kind: 'video',
    uri: 'file:///x.mp4',
    provider: 'local',
    ...over,
  });
  const withAssets = (assets: Asset[]): Project =>
    ({ ...mkProject(1), assets } as unknown as Project);

  it('az ismert asset.size-okat összegzi', () => {
    const p = withAssets([
      ast({ uri: 'file:///a.mp4', size: 100 }),
      ast({ uri: 'file:///b.mp4', size: 250 }),
    ]);
    expect(projectMediaBytes(p)).toBe(350);
  });

  it('a size nélküli asseteket 0-nak veszi', () => {
    const p = withAssets([ast({ uri: 'file:///a.mp4', size: 100 }), ast({ uri: 'file:///b.mp4' })]);
    expect(projectMediaBytes(p)).toBe(100);
  });

  it('uri szerint deduplikál (nem számol duplán)', () => {
    const p = withAssets([
      ast({ uri: 'file:///a.mp4', size: 100 }),
      ast({ uri: 'file:///a.mp4', size: 100 }),
    ]);
    expect(projectMediaBytes(p)).toBe(100);
  });
});

describe('sourceTimeAt — idővonal→forrás leképezés (freeze/reverse, audit §6.3)', () => {
  it('normál: trimIn + (t-start)*speed', () => {
    const c = mkVideo({ speed: 1 });
    expect(sourceTimeAt(c, 2)).toBe(1); // t=start → trimIn
    expect(sourceTimeAt(c, 4)).toBe(3);
    expect(sourceTimeAt(c, 6)).toBe(5); // t=end → trimIn + dur*speed
  });

  it('normál speed=2: kétszeres forrás-előrehaladás', () => {
    const c = mkVideo({ speed: 2 });
    expect(sourceTimeAt(c, 2)).toBe(1);
    expect(sourceTimeAt(c, 4)).toBe(5); // 1 + 2*2
  });

  it('⏪ reversed: t=start → UTOLSÓ kocka, t=end → ELSŐ kocka', () => {
    const c = mkVideo({ reversed: true, speed: 1 });
    expect(sourceTimeAt(c, 2)).toBe(5); // start → trimIn + dur*speed
    expect(sourceTimeAt(c, 6)).toBe(1); // end → trimIn
    expect(sourceTimeAt(c, 4)).toBe(3); // közép tükör
  });

  it('⏪ reversed a normál tükörképe a klip-ablakon belül', () => {
    const fwd = mkVideo({ speed: 1 });
    const rev = mkVideo({ reversed: true, speed: 1 });
    for (const t of [2, 3, 4, 5, 6]) {
      // fwd(t) + rev(t) = 2*trimIn + dur*speed = 2*1 + 4 = 6
      expect(sourceTimeAt(fwd, t) + sourceTimeAt(rev, t)).toBeCloseTo(6);
    }
  });
});

describe('maxVideoDuration — trim-korlát', () => {
  it('normál: (sourceDuration - trimIn)/speed', () => {
    expect(maxVideoDuration(mkVideo({ speed: 1 }))).toBe(9); // (10-1)/1
    expect(maxVideoDuration(mkVideo({ speed: 2 }))).toBe(4.5); // (10-1)/2
  });
});
