/**
 * 🎧 Az előnézeti hangréteg magja (REFACTOR: az AudioLayer.tsx-ből kiemelve) — a JELENLEGI
 * viselkedést rögzíti: sáv-monitorozás, keverési terv (mute/solo/master/A-B/referencia),
 * fade-szorzó és a klip-lejátszó hangereje.
 */
import { clipPreviewVolume, fadeFactor, previewMixPlan, trackAudible, withoutProcessing, type PreviewMixInput } from '@/lib/audioLayerMix';
import { mixForExport } from '@/lib/audioExportMix';
import { offlineMixPlan } from '@/lib/offlineMix';
import { referenceMatchGain, referenceProject } from '@/lib/referenceAB';
import type { AudioClip, Project, TrackType } from '@/types/project';

const ac = (o: Partial<AudioClip> & { id: string }): AudioClip =>
  ({ kind: 'audio', uri: `file:///${o.id}.wav`, label: o.id, start: 0, duration: 10, trimIn: 0, sourceDuration: 60, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...o }) as AudioClip;

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: 'p1',
    name: 'P',
    kind: 'video',
    aspectRatio: '9:16',
    fps: 30,
    assets: [],
    tracks: [
      { id: 't-v', type: 'video', name: 'v', clips: [{ kind: 'video', id: 'v1', uri: 'file:///v.mp4', start: 0, duration: 5, trimIn: 0, volume: 1, speed: 1, voiceEnhance: true, deReverb: true }] },
      { id: 't-m', type: 'music', name: 'm', clips: [ac({ id: 'm1', audioFx: { reverb: 0.4 } as AudioClip['audioFx'], voiceEnhance: true })] },
      { id: 't-vo', type: 'voiceover', name: 'vo', clips: [ac({ id: 'vo1', deReverb: true })] },
      { id: 't-t', type: 'text', name: 't', clips: [{ kind: 'text', id: 'x1', start: 0, duration: 2 }] },
    ],
    ...over,
  }) as unknown as Project;

const input = (over: Partial<PreviewMixInput> = {}): PreviewMixInput => ({
  masterVolume: 1,
  muted: [],
  solo: [],
  fxBypass: false,
  refTrack: null,
  mixLufs: null,
  ...over,
});

describe('trackAudible — sáv-monitorozás', () => {
  it('solo nélkül a nem némított sáv szól, a némított nem', () => {
    expect(trackAudible('music', [], [])).toBe(true);
    expect(trackAudible('music', ['music'], [])).toBe(false);
    expect(trackAudible('sfx', ['music'], [])).toBe(true);
  });

  it('solo esetén CSAK a solo-sáv szól — a némítás ilyenkor nem számít', () => {
    expect(trackAudible('music', ['music'], ['music'])).toBe(true);
    expect(trackAudible('voiceover', [], ['music'])).toBe(false);
  });
});

describe('fadeFactor — fade-be/fade-ki szorzó', () => {
  it('fade nélkül mindig 1, a klipen kívül is', () => {
    const c = ac({ id: 'a' });
    expect([fadeFactor(c, -1), fadeFactor(c, 0), fadeFactor(c, 5), fadeFactor(c, 12)]).toEqual([1, 1, 1, 1]);
  });

  it('fade-be lineárisan 0-ról 1-re, előtte 0-ra vágva', () => {
    const c = ac({ id: 'a', fadeIn: 2 });
    expect(fadeFactor(c, -0.5)).toBe(0);
    expect(fadeFactor(c, 0)).toBe(0);
    expect(fadeFactor(c, 0.5)).toBe(0.25);
    expect(fadeFactor(c, 2)).toBe(1);
    expect(fadeFactor(c, 9)).toBe(1);
  });

  it('fade-ki a klip vége felé, utána 0-ra vágva', () => {
    const c = ac({ id: 'a', fadeOut: 4 });
    expect(fadeFactor(c, 4)).toBe(1);
    expect(fadeFactor(c, 8)).toBe(0.5);
    expect(fadeFactor(c, 10)).toBe(0);
    expect(fadeFactor(c, 11)).toBe(0);
  });

  it('átfedő fade-eknél a kisebbik szorzó győz', () => {
    const c = ac({ id: 'a', duration: 2, fadeIn: 2, fadeOut: 2 });
    expect(fadeFactor(c, 0.5)).toBe(0.25);
    expect(fadeFactor(c, 1)).toBe(0.5);
    expect(fadeFactor(c, 1.5)).toBe(0.25);
  });
});

