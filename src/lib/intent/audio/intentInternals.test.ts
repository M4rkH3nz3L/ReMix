import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';
import { norm, num, quoted } from './text';
import { fxPatch, OFF, volumeDb } from './sound';
import { audioClipsOn, ownTracks, selectedClip, targetClips, tracksIn } from './tracks';
import { clause } from './clause';
import type { AudioIntentContext, AudioIntentResult } from './types';

// Az `audioIntent` belső moduljai (REFACTOR): a publikus felületen át csak közvetve tesztelt
// segédek viselkedése rögzítve (a bemenet a `clause` által már normalizált szöveg).

const clip = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', uri: 'file:///x.wav', start: 0, duration: 10, trimIn: 0, sourceDuration: 10, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', id: 'x', ...over }) as AudioClip;
const base = createEmptyProject('p', '9:16', undefined, 'audio');
const project: Project = {
  ...base,
  tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip({ id: 'm1' }), clip({ id: 'm2', start: 10 })] } : t.type === 'voiceover' ? { ...t, clips: [clip({ id: 'v1', start: 2 })] } : t)),
};
const ctx = (over: Partial<AudioIntentContext> = {}): AudioIntentContext => ({ project, playhead: 3, selectedClipId: null, trackNames: { music: 'Gitár', voiceover: 'Vo' }, makeId: (p) => `${p}1`, ...over });

describe('intent/audio/text — szöveg-előkészítés', () => {
  it('kisbetű, ékezet nélkül, összevont szóközök', () => {
    expect(norm('  Zengés   ÁRVÍZ  ')).toBe('zenges arviz');
  });
  it('idézet (60 karakterig), tizedesvessző', () => {
    expect(quoted('marker „Intro és dal” ide')).toBe('Intro és dal');
    expect(quoted('nincs')).toBeNull();
    expect(num('1,5')).toBe(1.5);
  });
});

describe('intent/audio/sound — hangerő- és effekt-szándék', () => {
  it('a dB-mennyiség és az irány', () => {
    expect(volumeDb('halkitsd a zenet 6 db')).toBe(-6);
    expect(volumeDb('louder a bit')).toBe(2);
    expect(volumeDb('nagyon hangosabban')).toBe(6);
    expect(volumeDb('felere halkitsd')).toBe(-6);
    expect(volumeDb('zenge')).toBeNull();
  });
  it('effekt be/ki, mérték, EQ, félhang, preset', () => {
    expect(fxPatch('sok zengest a beszedre')).toEqual({ patch: { reverb: 0.65 }, label: 'reverb', off: false });
    const off = fxPatch('vedd le a zengest');
    expect(off).toEqual({ patch: { reverb: undefined }, label: 'reverb', off: true });
    expect(Object.keys(off!.patch)).toEqual(['reverb']);
    expect(fxPatch('tobb basszus')?.patch).toEqual({ eq: { low: 3, mid: 0, high: 0 } });
    expect(fxPatch('tompabb')?.patch).toEqual({ eq: { low: 0, mid: 0, high: -3 } });
    expect(fxPatch('+3 felhang')?.patch).toEqual({ pitchSemitones: 3 });
    expect(fxPatch('telefon hang')?.label).toBe('phone');
    expect(fxPatch('podcast')).toBeNull();
    expect(fxPatch('keves delay')?.patch).toEqual({ delay: 0.2 });
    expect(OFF.test('kapcsold ki')).toBe(true);
    expect(OFF.test('kapcsold be')).toBe(false);
  });
});

describe('intent/audio/tracks — célpont-feloldás', () => {
  it('átnevezett sáv, sorszám, „minden sáv” (csak klippel), létező sáv', () => {
    expect(tracksIn('a gitar halkabban', ctx())).toEqual(['music']);
    expect(tracksIn('a 2. savra', ctx())).toEqual(['voiceover']);
    expect(tracksIn('minden savra', ctx())).toEqual(['music', 'voiceover']);
    // a sáv létezése számít, nem a klipjei: az üres effekt-sáv is célpont
    expect(tracksIn('az effektre', ctx())).toEqual(['sfx']);
  });
  it('öröklés: csak megnevezés nélkül; az ownTracks nem örököl', () => {
    expect(tracksIn('zengest', ctx({ inherited: ['music'] }))).toEqual(['music']);
    expect(ownTracks('zengest', ctx({ inherited: ['music'] }))).toEqual([]);
  });
  it('célklipek: a sávok klipjei, különben a kijelölt klip', () => {
    expect(audioClipsOn(project, ['music']).map((c) => c.id)).toEqual(['m1', 'm2']);
    expect(selectedClip(ctx({ selectedClipId: 'v1' }))?.id).toBe('v1');
    expect(selectedClip(ctx({ selectedClipId: 'nincs' }))).toBeNull();
    expect(targetClips('zengest', ctx({ selectedClipId: 'm2' })).map((c) => c.id)).toEqual(['m2']);
    expect(targetClips('zengest', ctx())).toEqual([]);
  });
});

describe('intent/audio/clause — egy tagmondat', () => {
  const run = (text: string, c = ctx()) => {
    const out: AudioIntentResult = { steps: [], actions: [], unknown: [] };
    return { ok: clause(text, c, out), out };
  };
  it('a videós átadás megelőzi a többi szabályt', () => {
    expect(run('tedd a zenet egy uj video ala').out.actions).toEqual([{ kind: 'toVideo', target: 'new' }]);
  });
  it('vágás csak a kijelölt klipen belüli lejátszófejnél', () => {
    expect(run('vagd el', ctx({ selectedClipId: 'v1' })).out.steps[0]).toEqual({ key: 'split', commands: [{ type: 'SPLIT_CLIP', clipId: 'v1', time: 3 }] });
    expect(run('vagd el', ctx({ selectedClipId: 'v1', playhead: 2 })).ok).toBe(false);
  });
  it('értelmezhetetlen tagmondat → false, kimenet nélkül', () => {
    const r = run('blabla');
    expect(r.ok).toBe(false);
    expect(r.out).toEqual({ steps: [], actions: [], unknown: [] });
  });
});
