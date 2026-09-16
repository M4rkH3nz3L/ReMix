import { isRenderCancelledError } from '@/lib/render';

/**
 * A megszakítás a kódbázisban NÉV alapján azonosított (`RenderCancelledError`),
 * mert a `nativeRender.ts` nem importálhatja az osztályt a `render.ts`-ből —
 * az körkörös import lenne. Ez a szerződés könnyen elromlik egy átnevezéssel,
 * ezért teszt rögzíti.
 */
describe('isRenderCancelledError — a megszakítás felismerése', () => {
  it('felismeri a NÉV alapján gyártott hibát (nativeRender útja)', () => {
    const err = new Error('megszakítva');
    err.name = 'RenderCancelledError';
    expect(isRenderCancelledError(err)).toBe(true);
  });

  it('sima hibát NEM tekint megszakításnak', () => {
    expect(isRenderCancelledError(new Error('hálózati hiba'))).toBe(false);
  });

  it('nem dől el nem-hiba értékeken', () => {
    expect(isRenderCancelledError(null)).toBe(false);
    expect(isRenderCancelledError(undefined)).toBe(false);
    expect(isRenderCancelledError('szöveg')).toBe(false);
    expect(isRenderCancelledError({ name: 'Valami' })).toBe(false);
  });

  it('a sima objektumot is elfogadja, ha a neve stimmel (szerializáción átment hiba)', () => {
    expect(isRenderCancelledError({ name: 'RenderCancelledError' })).toBe(true);
  });
});
