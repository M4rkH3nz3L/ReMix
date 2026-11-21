/** 🧪 Füstteszt — kép-render mélyén: offline render és a szerver elleni mély mérések. (Áthelyezve: phases01; viselkedés-változás nélkül.) */
import { Skia, ImageFormat, type SkImage, drawAsImage, Group } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { type ReactNode, type RefObject, createRef } from 'react';
import { Platform, Dimensions, PixelRatio, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { type RenderStageHandle, RenderStage, keepRenderedInProject } from '@/components/studio/image/RenderStage';
import { makeLutImage, PhotoSkiaContent } from '@/components/studio/image/SkiaPhotoLayer';
import { rasterSubDoc, replaceWithRaster } from '@/lib/imageCanvasOps';
import { renderImageDoc } from '@/lib/imageDocClient';
import { LUT_DRAFT_SIZE, LUT_SIZE } from '@/lib/imagePreviewLut';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { PhotoLayer, ImageLayer, ShapeLayer, ImageDoc } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { decode, gridDiff, removeFile, pixel, meanDiff, spread } from '../../helpers/image';
import '@/lib/dspNativeClient';

/**
 * 🖨️ CORE K1 (IMAGE-PROD C1): offline kép-render — a rejtett render-színpad BÁRMELY lapot a
 * telefonon raszterizál, a kért pixelméreten, alfával; a worker-renderrel paritásban.
 */
export async function smokeOfflineImg(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}, pixelarány ${PixelRatio.get()}`);
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#3070d0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 320, 320), paint);
  paint.setColor(Skia.Color('#f0c040'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 160, 160), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_offimg_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));

  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(
    <View style={{ width: 1, height: 1 }}>
      <RenderStage ref={ref} />
    </View>
  );
  await sleep(300);
  const stage = ref.current;
  if (!stage) {
    log(false, 'render-színpad', 'nem csatolódott fel');
    return;
  }

  const photo = { kind: 'photo', id: 'p', uri: file.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' } as PhotoLayer;
  const text = { kind: 'text', id: 't', text: 'ÁRVÍZ', position: { x: 0.5, y: 0.75 }, fontSize: 18, color: '#ffffff', fontFamily: 'Poppins' } as unknown as ImageLayer;
  const rect = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.75, y: 0.3 }, w: 0.3, h: 0.3, fill: '#ff2d95' } as ShapeLayer;
  const mk = (id: string, layers: ImageLayer[]) => ({ id, name: id, aspectRatio: '1:1', width: 320, height: 320, layers }) as unknown as ImageDoc;
  const pages: [string, ImageDoc][] = [
    ['1. lap: fotó + szöveg + forma', mk('lap1', [photo as ImageLayer, rect as ImageLayer, text])],
    ['2. lap: korrekció + szorzás-keverés', mk('lap2', [photo as ImageLayer, { ...photo, id: 'top', w: 0.6, h: 0.6, blendMode: 'multiply', adjust: { saturation: -1, contrast: 0.3 } } as ImageLayer])],
    ['3. lap: átlátszó háttér, alakzat', mk('lap3', [{ ...rect, position: { x: 0.5, y: 0.5 } } as ImageLayer])],
  ];

  const shots: SkImage[] = [];
  for (const [name, doc] of pages) {
    const t0 = Date.now();
    const uri = await stage.render(doc, 320);
    const ms = Date.now() - t0;
    if (!uri) {
      log(false, `telefonos render: ${name}`, 'nincs kép');
      continue;
    }
    const img = await decode(uri);
    shots.push(img);
    log(img.width() === 320 && img.height() === 320, `telefonos render: ${name}`, `${img.width()}×${img.height()}, ${ms} ms, worker nélkül`);
    const workerUri = await renderImageDoc(doc, 320);
    if (workerUri) {
      const d = gridDiff(img, await decode(workerUri), 320, 280);
      log(d.bad / d.total <= 0.06, `telefon = worker: ${name}`, `${d.bad}/${d.total} rácspont tér el`);
      removeFile(workerUri);
    } else {
      log(null, `telefon = worker: ${name}`, 'a worker nem érhető el, az összevetés kimarad');
    }
    removeFile(uri);
  }
  if (shots.length >= 2) {
    const ctrl = gridDiff(shots[0], shots[1], 320, 280);
    log(ctrl.bad > 0, 'ellenpróba: a lapok képe különbözik', `${ctrl.bad} rácspont tér el az 1. és a 2. lap között`);
  }
  if (shots.length >= 3) {
    const corner = pixel(shots[2], 10, 10);
    const middle = pixel(shots[2], 160, 160);
    log(corner[3] === 0 && middle[3] === 255, 'átlátszó háttér megmarad', `sarok α=${corner[3]}, közép α=${middle[3]} ${middle.slice(0, 3).join(',')}`);
  }

  // nagy felbontás: a natív kép a kért pixelméret, nem képernyő-felbontás
  for (const height of [2048, 4096]) {
    const t0 = Date.now();
    const uri = await stage.render(pages[0][1], height);
    const ms = Date.now() - t0;
    if (!uri) {
      log(false, `doc-felbontás ${height} px`, 'nincs kép');
      continue;
    }
    const img = await decode(uri);
    const ok = img.width() === height && img.height() === height;
    const p = pixel(img, Math.round(height * 0.1), Math.round(height * 0.1));
    log(ok, `doc-felbontás ${height} px`, `${img.width()}×${img.height()}, ${ms} ms, bal felső ${p.slice(0, 3).join(',')} (sárga várt)`);
    removeFile(uri);
  }

  // WebP: átkódolva, az alfa megmarad
  const webp = await stage.render(pages[2][1], 320, { format: 'webp' });
  if (webp) {
    const img = await decode(webp);
    const corner = pixel(img, 10, 10);
    log(webp.endsWith('.webp') && corner[3] === 0, 'WebP alfával', `${webp.split('.').pop()} · sarok α=${corner[3]}`);
    removeFile(webp);
  } else {
    log(false, 'WebP alfával', 'nincs kép');
  }

  // egyesítés a telefonon (Free is, vízjel nélkül): a két felső réteg egy fotó-réteggé, a kép = az eredeti
  const page1 = pages[0][1];
  const sub = rasterSubDoc(page1, ['s', 't']);
  const merged = await stage.render(sub, 320, { format: 'png' });
  if (merged) {
    const kept = keepRenderedInProject(merged, `smoke_merge_${Date.now().toString(36)}`);
    const inProject = kept.startsWith(projectMediaDir().uri) && new File(kept).exists;
    const after = replaceWithRaster(page1, ['s', 't'], kept, 'm', 'merged');
    const before = await stage.render(page1, 320);
    const now = await stage.render(after, 320);
    if (before && now) {
      const d = gridDiff(await decode(before), await decode(now), 320, 280);
      log(inProject && after.layers.length === 2 && d.bad / d.total <= 0.06, 'egyesítés a telefonon', `${after.layers.length} réteg maradt, a projekt-mappában: ${inProject}, előtte = utána ${d.bad}/${d.total} rácspont`);
      removeFile(before);
      removeFile(now);
    } else {
      log(false, 'egyesítés a telefonon', 'nincs összevető kép');
    }
    removeFile(kept);
  } else {
    log(false, 'egyesítés a telefonon', 'nincs kép');
  }

  setHarness(null);
  removeFile(file.uri);
}
/** 🔬 A második kör mérései: sebesség, effektek, és a TELJES valódi vászon. */
export async function smokeDeep(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const heavy = { kind: 'photo', id: 'h', uri: 'x', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, adjust: { contrast: 0.2, saturation: 0.3, vibrance: 0.4, hue: 0.1, highlights: 0.3, temperature: 0.1 }, grade: 'teal-orange', levels: { black: 0.05, white: 0.95, gamma: 1.2 } } as unknown as PhotoLayer;
  const time = (size: number) => {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      makeLutImage(heavy, [], size);
    }
    return (Date.now() - t0) / 10;
  };
  const draft = time(LUT_DRAFT_SIZE);
  log(draft < 34, 'csúszka-költség húzás közben', `${draft.toFixed(1)} ms (cél: 33 ms alatt)`);
  log(null, 'pontos LUT megálláskor', `${time(LUT_SIZE).toFixed(1)} ms`);

  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#3070d0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 320, 320), paint);
  paint.setColor(Skia.Color('#f0c040'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 160, 160), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_deep_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const source = await decode(file.uri);
  const canvas = { width: 320, height: 320 };
  const small = { kind: 'photo', id: 'p', uri: file.uri, position: { x: 0.5, y: 0.45 }, w: 0.5, h: 0.5, fit: 'stretch' } as PhotoLayer;

  const effects: [string, Partial<PhotoLayer>][] = [
    ['vetett árnyék', { dropShadow: { color: '#ff0000', dx: 0.08, dy: 0.08, blur: 0.004, opacity: 1 } }],
    ['ragyogás', { outerGlow: { color: '#00ff00', size: 0.02, opacity: 1 } }],
    ['gradiens-maszk jobbra', { maskGradient: 'right' }],
  ];
  for (const [name, patch] of effects) {
    const layer = { ...small, ...patch } as PhotoLayer;
    const lw = 160;
    const preview = await drawAsImage(
      <Group transform={[{ translate: [80, 64] }]}>
        <PhotoSkiaContent image={source} lut={null} layer={layer} w={lw} h={lw} scale={1} canvas={canvas} />
      </Group>,
      { width: 320, height: 320 }
    );
    const uri = await renderImageDoc({ id: 'fx', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [layer] } as unknown as ImageDoc, 320);
    if (!preview || !uri) {
      log(false, `effekt = export: ${name}`, 'nincs kép');
      continue;
    }
    const d = gridDiff(preview, await decode(uri), 320, 280);
    log(d.bad / d.total <= 0.06, `effekt = export: ${name}`, `${d.bad}/${d.total} rácspont tér el`);
    removeFile(uri);
  }

  // a TELJES vászon: a valódi ImageCanvas nézet-fája, keverési móddal, a szerver ellen
  const base = { ...small, id: 'bg', position: { x: 0.5, y: 0.5 }, w: 1, h: 1 } as PhotoLayer;
  const top = { ...small, id: 'top', blendMode: 'multiply', adjust: { saturation: -1 } } as PhotoLayer;
  const docs: [string, ImageLayer[]][] = [
    ['fotó', [base as ImageLayer]],
    ['fotó + korrekció + szorzás-keverés', [base as ImageLayer, top as ImageLayer]],
    ['korrekciós réteg a fotó fölött', [base as ImageLayer, { kind: 'adjust', id: 'adj', adjust: { contrast: 0.3, saturation: 0.5 } } as ImageLayer]],
  ];
  for (const [name, layers] of docs) {
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers } as unknown as ImageDoc;
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const uri = await renderImageDoc(doc, 320);
    if (!uri) {
      log(false, `vászon = export: ${name}`, 'nincs render');
      continue;
    }
    const a = await decode(shot);
    const d = gridDiff(a, await decode(uri), Math.min(a.width(), 320), Math.min(a.height(), 280));
    const b2 = await decode(uri);
    log(d.bad / d.total <= 0.06, `vászon = export: ${name}`, `${a.width()}×${a.height()}, ${d.bad}/${d.total} rácspont tér el; sárga ${pixel(a, 80, 80)} / ${pixel(b2, 80, 80)}; kék ${pixel(a, 240, 240)} / ${pixel(b2, 240, 240)}`);
    if (name.includes('szorzás')) {
      // ellenpróba: a keverés nélküli kép ugyanitt el KELL térjen, különben a mérés vak
      const plainUri = await renderImageDoc({ ...doc, layers: [base, { ...top, blendMode: undefined }] } as unknown as ImageDoc, 320);
      if (plainUri) {
        const ctrl = gridDiff(a, await decode(plainUri), Math.min(a.width(), 320), 280);
        log(ctrl.bad > 0, 'ellenpróba: a mérés érzékeli a keverést', `${ctrl.bad} rácspont tér el a keverés nélküli képtől`);
        removeFile(plainUri);
      }
    }
    setHarness(null);
    removeFile(uri);
    removeFile(shot);
  }
  removeFile(file.uri);
}
/** 🔬 Szöveg/forma effektek, doc-szintű hatások, .cube, lokális korrekció: valódi vászon a szerver ellen. */
export async function smokeDeep2(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#3070d0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 320, 320), paint);
  paint.setColor(Skia.Color('#f0c040'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 160, 160), paint);
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_d2_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const rows = ['LUT_3D_SIZE 3'];
  for (let b = 0; b < 3; b++) for (let g = 0; g < 3; g++) for (let r = 0; r < 3; r++) rows.push(`${(r / 2) * 0.8 + 0.1} ${(g / 2) ** 2} ${1 - (b / 2) * 0.7}`);
  const cube = new File(projectMediaDir(), `smoke_d2_${Date.now().toString(36)}.cube`);
  cube.write(rows.join('\n'));
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.45 }, w: 1, h: 0.9, fit: 'stretch', ...extra }) as ImageLayer;
  const rect = (extra: Partial<ShapeLayer>) => ({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.45 }, w: 0.4, h: 0.4, fill: '#ff2d95', ...extra }) as ImageLayer;
  const cases: [string, ImageLayer[], Partial<ImageDoc>][] = [
    ['forma árnyéka', [bg, rect({ dropShadow: { color: '#0000ff', dx: 0.08, dy: 0.08, blur: 0.004, opacity: 1 } })], {}],
    ['forma ragyogása', [bg, rect({ outerGlow: { color: '#00aa00', size: 0.03, opacity: 1 } })], {}],
    ['forma körvonala', [bg, rect({ stroke: { color: '#ff0000', width: 0.03 } })], {}],
    ['forgatott forma árnyéka', [bg, rect({ rotation: 30, dropShadow: { color: '#0000ff', dx: 0.08, dy: 0.02, blur: 0.004, opacity: 1 } })], {}],
    ['forma + doc-grade', [bg, rect({})], { grade: 'noir' } as Partial<ImageDoc>],
    ['forma + korrekciós réteg', [bg, rect({}), { kind: 'adjust', id: 'adj', adjust: { saturation: -0.9 } } as ImageLayer], {}],
    ['fotó + vignetta', [photo({})], { vignette: 0.8 } as Partial<ImageDoc>],
    ['.cube LUT', [photo({ lut: cube.uri, lutName: 'x' })], {}],
    ['lokális korrekció', [photo({ localAdjust: { adjust: { contrast: 0.3, saturation: 0.5 }, mask: { shape: 'rectangle', x: 0.5, y: 0.45, w: 0.4, h: 0.4, feather: 0.005 } } })], {}],
    ['fotó körvonala', [bg, photo({ w: 0.6, h: 0.6, stroke: { color: '#ff0000', width: 0.03 } })], {}],
  ];
  for (const [name, layers, extra] of cases) {
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers, ...extra } as unknown as ImageDoc;
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1600);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const uri = await renderImageDoc(doc, 320);
    if (!uri) {
      log(false, `vászon = export: ${name}`, 'nincs render');
      continue;
    }
    const a = await decode(shot);
    const d = gridDiff(a, await decode(uri), 320, 280);
    // ellenpróba: az effekt NÉLKÜLI exporttól el kell térnie, különben a mérés vak
    const plain = {
      ...doc,
      grade: undefined,
      vignette: 0,
      layers: doc.layers.filter((l) => l.kind !== 'adjust').map((l) => ({ ...l, dropShadow: undefined, outerGlow: undefined, stroke: undefined, lut: undefined, localAdjust: undefined })),
    } as unknown as ImageDoc;
    const plainUri = await renderImageDoc(plain, 320);
    const c = plainUri ? gridDiff(a, await decode(plainUri), 320, 280) : { bad: 0, total: 0 };
    log(d.bad / d.total <= 0.06 && c.bad > d.bad, `vászon = export: ${name}`, `${d.bad}/${d.total} tér el; effekt nélküli exporttól ${c.bad}`);
    if (plainUri) {
      removeFile(plainUri);
    }
    setHarness(null);
    await sleep(80);
    removeFile(uri);
    removeFile(shot);
  }
  removeFile(png.uri);
  removeFile(cube.uri);
}
/** Az effekt tiszta hatása a cellahatárokon: a vászon és az export VÁLTOZÁSÁNAK különbsége, az újramintázás zaja nélkül. */
function edgeEffect(a: SkImage, a0: SkImage, b: SkImage, b0: SkImage): { residual: number; effect: number } {
  let residual = 0;
  let effect = 0;
  let n = 0;
  for (let k = 1; k < 15; k++) {
    for (let j = 1; j < 15; j++) {
      for (const off of [-2, -1, 0, 1]) {
        const [x, y] = [k * 20 + off, j * 20 + 10];
        const [p, p0, q, q0] = [pixel(a, x, y), pixel(a0, x, y), pixel(b, x, y), pixel(b0, x, y)];
        for (const c of [0, 1, 2]) {
          const canvasDelta = p[c] - p0[c];
          const exportDelta = q[c] - q0[c];
          residual += Math.abs(canvasDelta - exportDelta);
          effect += Math.abs(exportDelta);
          n += 1;
        }
      }
    }
  }
  return { residual: residual / n, effect: effect / n };
}
function redCount(a: SkImage, size: number): number {
  let n = 0;
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const p = pixel(a, x, y);
      if (p[0] > 170 && p[1] < 90 && p[2] < 90) n += 1;
    }
  }
  return n;
}
/** a lágy fényudvar mérése: az összes vörös többlet (R−G) */
function redExcess(a: SkImage, size: number): number {
  let sum = 0;
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const p = pixel(a, x, y);
      sum += Math.max(0, p[0] - p[1]);
    }
  }
  return sum;
}
/** A részlet-műveletek pixelszintű mérése a szerver ellen, ellenpróbával: az effekt nélküli export. */
export async function smokeDeep3(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  log(true, 'mért eszköz', `${Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'telefon'}, pixelarány ${ratio}`);
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = (x * 37 + y * 91 + x * y * 13) % 200;
      paint.setColor(Skia.Color(`rgb(${40 + v},${230 - v},${60 + (v * 2) % 170})`));
      c.drawRect(Skia.XYWHRect(x * 20, y * 20, 20, 20), paint);
    }
  }
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_d3_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const gray = { kind: 'fill', id: 'f', fill: '#808080' } as ImageLayer;
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as ImageLayer;
  const rect = (extra: Partial<ShapeLayer>) => ({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, ...extra }) as ImageLayer;
  const mask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005 };
  const cases: [string, ImageLayer[], Partial<ImageDoc>][] = [
    ['élesítés', [photo({ filters: [{ type: 'sharpen', amount: 0.8 }] })], {}],
    ['clarity szűrő', [photo({ filters: [{ type: 'clarity', amount: 0.8 }] })], {}],
    ['develop clarity', [photo({ develop: { base: {}, detail: { clarity: 0.8 } } as unknown as PhotoLayer['develop'] })], {}],
    ['develop texture', [photo({ develop: { base: {}, detail: { texture: 1 } } as unknown as PhotoLayer['develop'] })], {}],
    ['pixelezés', [photo({ filters: [{ type: 'pixelate', amount: 0.6 }] })], {}],
    ['folt-javítás', [photo({ heal: [{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }] })], {}],
    ['réteg-vignetta', [photo({ adjust: { vignette: 0.9 } })], {}],
    ['grade-vignetta', [photo({ grade: 'moody' })], {}],
    ['maszkolt korrekciós réteg', [photo({}), { kind: 'adjust', id: 'adj', adjust: { saturation: -1, contrast: 0.4 }, mask } as unknown as ImageLayer], {}],
    ['gradiens + korrekció', [bg, rect({ fillGradient: { from: '#ff0000', to: '#0000ff' } }), { kind: 'adjust', id: 'adj', adjust: { saturation: -1 } } as ImageLayer], {}],
    ['szöveg körvonala', [gray, { kind: 'text', id: 't', text: 'ÁRVÍZ', position: { x: 0.5, y: 0.5 }, fontSize: 22, color: '#ffffff', fontWeight: '900', stroke: { color: '#ff0000', width: 0.015 } } as unknown as ImageLayer], {}],
    ['szöveg árnyéka', [gray, { kind: 'text', id: 't', text: 'ÁRVÍZ', position: { x: 0.5, y: 0.5 }, fontSize: 22, color: '#ffffff', fontWeight: '900', dropShadow: { color: '#ff0000', dx: 0.02, dy: 0.02, blur: 0.002, opacity: 1 } } as unknown as ImageLayer], {}],
    ['szöveg ragyogása', [gray, { kind: 'text', id: 't', text: 'ÁRVÍZ', position: { x: 0.5, y: 0.5 }, fontSize: 22, color: '#ffffff', fontWeight: '900', outerGlow: { color: '#ff0000', size: 0.02, opacity: 1 } } as unknown as ImageLayer], {}],
  ];
  const plainOf = (doc: ImageDoc) =>
    ({
      ...doc,
      layers: doc.layers
        .filter((l) => l.kind !== 'adjust')
        .map((l) => ({ ...l, filters: undefined, develop: undefined, heal: undefined, adjust: undefined, grade: undefined, stroke: undefined, dropShadow: undefined, outerGlow: undefined })),
    }) as unknown as ImageDoc;
  const shoot = async (doc: ImageDoc) => {
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1600);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const img = await decode(shot);
    removeFile(shot);
    setHarness(null);
    await sleep(80);
    return img;
  };
  for (const [name, layers, extra] of cases) {
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers, ...extra } as unknown as ImageDoc;
    const a = await shoot(doc);
    const uri = await renderImageDoc(doc, 320);
    const plainUri = await renderImageDoc(plainOf(doc), 320);
    if (!uri || !plainUri) {
      log(false, `részlet = export: ${name}`, 'nincs render');
      continue;
    }
    const b = await decode(uri);
    const p = await decode(plainUri);
    if (name === 'szöveg ragyogása') {
      const [ra, rb, rp] = [redExcess(a, 320), redExcess(b, 320), redExcess(p, 320)];
      log(Math.abs(ra - rb) <= rb * 0.4 && rp < rb * 0.05, `részlet = export: ${name}`, `vörös többlet: vászon ${ra}, export ${rb}, ragyogás nélkül ${rp}`);
    } else if (name.startsWith('szöveg')) {
      const [ra, rb, rp] = [redCount(a, 320), redCount(b, 320), redCount(p, 320)];
      log(Math.abs(ra - rb) <= rb * 0.4 && rp === 0 && rb > 50, `részlet = export: ${name}`, `vörös pontok: vászon ${ra}, export ${rb}, körvonal nélkül ${rp}`);
    } else {
      if (name === 'élesítés' || name.includes('clarity') || name.includes('texture')) {
        // az alap is a Skia-úton rajzolódjon: elhanyagolható élesítés, különben a sima Image-et mérnénk
        const skiaPlain = { ...plainOf(doc), layers: [photo({ filters: [{ type: 'sharpen', amount: 0.001 }] })] } as ImageDoc;
        const fx = edgeEffect(a, await shoot(skiaPlain), b, p);
        log(fx.residual <= fx.effect * 0.5 && fx.effect > 1, `részlet = export: ${name}`, `az effekt a cellahatáron ${fx.effect.toFixed(1)}/255, ebből eltér ${fx.residual.toFixed(1)}`);
        removeFile(uri);
        removeFile(plainUri);
        continue;
      }
      const d = meanDiff(a, b, 320, 320);
      const ctl = meanDiff(a, p, 320, 320);
      log(d <= 8 && ctl >= d * 1.5, `részlet = export: ${name}`, `átlag ${d.toFixed(1)}/255; effekt nélkül ${ctl.toFixed(1)}`);
    }
    removeFile(uri);
    removeFile(plainUri);
  }
  // a szemcse véletlen: pixel helyett a szórását mérjük a középszürkén
  const grainDoc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [gray], grain: 0.7 } as unknown as ImageDoc;
  const g = await shoot(grainDoc);
  const flat = await shoot({ ...grainDoc, grain: 0 } as ImageDoc);
  const uri = await renderImageDoc(grainDoc, 320);
  if (uri) {
    const sv = spread(await decode(uri), 100, 100, 60);
    const sa = spread(g, 100, 100, 60);
    const s0 = spread(flat, 100, 100, 60);
    log(Math.abs(sa - sv) <= sv * 0.35 && s0 < sv * 0.2, 'szemcse szórása = export', `vászon ${sa.toFixed(1)}, export ${sv.toFixed(1)}, szemcse nélkül ${s0.toFixed(1)}`);
    removeFile(uri);
  }
  removeFile(png.uri);
}
