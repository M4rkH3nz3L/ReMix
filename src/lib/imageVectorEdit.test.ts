/** 🧪 Vektor-szerkesztés: a forma a VALÓDI renderen sem mozdulhat el, amikor a modell változik. */
import { canvasToLayerBox, dragInLayer, layerBoxToCanvas, renormalizePathLayer } from '@/lib/imageLayerGeometry';
import { alignLayerToCanvas, distributeLayersInDoc, layerRect, positionedLayerCount } from '@/lib/imageLayerLayout';
import { compositionGuides, mergeGuides } from '@/lib/rulers';
import { booleanCombineInDoc } from '@/lib/imageBoolean';
import { dragHandle, nodeType, pathEditPatch, pathEditView } from '@/lib/vectorPath';
import type { ImageDoc, ImageLayer, PathPoint, PhotoLayer, ShapeLayer, TextLayer } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderImageDoc } = require('../../server/imagedoc');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(60000);

const canvas = { width: 300, height: 200 };
const placed = { position: { x: 0.4, y: 0.6 }, w: 0.3, h: 0.5, rotation: 37, flipH: true };

describe('I28 — réteg-geometria', () => {
  it('oda-vissza pontos forgatott + tükrözött rétegen', () => {
    const p = { x: 0.2, y: 0.9 };
    const back = canvasToLayerBox(layerBoxToCanvas(p, placed, canvas), placed, canvas);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
  it('a húzás a képernyő irányába mozdítja a pontot, forgatástól függetlenül', () => {
    const box = { w: 300, h: 200 };
    const start = { x: 0.5, y: 0.5 };
    const moved = dragInLayer(start, 30, 0, placed, box);
    const a = layerBoxToCanvas(start, placed, canvas);
    const b = layerBoxToCanvas(moved, placed, canvas);
    expect((b.x - a.x) * 300).toBeCloseTo(30);
    expect((b.y - a.y) * 200).toBeCloseTo(0);
  });

  it('dobozból kilógó pont után a forma a kész képen pixelre a helyén marad', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-'));
    const shape = {
      kind: 'shape', id: 's', shape: 'path', closed: true, fill: '#ff0000',
      position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, rotation: 30,
      points: [{ x: 0, y: 0 }, { x: 1.4, y: 0.2 }, { x: 0.5, y: 1 }],
    } as unknown as ShapeLayer;
    const fixed = renormalizePathLayer(shape, canvas);
    expect(fixed.points!.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
    const shot = async (l: ShapeLayer, sub: string) => {
      const w = path.join(dir, sub);
      fs.mkdirSync(w);
      const file = await renderImageDoc({ id: 'd', aspectRatio: '1:1', width: 300, height: 200, layers: [l] }, undefined, w);
      return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 }) as Uint8Array;
    };
    const a = await shot(shape, 'a');
    const b = await shot(fixed, 'b');
    let diff = 0;
    for (let i = 3; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 128) diff += 1;
    fs.rmSync(dir, { recursive: true, force: true });
    // a régi modell a dobozon kívüli részt levághatta — az új nem veszíthet belőle pixelt
    expect(diff / (a.length / 4)).toBeLessThan(0.08);
    expect(b.filter((_, i) => i % 4 === 3 && _ > 128).length).toBeGreaterThanOrEqual(a.filter((_, i) => i % 4 === 3 && _ > 128).length);
  });
  it('dobozon belüli pontoknál nem nyúl a réteghez', () => {
    const l = { position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } as unknown as ShapeLayer;
    expect(renormalizePathLayer(l, canvas)).toBe(l);
  });
});

describe('I27 — fogantyú a node típusa szerint', () => {
  const smooth: PathPoint = { x: 0.5, y: 0.5, h1: { x: 0.3, y: 0.5 }, h2: { x: 0.9, y: 0.5 } };
  it('smooth: a másik fogó hossza megmarad', () => {
    expect(nodeType(smooth)).toBe('smooth');
    const [p] = dragHandle([smooth], 0, 'h2', 0.5, 0.9, nodeType(smooth));
    expect(Math.hypot(p.h1!.x - 0.5, p.h1!.y - 0.5)).toBeCloseTo(0.2);
    expect(nodeType(p)).toBe('smooth');
  });
  it('broken: a másik fogó nem mozdul', () => {
    const broken: PathPoint = { x: 0.5, y: 0.5, h1: { x: 0.3, y: 0.3 }, h2: { x: 0.9, y: 0.5 } };
    const mode = nodeType(broken);
    expect(mode).toBe('broken');
    const [p] = dragHandle([broken], 0, 'h2', 0.5, 0.9, mode);
    expect(p.h1).toEqual({ x: 0.3, y: 0.3 });
  });
});

