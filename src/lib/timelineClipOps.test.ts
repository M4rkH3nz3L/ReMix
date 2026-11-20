import type { TFunction } from 'i18next';

import { cropKeyframes } from '@/lib/keyframes';
import {
  clipLabel,
  clipMenuSplitAt,
  collectClipSnapTargets,
  leftEdgePreview,
  nearestSnapTarget,
  nextEdgePreview,
  pickSnappedMoveStart,
  rightEdgePreview,
  trimLeftUpdate,
  trimRightPatch,
  wantsTrackStep,
  type ClipSnapSource,
} from '@/lib/timelineClipOps';
import type { AudioClip, Clip, ClipKeyframes, Project, VideoClip } from '@/types/project';

/**
 * 🎬 A TimelineClip-ből kiemelt tiszta számítások — a JELENLEGI viselkedést rögzítik
 * (illesztés, drag-to-track, trim-patchek, edge preview, menü-vágáspont, címke).
 */

function video(over: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'v1', kind: 'video', start: 2, duration: 4,
    uri: 'file:///v.mp4', trimIn: 1, sourceDuration: 10,
    speed: 1, volume: 1, filterId: 'none',
    ...over,
  } as VideoClip;
}

function audio(over: Partial<AudioClip> = {}): AudioClip {
  return { id: 'a1', kind: 'audio', start: 2, duration: 4, uri: 'file:///a.m4a', volume: 1, ...over } as AudioClip;
}

const text = (over: Record<string, unknown> = {}) =>
  ({ id: 't1', kind: 'text', start: 2, duration: 4, text: '', ...over }) as unknown as Clip;

function snapSource(over: Partial<ClipSnapSource> = {}): ClipSnapSource {
  return {
    snapTargets: { playhead: true, clips: true, markers: true, beats: true, regions: true },
    playhead: 7,
    beatTimes: [0.5, 1],
    project: {
      markers: [{ time: 3 }],
      regions: [{ start: 10, end: 12 }],
      tracks: [
        { clips: [{ id: 'self', start: 1, duration: 2 }, { id: 'other', start: 5, duration: 1.5 }] },
      ],
    } as unknown as Pick<Project, 'markers' | 'regions' | 'tracks'>,
    ...over,
  };
}

/** a t-mock a kulcsot és az opciókat adja vissza — így a kulcs-választás látszik */
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

describe('collectClipSnapTargets — illesztési célpontok', () => {
  it('a 0 mindig benne van, majd lejátszófej, beatek, jelölők, régiók, MÁS klipek élei — ebben a sorrendben', () => {
    expect(collectClipSnapTargets(snapSource(), 'self')).toEqual([0, 7, 0.5, 1, 3, 10, 12, 5, 6.5]);
  });

  it('a saját klip élei kimaradnak', () => {
    expect(collectClipSnapTargets(snapSource({ project: { tracks: [{ clips: [{ id: 'self', start: 1, duration: 2 }] }] } as never }), 'self')).toEqual([0, 7, 0.5, 1]);
  });

  it('minden kapcsoló ki → csak a 0', () => {
    const off = { playhead: false, clips: false, markers: false, beats: false, regions: false };
    expect(collectClipSnapTargets(snapSource({ snapTargets: off }), 'self')).toEqual([0]);
  });

  it('projekt nélkül csak a lejátszófej és a beatek', () => {
    expect(collectClipSnapTargets(snapSource({ project: null }), 'self')).toEqual([0, 7, 0.5, 1]);
  });
});

describe('nearestSnapTarget — legközelebbi célpont a küszöbön belül', () => {
  it('a küszöbön belüli legközelebbi nyer', () => {
    expect(nearestSnapTarget(4.9, [0, 5, 4.7], 0.5)).toBe(5);
  });

  it('küszöbön kívül az eredeti érték marad', () => {
    expect(nearestSnapTarget(2, [0, 5], 0.5)).toBe(2);
  });

  it('pontosan a küszöbön NEM illeszt (szigorú <)', () => {
    expect(nearestSnapTarget(1, [1.5], 0.5)).toBe(1);
  });

  it('egyenlő távolságnál az elsőként talált marad', () => {
    expect(nearestSnapTarget(2, [1.8, 2.2], 0.5)).toBe(1.8);
  });

  it('0 küszöb → soha nem illeszt', () => {
    expect(nearestSnapTarget(2, [2], 0)).toBe(2);
  });
});

