import * as projectUtils from '@/lib/projectUtils';
import { CANONICAL_TRACKS, canHostClip, compatibleTracksFor } from '@/lib/projectModel/tracks';
import { CURRENT_SCHEMA_VERSION, isNewerSchema, migrateProject } from '@/lib/projectModel/schema';
import { parseHashtags, parseKeywords } from '@/lib/projectModel/tokens';
import { createEmptyProject, projectKind, studioRoute } from '@/lib/projectModel/create';
import { activeVisualClip } from '@/lib/projectModel/playhead';
import { cropClip, loopPhase } from '@/lib/projectModel/clipEdit';
import { relinkUri, replaceClip } from '@/lib/projectModel/rewrite';
import type { Clip, Project } from '@/types/project';

/** 🧱 A projekt-modell tiszta magja (REFACTOR: a src/lib/projectUtils.ts-ből kiemelve) — a mai viselkedés rögzítve. */

const legacyV1 = (): Project =>
  ({
    id: 'p',
    name: 'Régi',
    aspectRatio: '16:9',
    fps: 30,
    tracks: [
      { id: 'tv', type: 'video', name: 'v', clips: [{ id: 'c1', kind: 'video', uri: 'file:///a.mp4', start: 0, duration: 2, trimIn: 0, speed: 1, sourceDuration: 4 }] },
      {
        id: 'ta',
        type: 'audio',
        name: 'a',
        clips: [
          { id: 'vo', kind: 'audio', uri: 'file:///vo.m4a', start: 0, duration: 1, source: 'voiceover' },
          { id: 'mu', kind: 'audio', uri: 'file:///m.mp3', start: 0, duration: 1 },
        ],
      },
    ],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    schemaVersion: 1,
  }) as unknown as Project;

describe('CANONICAL_TRACKS — a kanonikus sáv-sorrend és nevek (i18n-kulcs vagy szó szerinti)', () => {
  it('pontosan a mai tíz sáv, ebben a sorrendben', () => {
    expect(CANONICAL_TRACKS).toEqual([
      { type: 'video', name: 'lib.projectUtils.trackVideo' },
      { type: 'pip', name: 'PiP' },
      { type: 'adjust', name: 'Grade' },
      { type: 'text', name: 'lib.projectUtils.trackText' },
      { type: 'captions', name: 'lib.projectUtils.trackCaptions' },
      { type: 'overlay', name: 'lib.projectUtils.trackOverlay' },
      { type: 'interactive', name: 'lib.projectUtils.trackInteractive' },
      { type: 'music', name: 'lib.projectUtils.trackMusic' },
      { type: 'voiceover', name: 'Voiceover' },
      { type: 'sfx', name: 'SFX' },
    ]);
  });

  it('a sáv-fogadás: aux-sáv csak hangot, ismeretlen sáv semmit; a kompatibilis sávok kanonikus sorrendben', () => {
    expect(canHostClip('aux3', 'audio')).toBe(true);
    expect(canHostClip('aux3', 'video')).toBe(false);
    expect(canHostClip('nope' as never, 'video')).toBe(false);
    expect(compatibleTracksFor('image')).toEqual(['video', 'pip', 'overlay']);
    expect(compatibleTracksFor('text')).toEqual(['text', 'captions']);
    expect(compatibleTracksFor('audio')).toEqual(['music', 'voiceover', 'sfx']);
  });
});

describe('séma-migráció — lépcsőzetes, a jelenlegi verzióig', () => {
  it('v1 → 10: asset-registry, a régi hang-sáv forrás szerint szétválik, minden kanonikus sáv megvan', () => {
    const out = migrateProject(legacyV1());
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBe(10);
    expect(out.kind).toBe('video');
    expect(out.tracks.map((t) => t.type)).toEqual(CANONICAL_TRACKS.map((t) => t.type));
    expect(out.tracks.find((t) => t.type === 'voiceover')!.clips.map((c) => c.id)).toEqual(['vo']);
    expect(out.tracks.find((t) => t.type === 'music')!.clips.map((c) => c.id)).toEqual(['mu']);
    // a v1-es video-sáv azonosítója megmarad
    expect(out.tracks[0].id).toBe('tv');
    expect(out.assets.map((a) => [a.uri, a.provider])).toEqual([
      ['file:///a.mp4', 'local'],
      ['file:///vo.m4a', 'local'],
      ['file:///m.mp3', 'local'],
    ]);
    expect(migrateProject(out)).toEqual(out);
  });

  it('isNewerSchema: csak a 10-nél nagyobb (számmá alakított) verzió újabb', () => {
    expect(isNewerSchema(null)).toBe(false);
    expect(isNewerSchema({ schemaVersion: 10 })).toBe(false);
    expect(isNewerSchema({ schemaVersion: '11' as never })).toBe(true);
  });
});

