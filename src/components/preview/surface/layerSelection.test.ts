import {
  adjustClipStrength,
  isVideoAudible,
  LIGHTING_TINTS,
  previewAdjustClips,
  previewInteractiveClips,
  previewShapeClips,
  previewTextClips,
  previewVisualClip,
  shouldDimBase,
  snapContextOf,
  textOverlayTime,
  visualFadeOpacity,
  visualMediaOpacity,
} from './layerSelection';
import { createEmptyProject } from '@/lib/projectUtils';
import type {
  AdjustClip,
  Clip,
  ImageClip,
  InteractiveClip,
  Project,
  ShapeClip,
  TextClip,
  TrackType,
  VideoClip,
} from '@/types/project';

const video = (over: Partial<VideoClip> = {}): VideoClip =>
  ({ kind: 'video', id: 'v1', uri: 'file:///v.mp4', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, speed: 1, volume: 1, ...over }) as VideoClip;
const image = (over: Partial<ImageClip> = {}): ImageClip =>
  ({ kind: 'image', id: 'i1', uri: 'file:///i.png', start: 4, duration: 2, ...over }) as ImageClip;
const text = (over: Partial<TextClip> = {}): TextClip =>
  ({ kind: 'text', id: 't1', text: 'Szia', start: 0, duration: 3, position: { x: 0.5, y: 0.5 }, ...over }) as TextClip;
const shape = (over: Partial<ShapeClip> = {}): ShapeClip =>
  ({ kind: 'shape', id: 's1', shape: 'rectangle', start: 0, duration: 3, position: { x: 0.2, y: 0.3 }, w: 0.1, h: 0.1, ...over }) as ShapeClip;
const hotspot = (over: Partial<InteractiveClip> = {}): InteractiveClip =>
  ({ kind: 'interactive', id: 'h1', label: 'Link', start: 0, duration: 3, rect: { x: 0, y: 0, w: 0.2, h: 0.2 }, ...over }) as InteractiveClip;
const grade = (over: Partial<AdjustClip> = {}): AdjustClip =>
  ({ kind: 'adjust', id: 'a1', start: 0, duration: 10, adjust: {}, ...over }) as AdjustClip;

function withClips(clips: Partial<Record<TrackType, Clip[]>>): Project {
  const p = createEmptyProject('előnézet', '9:16');
  return {
    ...p,
    tracks: p.tracks.map((t) => ({ ...t, clips: clips[t.type] ?? [] })),
  };
}

describe('isVideoAudible (videó saját hangja)', () => {
  it('alapból szól; némítva vagy JAVÍTOTT hangnál néma', () => {
    expect(isVideoAudible(false, [], [])).toBe(true);
    expect(isVideoAudible(false, [], ['video'])).toBe(false);
    expect(isVideoAudible(true, [], [])).toBe(false);
  });
  it('solo esetén csak a solózott videó szól (a némítás nem számít)', () => {
    expect(isVideoAudible(false, ['music'], [])).toBe(false);
    expect(isVideoAudible(false, ['video'], ['video'])).toBe(true);
    expect(isVideoAudible(true, ['video'], [])).toBe(false);
  });
});

describe('snapContextOf (a többi réteg középpontja)', () => {
  const project = withClips({
    text: [text({ id: 'a', position: { x: 0.1, y: 0.1 } }), text({ id: 'b', start: 5, position: { x: 0.9, y: 0.9 } })],
    overlay: [shape({ id: 'c', position: { x: 0.3, y: 0.4 } })],
    captions: [text({ id: 'd', start: 3, duration: 1, position: { x: 0.5, y: 0.8 } })],
    interactive: [hotspot({ id: 'e' })],
  });
  it('a húzott réteg és a playheadnél nem látható klipek kimaradnak; a rács átjön', () => {
    expect(snapContextOf({ project, selectedClipId: 'a', playhead: 1, snapGrid: 0.1 })).toEqual({
      peers: [{ x: 0.3, y: 0.4 }],
      grid: 0.1,
    });
  });
  it('a klip vége INKLUZÍV (start ≤ t ≤ vég), a hotspot (rect) nem számít', () => {
    expect(snapContextOf({ project, selectedClipId: null, playhead: 3, snapGrid: 0 }).peers).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.8 },
      { x: 0.3, y: 0.4 },
    ]);
  });
  it('projekt nélkül üres', () => {
    expect(snapContextOf({ project: null, selectedClipId: null, playhead: 0, snapGrid: 0 })).toEqual({ peers: [], grid: 0 });
  });
});

