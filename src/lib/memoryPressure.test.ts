import { setCaughtSink } from '@/lib/logCaught';
import { onMemoryWarning } from '@/lib/memoryPressure';

describe('onMemoryWarning', () => {
  const seen: string[] = [];
  beforeEach(() => {
    seen.length = 0;
    setCaughtSink((_error, where) => { seen.push(where); });
  });

  it('naplóz és üríti a gyorsítótárat', () => {
    const clear = jest.fn();
    onMemoryWarning(clear);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['lib/memoryPressure.ts:warning']);
  });

  it('az ürítés hibája is nyomot hagy, és nem dob tovább', () => {
    expect(() => onMemoryWarning(() => { throw new Error('x'); })).not.toThrow();
    expect(seen).toContain('lib/memoryPressure.ts:clear');
  });
});
