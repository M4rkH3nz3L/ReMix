/** 🧪 Füstteszt — vektor: toll, logikai műveletek, útvonal-műveletek, körvonal-igazítás, rács. (Áthelyezve: phases02, phases11; viselkedés-változás nélkül.) */
import { type ReactNode, type RefObject, createRef } from 'react';
import { View, Platform, Dimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { skiaBooleanEngine, layerSkPath, strokeToResult, offsetToResult, withResult } from '@/components/studio/image/skiaVector';
import { booleanCombineInDoc } from '@/lib/imageBoolean';
import { anchorFromDrag, type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
import { setNodeType, pathEditView, pathEditPatch, moveAnchor } from '@/lib/vectorPath';
import { renderImageDoc } from '@/lib/imageDocClient';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import type { ImageLayer, ImageDoc, ShapeLayer } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { decode, meanDiff, removeFile, pixel } from '../../helpers/image';
import type { SkImage } from '@shopify/react-native-skia';
import { type RenderStageHandle, RenderStage } from '@/components/studio/image/RenderStage';
import '@/lib/dspNativeClient';

/** Húzásos tollal rajzolt görbék a vásznon a szerver ellen; az egyenes változat az ellenpróba. */
export async function smokeVector(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const docOf = (...layers: ImageLayer[]) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, ...layers] }) as unknown as ImageDoc;
  const box = { w: 320, h: 320 };
  const blob = [
    anchorFromDrag({ x: 0.5, y: 0.15 }, { x: 0.75, y: 0.15 }, box),
    anchorFromDrag({ x: 0.85, y: 0.5 }, { x: 0.85, y: 0.75 }, box),
    anchorFromDrag({ x: 0.5, y: 0.85 }, { x: 0.25, y: 0.85 }, box),
    anchorFromDrag({ x: 0.15, y: 0.5 }, { x: 0.15, y: 0.25 }, box),
  ];
  const wave = [
    anchorFromDrag({ x: 0.1, y: 0.5 }, { x: 0.25, y: 0.1 }, box),
    anchorFromDrag({ x: 0.5, y: 0.5 }, { x: 0.65, y: 0.9 }, box),
    { x: 0.9, y: 0.5 },
  ];
  const straight = (pts: CanvasPoint[]) => pts.map(({ x, y }) => ({ x, y }));
  const shape = (pts: CanvasPoint[], closed: boolean, extra: Partial<ShapeLayer> = {}) => ({ ...pathShapeFromCanvasPoints(pts, closed, 's', '#ff2d95')!, ...extra }) as ImageLayer;
  const edited = shape(blob, true) as ShapeLayer;
  const cases: [string, ImageDoc, ImageDoc][] = [
    ['zárt görbe forma', docOf(shape(blob, true)), docOf(shape(straight(blob), true))],
    ['nyitott görbe vonal', docOf(shape(wave, false, { strokeWidth: 2 })), docOf(shape(straight(wave), false, { strokeWidth: 2 }))],
    ['sarokká tett csomópont', docOf({ ...edited, points: setNodeType(edited.points!, 1, 'corner', true) } as ImageLayer), docOf(edited)],
    ['megnyitott útvonal', docOf({ ...edited, closed: false, strokeWidth: 1.5 } as ImageLayer), docOf(edited)],
  ];
  for (const [name, doc, other] of cases) {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1300);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [out, ctl] = [await renderImageDoc(doc, 320), await renderImageDoc(other, 320)];
    if (!out || !ctl) {
      log(false, `görbe = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(out), 320, 320);
    const c = meanDiff(a, await decode(ctl), 320, 320);
    log(d <= 5 && c >= d * 1.5, `görbe = export: ${name}`, `átlag ${d.toFixed(1)}/255; ellenpróba ${c.toFixed(1)}`);
    removeFile(shot);
    removeFile(out);
    removeFile(ctl);
  }
}
/** A logikai műveletek eredménye a két forrásformához mérve, függetlenül; és a vászon a szerver ellen. */
export async function smokeBoolean(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const canvas = { width: 320, height: 240 };
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const star = { kind: 'shape', id: 'a', shape: 'star', starPoints: 5, innerRatio: 0.4, position: { x: 0.45, y: 0.5 }, w: 0.6, h: 0.8, rotation: 20, fill: '#ff2d95' } as unknown as ShapeLayer;
  const ball = { kind: 'shape', id: 'b', shape: 'ellipse', position: { x: 0.6, y: 0.5 }, w: 0.4, h: 0.5, fill: '#2060e0' } as unknown as ShapeLayer;
  const ringDoc = { id: 'full', name: 'p', aspectRatio: '4:3', width: 320, height: 240, layers: [bg, star, ball] } as unknown as ImageDoc;
  const engine = skiaBooleanEngine(canvas);
  const [pa, pb] = [layerSkPath(star, canvas), layerSkPath(ball, canvas)];
  const rule: Record<string, (x: boolean, y: boolean) => boolean> = { union: (x, y) => x || y, subtract: (x, y) => x && !y, intersect: (x, y) => x && y, exclude: (x, y) => x !== y };
  for (const op of ['union', 'subtract', 'intersect', 'exclude'] as const) {
    const out = booleanCombineInDoc(ringDoc, 'b', op, engine);
    if (!out) {
      log(false, `logika: ${op}`, 'nincs eredmény');
      continue;
    }
    const layer = out.doc.layers.find((l) => l.id === out.resultId) as ShapeLayer;
    const res = layerSkPath(layer, canvas);
    let wrong = 0;
    let total = 0;
    for (let y = 4; y < 240; y += 8) {
      for (let x = 4; x < 320; x += 8) {
        total += 1;
        if (res.contains(x, y) !== rule[op](pa.contains(x, y), pb.contains(x, y))) wrong += 1;
      }
    }
    // ellenpróba: a régi, sokszöges mag ugyanezen a bemeneten
    const old = booleanCombineInDoc(ringDoc, 'b', op);
    let oldWrong = -1;
    if (old) {
      const oldPath = layerSkPath(old.doc.layers.find((l) => l.id === old.resultId) as ShapeLayer, canvas);
      oldWrong = 0;
      for (let y = 4; y < 240; y += 8) {
        for (let x = 4; x < 320; x += 8) {
          if (oldPath.contains(x, y) !== rule[op](pa.contains(x, y), pb.contains(x, y))) oldWrong += 1;
        }
      }
    }
    log(null, `régi mag: ${op}`, `${oldWrong}/${total} pont hibás`);
    const curves = layer.subpaths!.flat().filter((p) => p.h1 || p.h2).length;
    const nodes = layer.subpaths!.flat().length;
    log(wrong <= 3 && (op === 'exclude' || curves > 0), `logika: ${op}`, `${wrong}/${total} pont hibás, ${nodes} csomópont, ebből ${curves} görbe`);
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 260 }}>
        <ImageCanvas doc={out.doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1200);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 240 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [exp, ctl] = [await renderImageDoc(out.doc, 240), await renderImageDoc(ringDoc, 240)];
    if (exp && ctl) {
      const d = meanDiff(a, await decode(exp), 320, 240);
      const c = meanDiff(a, await decode(ctl), 320, 240);
      log(d <= 5 && c >= d * 1.5, `logika = export: ${op}`, `átlag ${d.toFixed(1)}/255; a művelet nélkül ${c.toFixed(1)}`);
      removeFile(exp);
      removeFile(ctl);
    } else {
      log(false, `logika = export: ${op}`, 'nincs render');
    }
    removeFile(shot);
  }
}
/** Összetett forma szerkesztése, vonalból forma és eltolt útvonal: a vásznon a szerver ellen, a geometria függetlenül. */
export async function smokePathOps(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const canvas = { width: 320, height: 320 };
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const docOf = (...layers: ImageLayer[]) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, ...layers] }) as unknown as ImageDoc;
  const square = { kind: 'shape', id: 'a', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.7, h: 0.7, fill: '#ff2d95' } as unknown as ShapeLayer;
  const hole = { kind: 'shape', id: 'b', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.3, h: 0.3, fill: '#2060e0' } as unknown as ShapeLayer;
  const res = booleanCombineInDoc(docOf(square, hole), 'b', 'subtract', skiaBooleanEngine(canvas))!;
  const compound = res.doc.layers.find((l) => l.id === res.resultId) as ShapeLayer;
  log(compound.subpaths!.length === 2, 'a lyukas forma két gyűrű', `${compound.subpaths!.length} gyűrű`);

  // a lyuk gyűrűjének egy pontját húzzuk el: a lyuk változik, a külső forma nem
  const ring = compound.subpaths!.findIndex((r) => r.some((p) => p.h1 || p.h2));
  const view = pathEditView(compound, ring);
  const edited = { ...compound, ...pathEditPatch(compound, ring, moveAnchor(view.points!, 0, view.points![0].x + 0.1, view.points![0].y)) } as ShapeLayer;
  const [p0, p1] = [layerSkPath(compound, canvas), layerSkPath(edited, canvas)];
  log(p1.contains(70, 70) && !p0.contains(160, 160), 'a gyűrű szerkesztése a külső formához nem nyúl', `gyűrű ${ring}`);

  const box = { w: 320, h: 320 };
  const wave = { ...pathShapeFromCanvasPoints([anchorFromDrag({ x: 0.1, y: 0.5 }, { x: 0.25, y: 0.1 }, box), anchorFromDrag({ x: 0.5, y: 0.5 }, { x: 0.65, y: 0.9 }, box), { x: 0.9, y: 0.5 }], false, 's', '#ff2d95')!, strokeWidth: 3 } as ShapeLayer;
  const outline = strokeToResult(wave, canvas);
  const star = { kind: 'shape', id: 's', shape: 'star', starPoints: 5, innerRatio: 0.5, position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fill: '#2060e0' } as unknown as ShapeLayer;
  const [grown, shrunk] = [offsetToResult(star, canvas, 8), offsetToResult(star, canvas, -8)];
  if (!outline || !grown || !shrunk) {
    log(false, 'útvonal-műveletek', 'nincs eredmény');
    return;
  }
  const outlined = { ...wave, ...withResult(wave, outline) } as ShapeLayer;
  const [g, sh] = [{ ...star, ...withResult(star, grown) } as ShapeLayer, { ...star, ...withResult(star, shrunk) } as ShapeLayer];
  const [pStar, pG, pS] = [layerSkPath(star, canvas), layerSkPath(g, canvas), layerSkPath(sh, canvas)];
  let [wrong, total, aS, aStar, aG] = [0, 0, 0, 0, 0];
  for (let y = 4; y < 320; y += 6) {
    for (let x = 4; x < 320; x += 6) {
      const [i, j, k] = [pS.contains(x, y), pStar.contains(x, y), pG.contains(x, y)];
      total += 1;
      if ((j && !k) || (i && !j)) wrong += 1;
      aS += i ? 1 : 0;
      aStar += j ? 1 : 0;
      aG += k ? 1 : 0;
    }
  }
  log(wrong === 0 && aG > aStar && aS < aStar, 'eltolás: a bővített tartalmazza, a szűkített benne van', `területek ${aS} < ${aStar} < ${aG}, hibás ${wrong}/${total}`);

  const cases: [string, ImageDoc, ImageDoc][] = [
    ['szerkesztett lyuk', docOf(edited), docOf(compound)],
    ['vonalból forma = az eredeti vonal', docOf(outlined), docOf(wave)],
    ['bővített csillag', docOf(g), docOf(star)],
    ['szűkített csillag', docOf(sh), docOf(star)],
  ];
  for (const [name, doc, other] of cases) {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1200);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [e, c] = [await renderImageDoc(doc, 320), await renderImageDoc(other, 320)];
    if (!e || !c) {
      log(false, `útvonal = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(e), 320, 320);
    const ctl = meanDiff(a, await decode(c), 320, 320);
    const same = name.startsWith('vonalból');
    log(same ? d <= 5 && ctl <= 5 : d <= 5 && ctl >= d * 1.5, `útvonal = export: ${name}`, `átlag ${d.toFixed(1)}/255; ${same ? 'az eredeti vonal exportjától' : 'ellenpróba'} ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(e);
    removeFile(c);
  }
}
/** A rács a szerkesztőben látszik, a képbe és az exportba nem kerül. */
export async function smokeGrid(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff2d95' } as ImageLayer;
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const plain = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, shape] } as unknown as ImageDoc;
  const doc = { ...plain, grid: { size: 32, show: true, snap: true } } as ImageDoc;
  const shot = async (d: ImageDoc, capturing: boolean) => {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing={capturing} />
      </View>
    );
    await sleep(900);
    const uri = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const img = await decode(uri);
    removeFile(uri);
    return img;
  };
  const [edit, none, capture] = [await shot(doc, false), await shot(plain, false), await shot(doc, true)];
  setHarness(null);
  const edge = meanDiff(edit, none, 320, 320);
  let lines = 0;
  // a hajszálvonal a kicsinyítésben részben eltűnik: a jelenlét számít, rács nélkül ez pontosan 0
  for (let i = 0; i < 320; i++) if (Math.abs(pixel(edit, i, 20)[1] - pixel(none, i, 20)[1]) > 2) lines += 1;
  log(lines > 0, 'a rács látszik a szerkesztőben', `${lines} eltérő pont a sorban, átlag ${edge.toFixed(1)}`);
  log(meanDiff(capture, none, 320, 320) < 1, 'a mentett képbe nem kerül', `átlag ${meanDiff(capture, none, 320, 320).toFixed(1)}/255`);
  const [a, b] = [await renderImageDoc(doc, 320), await renderImageDoc(plain, 320)];
  if (a && b) {
    const d = meanDiff(await decode(a), await decode(b), 320, 320);
    log(d === 0, 'az exportba nem kerül', `átlag ${d.toFixed(1)}/255`);
    removeFile(a);
    removeFile(b);
  } else {
    log(false, 'az exportba nem kerül', 'nincs render');
  }
  setHarness(
    <View style={{ width: 300, height: 300 }}>
      <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a rács a kijelzőn');
  await sleep(6000);
  setHarness(null);
}
/** 🖊️ S18: a forma körvonala (belső / közép / külső) — telefon = szerver, és a körvonal tényleg ott van */
export async function smokeStrokeAlign(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 100; i++) for (let j = 0; j < 100; j++) {
      const u = pixel(p, Math.floor(((j + 0.5) / 100) * p.width()), Math.floor(((i + 0.5) / 100) * p.height()));
      const w = pixel(q, Math.floor(((j + 0.5) / 100) * q.width()), Math.floor(((i + 0.5) / 100) * q.height()));
      sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
      n += 1;
    }
    return sum / n;
  };
  // a körvonal (piros) mennyisége a doboz belsejében és azon kívül
  const redIn = (img: SkImage, box: { x0: number; y0: number; x1: number; y1: number }) => {
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < img.height(); y += 2) for (let x = 0; x < img.width(); x += 2) {
      const p = pixel(img, x, y);
      if (!(p[0] > 180 && p[1] < 80 && p[2] < 80)) continue;
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) inside += 1;
      else outside += 1;
    }
    return { inside, outside };
  };
  const doc = (shape: Record<string, unknown>) => ({ id: 'sa', name: 'sa', aspectRatio: '1:1', width: 400, height: 400, layers: [{ id: 'bg', kind: 'fill', fill: '#203040' }, { id: 's', kind: 'shape', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ffffff', borderColor: '#ff2020', borderWidth: 3, ...shape }] }) as unknown as ImageDoc;
  const box = { x0: 100, y0: 100, x1: 300, y1: 300 };
  const CASES: [string, Record<string, unknown>][] = [
    ['téglalap (alap)', { shape: 'rectangle' }],
    ['ellipszis (alap)', { shape: 'ellipse' }],
    ['csillag (alap)', { shape: 'star' }],
    ['görbe (alap)', { shape: 'path', closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 0.6, y: 1 }] }],
    ['téglalap kívül', { shape: 'rectangle', borderAlign: 'outside' }],
    ['téglalap középen', { shape: 'rectangle', borderAlign: 'center' }],
    ['ellipszis kívül', { shape: 'ellipse', borderAlign: 'outside' }],
    ['csillag belül', { shape: 'star', borderAlign: 'inside' }],
    ['lekerekített téglalap belül', { shape: 'rectangle', cornerRadius: 0.25, borderAlign: 'inside' }],
    ['görbe kívül', { shape: 'path', closed: true, borderAlign: 'outside', points: [{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 0.6, y: 1 }] }],
  ];
  for (const [name, shape] of CASES) {
    const d = doc(shape);
    const dev = await ref.current!.render(d, 400);
    const srv = await renderImageDoc(d, 400);
    if (!dev || !srv) {
      log(false, name, 'nincs kép');
      continue;
    }
    const a = await decode(dev);
    const b = await decode(srv);
    const diff = meanDiff(a, b);
    const [ra, rb] = [redIn(a, box), redIn(b, box)];
    const align = String(shape.borderAlign ?? '');
    // kívül: a doboz körül is van piros; belül: csak a dobozon belül
    const placeOk = align === 'outside' ? ra.outside > 50 && rb.outside > 50 : align === 'inside' ? ra.outside < 10 && rb.outside < 10 : true;
    const seen = ra.inside + ra.outside > 50;
    log(diff <= 6 && placeOk && seen, `${name} — telefon = szerver, a körvonal a helyén`, `${diff.toFixed(2)}/255 · piros telefon ${ra.inside}+${ra.outside} · szerver ${rb.inside}+${rb.outside} (dobozon belül+kívül)`);
    [dev, srv].forEach((u) => removeFile(u));
  }
  setHarness(null);
}
