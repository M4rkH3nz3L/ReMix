import {
  compareSliderX,
  faceBlurRect,
  fitCanvasBox,
  gestureTransformTarget,
  IDENTITY,
  maskShadeGeometry,
  normalizedCanvasPoint,
  pathShapeClip,
  snapAngle,
} from './canvasMath';
import type { ClipMask } from '@/types/project';

describe('snapAngle (forgatás-snap 15°-ra, ±5°)', () => {
  it('a tűrésen belül a legközelebbi 15°-ra pattint', () => {
    expect(snapAngle(13)).toEqual({ value: 15, snapped: true });
    expect(snapAngle(-28)).toEqual({ value: -30, snapped: true });
    expect(snapAngle(95)).toEqual({ value: 90, snapped: true });
  });
  it('pontosan ±5° még pattint, azon túl egész fokra kerekít', () => {
    expect(snapAngle(10)).toEqual({ value: 15, snapped: true });
    expect(snapAngle(20)).toEqual({ value: 15, snapped: true });
    expect(snapAngle(22.4)).toEqual({ value: 22, snapped: false });
    expect(snapAngle(7.6)).toEqual({ value: 8, snapped: false });
  });
  it('a `snapped` csak >0,5° korrekciónál igaz (haptika-trigger)', () => {
    expect(snapAngle(15)).toEqual({ value: 15, snapped: false });
    expect(snapAngle(15.5)).toEqual({ value: 15, snapped: false });
    expect(snapAngle(15.6)).toEqual({ value: 15, snapped: true });
    expect(snapAngle(0)).toEqual({ value: 0, snapped: false });
  });
});

describe('fitCanvasBox (vászon a konténerbe)', () => {
  it('széles konténerben a magasság a korlát', () => {
    expect(fitCanvasBox({ w: 400, h: 300 }, 9 / 16)).toEqual({ w: 300 * (9 / 16), h: 300 });
  });
  it('keskeny konténerben a szélesség a korlát', () => {
    expect(fitCanvasBox({ w: 320, h: 1000 }, 16 / 9)).toEqual({ w: 320, h: 180 });
  });
  it('ar = 0 (nincs projekt) → nulla magasság, a szélesség marad', () => {
    expect(fitCanvasBox({ w: 320, h: 500 }, 0)).toEqual({ w: 320, h: 0 });
  });
  it('mérés előtt (0×0) üres doboz', () => {
    expect(fitCanvasBox({ w: 0, h: 0 }, 1)).toEqual({ w: 0, h: 0 });
  });
});

describe('normalizedCanvasPoint', () => {
  it('px → 0–1, a vászonra szorítva', () => {
    expect(normalizedCanvasPoint(50, 25, 100, 100)).toEqual({ x: 0.5, y: 0.25 });
    expect(normalizedCanvasPoint(-10, 250, 100, 200)).toEqual({ x: 0, y: 1 });
  });
  it('nulla méretű dobozon 1-gyel oszt (nincs NaN/Infinity)', () => {
    expect(normalizedCanvasPoint(0.5, 2, 0, 0)).toEqual({ x: 0.5, y: 1 });
  });
});

describe('compareSliderX', () => {
  it('slider nélkül 0, egyébként kerekített px', () => {
    expect(compareSliderX(null, 300)).toBe(0);
    expect(compareSliderX(0.5, 301)).toBe(151);
    expect(compareSliderX(0, 300)).toBe(0);
    expect(compareSliderX(1, 300)).toBe(300);
  });
});

