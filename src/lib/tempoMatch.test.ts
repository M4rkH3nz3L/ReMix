import { tempoMatchPatch, tempoResetPatch } from './tempoMatch';
import type { AudioClip } from '@/types/project';

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({ kind: 'audio', id: 'c', uri: 'file:///a.wav', label: 'a', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });

describe('tempoMatch', () => {
  it('120 BPM-es minta 100 BPM-es projektben: sebesség 0,8333, a hossz 9,6 s (ugyanaz a forrás-szakasz)', () => {
    const p = tempoMatchPatch(clip(), 120, 100)!;
    expect(p.speed).toBeCloseTo(0.833333, 6);
    expect(p.duration).toBeCloseTo(9.6, 9);
    expect(p.sourceBpm).toBe(120);
  });
  it('már nyújtott klip újraillesztése: a forrás-szakasz marad', () => {
    const c = clip({ speed: 1.25, duration: 6.4 }); // 8 s forrás
    const p = tempoMatchPatch(c, 100, 100)!;
    expect(p.speed).toBe(1);
    expect(p.duration).toBeCloseTo(8, 9);
  });
  it('a határon kívül (0,5–2×), loop / visszafelé klipnél nincs illesztés', () => {
    expect(tempoMatchPatch(clip(), 60, 140)).toBeNull();
    expect(tempoMatchPatch(clip({ loopLength: 2 }), 120, 100)).toBeNull();
    expect(tempoMatchPatch(clip({ reversed: true }), 120, 100)).toBeNull();
    expect(tempoMatchPatch(clip(), 0, 100)).toBeNull();
  });
  it('visszaállítás: sebesség 1, a hossz a forrás-szakasz', () => {
    expect(tempoResetPatch(clip({ speed: 0.8, duration: 10 }))).toEqual({ speed: 1, duration: 8 });
  });
});
