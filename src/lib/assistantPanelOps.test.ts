import {
  QUICK_ACTIONS,
  SOCIAL_PRESETS,
  aiReplyCommands,
  firstMusicClip,
  firstVideoClip,
  variantKeepSeconds,
  variantPreviewRanges,
  videoUris,
} from '@/lib/assistantPanelOps';
import type { AiCommand } from '@/lib/aiCommands';
import type { AutoEditVariant } from '@/lib/autoedit';
import type { AudioClip, Clip, ImageClip, Project, TextClip, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🤖 Az AI-asszisztens panel tiszta magjának regressziós pajzsa (a bontás előtti
 * viselkedés rögzítve): konstansok, a projektből olvasó segédek, a változat-
 * előnézet sávjai és az AI-válasz → EditorCommand-köteg leképezés.
 */

function track(type: TrackType, clips: Clip[] = [], id = `trk-${type}`): Track {
  return { id, type, name: type, clips };
}

function videoClip(id: string, start = 0, duration = 5, uri = `file:///clip-${id}.mp4`): VideoClip {
  return {
    id, kind: 'video', start, duration,
    uri, trimIn: 0, sourceDuration: duration,
    speed: 1, volume: 1, filterId: 'none',
  };
}

function imageClip(id: string): ImageClip {
  return { id, kind: 'image', start: 0, duration: 3, uri: `file:///img-${id}.png` } as ImageClip;
}

function textClip(id: string, start = 0, duration = 5): TextClip {
  return {
    id, kind: 'text', start, duration,
    text: 'Hello', color: '#fff', backgroundColor: null, fontSize: 7,
    fontWeight: 'normal', position: { x: 0.5, y: 0.5 }, animation: 'none',
  };
}

function audioClip(id: string, start = 0, duration = 5): AudioClip {
  return {
    id, kind: 'audio', start, duration,
    uri: `file:///audio-${id}.m4a`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported',
  };
}

function makeProject(tracks: Track[]): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks, assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

function variant(keep: { start: number; end: number }[], captions = 0): AutoEditVariant {
  return {
    id: 'v1',
    title: 'V',
    rationale: 'r',
    keep,
    captions: Array.from({ length: captions }, () => ({})),
  } as unknown as AutoEditVariant;
}

describe('konstansok', () => {
  it('a gyors-műveletek kulcsai és sorrendje változatlan', () => {
    expect(QUICK_ACTIONS).toEqual(['makeEngaging', 'shorten30', 'addTitleCta', 'captionsLowerThird', 'unifyCaptions']);
  });

  it('a közösségi presetek platform → képarány párosa változatlan', () => {
    expect(SOCIAL_PRESETS.map((p) => [p.id, p.label, p.aspect])).toEqual([
      ['tiktok', 'TikTok', '9:16'],
      ['reels', 'Reels', '9:16'],
      ['shorts', 'Shorts', '9:16'],
      ['youtube', 'YouTube', '16:9'],
      ['instagram', 'Instagram', '1:1'],
    ]);
  });
});

describe('videoUris', () => {
  it('csak a videósávok videóklipjei, egyedi URI-val, első előfordulás sorrendjében', () => {
    const p = makeProject([
      track('video', [videoClip('a', 0, 5, 'file:///x.mp4'), imageClip('i'), videoClip('b', 5, 5, 'file:///y.mp4')]),
      track('overlay', [videoClip('o', 0, 5, 'file:///overlay.mp4')]),
      track('video', [videoClip('c', 0, 5, 'file:///x.mp4'), videoClip('d', 5, 5, 'file:///z.mp4')], 'trk-video-2'),
    ]);
    expect(videoUris(p)).toEqual(['file:///x.mp4', 'file:///y.mp4', 'file:///z.mp4']);
  });

  it('videóklip nélkül üres lista', () => {
    expect(videoUris(makeProject([track('video', [imageClip('i')]), track('text', [textClip('t')])]))).toEqual([]);
  });
});

describe('firstVideoClip', () => {
  it('null / undefined projektre undefined', () => {
    expect(firstVideoClip(null)).toBeUndefined();
    expect(firstVideoClip(undefined)).toBeUndefined();
  });

  it('az első videósáv első VIDEÓ-klipje (a kép-klipet átugorja), nem a legkorábban induló', () => {
    const p = makeProject([
      track('overlay', [videoClip('o')]),
      track('video', [imageClip('i'), videoClip('late', 9)]),
      track('video', [videoClip('early', 0)], 'trk-video-2'),
    ]);
    expect(firstVideoClip(p)?.id).toBe('late');
  });

  it('videósáv nélkül undefined', () => {
    expect(firstVideoClip(makeProject([track('music', [audioClip('m')])]))).toBeUndefined();
  });
});

describe('firstMusicClip', () => {
  it('a zenesáv(ok) LEGKORÁBBAN induló hangklipje', () => {
    const p = makeProject([
      track('voiceover', [audioClip('vo', 0)]),
      track('music', [audioClip('m2', 4), audioClip('m1', 1)]),
      track('music', [audioClip('m0', 2)], 'trk-music-2'),
    ]);
    expect(firstMusicClip(p)?.id).toBe('m1');
  });

  it('zene nélkül undefined (a hangalámondás nem számít)', () => {
    expect(firstMusicClip(makeProject([track('voiceover', [audioClip('vo')])]))).toBeUndefined();
    expect(firstMusicClip(makeProject([track('music')]))).toBeUndefined();
  });

  it('nem rontja el a projekt klip-sorrendjét (a rendezés másolaton fut)', () => {
    const music = track('music', [audioClip('b', 4), audioClip('a', 1)]);
    firstMusicClip(makeProject([music]));
    expect(music.clips.map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('variantPreviewRanges', () => {
  it('a keep-sávokat [0, hossz] közé vágja, sorrendtartóan', () => {
    expect(variantPreviewRanges(variant([{ start: -2, end: 3 }, { start: 8, end: 20 }]), 10)).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 10 },
    ]);
  });

  it('a 0,05 s-os vagy rövidebb (és a projekten kívüli) sávok kiesnek', () => {
    expect(
      variantPreviewRanges(
        variant([
          { start: 0, end: 0.05 },
          { start: 2, end: 2.04 },
          { start: 12, end: 15 },
          { start: 5, end: 5.2 },
        ]),
        10
      )
    ).toEqual([{ start: 5, end: 5.2 }]);
  });

  it('üres keep → üres lista', () => {
    expect(variantPreviewRanges(variant([]), 10)).toEqual([]);
  });
});

describe('variantKeepSeconds', () => {
  it('a keep-sávok hosszának összege; a fordított sáv 0-t ad', () => {
    expect(variantKeepSeconds(variant([{ start: 0, end: 2.5 }, { start: 5, end: 4 }, { start: 6, end: 7 }]))).toBe(3.5);
    expect(variantKeepSeconds(variant([]))).toBe(0);
  });
});

describe('aiReplyCommands', () => {
  const project = makeProject([track('video', [videoClip('v1', 0, 10)]), track('text', [textClip('t1')])]);

  it('az elfogadott parancsok EditorCommand-dá válnak, a hallucinált cél kiesik', () => {
    const commands: AiCommand[] = [
      { type: 'SPLIT_CLIP', clipId: 'v1', time: 4 },
      { type: 'REMOVE_CLIP', clipId: 'nincs-ilyen' },
      { type: 'SET_ASPECT', aspectRatio: '1:1' },
      { type: 'RENAME_PROJECT', name: 'Új név' },
    ];
    expect(aiReplyCommands({ message: 'msg', commands }, project)).toEqual([
      { type: 'SPLIT_CLIP', clipId: 'v1', time: 4 },
      { type: 'SET_ASPECT', aspectRatio: '1:1' },
      { type: 'RENAME_PROJECT', name: 'Új név' },
    ]);
  });

  it('UPDATE_CLIP: a nem engedélyezett mező leválik, az engedélyezett marad', () => {
    const commands: AiCommand[] = [
      { type: 'UPDATE_CLIP', clipId: 't1', patch: { color: '#f00', id: 'hack', uri: 'file:///x' } },
      { type: 'UPDATE_CLIP', clipId: 't1', patch: { uri: 'file:///x' } },
    ];
    expect(aiReplyCommands({ message: 'msg', commands }, project)).toEqual([
      { type: 'UPDATE_CLIP', clipId: 't1', patch: { color: '#f00' } },
    ]);
  });

  it('ADD_TEXT_CLIPS: az AI válaszüzenete lesz az indoklás, ha a parancsnak nincs sajátja', () => {
    const [noReason, ownReason] = aiReplyCommands(
      {
        message: 'az AI üzenete',
        commands: [
          { type: 'ADD_TEXT_CLIPS', trackType: 'captions', clips: [{ text: 'A', start: 1, duration: 2 }] },
          { type: 'ADD_TEXT_CLIPS', trackType: 'text', reason: 'saját', clips: [{ text: 'B', start: 0, duration: 2 }] },
        ],
      },
      project
    );
    expect(noReason).toMatchObject({ type: 'ADD_CLIPS', trackType: 'captions', clips: [{ text: 'A', aiReason: 'az AI üzenete' }] });
    expect(ownReason).toMatchObject({ type: 'ADD_CLIPS', trackType: 'text', clips: [{ text: 'B', aiReason: 'saját' }] });
  });

  it('üres / csupa elutasított válasz → üres köteg', () => {
    expect(aiReplyCommands({ message: '', commands: [] }, project)).toEqual([]);
    expect(
      aiReplyCommands({ message: '', commands: [{ type: 'SET_ASPECT', aspectRatio: '4:3' as Project['aspectRatio'] }] }, project)
    ).toEqual([]);
  });
});