describe('gestureTransformTarget (gesztus → transzform)', () => {
  const noDelta = { scale: 1, dx: 0, dy: 0, rotation: 0 };
  it('nulla gesztusnál a jelenlegi transzform marad (forgatás 0)', () => {
    expect(gestureTransformTarget(IDENTITY, noDelta, 200, 100, 0.2, 5)).toEqual({
      scale: 1,
      x: 0,
      y: 0,
      rot: { value: 0, snapped: false },
    });
  });
  it('a húzás px-ét a doboz méretére normalizálja és ±0,75-re szorítja', () => {
    const r = gestureTransformTarget({ scale: 1, x: 0.1, y: 0 }, { ...noDelta, dx: 50, dy: -500 }, 200, 100, 0.2, 5);
    expect(r.x).toBeCloseTo(0.35);
    expect(r.y).toBe(-0.75);
  });
  it('a skálát szorozza és a min/max közé szorítja', () => {
    expect(gestureTransformTarget({ scale: 2, x: 0, y: 0 }, { ...noDelta, scale: 1.5 }, 1, 1, 0.2, 5).scale).toBe(3);
    expect(gestureTransformTarget({ scale: 2, x: 0, y: 0 }, { ...noDelta, scale: 10 }, 1, 1, 0.2, 5).scale).toBe(5);
    expect(gestureTransformTarget({ scale: 0.5, x: 0, y: 0 }, { ...noDelta, scale: 0.1 }, 1, 1, 0.2, 5).scale).toBe(0.2);
  });
  it('a forgatás-delta a jelenlegi szöghöz adódik és snappel', () => {
    expect(gestureTransformTarget({ scale: 1, x: 0, y: 0, rotation: 40 }, { ...noDelta, rotation: 3 }, 1, 1, 0.2, 5).rot).toEqual({
      value: 45,
      snapped: true,
    });
    expect(gestureTransformTarget(IDENTITY, { ...noDelta, rotation: 37.3 }, 1, 1, 0.2, 5).rot).toEqual({
      value: 37,
      snapped: false,
    });
  });
  it('nulla méretű dobozon 1-gyel oszt', () => {
    expect(gestureTransformTarget(IDENTITY, { ...noDelta, dx: 0.5 }, 0, 0, 0.2, 5).x).toBe(0.5);
  });
});

describe('pathShapeClip (rajzolt vonal → forma-klip)', () => {
  const bounds = { x: 0.4, y: 0.6, w: 0.2, h: 0.1 };
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  it('filctoll: teljes átlátszóság, nincs glow/blend', () => {
    expect(pathShapeClip('c1', 2.5, pts, bounds, { color: '#f00', width: 4, style: 'marker', glow: false })).toEqual({
      kind: 'shape',
      id: 'c1',
      start: 2.5,
      duration: 3,
      shape: 'path',
      position: { x: 0.4, y: 0.6 },
      w: 0.2,
      h: 0.1,
      fill: '#f00',
      points: pts,
      strokeWidth: 4,
      opacity: 1,
      glow: undefined,
      blendMode: undefined,
    });
  });
  it('kiemelő: 0,42 átlátszóság + multiply; glow a vonal színével', () => {
    const c = pathShapeClip('c2', 0, pts, bounds, { color: '#0f0', width: 8, style: 'highlighter', glow: true });
    expect(c.opacity).toBe(0.42);
    expect(c.blendMode).toBe('multiply');
    expect(c.glow).toEqual({ color: '#0f0', size: 1.6 });
  });
});

describe('maskShadeGeometry', () => {
  const mask = (over: Partial<ClipMask>): ClipMask => ({ shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.25, ...over });
  it('a középpont+méretből px-doboz; téglalapnál 8-as sarok', () => {
    expect(maskShadeGeometry(mask({}), 200, 400)).toEqual({ mw: 100, mh: 100, left: 50, top: 150, radius: 8 });
  });
  it('ellipszisnél a nagyobbik oldal a sugár', () => {
    expect(maskShadeGeometry(mask({ shape: 'ellipse', w: 0.5, h: 0.1 }), 200, 400).radius).toBe(100);
  });
  it('a vászonról kilógó maszknál negatív bal/felső él (a hívó szorítja)', () => {
    const g = maskShadeGeometry(mask({ x: 0, y: 0 }), 200, 400);
    expect(g.left).toBe(-50);
    expect(g.top).toBe(-50);
  });
});

describe('faceBlurRect', () => {
  it('a normalizált régióból px-doboz (bal-felső sarok)', () => {
    expect(faceBlurRect({ x: 0.5, y: 0.25, w: 0.2, h: 0.1 }, 100, 200)).toEqual({
      left: 40,
      top: 40,
      width: 20,
      height: 20,
    });
  });
});
