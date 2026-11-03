import { groupEarnings } from '@/lib/coins';


describe('groupEarnings (C3.5)', () => {
  it('hónaponként forrásonként összegez, legújabb elöl', () => {
    expect(
      groupEarnings([
        { month: '2026-10', kind: 'sale', cents: 300 },
        { month: '2026-11', kind: 'gift', cents: 80 },
        { month: '2026-11', kind: 'sale', cents: 70 },
        { month: '2026-11', kind: 'gift', cents: 20 },
      ])
    ).toEqual([
      { month: '2026-11', byKind: { gift: 100, sale: 70 }, totalCents: 170 },
      { month: '2026-10', byKind: { sale: 300 }, totalCents: 300 },
    ]);
  });
});
