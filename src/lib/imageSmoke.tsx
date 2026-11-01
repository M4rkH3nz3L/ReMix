import { AlphaType, ColorType, drawAsImage, Group, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { Dimensions, Modal, PixelRatio, Platform, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { BrushOverlay, type BrushHandle, renderStrokes } from '@/components/studio/image/BrushOverlay';
import { BrushBar } from '@/components/studio/image/body/BrushBar';
import { SelectionBar } from '@/components/studio/image/body/SelectionBar';
import { Asset } from 'expo-asset';
import { layerSkPath, offsetToResult, skiaBooleanEngine, strokeToResult, withResult } from '@/components/studio/image/skiaVector';
import { booleanCombineInDoc } from '@/lib/imageBoolean';
import { anchorFromDrag, type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
import { moveAnchor, pathEditPatch, pathEditView, setNodeType } from '@/lib/vectorPath';
import { projectMaskToCanvas } from '@/components/studio/image/projectMask';
import { foregroundMask } from '@/lib/foregroundMask';
import { AssistantBar } from '@/components/studio/image/body/AssistantBar';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { useBrandStyle } from '@/store/brandStyleStore';
import { TemplatesSheet } from '@/components/studio/image/TemplatesSheet';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { variantDoc } from '@/lib/imageVariants';
import { applyImageCommands, parseImageIntent } from '@/lib/imageIntent';
import { logCaught } from '@/lib/logCaught';
import { ExportCancelled } from '@/lib/imageDocClient';
import { photoBytesPerPixel } from '@/components/studio/image/exportEstimate';
import { readExportFacts } from '@/components/studio/image/exportVerify';
import { expectsAlpha, exportProblems, layerOnlyDoc, selectionOnlyDoc } from '@/lib/imageExportCheck';
import { customExportSize, formatBytes } from '@/lib/imageExport';
import { ingestImageFile } from '@/lib/media';
import { supabase } from '@/lib/supabase';
import { layerHistogram } from '@/components/studio/image/HistogramView';
import { HslSheet } from '@/components/studio/image/HslSheet';
import { computeHistogram, histogramShift } from '@/lib/histogram';
import { SelectionAnts } from '@/components/studio/image/SelectionAnts';
import { updateLayer } from '@/lib/imageDoc';
import { adjustSelection, copySelectionToLayer, deleteSelection, maskFromSelection } from '@/lib/imageSelectionOps';
import { applyRing, ellipseRing, invertSelection, rectRing, selectionToMask } from '@/lib/selection';
import { DEFAULT_BRUSH, type RetouchTool, type Stroke } from '@/lib/brushEngine';
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
import type { ImageClip, ImageDoc, ImageLayer, PhotoLayer, Project, ShapeLayer } from '@/types/project';

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
  const stroke = { points: [{ x: 0.1, y: 0.5, p: 1 }, { x: 0.9, y: 0.5, p: 1 }], color: '#ff0000', width: 10 / box.w, hardness: 1, opacity: 1, eraser: false };
  const img = renderStrokes([stroke], 2160, 2160);
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

/** 🔬 Szöveg/forma effektek, doc-szintű hatások, .cube, lokális korrekció: valódi vászon a szerver ellen. */
async function smokeDeep2(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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

function meanDiff(a: SkImage, b: SkImage, size: number, stop: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 5; y < stop; y += 7) {
    for (let x = 5; x < size - 5; x += 7) {
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      sum += (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
      n += 1;
    }
  }
  return sum / n;
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

function spread(a: SkImage, x0: number, y0: number, n: number): number {
  const v: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) v.push(pixel(a, x0 + x, y0 + y)[1]);
  const m = v.reduce((p, c) => p + c, 0) / v.length;
  return Math.sqrt(v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length);
}

/** A részlet-műveletek pixelszintű mérése a szerver ellen, ellenpróbával: az effekt nélküli export. */
async function smokeDeep3(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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

/** Az ecset-motor a valódi Skia-rajzon, a valódi overlay-en át; a hibás logikát mind ellenpróba fogja meg. */
async function smokeBrushEngine(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const line = (extra: Partial<Stroke>, y = 0.5): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color: '#ff0000', width: 0.1, hardness: 1, opacity: 1, eraser: false, ...extra });
  const size = 400;
  const alpha = (img: SkImage, x: number, y: number) => pixel(img, x, y)[3];

  // átlátszóság: önmagát keresztező vonás a metszésben sem sötétedik
  const cross: Stroke = { ...line({ opacity: 0.5 }), points: [{ x: 0.1, y: 0.5, p: 1 }, { x: 0.9, y: 0.5, p: 1 }, { x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }] };
  const a = renderStrokes([cross], size, size)!;
  const [one, both] = [alpha(a, 100, 200), alpha(a, 200, 200)];
  log(Math.abs(one - 128) <= 3 && Math.abs(both - one) <= 3, 'átlátszóság: a vonás önmagán nem halmozódik', `vonalon α=${one}, keresztezésben α=${both}`);
  const twice = renderStrokes([line({ opacity: 0.5 }), line({ opacity: 0.5 })], size, size)!;
  log(alpha(twice, 200, 200) > 180, 'ellenpróba: két külön vonás már fed', `α=${alpha(twice, 200, 200)}`);

  // keménység: az él mennyire fokozatos
  const edgeBand = (s: Stroke) => {
    const img = renderStrokes([s], size, size)!;
    let band = 0;
    for (let y = 120; y < 200; y++) {
      const v = alpha(img, 200, y);
      if (v > 12 && v < 243) band += 1;
    }
    return band;
  };
  const [hard, soft] = [edgeBand(line({ hardness: 1 })), edgeBand(line({ hardness: 0 }))];
  log(hard <= 3 && soft >= 10, 'keménység: a lágy él fokozatos, a kemény éles', `átmenet: kemény ${hard} px, lágy ${soft} px`);

  // nyomás
  const widthAt = (p: number) => {
    const img = renderStrokes([{ ...line({}), points: [{ x: 0.1, y: 0.5, p }, { x: 0.9, y: 0.5, p }] }], size, size)!;
    let n = 0;
    for (let y = 100; y < 300; y++) if (alpha(img, 200, y) > 128) n += 1;
    return n;
  };
  const [light, heavy] = [widthAt(0), widthAt(1)];
  log(Math.abs(heavy - 40) <= 1 && Math.abs(light - 10) <= 1, 'nyomás: a vastagság a nyomást követi', `könnyű ${light} px, erős ${heavy} px`);

  // radír: csak a metszetben lyukaszt
  const erased = renderStrokes([line({}), { ...line({ eraser: true }), points: [{ x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }] }], size, size)!;
  log(alpha(erased, 200, 200) === 0 && alpha(erased, 100, 200) === 255, 'radír: a keresztezésben lyuk, mellette érintetlen', `metszet α=${alpha(erased, 200, 200)}, mellette α=${alpha(erased, 100, 200)}`);

  // a valódi overlay: vonásonkénti undo, és az előnézet = export
  const box = { w: 300, h: 300 };
  const ref = createRef<BrushHandle>();
  const view = createRef<View>() as RefObject<View>;
  const history: string[] = [];
  const mount = (baseUri?: string) =>
    setHarness(
      <View ref={view} collapsable={false} style={{ width: box.w, height: box.h, backgroundColor: 'transparent' }}>
        <BrushOverlay ref={ref} box={box} settings={DEFAULT_BRUSH} baseUri={baseUri} onHistory={(u, r) => history.push(`${u}/${r}`)} />
      </View>
    );
  mount();
  await sleep(500);
  ref.current!.addStroke(line({ color: '#00ff00', opacity: 0.6, hardness: 0.3 }, 0.3));
  ref.current!.addStroke(line({ color: '#0000ff' }, 0.7));
  await sleep(300);
  ref.current!.undo();
  await sleep(300);
  const undone = await decode(ref.current!.exportPng(300, 300)!);
  log(alpha(undone, 150, 90) > 100 && alpha(undone, 150, 210) === 0, 'undo: csak az utolsó vonás tűnik el', `első α=${alpha(undone, 150, 90)}, második α=${alpha(undone, 150, 210)}`);
  log(history[history.length - 1] === 'true/true', 'a gombok állapota követi az előzményt', history[history.length - 1]);
  ref.current!.redo();
  await sleep(300);
  const shot = await captureRef(view, { format: 'png', quality: 1, width: 300 / ratio, height: 300 / ratio });
  const uri = ref.current!.exportPng(300, 300)!;
  const [screen, png] = [await decode(shot), await decode(uri)];
  // egyetlen élpixel bármit mutathat, ezért a rácspontok arányát mérjük
  let bad = 0;
  let total = 0;
  const sample: string[] = [];
  for (let y = 10; y < 290; y += 6) {
    for (let x = 40; x < 260; x += 6) {
      const [p, q] = [pixel(screen, x, y), pixel(png, x, y)];
      total += 1;
      // az alig látszó szélen a szín nem számít, az alfa viszont kiszúrná a hiányzó rajzot
      const seen = p[3] > 64 && q[3] > 64;
      if (Math.abs(p[3] - q[3]) > 40 || (seen && [0, 1, 2].some((c) => Math.abs(p[c] - q[c]) > 40))) {
        bad += 1;
        if (sample.length < 3) sample.push(`${x},${y}: ${p} / ${q}`);
      }
    }
  }
  log(bad / total <= 0.03 && alpha(png, 150, 210) === 255, 'előnézet = PNG az overlay-en', `${bad}/${total} rácspont tér el ${sample.join(' | ')}`);
  removeFile(shot);

  // festett réteg folytatása: a radír a korábbi festést is törli
  setHarness(null);
  await sleep(100);
  mount(uri);
  await sleep(900);
  ref.current!.addStroke({ ...line({ eraser: true }, 0.7) });
  await sleep(300);
  const reopened = await decode(ref.current!.exportPng(300, 300)!);
  log(alpha(reopened, 150, 90) > 100 && alpha(reopened, 150, 210) === 0, 'újranyitott festésen a radír a régi vonást törli', `megmaradó α=${alpha(reopened, 150, 90)}, törölt α=${alpha(reopened, 150, 210)}`);

  // az export a szerver útján is ugyanazt adja
  const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 300, height: 300, layers: [{ kind: 'photo', id: 'p', uri, paint: true, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'contain' }] } as unknown as ImageDoc;
  const server = await renderImageDoc(doc, 300);
  if (server) {
    const s = await decode(server);
    const [g, b] = [pixel(s, 150, 90), pixel(s, 150, 210)];
    const [eg, eb] = [pixel(png, 150, 90), pixel(png, 150, 210)];
    log(Math.abs(b[2] - eb[2]) <= 8 && Math.abs(b[3] - eb[3]) <= 8 && Math.abs(g[3] - eg[3]) <= 20, 'a szerver-export a festést adja', `kék ${b} (várt ${eb}), zöld ${g} (várt ${eg})`);
    removeFile(server);
  } else {
    log(false, 'a szerver-export a festést adja', 'nincs render');
  }
  removeFile(uri);
  setHarness(null);
}

/** A kijelölés a valódi vásznon a szerver ellen, ellenpróbával; a műveletek a valódi függvényeken át mennek. */
async function smokeSelection(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
async function smokeColor(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
async function smokePaintMask(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
async function smokeRetouch(log: Log) {
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
async function smokeBgRemove(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const asset = await Asset.fromModule(require('../../assets/images/icon.png')).downloadAsync();
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
async function smokeVector(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
async function smokeBoolean(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
async function smokePathOps(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
async function smokeGrid(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
async function smokeImportExport(log: Log) {
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
  const art = (await Asset.fromModule(require('../../assets/images/icon.png')).downloadAsync()).localUri!;
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
async function smokeAssistant(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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

/** Sablonok, méretváltozat és a kép→videó a valódi vásznon, szerveren és tárolón át. */
async function smokeEcosystem(log: Log, setHarness: (n: ReactNode) => void, ratio: number, brandOnly = false) {
  let n = 0;
  const id = () => `eco${++n}`;
  const check = async (name: string, doc: ImageDoc, other: ImageDoc) => {
    const { width, height } = effectiveCanvas(doc);
    const scale = Math.min(320 / width, 320 / height);
    const [W, H] = [Math.round(width * scale), Math.round(height * scale)];
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: W + 20, height: H + 20 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1300);
    // a kijelző teljes felbontásán: a kis szöveg így nem mintavételi zaj
    const shot = await captureRef(v, { format: 'png', quality: 1, width: W, height: H });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const target = Math.max(240, H * ratio);
    const [e, c] = [await renderImageDoc(doc, target), await renderImageDoc(other, target)];
    if (!e || !c) {
      log(false, name, 'nincs render');
      return;
    }
    // a két kép mérete eltérhet (a szerver minimum 240 magas): arányos pontokon hasonlítunk
    const diff = (p: SkImage, q: SkImage) => {
      let sum = 0;
      let count = 0;
      for (let i = 1; i < 40; i++) {
        for (let j = 1; j < 40; j++) {
          const [x, y] = [(j + 0.5) / 40, (i + 0.5) / 40];
          const [u, w] = [pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height())), pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()))];
          sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
          count += 1;
        }
      }
      return sum / count;
    };
    const d = diff(a, await decode(e));
    const ctl = diff(a, await decode(c));
    // hol van a fehér szöveg a két képen, a kép arányában
    const whiteBox = (img: SkImage) => {
      let [x0, y0, x1, y1] = [1, 1, 0, 0];
      for (let i = 0; i < 120; i++) {
        for (let j = 0; j < 120; j++) {
          const [x, y] = [j / 120, i / 120];
          const p = pixel(img, Math.floor(x * img.width()), Math.floor(y * img.height()));
          if (p[0] > 230 && p[1] > 230 && p[2] > 230) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
      }
      return `${x0.toFixed(2)},${y0.toFixed(2)}–${x1.toFixed(2)},${y1.toFixed(2)}`;
    };
    log(null, `doboz ${name}`, `vászon ${whiteBox(a)}, export ${whiteBox(await decode(e))}`);
    log(d <= 7 && ctl >= d * 1.5, name, `átlag ${d.toFixed(1)}/255; ellenpróba ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(e);
    removeFile(c);
  };
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height} betűméret ${PixelRatio.getFontScale()}`);
  if (brandOnly) {
    // a felhasználó márkáját a mérés után visszaírjuk
    const mine = await loadBrandStyle();
    const brand = { colors: ['#ffd166', '#0a7d3e'], fontFamily: 'Bungee' };
    await saveBrandStyle(brand);
    const stored = await loadBrandStyle();
    log(stored.fontFamily === 'Bungee' && stored.colors.length === 2, 'márka: visszaolvasva a tárolóból', JSON.stringify(stored));
    for (const tpl of IMAGE_TEMPLATES) {
      const doc = docFromTemplate(tpl, tpl.key, id, stored);
      // ellenpróba: ugyanaz a sablon márka nélkül; ha a szerver nem kapná a fontot, ez bukna
      await check(`márkás sablon = export: ${tpl.key}`, doc, docFromTemplate(tpl, tpl.key, id));
    }
    const plain = docFromTemplate(IMAGE_TEMPLATES[0], 'a', id, { colors: [], fontFamily: 'Poppins' });
    await check('a márka-font valóban más képet ad', docFromTemplate(IMAGE_TEMPLATES[0], 'b', id, { colors: [], fontFamily: 'Bungee' }), plain);
    useBrandStyle.setState({ colors: stored.colors, fontFamily: stored.fontFamily });
    setHarness(
      <Modal transparent visible>
        <TemplatesSheet onPick={() => {}} onClose={() => {}} />
      </Modal>
    );
    await sleep(1500);
    log(true, 'FOTÓZHATÓ', 'a Sablonok lap a márkával');
    await sleep(9000);
    setHarness(null);
    useBrandStyle.setState({ colors: mine.colors, fontFamily: mine.fontFamily });
    await saveBrandStyle(mine);
    return;
  }
  const docs = IMAGE_TEMPLATES.map((tpl) => docFromTemplate(tpl, tpl.key, id));
  for (const [i, doc] of docs.entries()) {
    await check(`sablon = export: ${IMAGE_TEMPLATES[i].key}`, doc, { ...doc, layers: doc.layers.slice(0, 1) } as ImageDoc);
  }
  const post = docs[1];
  const story = variantDoc(post, 1080, 1920, 'Story', id);
  await check('változat 9:16 = export', story, post);
  const wide = variantDoc(post, 1500, 500, 'Fejléc', id);
  await check('változat széles = export', wide, post);

  const video = addImageDocToVideo(createEmptyProject('smoke kép→videó', '16:9', undefined, 'video'), post, 'file:///smoke.png');
  await saveProject(video);
  const loaded = await loadProject(video.id);
  const clip = loaded?.tracks.find((t) => t.type === 'video')?.clips[0] as ImageClip | undefined;
  const restored = loaded?.imageDocs?.find((d) => d.id === clip?.docId);
  log(restored?.layers.length === post.layers.length, 'kép→videó: mentés után is ott a réteges dokumentum', `${restored?.layers.length ?? 0} réteg, docId ${clip?.docId ? 'megvan' : 'nincs'}`);
  await deleteProject(video.id);
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
  if (phase === 'selectbar') {
    await step('selectbar', async () => {
      setHarness(
        <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center' }}>
          <SelectionBar tool="rect" mode="subtract" selection={applyRing(null, rectRing({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }), 'new')} canUseLayer canShape={false} onTool={() => {}} onMode={() => {}} onInvert={() => {}} onFeather={() => {}} onAction={() => {}} onClear={() => {}} onDone={() => {}} />
        </View>
      );
      log(true, 'FOTÓZHATÓ', 'a kijelölés sávja a kijelzőn');
      await sleep(6000);
      setHarness(null);
    });
    return;
  }
  if (phase === 'color') {
    await step('color', () => smokeColor(log, setHarness, ratio));
    return;
  }
  if (phase === 'brand') {
    await step('brand', () => smokeEcosystem(log, setHarness, ratio, true));
    return;
  }
  if (phase === 'eco') {
    await step('eco', () => smokeEcosystem(log, setHarness, ratio));
    return;
  }
  if (phase === 'assistant') {
    await step('assistant', () => smokeAssistant(log, setHarness, ratio));
    return;
  }
  if (phase === 'export13') {
    await step('export13', () => smokeImportExport(log));
    return;
  }
  if (phase === 'grid') {
    await step('grid', () => smokeGrid(log, setHarness, ratio));
    return;
  }
  if (phase === 'pathops') {
    await step('pathops', () => smokePathOps(log, setHarness, ratio));
    return;
  }
  if (phase === 'boolean') {
    await step('boolean', () => smokeBoolean(log, setHarness, ratio));
    return;
  }
  if (phase === 'vector') {
    await step('vector', () => smokeVector(log, setHarness, ratio));
    return;
  }
  if (phase === 'bgremove') {
    await step('bgremove', () => smokeBgRemove(log, setHarness, ratio));
    return;
  }
  if (phase === 'retouch') {
    await step('retouch', () => smokeRetouch(log));
    return;
  }
  if (phase === 'paintmask') {
    await step('paintmask', () => smokePaintMask(log, setHarness, ratio));
    return;
  }
  if (phase === 'logs') {
    await step('logs', async () => {
      // egyedi üzenetű hiba, hogy a szerveren egyértelműen megtalálható legyen
      logCaught('lib/imageSmoke.tsx:logs', new Error(`smoke-naplo-proba ${Platform.OS}`));
      // a Supabase nem dob: a nem létező tábla hibája csak a kérés-szintű naplóból látszik
      const res = await supabase?.from('smoke_nincs_ilyen_tabla').select('id').limit(1);
      log(!!res?.error, 'a Supabase-hiba a hívónak is megmarad', res?.error?.code ?? 'nincs hiba');
      await sleep(4000);
    });
    return;
  }
  if (phase === 'net') {
    await step('net', async () => {
      const probe = async (url: string) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const t0 = Date.now();
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          log(r.ok, 'elérés', `${url} HTTP ${r.status}, ${Date.now() - t0} ms`);
        } catch (e) {
          log(false, 'elérés', `${url} ${String(e).slice(0, 70)}, ${Date.now() - t0} ms`);
        }
        clearTimeout(timer);
      };
      log(true, 'eszköz', Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'telefon');
      await probe('http://192.168.0.34:8081/status');
      await probe('http://192.168.0.34:8787/health');
      await probe('http://192.168.0.34:8081/status');
      await probe('http://192.168.0.34:8787/health');
    });
    return;
  }
  if (phase === 'selection') {
    await step('selection', () => smokeSelection(log, setHarness, ratio));
    return;
  }
  if (phase === 'brushbar') {
    await step('brushbar', async () => {
      setHarness(
        <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center' }}>
          <BrushBar brush={{ ...DEFAULT_BRUSH, tool: 'clone' }} retouch onChange={() => {}} canUndo canRedo={false} onUndo={() => {}} onRedo={() => {}} onCancel={() => {}} onDone={() => {}} />
        </View>
      );
      log(true, 'FOTÓZHATÓ', 'az ecset-sáv a kijelzőn');
      await sleep(7000);
      setHarness(null);
    });
    return;
  }
  if (phase === 'brush') {
    await step('brush', () => smokeBrushEngine(log, setHarness, ratio));
    return;
  }
  if (phase === 'deep3') {
    await step('deep3', () => smokeDeep3(log, setHarness, ratio));
    return;
  }
  if (phase === 'deep2') {
    await step('deep2', () => smokeDeep2(log, setHarness, ratio));
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
