/**
 * 🎚️ A klip-szerkesztő lap tiszta számításai — a REFACTOR (ClipEditSheet → clipEdit/ + clipEditOps)
 * előtti viselkedést rögzíti: a „mentetlen?” döntés, a mentett patch-ek pontos értékei (rács, fade-vágás),
 * a loop-kapcsoló, az effekt-automáció táblája és a stem-köteg.
 */
import {
  beatLabel,
  clipDonePatch,
  clipEditDirty,
  clipGeometryChanged,
  FX_AUTO,
  fxStageActive,
  loopTogglePatch,
  paramEqCustomized,
  pendingSettingsPatch,
  stemSeparationCommands,
  type ClipEditSettings,
} from '@/lib/clipEditOps';
import type { AudioClip } from '@/types/project';

const clip = { kind: 'audio', id: 'c1', uri: 'file:///a.m4a', label: 'a', start: 1, duration: 4, volume: 1, fadeIn: 0.5, fadeOut: 0.25 } as AudioClip;
const settingsOf = (c: AudioClip): ClipEditSettings => ({
  volume: c.volume,
  fadeIn: c.fadeIn,
  fadeOut: c.fadeOut,
  duration: c.duration,
  trimIn: c.trimIn ?? 0,
  pan: c.pan ?? 0,
  voiceEnhance: !!c.voiceEnhance,
  deReverb: !!c.deReverb,
  autoDuck: !!c.autoDuck,
  fx: c.audioFx ?? {},
});

describe('clipEditDirty — van-e mentetlen módosítás', () => {
  it('a klipből képzett beállítás nem piszkos (a hiányzó trimIn/pan/kapcsolók alapértéke 0 / false, az fx {})', () => {
    expect(clipEditDirty(clip, settingsOf(clip))).toBe(false);
  });

  it.each([
    ['volume', 0.5],
    ['fadeIn', 0],
    ['fadeOut', 1],
    ['duration', 3],
    ['trimIn', 0.1],
    ['pan', -0.2],
    ['voiceEnhance', true],
    ['deReverb', true],
    ['autoDuck', true],
    ['fx', { reverb: 0.2 }],
  ] as const)('a(z) %s eltérése piszkos', (key, value) => {
    expect(clipEditDirty(clip, { ...settingsOf(clip), [key]: value })).toBe(true);
  });

  it('az effekt-összevetés JSON-alapú: azonos tartalom más kulcs-sorrenddel is piszkosnak számít', () => {
    const c = { ...clip, audioFx: { reverb: 0.2, delay: 0.1 } } as AudioClip;
    expect(clipEditDirty(c, { ...settingsOf(c), fx: { reverb: 0.2, delay: 0.1 } })).toBe(false);
    expect(clipEditDirty(c, { ...settingsOf(c), fx: { delay: 0.1, reverb: 0.2 } })).toBe(true);
  });
});

