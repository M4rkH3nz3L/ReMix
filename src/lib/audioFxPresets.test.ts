import { AUDIO_FX_PRESETS, presetFx } from '@/lib/audioFxPresets';

describe('audioFxPresets — hang-FX presetek', () => {
  it('minden presetnek van kulcsa/címkéje/ikonja/fx-e', () => {
    expect(AUDIO_FX_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const p of AUDIO_FX_PRESETS) {
      expect(p.key).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.icon).toBeTruthy();
      expect(typeof p.fx).toBe('object');
    }
  });

  it('Telefon: sáv-korlátozó (highpass + lowpass)', () => {
    const fx = presetFx('phone');
    expect(fx.highpass).toBe(400);
    expect(fx.lowpass).toBe(3000);
  });

  it('Mély/Magas: pitch-eltolás ±', () => {
    expect(presetFx('deep').pitchSemitones).toBe(-4);
    expect(presetFx('bright').pitchSemitones).toBe(5);
  });

  it('Podcast: tisztító lánc (gate + de-esser + komp + normalize)', () => {
    const fx = presetFx('podcast');
    expect(fx.gate).toBe(true);
    expect(fx.deEsser).toBe(true);
    expect(fx.compressor).toBe(true);
    expect(fx.normalize).toBe(true);
  });

  it('Tiszta: üres FX', () => {
    expect(presetFx('clean')).toEqual({});
  });

  it('presetFx új objektumot ad (nem a megosztott referenciát)', () => {
    const a = presetFx('phone');
    a.highpass = 999;
    expect(presetFx('phone').highpass).toBe(400); // az eredeti érintetlen
  });

  it('ismeretlen kulcs → üres', () => {
    expect(presetFx('nope')).toEqual({});
  });
});