describe('wantsTrackStep — drag-to-track döntés', () => {
  it('domináns függőleges húzás a küszöb (0,6 × sávmagasság) fölött → sávváltás', () => {
    expect(wantsTrackStep(10, 37, 60, 'normal', false)).toBe(true);
    expect(wantsTrackStep(10, -37, 60, 'ripple', false)).toBe(true);
  });

  it('pontosan a küszöbön nem (szigorú >)', () => {
    expect(wantsTrackStep(0, 36, 60, 'normal', false)).toBe(false);
  });

  it('ha a vízszintes nagyobb vagy egyenlő, nem', () => {
    expect(wantsTrackStep(50, 50, 60, 'normal', false)).toBe(false);
  });

  it('csoport (link/köteg) és slip/slide módban soha', () => {
    expect(wantsTrackStep(0, 100, 60, 'normal', true)).toBe(false);
    expect(wantsTrackStep(0, 100, 60, 'slip', false)).toBe(false);
    expect(wantsTrackStep(0, 100, 60, 'slide', false)).toBe(false);
    expect(wantsTrackStep(0, 100, 60, 'roll', false)).toBe(true);
  });
});

describe('pickSnappedMoveStart — START vagy VÉG illesztése', () => {
  it('a kisebb elmozdulású nyer', () => {
    expect(pickSnappedMoveStart(3, 3.2, 2.95)).toBe(2.95);
    expect(pickSnappedMoveStart(3, 3.05, 2.8)).toBe(3.05);
  });

  it('egyenlőségnél a START nyer', () => {
    expect(pickSnappedMoveStart(3, 3.1, 2.9)).toBe(3.1);
  });

  it('negatív eredmény 0-ra vágódik', () => {
    expect(pickSnappedMoveStart(0.1, 0.1, -0.5)).toBe(0.1);
    expect(pickSnappedMoveStart(0.1, 0.5, -0.1)).toBe(0);
  });
});

describe('trimLeftUpdate — bal-trim patch', () => {
  it('videó: a trimClipLeft forrás-ablaka (trimIn együtt mozog)', () => {
    expect(trimLeftUpdate(video(), 3)).toEqual({ start: 3, duration: 3, trimIn: 2 });
  });

  it('videó: a deltát a 0 kezdet és a MIN hossz határolja', () => {
    // −5 mp → legfeljebb −start (2), de a trimIn (1) miatt csak −1
    expect(trimLeftUpdate(video(), -3)).toEqual({ start: 1, duration: 5, trimIn: 0 });
    // túl jobbra → duration = MIN_CLIP_DURATION (0,2)
    const r = trimLeftUpdate(video(), 100);
    expect(r.duration).toBeCloseTo(0.2, 9);
    expect(r.start).toBeCloseTo(5.8, 9);
  });

  it('⏪ fordított videón a trimIn marad', () => {
    expect(trimLeftUpdate(video({ reversed: true }), 3)).toEqual({ start: 3, duration: 3, trimIn: 1 });
  });

  it('hang: a trimAudioLeft szerint (trimIn 0-tól, tartalék nélkül nem nyújt)', () => {
    expect(trimLeftUpdate(audio(), 3)).toEqual({ start: 3, duration: 3, trimIn: 1 });
    expect(trimLeftUpdate(audio(), 1)).toEqual({ start: 2, duration: 4, trimIn: 0 });
  });

  it('egyéb fajta: start/duration a clampelt deltával', () => {
    expect(trimLeftUpdate(text(), 0)).toEqual({ start: 0, duration: 6 });
    expect(trimLeftUpdate(text(), -1)).toEqual({ start: 0, duration: 6 });
    expect(trimLeftUpdate(text(), 3.5)).toEqual({ start: 3.5, duration: 2.5 });
  });

  it('a kulcskockák a tényleges eltolással vágódnak', () => {
    const keyframes: ClipKeyframes = {
      opacity: [
        { time: 0, value: 0, easing: 'linear' },
        { time: 4, value: 1, easing: 'linear' },
      ],
    };
    const r = trimLeftUpdate(text({ keyframes }), 3);
    expect(r).toEqual({ start: 3, duration: 3, keyframes: cropKeyframes(keyframes, 1, 3) });
  });
});

describe('trimRightPatch — jobb-trim patch', () => {
  it('videó: a forrás-hossz a felső korlát, a trimIn marad', () => {
    expect(trimRightPatch(video(), 20)).toEqual({ duration: 9, trimIn: 1 });
    expect(trimRightPatch(video(), 0)).toEqual({ duration: 0.2, trimIn: 1 });
  });

  it('hang: nem nyújtható a forrás végén túl (trimIn nélkül)', () => {
    expect(trimRightPatch(audio({ sourceDuration: 6 }), 20)).toEqual({ duration: 6 });
  });

  it('egyéb fajta: MIN-re clampelt hossz, trimIn: undefined', () => {
    expect(trimRightPatch(text(), 0.05)).toEqual({ duration: 0.2, trimIn: undefined });
    expect(trimRightPatch(text(), 50)).toEqual({ duration: 50, trimIn: undefined });
  });
});

