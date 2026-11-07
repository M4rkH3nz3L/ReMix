import { loudnessRange, masterProposal, mixSuggestions, TrackAnalyzer, type TrackStats } from '@/lib/mixAssist';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const SR = 44100;
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
/** beszéd-szerű jel: 1 s szöveg / 0,3 s szünet; harmonikus 150 Hz-es alap; opcionális zaj, dübörgés, sziszegés, dinamika */
function speech(sec: number, o: { noise?: number; rumble?: number; hiss?: number; swing?: boolean } = {}): Float32Array {
  return Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => {
    const t = i / SR;
    const on = t % 1.3 < 1;
    const phrase = Math.floor(t / 1.3);
    const lvl = o.swing ? (phrase % 2 === 0 ? 0.4 : 0.04) : 0.3;
    let v = on ? lvl * (0.6 * Math.sin(2 * Math.PI * 150 * t) + 0.3 * Math.sin(2 * Math.PI * 450 * t) + 0.15 * Math.sin(2 * Math.PI * 1200 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    if (o.rumble) v += o.rumble * Math.sin(2 * Math.PI * 35 * t);
    if (o.hiss && on) v += o.hiss * rnd() * (Math.sin(2 * Math.PI * 9000 * t) > 0 ? 1 : 0.2);
    if (o.noise) v += o.noise * rnd();
    return v;
  });
}
const analyze = (x: Float32Array): TrackStats => {
  const a = new TrackAnalyzer(SR);
  for (let i = 0; i < x.length; i += 4410) a.push(x.subarray(i, i + 4410), x.subarray(i, i + 4410));
  return a.finish();
};
const music = (amp: number) => Float32Array.from({ length: 12 * SR }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / SR));
const clip = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'x', uri: 'u', label: 'x', start: 0, duration: 12, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;
const base = createEmptyProject('m', '9:16', undefined, 'audio');
const proj = (over: { autoDuck?: boolean; voiceFx?: AudioClip['audioFx'] } = {}): Project => ({
  ...base,
  tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [clip({ id: 'v', audioFx: over.voiceFx })] } : t.type === 'music' ? { ...t, clips: [clip({ id: 'm', autoDuck: over.autoDuck })] } : t)),
});
const keys = (p: Project, s: Parameters<typeof mixSuggestions>[1]) => mixSuggestions(p, s).map((x) => x.key);

describe('🎚️ mixjavaslat', () => {
  const clean = analyze(speech(12));
  it('rendben lévő beszéd halk zenei ággyal: nincs javaslat', () => {
    expect(keys(proj(), { voiceover: clean, music: analyze(music(0.01)) })).toEqual([]);
  });
  it('a zene túl hangos a beszéd alatt → halkítás a beszéd alatt (autoDuck); ha már halkul → szint le', () => {
    const loud = analyze(music(0.2));
    const s = mixSuggestions(proj(), { voiceover: clean, music: loud });
    expect(s[0]).toMatchObject({ key: 'duckMusic', commands: [{ type: 'UPDATE_CLIP', clipId: 'm', patch: { autoDuck: true } }] });
    const s2 = mixSuggestions(proj({ autoDuck: true }), { voiceover: clean, music: loud });
    expect(s2[0].key).toBe('lowerMusic');
    expect((s2[0].commands[0] as { gain: number }).gain).toBeLessThan(1);
  });
  it('nagy dinamika → kompresszor; dübörgés → felüláteresztő; sziszegés → de-esser; zaj → zajszűrés', () => {
    expect(keys(proj(), { voiceover: analyze(speech(12, { swing: true })) })).toContain('compressVoice');
    expect(keys(proj(), { voiceover: analyze(speech(12, { rumble: 0.2 })) })).toContain('highpassVoice');
    expect(keys(proj(), { voiceover: analyze(speech(12, { hiss: 0.15 })) })).toContain('deEssVoice');
    expect(keys(proj(), { voiceover: analyze(speech(12, { noise: 0.01 })) })).toContain('denoiseVoice');
  });
  it('zajos felvétel a klipek közti hosszú (3 s) csenddel is zajosnak számít; a tiszta nem', () => {
    const noisy = speech(6, { noise: 0.01 });
    const gapped = new Float32Array(noisy.length * 2 + 3 * SR);
    gapped.set(noisy, 0);
    gapped.set(noisy, noisy.length + 3 * SR);
    expect(keys(proj(), { voiceover: analyze(gapped) })).toContain('denoiseVoice');
    expect(keys(proj(), { voiceover: analyze(speech(12)) })).not.toContain('denoiseVoice');
  });
  it('együtt is: a dübörgés nem takarja el a dinamikát és a szünetek zaját', () => {
    let seed2 = 5;
    const r2 = () => ((seed2 = (seed2 * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const x = speech(13, { swing: true }).map((v, i) => v + 0.2 * Math.sin((2 * Math.PI * 35 * i) / SR) + 0.01 * r2());
    const k = keys(proj(), { voiceover: analyze(x), music: analyze(music(0.25)) });
    expect(k).toEqual(expect.arrayContaining(['duckMusic', 'compressVoice', 'highpassVoice', 'denoiseVoice']));
  });
  it('a 150 Hz-es beszéd-alaphang nem „dübörgés”; ha már van effekt, nem javasolja újra', () => {
    expect(clean.band.low).toBeLessThan(-15);
    expect(keys(proj({ voiceFx: { compressor: true } }), { voiceover: analyze(speech(12, { swing: true })) })).not.toContain('compressVoice');
  });
  it('túlvezérelt sáv → szint le (a csúcs −1 dBFS-re)', () => {
    const s = mixSuggestions(proj(), { music: analyze(music(1.3)) });
    expect(s[0].key).toBe('trackClipping');
    expect((s[0].commands[0] as { gain: number }).gain).toBeCloseTo(Math.pow(10, -(20 * Math.log10(1.3) + 1) / 20), 2);
  });
});

describe('🎛️ mastering-segéd', () => {
  it('a cél a platformé; tompa keverés → magas +2; dübörgő → mély −2; nagy dinamika → multiband', () => {
    const dull = analyze(speech(12));
    const p = masterProposal(dull, 'spotify');
    expect(p.master).toMatchObject({ target: 'spotify', lufs: -14, truePeak: -1 });
    expect(p.reasons.map((r) => r.key)).toContain('dull');
    expect(p.master.eq?.high).toBe(2);
    const boomy = masterProposal(analyze(speech(12, { rumble: 0.5 })), 'podcast');
    expect(boomy.master.eq?.low).toBe(-3);
    const wide = masterProposal(analyze(speech(13, { swing: true })), 'podcast');
    expect(wide.master.multiband).toBe(true);
    expect(wide.master.dynamics).toBe('balanced');
  });
  it('a halkítás kulcs-sávja megmarad', () => {
    expect(masterProposal(analyze(speech(6)), 'youtube', 'sfx').master.duckTrigger).toBe('sfx');
  });
  it('LRA: állandó jel ~0, váltakozó (20 dB) nagy', () => {
    expect(loudnessRange(analyze(music(0.3)).momentary)).toBeLessThan(1);
    expect(loudnessRange(analyze(speech(13, { swing: true })).momentary)).toBeGreaterThan(14);
  });
});
