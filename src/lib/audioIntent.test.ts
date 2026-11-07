import { fixDictation, intentCommands, numberWordsToDigits, parseAudioIntent, splitClauses, type AudioIntentContext } from '@/lib/audioIntent';
import { applyCommand } from '@/lib/commands';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const clip = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', uri: 'file:///x.wav', start: 0, duration: 10, trimIn: 0, sourceDuration: 10, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', id: 'x', ...over }) as AudioClip;
const base = createEmptyProject('p', '9:16', undefined, 'audio');
const project: Project = {
  ...base,
  trackMix: { music: { gain: 0.5 } },
  tracks: base.tracks.map((t) =>
    t.type === 'music' ? { ...t, clips: [clip({ id: 'm1', label: 'alap' }), clip({ id: 'm2', start: 10 })] } : t.type === 'voiceover' ? { ...t, clips: [clip({ id: 'v1', label: 'narráció', start: 2, duration: 6 })] } : t.type === 'sfx' ? { ...t, clips: [clip({ id: 's1', start: 4, duration: 1 })] } : t
  ),
};
let n = 0;
const ctx = (over: Partial<AudioIntentContext> = {}): AudioIntentContext => ({ project, playhead: 3, selectedClipId: null, trackNames: { music: 'Zene', voiceover: 'Beszéd', sfx: 'SFX' }, makeId: (p) => `${p}${n++}`, ...over });
/** a parancsok a valódi reducerrel */
const run = (p: Project, text: string, c = ctx()) => intentCommands(parseAudioIntent(text, { ...c, project: p })).reduce((acc, cmd) => applyCommand(acc, cmd) ?? acc, p);
const fxOf = (p: Project, id: string) => (p.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as AudioClip).audioFx ?? {};

describe('🎙️ mondatbontás', () => {
  it('vessző, és/majd/and/then — az idézet egyben marad', () => {
    expect(splitClauses('tegyél zengést a beszédre, és halkítsd a zenét majd masterelj spotifyra')).toEqual(['tegyél zengést a beszédre', 'halkítsd a zenét', 'masterelj spotifyra']);
    expect(splitClauses('marker „Intro és dal” ide')).toEqual(['marker „Intro és dal” ide']);
  });
});

