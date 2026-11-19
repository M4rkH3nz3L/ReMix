/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { AlphaType, ColorType, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { Dimensions, Modal, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { BrushOverlay, type BrushHandle, renderStrokes } from '@/components/studio/image/BrushOverlay';
import { Asset } from 'expo-asset';
import { layerSkPath, offsetToResult, skiaBooleanEngine, strokeToResult, withResult } from '@/components/studio/image/skiaVector';
import { booleanCombineInDoc } from '@/lib/imageBoolean';
import { anchorFromDrag, type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
import { moveAnchor, pathEditPatch, pathEditView, setNodeType } from '@/lib/vectorPath';
import { projectMaskToCanvas } from '@/components/studio/image/projectMask';
import { foregroundMask } from '@/lib/foregroundMask';
import { AssistantBar } from '@/components/studio/image/body/AssistantBar';
import { applyImageCommands, parseImageIntent } from '@/lib/imageIntent';
import { ExportCancelled , renderImageDoc } from '@/lib/imageDocClient';
import { photoBytesPerPixel } from '@/components/studio/image/exportEstimate';
import { readExportFacts } from '@/components/studio/image/exportVerify';
import { expectsAlpha, exportProblems, layerOnlyDoc, selectionOnlyDoc } from '@/lib/imageExportCheck';
import { customExportSize, formatBytes } from '@/lib/imageExport';
import { ingestImageFile } from '@/lib/media';
import '@/lib/dspNativeClient';
import { layerHistogram } from '@/components/studio/image/HistogramView';
import { HslSheet } from '@/components/studio/image/HslSheet';
import { computeHistogram, histogramShift } from '@/lib/histogram';
import { SelectionAnts } from '@/components/studio/image/SelectionAnts';
import { updateLayer } from '@/lib/imageDoc';
import { adjustSelection, copySelectionToLayer, deleteSelection, maskFromSelection } from '@/lib/imageSelectionOps';
import { applyRing, ellipseRing, invertSelection, rectRing, selectionToMask } from '@/lib/selection';
import { DEFAULT_BRUSH, type RetouchTool, type Stroke } from '@/lib/brushEngine';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';
import { type Log, decode, meanDiff, pixel, removeFile, sleep } from './shared';

/** A kijelölés a valódi vásznon a szerver ellen, ellenpróbával; a műveletek a valódi függvényeken át mennek. */
export async function smokeSelection(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      paint.setColor(Skia.Color(`rgb(${40 + x * 60},${220 - y * 50},${60 + (x + y) * 25})`));
      c.drawRect(Skia.XYWHRect(x * 80, y * 80, 80, 80), paint);
    }
  }
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_sel_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const pt = (x: number, y: number) => ({ x, y });
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as ImageLayer;
  const base = (layers: ImageLayer[]) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers }) as unknown as ImageDoc;
  const u = applyRing(null, [pt(0.1, 0.1), pt(0.9, 0.1), pt(0.9, 0.9), pt(0.6, 0.9), pt(0.6, 0.3), pt(0.4, 0.3), pt(0.4, 0.9), pt(0.1, 0.9)], 'new')!;
  const ring = applyRing(applyRing(null, ellipseRing(pt(0.1, 0.1), pt(0.9, 0.9)), 'new'), rectRing(pt(0.35, 0.35), pt(0.65, 0.65)), 'subtract')!;
  const cut = applyRing(null, rectRing(pt(0.2, 0.2), pt(0.5, 0.5)), 'new')!;
  const start = base([bg, photo()]);
  const moved = updateLayer<PhotoLayer>(deleteSelection(start, 'p', cut)!, 'p', { position: { x: 0.65, y: 0.6 } });
  const cases: [string, ImageDoc][] = [
    ['homorú lasszó maszkként', maskFromSelection(start, 'p', u)!],
    ['lyukas ellipszis maszkként', maskFromSelection(start, 'p', ring)!],
    ['invertált kijelölés', maskFromSelection(start, 'p', invertSelection(u))!],
    ['lágy szél', maskFromSelection(start, 'p', { ...u, feather: 0.03 })!],
    ['törlés', deleteSelection(start, 'p', cut)!],
    ['mozgatott réteg maszkja', moved],
    ['másolat új rétegre', { ...copySelectionToLayer(base([bg, photo({ opacity: 0.25 })]), 'p', u, 'c')!, id: 'full' }],
    ['korrekció a kijelölésen', ((d) => ({ ...d, layers: d.layers.map((l) => (l.kind === 'adjust' ? { ...l, adjust: { saturation: -1, contrast: 0.4 } } : l)) }) as ImageDoc)(adjustSelection(start, u, 'adj'))],
  ];
  const ctlDoc = (d: ImageDoc) => base([bg, photo({ position: (d.layers[1] as PhotoLayer).position })]);
  for (const [name, doc] of cases) {
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [uri, plainUri] = [await renderImageDoc(doc, 320), await renderImageDoc(ctlDoc(doc), 320)];
    if (!uri || !plainUri) {
      log(false, `kijelölés = export: ${name}`, 'nincs render');
      continue;
    }
    const server = await decode(uri);
    const d = meanDiff(a, server, 320, 320);
    const ctl = meanDiff(a, await decode(plainUri), 320, 320);
    if (d > 8) {
      const rows: string[] = [];
      for (let y = 0; y < 320; y += 40) {
        const row: number[] = [];
        for (let x = 0; x < 320; x += 40) {
          let sum = 0;
          for (let i = 4; i < 40; i += 8) for (let j = 4; j < 40; j += 8) sum += Math.abs(pixel(a, x + i, y + j)[1] - pixel(server, x + i, y + j)[1]);
          row.push(Math.round(sum / 25));
        }
        rows.push(row.join(','));
      }
      log(true, 'TÉRKÉP', rows.join(' / '));
    }
    log(d <= 8 && ctl >= d * 1.5, `kijelölés = export: ${name}`, `átlag ${d.toFixed(1)}/255; a kijelölés nélkül ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(uri);
    removeFile(plainUri);
  }

  // az ecset nem fest ki a kijelölésből
  const brush: Stroke = { points: [pt(0.1, 0.25), pt(0.9, 0.25)].map((p) => ({ ...p, p: 1 })), color: '#ff0000', width: 0.1, hardness: 1, opacity: 1, eraser: false };
  const clipped = renderStrokes([brush], 400, 400, null, cut)!;
  const free = renderStrokes([brush], 400, 400)!;
  log(pixel(clipped, 140, 100)[3] === 255 && pixel(clipped, 300, 100)[3] === 0 && pixel(free, 300, 100)[3] === 255, 'az ecset a kijelölésen belül marad', `benne α=${pixel(clipped, 140, 100)[3]}, kívül α=${pixel(clipped, 300, 100)[3]}, kijelölés nélkül α=${pixel(free, 300, 100)[3]}`);
  const inv = renderStrokes([brush], 400, 400, null, invertSelection(cut))!;
  log(pixel(inv, 140, 100)[3] === 0 && pixel(inv, 300, 100)[3] === 255, 'invertált kijelölésnél fordítva', `benne α=${pixel(inv, 140, 100)[3]}, kívül α=${pixel(inv, 300, 100)[3]}`);

  // a körvonal a kijelzőn: rendszer-képernyőképhez
  setHarness(
    <View style={{ width: 300, height: 300, backgroundColor: '#3060a0' }}>
      <SelectionAnts selection={ring} box={{ w: 300, h: 300 }} />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a kijelölés körvonala a kijelzőn');
  await sleep(6000);
  setHarness(null);
  removeFile(png.uri);
}
/** A színenkénti HSL és a fényerő a vásznon a szerver ellen; a hisztogram a kész export eloszlása ellen. */
export async function smokeColor(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  const colors = ['#e02020', '#e08020', '#e0d020', '#30c040', '#20c0c0', '#2040e0', '#8040e0', '#e020a0', '#808080'];
  colors.forEach((col, i) => {
    paint.setColor(Skia.Color(col));
    c.drawRect(Skia.XYWHRect((i % 3) * 107, Math.floor(i / 3) * 107, 107, 107), paint);
  });
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_col_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const photo = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as PhotoLayer;
  const docOf = (l: PhotoLayer) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [l] }) as unknown as ImageDoc;
  const source = await decode(png.uri);
  const cases: [string, Partial<PhotoLayer>][] = [
    ['piros kifakítva', { hsl: { red: { s: -1 } } }],
    ['kék árnyalat', { hsl: { blue: { h: 1 } } }],
    ['zöld világosítva', { hsl: { green: { l: 1 } } }],
    ['több sáv', { hsl: { orange: { h: -0.7, s: 0.5 }, aqua: { l: -0.8 }, magenta: { s: -0.6, h: 0.4 } } }],
    ['HSL + korrekció', { adjust: { contrast: 0.3 }, hsl: { yellow: { s: -1 } } }],
    ['fényerő', { adjust: { brightness: 0.2 } }],
  ];
  for (const [name, extra] of cases) {
    const layer = photo(extra);
    const doc = docOf(layer);
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [uri, plainUri] = [await renderImageDoc(doc, 320), await renderImageDoc(docOf(photo({})), 320)];
    if (!uri || !plainUri) {
      log(false, `szín = export: ${name}`, 'nincs render');
      continue;
    }
    const server = await decode(uri);
    const d = meanDiff(a, server, 320, 320);
    const ctl = meanDiff(a, await decode(plainUri), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `szín = export: ${name}`, `átlag ${d.toFixed(1)}/255; a beállítás nélkül ${ctl.toFixed(1)}`);
    // a hisztogram az eszközön számolt: a kész exporttal kell egyeznie, az eredetitől eltérnie
    const hist = layerHistogram(source, layer)!;
    const px = server.readPixels(0, 0, { width: 320, height: 320, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
    const real = computeHistogram(px);
    const before = layerHistogram(source, photo({}))!;
    const dist = Math.max(histogramShift(hist.r, real.r), histogramShift(hist.g, real.g), histogramShift(hist.b, real.b));
    const change = Math.max(histogramShift(before.r, real.r), histogramShift(before.g, real.g), histogramShift(before.b, real.b));
    log(dist <= 3 && change >= dist * 2, `hisztogram = export: ${name}`, `eltérés ${dist.toFixed(1)} szint; az eredetitől ${change.toFixed(1)} szint`);
    removeFile(shot);
    removeFile(uri);
    removeFile(plainUri);
  }
  setHarness(
    <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center', height: 320 }}>
      <HslSheet doc={docOf(photo({ hsl: { red: { s: -0.5 } } }))} layer={photo({ hsl: { red: { s: -0.5 } } })} commit={() => {}} onClose={() => {}} />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a HSL-lap a kijelzőn');
  await sleep(6000);
  setHarness(null);
  removeFile(png.uri);
}
/** A festett maszk: a valódi overlay festi, a valódi vászon mutatja, a szerver ellen mérve. */
export async function smokePaintMask(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      paint.setColor(Skia.Color(`rgb(${40 + x * 60},${220 - y * 50},${60 + (x + y) * 25})`));
      c.drawRect(Skia.XYWHRect(x * 80, y * 80, 80, 80), paint);
    }
  }
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_pm_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as PhotoLayer;
  const docOf = (l: PhotoLayer) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, l] }) as unknown as ImageDoc;
  const line = (color: string, y: number, extra: Partial<Stroke> = {}): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color, width: 0.14, hardness: 1, opacity: 1, eraser: false, ...extra });

  const ref = createRef<BrushHandle>();
  setHarness(
    <View style={{ width: 300, height: 300, backgroundColor: '#406080' }}>
      <BrushOverlay ref={ref} box={{ w: 300, h: 300 }} settings={DEFAULT_BRUSH} maskMode />
    </View>
  );
  await sleep(500);
  ref.current!.addStroke(line('#000000', 0.3));
  ref.current!.addStroke(line('#000000', 0.7, { hardness: 0.2, opacity: 0.6 }));
  await sleep(400);
  log(true, 'FOTÓZHATÓ', 'a maszk-festés nézete a kijelzőn');
  await sleep(5000);
  const uri = ref.current!.exportPng(320, 320)!;
  const m = await decode(uri);
  log(pixel(m, 160, 96)[0] < 10 && pixel(m, 160, 10)[0] > 245, 'a maszk: rejtett fekete, a többi fehér', `rejtett ${pixel(m, 160, 96)}, látható ${pixel(m, 160, 10)}`);
  setHarness(null);
  await sleep(80);

  // a meglévő kijelölésből induló festés a formát hozza
  const seedRing = applyRing(null, rectRing({ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }), 'new')!;
  const seeded = renderStrokes([], 320, 320, null, null, selectionToMask(seedRing))!;
  log(pixel(seeded, 160, 160)[0] > 245 && pixel(seeded, 20, 20)[0] < 10, 'a meglévő maszk formája átjön a festésbe', `belül ${pixel(seeded, 160, 160)}, kívül ${pixel(seeded, 20, 20)}`);

  const mask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: uri } as PhotoLayer['mask'];
  const moved = updateLayer<PhotoLayer>(docOf(photo({ mask })), 'p', { position: { x: 0.62, y: 0.55 } });
  const cases: [string, ImageDoc][] = [
    ['festett maszk', docOf(photo({ mask }))],
    ['lágy szélű maszk', docOf(photo({ mask: { ...mask!, feather: 0.015 } }))],
    ['mozgatott réteg maszkja', moved],
    ['elforgatott réteg', docOf(photo({ mask, rotation: 25, w: 0.7, h: 0.7 }))],
  ];
  for (const [name, doc] of cases) {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const plainDoc = { ...doc, layers: doc.layers.map((l) => (l.kind === 'photo' ? { ...l, mask: undefined } : l)) } as ImageDoc;
    const [out, plain] = [await renderImageDoc(doc, 320), await renderImageDoc(plainDoc, 320)];
    if (!out || !plain) {
      log(false, `festett maszk = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(out), 320, 320);
    const ctl = meanDiff(a, await decode(plain), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `festett maszk = export: ${name}`, `átlag ${d.toFixed(1)}/255; maszk nélkül ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(out);
    removeFile(plain);
  }
  removeFile(uri);
  removeFile(png.uri);
}
/** A retus-eszközök a valódi Skia-rajzon: a vonás alatt változik, mellette a réteg átlátszó marad. */
export async function smokeRetouch(log: Log) {
  const size = 400;
  const surface = Skia.Surface.MakeOffscreen(size, size)!;
  const c = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#606060'));
  c.drawRect(Skia.XYWHRect(0, 0, size, size), paint);
  paint.setColor(Skia.Color('#d04020'));
  c.drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  paint.setColor(Skia.Color('#ffffff'));
  for (let i = 0; i < 20; i++) {
    c.drawRect(Skia.XYWHRect(0, i * 20, 200, 4), paint); // mintázat a klónhoz
  }
  surface.flush();
  const source = surface.makeImageSnapshot().makeNonTextureImage()!;
  const line = (tool: RetouchTool, y: number, offset?: { x: number; y: number }, extra: Partial<Stroke> = {}): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color: '#000000', width: 0.1, hardness: 1, opacity: 1, eraser: false, tool, offset, ...extra });
  const render = (s: Stroke) => renderStrokes([s], size, size, null, null, null, source)!;

  // klón: a jobb alsó szürke helyre a bal felső mintás piros kerül
  const clone = render(line('clone', 0.75, { x: -0.5, y: -0.5 }));
  const [dst, src] = [pixel(clone, 300, 303), pixel(source, 100, 103)];
  log(Math.abs(dst[0] - src[0]) <= 2 && Math.abs(dst[1] - src[1]) <= 2 && dst[3] === 255, 'klón: a forrás pixele kerül a célra', `cél ${dst}, forrás ${src}`);
  log(pixel(clone, 300, 100)[3] === 0, 'klón: a vonáson kívül átlátszó', `α=${pixel(clone, 300, 100)[3]}`);

  // folt: a minta jön át, de a cél szürke tónusa marad (a klón pirosat adna)
  const heal = render(line('heal', 0.75, { x: -0.5, y: -0.5 }, { width: 0.1 }));
  // egy pixel a minta miatt eltérhet: a terület átlagos színe a döntő
  const mean = (img: SkImage) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = 285; y < 315; y++) {
      for (let x = 240; x < 340; x += 3) {
        const p = pixel(img, x, y);
        [0, 1, 2].forEach((k) => (sum[k] += p[k]));
        n += 1;
      }
    }
    return sum.map((v) => Math.round(v / n));
  };
  const [hm, cm] = [mean(heal), mean(clone)];
  const healSpread = Math.max(...hm) - Math.min(...hm);
  const cloneSpread = Math.max(...cm) - Math.min(...cm);
  let [hi0, lo0] = [0, 255];
  for (let y = 285; y < 315; y++) {
    const v = pixel(heal, 300, y)[1];
    hi0 = Math.max(hi0, v);
    lo0 = Math.min(lo0, v);
  }
  log(healSpread <= 40 && Math.abs(hm[1] - 96) <= 45 && cloneSpread > 60 && hi0 - lo0 > 40, 'folt: a cél tónusa marad, a minta átjön', `folt átlag ${hm}, klón átlag ${cm}, minta terjedelme ${hi0 - lo0}`);

  const base = pixel(source, 300, 300);
  const dodge = pixel(render(line('dodge', 0.75)), 300, 300);
  const burn = pixel(render(line('burn', 0.75)), 300, 300);
  log(Math.abs(dodge[0] - base[0] * 1.35) <= 3 && Math.abs(burn[0] - base[0] * 0.65) <= 3, 'világosít és sötétít', `alap ${base[0]}, világos ${dodge[0]}, sötét ${burn[0]}`);
  const half = pixel(render(line('dodge', 0.75, undefined, { opacity: 0.5 })), 300, 300);
  log(Math.abs(half[3] - 128) <= 3, 'az erősség az átlátszóságon át hat', `α=${half[3]}`);

  // elmosás: a piros-szürke él elmosódik; élesítés: túllövés az élen
  const edge = (y: number, tool: RetouchTool) => pixel(render({ ...line(tool, 0.5), points: [{ x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }], width: 0.2 }), 200 + y, 310);
  const blurred = edge(-3, 'blur');
  log(blurred[0] > 100 && blurred[0] < 130 + 60, 'elmosás: az él átmenetet kap', `él mellett ${blurred}`);
  const sharpSurface = render({ ...line('sharpen', 0.25), points: [{ x: 0.1, y: 0.25, p: 1 }, { x: 0.45, y: 0.25, p: 1 }], width: 0.2 });
  let [hi, orig] = [0, 0];
  for (let y = 60; y < 140; y++) {
    hi = Math.max(hi, pixel(sharpSurface, 100, y)[1]);
    orig = Math.max(orig, pixel(source, 100, y)[1]);
  }
  let lo = 255;
  for (let y = 60; y < 140; y++) lo = Math.min(lo, pixel(sharpSurface, 100, y)[1]);
  const origLo = pixel(source, 100, 110)[1];
  log(lo < origLo - 10, 'élesítés: a sötét oldal mélyül az élen', `legsötétebb ${lo}, eredeti ${origLo}`);

  // forrás nélkül nincs rajz
  const empty = renderStrokes([line('clone', 0.75, { x: 0, y: 0 })], size, size)!;
  log(pixel(empty, 300, 300)[3] === 0, 'forrás nélkül nem fest feketét', `${pixel(empty, 300, 300)}`);
}
/** A háttér-eltávolítás a valódi Vision-úton; a kép a csomagolt logó, a téma közepe ismert. */
export async function smokeBgRemove(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const asset = await Asset.fromModule(require('../../../assets/images/icon.png')).downloadAsync();
  const uri = asset.localUri!;
  const output = new File(projectMediaDir(), `fg_smoke_${Date.now().toString(36)}.png`).uri;
  const res = await foregroundMask(uri, output);
  log(res.status === 'ok', 'Vision maszk', res.status);
  if (res.status !== 'ok') {
    return;
  }
  const [photo, mask] = [await decode(uri), await decode(res.uri)];
  log(mask.width() > 0 && Math.abs(mask.width() / mask.height() - photo.width() / photo.height()) < 0.02, 'a maszk a kép arányában', `${mask.width()}×${mask.height()}, kép ${photo.width()}×${photo.height()}`);
  const [w, h] = [mask.width(), mask.height()];
  const row = Array.from({ length: 11 }, (_, i) => Array.from({ length: 11 }, (__, j) => (pixel(mask, Math.min(w - 1, Math.floor((j / 10) * w)), Math.min(h - 1, Math.floor((i / 10) * h)))[0] > 128 ? '#' : '.')).join(''));
  log(row.join('').includes('#') && row.join('').includes('.'), 'a maszkban van téma és háttér', row.join(' / '));

  const canvas = { width: 320, height: 320 };
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const place = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover', ...extra }) as PhotoLayer;
  const layouts: [string, Partial<PhotoLayer>][] = [
    ['teljes vásznon', {}],
    ['elforgatva', { rotation: 30, w: 0.7, h: 0.7 }],
    ['tükrözve, eltolva', { flipH: true, position: { x: 0.6, y: 0.45 }, w: 0.7, h: 0.7 }],
    ['contain, eltérő arány', { fit: 'contain', w: 0.9, h: 0.5 }],
  ];
  for (const [name, extra] of layouts) {
    const layer = place(extra);
    const projected = projectMaskToCanvas(mask, layer, { width: photo.width(), height: photo.height() }, canvas, false)!;
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, { ...layer, mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: projected } }] } as unknown as ImageDoc;
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1600);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [out, plain] = [await renderImageDoc(doc, 320), await renderImageDoc({ ...doc, layers: [bg, layer] } as unknown as ImageDoc, 320)];
    if (!out || !plain) {
      log(false, `kivágás = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(out), 320, 320);
    const ctl = meanDiff(a, await decode(plain), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `kivágás = export: ${name}`, `átlag ${d.toFixed(1)}/255; kivágás nélkül ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(out);
    removeFile(plain);
    removeFile(projected);
  }
  removeFile(res.uri);
}
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
/** Fájl-import, exportméret, becslés és megszakítás a valódi úton. */
export async function smokeImportExport(log: Log) {
  const pngFile = (w: number, h: number, name: string) => {
    const surface = Skia.Surface.MakeOffscreen(w, h)!;
    const c = surface.getCanvas();
    const paint = Skia.Paint();
    for (let i = 0; i < 40; i++) {
      paint.setColor(Skia.Color(`rgb(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255})`));
      c.drawRect(Skia.XYWHRect(0, (i * h) / 40, w, h / 40 + 1), paint);
    }
    surface.flush();
    const file = new File(projectMediaDir(), `${name}_${Date.now().toString(36)}.png`);
    file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
    return file.uri;
  };
  const ok = await ingestImageFile(pngFile(400, 200, 'imp'));
  log(ok.status === 'ok' && ok.width === 400, 'érvényes képfájl beolvasva', JSON.stringify({ s: ok.status }));
  const bad = new File(projectMediaDir(), `rossz_${Date.now().toString(36)}.png`);
  bad.write('ez nem kép');
  const invalid = await ingestImageFile(bad.uri);
  log(invalid.status === 'invalid', 'a sérült fájl nem megy tovább', invalid.status);
  removeFile(bad.uri);
  const big = await ingestImageFile(pngFile(4000, 1000, 'big'));
  log(big.status === 'ok' && big.width === 3072 && big.originalWidth === 4000, 'a túl nagy kép kicsinyül, és tudjuk az eredetit', big.status === 'ok' ? `${big.originalWidth} → ${big.width}` : big.status);

  const photoUri = pngFile(1024, 1024, 'exp');
  const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 1024, height: 1024, layers: [{ kind: 'photo', id: 'p', uri: photoUri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' }] } as unknown as ImageDoc;
  const size = customExportSize(doc, 700);
  const out = await renderImageDoc(doc, size.height);
  if (out) {
    const img = await decode(out);
    log(img.height() === size.height && img.width() === size.width, 'az egyedi méret pontos', `${img.width()}×${img.height()}, kért ${size.width}×${size.height}`);
    removeFile(out);
  } else {
    log(false, 'az egyedi méret pontos', 'nincs render');
  }

  // a becslés a valódi fájlmérethez: csíkos grafika és a csomagolt, részletgazdag logó
  const art = (await Asset.fromModule(require('../../../assets/images/icon.png')).downloadAsync()).localUri!;
  for (const [label, uri] of [['csíkos', photoUri], ['logó', art]] as const) {
    const estDoc = { ...doc, id: `est${label === 'logó' ? 1 : 0}`, layers: [{ ...(doc.layers[0] as PhotoLayer), uri }] } as ImageDoc;
    for (const [format, quality] of [['png', 1], ['jpg', 0.9]] as const) {
      const out2 = await renderImageDoc(estDoc, 1024, { format, quality });
      const bpp = await photoBytesPerPixel([uri], format, quality);
      if (out2 && bpp != null) {
        const real = new File(out2).size ?? 0;
        const guess = bpp * 1024 * 1024;
        const ratio = real ? guess / real : 0;
        log(ratio >= 0.25 && ratio <= 4, `becslés ${label} ${format}`, `becsült ${formatBytes(guess)}, valódi ${formatBytes(real)}, arány ${ratio.toFixed(2)}`);
        removeFile(out2);
      } else {
        log(false, `becslés ${label} ${format}`, 'nincs mérés');
      }
    }
  }

  // a minőségkapu a valódi fájlokon: a jót átengedi, a rosszat megfogja
  const bgDoc = { ...doc, id: 'gate', layers: [{ kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer, { ...(doc.layers[0] as PhotoLayer), w: 0.5, h: 0.5 }] } as ImageDoc;
  const partOf = layerOnlyDoc(bgDoc, 'p')!;
  const part = await renderImageDoc(partOf, 512);
  if (part) {
    const facts = await readExportFacts(part);
    const expected = { ...customExportSize(partOf, 512), format: 'png' as const, wantsAlpha: expectsAlpha(partOf, 'png') };
    log(exportProblems(facts, expected).length === 0 && facts.hasAlpha, 'réteg-export: átlátszó háttéren, kapu átengedi', `${facts.width}×${facts.height}, alfa ${facts.hasAlpha}`);
    const img = await decode(part);
    log(pixel(img, 10, 10)[3] === 0 && pixel(img, 256, 256)[3] === 255, 'a réteg a helyén, körülötte átlátszó', `sarok α=${pixel(img, 10, 10)[3]}, közép α=${pixel(img, 256, 256)[3]}`);
    const wrong = exportProblems(facts, { ...expected, width: 1024, height: 1024 });
    log(wrong.includes('size'), 'a kapu megfogja a rossz méretet', wrong.join(','));
    removeFile(part);
  } else {
    log(false, 'réteg-export', 'nincs render');
  }
  const sel = applyRing(null, rectRing({ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.5 }), 'new')!;
  const selPart = await renderImageDoc(selectionOnlyDoc(bgDoc, sel, 'p')!, 512);
  if (selPart) {
    const img = await decode(selPart);
    log(pixel(img, 200, 200)[3] === 255 && pixel(img, 300, 300)[3] === 0, 'kijelölés-export: csak a terület marad', `benne α=${pixel(img, 200, 200)[3]}, kívül α=${pixel(img, 300, 300)[3]}`);
    removeFile(selPart);
  } else {
    log(false, 'kijelölés-export', 'nincs render');
  }
  const flat = await renderImageDoc(bgDoc, 256, { format: 'jpg' });
  if (flat) {
    const facts = await readExportFacts(flat);
    const missing = exportProblems(facts, { width: 256, height: 256, format: 'png', wantsAlpha: true });
    log(!facts.hasAlpha && missing.includes('alpha'), 'a kapu megfogja az elveszett átlátszóságot', missing.join(','));
    removeFile(flat);
  }
  const broken = new File(projectMediaDir(), `tort_${Date.now().toString(36)}.png`);
  broken.write('nem kép');
  const bf = await readExportFacts(broken.uri);
  log(exportProblems(bf, { width: 1, height: 1, format: 'png', wantsAlpha: false })[0] === 'unreadable', 'a kapu megfogja a nem nyitható fájlt', `opened=${bf.opened}`);
  removeFile(broken.uri);

  // megszakítás: a kérés indul, azonnal leállítjuk, a következő export zavartalan
  const ctrl = new AbortController();
  const cancelled = renderImageDoc({ ...doc, id: 'cancel' } as ImageDoc, 4000, { signal: ctrl.signal }).then(
    () => 'lefutott',
    (e: unknown) => (e instanceof ExportCancelled ? 'megszakítva' : String(e))
  );
  await sleep(40);
  ctrl.abort();
  const verdict = await cancelled;
  log(verdict === 'megszakítva', 'a megszakítás leállít, nem hiba', verdict);
  const after = await renderImageDoc({ ...doc, id: 'after' } as ImageDoc, 512);
  log(!!after, 'megszakítás után újra exportál', after ? 'kész' : 'nincs render');
  removeFile(photoUri);
}
/** Az asszisztens végig: mondat → parancsok → dokumentum → vászon és export. */
export async function smokeAssistant(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#4080c0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 320, 320), paint);
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_as_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const start = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [
    { kind: 'fill', id: 'bg', fill: '#ffffff' },
    { kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fit: 'stretch' },
    { kind: 'shape', id: 'c', shape: 'ellipse', position: { x: 0.3, y: 0.3 }, w: 0.2, h: 0.2, fill: '#ff0000' },
  ] } as unknown as ImageDoc;
  let n = 0;
  const say = (doc: ImageDoc, text: string) => {
    const { commands, unknown } = parseImageIntent(text, doc, null);
    return { unknown, doc: applyImageCommands(doc, commands, () => `new${++n}`).doc };
  };
  const steps = [
    'a kör legyen kék, tedd a kört felülre és a kör legyen nagyobb',
    'adj hozzá egy zöld csillagot',
    'a fotó legyen sötétebb, forgasd a fotót 20 fokkal',
    'legyen fekete a háttér',
  ];
  let doc = start;
  for (const text of steps) {
    const before = doc;
    const res = say(doc, text);
    doc = res.doc;
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
    const [e, c] = [await renderImageDoc(doc, 320), await renderImageDoc(before, 320)];
    if (e && c) {
      const d = meanDiff(a, await decode(e), 320, 320);
      const ctl = meanDiff(a, await decode(c), 320, 320);
      log(res.unknown.length === 0 && d <= 6 && ctl >= d * 1.5, `asszisztens: ${text}`, `átlag ${d.toFixed(1)}/255; a lépés előtti állapottól ${ctl.toFixed(1)}`);
      removeFile(e);
      removeFile(c);
    } else {
      log(false, `asszisztens: ${text}`, 'nincs render');
    }
    removeFile(shot);
  }
  setHarness(
    <Modal transparent visible>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#20242e' }}>
        <AssistantBar doc={doc} selectedId={null} onApply={() => {}} onClose={() => {}} />
      </View>
    </Modal>
  );
  await sleep(2500);
  log(true, 'FOTÓZHATÓ', 'az asszisztens sávja a kijelzőn');
  await sleep(5000);
  setHarness(null);
  removeFile(png.uri);
}
