import { applyRing, type Point } from '@/lib/selection';
import { applyRangeRings } from '@/lib/selectionRings';

const sq = (x: number, y: number, s: number): Point[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe('🎯 színtartomány-gyűrűk a kijelölésre', () => {
  it('új kijelölés: az első gyűrű új, a többi a saját műveletével (lyuk = kivonás)', () => {
    const sel = applyRangeRings(null, [{ op: 'add', points: sq(0.1, 0.1, 0.5) }, { op: 'subtract', points: sq(0.2, 0.2, 0.1) }], 'new');
    expect(sel?.ops.map((o) => o.op)).toEqual(['add', 'subtract']);
  });
  it('meglévőhöz adva: csak a régiók (add) számítanak, a kijelölés módjával', () => {
    const base = applyRing(null, sq(0.6, 0.6, 0.3), 'new');
    const sel = applyRangeRings(base, [{ op: 'add', points: sq(0.1, 0.1, 0.2) }, { op: 'subtract', points: sq(0.15, 0.15, 0.05) }], 'subtract');
    expect(sel?.ops.map((o) => o.op)).toEqual(['add', 'subtract']);
    expect(sel?.ops).toHaveLength(2);
  });
  it('üres gyűrűlista új módban null-t ad, meglévőnél a régit', () => {
    const base = applyRing(null, sq(0.1, 0.1, 0.3), 'new');
    expect(applyRangeRings(base, [], 'new')).toBeNull();
    expect(applyRangeRings(base, [], 'add')).toBe(base);
  });
});