describe('a mentett patch-ek', () => {
  it('a vágás csak a hossz vagy a be-pont állításakor számít módosításnak', () => {
    const c = { ...clip, trimIn: 0.2731 } as AudioClip;
    expect(clipGeometryChanged(c, 4, 0.2731)).toBe(false);
    expect(clipGeometryChanged(c, 3.9, 0.2731)).toBe(true);
    expect(clipGeometryChanged(clip, 4, 0)).toBe(false);
    expect(clipGeometryChanged(clip, 4, 0.01)).toBe(true);
  });

  it('a függő beállítások patch-e a fade-eket a MENTETT hosszra vágja, vágást nem ír', () => {
    const s = { ...settingsOf(clip), volume: 0.25, pan: 0.5, fadeIn: 9, fadeOut: 3, duration: 2, trimIn: 1, voiceEnhance: true, fx: { gate: true } };
    expect(pendingSettingsPatch(clip, s)).toEqual({ volume: 0.25, pan: 0.5, fadeIn: 4, fadeOut: 3, voiceEnhance: true, deReverb: false, autoDuck: false, audioFx: { gate: true } });
    expect(Object.keys(pendingSettingsPatch(clip, s))).toEqual(['volume', 'pan', 'fadeIn', 'fadeOut', 'voiceEnhance', 'deReverb', 'autoDuck', 'audioFx']);
  });

  it('„Kész” vágás nélkül: a késés-kompenzált trimIn érintetlen, a forrás-hossz a klip hossza', () => {
    const c = { ...clip, trimIn: 0.2731 } as AudioClip;
    const patch = clipDonePatch(c, { ...settingsOf(c), volume: 2, fadeIn: 10 }, 30, 4);
    expect(patch).toEqual({ volume: 2, pan: 0, fadeIn: 4, fadeOut: 0.25, sourceDuration: 4, voiceEnhance: false, deReverb: false, autoDuck: false, audioFx: {} });
    expect('trimIn' in patch).toBe(false);
  });

  it('„Kész” vágással: a hossz és a be-pont a rácsra ül, a fade a rácsos hosszon belül marad', () => {
    const patch = clipDonePatch(clip, { ...settingsOf(clip), duration: 2.01234, trimIn: 0.31234, fadeIn: 5, fadeOut: 0.1 }, 30, 12);
    expect(patch).toMatchObject({ duration: 2, trimIn: 0.3, fadeIn: 2, fadeOut: 0.1, sourceDuration: 12 });
    expect(Object.keys(patch)).toEqual(['volume', 'pan', 'fadeIn', 'fadeOut', 'duration', 'trimIn', 'sourceDuration', 'voiceEnhance', 'deReverb', 'autoDuck', 'audioFx']);
  });

  it('„Kész” vágással: a hossz legalább egy rácsra tett 0,1 s (a fade a nyers rácsos hosszra vágódik)', () => {
    const patch = clipDonePatch(clip, { ...settingsOf(clip), duration: 0.01, fadeIn: 1, fadeOut: 1 }, 30, 4);
    expect(patch.duration).toBe(0.1);
    expect(patch.fadeIn).toBe(0);
    expect(patch.fadeOut).toBe(0);
  });

  it('hang-projektben (44,1 kHz-es rács) a minta a rács', () => {
    const patch = clipDonePatch(clip, { ...settingsOf(clip), duration: 1.0000123, trimIn: 0.5000123 }, 44100, 4);
    expect(patch.duration).toBe(Math.round(1.0000123 * 44100) / 44100);
    expect(patch.trimIn).toBe(Math.round(0.5000123 * 44100) / 44100);
  });
});

describe('loopTogglePatch', () => {
  it('be: a loop hossza a klip hossza, az eltolás törlődik', () => {
    expect(loopTogglePatch(clip, true)).toEqual({ loopLength: 4, loopOffset: undefined });
    expect(Object.keys(loopTogglePatch(clip, true))).toEqual(['loopLength', 'loopOffset']);
  });

  it('ki: a klip nem lóghat túl a forráson (de legalább 0,1 s), és nem nőhet', () => {
    expect(loopTogglePatch({ ...clip, duration: 10, sourceDuration: 6, trimIn: 2 } as AudioClip, false)).toEqual({ loopLength: undefined, loopOffset: undefined, duration: 4 });
    expect(loopTogglePatch({ ...clip, duration: 10, sourceDuration: 2, trimIn: 2 } as AudioClip, false).duration).toBe(0.1);
    expect(loopTogglePatch({ ...clip, duration: 3, sourceDuration: 20 } as AudioClip, false).duration).toBe(3);
    // forrás-hossz nélkül a klip hossza a forrás
    expect(loopTogglePatch({ ...clip, duration: 4, trimIn: 1 } as AudioClip, false).duration).toBe(3);
  });
});

