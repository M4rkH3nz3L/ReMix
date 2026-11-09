import { buildFxChain } from './audioDsp';
import { FX_STAGES, fxStageOrder, isDefaultOrder, moveStage } from './fxOrder';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const worker = require('../../server/voicechain');

describe('fxOrder (R3)', () => {
  it('normalizál: érvénytelen / ismétlődő kimarad, a hiányzók az alap helyükön a végén', () => {
    expect(fxStageOrder(undefined)).toEqual([...FX_STAGES]);
    expect(fxStageOrder(['reverb', 'compressor', 'reverb', 'bogus'])).toEqual(['reverb', 'compressor', 'filters', 'eq', 'gate', 'deEsser', 'delay', 'stereoWide']);
  });
  it('léptetés: a szélén nem mozdul; az alap sorrend felismerhető', () => {
    expect(moveStage(undefined, 'compressor', 1).slice(4, 6)).toEqual(['reverb', 'compressor']);
    expect(moveStage(undefined, 'filters', -1)).toEqual([...FX_STAGES]);
    expect(isDefaultOrder(undefined)).toBe(true);
    expect(isDefaultOrder(moveStage(undefined, 'eq', 1))).toBe(false);
  });

  describe('🤝 kliens ↔ szerver szerződés', () => {
    const marker: Record<string, string> = { filters: 'highpass=', eq: 'equalizer=', gate: 'agate=', deEsser: 'deesser', compressor: 'acompressor=', reverb: 'aecho=0.8:0.9', delay: 'aecho=0.8:0.6', stereoWide: 'haas' };
    const fx = { highpass: 80, eq: { low: 3, mid: 0, high: 0 }, gate: true, deEsser: true, compressor: true, reverb: 0.4, delay: 0.3, stereoWide: true };
    let seed = 9;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const shuffles = [undefined, ['reverb', 'compressor'], ...Array.from({ length: 8 }, () => [...FX_STAGES].sort(() => rnd() - 0.5))];
    it.each(shuffles.map((o) => [JSON.stringify(o), o]))('ugyanaz a sorrend: %s', (_n, order) => {
      const client = fxStageOrder(order as string[] | undefined);
      expect(worker.fxStageOrder(order)).toEqual(client);
      // a szerver szűrőláncában a fokozatok PONTOSAN a kliens sorrendjében jönnek
      const chain: string = worker.audioFxChain({ ...fx, order });
      const pos = client.map((s) => chain.indexOf(marker[s]));
      expect(pos.every((p) => p >= 0)).toBe(true);
      expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    });
  });
});

describe('a telefonos lánc a sorrendet követi', () => {
  it('kompresszor → zengés vs. zengés → kompresszor → szélesítés: a feldolgozók sorrendje', () => {
    const names = (order?: string[]) => buildFxChain({ compressor: true, reverb: 0.4, stereoWide: true, limiter: true, order }, 44100).map((p) => p.constructor.name);
    expect(names()).toEqual(['Compressor', 'Echo', 'Haas', 'Limiter']);
    expect(names(['stereoWide', 'reverb', 'compressor'])).toEqual(['Haas', 'Echo', 'Compressor', 'Limiter']);
  });
});
