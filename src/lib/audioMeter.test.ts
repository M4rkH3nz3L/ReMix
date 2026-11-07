import { barsBeatsLabel, beatGridForView, meterLabel, nextMeter, snapSec } from '@/lib/audioTransport';

describe('🎼 ütemjelzés', () => {
  it('3/4 @ 120 BPM: 3 negyed egy ütem', () => {
    const m = { beatsPerBar: 3, beatUnit: 4 as const };
    expect(barsBeatsLabel(120, 1.5, m)).toBe('2.1');
    expect(barsBeatsLabel(120, 1.0, m)).toBe('1.3');
    const grid = beatGridForView(120, 3, 0, 3, 100, 4);
    expect(grid.filter((g) => g.downbeat).map((g) => g.sec)).toEqual([0, 1.5, 3]);
  });
  it('6/8 @ 120 BPM (negyedre): nyolcados rács, 6 nyolcad egy ütem', () => {
    const m = { beatsPerBar: 6, beatUnit: 8 as const };
    expect(barsBeatsLabel(120, 0.25, m)).toBe('1.2');
    expect(barsBeatsLabel(120, 1.5, m)).toBe('2.1');
    const grid = beatGridForView(120, 6, 0, 1.5, 100, 8);
    expect(grid.map((g) => g.sec)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
    expect(grid.filter((g) => g.downbeat).map((g) => g.sec)).toEqual([0, 1.5]);
    expect(snapSec(0.3, 'beat', 30, 120, m)).toBeCloseTo(0.25);
  });
  it('4/4 a régi viselkedés (alapérték)', () => {
    expect(barsBeatsLabel(120, 2.0)).toBe('2.1');
    expect(snapSec(0.3, 'beat', 30, 120)).toBeCloseTo(0.5);
  });
  it('a kapcsoló körbe jár, a címke olvasható', () => {
    expect(meterLabel(undefined)).toBe('4/4');
    expect(meterLabel(nextMeter(undefined))).toBe('3/4');
    let m = nextMeter(undefined);
    for (let i = 0; i < 6; i++) m = nextMeter(m);
    expect(meterLabel(m)).toBe('4/4');
  });
});
