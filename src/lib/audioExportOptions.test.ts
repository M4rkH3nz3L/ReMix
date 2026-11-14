import * as OPT from '@/lib/audioExportOptions';
import {
  AUDIO_EXPORT_FORMATS,
  audioExportFileName,
  audioExportSettings,
  audioFormatInfo,
  defaultAudioQuality,
  qualityForFormat,
} from '@/lib/audioExportOptions';

describe('audioExportOptions (A31)', () => {
  it('az Opus felirata nem ígér OGG-t, a fájl .opus', () => {
    expect(audioFormatInfo('opus')).toMatchObject({ label: 'Opus', ext: 'opus' });
  });

  it('veszteséges formátum bitrátát küld, bitmélységet nem', () => {
    const s = audioExportSettings('mp3', { ...defaultAudioQuality('mp3'), bitrateKbps: 320, bitDepth: 24 });
    expect(s).toEqual({ audioFormat: 'mp3', sampleRate: 44100, channels: 2, audioBitrateKbps: 320 });
  });

  it('veszteségmentes formátum bitmélységet küld, bitrátát nem', () => {
    const s = audioExportSettings('wav', { ...defaultAudioQuality('wav'), bitDepth: 24, sampleRate: 48000, channels: 1 });
    expect(s).toEqual({ audioFormat: 'wav', sampleRate: 48000, channels: 1, audioBitDepth: 24 });
  });

  it('formátumváltáskor a nem kínált bitráta az új alapra áll, a többi megmarad', () => {
    const q = { bitrateKbps: 320, bitDepth: 24 as const, sampleRate: 48000 as const, channels: 1 as const };
    expect(qualityForFormat('aac', q)).toEqual({ ...q, bitrateKbps: 256 });
    expect(qualityForFormat('mp3', q)).toEqual(q);
  });

  it('az alap-bitráták a worker alapjaival egyeznek', () => {
    const { audioExtractArgs } = jest.requireActual('../../server/render');
    for (const f of AUDIO_EXPORT_FORMATS.filter((x) => x.lossy)) {
      const args: string[] = audioExtractArgs({ audioFormat: f.id }).args;
      expect(args[args.indexOf('-b:a') + 1]).toBe(`${f.defaultKbps}k`);
    }
  });

  it('a fájlnév ékezet- és jelmentes', () => {
    expect(audioExportFileName('Őszi dal: /demo/ #2', 'flac')).toBe('Oszi_dal_demo_2.flac');
    expect(audioExportFileName('***', 'wav')).toBe('ReMix.wav');
  });
});

describe('🎯 V12: creator-profil az exportnál', () => {
  it('a profil formátumot és minőséget javasol; custom → nincs; Free: a telefonos WAV (44,1 kHz, sztereó, 16 bit)', () => {
    const m = OPT;
    expect(m.profileExport('podcast')).toEqual({ format: 'mp3', quality: { bitrateKbps: 128, bitDepth: 16, sampleRate: 44100, channels: 1 } });
    expect(m.profileExport('appleMusic')?.quality).toMatchObject({ bitDepth: 24, sampleRate: 48000 });
    expect(m.profileExport('youtube')?.format).toBe('aac');
    expect(m.profileExport('custom')).toBeNull();
    expect(m.profileExportOnDevice(m.profileExport('podcast')!)).toEqual({ format: 'wav', quality: { bitrateKbps: 0, bitDepth: 16, sampleRate: 44100, channels: 2 } });
    expect(m.audioExportSettings('mp3', m.profileExport('podcast')!.quality)).toEqual({ audioFormat: 'mp3', sampleRate: 44100, channels: 1, audioBitrateKbps: 128 });
  });

  it('a mért hangosság a cél ±1 LU-n belül ok, alatta halk, fölötte hangos; mérés nélkül null', () => {
    const { loudnessVerdict } = OPT;
    expect(loudnessVerdict(-16.4, -16)).toBe('ok');
    expect(loudnessVerdict(-18, -16)).toBe('quiet');
    expect(loudnessVerdict(-13, -14)).toBe('ok');
    expect(loudnessVerdict(-12.5, -14)).toBe('loud');
    expect(loudnessVerdict(null, -14)).toBeNull();
  });
});
