/** 🧪 Füstteszt — geometria: vágómaszk, kiegyenesítés, 4-sarkos perspektíva, vágás szövegbe, keret-fogók. (Áthelyezve: phases11; viselkedés-változás nélkül.) */
import { Skia, ImageFormat, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { type ReactNode, type RefObject, createRef } from 'react';
import { Platform, Dimensions, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { type RenderStageHandle, RenderStage } from '@/components/studio/image/RenderStage';
import { renderImageDoc } from '@/lib/imageDocClient';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { pixel, decode, removeFile } from '../../helpers/image';
import '@/lib/dspNativeClient';

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
