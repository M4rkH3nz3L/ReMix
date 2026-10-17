import { MIN_CLIP_DURATION } from '@/constants/editor';
import { trimAudioLeft, trimAudioRight } from '@/lib/audioTrim';
import type { AudioClip } from '@/types/project';

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: 'a', kind: 'audio', start: 5, duration: 4,
  uri: 'f', label: 'a', volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported',
  trimIn: 2, sourceDuration: 10, ...over,
});

describe('trimAudioLeft', () => {
  it('jobbra húzás: start + trimIn nő, duration csökken', () => {
    expect(trimAudioLeft(clip(), 1)).toEqual({ start: 6, duration: 3, trimIn: 3 });
  });

  it('balra húzás a forrás tartalékáig (trimIn nem megy 0 alá)', () => {
    const r = trimAudioLeft(clip(), -5); // trimIn=2 → max 2-t lehet balra
    expect(r).toEqual({ start: 3, duration: 6, trimIn: 0 });
  });

  it('nem rövidül MIN_CLIP_DURATION alá', () => {
    const r = trimAudioLeft(clip({ duration: 1 }), 5);
    expect(r.duration).toBeCloseTo(MIN_CLIP_DURATION);
  });

  it('a start nem megy 0 alá (a -start a korlát)', () => {
    const r = trimAudioLeft(clip({ start: 1, trimIn: 5 }), -5);
    expect(r.start).toBe(0);
    expect(r.trimIn).toBe(4);
    expect(r.duration).toBe(5);
  });
});

describe('trimAudioRight', () => {
  it('a forrás-hossz − trimIn a felső korlát', () => {
    expect(trimAudioRight(clip(), 20).duration).toBe(8); // source 10 − trimIn 2
  });

  it('MIN_CLIP_DURATION alá nem', () => {
    expect(trimAudioRight(clip(), 0).duration).toBe(MIN_CLIP_DURATION);
  });

  it('hiányzó sourceDuration/trimIn = csak rövidülhet (max = duration)', () => {
    const c = clip({ sourceDuration: undefined, trimIn: undefined, duration: 4 });
    expect(trimAudioRight(c, 20).duration).toBe(4);
  });
});
