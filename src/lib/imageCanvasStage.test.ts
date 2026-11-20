/**
 * 🧪 A Kép Stúdió vásznának (ImageCanvas) expo-mentes magja: a REFACTOR előtti viselkedést
 * rögzíti — illesztés, mozgatás-pattintás (guide → rács | okos segédvonalak), csoport-opacity,
 * varázspálca-cél, toll-pont, sarokfogó- és node-szerkesztő-cél.
 */
import {
  CANVAS_FILL,
  cornerPinTarget,
  layerBox,
  MOVE_RANGE,
  pointOf,
  resolvePathEdit,
  snapLayerMove,
  snapPenPoint,
  stageFit,
  wandHit,
  withGroupOpacity,
  withLive,
} from '@/lib/imageCanvasStage';
import type { ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

const photo = (id: string, extra: Partial<PhotoLayer> = {}): PhotoLayer =>
  ({ id, kind: 'photo', uri: `${id}.png`, position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, ...extra }) as PhotoLayer;
const shape = (id: string, extra: Record<string, unknown> = {}): ShapeLayer =>
  ({ id, kind: 'shape', shape: 'rect', position: { x: 0.2, y: 0.2 }, w: 0.2, h: 0.2, color: '#fff', ...extra }) as unknown as ShapeLayer;
const docOf = (layers: ImageLayer[], extra: Partial<ImageDoc> = {}): ImageDoc =>
  ({ id: 'd', name: 'd', aspectRatio: '1:1', width: 1000, height: 1000, layers, ...extra }) as ImageDoc;

describe('vászon-illesztés', () => {
  it('mérés előtt 0×0', () => {
    expect(stageFit({ w: 0, h: 500 }, 1)).toEqual({ w: 0, h: 0 });
    expect(stageFit({ w: 500, h: 0 }, 1)).toEqual({ w: 0, h: 0 });
  });
  it('széles munkaterületen a magasság a korlát, keskenyen a szélesség (CANVAS_FILL = 0,84)', () => {
    expect(CANVAS_FILL).toBe(0.84);
    expect(stageFit({ w: 1000, h: 500 }, 1)).toEqual({ w: 420, h: 420 });
    expect(stageFit({ w: 500, h: 1000 }, 1)).toEqual({ w: 420, h: 420 });
    const f = stageFit({ w: 1000, h: 1000 }, 2);
    expect(f.w).toBeCloseTo(840);
    expect(f.h).toBeCloseTo(420);
  });
  it('pontosan azonos arány: a szélesség-ág fut', () => {
    expect(stageFit({ w: 400, h: 200 }, 2)).toEqual({ w: 336, h: 168 });
  });
  it('a mozgatási tartomány és a pont-tuple', () => {
    expect(MOVE_RANGE).toEqual([-1.5, 2.5]);
    expect(pointOf({ x: 1, y: 2 })).toEqual([1, 2]);
  });
});

describe('réteg-doboz és élő patch', () => {
  it('pozíció + méret; a méret nélküli réteg 0, a pozíció nélküli a vászon közepe', () => {
    expect(layerBox(photo('a'))).toEqual({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 });
    expect(layerBox({ id: 't', kind: 'text', position: { x: 0.1, y: 0.2 } } as unknown as ImageLayer)).toEqual({ x: 0.1, y: 0.2, w: 0, h: 0 });
    expect(layerBox({ id: 'f', kind: 'fill' } as unknown as ImageLayer)).toEqual({ x: 0.5, y: 0.5, w: 0, h: 0 });
    expect(layerBox(photo('a'), { x: 0.9, y: 0.1 })).toEqual({ x: 0.9, y: 0.1, w: 0.4, h: 0.4 });
  });
  it('a withLive új objektum, a patch felülír', () => {
    const l = photo('a');
    const r = withLive(l, { position: { x: 0, y: 0 } });
    expect(r).not.toBe(l);
    expect((r as PhotoLayer).position).toEqual({ x: 0, y: 0 });
    expect(l.position).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('mozgatás-pattintás', () => {
  it('okos segédvonal: a vászon közepére pattan, a jelző-vonalak visszajönnek', () => {
    const doc = docOf([photo('a')]);
    const r = snapLayerMove(doc, 'a', { x: 0.505, y: 0.3 });
    expect(r.pos.x).toBe(0.5);
    expect(r.lines).not.toBeNull();
    expect(r.lines!.some((l) => l.axis === 'x')).toBe(true);
  });
  it('okos segédvonal pattintás nélkül: üres (nem null) vonal-lista', () => {
    const doc = docOf([photo('a', { w: 0.1, h: 0.1 } as Partial<PhotoLayer>)]);
    const r = snapLayerMove(doc, 'a', { x: 0.333, y: 0.377 });
    expect(r.lines).toEqual([]);
    expect(r.pos).toEqual({ x: 0.333, y: 0.377 });
  });
  it('a bekapcsolt rács erősebb: a bal felső sarok a rácson, nincs jelző-vonal (null)', () => {
    const doc = docOf([photo('a', { w: 0.2, h: 0.2 } as Partial<PhotoLayer>)], { grid: { size: 100, show: true, snap: true } } as Partial<ImageDoc>);
    const r = snapLayerMove(doc, 'a', { x: 0.43, y: 0.58 });
    expect(r.lines).toBeNull();
    expect(r.pos.x).toBeCloseTo(0.4);
    expect(r.pos.y).toBeCloseTo(0.6);
  });
  it('a kikapcsolt rács (snap: false) nem számít: okos segédvonalak futnak', () => {
    const doc = docOf([photo('a')], { grid: { size: 100, show: true, snap: false } } as Partial<ImageDoc>);
    expect(snapLayerMove(doc, 'a', { x: 0.505, y: 0.3 }).lines).not.toBeNull();
  });
  it('kézi segédvonal előbb: a közeli guide-ra ül, utána jön az okos pattintás', () => {
    const doc = docOf([photo('a', { w: 0.01, h: 0.01 } as Partial<PhotoLayer>)], { guides: [{ id: 'g', axis: 'x', pos: 0.3 }] });
    const r = snapLayerMove(doc, 'a', { x: 0.305, y: 0.37 });
    expect(r.pos.x).toBe(0.3);
  });
  it('kitöltő / korrekció-réteg és ismeretlen id: nincs pattintás, nincs jelző-vonal', () => {
    const fill = { id: 'f', kind: 'fill', color: '#000' } as unknown as ImageLayer;
    const doc = docOf([fill, photo('a')]);
    expect(snapLayerMove(doc, 'f', { x: 0.505, y: 0.3 })).toEqual({ pos: { x: 0.505, y: 0.3 }, lines: null });
    expect(snapLayerMove(doc, 'x', { x: 0.505, y: 0.3 })).toEqual({ pos: { x: 0.505, y: 0.3 }, lines: null });
  });
  it('a többi látható réteg élére pattan; a rejtett nem számít', () => {
    const doc = docOf([photo('a', { w: 0.1, h: 0.1 } as Partial<PhotoLayer>), photo('b', { position: { x: 0.2, y: 0.2 }, w: 0.1, h: 0.1 } as Partial<PhotoLayer>)]);
    expect(snapLayerMove(doc, 'a', { x: 0.205, y: 0.77 }).pos.x).toBeCloseTo(0.2, 10);
    const hidden = docOf([photo('a', { w: 0.1, h: 0.1 } as Partial<PhotoLayer>), photo('b', { position: { x: 0.2, y: 0.2 }, w: 0.1, h: 0.1, hidden: true } as Partial<PhotoLayer>)]);
    expect(snapLayerMove(hidden, 'a', { x: 0.205, y: 0.77 }).pos.x).toBe(0.205);
  });
});

describe('csoport-opacity', () => {
  it('csoport nélkül ugyanaz az objektum', () => {
    const l = photo('a', { opacity: 0.5 });
    expect(withGroupOpacity(docOf([l]), l)).toBe(l);
  });
  it('csoportban a csoport áttetszősége rászoroz', () => {
    const l = photo('a', { opacity: 0.5, groupId: 'g' });
    const doc = docOf([l], { groups: [{ id: 'g', name: 'g', opacity: 0.5 }] } as Partial<ImageDoc>);
    const r = withGroupOpacity(doc, l);
    expect(r).not.toBe(l);
    expect(r.opacity).toBeCloseTo(0.25);
  });
  it('teljes csoport-opacity mellett nem másol', () => {
    const l = photo('a', { groupId: 'g' });
    const doc = docOf([l], { groups: [{ id: 'g', name: 'g' }] } as Partial<ImageDoc>);
    expect(withGroupOpacity(doc, l)).toBe(l);
  });
});

describe('varázspálca-cél', () => {
  it('a legfelső látható fotó, a dobozon belüli lokális ponttal', () => {
    const doc = docOf([photo('alul'), photo('felul', { position: { x: 0.5, y: 0.5 }, w: 0.2, h: 0.2 } as Partial<PhotoLayer>)]);
    const r = wandHit(doc, 0.5, 0.5);
    expect(r?.layer.id).toBe('felul');
    expect(r?.u).toBeCloseTo(0.5);
    expect(r?.v).toBeCloseTo(0.5);
    expect(wandHit(doc, 0.35, 0.35)?.layer.id).toBe('alul');
  });
  it('a rejtett fotó és a nem-fotó kimarad; a dobozon kívül null', () => {
    const doc = docOf([photo('alul'), photo('rejtett', { hidden: true }), shape('s', { position: { x: 0.5, y: 0.5 }, w: 1, h: 1 })]);
    expect(wandHit(doc, 0.5, 0.5)?.layer.id).toBe('alul');
    expect(wandHit(doc, 0.05, 0.05)).toBeNull();
  });
  it('a határ (0 és 1) még a dobozon belül van', () => {
    const doc = docOf([photo('a')]);
    expect(wandHit(doc, 0.3, 0.3)?.u).toBeCloseTo(0);
    expect(wandHit(doc, 0.7, 0.7)?.v).toBeCloseTo(1);
  });
});

describe('toll-pont rácsra', () => {
  it('rács nélkül a pont változatlan, a fogó (lebegőpontosan) a helyén, de új objektum', () => {
    const doc = docOf([]);
    const h1 = { x: 0.3, y: 0.4 };
    const r = snapPenPoint({ x: 0.33, y: 0.44, h1 }, doc);
    expect(r.x).toBe(0.33);
    expect(r.y).toBe(0.44);
    expect(r.h1).not.toBe(h1);
    expect(r.h1!.x).toBeCloseTo(0.3, 10);
    expect(r.h1!.y).toBeCloseTo(0.4, 10);
    expect('h2' in r).toBe(false);
    expect(snapPenPoint({ x: 0.33, y: 0.44 }, doc)).toEqual({ x: 0.33, y: 0.44 });
  });
  it('a fogók a ponttal együtt tolódnak', () => {
    const doc = docOf([], { grid: { size: 100, show: true, snap: true } } as Partial<ImageDoc>);
    const r = snapPenPoint({ x: 0.33, y: 0.44, h1: { x: 0.3, y: 0.4 }, h2: { x: 0.36, y: 0.48 } }, doc);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.4);
    expect(r.h1!.x).toBeCloseTo(0.27);
    expect(r.h1!.y).toBeCloseTo(0.36);
    expect(r.h2!.x).toBeCloseTo(0.33);
    expect(r.h2!.y).toBeCloseTo(0.44);
  });
});

describe('sarokfogó- és node-szerkesztő-cél', () => {
  it('a sarokfogó csak fotóra', () => {
    const doc = docOf([photo('p'), shape('s')]);
    expect(cornerPinTarget(doc, 'p')?.id).toBe('p');
    expect(cornerPinTarget(doc, 's')).toBeNull();
    expect(cornerPinTarget(doc, null)).toBeNull();
    expect(cornerPinTarget(doc, 'nincs')).toBeNull();
  });
  it('a node-szerkesztő csak path-formára; élő patch csak a saját id-re hat', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const path = shape('p', { shape: 'path', points: pts });
    const doc = docOf([path, shape('r')]);
    expect(resolvePathEdit(doc, 'r', 0, null)).toEqual({ rawPathShape: null, pathEditShape: null, pathEditLive: null });
    expect(resolvePathEdit(doc, undefined, 0, null).rawPathShape).toBeNull();
    const plain = resolvePathEdit(doc, 'p', 0, null);
    expect(plain.rawPathShape).toBe(path);
    expect(plain.pathEditShape).toBe(path);
    expect(plain.pathEditLive).toBe(path);
    const other = resolvePathEdit(doc, 'p', 0, { id: 'r', patch: { points: [] } as never });
    expect(other.pathEditLive).toBe(path);
    const livePts = [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    const own = resolvePathEdit(doc, 'p', 0, { id: 'p', patch: { points: livePts } as never });
    expect(own.pathEditShape).toBe(path);
    expect(own.pathEditLive?.points).toEqual(livePts);
  });
  it('összetett útvonalnál a kért gyűrű nézete', () => {
    const ring0 = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const ring1 = [{ x: 0, y: 1 }, { x: 1, y: 1 }];
    const path = shape('p', { shape: 'path', points: ring0, subpaths: [ring1] });
    const r = resolvePathEdit(docOf([path]), 'p', 1, null);
    expect(r.rawPathShape).toBe(path);
    expect(r.pathEditShape?.points).toEqual(ring1);
  });
});
