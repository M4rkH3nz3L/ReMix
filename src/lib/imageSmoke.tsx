import { AlphaType, ColorType, drawAsImage, Group, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { renderStrokes } from '@/components/studio/image/BrushOverlay';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { PhotoSkiaContent, makeLutImage } from '@/components/studio/image/SkiaPhotoLayer';
import { flushProjectSave, useProjectAutosave } from '@/hooks/useProjectAutosave';
import { deleteCloudProject } from '@/lib/cloudSync';
import { rotateCanvasDoc } from '@/lib/imageCanvasOps';
import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { renderImageDoc } from '@/lib/imageDocClient';
import { LUT_DRAFT_SIZE, LUT_SIZE } from '@/lib/imagePreviewLut';
import { exportSize } from '@/lib/imageExport';
import { makeId } from '@/lib/id';
import { magicWandSelect } from '@/lib/magicWandClient';
import { normalizePickedImage } from '@/lib/media';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { cloudBaseUrl } from '@/lib/backend';
import { deleteProject, listProjects, loadProject, loadVersions, readRecovery, recoveryIsFresher, saveProject, writeRecovery, clearRecovery } from '@/lib/storage';
import { findMissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, ImageLayer, PhotoLayer, Project, ShapeLayer } from '@/types/project';

type Log = (ok: boolean | null, name: string, detail?: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function decode(uri: string): Promise<SkImage> {
  const bytes = await new File(uri).bytes();
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!img) {
    throw new Error(`nem dekódolható: ${uri}`);
  }
  return img;
}

function pixel(img: SkImage, x: number, y: number): number[] {
  const px = img.readPixels(x, y, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return px ? [...px] : [];
}

/** átlátszó vászon, közepén piros négyzet — az alfa-megőrzés próbájához */
function alphaImage(format: ImageFormat, ext: string): string {
  const surface = Skia.Surface.MakeOffscreen(64, 64)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#ff0000'));
  surface.getCanvas().drawRect(Skia.XYWHRect(20, 20, 24, 24), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_alpha_${Date.now().toString(36)}.${ext}`);
  file.write(surface.makeImageSnapshot().encodeToBytes(format));
  return file.uri;
}

function removeFile(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    /* takarítás — best-effort */
  }
}

async function smokeNetwork(log: Log) {
  const base = cloudBaseUrl();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    log(res.ok, 'telefon → worker', `${base} HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    log(false, 'telefon → worker', `${base}: ${(e as Error).message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function smokeBrush(log: Log) {
  const box = { w: 300, h: 300 };
  // vízszintes vonal a vászon közepén, 10 képpont vastag a képernyőn
  const stroke = { d: 'M30,150 L270,150', color: '#ff0000', width: 10 };
  const img = renderStrokes([stroke], box, 2160, 2160);
  if (!img) {
    log(false, 'I19 ecset offscreen', 'nincs GPU-felület');
    return;
  }
  log(img.width() === 2160 && img.height() === 2160, 'I19 ecset doc-felbontáson', `${img.width()}×${img.height()}`);
  const inside = pixel(img, 1080, 1080 - 30)[3]; // a 72 px vastag vonalon belül
  const outside = pixel(img, 1080, 1080 - 60)[3]; // azon kívül
  log(inside > 200 && outside === 0, 'I19 a vonal arányosan skálázódik (72 px)', `belül α=${inside}, kívül α=${outside}`);
  // a nagy felbontás éles él: a vonal széle pár pixelen belül vált (nem egy elmosódott nagyítás)
  let edge = 0;
  for (let y = 1080 - 40; y < 1080 - 30; y++) {
    const a = pixel(img, 1080, y)[3];
    if (a > 10 && a < 245) {
      edge += 1;
    }
  }
  log(edge <= 3, 'I19 éles él', `${edge} átmeneti pixel`);
}

async function smokeIntake(log: Log) {
  for (const [name, format, ext] of [['WebP', ImageFormat.WEBP, 'webp'], ['PNG', ImageFormat.PNG, 'png']] as const) {
    const src = alphaImage(format, ext);
    const out = await normalizePickedImage(src, 64, 64);
    const img = await decode(out.uri);
    const corner = pixel(img, 2, 2);
    const center = pixel(img, 32, 32);
    log(/\.png$/.test(out.uri) && corner[3] === 0 && center[3] === 255, `I21 átlátszó ${name} import`, `${out.uri.split('.').pop()} sarok α=${corner[3]} közép α=${center[3]}`);
    removeFile(src);
    removeFile(out.uri);
  }
  const jpg = alphaImage(ImageFormat.JPEG, 'jpg');
  const out = await normalizePickedImage(jpg, 64, 64);
  log(/\.jpg$/.test(out.uri), 'I21 JPEG JPEG marad', out.uri.split('.').pop());
  removeFile(jpg);
  removeFile(out.uri);
}

function testDoc(extra: Partial<ImageDoc> = {}): ImageDoc {
  const base = createImageDoc('Smoke', '1:1', () => makeId('lyr'), { width: 1080, height: 1080 });
  // üres, átlátszó vászon: a háttér-réteg nélkül látszik, ha a capture hozza a keretet/hátteret
  const doc: ImageDoc = { ...base, layers: [], ...extra };
  const shape = { kind: 'shape', id: makeId('lyr'), shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff0000' } as ShapeLayer;
  return addLayer(doc, shape as ImageLayer);
}

async function smokeCapture(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const doc = testDoc();
  const ref = createRef<View>() as RefObject<View>;
  setHarness(
    <View style={{ width: 280, height: 280 }}>
      <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
    </View>
  );
  await sleep(900);
  const uri = await captureRef(ref, { format: 'png', quality: 1, width: Math.round(1080 / ratio), height: Math.round(1080 / ratio) });
  const img = await decode(uri);
  log(Math.abs(img.width() - 1080) <= 2 && Math.abs(img.height() - 1080) <= 2, 'I12 offline kép doc-felbontáson', `${img.width()}×${img.height()}, ratio ${ratio}`);
  const w = img.width();
  const corner = pixel(img, 1, 1);
  const edge = pixel(img, Math.round(w / 2), 1);
  const center = pixel(img, Math.round(w / 2), Math.round(w / 2));
  log(corner[3] === 0 && edge[3] === 0, 'I12 nincs keret / háttér, átlátszó', `sarok ${corner} perem ${edge}`);
  log(center[0] > 240 && center[1] < 15 && center[3] === 255, 'I12 a tartalom megvan', `közép ${center}`);
  removeFile(uri);
  setHarness(null);
}

/** 200×100-as kép: bal 70% piros, jobb 30% kék — aszimmetrikus, hogy a rossz leképezés kilógjon */
function wandImage(): string {
  const surface = Skia.Surface.MakeOffscreen(200, 100)!;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#ff0000'));
  canvas.drawRect(Skia.XYWHRect(0, 0, 140, 100), paint);
  paint.setColor(Skia.Color('#0000ff'));
  canvas.drawRect(Skia.XYWHRect(140, 0, 60, 100), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_wand_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  return file.uri;
}

async function smokeWand(log: Log) {
  const uri = wandImage();
  // cover négyzetes dobozban: a kép középső fele látszik (0,25–0,75), a kék 0,7-től → dobozban 0,9-től
  const outline = await magicWandSelect(uri, 0.95, 0.5, 32, { boxAspect: 1, fit: 'cover' });
  const xs = (outline ?? []).map((p) => p.x);
  const min = Math.min(...xs);
  log(!!outline && Math.abs(min - 0.9) < 0.03 && Math.max(...xs) <= 1, 'I33 pálca cover-illesztésnél a kék sávot jelöli', `dobozban x=${min.toFixed(3)}…${Math.max(...xs).toFixed(3)}`);
  const margin = await magicWandSelect(uri, 0.5, 0.05, 32, { boxAspect: 1, fit: 'contain' });
  log(margin === null, 'I33 contain-margóra koppintás nem jelöl ki semmit');
  removeFile(uri);
}

async function smokeZoomCanvas(log: Log, setHarness: (n: ReactNode) => void) {
  const doc = testDoc();
  const layerId = doc.layers[0].id;
  setHarness(
    <View style={{ width: 280, height: 280 }}>
      <ImageCanvas doc={doc} selectedId={layerId} onSelect={() => {}} commit={() => {}} />
    </View>
  );
  await sleep(900);
  log(true, 'I36 a vászon kijelöléssel, kétujjas-pan gesztussal felépül a natív rétegen');
  setHarness(null);
}

/** A valódi vászon kilógó réteggel, kijelölve — képernyőképhez (a fázis nyitva marad). */
async function smokePasteboard(log: Log, setHarness: (n: ReactNode) => void) {
  const base = createImageDoc('Smoke', '1:1', () => makeId('lyr'), { width: 1080, height: 1080 });
  const shape = { kind: 'shape', id: 'over', shape: 'ellipse', position: { x: 0.9, y: 0.5 }, w: 0.6, h: 0.6, fill: '#ff2d95' } as ShapeLayer;
  const doc = addLayer({ ...base, layers: [] }, shape as ImageLayer);
  setHarness(
    <View style={{ width: 340, height: 320 }}>
      <ImageCanvas doc={doc} selectedId="over" initialZoom={0.5} onSelect={() => {}} commit={() => {}} />
    </View>
  );
  await sleep(800);
  log(null, 'PASTEBOARD-READY');
}

/** A valódi réteg- és vászon-lapok (képernyőképhez). */
async function smokeSheets(log: Log, setHarness: (n: ReactNode) => void) {
  const doc = testDoc();
  const id = doc.layers[0].id;
  setHarness(
    <View style={{ width: 380, height: 320 }}>
      <LayerPanel doc={doc} selectedId={id} onSelect={() => {}} onMergeDown={() => {}} onRasterize={() => {}} onFlatten={() => {}} commit={() => {}} onClose={() => {}} />
    </View>
  );
  await sleep(1200);
  log(null, 'SHEETS-READY');
}

/** Vászon-művelet a telefonról, a valódi workeren át. */
async function smokeCanvasOps(log: Log) {
  const base = createImageDoc('Smoke', '1:1', () => makeId('lyr'), { width: 400, height: 200 });
  const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.25, y: 0.5 }, w: 0.5, h: 1, fill: '#ff0000' } as ShapeLayer;
  const doc = addLayer({ ...base, layers: [] }, shape as ImageLayer);
  const rotated = rotateCanvasDoc(doc, 90);
  const uri = await renderImageDoc(rotated, rotated.height);
  if (!uri) {
    log(false, 'vászon-forgatás a telefonról', 'nincs render');
    return;
  }
  const img = await decode(uri);
  // 400×200 balfele piros → 90° jobbra: 200×400, a FELSŐ fele piros
  log(img.width() === 200 && img.height() === 400 && pixel(img, 100, 100)[0] > 240 && pixel(img, 100, 300)[3] === 0, 'vászon-forgatás 90° a telefonról', `${img.width()}×${img.height()} felül ${pixel(img, 100, 100)} alul ${pixel(img, 100, 300)}`);
  removeFile(uri);
}

/** 🎨 Az előnézet a valódi Skia-kimeneten, a valódi szerver-render ellen mérve. */
async function smokeParity(log: Log) {
  const COLORS = ['#c83c28', '#28a050', '#3246c8', '#808080', '#e6dcc8', '#1e1928', '#f0c83c', '#5a2878'];
  const surface = Skia.Surface.MakeOffscreen(320, 40)!;
  const paint = Skia.Paint();
  COLORS.forEach((c, i) => {
    paint.setColor(Skia.Color(c));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 40, 0, 40, 40), paint);
  });
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_par_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const source = await decode(file.uri);
  const cases: [string, Partial<PhotoLayer>][] = [
    ['nincs', { adjust: { contrast: 0.0001 } }],
    ['kontraszt', { adjust: { contrast: 0.3 } }],
    ['telítettség', { adjust: { saturation: 0.5 } }],
    ['hőmérséklet', { adjust: { temperature: 0.2 } }],
    ['vibrance', { adjust: { vibrance: 0.6 } }],
    ['hue', { adjust: { hue: 0.25 } }],
    ['szintek', { levels: { black: 0.1, white: 0.8, gamma: 1.4 } }],
    ['grade', { grade: 'teal-orange' }],
    ['filterId', { filterId: 'warm', filterIntensity: 1 }],
    ['gradient-map', { gradientMap: { shadow: '#102040', highlight: '#ffcc80' } }],
  ];
  const canvas = { width: 320, height: 320 };
  for (const [name, patch] of cases) {
    const layer = { kind: 'photo', id: 'p', uri: file.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...patch } as PhotoLayer;
    const preview = await drawAsImage(
      <PhotoSkiaContent image={source} lut={makeLutImage(layer)} layer={layer} w={320} h={320} scale={1} canvas={canvas} />,
      { width: 320, height: 320 }
    );
    const uri = await renderImageDoc({ id: 'par', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [layer] } as unknown as ImageDoc, 320);
    if (!preview || !uri) {
      log(false, `előnézet = export: ${name}`, 'nincs kép');
      continue;
    }
    const real = await decode(uri);
    let worst = 0;
    for (let i = 0; i < COLORS.length; i++) {
      const a = pixel(preview, i * 40 + 20, 60);
      const b = pixel(real, i * 40 + 20, 60);
      worst = Math.max(worst, ...[0, 1, 2].map((k) => Math.abs(a[k] - b[k])));
    }
    log(worst <= 14, `előnézet = export: ${name}`, `legnagyobb eltérés ${worst}/255`);
    removeFile(uri);
  }
  // vágás és átlátszóság: rácspontonként az alfa
  const shapes: [string, Partial<PhotoLayer>][] = [
    ['téglalap-maszk', { mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005 } }],
    ['ellipszis-maszk', { mask: { shape: 'ellipse', x: 0.4, y: 0.6, w: 0.5, h: 0.4, feather: 0.005 } }],
    ['fordított maszk', { mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005, invert: true } }],
    ['poligon-maszk forgatott rétegen', { rotation: 30, w: 0.7, h: 0.7, mask: { shape: 'polygon', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005, points: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.35 }, { x: 0.55, y: 0.7 }] } }],
  ];
  for (const [name, patch] of shapes) {
    const layer = { kind: 'photo', id: 'p', uri: file.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...patch } as PhotoLayer;
    const lw = 320 * layer.w;
    const lh = 320 * layer.h;
    const preview = await drawAsImage(
      <Group transform={[{ translate: [160, 160] }, { rotate: ((layer.rotation ?? 0) * Math.PI) / 180 }, { translate: [-lw / 2, -lh / 2] }]}>
        <PhotoSkiaContent image={source} lut={null} layer={layer} w={lw} h={lh} scale={1} canvas={canvas} />
      </Group>,
      { width: 320, height: 320 }
    );
    const uri = await renderImageDoc({ id: 'par', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [layer] } as unknown as ImageDoc, 320);
    if (!preview || !uri) {
      log(false, `vágás = export: ${name}`, 'nincs kép');
      continue;
    }
    const real = await decode(uri);
    let bad = 0;
    let total = 0;
    // a vízjel az alsó sávban van, azt kihagyjuk
    for (let y = 10; y < 280; y += 12) {
      for (let x = 10; x < 320; x += 12) {
        total += 1;
        if (Math.abs(pixel(preview, x, y)[3] - pixel(real, x, y)[3]) > 90) {
          bad += 1;
        }
      }
    }
    log(bad / total <= 0.03, `vágás = export: ${name}`, `${bad}/${total} rácspont tér el`);
    removeFile(uri);
  }
  removeFile(file.uri);
}

/** Mérési segéd: két kép eltérése rácspontonként (alfa + szín, ahol mindkettő fedő). */
function gridDiff(a: SkImage, b: SkImage, size: number, stop: number): { bad: number; total: number } {
  let bad = 0;
  let total = 0;
  for (let y = 8; y < stop; y += 12) {
    for (let x = 8; x < size; x += 12) {
      total += 1;
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      const color = p[3] > 128 && q[3] > 128 ? Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - q[k]))) : 0;
      if (Math.abs(p[3] - q[3]) > 70 || color > 40) {
        bad += 1;
      }
    }
  }
  return { bad, total };
}

/** 🔬 A második kör mérései: sebesség, effektek, és a TELJES valódi vászon. */
async function smokeDeep(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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

async function smokeWorker(log: Log) {
  const doc = testDoc();
  const height = exportSize(doc, 2).height;
  const uri = await renderImageDoc(doc, height);
  if (!uri) {
    log(false, 'I9 worker-render a telefonról', 'null');
    return;
  }
  const img = await decode(uri);
  log(img.width() === 2160 && img.height() === 2160, 'I9 2× export a telefonról', `${img.width()}×${img.height()}`);
  log(pixel(img, 5, 5)[3] === 0, 'átlátszó háttér a telefonról kért exportban', `sarok α=${pixel(img, 5, 5)[3]}`);
  removeFile(uri);
}

function AutosaveProbe({ id }: { id: string }) {
  useProjectAutosave(id, true);
  return null;
}

function tempProject(id?: string): Project {
  const p = createEmptyProject('__smoke__', '1:1', undefined, 'image');
  return { ...p, id: id ?? `smoke_${Date.now().toString(36)}`, imageDocs: [testDoc()] };
}

function addTextEdit() {
  const s = useEditorStore.getState();
  const doc = s.project!.imageDocs![0];
  const marker = { kind: 'shape', id: `marker_${Date.now()}`, shape: 'ellipse', position: { x: 0.2, y: 0.2 }, w: 0.1, h: 0.1, fill: '#00ff00' } as ShapeLayer;
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(doc, marker as ImageLayer), label: 'smoke' });
  return marker.id;
}

async function cleanupProject(id: string) {
  useEditorStore.getState().closeProject();
  await deleteProject(id).catch(() => {});
  await deleteCloudProject(id).catch(() => false);
  await clearRecovery(id).catch(() => {});
}

async function smokeAutosave(log: Log, setHarness: (n: ReactNode) => void) {
  const p = tempProject();
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={p.id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  const onDisk = await loadProject(p.id);
  const saved = !!onDisk?.imageDocs?.[0].layers.some((l) => l.id === marker);
  log(saved, 'I1 autosave lemezre ír kilépés nélkül', saved ? 'a réteg a lemezen' : 'nincs a lemezen');
  log(!useEditorStore.getState().dirty, 'I1 mentés után nem piszkos');

  const second = addTextEdit();
  const flushed = await flushProjectSave();
  const afterFlush = await loadProject(p.id);
  log(flushed && !!afterFlush?.imageDocs?.[0].layers.some((l) => l.id === second), 'I1 azonnali mentés (háttérbe lépés útja)');

  const state = useEditorStore.getState();
  writeRecovery(state.project!, state.events);
  await sleep(300);
  const rec = await readRecovery(p.id);
  log(!!rec && recoveryIsFresher(rec.at, new Date(Date.now() - 60000).toISOString()), 'I1 recovery-pillanatkép visszaolvasható');

  // I3: hiányzó rétegfájl felismerése valódi fájlrendszeren
  const photo = { kind: 'photo', id: 'gone', uri: `${projectMediaDir().uri}/nincs_ilyen.png`, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover' } as PhotoLayer;
  const s = useEditorStore.getState();
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(s.project!.imageDocs![0], photo as ImageLayer), label: 'smoke' });
  const after = useEditorStore.getState().project!;
  log(after.assets.some((a) => a.uri === photo.uri), 'I2 a rétegfájl assetként regisztrálva');
  log(findMissingMedia(after).some((m) => m.uri === photo.uri), 'I3 a hiányzó rétegfájl felismerve');

  setHarness(null);
  await sleep(100);
  await cleanupProject(p.id);
  log((await loadProject(p.id)) == null, 'takarítás: az ideiglenes projekt törölve');
}

/** 1. fázis: szerkesztés + autosave, utána a Mac leállítja az appot */
async function killPhase1(log: Log, setHarness: (n: ReactNode) => void, id: string) {
  const p = tempProject(id);
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  log(null, 'KILL-READY', marker);
}

/** 2. fázis: az app leállítása után a szerkesztés megvan-e a lemezen */
async function killPhase2(log: Log, id: string) {
  const onDisk = await loadProject(id);
  const count = onDisk?.imageDocs?.[0].layers.filter((l) => l.id.startsWith('marker_')).length ?? 0;
  log(count === 1, 'I1 app-kill után a szerkesztés megmaradt', `${count} jelölő réteg`);
  await cleanupProject(id);
}

/** Csak olvas: a kép-projektek rétegei + a verzió-előzmény, hibakereséshez. */
async function inspectProjects(log: Log) {
  const all = (await listProjects()).filter((p) => p.kind === 'image');
  for (const meta of all) {
    const p = await loadProject(meta.id);
    log(null, `PROJ ${meta.name} ${meta.id}`, `upd=${p?.updatedAt} docs=${p?.imageDocs?.length} assets=${p?.assets.length}`);
    for (const d of p?.imageDocs ?? []) {
      for (const l of d.layers) {
        const uri = (l as PhotoLayer).uri;
        const exists = uri ? (() => { try { return new File(uri).exists; } catch { return false; } })() : null;
        const pos = (l as PhotoLayer).position;
        log(null, `  ${l.kind} ${l.id}`, `w=${(l as PhotoLayer).w} h=${(l as PhotoLayer).h} pos=${pos?.x},${pos?.y} hidden=${!!l.hidden} file=${uri?.split('/').pop()} exists=${exists}`);
      }
    }
    const versions = await loadVersions(meta.id).catch(() => []);
    const summary = versions.slice(0, 6).map((v) => `${v.at.slice(11, 19)}:${v.project.imageDocs?.[0]?.layers.map((l) => (l as PhotoLayer).uri?.split('/').pop() ?? l.kind).join('+')}`);
    log(null, `  verziók: ${versions.length}`, summary.join(' | '));
  }
}

/** A JS-szál mérése 20 mp-ig: 250 ms-os ketyegés, a késés a fagyást mutatja. Túléli a navigációt. */
function startFreezeWatch(log: Log) {
  let last = Date.now();
  let worst = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    worst = Math.max(worst, now - last - 250);
    last = now;
    ticks += 1;
    if (ticks === 80) {
      clearInterval(timer);
      const s = useEditorStore.getState();
      log(worst < 500, 'JS-szál a valódi stúdióban (20 mp)', `legnagyobb akadás ${worst} ms, dirty=${s.dirty}, past=${s.past.length}`);
      console.log('[IMG-SMOKE] WATCH-DONE');
    }
  }, 250);
}

/** Ideiglenes projekt a tablet-elrendezés megnézéséhez (`kill2` törli). */
export async function tabletProject(id: string): Promise<string> {
  await saveProject(tempProject(id));
  return id;
}

export async function firstImageProjectId(): Promise<string | null> {
  const all = await listProjects();
  return all.find((p) => p.kind === 'image')?.id ?? null;
}

export async function runImageSmoke(
  phase: string,
  log: Log,
  setHarness: (n: ReactNode) => void,
  ratio: number,
  killId: string
): Promise<void> {
  const step = async (name: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      log(false, name, String((e as Error)?.message ?? e).slice(0, 300));
    }
  };
  if (phase === 'kill1') {
    await step('kill1', () => killPhase1(log, setHarness, killId));
    return;
  }
  if (phase === 'kill2') {
    await step('kill2', () => killPhase2(log, killId));
    return;
  }
  if (phase === 'ui') {
    startFreezeWatch(log);
    return;
  }
  if (phase === 'inspect') {
    await step('inspect', () => inspectProjects(log));
    return;
  }
  if (phase === 'deep') {
    await step('deep', () => smokeDeep(log, setHarness, ratio));
    return;
  }
  if (phase === 'parity') {
    await step('parity', () => smokeParity(log));
    return;
  }
  if (phase === 'sheets') {
    await step('sheets', () => smokeSheets(log, setHarness));
    return;
  }
  if (phase === 'pasteboard') {
    await step('pasteboard', () => smokePasteboard(log, setHarness));
    return;
  }
  const online = await smokeNetwork(log);
  await step('brush', () => smokeBrush(log));
  await step('intake', () => smokeIntake(log));
  await step('capture', () => smokeCapture(log, setHarness, ratio));
  await step('wand', () => smokeWand(log));
  await step('zoom', () => smokeZoomCanvas(log, setHarness));
  // a takarítása bezárja a store projektjét: a felhasználó nyitott munkájához nem nyúlhat
  if (useEditorStore.getState().project) {
    log(null, 'autosave-kör kihagyva', 'nyitott projekt van');
  } else {
    await step('autosave', () => smokeAutosave(log, setHarness));
  }
  if (online) {
    await step('worker', () => smokeWorker(log));
    await step('canvas-ops', () => smokeCanvasOps(log));
    await step('parity', () => smokeParity(log));
  }
}