describe('létrehozás, fajta, tokenek', () => {
  it('kind nélküli projekt = videó; a stúdió-nélküli fajta a videó-editorra esik vissza', () => {
    expect(projectKind({})).toBe('video');
    expect(studioRoute('writing', 'x')).toBe('/editor/x');
  });

  it('az üres projekt minden fajtánál megkapja a tíz kanonikus sávot; kép-fajtánál egy image-doc', () => {
    const p = createEmptyProject('N', '9:16', undefined, 'image');
    expect(p.tracks.map((t) => t.type)).toEqual(CANONICAL_TRACKS.map((t) => t.type));
    expect(p.imageDocs).toHaveLength(1);
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect('seo' in p).toBe(false);
  });

  it('hashtag/kulcsszó: trimmelt, kis/nagybetű-érzéketlen duplikátum-szűrés, az első alak marad', () => {
    expect(parseHashtags('#Viral, viral  #fun')).toEqual(['Viral', 'fun']);
    expect(parseKeywords('Főzés, főzés , gyors recept,')).toEqual(['Főzés', 'gyors recept']);
  });
});

describe('playhead, vágás, átírás', () => {
  it('döntetlen kezdésnél a később felsorolt klip az aktív', () => {
    const clips = [
      { id: 'a', kind: 'image', uri: 'u', start: 0, duration: 2 },
      { id: 'b', kind: 'image', uri: 'u', start: 0, duration: 1 },
    ] as Clip[];
    const p = { tracks: [{ id: 't', type: 'video', name: 'v', clips }] } as unknown as Project;
    expect(activeVisualClip(p, 0.5)?.id).toBe('b');
  });

  it('cropClip hang-loopon: a trimIn marad, a fázis lép; a fade a vágott élen 0', () => {
    const c = { id: 'h', kind: 'audio', uri: 'u', start: 0, duration: 4, trimIn: 1, loopLength: 1.5, fadeIn: 0.3, fadeOut: 0.3 } as Clip;
    expect(cropClip(c, 2, 4)).toMatchObject({ start: 2, duration: 2, trimIn: 1, loopOffset: 0.5, fadeIn: 0, fadeOut: 0.3 });
    expect(loopPhase(0.75, 0.7499996)).toBe(0);
  });

  it('replaceClip/relinkUri: az érintetlen klip-objektumok identitása megmarad', () => {
    const keep = { id: 'k', kind: 'text', start: 0, duration: 1 } as unknown as Clip;
    const p = { tracks: [{ id: 't', type: 'text', name: 't', clips: [keep] }], assets: [] } as unknown as Project;
    expect(replaceClip(p, { ...keep, id: 'x' } as Clip).tracks[0].clips[0]).toBe(keep);
    expect(relinkUri(p, 'a', 'b').tracks[0].clips[0]).toBe(keep);
    expect('imageDocs' in relinkUri(p, 'a', 'b')).toBe(true);
  });
});

describe('a projectUtils.ts barrel — a régi publikus felület', () => {
  it('minden korábbi futásidejű export elérhető, a belső segédek nem', () => {
    expect(Object.keys(projectUtils).sort()).toEqual([
      'CURRENT_SCHEMA_VERSION', 'MAX_PROJECT_DURATION_SEC', 'activeAdjustClips', 'activePipClip', 'activePipClips',
      'activeTransition', 'activeVisualClip', 'canHostClip', 'clipEnd', 'clipsAt', 'compatibleTracksFor',
      'createEmptyProject', 'cropClip', 'exceedsMaxDuration', 'findAssetByUri', 'findClip', 'isNewerSchema',
      'isProjectEmpty', 'loopPhase', 'maxVideoDuration', 'migrateProject', 'parseHashtags', 'parseKeywords',
      'projectDuration', 'projectKind', 'projectMediaBytes', 'relinkUri', 'replaceClip', 'sourceTimeAt',
      'splitClip', 'studioRoute', 'trackEnd', 'trackOf', 'trimClipLeft', 'trimClipRight', 'upcomingVisualClip',
    ]);
    expect(projectUtils.MAX_PROJECT_DURATION_SEC).toBe(600);
  });
});
