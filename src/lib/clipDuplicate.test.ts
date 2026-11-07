import { duplicateAfter } from './clipDuplicate';
import type { Clip } from '@/types/project';

const clip = (id: string, start: number, duration: number) => ({ kind: 'audio', id, start, duration }) as unknown as Clip;

describe('duplicateAfter', () => {
  let n = 0;
  const id = () => `new${++n}`;
  it('egy klip: közvetlenül utána, új azonosítóval', () => {
    const [d] = duplicateAfter([clip('a', 2, 3)], 30, id);
    expect(d.start).toBe(5);
    expect(d.id).not.toBe('a');
    expect(d.duration).toBe(3);
  });
  it('több klip: a kijelölés vége után, a relatív távolság marad', () => {
    const out = duplicateAfter([clip('a', 1, 2), clip('b', 4, 1)], 30, id);
    expect(out.map((c) => c.start)).toEqual([5, 8]);
  });
  it('a kezdet a frame-rácsra ül', () => {
    const [d] = duplicateAfter([clip('a', 0, 1.01)], 30, id);
    expect(Math.round(d.start * 30)).toBeCloseTo(d.start * 30, 6);
  });
});
