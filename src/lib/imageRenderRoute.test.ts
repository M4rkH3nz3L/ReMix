import { chooseImageRenderRoute, serverOnlyEffects, stageSettleMs, stageSize } from '@/lib/imageRenderRoute';
import type { ImageDoc, ImageLayer } from '@/types/project';

const photo = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, kind: 'photo', uri: `file:///${id}.png`, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, ...extra }) as unknown as ImageLayer;

const doc = (layers: ImageLayer[], extra: Partial<ImageDoc> = {}) =>
  ({ id: 'd', name: 'd', aspectRatio: '1:1', width: 1000, height: 500, layers, ...extra }) as unknown as ImageDoc;

const develop = (detail: Record<string, number>) => ({ develop: { base: {}, detail } });

describe('🧭 kép-render útvonal (offline first)', () => {
  it('sima dokumentum: mindig a telefon renderel, worker mellett is', () => {
    const d = doc([photo('a'), { id: 't', kind: 'text', text: 'Hi' } as unknown as ImageLayer]);
    expect(serverOnlyEffects(d)).toEqual([]);
    expect(chooseImageRenderRoute(d, true)).toBe('device');
    expect(chooseImageRenderRoute(d, false)).toBe('device');
  });

  it('a csak-exportban effektek a workert kérik, ha elérhető', () => {
    const d = doc([photo('a', develop({ noiseReduction: 0.4, clarity: 0.5 })), photo('b', develop({ lensDistortion: -0.2 }))]);
    expect(serverOnlyEffects(d)).toEqual(['noiseReduction', 'lensDistortion']);
    expect(chooseImageRenderRoute(d, true)).toBe('worker');
  });

  it('worker nélkül a telefon renderel (a hívó jelzi a kimaradó effektet)', () => {
    const d = doc([photo('a', develop({ chromaticAberration: 0.3 }))]);
    expect(chooseImageRenderRoute(d, false)).toBe('device');
    expect(serverOnlyEffects(d)).toEqual(['chromaticAberration']);
  });

  it('rejtett réteg és rejtett csoport effektje nem számít', () => {
    const d = doc(
      [photo('a', { hidden: true, ...develop({ noiseReduction: 1 }) }), photo('b', { groupId: 'g', ...develop({ lensDistortion: 1 }) })],
      { groups: [{ id: 'g', name: 'g', hidden: true }] } as unknown as Partial<ImageDoc>
    );
    expect(serverOnlyEffects(d)).toEqual([]);
  });

  it('nulla érték nem effekt', () => {
    expect(serverOnlyEffects(doc([photo('a', develop({ noiseReduction: 0, lensDistortion: 0 }))]))).toEqual([]);
  });

  it('a színpad mérete a kért pixelmagasságból és a vászon arányából', () => {
    expect(stageSize({ width: 1000, height: 500 }, 2000, 2)).toEqual({ widthPx: 4000, heightPx: 2000, w: 2000, h: 1000 });
    expect(stageSize({ width: 1080, height: 1920 }, 4096, 3)).toEqual({ widthPx: 2304, heightPx: 4096, w: 768, h: 4096 / 3 });
    expect(stageSize({ width: 1, height: 1 }, 0, 0)).toEqual({ widthPx: 1, heightPx: 1, w: 1, h: 1 });
  });

  it('a várakozás a betöltendő képekkel nő, felül korlátos', () => {
    expect(stageSettleMs(doc([]))).toBe(250);
    expect(stageSettleMs(doc([photo('a', { mask: { image: 'file:///m.png' } })]))).toBe(650);
    expect(stageSettleMs(doc(Array.from({ length: 40 }, (_, i) => photo(`p${i}`))))).toBe(2500);
  });
});
