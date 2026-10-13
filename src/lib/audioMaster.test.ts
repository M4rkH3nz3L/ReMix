import { AUDIO_MASTER_TARGETS, dynamicsLra, masterPreset } from '@/lib/audioMaster';

describe('masterPreset', () => {
  it('minden target teljes preset-et ad (target + LUFS + TP + dynamics + eq)', () => {
    const p = masterPreset('podcast');
    expect(p.target).toBe('podcast');
    expect(p.lufs).toBe(-16);
    expect(p.truePeak).toBe(-1.5);
    expect(p.dynamics).toBe('natural');
    expect(p.eq).toEqual({ low: -1, mid: 1, high: 1 });
    expect(masterPreset('music').multiband).toBe(true);
    expect(masterPreset('video').lufs).toBe(-14);
  });
});

describe('dynamicsLra', () => {
  it('kisebb LRA = tömörebb (punchy < balanced < natural)', () => {
    expect(dynamicsLra('punchy')).toBeLessThan(dynamicsLra('balanced'));
    expect(dynamicsLra('balanced')).toBeLessThan(dynamicsLra('natural'));
  });
});

describe('audioMaster — platform presetek (AUDIOT §6)', () => {
  it('a platform-targetek benne vannak a listában', () => {
    for (const t of ['youtube', 'spotify', 'appleMusic', 'tiktok', 'club'] as const) {
      expect(AUDIO_MASTER_TARGETS).toContain(t);
    }
  });
  it('pontos LUFS-szabványok', () => {
    expect(masterPreset('youtube').lufs).toBe(-14);
    expect(masterPreset('spotify').lufs).toBe(-14);
    expect(masterPreset('tiktok').lufs).toBe(-14);
    expect(masterPreset('appleMusic').lufs).toBe(-16);
    expect(masterPreset('club').lufs).toBe(-9);
  });
  it('a target mező visszaköszön + van truePeak-plafon', () => {
    const p = masterPreset('appleMusic');
    expect(p.target).toBe('appleMusic');
    expect(p.truePeak).toBeLessThanOrEqual(0);
  });
});