describe('leftEdgePreview / rightEdgePreview — trim közbeni él-idők', () => {
  it('videó bal él: idővonal- és forrás-idő a trimClipLeft patch-ből', () => {
    expect(leftEdgePreview(video(), 100, 100)).toEqual({ tlTime: 3, srcTime: 2 });
  });

  it('nem-videó bal él: forrás-idő 0, a delta a klipre clampelve', () => {
    expect(leftEdgePreview(text(), -1000, 100)).toEqual({ tlTime: 0, srcTime: 0 });
  });

  it('videó jobb él: a forrás vége a korlát', () => {
    expect(rightEdgePreview(video(), 1000, 100)).toEqual({ tlTime: 11, srcTime: 10 });
  });

  it('nem-videó jobb él: MIN hosszra clampelve', () => {
    const r = rightEdgePreview(text(), -1000, 100);
    expect(r.srcTime).toBe(0);
    expect(r.tlTime).toBeCloseTo(2.2, 9);
  });
});

describe('nextEdgePreview — frame-nyi küszöb', () => {
  const prev = { side: 'left' as const, srcTime: 1, tlTime: 3 };

  it('ugyanazon az oldalon 0,02 mp alatt a régi objektum marad (nincs újrarender)', () => {
    expect(nextEdgePreview(prev, 'left', 9, 3.019)).toBe(prev);
  });

  it('0,02 mp-nél vagy oldalváltáskor új állapot', () => {
    expect(nextEdgePreview(prev, 'left', 9, 3.02)).toEqual({ side: 'left', srcTime: 9, tlTime: 3.02 });
    expect(nextEdgePreview(prev, 'right', 9, 3)).toEqual({ side: 'right', srcTime: 9, tlTime: 3 });
    expect(nextEdgePreview(null, 'left', 0, 0)).toEqual({ side: 'left', srcTime: 0, tlTime: 0 });
  });
});

describe('clipMenuSplitAt — a kontextusmenü vágáspontja', () => {
  it('a klip belsejében álló lejátszófej', () => {
    expect(clipMenuSplitAt(3, { start: 2, duration: 4 })).toBe(3);
  });

  it('a széleken és kívül a klip közepe', () => {
    expect(clipMenuSplitAt(2, { start: 2, duration: 4 })).toBe(4);
    expect(clipMenuSplitAt(6, { start: 2, duration: 4 })).toBe(4);
    expect(clipMenuSplitAt(0, { start: 2, duration: 4 })).toBe(4);
  });
});

describe('clipLabel — a klip felirata', () => {
  it('videó: összetett / sebesség / sima', () => {
    expect(clipLabel(video({ comp: {} as never }), t)).toBe('editor.timelineClip.compound');
    expect(clipLabel(video({ speed: 2 }), t)).toBe('editor.timelineClip.videoSpeed:{"speed":2}');
    expect(clipLabel(video(), t)).toBe('editor.timelineClip.video');
  });

  it('szöveg / hang / hotspot: a saját szöveg, ha van', () => {
    expect(clipLabel(text({ text: 'Helló' }), t)).toBe('Helló');
    expect(clipLabel(text(), t)).toBe('editor.timelineClip.text');
    expect(clipLabel(audio({ label: 'zene' }), t)).toBe('zene');
    expect(clipLabel(audio(), t)).toBe('editor.timelineClip.audio');
    expect(clipLabel({ kind: 'interactive' } as Clip, t)).toBe('editor.timelineClip.hotspot');
  });

  it('kép, forma, grade', () => {
    expect(clipLabel({ kind: 'image' } as Clip, t)).toBe('editor.timelineClip.image');
    expect(clipLabel({ kind: 'shape', shape: 'ellipse' } as Clip, t)).toBe('editor.timelineClip.ellipse');
    expect(clipLabel({ kind: 'shape', shape: 'line' } as Clip, t)).toBe('editor.timelineClip.line');
    expect(clipLabel({ kind: 'shape', shape: 'star' } as unknown as Clip, t)).toBe('editor.timelineClip.rectangle');
    expect(clipLabel({ kind: 'adjust' } as Clip, t)).toBe('editor.timelineClip.grade');
  });
});