describe('clipPreviewVolume — klip-lejátszó hangereje', () => {
  it('néma sávon 0, függetlenül a fadertől és a mastertől', () => {
    expect(clipPreviewVolume(ac({ id: 'a' }), 1, false, 2, 1)).toBe(0);
  });

  it('a klip-hangerő × fade 0–1 közé vágva, UTÁNA × fader × master (a fader túlléphet 1-en)', () => {
    expect(clipPreviewVolume(ac({ id: 'a', volume: 1.6 }), 3, true, 1.5, 0.5)).toBe(0.75);
    expect(clipPreviewVolume(ac({ id: 'a', volume: 0.8, fadeIn: 2 }), 1, true, 1, 1)).toBe(0.4);
  });

  it('a volume-kulcskockák a klip-időből interpolálnak (a klip-hangerő helyett)', () => {
    const c = ac({ id: 'a', volume: 0.1, keyframes: { volume: [{ time: 0, value: 0, easing: 'linear' }, { time: 4, value: 1, easing: 'linear' }] } as AudioClip['keyframes'] });
    expect(clipPreviewVolume(c, 2, true, 1, 1)).toBeCloseTo(0.5, 10);
    expect(clipPreviewVolume(c, 2, true, 0.5, 0.5)).toBeCloseTo(0.125, 10);
  });
});

describe('withoutProcessing — A/B: feldolgozás nélkül', () => {
  it('a master, a hangklip effektjei és a hang-javítás kikapcsolva; a nem-hang klip érintetlen', () => {
    const p = project({ audioMaster: { targetLufs: -14 } } as unknown as Partial<Project>);
    const out = withoutProcessing(p);
    expect(out.audioMaster).toBeUndefined();
    const clips = out.tracks.flatMap((t) => t.clips) as unknown as Record<string, unknown>[];
    expect(clips[0]).toMatchObject({ kind: 'video', voiceEnhance: false, deReverb: false });
    expect('audioFx' in clips[0]).toBe(false);
    expect(clips[1]).toMatchObject({ kind: 'audio', voiceEnhance: false, deReverb: false, audioFx: undefined });
    expect(clips[2]).toMatchObject({ voiceEnhance: false, deReverb: false });
    expect(clips[3]).toBe(p.tracks[3].clips[0]);
  });

  it('nem írja át a bemenetet', () => {
    const p = project();
    const before = JSON.stringify(p);
    withoutProcessing(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('previewMixPlan — az előnézet keverési terve', () => {
  it('projekt nélkül null', () => {
    expect(previewMixPlan(null, input())).toBeNull();
  });

  it('alapesetben az exporttal azonos terv (mixForExport → offlineMixPlan)', () => {
    const p = project();
    expect(previewMixPlan(p, input({ masterVolume: 0.5, muted: ['voiceover'] }))).toEqual(
      offlineMixPlan(mixForExport(p, (t: TrackType) => t !== 'voiceover', 0.5)!)
    );
  });

  it('A/B-nél a feldolgozás nélküli projektből', () => {
    const p = project();
    expect(previewMixPlan(p, input({ fxBypass: true }))).toEqual(offlineMixPlan(mixForExport(withoutProcessing(p), () => true, 1)!));
  });

  it('ha nem marad hang (minden néma), null', () => {
    const p = project();
    expect(previewMixPlan(p, input({ solo: ['sfx'] }))).toBeNull();
  });

  it('referencia hallgatásakor a referencia-projekt, a keverés hangosságára illesztve; mixLufs nélkül 1×', () => {
    const p = project();
    const ref = { uri: 'file:///ref.wav', name: 'Ref', lufs: -9, duration: 30 };
    const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' && typeof v === 'string' && v.startsWith('trk') ? '#' : v)));
    expect(strip(previewMixPlan(p, input({ refTrack: ref, mixLufs: -14, muted: ['music', 'voiceover'] })))).toEqual(
      strip(offlineMixPlan(referenceProject(p, ref, referenceMatchGain(-9, -14))))
    );
    const plan = previewMixPlan(p, input({ refTrack: ref, mixLufs: null }));
    expect(plan?.clips.map((c) => [c.uri, c.volume])).toEqual([['file:///ref.wav', 1]]);
  });
});
