import type { Project, TrackType } from '@/types/project';

import {
  AUDIBLE_TRACKS,
  AUTO_HEIGHT_FACTOR,
  COLLAPSED_H,
  contentWidthFor,
  countClips,
  firstMusicClip,
  OVERSCAN_FACTOR,
  razorCutTarget,
  RULER_HEIGHT,
  rulerMarksFor,
  trackHeightFor,
  videoTrackGaps,
  VIRTUALIZE_MIN_CLIPS,
  visibleTrackTypes,
  VISUAL_TRACKS,
} from '@/lib/timelineLayout';

/** minimális projekt: csak a sávok és a klipek számítanak a geometriához */
type ClipLike = { id: string; start: number; duration: number; kind?: string; uri?: string };
const project = (tracks: Partial<Record<TrackType, ClipLike[]>>) =>
  ({
    tracks: Object.entries(tracks).map(([type, clips]) => ({
      type,
      clips: (clips ?? []).map((c) => ({ kind: 'video', ...c })),
    })),
  }) as unknown as Project;

describe('a sáv-csoportok és küszöbök (kirögzítve)', () => {
  it('a hangos sávok: video + minden hangsáv', () => {
    expect(AUDIBLE_TRACKS).toEqual(['video', 'music', 'voiceover', 'sfx', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5']);
  });

  it('a vizuális sávok: a 7 képi sáv', () => {
    expect(VISUAL_TRACKS).toEqual(['video', 'pip', 'adjust', 'text', 'captions', 'overlay', 'interactive']);
  });

  it('a virtualizáció 60 klip fölött kapcsol, 1,5 viewport overscannel; vonalzó 22 px, összecsukott sáv 18 px', () => {
    expect(VIRTUALIZE_MIN_CLIPS).toBe(60);
    expect(OVERSCAN_FACTOR).toBe(1.5);
    expect(RULER_HEIGHT).toBe(22);
    expect(COLLAPSED_H).toBe(18);
  });

  it('az automatikus magasság szorzói', () => {
    expect(AUTO_HEIGHT_FACTOR).toEqual({
      video: 1.3,
      pip: 1.1,
      adjust: 0.8,
      text: 0.8,
      captions: 0.8,
      overlay: 0.8,
      interactive: 0.8,
      music: 1.4,
      voiceover: 1.3,
      sfx: 1,
      aux1: 1,
      aux2: 1,
      aux3: 1,
      aux4: 1,
      aux5: 1,
    });
  });
});

describe('videoTrackGaps', () => {
  it('üres sávon nincs hézag', () => {
    expect(videoTrackGaps([])).toEqual([]);
  });

  it('a vezető hézag 0-tól az első klipig tart', () => {
    expect(videoTrackGaps([{ id: 'a', start: 2, duration: 1 }])).toEqual([{ start: 0, end: 2, nextId: 'a' }]);
  });

  it('a klipek közti hézagot a KÖVETKEZŐ klip id-jével adja, rendezetlen bemenetnél is', () => {
    const gaps = videoTrackGaps([
      { id: 'b', start: 5, duration: 1 },
      { id: 'a', start: 0, duration: 3 },
    ]);
    expect(gaps).toEqual([{ start: 3, end: 5, nextId: 'b' }]);
  });

  it('0,2 mp-es (vagy kisebb) rés nem hézag, efölött már az', () => {
    expect(videoTrackGaps([{ id: 'a', start: 0.2, duration: 1 }])).toEqual([]);
    expect(videoTrackGaps([{ id: 'a', start: 0.21, duration: 1 }])).toEqual([{ start: 0, end: 0.21, nextId: 'a' }]);
  });

  it('átfedő klipnél a kurzor a legtávolabbi végre ugrik (a beágyazott klip nem hoz hamis hézagot)', () => {
    const gaps = videoTrackGaps([
      { id: 'a', start: 0, duration: 10 },
      { id: 'b', start: 2, duration: 1 },
      { id: 'c', start: 11, duration: 1 },
    ]);
    expect(gaps).toEqual([{ start: 10, end: 11, nextId: 'c' }]);
  });

  it('nem módosítja a bemenetet', () => {
    const clips = [
      { id: 'b', start: 5, duration: 1 },
      { id: 'a', start: 0, duration: 1 },
    ];
    videoTrackGaps(clips);
    expect(clips.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('firstMusicClip', () => {
  it('null / undefined projektre és zenesáv nélkül undefined', () => {
    expect(firstMusicClip(null)).toBeUndefined();
    expect(firstMusicClip(undefined)).toBeUndefined();
    expect(firstMusicClip(project({ video: [{ id: 'v', start: 0, duration: 1 }] }))).toBeUndefined();
  });

  it('a zenesáv legkorábbi HANG-klipjét adja (a nem-audio klipet átugorja)', () => {
    const p = project({
      music: [
        { id: 'late', start: 4, duration: 1, kind: 'audio', uri: 'l' },
        { id: 'img', start: 0, duration: 1, kind: 'image' },
        { id: 'early', start: 1, duration: 1, kind: 'audio', uri: 'e' },
      ],
    });
    expect(firstMusicClip(p)?.id).toBe('early');
  });

  it('csak nem-audio klip a zenesávon → undefined', () => {
    expect(firstMusicClip(project({ music: [{ id: 'x', start: 0, duration: 1, kind: 'image' }] }))).toBeUndefined();
  });
});

describe('contentWidthFor', () => {
  it('a projekt + 3 mp ráhagyás px-ben', () => {
    expect(contentWidthFor(10, 60)).toBe(13 * 60);
  });

  it('legalább 8 mp szélesség (üres / rövid projekt)', () => {
    expect(contentWidthFor(0, 60)).toBe(8 * 60);
    expect(contentWidthFor(5, 10)).toBe(80);
  });
});

describe('rulerMarksFor', () => {
  it('a lépésköz a pps-hez igazodik: ≥90 → 1, ≥40 → 2, ≥18 → 5, alatta 10 mp', () => {
    expect(rulerMarksFor(0, 90).slice(0, 3)).toEqual([0, 1, 2]);
    expect(rulerMarksFor(0, 89.9).slice(0, 3)).toEqual([0, 2, 4]);
    expect(rulerMarksFor(0, 40).slice(0, 3)).toEqual([0, 2, 4]);
    expect(rulerMarksFor(0, 39).slice(0, 2)).toEqual([0, 5]);
    expect(rulerMarksFor(0, 18).slice(0, 2)).toEqual([0, 5]);
    expect(rulerMarksFor(0, 17)).toEqual([0]);
  });

  it('a 0-tól a (hossz + 3, de legalább 8) mp-ig tart, a végpontot is beleértve', () => {
    expect(rulerMarksFor(0, 100)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rulerMarksFor(7, 60)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(rulerMarksFor(25, 20)).toEqual([0, 5, 10, 15, 20, 25]);
  });
});

describe('visibleTrackTypes', () => {
  it('a videósáv mindig látszik, akkor is, ha nincs is ilyen sáv', () => {
    expect(visibleTrackTypes(project({}))).toEqual(['video']);
  });

  it('csak a klipet tartalmazó sávok jelennek meg, a trackOrder sorrendjében', () => {
    const p = project({
      sfx: [{ id: 's', start: 0, duration: 1 }],
      text: [{ id: 't', start: 0, duration: 1 }],
      music: [],
      pip: [{ id: 'p', start: 0, duration: 1 }],
    });
    expect(visibleTrackTypes(p)).toEqual(['video', 'pip', 'text', 'sfx']);
  });
});

describe('trackHeightFor', () => {
  const base = { collapsedTracks: [] as TrackType[], trackScale: 1, autoTrackHeight: false, trackHeightScale: {} };

  it('alapértéken a trackHeights × trackScale (kerekítve)', () => {
    expect(trackHeightFor('video', base)).toBe(52);
    expect(trackHeightFor('video', { ...base, trackScale: 1.25 })).toBe(65);
    expect(trackHeightFor('text', { ...base, trackScale: 1.1 })).toBe(33);
  });

  it('a sávonkénti kézi skála érvényesül, hiányában 1', () => {
    expect(trackHeightFor('music', { ...base, trackHeightScale: { music: 1.5 } })).toBe(63);
    expect(trackHeightFor('sfx', { ...base, trackHeightScale: { music: 1.5 } })).toBe(30);
  });

  it('automatikus magasságnál a kézi skálát felülírja az AUTO szorzó', () => {
    expect(trackHeightFor('music', { ...base, autoTrackHeight: true, trackHeightScale: { music: 3 } })).toBe(59);
    expect(trackHeightFor('text', { ...base, autoTrackHeight: true })).toBe(24);
  });

  it('összecsukott sáv fix 18 px, skálától függetlenül', () => {
    expect(
      trackHeightFor('video', { ...base, collapsedTracks: ['video'], trackScale: 2, trackHeightScale: { video: 3 } })
    ).toBe(COLLAPSED_H);
  });
});

describe('countClips', () => {
  it('null / undefined projektre 0', () => {
    expect(countClips(null)).toBe(0);
    expect(countClips(undefined)).toBe(0);
  });

  it('az összes sáv klipjeit összeadja', () => {
    const p = project({
      video: [
        { id: 'a', start: 0, duration: 1 },
        { id: 'b', start: 1, duration: 1 },
      ],
      music: [{ id: 'm', start: 0, duration: 1 }],
      text: [],
    });
    expect(countClips(p)).toBe(3);
  });
});

describe('razorCutTarget', () => {
  const p = project({
    video: [
      { id: 'a', start: 0, duration: 4 },
      { id: 'b', start: 4, duration: 2 },
    ],
  });

  it('a lefedő klipet és a századra kerekített időt adja', () => {
    expect(razorCutTarget(p, [], 'video', 1.23456)).toEqual({ clipId: 'a', time: 1.23 });
    expect(razorCutTarget(p, [], 'video', 4.996)).toEqual({ clipId: 'b', time: 5 });
  });

  it('a klip széleitől 0,05 mp-en belül (és pontosan a határon) nem vág', () => {
    expect(razorCutTarget(p, [], 'video', 0.05)).toBeNull();
    expect(razorCutTarget(p, [], 'video', 3.96)).toBeNull();
    expect(razorCutTarget(p, [], 'video', 4.02)).toBeNull();
    expect(razorCutTarget(p, [], 'video', 0.06)).toEqual({ clipId: 'a', time: 0.06 });
  });

  it('zárolt sávon, hiányzó sávon, klipen kívül és projekt nélkül null', () => {
    expect(razorCutTarget(p, ['video'], 'video', 2)).toBeNull();
    expect(razorCutTarget(p, [], 'music', 2)).toBeNull();
    expect(razorCutTarget(p, [], 'video', 10)).toBeNull();
    expect(razorCutTarget(null, [], 'video', 2)).toBeNull();
  });

  it('másik sáv zárolása nem gátolja a vágást', () => {
    expect(razorCutTarget(p, ['music'], 'video', 2)).toEqual({ clipId: 'a', time: 2 });
  });
});