describe('effekt-segédek', () => {
  it('a parametrikus EQ csak az alapértéktől eltérő frekvenciánál / Q-nál nyílik ki', () => {
    expect(paramEqCustomized(undefined)).toBe(false);
    expect(paramEqCustomized({ low: 6, mid: -3, high: 2 })).toBe(false);
    expect(paramEqCustomized({ low: 0, mid: 0, high: 0, midFreq: 1200 })).toBe(true);
    expect(paramEqCustomized({ low: 0, mid: 0, high: 0, highQ: 1.5 })).toBe(true);
  });

  it('a delay ütem-címkéi, ismeretlen értékre maga a szám', () => {
    expect([0.25, 0.5, 0.75, 1, 2, 3].map(beatLabel)).toEqual(['1/16', '1/8', '1/8.', '1/4', '1/2', '3']);
  });

  it('a lánc-fokozat akkor aktív, ha szól (szűrő/EQ bármely sávja, zengés/delay > 0, kapcsolók)', () => {
    expect(fxStageActive({}, 'filters')).toBe(false);
    expect(fxStageActive({ lowpass: 12000 }, 'filters')).toBe(true);
    expect(fxStageActive({ highpass: 80 }, 'filters')).toBe(true);
    expect(fxStageActive({ eq: { low: 0, mid: 0, high: 0 } }, 'eq')).toBe(false);
    expect(fxStageActive({ eq: { low: 0, mid: 0, high: -2 } }, 'eq')).toBe(true);
    expect(fxStageActive({ reverb: 0 }, 'reverb')).toBe(false);
    expect(fxStageActive({ reverb: 0.1 }, 'reverb')).toBe(true);
    expect(fxStageActive({ delay: 0.1 }, 'delay')).toBe(true);
    expect(fxStageActive({ gate: true }, 'gate')).toBe(true);
    expect(fxStageActive({ compressor: false }, 'compressor')).toBe(false);
    expect(fxStageActive({ stereoWide: true }, 'stereoWide')).toBe(true);
  });

  it('az automatizálható effekt-paraméterek tartománya, alapértéke és kiírása', () => {
    expect(FX_AUTO.map((c) => [c.key, c.min, c.max])).toEqual([
      ['fxLowpass', 1000, 20000],
      ['fxHighpass', 20, 2000],
      ['fxReverb', 0, 1],
      ['fxDelay', 0, 1],
      ['fxEqLow', -12, 12],
      ['fxEqMid', -12, 12],
      ['fxEqHigh', -12, 12],
      ['fxEqLowFreq', 20, 500],
      ['fxEqMidFreq', 200, 8000],
      ['fxEqHighFreq', 2000, 20000],
    ]);
    // a 0 szűrő „ki” → a görbe alapja a tartomány széle
    expect(FX_AUTO.map((c) => c.fallback(undefined))).toEqual([20000, 20, 0, 0, 0, 0, 0, 100, 1000, 8000]);
    expect(FX_AUTO.map((c) => c.fallback({ lowpass: 8000, highpass: 120, reverb: 0.4, delay: 0.3, eq: { low: 2, mid: -1, high: 3, midFreq: 1500 } }))).toEqual([8000, 120, 0.4, 0.3, 2, -1, 3, 100, 1500, 8000]);
    expect(FX_AUTO.map((c) => c.format(1234.5))).toEqual(['1.2 kHz', '1235 Hz', '123450%', '123450%', '+1234.5 dB', '+1234.5 dB', '+1234.5 dB', '1.2 kHz', '1.2 kHz', '1.2 kHz']);
    expect(FX_AUTO.map((c) => c.format(-0.5))).toEqual(['-0.0 kHz', '0 Hz', '-50%', '-50%', '-0.5 dB', '-0.5 dB', '-0.5 dB', '0 Hz', '0 Hz', '0 Hz']);
  });
});

describe('stemSeparationCommands', () => {
  it('a stem-klipek hozzáadása, utána az eredeti elnémítása — egy kötegben, sorrendben', () => {
    let n = 0;
    const cmds = stemSeparationCommands(clip, [{ name: 'vocals', url: 'https://x/v.wav' }, { name: 'drums', url: 'https://x/d.wav' }], () => `id${++n}`);
    expect(cmds.map((c) => c.type)).toEqual(['ADD_CLIP', 'ADD_CLIP', 'UPDATE_CLIP']);
    expect(cmds[2]).toEqual({ type: 'UPDATE_CLIP', clipId: 'c1', patch: { volume: 0 } });
    expect(cmds.slice(0, 2).map((c) => (c.type === 'ADD_CLIP' ? [c.trackType, c.clip.id, (c.clip as AudioClip).uri] : null))).toEqual([
      ['voiceover', 'id1', 'https://x/v.wav'],
      ['sfx', 'id2', 'https://x/d.wav'],
    ]);
  });

  it('üres stem-listára csak az elnémítás marad', () => {
    expect(stemSeparationCommands(clip, [], () => 'x')).toEqual([{ type: 'UPDATE_CLIP', clipId: 'c1', patch: { volume: 0 } }]);
  });
});
