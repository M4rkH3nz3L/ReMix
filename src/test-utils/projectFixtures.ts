import type { Asset, AudioClip, Clip, Project, TextClip, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🧪 Közös projekt-fixture-ök a tesztekhez (determinisztikus id-k, i18n / makeId nélkül).
 * Korábban több tesztfájlban szóról szóra ismétlődtek — itt egy helyen élnek.
 * CSAK tesztből importálható: az `isolation.test.ts` őrzi, hogy éles kód ne hivatkozzon rá.
 */

/** A szerkesztő mind a 10 alap sáv-típusa, kanonikus sorrendben. */
export const EDITOR_TRACK_TYPES: TrackType[] = [
  'video', 'pip', 'adjust', 'text', 'captions', 'overlay', 'interactive', 'music', 'voiceover', 'sfx',
];

export function track(type: TrackType, clips: Clip[] = [], id = `trk-${type}`): Track {
  return { id, type, name: type, clips };
}

/** Teljes projekt mind a 10 üres sávval; a mezők felülírhatók. */
export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Teszt',
    aspectRatio: '9:16',
    fps: 30,
    tracks: EDITOR_TRACK_TYPES.map((t) => track(t)),
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
    ...overrides,
  };
}

/** Projekt a megadott sávokkal (minden más mező alapérték). */
export function projectWithTracks(tracks: Track[]): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks, assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

export function videoClip(id: string, start = 0, duration = 10, uri = `file:///clip-${id}.mp4`): VideoClip {
  return {
    id, kind: 'video', start, duration,
    uri, trimIn: 0, sourceDuration: duration,
    speed: 1, volume: 1, filterId: 'none',
  };
}

export function audioClip(id: string, start = 0, duration = 10): AudioClip {
  return {
    id, kind: 'audio', start, duration,
    uri: `file:///audio-${id}.m4a`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported',
  };
}

export function textClip(id: string, start = 0, duration = 5): TextClip {
  return {
    id, kind: 'text', start, duration,
    text: 'Hello', color: '#fff', backgroundColor: null, fontSize: 7,
    fontWeight: 'normal', position: { x: 0.5, y: 0.5 }, animation: 'none',
  };
}

export function asset(id: string, uri: string): Asset {
  return { id, kind: 'video', uri, provider: 'local' };
}

export function clipsOf(project: Project, type: TrackType): Clip[] {
  return project.tracks.find((t) => t.type === type)!.clips;
}

/** A reducer tényleg változtatott-e, új objektummal (a bemenet érintetlen). */
export function expectChanged(before: Project, after: Project | null): Project {
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
  return after as Project;
}

/** Mélyen fagyaszt: a reducer bármilyen írása a bemenetbe TypeError-t dob (immutabilitás-próba). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
