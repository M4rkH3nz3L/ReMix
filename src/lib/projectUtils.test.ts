import { applyCommand } from '@/lib/commands';
import {
  isProjectEmpty,
  maxVideoDuration,
  projectDuration,
  projectMediaBytes,
  sourceTimeAt,
  splitClip,
  trimClipLeft,
  trimClipRight,
  upcomingVisualClip,
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

describe('splitClip — trimIn a vágásnál (előre ÉS reversed, forrás-ablak folytonosság)', () => {
  // start=0, dur=10, trimIn=2, speed=1 → forrás-szakasz [2,12]
  const base = (over: Partial<VideoClip>): VideoClip =>
    mkVideo({ id: 'c', start: 0, duration: 10, trimIn: 2, sourceDuration: 20, speed: 1, ...over });

  it('ELŐRE: a két fél a [2,12] szakaszt összefüggően fedi (first [2,6], second [6,12])', () => {
    const [first, second] = splitClip(base({}), 4) as [VideoClip, VideoClip];
    expect(first.trimIn).toBe(2); // változatlan
    expect(second.trimIn).toBe(6); // 2 + 4*1
    // határ-folytonosság: a vágásnál (t=4) mindkét fél ugyanazt a forrás-időt adja
    expect(sourceTimeAt(first, 4)).toBeCloseTo(sourceTimeAt(base({}), 4));
    expect(sourceTimeAt(second, 4)).toBeCloseTo(sourceTimeAt(base({}), 4));
  });

  it('⏪ REVERSED: a MÁSODIK fél éri el a trimIn-t (first.trimIn=8, second.trimIn=2)', () => {
    const clip = base({ reversed: true });
    const [first, second] = splitClip(clip, 4) as [VideoClip, VideoClip];
    // a bug előtt: first.trimIn=2, second.trimIn=6 (rossz forrás-ablak)
    expect(first.trimIn).toBe(8); // 2 + (10-4)*1
    expect(second.trimIn).toBe(2); // változatlan (a reversed vég éri el a trimIn-t)
    // a reversed klip végpontjai + a határ-folytonosság helyesek
    expect(sourceTimeAt(first, 0)).toBeCloseTo(sourceTimeAt(clip, 0)); // t=0 → 12
    expect(sourceTimeAt(second, 10)).toBeCloseTo(sourceTimeAt(clip, 10)); // t=10 → 2
    expect(sourceTimeAt(first, 4)).toBeCloseTo(sourceTimeAt(clip, 4)); // határ → 8
    expect(sourceTimeAt(second, 4)).toBeCloseTo(sourceTimeAt(clip, 4)); // határ → 8
  });

  it('⏪ REVERSED + speed=2: a trimIn-ofszetek a sebességgel skálázódnak', () => {
    const clip = base({ reversed: true, speed: 2 });
    const [first, second] = splitClip(clip, 4) as [VideoClip, VideoClip];
    expect(first.trimIn).toBe(2 + (10 - 4) * 2); // 14
    expect(second.trimIn).toBe(2);
    expect(sourceTimeAt(first, 4)).toBeCloseTo(sourceTimeAt(clip, 4));
    expect(sourceTimeAt(second, 4)).toBeCloseTo(sourceTimeAt(clip, 4));
  });
});

describe('trimClipLeft / trimClipRight — forrás-ablak (előre + reversed, él-tartalom fix)', () => {
  const v = (over: Partial<VideoClip>): VideoClip =>
    mkVideo({ id: 'c', start: 0, duration: 10, trimIn: 2, sourceDuration: 20, speed: 1, ...over });
  const applyL = (c: VideoClip, p: { start: number; duration: number; trimIn: number }): VideoClip =>
    ({ ...c, ...p });
  const applyR = (c: VideoClip, p: { duration: number; trimIn: number }): VideoClip => ({ ...c, ...p });

  it('bal-trim ELŐRE: a jobb él forrás-tartalma változatlan, trimIn nő', () => {
    const c = v({});
    const p = trimClipLeft(c, 3);
    expect(p.trimIn).toBe(5); // 2 + 3*1
    const n = applyL(c, p);
    // a jobb él (idővonal t=10) ugyanazt a forrás-időt adja
    expect(sourceTimeAt(n, 10)).toBeCloseTo(sourceTimeAt(c, 10));
  });

  it('⏪ bal-trim REVERSED: a trimIn VÁLTOZATLAN, a jobb él tartalma fix', () => {
    const c = v({ reversed: true });
    const p = trimClipLeft(c, 3);
    expect(p.trimIn).toBe(2); // reversednél a jobb él tartja a trimIn-t
    const n = applyL(c, p);
    expect(sourceTimeAt(n, 10)).toBeCloseTo(sourceTimeAt(c, 10)); // t=10 → 2 mindkettőn
  });

  it('jobb-trim ELŐRE: a trimIn fix, a bal él tartalma változatlan', () => {
    const c = v({});
    const p = trimClipRight(c, 6);
    expect(p.trimIn).toBe(2);
    expect(p.duration).toBe(6);
    const n = applyR(c, p);
    expect(sourceTimeAt(n, 0)).toBeCloseTo(sourceTimeAt(c, 0)); // bal él t=0 → 2
  });

  it('⏪ jobb-trim REVERSED: a trimIn együtt mozog, a bal él (felső bound) fix', () => {
    const c = v({ reversed: true });
    const p = trimClipRight(c, 6);
    expect(p.trimIn).toBe(6); // 2 + (10-6)*1
    const n = applyR(c, p);
    expect(sourceTimeAt(n, 0)).toBeCloseTo(sourceTimeAt(c, 0)); // bal él t=0 → 12 mindkettőn
  });

  it('⏪ reversed clampok: jobb-trim nem viszi 0 alá a trimIn-t; bal-trim nem lépi túl a forrást', () => {
    // jobb-trim nyújtás: maxD = duration + trimIn/speed = 10 + 2 = 12 → trimIn 0-ra clampel
    const r1 = trimClipRight(v({ reversed: true }), 20);
    expect(r1.duration).toBe(12);
    expect(r1.trimIn).toBe(0);
    // bal-trim nyújtás: a felső bound ≤ sourceDuration (minDelta = duration - maxVideoDuration)
    const c = v({ reversed: true, start: 10 }); // maxVideoDuration=(20-2)/1=18, minDelta=10-18=-8
    const r2 = trimClipLeft(c, -10); // -8-ra clampel
    expect(r2.start).toBe(2);
    expect(r2.duration).toBe(18);
    expect(r2.trimIn + r2.duration * c.speed).toBeCloseTo(c.sourceDuration); // felső bound = 20
  });
});

describe('upcomingVisualClip — gapless-előtöltés (EDITOR-UX §2.6)', () => {
  // videó-sáv: c1 [0,5), c2 [5,10), c3 [20,25)
  const multi = (): Project =>
    ({
      ...mkProject(1),
      tracks: [
        {
          id: 't1',
          type: 'video',
          name: 'v',
          clips: [
            { id: 'c1', kind: 'video', start: 0, duration: 5, uri: 'a' },
            { id: 'c2', kind: 'video', start: 5, duration: 5, uri: 'b' },
            { id: 'c3', kind: 'image', start: 20, duration: 5, uri: 'c' },
          ],
        },
      ],
    }) as unknown as Project;

  it('null, ha a következő klip még az ablakon kívül van', () => {
    // t=3, c2 kezdete 5 > 3+1 → még ne töltsük elő
    expect(upcomingVisualClip(multi(), 3, 1)).toBeNull();
  });

  it('a soron következő klipet adja, ha a lookahead-ablakba lóg', () => {
    expect(upcomingVisualClip(multi(), 4.5, 1)?.id).toBe('c2');
    expect(upcomingVisualClip(multi(), 3, 3)?.id).toBe('c2');
  });

  it('a LEGKÖZELEBBI jövőbeli klipet választja (nem a távolabbit)', () => {
    // t=3, nagy ablak: c2 (5) van közelebb, nem c3 (20)
    expect(upcomingVisualClip(multi(), 3, 100)?.id).toBe('c2');
  });

  it('kép-klipet is előtölt (image a videó-sávon)', () => {
    expect(upcomingVisualClip(multi(), 17, 5)?.id).toBe('c3');
  });

  it('null a már aktív / épp most kezdődő klipre (start ≤ t)', () => {
    // t=5 épp a c2 kezdete → az nem „jövőbeli"; c3 túl messze
    expect(upcomingVisualClip(multi(), 5, 1)).toBeNull();
  });

  it('null az utolsó klip után', () => {
    expect(upcomingVisualClip(multi(), 30, 10)).toBeNull();
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
