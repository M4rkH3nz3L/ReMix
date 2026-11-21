import * as EditorStateModule from '@/store/editorState';
import { DEFAULT_SNAP_TARGETS } from '@/store/editorStateParts/editorConstants';
import { SESSION_RESET } from '@/store/editorStateParts/sessionReset';
import { touchedTrackTypes } from '@/store/editorStateParts/touchedTrackTypes';
import type { EditorCommand } from '@/lib/commands';
import type { Project, Track, TrackType } from '@/types/project';

/** 🧱 Az editorState.ts részei (REFACTOR: a konstansok, a SESSION_RESET és a touchedTrackTypes kiemelve) — a mai viselkedés rögzítve. */

const TYPES: TrackType[] = ['video', 'pip', 'text', 'music', 'sfx', 'voiceover'];
const project: Project = {
  id: 'p1',
  name: 'T',
  aspectRatio: '9:16',
  fps: 30,
  tracks: TYPES.map(
    (type): Track => ({
      id: `trk-${type}`,
      type,
      name: type,
      clips:
        type === 'music'
          ? [{ id: 'm1', kind: 'audio', start: 0, duration: 1, uri: 'u', label: 'm', volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' }]
          : [],
    })
  ),
  assets: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 6,
};
const cmd = (c: object) => c as EditorCommand;

describe('touchedTrackTypes — a zárolt-sáv őr érintett sávjai', () => {
  it.each([
    ['ADD_CLIP', { type: 'ADD_CLIP', trackType: 'text' }, ['text']],
    ['ADD_CLIPS', { type: 'ADD_CLIPS', trackType: 'sfx' }, ['sfx']],
    ['REPLACE_TRACK_CLIPS', { type: 'REPLACE_TRACK_CLIPS', trackType: 'pip' }, ['pip']],
    ['SET_TRACK_GAIN', { type: 'SET_TRACK_GAIN', trackType: 'music' }, ['music']],
    ['REPLACE_TRACKS', { type: 'REPLACE_TRACKS', tracks: [{ trackType: 'video' }, { trackType: 'sfx' }] }, ['video', 'sfx']],
    ['UPDATE_CLIP (létező klip)', { type: 'UPDATE_CLIP', clipId: 'm1' }, ['music']],
    ['REMOVE_CLIP (ismeretlen klip)', { type: 'REMOVE_CLIP', clipId: 'nincs' }, []],
    ['SPLIT_CLIP', { type: 'SPLIT_CLIP', clipId: 'm1' }, ['music']],
    ['MOVE_CLIP: forrás + cél', { type: 'MOVE_CLIP', clipId: 'm1', toTrackType: 'voiceover' }, ['music', 'voiceover']],
    ['MOVE_CLIP ismeretlen klip: csak a cél', { type: 'MOVE_CLIP', clipId: 'nincs', toTrackType: 'sfx' }, ['sfx']],
    ['nem sáv-scope-os parancs', { type: 'SET_FPS', fps: 25 }, []],
  ])('%s', (_l, c, out) => {
    expect(touchedTrackTypes(project, cmd(c))).toEqual(out);
  });
});

describe('SESSION_RESET', () => {
  it('a snapTargets az alap-célpontok MÁSOLATA (nem ugyanaz az objektum)', () => {
    expect(SESSION_RESET.snapTargets).toEqual(DEFAULT_SNAP_TARGETS);
    expect(SESSION_RESET.snapTargets).not.toBe(DEFAULT_SNAP_TARGETS);
  });
  it('a vágólapok SZÁNDÉKOSAN nincsenek benne (projektek közt átvihetők)', () => {
    expect('styleClipboard' in SESSION_RESET).toBe(false);
    expect('clipClipboard' in SESSION_RESET).toBe(false);
  });
  it('a mezők listája és alapértékei', () => {
    expect(SESSION_RESET).toMatchObject({
      multiSelectMode: false,
      trimMode: 'normal',
      snapStrength: 'normal',
      playbackRate: 1,
      masterVolume: 1,
      insightLane: 'story',
      rangeIn: null,
      rangeOut: null,
      pacingInsight: null,
    });
    expect(Object.keys(SESSION_RESET)).toHaveLength(38);
  });
});

describe('editorState barrel', () => {
  it('a futásidejű exportok listája változatlan', () => {
    expect(Object.keys(EditorStateModule).sort()).toEqual([
      'DEFAULT_SNAP_TARGETS',
      'EVENT_LIMIT',
      'HISTORY_LIMIT',
      'PROXY_MAX_SIDE',
      'REGION_COLORS',
      'SESSION_RESET',
      'SNAP_FACTOR',
      'STANDALONE_PANELS',
      'TRIM_MODES',
      'touchedTrackTypes',
    ]);
  });
});