describe('🎙️ magyar mondatok', () => {
  it('zengés a beszédre és a zene 6 dB-lel halkabban — egy köteg', () => {
    const r = parseAudioIntent('Tegyél zengést a beszédre és halkítsd a zenét 6 dB-lel', ctx());
    expect(r.unknown).toEqual([]);
    expect(r.steps.map((s) => s.key)).toEqual(['fxOn', 'trackGain']);
    const p = run(project, 'Tegyél zengést a beszédre és halkítsd a zenét 6 dB-lel');
    expect(fxOf(p, 'v1').reverb).toBe(0.4);
    expect(p.trackMix?.music?.gain).toBeCloseTo(0.5 * Math.pow(10, -6 / 20), 3);
  });
  it('sok zengés, majd vedd le — és a többi effekt marad', () => {
    let p = run(project, 'kompresszort és sok zengést a narrációra');
    expect(fxOf(p, 'v1')).toEqual({ compressor: true, reverb: 0.65 });
    p = run(p, 'vedd le a zengést a beszédről');
    expect(fxOf(p, 'v1')).toEqual({ compressor: true });
  });
  it('zajszűrés, de-esser, normalizálás; telefon-hang preset', () => {
    expect(fxOf(run(project, 'zajszűrést és normalizálást a beszédre'), 'v1')).toEqual({ denoise: true, normalize: true });
    expect(fxOf(run(project, 'legyen telefon hangja a beszédnek'), 'v1')).toEqual({ highpass: 400, lowpass: 3000, compressor: true });
  });
  it('a zene halkuljon a beszéd alatt → autoDuck a zene klipjein', () => {
    const r = parseAudioIntent('halkuljon a zene a beszéd alatt', ctx());
    expect(r.steps[0].key).toBe('duckOn');
    expect(r.steps[0].commands.map((c) => (c as { clipId: string }).clipId)).toEqual(['m1', 'm2']);
  });
  it('master Spotifyra, majd -14 LUFS-ra, majd ki', () => {
    expect(run(project, 'masterelj Spotify-ra').audioMaster?.target).toBe('spotify');
    expect(run(project, 'a hangosság legyen -14 LUFS').audioMaster).toMatchObject({ target: 'custom', lufs: -14 });
    expect(run(run(project, 'masterelj youtube-ra'), 'kapcsold ki a mastert').audioMaster).toBeUndefined();
  });
  it('tempó, ütemjelzés, marker (refrén) a lejátszófejnél, beúsztatás', () => {
    const p = run(project, 'tempó 92, 3/4-es ütem, tegyél markert ide: refrén', ctx({ playhead: 12.5 }));
    expect(p.bpm).toBe(92);
    expect(p.timeSignature).toEqual({ beatsPerBar: 3, beatUnit: 4 });
    expect(p.markers?.[0]).toMatchObject({ time: 12.5, label: '§chorus' });
    const f = run(project, 'úsztasd be a zenét 2 mp alatt');
    expect((f.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).fadeIn).toBe(2);
  });
  it('vágás a kijelölt klipen a lejátszófejnél; folyamatok és némítás műveletként', () => {
    const r = parseAudioIntent('vágd ketté itt', ctx({ selectedClipId: 'v1', playhead: 5 }));
    expect(r.steps[0].commands).toEqual([{ type: 'SPLIT_CLIP', clipId: 'v1', time: 5 }]);
    expect(parseAudioIntent('vágd ki a csendeket, vágd szét ütemenként, némítsd a zenét', ctx()).actions).toEqual([{ kind: 'silence' }, { kind: 'beatSplitBars' }, { kind: 'mute', track: 'music' }]);
  });
  it('a kijelölt klip hangereje, ha nincs sáv megnevezve; a sáv a maximumon: jelzés, parancs nélkül', () => {
    const p = run(project, 'kicsit hangosabban', ctx({ selectedClipId: 's1' }));
    // 0,8 × +2 dB = 1,007 → a klip hangereje legfeljebb 1
    expect((p.tracks.find((t) => t.type === 'sfx')!.clips[0] as AudioClip).volume).toBe(1);
    const q = run(project, 'halkítsd 6 dB-lel', ctx({ selectedClipId: 's1' }));
    expect((q.tracks.find((t) => t.type === 'sfx')!.clips[0] as AudioClip).volume).toBeCloseTo(0.8 * Math.pow(10, -6 / 20), 3);
    const r = parseAudioIntent('hangosítsd fel a beszédet', ctx());
    expect(r.steps[0]).toMatchObject({ key: 'atLimit', commands: [] });
  });
  it('a magyar „hall” (hallani) nem zengés; a német „Hall auf die Stimme” igen', () => {
    expect(parseAudioIntent('hall kicsit a zene', ctx()).steps.filter((x) => x.key === 'fxOn')).toEqual([]);
    expect(fxOf(run(project, 'Hall auf die Stimme'), 'v1').reverb).toBe(0.4);
  });
  it('diktálási hibák tűrése: összetapadt szó, leszakadt és félrehallott mennyiség (a telefon Whisperjének valódi kimenete)', () => {
    const r = parseAudioIntent('Tegyélzengést a beszébre, és halkítsd a zenét, hadd decibel el.', ctx());
    expect(r.unknown).toEqual([]);
    expect(r.steps.map((x) => [x.key, x.params?.db ?? x.params?.fx])).toEqual([['fxOn', 'reverb'], ['trackGain', '-6 dB']]);
  });
  it('közelítő egyezés: „Halkujjon a zene a beszéd alat” → halkítás a beszéd alatt (nem hangerő); „úszta sd be” → beúsztatás', () => {
    const r = parseAudioIntent('Halkujjon a zene a beszéd alat, és úszta sd be két másodperc alatt.', ctx());
    expect(r.unknown).toEqual([]);
    expect(r.steps.map((x) => x.key)).toEqual(['duckOn', 'fadeIn']);
    expect(fixDictation('hall kicsit')).toBe('hall kicsit'); // a rövid szó nem „javul” át
  });
  it('vesszővel szétszabdalt diktálás: a töredék a szomszédjához tartozik („Masteray Y-u, YouTubera, és tegyél, markert ide”)', () => {
    const r = parseAudioIntent('Masteray Y-u, YouTubera, és tegyél, markert ide.', ctx());
    expect(r.unknown).toEqual([]);
    expect(r.steps.map((x) => [x.key, x.params?.target ?? x.params?.label])).toEqual([['master', 'youtube'], ['marker', '0:03']]);
  });
  it('mixjavaslat és mastering-segéd műveletként; a „masterelj Spotify-ra” továbbra is közvetlen master', () => {
    expect(parseAudioIntent('javasolj valamit a mixre, és automatikus mastert kérek', ctx()).actions).toEqual([{ kind: 'mixSuggest' }, { kind: 'masterAssist' }]);
    expect(parseAudioIntent('masterelj Spotify-ra', ctx()).steps[0].key).toBe('master');
  });
  it('a nem értett részt nem találgatja', () => {
    const r = parseAudioIntent('tegyél zengést a beszédre és főzz egy kávét', ctx());
    expect(r.steps).toHaveLength(1);
    expect(r.unknown).toEqual(['főzz egy kávét']);
  });
});

