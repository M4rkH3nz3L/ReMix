import {
  PASTE_FALLBACK_TRACK,
  PIP_CORNERS,
  adjustStartFor,
  duplicatedTracks,
  pipCornerFor,
  promoteTutorialTool,
  tracksWithoutClips,
} from '@/lib/toolbarOps';
import type { ToolId } from '@/lib/toolbarSpec';
import type { AdjustClip, Clip, Project, TextClip, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🧰 A szerkesztő-eszköztár tiszta magjának regressziós pajzsa (a bontás előtti
 * viselkedés rögzítve): PiP-sarok, grade-kezdés, beillesztési cél-sáv, kötegelt
 * duplikálás/törlés sávlistája és a tutorial-előléptetés.
 */

function track(type: TrackType, clips: Clip[] = [], id = `trk-${type}`): Track {
  return { id, type, name: type, clips };
}

function videoClip(id: string, start = 0, duration = 5): VideoClip {
  return {
    id, kind: 'video', start, duration,
    uri: `file:///clip-${id}.mp4`, trimIn: 0, sourceDuration: duration,
    speed: 1, volume: 1, filterId: 'none',
  };
}

function textClip(id: string, start = 0, duration = 5): TextClip {
  return {
    id, kind: 'text', start, duration,
    text: 'Hello', color: '#fff', backgroundColor: null, fontSize: 7,
    fontWeight: 'normal', position: { x: 0.5, y: 0.5 }, animation: 'none',
  };
}

function adjustClip(id: string, start: number, duration: number): AdjustClip {
  return { id, kind: 'adjust', start, duration, adjust: {} } as AdjustClip;
}

function makeProject(tracks: Track[]): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks, assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

describe('pipCornerFor — a következő PiP sarka', () => {
  it('a négy sarok sorrendje: jobb-fent, bal-fent, jobb-lent, bal-lent', () => {
    expect(PIP_CORNERS).toEqual([
      { x: 0.3, y: -0.32 },
      { x: -0.3, y: -0.32 },
      { x: 0.3, y: 0.32 },
      { x: -0.3, y: 0.32 },
    ]);
  });

  it('üres pip-sávnál az első sarok', () => {
    expect(pipCornerFor(makeProject([track('pip')]))).toEqual({ x: 0.3, y: -0.32 });
  });

  it('pip-sáv nélkül (régi projekt) is az első sarok', () => {
    expect(pipCornerFor(makeProject([track('video')]))).toEqual({ x: 0.3, y: -0.32 });
  });

  it('a klipszám szerint körbejár (4 után újra az első)', () => {
    const withPips = (n: number) =>
      makeProject([track('pip', Array.from({ length: n }, (_, i) => videoClip(`p${i}`, i * 10)))]);
    expect(pipCornerFor(withPips(1))).toEqual({ x: -0.3, y: -0.32 });
    expect(pipCornerFor(withPips(2))).toEqual({ x: 0.3, y: 0.32 });
    expect(pipCornerFor(withPips(3))).toEqual({ x: -0.3, y: 0.32 });
    expect(pipCornerFor(withPips(4))).toEqual({ x: 0.3, y: -0.32 });
    expect(pipCornerFor(withPips(7))).toEqual({ x: -0.3, y: 0.32 });
  });
});

describe('adjustStartFor — az új grade-réteg kezdete', () => {
  it('üres adjust-sávnál a lejátszófej', () => {
    expect(adjustStartFor(track('adjust'), 2.5)).toBe(2.5);
  });

  it('ha a sáv a lejátszófejen túl tart, a sáv végénél kezd (nem fed át)', () => {
    expect(adjustStartFor(track('adjust', [adjustClip('a', 1, 4)]), 2)).toBe(5);
  });

  it('ha a sáv a lejátszófej előtt véget ér, a lejátszófejnél kezd', () => {
    expect(adjustStartFor(track('adjust', [adjustClip('a', 0, 1)]), 3)).toBe(3);
  });

  it('pontosan a lejátszófejen végződő sávnál a lejátszófej', () => {
    expect(adjustStartFor(track('adjust', [adjustClip('a', 0, 3)]), 3)).toBe(3);
  });
});

describe('PASTE_FALLBACK_TRACK — beillesztési cél-sáv kijelölés nélkül', () => {
  it('minden klip-fajtához a rögzített alap-sáv', () => {
    expect(PASTE_FALLBACK_TRACK).toEqual({
      video: 'video',
      image: 'video',
      audio: 'music',
      text: 'text',
      shape: 'overlay',
      adjust: 'adjust',
      interactive: 'interactive',
    });
  });
});

describe('duplicatedTracks — kötegelt duplikálás', () => {
  it('a másolatok a kijelölés UTÁN, a relatív távolságot megtartva', () => {
    const project = makeProject([
      track('video', [videoClip('a', 0, 2), videoClip('b', 4, 2)]),
    ]);
    const tracks = duplicatedTracks(project, ['a', 'b']);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].trackType).toBe('video');
    // offset = a kijelölés teljes hossza (0..6 → 6)
    expect(tracks[0].clips.map((c) => c.start)).toEqual([0, 4, 6, 10]);
    expect(tracks[0].clips.slice(0, 2).map((c) => c.id)).toEqual(['a', 'b']);
    const copies = tracks[0].clips.slice(2);
    expect(copies.every((c) => c.id.startsWith('clip_'))).toBe(true);
    expect(new Set(copies.map((c) => c.id)).size).toBe(2);
  });

  it('több sávon: sávonként egy bejegyzés, a sáv meglévő klipjei megmaradnak, rendezve', () => {
    const project = makeProject([
      track('video', [videoClip('a', 0, 2), videoClip('z', 20, 1)]),
      track('text', [textClip('t', 1, 1)]),
    ]);
    const tracks = duplicatedTracks(project, ['a', 't']);
    expect(tracks.map((t) => t.trackType)).toEqual(['video', 'text']);
    // offset = 0..2 → 2
    expect(tracks[0].clips.map((c) => c.start)).toEqual([0, 2, 20]);
    expect(tracks[0].clips[2].id).toBe('z');
    expect(tracks[1].clips.map((c) => c.start)).toEqual([1, 3]);
  });

  it('a sorrend az első kijelölt klip sávjáét követi', () => {
    const project = makeProject([
      track('video', [videoClip('a', 0, 2)]),
      track('text', [textClip('t', 1, 1)]),
    ]);
    expect(duplicatedTracks(project, ['t', 'a']).map((t) => t.trackType)).toEqual(['text', 'video']);
  });

  it('a nem létező azonosító kimarad; ha semmi sem található, üres a lista', () => {
    const project = makeProject([track('video', [videoClip('a', 0, 2)])]);
    expect(duplicatedTracks(project, ['nincs'])).toEqual([]);
    const tracks = duplicatedTracks(project, ['a', 'nincs']);
    expect(tracks[0].clips.map((c) => c.start)).toEqual([0, 2]);
  });

  it('nem módosítja a bemeneti projektet', () => {
    const clips = [videoClip('a', 0, 2), videoClip('b', 4, 2)];
    const project = makeProject([track('video', clips)]);
    duplicatedTracks(project, ['a', 'b']);
    expect(project.tracks[0].clips).toBe(clips);
    expect(clips.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('tracksWithoutClips — kötegelt törlés', () => {
  it('csak az érintett sávok, a törölt klipek nélkül', () => {
    const project = makeProject([
      track('video', [videoClip('a', 0, 2), videoClip('b', 2, 2)]),
      track('text', [textClip('t', 0, 1)]),
      track('music'),
    ]);
    expect(tracksWithoutClips(project, new Set(['a', 't']))).toEqual([
      { trackType: 'video', clips: [videoClip('b', 2, 2)] },
      { trackType: 'text', clips: [] },
    ]);
  });

  it('üres halmaznál üres lista', () => {
    const project = makeProject([track('video', [videoClip('a')])]);
    expect(tracksWithoutClips(project, new Set())).toEqual([]);
  });
});

describe('promoteTutorialTool — tutorial-előléptetés', () => {
  const layout = { primary: ['split', 'speed'] as ToolId[], overflow: ['filter', 'duplicate', 'ripple'] as ToolId[] };
  const tutorialIdOf = (id: ToolId) => (id === 'duplicate' ? 'tut.dup' : id === 'split' ? 'tut.split' : undefined);

  it('nincs aktív cél → a layout változatlanul (azonos tömbök)', () => {
    const r = promoteTutorialTool(layout, tutorialIdOf, null);
    expect(r.rowTools).toBe(layout.primary);
    expect(r.moreTools).toBe(layout.overflow);
  });

  it('a „Több" alatti célpont a sor VÉGÉRE kerül, és kiesik a „Több"-ből', () => {
    const r = promoteTutorialTool(layout, tutorialIdOf, 'tut.dup');
    expect(r.rowTools).toEqual(['split', 'speed', 'duplicate']);
    expect(r.moreTools).toEqual(['filter', 'ripple']);
  });

  it('az elöl lévő célpontnál nincs változás', () => {
    const r = promoteTutorialTool(layout, tutorialIdOf, 'tut.split');
    expect(r.rowTools).toBe(layout.primary);
    expect(r.moreTools).toBe(layout.overflow);
  });

  it('ismeretlen célpontnál nincs változás', () => {
    const r = promoteTutorialTool(layout, tutorialIdOf, 'tut.nincs');
    expect(r.rowTools).toBe(layout.primary);
    expect(r.moreTools).toBe(layout.overflow);
  });
});
