import { createEmptyProject } from '@/lib/projectUtils';
import { referenceMatchGain, referenceProject } from './referenceAB';

describe('referencia A/B (R5)', () => {
  it('a referencia a keverés hangosságára illesztve: −8 LUFS ref, −20 LUFS mix → −12 dB', () => {
    expect(20 * Math.log10(referenceMatchGain(-8, -20))).toBeCloseTo(-12, 9);
    expect(20 * Math.log10(referenceMatchGain(-30, -10))).toBeCloseTo(12, 9); // +12 dB plafon
    expect(referenceMatchGain(Number.NaN, -10)).toBe(1);
  });
  it('egyklipes projekt a referenciával; az eredeti projekt nem változik', () => {
    const base = createEmptyProject('p', '9:16', undefined, 'audio');
    const snapshot = JSON.stringify(base);
    const r = referenceProject(base, { uri: 'file:///ref.wav', name: 'ref', duration: 30 }, 0.25);
    const clips = r.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toEqual(expect.objectContaining({ uri: 'file:///ref.wav', volume: 0.25, start: 0, duration: 30 }));
    expect(r.audioMaster).toBeUndefined();
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
