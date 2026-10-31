import { AlphaType, ColorType, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { renderStrokes } from '@/components/studio/image/BrushOverlay';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { flushProjectSave, useProjectAutosave } from '@/hooks/useProjectAutosave';
import { deleteCloudProject } from '@/lib/cloudSync';
import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { renderImageDoc } from '@/lib/imageDocClient';
import { exportSize } from '@/lib/imageExport';
import { makeId } from '@/lib/id';
import { normalizePickedImage } from '@/lib/media';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { cloudBaseUrl } from '@/lib/backend';
import { deleteProject, listProjects, loadProject, readRecovery, recoveryIsFresher, saveProject, writeRecovery, clearRecovery } from '@/lib/storage';
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
    return;
  }
  const online = await smokeNetwork(log);
  await step('brush', () => smokeBrush(log));
  await step('intake', () => smokeIntake(log));
  await step('capture', () => smokeCapture(log, setHarness, ratio));
  await step('autosave', () => smokeAutosave(log, setHarness));
  if (online) {
    await step('worker', () => smokeWorker(log));
  }
}
