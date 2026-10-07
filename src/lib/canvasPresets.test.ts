import { clampDim, effectiveCanvas, nearestAspect } from '@/lib/canvasPresets';
import { createImageDoc, docBackground, setBackground } from '@/lib/imageDoc';
import type { ImageDoc } from '@/types/project';

let n = 0;
const id = () => `id${n++}`;

describe('canvasPresets', () => {
  it('nearestAspect maps free W×H to the closest enum', () => {
    expect(nearestAspect(1920, 1080)).toBe('16:9');
    expect(nearestAspect(1080, 1920)).toBe('9:16');
    expect(nearestAspect(1080, 1080)).toBe('1:1');
    expect(nearestAspect(1200, 1000)).toBe('1:1'); // 1.2 közelebb az 1-hez, mint 16:9
  });

  it('clampDim parses + bounds to [16, 4096], even-ish rounding not required', () => {
    expect(clampDim('1080')).toBe(1080);
    expect(clampDim('0')).toBe(16);
    expect(clampDim('999999')).toBe(4096);
    expect(clampDim('abc')).toBe(16);
  });

  it('effectiveCanvas uses explicit W×H, else derives from aspect at 1080 short edge', () => {
    expect(effectiveCanvas({ aspectRatio: '1:1', width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(effectiveCanvas({ aspectRatio: '9:16' })).toEqual({ width: 1080, height: 1920 });
    expect(effectiveCanvas({ aspectRatio: '16:9' })).toEqual({ width: 1920, height: 1080 });
    expect(effectiveCanvas({ aspectRatio: '1:1' })).toEqual({ width: 1080, height: 1080 });
  });
});

describe('imageDoc background', () => {
  const base = (): ImageDoc => createImageDoc('x', '1:1', id, { background: '#101010' });

  it('docBackground reads the bottom fill, or transparent when none', () => {
    expect(docBackground(base())).toBe('#101010');
    const transparent = createImageDoc('x', '1:1', id, { background: 'transparent' });
    expect(transparent.layers.length).toBe(0);
    expect(docBackground(transparent)).toBe('transparent');
  });

  it('setBackground recolors the existing bottom fill (keeps other layers)', () => {
    let doc = base();
    doc = { ...doc, layers: [...doc.layers, { kind: 'shape', id: id(), shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#fff' }] };
    const next = setBackground(doc, '#00ff00', id);
    expect(next.layers.length).toBe(2); // nem nőtt
    expect(next.layers[0].kind === 'fill' && next.layers[0].fill).toBe('#00ff00');
    expect(next.layers[1].kind).toBe('shape'); // a rajzréteg érintetlen
  });

  it('setBackground transparent removes the bottom fill only', () => {
    const next = setBackground(base(), 'transparent', id);
    expect(next.layers.length).toBe(0);
    expect(docBackground(next)).toBe('transparent');
  });

  it('setBackground inserts a fill at the bottom when the doc is transparent', () => {
    const transparent = createImageDoc('x', '1:1', id, { background: 'transparent' });
    const next = setBackground(transparent, '#123456', id);
    expect(next.layers.length).toBe(1);
    expect(next.layers[0].kind === 'fill' && next.layers[0].fill).toBe('#123456');
  });
});
