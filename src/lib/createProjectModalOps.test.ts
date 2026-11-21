import { AUDIO_MASTER_TARGETS } from '@/lib/audioMaster';
import {
  AUDIO_TARGETS,
  bgHexValue,
  digitsOnly,
  isCanvasPresetActive,
  sourceAssetIcon,
} from '@/lib/createProjectModalOps';

describe('createProjectModalOps — az „Új projekt" modal tiszta magja', () => {
  it('a hang master-cél opciói: a katalógus sorrendje, a „custom" nélkül', () => {
    expect(AUDIO_TARGETS).toEqual(AUDIO_MASTER_TARGETS.filter((tg) => tg !== 'custom'));
    expect(AUDIO_TARGETS).not.toContain('custom');
    expect(AUDIO_TARGETS.length).toBe(AUDIO_MASTER_TARGETS.length - 1);
  });

  it('a W×H mezőbe csak számjegy kerül (tizedes, előjel, szóköz is kiesik)', () => {
    expect(digitsOnly('1080')).toBe('1080');
    expect(digitsOnly(' 1 9a2-0.5,x')).toBe('19205');
    expect(digitsOnly('-12')).toBe('12');
    expect(digitsOnly('')).toBe('');
    expect(digitsOnly('١٢٣')).toBe('');
  });

  it('a vászon-preset aktív, ha a SZORÍTOTT W×H egyezik (üres/túl nagy érték a határra esik)', () => {
    expect(isCanvasPresetActive('1080', '1920', { w: 1080, h: 1920 })).toBe(true);
    expect(isCanvasPresetActive('1920', '1080', { w: 1080, h: 1920 })).toBe(false);
    expect(isCanvasPresetActive('99999', '16', { w: 4096, h: 16 })).toBe(true);
    expect(isCanvasPresetActive('', '0', { w: 16, h: 16 })).toBe(true);
    expect(isCanvasPresetActive('1079.6', '1080', { w: 1080, h: 1080 })).toBe(true);
  });

  it('a hex-mező: átlátszó háttérnél üres, egyébként a nyers érték (validálás nélkül)', () => {
    expect(bgHexValue('transparent')).toBe('');
    expect(bgHexValue('#123456')).toBe('#123456');
    expect(bgHexValue('nem-szín')).toBe('nem-szín');
    expect(bgHexValue('')).toBe('');
  });

  it('a forrás-elem ikonja: videó / hang / minden más kép-ikon (a 3D-modell is)', () => {
    expect(sourceAssetIcon('video')).toBe('videocam');
    expect(sourceAssetIcon('audio')).toBe('musical-notes');
    expect(sourceAssetIcon('image')).toBe('image');
    expect(sourceAssetIcon('model')).toBe('image');
  });
});
