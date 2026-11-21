/** 🧪 Füstteszt — kijelölés: alap, színtartomány, szöveg/forma, él-finomítás, háttér-eltávolítás. (Áthelyezve: phases02, phases10; viselkedés-változás nélkül.) */
import { Skia, ImageFormat, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { type ReactNode, type RefObject, createRef } from 'react';
import { View, Platform, Dimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { renderStrokes } from '@/components/studio/image/BrushOverlay';
import { Asset } from 'expo-asset';
import { projectMaskToCanvas } from '@/components/studio/image/projectMask';
import { foregroundMask } from '@/lib/foregroundMask';
import { renderImageDoc } from '@/lib/imageDocClient';
import { SelectionAnts } from '@/components/studio/image/SelectionAnts';
import { updateLayer } from '@/lib/imageDoc';
import { deleteSelection, maskFromSelection, copySelectionToLayer, adjustSelection, rasterSubForSelection, replaceWithSelectionRaster } from '@/lib/imageSelectionOps';
import { applyRing, ellipseRing, rectRing, invertSelection, type Selection as ImgSelection, selectionContains } from '@/lib/selection';
import type { Stroke } from '@/lib/brushEngine';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { ImageLayer, PhotoLayer, ImageDoc } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { decode, meanDiff, pixel, removeFile } from '../../helpers/image';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { renderOnDevice } from '@/lib/renderStageRegistry';
import { type RenderStageHandle, RenderStage } from '@/components/studio/image/RenderStage';
import { colorRangeSelect, magicWandSelect, refineSelectionToEdges } from '@/lib/magicWandClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import '@/lib/dspNativeClient';

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
/** A háttér-eltávolítás a valódi Vision-úton; a kép a csomagolt logó, a téma közepe ismert. */
export async function smokeBgRemove(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const asset = await Asset.fromModule(require('../../../../../assets/images/icon.png')).downloadAsync();
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
/** 🎯 S17: színtartomány-kijelölés a valódi fotón (Skia-olvasás) → maszk; telefon = szerver, ellenpróba a pálcával */
export async function smokeColorRange(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  // kék alapon két külön piros folt; a nagyobbikban kék lyuk, a lyukban piros sziget
  const surface = Skia.Surface.MakeOffscreen(400, 400)!;
  const c = surface.getCanvas();
  const paint = Skia.Paint();
  const rect = (col: string, x: number, y: number, w: number, h: number) => {
    paint.setColor(Skia.Color(col));
    c.drawRect(Skia.XYWHRect(x, y, w, h), paint);
  };
  rect('#2030d0', 0, 0, 400, 400);
  rect('#d02020', 30, 30, 200, 200);
  rect('#2030d0', 80, 80, 100, 100);
  rect('#d02020', 115, 115, 30, 30);
  rect('#d02020', 280, 280, 80, 80);
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_crange_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const photo = { id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' } as unknown as PhotoLayer;
  const base = { id: 'cr', name: 'cr', aspectRatio: '1:1', width: 400, height: 400, layers: [{ id: 'bg', kind: 'fill', fill: '#000000' }, photo] } as unknown as ImageDoc;
  const t0 = Date.now();
  const rings = await colorRangeSelect(f.uri, 40 / 400, 40 / 400, 40, { boxAspect: 1, fit: 'stretch' });
  const ms = Date.now() - t0;
  log(!!rings && rings.map((r) => r.op).join(',') === 'add,subtract,add,add', 'színtartomány: két régió, egy lyuk, egy sziget', `${rings?.map((r) => r.op).join(',')} · ${ms} ms`);
  if (!rings) {
    setHarness(null);
    removeFile(f.uri);
    return;
  }
  let sel: ImgSelection | null = null;
  rings.forEach((r, i) => {
    sel = applyRing(i === 0 ? null : sel, r.points, i === 0 ? 'new' : r.op);
  });
  const masked = maskFromSelection(base, 'p', sel!)!;
  const dev = await ref.current!.render(masked, 400);
  const srv = await renderImageDoc(masked, 400);
  if (!dev || !srv) {
    log(false, 'színtartomány-maszk', 'nincs kép');
  } else {
    const [a, b] = [await decode(dev), await decode(srv)];
    // látszik: a nagy folt kerete, a sziget, a kis folt; rejtett (fekete): a lyuk és a kék alap
    const probes: [string, number, number, boolean][] = [['keret', 50, 130, true], ['sziget', 130, 130, true], ['kis folt', 320, 320, true], ['lyuk', 95, 130, false], ['alap', 260, 60, false]];
    for (const [img, who] of [[a, 'telefon'], [b, 'szerver']] as const) {
      const ok = probes.every(([, x, y, on]) => (pixel(img, x, y)[0] > 150) === on);
      log(ok, `${who}: a maszk a színtartományt mutatja`, probes.map(([n, x, y]) => `${n} ${pixel(img, x, y)[0]}`).join(' · '));
    }
  }
  // ellenpróba: az összefüggő pálca csak a koppintott foltot adja
  const wand = await magicWandSelect(f.uri, 40 / 400, 40 / 400, 40, { boxAspect: 1, fit: 'stretch' });
  const inWand = (x: number, y: number) => {
    if (!wand) return false;
    let inside = false;
    for (let i = 0, j = wand.length - 1; i < wand.length; j = i++) {
      const [p, q] = [wand[i], wand[j]];
      if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
    }
    return inside;
  };
  log(inWand(0.12, 0.3) && !inWand(0.8, 0.8), 'ellenpróba: az összefüggő pálca a kis foltot nem jelöli ki', `kis folt a pálcában: ${inWand(0.8, 0.8)}`);
  [dev, srv].forEach((u) => u && removeFile(u));
  setHarness(null);
  removeFile(f.uri);
}
/** 🔠 S17: kijelölés-művelet szövegen és formán — a telefon raszterizál, a művelet a fotón fut; telefon = szerver */
export async function smokeSelectText(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const bg = { id: 'bg', kind: 'fill', fill: '#000000' } as unknown as ImageLayer;
  const text = { id: 't', kind: 'text', name: 'Cím', text: 'MMMMMM', position: { x: 0.5, y: 0.5 }, fontSize: 16, color: '#ffffff', fontFamily: 'Anton', textAlign: 'center', backgroundColor: null, stylePreset: 'plain' } as unknown as ImageLayer;
  const shape = { id: 't', kind: 'shape', name: 'Kör', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.6, fill: '#ffffff' } as unknown as ImageLayer;
  const left = applyRing(null, rectRing({ x: 0, y: 0 }, { x: 0.5, y: 1 }), 'new', 0)!;
  // a bal és a jobb fél fehér képpontjainak aránya
  const halves = (img: SkImage) => {
    let [l, r, nl, nr] = [0, 0, 0, 0];
    for (let y = 0; y < img.height(); y += 3) for (let x = 0; x < img.width(); x += 3) {
      const on = pixel(img, x, y)[0] > 128 ? 1 : 0;
      if (x < img.width() / 2 - 4) { l += on; nl += 1; } else if (x > img.width() / 2 + 4) { r += on; nr += 1; }
    }
    return { l: l / nl, r: r / nr };
  };
  for (const [name, layer, action] of [['szöveg: a kijelölt bal fél törlése', text, 'delete'], ['forma: maszk a bal félre', shape, 'mask']] as const) {
    const doc = { id: 'st', name: 'st', aspectRatio: '1:1', width: 400, height: 400, layers: [bg, layer] } as unknown as ImageDoc;
    const raster = await ref.current!.render(rasterSubForSelection(doc, 't'), 400, { format: 'png' });
    if (!raster) {
      log(false, name, 'nincs raszter');
      continue;
    }
    const keep = new File(projectMediaDir(), `smoke_seltext_${Date.now().toString(36)}.png`);
    new File(raster).copy(keep);
    const rastered = replaceWithSelectionRaster(doc, 't', keep.uri, 'r');
    const next = action === 'delete' ? deleteSelection(rastered, 'r', left) : maskFromSelection(rastered, 'r', left);
    if (!next) {
      log(false, name, 'a művelet nem futott');
      continue;
    }
    const before = halves(await decode((await ref.current!.render(doc, 400))!));
    const dev = await ref.current!.render(next, 400);
    const srv = await renderImageDoc(next, 400);
    if (!dev || !srv) {
      log(false, name, 'nincs kép');
      continue;
    }
    const [a, b] = [halves(await decode(dev)), halves(await decode(srv))];
    const want = action === 'delete' ? (h: { l: number; r: number }) => h.l < 0.005 && h.r > 0.05 : (h: { l: number; r: number }) => h.l > 0.05 && h.r < 0.005;
    log(want(a) && want(b) && before.l > 0.05 && before.r > 0.05, `${name} — telefon és szerver`, `előtte bal ${(before.l * 100).toFixed(1)}% jobb ${(before.r * 100).toFixed(1)}% · telefon ${(a.l * 100).toFixed(1)}/${(a.r * 100).toFixed(1)}% · szerver ${(b.l * 100).toFixed(1)}/${(b.r * 100).toFixed(1)}%`);
    [raster, dev, srv, keep.uri].forEach((u) => removeFile(u));
  }
  setHarness(null);

  // a valódi stúdióban, a kezelőn át: szöveg-réteg bal felének törlése → egy visszavonási lépés
  const id = 'prj_smoke_seltext';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:seltext-del0', caught));
  const page = { id: 'pg', name: 'pg', aspectRatio: '1:1', width: 400, height: 400, layers: [bg, text] } as unknown as ImageDoc;
  await saveProject({ ...createEmptyProject('smoke kijelölés szövegen', '1:1', undefined, 'image'), id, imageDocs: [page] });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/image/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1500);
    const pastBefore = st().past.length;
    await runDevAction('image.selectionAction', { action: 'delete', ring: rectRing({ x: 0, y: 0 }, { x: 0.5, y: 1 }), targetId: 't' });
    for (let i = 0; i < 50 && st().project!.imageDocs![0].layers.some((l) => l.id === 't'); i++) await sleep(200);
    const after = st().project!.imageDocs![0];
    const photoNow = after.layers.find((l) => l.kind === 'photo') as PhotoLayer | undefined;
    const r = await renderOnDevice(after, 400);
    const h = r ? halves(await decode(r)) : { l: -1, r: -1 };
    log(!!photoNow?.mask && photoNow.name === 'Cím' && h.l < 0.005 && h.r > 0.05 && st().past.length === pastBefore + 1, 'stúdióban: a szöveg raszterizálva, a bal fele törölve, egy visszavonási lépés', `réteg ${photoNow?.kind}/${photoNow?.name}, bal ${(h.l * 100).toFixed(1)}% jobb ${(h.r * 100).toFixed(1)}%, lépés +${st().past.length - pastBefore}`);
    st().undo();
    await sleep(300);
    log(st().project!.imageDocs![0].layers.some((l) => l.id === 't' && l.kind === 'text'), 'egy visszavonás: újra szerkeszthető szöveg');
    if (r) removeFile(r);
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:seltext-del', caught));
  }
}
/** 🧲 S17: él-finomítás — a durva kijelölés a fotó valódi élére húzódik (Skia-olvasással, a stúdió kezelőjén át is) */
export async function smokeRefineEdge(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // 600×600-as fotó: világos alapon sötét kör (középpont 300,300, sugár 150)
  const surface = Skia.Surface.MakeOffscreen(600, 600)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#e0e0e0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 600, 600), paint);
  paint.setColor(Skia.Color('#303030'));
  surface.getCanvas().drawCircle(300, 300, 150, paint);
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_refine_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  // durva, túl tág, csipkés kör (0–1-ben)
  const rough = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r = (165 + (i % 2 ? 9 : -6)) / 600;
    return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) };
  });
  const iou = (poly: { x: number; y: number }[]) => {
    const sel = { ops: [{ op: 'add' as const, points: poly }], feather: 0, invert: false };
    let [i, u] = [0, 0];
    for (let y = 0; y < 1; y += 0.005) for (let x = 0; x < 1; x += 0.005) {
      const a = selectionContains(sel, { x, y });
      const b = Math.hypot(x - 0.5, y - 0.5) <= 0.25;
      if (a && b) i += 1;
      if (a || b) u += 1;
    }
    return i / u;
  };
  const t0 = Date.now();
  const out = await refineSelectionToEdges(f.uri, [rough], { boxAspect: 1, fit: 'stretch' });
  const ms = Date.now() - t0;
  const [before, after] = [iou(rough), out ? iou(out[0]) : 0];
  log(after > 0.95 && before < 0.85, 'a durva kijelölés a kör élére húzódik (metszet/unió)', `előtte ${before.toFixed(3)} → utána ${after.toFixed(3)} · ${ms} ms`);

  // a valódi stúdióban, a kezelőn át (a kijelölés a vásznon: a fotó a teljes vásznat kitölti)
  const id = 'prj_smoke_refine';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:refine-del0', caught));
  const page = { id: 'pg', name: 'pg', aspectRatio: '1:1', width: 600, height: 600, layers: [{ id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' }] } as unknown as ImageDoc;
  await saveProject({ ...createEmptyProject('smoke él-finomítás', '1:1', undefined, 'image'), id, imageDocs: [page] });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/image/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1500);
    await runDevAction('image.selectionRefine', { ring: rough, targetId: 'p' });
    await sleep(300);
    await runDevAction('image.selectionRefineRun');
    let sel = (await runDevAction('image.getSelection')) as { ops: { points: { x: number; y: number }[] }[] } | null;
    for (let i = 0; i < 40 && sel && iou(sel.ops[0].points) < 0.9; i++) {
      await sleep(200);
      sel = (await runDevAction('image.getSelection')) as typeof sel;
    }
    const v = sel ? iou(sel.ops[0].points) : 0;
    log(v > 0.95, 'stúdióban: „Élhez igazítás” a kijelölt fotón', `metszet/unió ${v.toFixed(3)}`);
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:refine-del', caught));
    removeFile(f.uri);
  }
}