describe('réteg-kiválasztás a playheadnél', () => {
  const project = withClips({
    video: [video(), image()],
    text: [text({ id: 'cim' })],
    captions: [text({ id: 'felirat' }), { ...shape({ id: 'nem-szoveg' }) }],
    overlay: [text({ id: 'matrica' }), shape({ id: 'forma' })],
    interactive: [hotspot()],
    adjust: [grade({ id: 'g2', start: 1 }), grade({ id: 'g1', start: 0 })],
  });

  it('vizuális klip: a playhead alatti videó/kép; rejtett videósávnál és projekt nélkül null', () => {
    expect(previewVisualClip(project, [], 1)?.id).toBe('v1');
    expect(previewVisualClip(project, [], 4)?.id).toBe('i1');
    expect(previewVisualClip(project, ['video'], 1)).toBeNull();
    expect(previewVisualClip(null, [], 1)).toBeNull();
  });

  it('szöveg-rétegek sorrendje: cím → felirat → matrica, csak `text` fajta', () => {
    expect(previewTextClips(project, [], 1).map((c) => c.id)).toEqual(['cim', 'felirat', 'matrica']);
  });
  it('rejtett sáv kimarad a szöveg-rétegekből', () => {
    expect(previewTextClips(project, ['captions', 'overlay'], 1).map((c) => c.id)).toEqual(['cim']);
    expect(previewTextClips(null, [], 1)).toEqual([]);
  });
  it('a klip vége EXKLUZÍV (clipsAt)', () => {
    expect(previewTextClips(project, [], 3)).toEqual([]);
  });

  it('forma-rétegek az overlay-sávról; rejtett overlay → üres', () => {
    expect(previewShapeClips(project, [], 1).map((c) => c.id)).toEqual(['forma']);
    expect(previewShapeClips(project, ['overlay'], 1)).toEqual([]);
    expect(previewShapeClips(null, [], 1)).toEqual([]);
  });

  it('hotspotok; rejtett interaktív sáv → üres', () => {
    expect(previewInteractiveClips(project, [], 1).map((c) => c.id)).toEqual(['h1']);
    expect(previewInteractiveClips(project, ['interactive'], 1)).toEqual([]);
    expect(previewInteractiveClips(null, [], 1)).toEqual([]);
  });

  it('grade-rétegek kezdés szerint rendezve; rejtett adjust-sáv → üres', () => {
    expect(previewAdjustClips(project, [], 2).map((c) => c.id)).toEqual(['g1', 'g2']);
    expect(previewAdjustClips(project, ['adjust'], 2)).toEqual([]);
    expect(previewAdjustClips(null, [], 2)).toEqual([]);
  });
});

describe('visualMediaOpacity (átlátszóság-automáció)', () => {
  it('kulcskocka nélkül a statikus opacity (hiányzó = 1)', () => {
    expect(visualMediaOpacity(video({ opacity: 0.4 }), null, 1)).toBe(0.4);
    expect(visualMediaOpacity(video(), null, 1)).toBe(1);
  });
  it('kulcskockás opacity a klip-lokális időből interpolál', () => {
    const v = video({
      start: 2,
      keyframes: { opacity: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 1, easing: 'linear' }] },
    } as Partial<VideoClip>);
    expect(visualMediaOpacity(v, v, 3)).toBeCloseTo(0.5);
  });
  it('vizuális klip nélkül a tartalék klip opacity-je, végül 1', () => {
    expect(visualMediaOpacity(null, image({ opacity: 0.3 }), 0)).toBe(0.3);
    expect(visualMediaOpacity(null, null, 0)).toBe(1);
  });
});

