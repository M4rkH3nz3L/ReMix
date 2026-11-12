import { curateDeviceVoices, type DeviceVoice } from '@/lib/ttsOnDevice';

/** 🗣️ AP5: a telefonos hangok közül nyelvenként a legjobb, az app nyelve elöl. */
const v = (id: string, language: string, quality: number): DeviceVoice => ({ id, name: id, language, quality });

describe('🗣️ telefonos hangok', () => {
  it('nyelvenként a legjobb minőség; az app nyelve, majd a gyakori nyelvek elöl', () => {
    const out = curateDeviceVoices([v('a', 'en-US', 1), v('b', 'en-US', 2), v('c', 'hu-HU', 1), v('d', 'de-DE', 1), v('e', 'ja-JP', 3), v('f', 'fr-FR', 1)], 'de');
    expect(out.map((x) => x.id)).toEqual(['d', 'c', 'b', 'f', 'e']);
  });
  it('legfeljebb 12 hang; üres listára üres', () => {
    const many = Array.from({ length: 30 }, (_, i) => v(`x${i}`, `l${i}-XX`, 1));
    expect(curateDeviceVoices(many, 'hu')).toHaveLength(12);
    expect(curateDeviceVoices([], 'hu')).toEqual([]);
  });
});