describe('I30 — igazítás', () => {
  const text = (extra: Partial<TextLayer> = {}) => ({ kind: 'text', id: 't', text: 'HELLO', fontSize: 10, position: { x: 0.5, y: 0.5 }, ...extra }) as TextLayer;
  const photo = (id: string, x: number, extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id, uri: 'u', position: { x, y: 0.5 }, w: 0.1, h: 0.1, fit: 'cover', ...extra }) as PhotoLayer;

  it('a balra igazított szöveg BAL széle ül a vászon szélén', () => {
    const l = alignLayerToCanvas(text(), 'left', 1) as TextLayer;
    expect(layerRect(l, 1)!.x).toBeCloseTo(0);
    expect(l.position.x).toBeGreaterThan(0.1);
  });
  it('a 90°-kal forgatott réteg befoglalója felcserélt', () => {
    const r = layerRect(photo('p', 0.5, { w: 0.4, h: 0.1, rotation: 90 }), 1)!;
    expect(r.width).toBeCloseTo(0.1);
    expect(r.height).toBeCloseTo(0.4);
  });
  it('az elosztás a rejtett réteget nem mozgatja', () => {
    const hidden = photo('h', 0.11, { hidden: true });
    const d = { id: 'd', aspectRatio: '1:1', width: 100, height: 100, layers: [photo('a', 0.1), hidden, photo('b', 0.2), photo('c', 0.9)] as ImageLayer[] } as unknown as ImageDoc;
    expect(positionedLayerCount(d)).toBe(3);
    const next = distributeLayersInDoc(d, 'horizontal');
    expect(next.layers.find((l) => l.id === 'h')).toBe(hidden);
    expect((next.layers.find((l) => l.id === 'b') as PhotoLayer).position.x).toBeCloseTo(0.5);
  });
});

describe('I31 — kompozíciós segédvonalak', () => {
  it('a kézi guide megmarad, ismételt nyomás nem duplikál', () => {
    const manual = [{ id: 'm', axis: 'x' as const, pos: 0.123 }];
    const once = mergeGuides(manual, compositionGuides());
    expect(once).toHaveLength(7);
    expect(once[0]).toBe(manual[0]);
    expect(mergeGuides(once, compositionGuides())).toHaveLength(7);
  });
});

describe('logikai művelet motorral', () => {
  const doc = { id: 'd', name: 'n', layers: [
    { kind: 'shape', id: 'a', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#111111', stroke: { color: '#ff0000', width: 0.01 } },
    { kind: 'shape', id: 'b', shape: 'ellipse', position: { x: 0.6, y: 0.5 }, w: 0.5, h: 0.5, fill: '#222222' },
  ] } as unknown as ImageDoc;
  it('a motor eredménye kerül a rétegre, az alsó forma stílusával', () => {
    const subpaths = [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]];
    const out = booleanCombineInDoc(doc, 'b', 'union', () => ({ subpaths, fillRule: 'evenodd' }))!;
    const layer = out.doc.layers[0] as ShapeLayer;
    expect(out.doc.layers).toHaveLength(1);
    expect(layer.subpaths).toEqual(subpaths);
    expect(layer.fillRule).toBe('evenodd');
    expect(layer.fill).toBe('#111111');
    expect(layer.stroke).toEqual({ color: '#ff0000', width: 0.01 });
  });
  it('a motor üres eredménye nem nyúl a dokumentumhoz', () => {
    expect(booleanCombineInDoc(doc, 'b', 'intersect', () => null)).toBeNull();
  });
});

describe('összetett útvonal szerkesztése', () => {
  const a = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  const b = [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.4 }];
  const layer: { points?: PathPoint[]; subpaths?: PathPoint[][] } = { subpaths: [a, b] };
  it('a kért gyűrű lesz a szerkesztett pontsor', () => {
    expect(pathEditView(layer, 1).points).toBe(b);
    expect(pathEditView(layer, 9).points).toBe(b);
  });
  it('a mentés csak azt a gyűrűt írja', () => {
    const next = [{ x: 0.3, y: 0.3 }, ...b.slice(1)];
    expect(pathEditPatch(layer, 1, next)).toEqual({ subpaths: [a, next] });
  });
  it('egyszerű formán a lencse átlátszó', () => {
    const simple = { points: a };
    expect(pathEditView(simple, 0)).toBe(simple);
    expect(pathEditPatch(simple, 0, b)).toEqual({ points: b });
  });
});
