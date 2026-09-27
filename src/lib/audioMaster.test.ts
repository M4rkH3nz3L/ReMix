import { dynamicsLra, masterPreset } from '@/lib/audioMaster';

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
