/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { AlphaType, ColorType, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { Alert, Dimensions, PixelRatio, Platform, View } from 'react-native';
import { type Href, router } from 'expo-router';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { buildRenderPlan, canRenderLocally, deviceRenderGaps, renderLocal } from '@/lib/nativeRender';
import { rasterTextOverlays } from '@/lib/overlayRasterBridge';
import * as StillThumbs from 'expo-video-thumbnails';
import '@/lib/dspNativeClient';
import { t as i18nT } from 'i18next';
import { RenderStage, type RenderStageHandle } from '@/components/studio/image/RenderStage';
import { createImageDoc, docIsEmpty } from '@/lib/imageDoc';
import { renderImageDoc } from '@/lib/imageDocClient';
import { useSeoGate } from '@/store/seoGateStore';
import { IMAGE_LOOKS, applyLook } from '@/lib/imageLooks';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { usePaywall } from '@/store/paywallStore';
import { useEntitlement } from '@/store/entitlementStore';
import type { ImageDoc, Project } from '@/types/project';
import { type Log, decode, pixel, removeFile, sleep } from './shared';

/** 🎞️ S17: a 10 beépített look a fotón — telefon = szerver, mindegyik érdemben változtat */
export async function smokeLooks(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  // 8×8 színrács: oszloponként árnyalat, soronként világosság (sötéttől a világosig)
  const surface = Skia.Surface.MakeOffscreen(400, 400)!;
  const paint = Skia.Paint();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    paint.setColor(Skia.Color(`hsl(${i * 45}, ${j === 7 ? 0 : 70}%, ${10 + j * 11}%)`));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 50, j * 50, 50, 50), paint);
  }
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_looks_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) {
      const u = pixel(p, Math.floor(((j + 0.5) / 64) * p.width()), Math.floor(((i + 0.5) / 64) * p.height()));
      const w = pixel(q, Math.floor(((j + 0.5) / 64) * q.width()), Math.floor(((i + 0.5) / 64) * q.height()));
      sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
      n += 1;
    }
    return sum / n;
  };
  const doc = (extra: Record<string, unknown>) => ({ id: 'lk', name: 'lk', aspectRatio: '1:1', width: 400, height: 400, layers: [{ id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }] }) as unknown as ImageDoc;
  const plain = await ref.current!.render(doc({}), 400);
  const res: string[] = [];
  let ok = 0;
  for (const look of IMAGE_LOOKS) {
    const d = doc(applyLook(look));
    const dev = await ref.current!.render(d, 400);
    const srv = await renderImageDoc(d, 400);
    if (!dev || !srv || !plain) {
      res.push(`${look.key}: nincs kép`);
      continue;
    }
    const a = await decode(dev);
    const diff = meanDiff(a, await decode(srv));
    const ctl = meanDiff(a, await decode(plain));
    if (diff <= 6 && ctl > diff * 2) ok += 1;
    res.push(`${look.key} ${diff.toFixed(2)} (${ctl.toFixed(1)})`);
    [dev, srv].forEach((u) => removeFile(u));
  }
  log(ok === IMAGE_LOOKS.length, `mind a ${IMAGE_LOOKS.length} look: telefon = szerver, és érdemben változtat`, `${ok}/${IMAGE_LOOKS.length} · ${res.join(' · ')}`);
  if (plain) removeFile(plain);
  setHarness(null);
  removeFile(f.uri);
}
/** 📸 S18: a kijelölő keret fogói a stúdióban (képernyőképhez: sarok-, oldal- és forgató fogó) */
export async function smokeFrameShot(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const fs = Skia.Surface.MakeOffscreen(200, 200)!;
  const fp = Skia.Paint();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    fp.setColor(Skia.Color(`hsl(${(i * 70 + j * 30) % 360}, 70%, 55%)`));
    fs.getCanvas().drawRect(Skia.XYWHRect(i * 50, j * 50, 50, 50), fp);
  }
  fs.flush();
  const frameshotFile = new File(projectMediaDir(), `smoke_frameshot_${Date.now().toString(36)}.png`);
  frameshotFile.write(fs.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const frameshotPhoto = frameshotFile.uri;
  const id = 'prj_smoke_frameshot';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:frameshot-del0', caught));
  const page = { id: 'pg', name: 'pg', aspectRatio: '1:1', width: 600, height: 600, layers: [
    { id: 'bg', kind: 'fill', fill: '#203040' },
    { id: 's', kind: 'shape', shape: 'rectangle', position: { x: 0.45, y: 0.5 }, w: 0.4, h: 0.3, rotation: 15, fill: '#ff8a3d' },
    { id: 'ph', kind: 'photo', uri: frameshotPhoto, position: { x: 0.72, y: 0.72 }, w: 0.4, h: 0.4, fit: 'stretch', corners: [{ x: 0.1, y: 0.05 }, { x: 0.95, y: 0.15 }, { x: 0.85, y: 0.95 }, { x: 0, y: 0.8 }] },
    { id: 't', kind: 'text', text: 'Oldal-fogó', position: { x: 0.5, y: 0.2 }, fontSize: 7, color: '#ffffff', fontFamily: 'Poppins', fontWeight: 'bold', textAlign: 'center', backgroundColor: null },
  ] } as unknown as ImageDoc;
  await saveProject({ ...createEmptyProject('smoke keret-fogók', '1:1', undefined, 'image'), id, imageDocs: [page] });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/image/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1500);
    await runDevAction('image.selectLayer', 's');
    log(true, 'FOTÓZHATÓ', 'forgatott forma kijelölve: 4 sarok-, 4 oldal- és a forgató fogó');
    await sleep(7000);
    await runDevAction('image.selectLayer', 't');
    log(true, 'FOTÓZHATÓ', 'szöveg kijelölve: csak bal/jobb oldal-fogó');
    await sleep(7000);
    // S18: 4-sarkos perspektíva mód a fotón (már torzítva)
    await runDevAction('image.selectLayer', 'ph');
    await sleep(300);
    await runDevAction('image.tool', 'cornerPin');
    log(true, 'FOTÓZHATÓ', 'perspektíva mód: 4 sarokfogó a torzított fotón');
    await sleep(7000);
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:frameshot-del', caught));
  }
}
/** ✂️ S18: vágómaszk — a fotó a forma alakjában; telefon = szerver, ellenpróba vágás nélkül */
export async function smokeClipMask(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const surface = Skia.Surface.MakeOffscreen(400, 400)!;
  const paint = Skia.Paint();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    paint.setColor(Skia.Color(`hsl(${(i * 45 + j * 20) % 360}, 75%, 55%)`));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 50, j * 50, 50, 50), paint);
  }
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_clip_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) {
      const u = pixel(p, Math.floor(((j + 0.5) / 80) * p.width()), Math.floor(((i + 0.5) / 80) * p.height()));
      const w = pixel(q, Math.floor(((j + 0.5) / 80) * q.width()), Math.floor(((i + 0.5) / 80) * q.height()));
      sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
      n += 1;
    }
    return sum / n;
  };
  const bg = { id: 'bg', kind: 'fill', fill: '#101018' };
  const photo = (extra: Record<string, unknown> = {}) => ({ id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 0.9, h: 0.9, fit: 'stretch', clipTo: 's', ...extra });
  const doc = (shape: Record<string, unknown>, ph: Record<string, unknown> = photo()) => ({ id: 'cl', name: 'cl', aspectRatio: '1:1', width: 400, height: 400, layers: [bg, { id: 's', kind: 'shape', fill: '#ffffff', position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, ...shape }, ph] }) as unknown as ImageDoc;
  const CASES: [string, ImageDoc][] = [
    ['ellipszis', doc({ shape: 'ellipse' })],
    ['forgatott csillag', doc({ shape: 'star', starPoints: 5, rotation: 20 })],
    ['lekerekített téglalap', doc({ shape: 'rectangle', w: 0.7, h: 0.45, cornerRadius: 0.3 })],
    ['görbe (Bézier) forma', doc({ shape: 'path', closed: true, points: [{ x: 0, y: 0.5, h2: { x: 0, y: -0.2 } }, { x: 1, y: 0.3, h1: { x: 0.8, y: -0.1 } }, { x: 0.6, y: 1 }] })],
    ['saját maszkkal metszve', doc({ shape: 'ellipse' }, photo({ mask: { shape: 'rectangle', x: 0.35, y: 0.5, w: 0.5, h: 1, feather: 0 } }))],
  ];
  for (const [name, d] of CASES) {
    const dev = await ref.current!.render(d, 400);
    const srv = await renderImageDoc(d, 400);
    const open = await ref.current!.render({ ...d, layers: d.layers.map((l) => (l.id === 'p' ? { ...l, clipTo: undefined, mask: undefined } : l)) } as ImageDoc, 400);
    if (!dev || !srv || !open) {
      log(false, name, 'nincs kép');
      continue;
    }
    const a = await decode(dev);
    const diff = meanDiff(a, await decode(srv));
    const ctl = meanDiff(a, await decode(open));
    // a sarok mindig kívül esik: ott a háttér látszik, nem a fotó
    const corner = pixel(a, 30, 30);
    log(diff <= 6 && ctl > diff * 2 && corner[0] < 40 && corner[1] < 40, `${name} — telefon = szerver`, `${diff.toFixed(2)} · ellenpróba (vágás nélkül) ${ctl.toFixed(2)} /255 · sarok ${corner.slice(0, 3).join(',')}`);
    [dev, srv, open].forEach((u) => removeFile(u));
  }
  setHarness(null);
  removeFile(f.uri);
}
/** 📐 S18: kiegyenesítés — telefon = szerver, a doboz sarkában nincs üres rész */
export async function smokeStraighten(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const surface = Skia.Surface.MakeOffscreen(480, 360)!;
  const paint = Skia.Paint();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) {
    paint.setColor(Skia.Color(`hsl(${(i * 40 + j * 25) % 360}, 70%, ${35 + j * 6}%)`));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 60, j * 60, 60, 60), paint);
  }
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_straight_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) {
      const u = pixel(p, Math.floor(((j + 0.5) / 80) * p.width()), Math.floor(((i + 0.5) / 80) * p.height()));
      const w = pixel(q, Math.floor(((j + 0.5) / 80) * q.width()), Math.floor(((i + 0.5) / 80) * q.height()));
      sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
      n += 1;
    }
    return sum / n;
  };
  // a fotó a vászon közepén 0,8×0,8-as dobozban, rózsaszín háttér előtt: az üres sarok rózsaszín lenne
  const doc = (extra: Record<string, unknown>) => ({ id: 'st', name: 'st', aspectRatio: '4:3', width: 480, height: 360, layers: [{ id: 'bg', kind: 'fill', fill: '#ff00ff' }, { id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, fit: 'stretch', ...extra }] }) as unknown as ImageDoc;
  const plain = await ref.current!.render(doc({}), 360);
  for (const deg of [3, -12, 30]) {
    for (const [name, extra] of [['', {}], [' + korrekció és maszk', { adjust: { saturation: 0.4 }, mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.7, h: 0.7, feather: 0 } }]] as const) {
      if (name && deg !== -12) continue;
      const d = doc({ straighten: deg, ...extra });
      const dev = await ref.current!.render(d, 360);
      const srv = await renderImageDoc(d, 360);
      if (!dev || !srv || !plain) {
        log(false, `${deg}°${name}`, 'nincs kép');
        continue;
      }
      const a = await decode(dev);
      const b = await decode(srv);
      const diff = meanDiff(a, b);
      const ctl = meanDiff(a, await decode(plain));
      // a doboz sarkai közvetlenül belül (2 px): nem lehet rózsaszín
      const box = { x0: 48 + 2, y0: 36 + 2, x1: 432 - 3, y1: 324 - 3 };
      const pink = (img: SkImage) => [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].filter(([x, y]) => {
        const p = pixel(img, x, y);
        return p[0] > 200 && p[1] < 60 && p[2] > 200;
      }).length;
      const corners = name ? 0 : pink(a) + pink(b);
      log(diff <= 6 && ctl > diff * 2 && corners === 0, `${deg}°${name} — telefon = szerver, üres sarok nélkül`, `${diff.toFixed(2)} · ellenpróba (egyenesen) ${ctl.toFixed(2)} /255 · rózsaszín sarok ${corners}`);
      [dev, srv].forEach((u) => removeFile(u));
    }
  }
  if (plain) removeFile(plain);
  setHarness(null);
  removeFile(f.uri);
}
/** 🔲 S18: 4-sarkos perspektíva — telefon = szerver, a négyszögön kívül a háttér */
export async function smokeCornerPin(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const surface = Skia.Surface.MakeOffscreen(480, 360)!;
  const paint = Skia.Paint();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) {
    paint.setColor(Skia.Color(`hsl(${(i * 40 + j * 25) % 360}, 70%, ${35 + j * 6}%)`));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 60, j * 60, 60, 60), paint);
  }
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_pin_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 80; i++) for (let j = 0; j < 80; j++) {
      const u = pixel(p, Math.floor(((j + 0.5) / 80) * p.width()), Math.floor(((i + 0.5) / 80) * p.height()));
      const w = pixel(q, Math.floor(((j + 0.5) / 80) * q.width()), Math.floor(((i + 0.5) / 80) * q.height()));
      sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
      n += 1;
    }
    return sum / n;
  };
  const doc = (extra: Record<string, unknown>) => ({ id: 'pin', name: 'pin', aspectRatio: '4:3', width: 480, height: 360, layers: [{ id: 'bg', kind: 'fill', fill: '#ff00ff' }, { id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, fit: 'stretch', ...extra }] }) as unknown as ImageDoc;
  const plain = await ref.current!.render(doc({}), 360);
  const CASES: [string, Record<string, unknown>][] = [
    ['plakát a falon', { corners: [{ x: 0.15, y: 0.05 }, { x: 0.95, y: 0.2 }, { x: 0.9, y: 0.85 }, { x: 0.1, y: 0.95 }] }],
    ['trapéz (felül keskeny)', { corners: [{ x: 0.25, y: 0 }, { x: 0.75, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }],
    ['forgatott réteggel', { rotation: 15, corners: [{ x: 0, y: 0.1 }, { x: 1, y: 0 }, { x: 0.8, y: 1 }, { x: 0.1, y: 0.9 }] }],
  ];
  for (const [name, extra] of CASES) {
    const d = doc(extra);
    const dev = await ref.current!.render(d, 360);
    const srv = await renderImageDoc(d, 360);
    if (!dev || !srv || !plain) {
      log(false, name, 'nincs kép');
      continue;
    }
    const a = await decode(dev);
    const diff = meanDiff(a, await decode(srv));
    const ctl = meanDiff(a, await decode(plain));
    log(diff <= 6 && ctl > diff * 2, `${name} — telefon = szerver`, `${diff.toFixed(2)} · ellenpróba (torzítás nélkül) ${ctl.toFixed(2)} /255`);
    [dev, srv].forEach((u) => removeFile(u));
  }
  // a „trapéz” esetben a doboz bal felső sarka (a négyszögön kívül) a háttér
  const t = doc(CASES[1][1]);
  const dev = await ref.current!.render(t, 360);
  if (dev) {
    const p = pixel(await decode(dev), 48 + 8, 36 + 8);
    log(p[0] > 200 && p[1] < 60 && p[2] > 200, 'a négyszögön kívül a háttér látszik', `${p.slice(0, 3).join(',')}`);
    removeFile(dev);
  }
  if (plain) removeFile(plain);
  setHarness(null);
  removeFile(f.uri);
}
/** 🖼️ S5: kép-klip a natív iOS-motorban — a videó felhő nélkül készül, a kocka = a kép (cover, tájolás) */
export async function smokeStillRender(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // 1200×800-as kép: felső fele piros, alsó kék, a jobb szélén zöld csík (a cover-vágás ezt levágja 9:16-ban)
  const surf = Skia.Surface.MakeOffscreen(1200, 800)!;
  const p = Skia.Paint();
  const rect = (col: string, x: number, y: number, w: number, h: number) => {
    p.setColor(Skia.Color(col));
    surf.getCanvas().drawRect(Skia.XYWHRect(x, y, w, h), p);
  };
  rect('#e02020', 0, 0, 1200, 400);
  rect('#2040e0', 0, 400, 1200, 400);
  rect('#20c040', 1100, 0, 100, 800);
  surf.flush();
  const img = new File(projectMediaDir(), `smoke_still_${Date.now().toString(36)}.png`);
  img.write(surf.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const base = createEmptyProject('smoke still', '16:9');
  const clip = (id: string, start: number, duration: number) => ({ kind: 'image', id, start, duration, uri: img.uri, filterId: 'none' });
  const settings = { resolution: 720, fps: 30, quality: 'high', codec: 'h264' } as const;
  for (const [name, aspect, clips] of [
    ['csak kép (16:9)', '16:9', [clip('a', 0, 3)]],
    ['két kép egymás után (9:16, cover-vágás)', '9:16', [clip('a', 0, 2), clip('b', 2, 2)]],
  ] as const) {
    const project = { ...base, aspectRatio: aspect, tracks: [{ id: 'tv', type: 'video', name: 'V', clips }] } as unknown as Project;
    const local = canRenderLocally(project, settings as never);
    log(local, `${name}: a telefon rendereli (nem kell felhő)`, `canRenderLocally ${local}`);
    if (!local) continue;
    const t0 = Date.now();
    let out: File | null = null;
    try {
      out = await renderLocal(project, settings as never);
    } catch (caught) {
      log(false, `${name}: render`, (caught as Error).message);
      continue;
    }
    const ms = Date.now() - t0;
    const total = clips.reduce((n, c) => Math.max(n, c.start + c.duration), 0);
    const frame = async (sec: number) => decode((await StillThumbs.getThumbnailAsync(out!.uri, { time: Math.round(sec * 1000) })).uri);
    const mid = await frame(total / 2);
    const [W, H] = [mid.width(), mid.height()];
    const top = pixel(mid, Math.round(W / 2), Math.round(H * 0.2));
    const bottom = pixel(mid, Math.round(W / 2), Math.round(H * 0.8));
    const right = pixel(mid, W - 3, Math.round(H / 2));
    const upright = top[0] > 180 && top[2] < 80 && bottom[2] > 180 && bottom[0] < 80;
    // 16:9-ben a zöld csík a kép jobb szélén látszik; 9:16-os cover-vágásnál kimarad (középre vágva)
    const greenSeen = right[1] > 150 && right[0] < 100;
    const coverOk = aspect === '16:9' ? greenSeen : !greenSeen;
    log(upright && coverOk && W > H === (aspect === '16:9'), `${name}: a kocka a kép — fejjel felfelé, cover-kitöltéssel`, `${W}×${H}, fent ${top.slice(0, 3).join(',')}, lent ${bottom.slice(0, 3).join(',')}, jobb szél ${right.slice(0, 3).join(',')}, ${ms} ms`);
    // a vége előtt is kép van (a hossz nem rövidül)
    const late = await frame(total - 0.2);
    const lateTop = pixel(late, Math.round(late.width() / 2), Math.round(late.height() * 0.2));
    log(lateTop[0] > 180, `${name}: a videó végéig tart (${total} s)`, `a ${(total - 0.2).toFixed(1)} s-os kocka fent ${lateTop.slice(0, 3).join(',')}`);
    removeFile(out.uri);
  }
  removeFile(img.uri);
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
/** 📣 S22: gyors kép csak névvel (SEO nélkül) a valódi létrehozási úton; a SEO a megosztáskor kérődik be */
export async function smokeQuickCreate(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const name = 'smoke gyors kép';
  let createdId: string | null = null;
  try {
    router.replace('/studio' as Href);
    await sleep(1500);
    runDevAction('studio.fillCreate', { name, kind: 'image', noSeo: true });
    await sleep(400);
    await runDevAction('studio.create');
    for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
    await sleep(800);
    const p = st().project;
    createdId = p?.name === name ? p.id : null;
    log(!!p && p.name === name && p.kind === 'image' && !p.seo?.description, 'csak névvel létrejön a kép-projekt, és a Kép Stúdióban nyílik (SEO nélkül)', p ? `${p.kind}, SEO-leírás: „${p.seo?.description ?? ''}”` : 'nincs projekt');
    if (!p) return;
    // 👋 üres lapon a vezetés (fotó / szöveg / sablon) látszik
    const firstDoc = Object.values(p.imageDocs ?? {})[0];
    log(!!firstDoc && docIsEmpty(firstDoc), 'üres lapon egy mondatos vezetés jelenik meg', `${firstDoc?.layers.length ?? 0} réteg`);
    log(true, 'FOTÓZHATÓ', 'üres lap vezetéssel');
    await sleep(6000);
    // a megosztás kapuja: a lap feljön (képernyőkép), megszakítva nem enged tovább
    const pending = useSeoGate.getState().ensureSeo(p);
    await sleep(800);
    log(useSeoGate.getState().request?.project.id === p.id, 'megosztáskor a SEO-lap bekéri a hiányzó mezőket', 'a lap nyitva');
    log(true, 'FOTÓZHATÓ', 'a SEO-lap a Kép Stúdió fölött');
    await sleep(6000);
    useSeoGate.getState().finish(null);
    log((await pending) === null, 'megszakítva: nincs megosztás');
    // kitöltve: továbbenged, és a projekt megkapja (parancsként, visszavonhatóan)
    const seo = { title: name, description: 'gyors teszt', hashtags: ['remix'], keywords: ['teszt'] };
    st().dispatch({ type: 'SET_PROJECT_SEO', seo }, 'user');
    const passed = await useSeoGate.getState().ensureSeo(st().project!);
    log(passed?.seo?.description === 'gyors teszt', 'kitöltött SEO-val a kapu azonnal továbbenged', `${passed?.seo?.hashtags.join(' ')}`);
  } finally {
    useSeoGate.getState().finish(null);
    router.replace('/studio' as Href);
    await sleep(500);
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name === name).map((m) => m.id);
    for (const id of new Set([...(createdId ? [createdId] : []), ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:quickcreate-del', caught));
      await deleteCloudProject(id);
    }
  }
}
/**
 * 🔤 VIDEO-PROD E2: szöveg a telefonos videó-exportban iOS-en. A valódi motor renderel; a kész videó kockáin mérve:
 * nyugalomban a szöveg = az előnézet raszterje a háttér fölött (hely, méret, fejjel felfelé), a fade félúton félig
 * átlátszó, a slide lentebbről indul, a klip előtt és után nincs szöveg.
 */
export async function smokeTextOverlay(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const BG = [24, 40, 120];
  const surf = Skia.Surface.MakeOffscreen(1080, 1920)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(`rgb(${BG.join(',')})`));
  surf.getCanvas().drawRect(Skia.XYWHRect(0, 0, 1080, 1920), paint);
  surf.flush();
  const bg = new File(projectMediaDir(), `smoke_textov_${Date.now().toString(36)}.png`);
  bg.write(surf.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const base = createEmptyProject('smoke text overlay', '9:16', undefined, 'video');
  const txt = (id: string, text: string, y: number, animation: string) => ({ kind: 'text', id, start: 0.5, duration: 2, text, color: '#ffffff', backgroundColor: null, fontSize: 14, fontWeight: 'bold', position: { x: 0.5, y }, animation });
  const project = {
    ...base,
    tracks: base.tracks.map((t) =>
      t.type === 'video' ? { ...t, clips: [{ kind: 'image', id: 'bgimg', start: 0, duration: 3, uri: bg.uri, filterId: 'none' }] }
        : t.type === 'text' ? { ...t, clips: [txt('tfade', 'FADE', 0.25, 'fade'), txt('tpop', 'POP', 0.5, 'pop'), txt('tslide', 'SLIDE', 0.75, 'slide')] }
          : t),
  } as unknown as Project;
  const settings = { resolution: 720, fps: 30, quality: 'high', codec: 'h264' } as const;
  await saveProject(project);
  const s = () => useEditorStore.getState();
  let out: File | null = null;
  try {
    router.push(`/editor/${project.id}` as Href);
    for (let i = 0; i < 40 && s().project?.id !== project.id; i++) await sleep(200);
    await sleep(1500);
    // a mentés a projekten kívüli médiát a projekt mappájába költözteti → a betöltött projekt a mérvadó
    const live = s().project ?? project;
    const gaps = deviceRenderGaps(live);
    const local = canRenderLocally(live, settings as never);
    log(gaps.length === 0 && local, 'a feliratos videó a telefonon renderelhető (nincs felhő-rés)', `rések: ${gaps.join(',') || '—'}, helyi: ${local}`);
    if (!local) return;
    const t0 = Date.now();
    out = await renderLocal(live, settings as never);
    log(true, 'render a telefonon', `${Date.now() - t0} ms`);
    // az előnézet raszterje (ugyanaz az út, amit a motor kap) — a referencia
    const plan = buildRenderPlan(live, settings as never);
    const pr = PixelRatio.get();
    const pngs = await rasterTextOverlays({ project: live, width: plan.width / pr, height: plan.height / pr, clipIds: ['tfade', 'tpop', 'tslide'] });
    const ref = await Promise.all(['tfade', 'tpop', 'tslide'].map((id) => decode(pngs.get(id)!)));
    const rgba = (img: SkImage) => ({ w: img.width(), h: img.height(), d: img.readPixels(0, 0, { width: img.width(), height: img.height(), colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul })! });
    const frame = async (sec: number) => rgba(await decode((await StillThumbs.getThumbnailAsync(out!.uri, { time: Math.round(sec * 1000) })).uri));
    const refs = ref.map(rgba);
    // a várt kép (nyugalomban): a két raszter a háttér fölött
    const expected = (fx: number, fy: number) => {
      let c = [...BG];
      for (const r of refs) {
        const x = Math.min(r.w - 1, Math.floor(fx * r.w));
        const y = Math.min(r.h - 1, Math.floor(fy * r.h));
        const i = (y * r.w + x) * 4;
        const a = r.d[i + 3] / 255;
        c = [0, 1, 2].map((k) => c[k] * (1 - a) + r.d[i + k] * a);
      }
      return c;
    };
    const at = (f: { w: number; h: number; d: Uint8Array | Float32Array }, fx: number, fy: number) => {
      const i = (Math.min(f.h - 1, Math.floor(fy * f.h)) * f.w + Math.min(f.w - 1, Math.floor(fx * f.w))) * 4;
      return [f.d[i], f.d[i + 1], f.d[i + 2]];
    };
    const lum = (c: number[]) => (c[0] + c[1] + c[2]) / 3;
    // 1) nyugalomban = előnézet (200×200 pont)
    const rest = await frame(1.6);
    let sum = 0;
    let sumBg = 0;
    let n = 0;
    let textPts = 0;
    for (let i = 0; i < 200; i++) for (let j = 0; j < 200; j++) {
      const fx = (j + 0.5) / 200;
      const fy = (i + 0.5) / 200;
      const e = expected(fx, fy);
      const g = at(rest, fx, fy);
      sum += (Math.abs(e[0] - g[0]) + Math.abs(e[1] - g[1]) + Math.abs(e[2] - g[2])) / 3;
      sumBg += (Math.abs(BG[0] - g[0]) + Math.abs(BG[1] - g[1]) + Math.abs(BG[2] - g[2])) / 3;
      n += 1;
      if (lum(e) > 200) textPts += 1;
    }
    const restDiff = sum / n;
    // ellenpróba: ugyanez szöveg nélküli referenciával — a mérőszám érzékeny-e a szöveg hiányára / helyére
    const bgDiff = sumBg / n;
    log(restDiff <= 8 && textPts > 100 && bgDiff > restDiff * 2, 'nyugalomban a szöveg = az előnézet raszterje (hely, méret, fejjel felfelé)', `átlag ${restDiff.toFixed(2)}/255 · ellenpróba szöveg nélkül ${bgDiff.toFixed(2)} · szöveg-pont ${textPts}`);
    // 2) a klip előtt és után nincs szöveg
    const bright = (f: { w: number; h: number; d: Uint8Array | Float32Array }) => {
      let b = 0;
      for (let i = 0; i < 120; i++) for (let j = 0; j < 120; j++) if (lum(at(f, (j + 0.5) / 120, (i + 0.5) / 120)) > 180) b += 1;
      return b;
    };
    const before = bright(await frame(0.25));
    const after = bright(await frame(2.8));
    log(before === 0 && after === 0 && bright(rest) > 50, 'a szöveg csak a klip idején látszik', `előtte ${before}, közben ${bright(rest)}, utána ${after} világos pont`);
    // 3) fade: 0,2 s-nál (a 0,4 s-os belépő fele) félig átlátszó — a felső sáv (FADE) szöveg-pontjain mérve
    const half = await frame(0.7);
    let ratioSum = 0;
    let ratioN = 0;
    for (let i = 0; i < 200; i++) for (let j = 0; j < 200; j++) {
      const fx = (j + 0.5) / 200;
      const fy = (i + 0.5) / 200;
      if (fy > 0.38) continue;
      const e = expected(fx, fy);
      if (lum(e) < 220) continue;
      ratioSum += (lum(at(half, fx, fy)) - lum(BG)) / (lum(e) - lum(BG));
      ratioN += 1;
    }
    const ratio = ratioN ? ratioSum / ratioN : 0;
    log(ratio > 0.3 && ratio < 0.7, 'fade: félúton félig átlátszó (mint az előnézetben)', `átlátszóság ≈ ${ratio.toFixed(2)} (várt ~0,5), ${ratioN} pont`);
    // 4) slide: a SLIDE sáv tinta-teteje 0,2 s-nál lejjebb van, mint nyugalomban
    const inkTop = (f: { w: number; h: number; d: Uint8Array | Float32Array }) => {
      for (let y = Math.floor(f.h * 0.62); y < f.h; y++) {
        for (let x = 0; x < f.w; x += 2) {
          const i = (y * f.w + x) * 4;
          if ((f.d[i] + f.d[i + 1] + f.d[i + 2]) / 3 > 120) return y;
        }
      }
      return -1;
    };
    const shift = inkTop(half) - inkTop(rest);
    const expShift = 0.5 * (30 / (plan.height / pr)) * rest.h;
    log(shift > 0 && Math.abs(shift - expShift) <= 4, 'slide: lentebbről úszik be (az előnézet amplitúdójával)', `eltolás ${shift} px, várt ≈ ${expShift.toFixed(1)} px`);
    // 5) pop: 0,15 s-nál (p = 0,5) a skála 1,2·0,5·1,5 = 0,9 — a POP sáv tinta-szélessége a nyugalmihoz mérve
    const inkWidth = (f: { w: number; h: number; d: Uint8Array | Float32Array }) => {
      let l = f.w;
      let r = -1;
      for (let y = Math.floor(f.h * 0.44); y < Math.floor(f.h * 0.56); y++) {
        for (let x = 0; x < f.w; x++) {
          const i = (y * f.w + x) * 4;
          if ((f.d[i] + f.d[i + 1] + f.d[i + 2]) / 3 > 140) {
            l = Math.min(l, x);
            r = Math.max(r, x);
          }
        }
      }
      return r >= l ? r - l : 0;
    };
    // pontos képkocka-időn mérünk (30 fps: a 20. kocka = 0,667 s → a klipben 0,167 s), a várt érték a képletből
    const popT = 20 / 30 - 0.5;
    const popP = Math.min(1, popT / 0.3);
    const popExp = 1.2 * popP * (2 - popP);
    const popRatio = inkWidth(await frame(20 / 30)) / Math.max(1, inkWidth(rest));
    log(Math.abs(popRatio - popExp) <= 0.03, 'pop: rugós belépő a képlet szerint (mint az előnézetben)', `szélesség-arány ${popRatio.toFixed(3)} (várt ${popExp.toFixed(3)} a ${popT.toFixed(3)} s-os kockán)`);
    log(true, 'FOTÓZHATÓ', 'feliratos videó-szerkesztő');
    await sleep(3000);
  } catch (caught) {
    log(false, 'textoverlay', (caught as Error).message);
  } finally {
    router.back();
    await sleep(1200);
    if (out) removeFile(out.uri);
    removeFile(bg.uri);
    await deleteProject(project.id).catch((caught) => logCaught('lib/imageSmoke.tsx:textoverlay-del', caught));
  }
}
/** 🚪 VIDEO-PROD E1: a felhőt kérő telefonos export nem zsákutca — néven mondja az okot, Free-ben a Pro-ajánlatot nyitja */
export async function smokeExportFree(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let n = 0;
  const base = addImageDocToVideo(createEmptyProject('smoke export free', '9:16', undefined, 'video'), createImageDoc('t', '9:16', () => `ef${++n}`), 'file:///smoke.png');
  // a félig átlátszó kép-klip ma is felhőt kér (a szöveg iOS-en már a telefonon megy, VIDEO-PROD E2)
  const project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: t.clips.map((c) => ({ ...c, opacity: 0.5 })) } : t)) } as unknown as Project;
  await saveProject(project);
  const ent = useEntitlement.getState();
  const prev = { tier: ent.tier, proUntil: ent.proUntil, devPro: ent.devPro };
  const origAlert = Alert.alert;
  type Seen = { title: string; msg: string; buttons: { text?: string; onPress?: () => void }[] };
  const box: { seen: Seen | null } = { seen: null };
  Alert.alert = ((title: string, msg?: string, buttons?: { text?: string; onPress?: () => void }[]) => {
    box.seen = { title, msg: msg ?? '', buttons: buttons ?? [] };
  }) as typeof Alert.alert;
  const s = () => useEditorStore.getState();
  const runExport = async (): Promise<Seen | null> => {
    box.seen = null;
    void runDevAction('video.exportLocal');
    for (let i = 0; i < 40 && !box.seen; i++) await sleep(100);
    return box.seen;
  };
  try {
    router.push(`/editor/${project.id}` as Href);
    for (let i = 0; i < 40 && s().project?.id !== project.id; i++) await sleep(200);
    await sleep(1500);
    s().setPanel('export');
    await sleep(1500);
    // Free: a választó néven mondja, mi kéri a felhőt, és a Pro-ajánlatot kínálja
    useEntitlement.setState({ tier: 'free', proUntil: null, devPro: false });
    const free = await runExport();
    const labels = free?.buttons.map((b) => b.text) ?? [];
    log(!!free && free.title === i18nT('panels.export.parityTitle'), 'Free: a felhőt kérő export választót ad (nem nyers hibát)', free?.title ?? 'nincs ablak');
    log(!!free && free.msg.includes(i18nT('panels.export.gap.opacity')), 'az ok néven: „átlátszóság”', (free?.msg ?? '').split('\n').filter((l) => l.startsWith('• ')).join(' '));
    log(labels.includes(i18nT('panels.export.parityProCta')) && !labels.includes(i18nT('panels.export.parityCloudCta')), 'Free-ben a gomb a Pro-ajánlat (nem egy bukó felhő-render)', labels.join(' · '));
    usePaywall.getState().close();
    free?.buttons.find((b) => b.text === i18nT('panels.export.parityProCta'))?.onPress?.();
    await sleep(800);
    const pw = usePaywall.getState();
    log(pw.visible && pw.capability === 'cloudRender', 'a Pro gomb a Pro-ajánlatot nyitja (felhő-render)', `látható: ${pw.visible}, ok: ${pw.capability}`);
    log(true, 'FOTÓZHATÓ', 'Pro-ajánlat a felhő-renderhez');
    await sleep(5000);
    usePaywall.getState().close();
    // Pro: ugyanott a felhő-render a választás
    useEntitlement.setState({ devPro: true });
    const pro = await runExport();
    const proLabels = pro?.buttons.map((b) => b.text) ?? [];
    log(proLabels.includes(i18nT('panels.export.parityCloudCta')), 'Pro-ban a gomb a felhő-render', proLabels.join(' · '));
    pro?.buttons.find((b) => b.text === i18nT('common.cancel'))?.onPress?.();
  } finally {
    Alert.alert = origAlert;
    useEntitlement.setState(prev);
    usePaywall.getState().close();
    s().setPanel(null);
    router.back();
    await sleep(1200);
    await deleteProject(project.id).catch((caught) => logCaught('lib/imageSmoke.tsx:exportfree-del', caught));
  }
}
/** ✂️🔤 S18: vágás szövegbe — a fotó a betűk alakjában; telefon = szerver; a szöveg átírására a vágás követ */
export async function smokeClipText(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const surface = Skia.Surface.MakeOffscreen(400, 400)!;
  const paint = Skia.Paint();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    paint.setColor(Skia.Color(`hsl(${(i * 45 + j * 20) % 360}, 80%, 55%)`));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 50, j * 50, 50, 50), paint);
  }
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_cliptext_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
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
  // a „színes” képpontok aránya (a háttér sötétkék, a szöveg alatta fehér — a fotó csak a betűkben látszik)
  const colorful = (img: SkImage) => {
    let n = 0;
    let c = 0;
    for (let y = 0; y < img.height(); y += 4) for (let x = 0; x < img.width(); x += 4) {
      const p = pixel(img, x, y);
      const spread = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
      if (spread > 90) c += 1;
      n += 1;
    }
    return c / n;
  };
  const docOf = (txt: string, clip = true) => ({ id: 'ct', name: 'ct', aspectRatio: '1:1', width: 400, height: 400, layers: [
    { id: 'bg', kind: 'fill', fill: '#101828' },
    { id: 't', kind: 'text', text: txt, position: { x: 0.5, y: 0.5 }, fontSize: 30, color: '#ffffff', fontFamily: 'Anton', textAlign: 'center', backgroundColor: null, stylePreset: 'plain' },
    { id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...(clip ? { clipTo: 't' } : {}) },
  ] }) as unknown as ImageDoc;
  const d = docOf('REMIX');
  const dev = await ref.current!.render(d, 400);
  const srv = await renderImageDoc(d, 400);
  const open = await ref.current!.render(docOf('REMIX', false), 400);
  if (!dev || !srv || !open) {
    log(false, 'vágás szövegbe', 'nincs kép');
  } else {
    const [a, b, c] = [await decode(dev), await decode(srv), await decode(open)];
    const diff = meanDiff(a, b);
    const [ca, cb, cc] = [colorful(a), colorful(b), colorful(c)];
    log(diff <= 6 && ca > 0.05 && ca < 0.6 && cc > 0.9, 'a fotó a betűk alakjában — telefon = szerver', `${diff.toFixed(2)}/255 · színes rész telefon ${(ca * 100).toFixed(0)}%, szerver ${(cb * 100).toFixed(0)}%, vágás nélkül ${(cc * 100).toFixed(0)}%`);
    [dev, srv, open].forEach((u) => removeFile(u));
  }
  // élő kapcsolat: más szöveg → új maszk → más vágás
  const d2 = docOf('I');
  const dev2 = await ref.current!.render(d2, 400);
  if (dev2) {
    const c2 = colorful(await decode(dev2));
    log(c2 > 0.005 && c2 < 0.15, 'a szöveg átírására a vágás követ (új maszk)', `színes rész az „I” betűben ${(c2 * 100).toFixed(1)}%`);
    removeFile(dev2);
  }
  setHarness(null);
  removeFile(f.uri);
}
export async function smokeAudioTemplate(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const created: string[] = [];
  try {
    for (const tpl of ['music', 'podcast'] as const) {
      router.replace('/studio' as Href);
      await sleep(1500);
      const name = `smoke sablon ${tpl}`;
      runDevAction('studio.fillCreate', { name, kind: 'audio', audioTemplate: tpl });
      await sleep(400);
      await runDevAction('studio.create');
      for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
      await sleep(800);
      const p = st().project;
      if (p?.name === name) created.push(p.id);
      if (tpl === 'music') {
        log(p?.kind === 'audio' && p.bpm === 120 && p.timeSignature?.beatsPerBar === 4 && p.markers?.length === 4 && p.audioMaster?.target === 'music', 'zene-sablon: 120 BPM 4/4, 4 szerkezeti jelölő, zenei hangosság — a Hang Stúdióban nyílik', p ? `${p.bpm} BPM, jelölők: ${(p.markers ?? []).map((m) => `${m.label}@${m.time}`).join(', ')}` : 'nincs projekt');
        log(true, 'FOTÓZHATÓ', 'a zene-sablonból nyílt Hang Stúdió a jelölőkkel');
        await sleep(2000);
      } else {
        const voice = p?.tracks.find((t) => t.type === 'voiceover');
        log(p?.audioMaster?.target === 'podcast' && p.audioMaster.duckTrigger === 'voiceover' && !!voice?.name, 'podcast-sablon: podcast-hangosság, a beszéd a halkítás kulcsa, a sávok elnevezve', p ? `${p.audioMaster?.target}, kulcs ${p.audioMaster?.duckTrigger}, beszéd-sáv „${voice?.name}”` : 'nincs projekt');
      }
    }
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    // a létrehozás a felhőbe is ment (a dev a prodra mutat): a helyi ÉS a felhős tesztadat is törlődik,
    // a korábbi futások név szerinti maradékai is
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke sablon ')).map((m) => m.id);
    for (const id of new Set([...created, ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tpl-del', caught));
      await deleteCloudProject(id);
    }
    const remain = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke sablon ')).length;
    log(remain === 0, 'takarítás: a teszt-projektek a felhőből is törölve', `${new Set([...created, ...leftovers]).size} törölve, maradt ${remain}`);
  }
}
/**
 * 🎵 S10 (MU0): a „+ Új projekt → Zene" a VALÓDI létrehozási úton egy kész ütemrácsos projektet nyit a Hang
 * Stúdió Zene munkaterületén (a `music` fajta útvonala → `?ws=music`), a hangszerek elöl; offline.
 */
export async function smokeMusicWorkspace(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const name = 'smoke zene munkaterület';
  let createdId: string | null = null;
  try {
    router.replace('/studio' as Href);
    await sleep(1500);
    runDevAction('studio.fillCreate', { name, kind: 'music' });
    await sleep(400);
    await runDevAction('studio.create');
    for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
    await sleep(1200);
    const p = st().project;
    createdId = p?.name === name ? p.id : null;
    log(p?.kind === 'music' && p.bpm === 120 && p.timeSignature?.beatsPerBar === 4 && (p.markers?.length ?? 0) === 4 && p.audioMaster?.target === 'music', '„Zene" projekt: a fajta music, a Zene-sablon alkalmazva (120 BPM, 4/4, 4 jelölő, zenei hangosság)', p ? `${p.kind}, ${p.bpm} BPM, ${p.markers?.length} jelölő, cél ${p.audioMaster?.target}` : 'nincs projekt');
    const ws = runDevAction('audio.workspace');
    log(ws === 'music', 'a music útvonal a Hang Stúdiót nyitja a Zene munkaterületen (átirányítás ?ws=music)', `${ws}`);
    // a hangszerek elöl: a piano roll a munkaterület gombjáról nyílik és zárul (a lassú eszközön megvárjuk a lapot)
    runDevAction('audio.openPianoRoll');
    let notesBefore: unknown;
    for (let i = 0; i < 50 && notesBefore === undefined; i++) {
      await sleep(100);
      notesBefore = runDevAction('synth.notes');
    }
    runDevAction('audio.closePianoRoll');
    await sleep(300);
    log(notesBefore !== undefined, 'a Zene munkaterület hangszerei élnek (piano roll nyílik a mentett tempón)', notesBefore === undefined ? 'nem nyílt meg' : `${String(notesBefore).slice(0, 40) || '(üres rács)'}`);
    log(true, 'FOTÓZHATÓ', 'a Hang Stúdió Zene munkaterülete: hangszerek a transzport elején');
    await sleep(1500);
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name === name).map((m) => m.id);
    for (const id of new Set([...(createdId ? [createdId] : []), ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:musicws-del', caught));
      await deleteCloudProject(id);
    }
    const remain = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name === name).length;
    log(remain === 0, 'takarítás: a teszt-projekt a felhőből is törölve', `maradt ${remain}`);
  }
}
