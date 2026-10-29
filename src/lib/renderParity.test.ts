import { localRenderGaps, localRenderMatchesPreview } from '@/lib/renderParity';
import type { Project, TextClip, Track, VideoClip } from '@/types/project';

/**
 * 🎯 Paritás-kapu (WYSIWYG): az eszköz-motor csak akkor választható, ha a kész
 * videóból SEMMI nem hiányozna a szerkesztőben látottakhoz képest.
 */

function videoClip(partial: Partial<VideoClip> = {}): VideoClip {
  return {
    kind: 'video',
    id: 'v1',
    start: 0,
    duration: 5,
    uri: 'file:///doc/media/a.mp4',
    trimIn: 0,
    sourceDuration: 10,
    speed: 1,
    volume: 1,
    filterId: 'none',
    ...partial,
  };
}

function project(clips: VideoClip[], extraTracks: Track[] = [], extra: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'T',
    aspectRatio: '9:16',
    fps: 30,
    tracks: [{ id: 't1', type: 'video', name: 'V', clips }, ...extraTracks],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
    ...extra,
  };
}

const textClip: TextClip = {
  kind: 'text',
  id: 'tx1',
  start: 0,
  duration: 2,
  text: 'Felirat',
  color: '#fff',
  backgroundColor: null,
  fontSize: 5,
  fontWeight: 'bold',
  position: { x: 0.5, y: 0.78 },
  animation: 'pop',
  stylePreset: 'bubble',
};

describe('localRenderGaps', () => {
  it('sima vágás/sebesség/hangerő projekt → nincs rés (mehet eszközön)', () => {
    const p = project([videoClip(), videoClip({ id: 'v2', start: 5, speed: 2, volume: 0.5 })]);
    expect(localRenderGaps(p, 'android')).toEqual([]);
    expect(localRenderMatchesPreview(p, 'android')).toBe(true);
  });

  it('SZÖVEG-klip: Androidon az overlay-út viszi (nem rés), iOS-en még rés', () => {
    const p = project([videoClip()], [{ id: 'tt', type: 'captions', name: 'C', clips: [textClip] }]);
    expect(localRenderGaps(p, 'android')).toEqual([]);
    expect(localRenderGaps(p, 'ios')).toContain('text');
  });

  it('idő-függő tartalmú szöveg (typewriter/karaoke/textMotion/kulcskocka) Androidon is rés', () => {
    const tw = { ...textClip, id: 'tw', animation: 'typewriter' as const };
    const p = project([videoClip()], [{ id: 'tt', type: 'captions', name: 'C', clips: [tw] }]);
    expect(localRenderGaps(p, 'android')).toContain('text');
    expect(localRenderMatchesPreview(p, 'android')).toBe(false);
  });

  it('EFFEKTEK / adjust / átmenet / fade / kulcskocka → rés', () => {
    const p = project([
      videoClip({
        effects: [{ id: 'blur' } as never],
        adjust: { brightness: 0.2 },
        transitionOut: { kind: 'fade', durationSec: 0.5 } as never,
        fadeInSec: 0.3,
        keyframes: { opacity: [{ t: 0, v: 1 }] } as never,
      }),
    ]);
    const gaps = localRenderGaps(p, 'android');
    for (const g of ['effects', 'adjust', 'transition', 'fade', 'keyframes']) {
      expect(gaps).toContain(g);
    }
  });

  it('filterId: Androidon mehet (natív preset), iOS-en rés; egyéni erősség mindenhol rés', () => {
    const p = project([videoClip({ filterId: 'warm' as never })]);
    expect(localRenderGaps(p, 'android')).toEqual([]);
    expect(localRenderGaps(p, 'ios')).toEqual(['filter']);
    const p2 = project([videoClip({ filterId: 'warm' as never, filterIntensity: 0.4 })]);
    expect(localRenderGaps(p2, 'android')).toContain('filterIntensity');
  });

  it('identitás-transform nem rés; tényleges pozíció/forgatás az', () => {
    const ok = project([videoClip({ transform: { scale: 1, x: 0, y: 0 } })]);
    expect(localRenderGaps(ok, 'android')).toEqual([]);
    const moved = project([videoClip({ transform: { scale: 1.2, x: 0.1, y: 0 } })]);
    expect(localRenderGaps(moved, 'android')).toContain('transform');
  });

  it('üres adjust objektum nem rés', () => {
    const p = project([videoClip({ adjust: {} })]);
    expect(localRenderGaps(p, 'android')).toEqual([]);
  });

  it('particles / audioMaster / sáv-mixer → rés', () => {
    const p = project([videoClip()], [], {
      particles: { preset: 'snow' } as never,
      trackMix: { music: { gain: 0.5 } },
    });
    const gaps = localRenderGaps(p, 'android');
    expect(gaps).toContain('particles');
    expect(gaps).toContain('audioMaster');
  });

  it('determinista és rendezett', () => {
    const p = project([videoClip({ reversed: true, opacity: 0.5 })]);
    expect(localRenderGaps(p, 'android')).toEqual(localRenderGaps(p, 'android'));
    expect(localRenderGaps(p, 'android')).toEqual(['opacity', 'reversed']);
  });
});

describe('PRO-VIDEO B10/B15 — a natív motor csendben nem hagyhat el semmit', () => {
  const audioTrack = (clip: Record<string, unknown>): Track =>
    ({
      id: 'ta',
      type: 'music',
      name: 'M',
      clips: [{ kind: 'audio', id: 'a1', start: 0, duration: 5, uri: 'file:///m.m4a', label: 'm', volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...clip }],
    }) as Track;

  it('B10: PiP-sávon lévő videó → „pip" rés (különben vágásként fűzné be)', () => {
    const pip: Track = { id: 'tp', type: 'pip', name: 'PiP', clips: [videoClip({ id: 'p1' })] };
    expect(localRenderGaps(project([videoClip()], [pip]), 'ios')).toContain('pip');
  });

  it('B15: videó-feldolgozás (stabilizálás, lassítás-interpoláció, elmosott háttér, Voice Studio)', () => {
    expect(localRenderGaps(project([videoClip({ stabilize: { automatic: true } })]), 'ios')).toContain('videoFx');
    expect(localRenderGaps(project([videoClip({ speed: 0.5, timeInterp: 'flow' })]), 'ios')).toContain('videoFx');
    expect(localRenderGaps(project([videoClip({ backgroundFill: 'blur' })]), 'ios')).toContain('videoFx');
    expect(localRenderGaps(project([videoClip({ voiceEnhance: true })]), 'ios')).toContain('voiceFx');
    // 1×-es sebességnél a timeInterp hatástalan → nem rés
    expect(localRenderGaps(project([videoClip({ timeInterp: 'flow' })]), 'ios')).toEqual([]);
  });

  it('B15: hangklip — fade, pan, effekt-lánc, ducking, automáció', () => {
    const gaps = (c: Record<string, unknown>) => localRenderGaps(project([videoClip()], [audioTrack(c)]), 'ios');
    expect(gaps({})).toEqual([]);
    expect(gaps({ fadeIn: 1 })).toContain('audioFade');
    expect(gaps({ pan: -0.5 })).toContain('pan');
    expect(gaps({ autoDuck: true })).toContain('audioFx');
    expect(gaps({ keyframes: { volume: [{ time: 0, value: 0, easing: 'linear' }] } })).toContain('audioAutomation');
  });
});
