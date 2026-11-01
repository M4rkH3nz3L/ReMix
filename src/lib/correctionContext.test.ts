import type { ClipAdjust, GradeId } from '@/types/project';
import { correctionContext, correctionsAbove, correctionsKey, maskedCorrectionsAbove } from '@/lib/imagePixelPipeline';

type L = { id: string; kind: string; hidden?: boolean; mask?: unknown; adjust?: ClipAdjust };

const shape = (id: string): L => ({ id, kind: 'shape' });
const adj = (id: string, extra: Partial<L> = {}): L => ({ id, kind: 'adjust', adjust: { brightness: 0.1 } as ClipAdjust, ...extra });

describe('correctionContext', () => {
  const docs: { layers: L[]; grade?: GradeId; adjust?: ClipAdjust }[] = [
    { layers: [shape('a'), shape('b')] },
    { layers: [shape('a'), adj('x'), shape('b'), adj('y'), shape('c')] },
    { layers: [shape('a'), adj('x', { hidden: true }), shape('b'), adj('y', { mask: { ops: [] } }), shape('c')] },
    { layers: [adj('x'), shape('a')], grade: 'warm' as GradeId },
    { layers: [shape('a'), adj('x'), adj('y', { mask: { ops: [] } }), adj('z')], adjust: { contrast: 0.2 } as ClipAdjust },
  ];

  it.each(docs.map((d, i) => [i, d] as const))('%i: pontosan a rétegenkénti számítást adja', (_i, doc) => {
    const map = correctionContext(doc);
    for (const l of doc.layers) {
      expect(map.get(l.id)?.above).toEqual(correctionsAbove(doc, l.id));
      expect(map.get(l.id)?.masked).toEqual(maskedCorrectionsAbove(doc, l.id));
    }
  });

  it('az azonos készletű rétegek ugyanazt az objektumot kapják', () => {
    const map = correctionContext({ layers: [shape('a'), shape('b'), adj('x'), shape('c'), shape('d')] });
    expect(map.get('a')).toBe(map.get('b'));
    expect(map.get('c')).toBe(map.get('d'));
    expect(map.get('a')).not.toBe(map.get('c'));
  });
});

describe('correctionsKey', () => {
  it('korrekció nélkül üres, a rétegek változása nem számít', () => {
    expect(correctionsKey({ layers: [shape('a')] })).toBe('');
  });

  it('változik, ha a korrekció vagy a sorrend változik', () => {
    const a = { layers: [shape('a'), adj('x')] };
    expect(correctionsKey({ layers: [shape('a'), adj('x', { adjust: { brightness: 0.2 } as ClipAdjust })] })).not.toBe(correctionsKey(a));
    expect(correctionsKey({ layers: [adj('x'), shape('a')] })).not.toBe(correctionsKey(a));
    expect(correctionsKey({ ...a, grade: { lookId: 'warm' } })).not.toBe(correctionsKey(a));
  });
});