describe('visualFadeOpacity (fekete áttűnés)', () => {
  it('fade nélkül és klip nélkül 0', () => {
    expect(visualFadeOpacity(video(), 0)).toBe(0);
    expect(visualFadeOpacity(null, 0)).toBe(0);
  });
  it('fade-in: a klip elején fekete, utána kitisztul', () => {
    const v = video({ start: 2, fadeInSec: 1 });
    expect(visualFadeOpacity(v, 2)).toBe(1);
    expect(visualFadeOpacity(v, 2.25)).toBeCloseTo(0.75);
    expect(visualFadeOpacity(v, 3)).toBe(0);
    expect(visualFadeOpacity(v, 1)).toBe(1);
  });
  it('fade-out: a klip végén elsötétül; átfedésnél a nagyobb nyer', () => {
    const v = video({ start: 0, duration: 4, fadeOutSec: 2 });
    expect(visualFadeOpacity(v, 3)).toBeCloseTo(0.5);
    expect(visualFadeOpacity(v, 4)).toBe(1);
    const both = video({ start: 0, duration: 1, fadeInSec: 1, fadeOutSec: 1 });
    expect(visualFadeOpacity(both, 0.25)).toBeCloseTo(0.75);
    expect(visualFadeOpacity(both, 0.75)).toBeCloseTo(0.75);
  });
});

describe('adjustClipStrength (grade-erősség × burkológörbe)', () => {
  it('alapból teljes (1); a strength skáláz', () => {
    expect(adjustClipStrength(grade(), 5)).toBe(1);
    expect(adjustClipStrength(grade({ strength: 0.4 }), 5)).toBe(0.4);
  });
  it('fade-in az elején, fade-out a végén; a határon kívül szorítva', () => {
    const g = grade({ start: 2, duration: 10, fadeInSec: 2, fadeOutSec: 4, strength: 0.5 });
    expect(adjustClipStrength(g, 3)).toBeCloseTo(0.25);
    expect(adjustClipStrength(g, 1)).toBe(0);
    expect(adjustClipStrength(g, 10)).toBeCloseTo(0.25);
    expect(adjustClipStrength(g, 13)).toBe(0);
  });
  it('a strength 0 kioltja (nem esik vissza 1-re)', () => {
    expect(adjustClipStrength(grade({ strength: 0 }), 5)).toBe(0);
  });
});

describe('shouldDimBase (fókusz-scrim)', () => {
  const project = withClips({ text: [text({ id: 'cim' })], video: [video({ id: 'v' })], pip: [video({ id: 'p' })] });
  it('csak szerkesztésben, fókusz módban, overlay-jellegű kijelölésnél', () => {
    expect(shouldDimBase(project, 'cim', 'edit', true)).toBe(true);
    expect(shouldDimBase(project, 'p', 'edit', true)).toBe(true);
    expect(shouldDimBase(project, 'v', 'edit', true)).toBe(false);
    expect(shouldDimBase(project, 'cim', 'edit', false)).toBe(false);
    expect(shouldDimBase(project, 'cim', 'play', true)).toBe(false);
  });
  it('nincs kijelölés / ismeretlen klip / nincs projekt → nincs scrim', () => {
    expect(shouldDimBase(project, null, 'edit', true)).toBe(false);
    expect(shouldDimBase(project, 'nincs', 'edit', true)).toBe(false);
    expect(shouldDimBase(null, 'cim', 'edit', true)).toBe(false);
  });
});

describe('textOverlayTime', () => {
  it('szerkesztésben álló fejnél legalább 0,45 mp (beállt belépő-animáció)', () => {
    expect(textOverlayTime('edit', false, 1, 1)).toBe(0.45);
    expect(textOverlayTime('edit', false, 3, 1)).toBe(2);
  });
  it('lejátszás közben és lejátszó módban a valódi klip-lokális idő', () => {
    expect(textOverlayTime('edit', true, 1, 1)).toBe(0);
    expect(textOverlayTime('play', false, 1.2, 1)).toBeCloseTo(0.2);
  });
});

describe('LIGHTING_TINTS', () => {
  it('a négy lighting-preset előnézeti tintje rögzített', () => {
    expect(LIGHTING_TINTS).toEqual({
      studio: { color: '#fff6e8', opacity: 0.07 },
      sunset: { color: '#ff8a3d', opacity: 0.16 },
      neon: { color: '#c74dff', opacity: 0.14 },
      cyberpunk: { color: '#1ad1c4', opacity: 0.14 },
    });
  });
});