describe('🎙️ English', () => {
  it('reverb on the voice, music down 4 dB, master for YouTube, duck the music', () => {
    const r = parseAudioIntent('add reverb to the voice, lower the music by 4 dB, master for YouTube and duck the music under the voice', ctx());
    expect(r.unknown).toEqual([]);
    expect(r.steps.map((s) => s.key)).toEqual(['fxOn', 'trackGain', 'master', 'duckOn']);
    const p = run(project, 'add reverb to the voice, lower the music by 4 dB, master for YouTube');
    expect(p.audioMaster?.target).toBe('youtube');
  });
  it('brighter voice (EQ), +3 semitones, fade out 3 seconds, mute sfx', () => {
    expect(fxOf(run(project, 'make the voice brighter'), 'v1').eq).toEqual({ low: 0, mid: 0, high: 3 });
    expect(fxOf(run(project, 'pitch the voice +3 semitones'), 'v1').pitchSemitones).toBe(3);
    const r = parseAudioIntent('fade out the music 3 seconds and mute the sfx', ctx());
    expect(r.steps[0].commands).toEqual([{ type: 'UPDATE_CLIP', clipId: 'm2', patch: { fadeOut: 3 } }]);
    expect(r.actions).toEqual([{ kind: 'mute', track: 'sfx' }]);
  });
  it('a renamed track by its own name', () => {
    const p = { ...project, tracks: [...project.tracks, { id: 'a1', type: 'aux1' as const, name: 'Gitár', clips: [clip({ id: 'g1' })] }] } as Project;
    const r = parseAudioIntent('a gitárra tegyél visszhangot', ctx({ project: p, trackNames: { music: 'Zene', voiceover: 'Beszéd', sfx: 'SFX', aux1: 'Gitár' } }));
    expect(r.steps[0].commands).toEqual([{ type: 'UPDATE_CLIP', clipId: 'g1', patch: { audioFx: { delay: 0.35 } } }]);
  });
});

describe('🔢 számszavak a mértékegység előtt (a kimondott parancs átirata)', () => {
  it('hat decibellel / two seconds / drei Halbtöne → számjegy; az „egy kicsit” névelő marad', () => {
    const r = parseAudioIntent('Halkítsd a zenét hat decibellel', ctx());
    expect(r.steps[0].params?.db).toBe('-6 dB');
    expect(numberWordsToDigits('fade in two seconds')).toBe('fade in 2 seconds');
    expect(numberWordsToDigits('egy kicsit halkabban')).toBe('egy kicsit halkabban');
  });
});

describe('🎙️ a felület példamondatai (hu, en, de) maradék nélkül értelmeződnek', () => {
  const locales = ['hu', 'en', 'de'] as const;
  it.each(locales)('%s', (lang) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const a = require(`../i18n/locales/${lang}.json`).studio.audio.assistant;
    for (const k of ['example1', 'example2', 'example3']) {
      const r = parseAudioIntent(a[k], ctx());
      expect({ lang, k, unknown: r.unknown }).toEqual({ lang, k, unknown: [] });
      expect(r.steps.length + r.actions.length).toBeGreaterThanOrEqual(2);
    }
  });
});
