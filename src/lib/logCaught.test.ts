import { logCaught, setCaughtSink } from '@/lib/logCaught';

afterEach(() => setCaughtSink(null));

describe('elkapott hibák', () => {
  it('a kézbesítő megkapja a helyet és az osztályt', () => {
    const got: unknown[][] = [];
    setCaughtSink((e, w, c) => got.push([e, w, c]));
    const err = new Error('Network request failed');
    logCaught('a.ts:f', err);
    expect(got).toEqual([[err, 'a.ts:f', 'network']]);
  });
  it('az indulás közbeni hibák nem vesznek el', () => {
    logCaught('korai.ts:g', new Error('x'));
    const got: string[] = [];
    setCaughtSink((_e, w) => got.push(w));
    expect(got).toEqual(['korai.ts:g']);
  });
  it('a hibás kézbesítő nem dob vissza a hívóba', () => {
    setCaughtSink(() => {
      throw new Error('rossz');
    });
    expect(() => logCaught('b.ts', new Error('y'))).not.toThrow();
  });
  it('bármilyen dobott értéket elfogad', () => {
    const got: string[] = [];
    setCaughtSink((_e, _w, c) => got.push(c));
    [null, undefined, 'szöveg', 42, {}].forEach((v) => logCaught('c.ts', v));
    expect(got).toHaveLength(5);
  });
});
