/** 🧪 Füstteszt — kép-teljesítmény és pixel art. (Áthelyezve: phases03; viselkedés-változás nélkül.) */
import { type SkImage, ColorType, AlphaType, Skia } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { type ReactNode, type RefObject, Profiler, createRef } from 'react';
import { Platform, Dimensions, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { type PixelFrame, paintLine, floodFill, type PixelArt, DEFAULT_PALETTE, encodeFrame, pixelLayerScale, pixelLayerBox } from '@/lib/pixelArt';
import { writeLayerPng, writePixelGif, writeSpriteSheet } from '@/lib/pixelArtClient';
import { PixelStudio } from '@/components/studio/image/PixelStudio';
import { createImageDoc, addLayer, updateLayer } from '@/lib/imageDoc';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { renderImageDoc } from '@/lib/imageDocClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProjectAndEvents, deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { ImageLayer, ImageDoc, PhotoLayer } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { decode, removeFile, pixel } from '../../helpers/image';
import '@/lib/dspNativeClient';

/** Nagy dokumentum költsége: módosítás, visszavonás, mentés, vászon. Fejlesztői build, a növekedés a lényeg. */
export async function smokePerf(log: Log, setHarness: (n: ReactNode) => void) {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const timed = async (fn: () => unknown) => {
    const t = performance.now();
    await fn();
    return performance.now() - t;
  };
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const count of [20, 100, 400]) {
    let n = 0;
    const id = () => `perf${count}_${++n}`;
    let doc = createImageDoc('perf', '1:1', id, { width: 1080, height: 1080 });
    for (let i = 0; i < count; i++) {
      const position = { x: ((i * 37) % 100) / 100, y: ((i * 61) % 100) / 100 };
      doc = addLayer(doc, i % 3 === 0
        ? ({ kind: 'text', id: id(), text: `Szöveg ${i}`, position, fontSize: 4, color: '#ffffff', fontFamily: 'Poppins' } as ImageLayer)
        : ({ kind: 'shape', id: id(), shape: 'rectangle', position, w: 0.1, h: 0.1, fill: '#ff2d95' } as ImageLayer));
    }
    const project = { ...createEmptyProject(`perf ${count}`, '1:1', undefined, 'image'), imageDocs: [doc] };
    useEditorStore.getState().loadProject(project, []);
    const moved = (d: ImageDoc, k: number) => updateLayer(d, d.layers[d.layers.length - 1].id, { position: { x: 0.1 + k / 100, y: 0.5 } } as Partial<ImageLayer>);
    const commits: number[] = [];
    const undos: number[] = [];
    for (let k = 0; k < 9; k++) {
      commits.push(await timed(() => useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: moved(doc, k) }, 'user')));
    }
    for (let k = 0; k < 5; k++) {
      undos.push(await timed(() => useEditorStore.getState().undo()));
    }
    const state = useEditorStore.getState();
    const bytes = JSON.stringify(state.project).length;
    const save = await timed(() => saveProjectAndEvents(state.project!, state.events));
    const renders: number[] = [];
    const view = (d: ImageDoc) => (
      <Profiler id="canvas" onRender={(_id, _phase, actual) => { renders.push(actual); }}>
        <View style={{ width: 320, height: 320 }}>
          <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} capturing />
        </View>
      </Profiler>
    );
    setHarness(view(doc));
    await sleep(1500);
    const mount = renders.reduce((a, b) => a + b, 0);
    const updates: number[] = [];
    for (let k = 0; k < 5; k++) {
      renders.length = 0;
      setHarness(view(moved(doc, k)));
      await sleep(250);
      updates.push(renders.reduce((a, b) => a + b, 0));
    }
    setHarness(null);
    await sleep(200);
    // a memo nem hagyhat elavult képet: a korrekció és az eltolt réteg azonnal látszik
    if (count === 20) {
      const v = createRef<View>() as RefObject<View>;
      const frame = (d: ImageDoc) => (
        <View style={{ width: 200, height: 200 }}>
          <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
        </View>
      );
      const grab = async () => {
        await sleep(350);
        const uri = await captureRef(v, { format: 'png', quality: 1, width: 120, height: 120 });
        const img = await decode(uri);
        removeFile(uri);
        return img;
      };
      const distance = (p: SkImage, q: SkImage) => {
        let sum = 0;
        for (let i = 0; i < 400; i++) {
          const [x, y] = [(i * 53) % 120, (i * 97) % 120];
          const [u, w] = [pixel(p, x, y), pixel(q, x, y)];
          sum += Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2]);
        }
        return sum / 1200;
      };
      setHarness(frame(doc));
      const base = await grab();
      const graded = addLayer(doc, { kind: 'adjust', id: id(), name: 'k', adjust: { brightness: -0.6 } } as unknown as ImageLayer);
      setHarness(frame(graded));
      const dark = await grab();
      const lighter = { ...graded, layers: graded.layers.map((l) => (l.kind === 'adjust' ? ({ ...l, adjust: { brightness: 0.6 } } as ImageLayer) : l)) };
      setHarness(frame(lighter));
      const light = await grab();
      setHarness(frame(doc));
      const back = await grab();
      setHarness(null);
      log(distance(base, dark) > 8 && distance(dark, light) > 8, 'memo: az új és a változó korrekció azonnal látszik', `alap→sötét ${distance(base, dark).toFixed(1)}, sötét→világos ${distance(dark, light).toFixed(1)}`);
      log(distance(base, back) < 1, 'memo: a korrekció törlése visszaadja az eredeti képet', `${distance(base, back).toFixed(2)}`);
    }
    log(median(updates) <= (count === 400 ? 100 : 30), `perf ${count} réteg: egy réteg változása elfér`, `${median(updates).toFixed(0)} ms`);
    log(null, `perf ${count} réteg`, `módosítás ${median(commits).toFixed(1)} ms, undo ${median(undos).toFixed(1)} ms, mentés ${save.toFixed(0)} ms (${Math.round(bytes / 1024)} kB), vászon-felépítés ${mount.toFixed(0)} ms, egy réteg változása ${median(updates).toFixed(0)} ms`);
    useEditorStore.getState().closeProject();
    await deleteProject(project.id);
  }
}
/** Nagy fotók a vásznon: megjelenés és egy fotó mozgatásának ára. */
export async function smokePerfPhotos(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let seq = 0;
  const id = () => `perfp${++seq}`;
  const source = addLayer(createImageDoc('forrás', '1:1', id, { width: 3072, height: 3072 }), { kind: 'shape', id: id(), shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, fill: '#ff2d95', gradient: { type: 'linear', angle: 45, stops: [{ color: '#ff2d95', offset: 0 }, { color: '#00e5ff', offset: 1 }] } } as unknown as ImageLayer);
  const png = await renderImageDoc(source, 3072);
  if (!png) {
    log(false, 'perf fotó: forrás', 'nincs render');
    return;
  }
  const files: File[] = [];
  for (let i = 0; i < 10; i++) {
    const copy = new File(Paths.cache, `perf_${Date.now()}_${i}.png`);
    new File(png).copy(copy);
    files.push(copy);
  }
  log(null, 'forrás', `3072×3072 PNG, ${Math.round(new File(png).size / 1024)} kB`);
  for (const count of [2, 5, 10]) {
    let doc = createImageDoc('fotók', '1:1', id, { width: 1080, height: 1080 });
    for (let i = 0; i < count; i++) {
      doc = addLayer(doc, { kind: 'photo', id: id(), name: `${i}`, uri: files[i].uri, position: { x: 0.2 + 0.06 * i, y: 0.5 }, w: 0.7, h: 0.7, fit: 'cover' } as PhotoLayer);
    }
    const renders: number[] = [];
    const v = createRef<View>() as RefObject<View>;
    const view = (d: ImageDoc) => (
      <Profiler id="canvas" onRender={(_id, _phase, actual) => { renders.push(actual); }}>
        <View style={{ width: 320, height: 320 }}>
          <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
        </View>
      </Profiler>
    );
    const start = performance.now();
    setHarness(view(doc));
    let shown = -1;
    for (let i = 0; i < 60 && shown < 0; i++) {
      await sleep(100);
      if (!v.current) {
        continue;
      }
      const uri = await captureRef(v, { format: 'png', quality: 1, width: 64, height: 64 });
      const img = await decode(uri);
      removeFile(uri);
      // a legfelső fotó a szélén látszik először: a sarokhoz közel még a háttér volt
      const p = pixel(img, Math.round(img.width() * (0.2 + 0.06 * (count - 1))), Math.round(img.height() / 2));
      if (Math.abs(p[0] - 18) + Math.abs(p[1] - 18) + Math.abs(p[2] - 26) > 40) {
        shown = performance.now() - start;
      }
    }
    await sleep(500);
    const updates: number[] = [];
    const last = doc.layers[doc.layers.length - 1];
    for (let k = 0; k < 7; k++) {
      renders.length = 0;
      setHarness(view(updateLayer(doc, last.id, { position: { x: 0.3 + k / 50, y: 0.5 } } as Partial<ImageLayer>)));
      await sleep(120);
      updates.push(renders.reduce((a, b) => a + b, 0));
    }
    setHarness(null);
    await sleep(300);
    const median = [...updates].sort((a, b) => a - b)[3];
    log(shown > 0, `perf ${count} fotó megjelent`, `${shown.toFixed(0)} ms`);
    log(median <= 30, `perf ${count} fotó: egy fotó mozgatása`, `${median.toFixed(0)} ms`);
  }
  files.forEach((f) => f.delete());
  removeFile(png);
}
/** Pixel art: a kép, a GIF és a sprite-lap a valódi Skia-dekóderen át, a réteg a vásznon és a szerveren. */
export async function smokePixel(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const [w, h] = [32, 32];
  const frames: PixelFrame[] = [0, 1, 2].map((n) => {
    const f = new Uint8Array(w * h);
    paintLine(f, w, h, 4 + n * 3, 4, 20, 26, 9, { x: true, y: false });
    paintLine(f, w, h, 0, 31, 31, 31, 12, { x: false, y: false });
    floodFill(f, w, h, 15, 2, 0, { x: false, y: false });
    f[(5 + n) * w + 15] = 11;
    // a mintavétel a kitöltött területet látja, a vékony vonalat nem
    f.fill(4 + n, 8 * w, 8 * w);
    for (let y = 8; y < 24; y++) {
      f.fill(4 + n, y * w + 8, y * w + 24);
    }
    return f;
  });
  const art: PixelArt = { width: w, height: h, palette: [...DEFAULT_PALETTE], frames: frames.map(encodeFrame), fps: 8 };
  const expected = (frame: PixelFrame, x: number, y: number) => {
    const v = frame[y * w + x];
    if (v === 0) {
      return null;
    }
    const n = parseInt(DEFAULT_PALETTE[v - 1].slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mismatches = (img: SkImage, frame: PixelFrame, scale: number, ox = 0, oy = 0) => {
    const px = img.readPixels(ox, oy, { width: w * scale, height: h * scale, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    let bad = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = ((y * scale + scale - 1) * w * scale + x * scale + scale - 1) * 4;
        const want = expected(frame, x, y);
        const got = px ? [px[at], px[at + 1], px[at + 2]] : [];
        if (want ? got.join() !== want.join() || (px as Uint8Array)[at + 3] !== 255 : (px as Uint8Array)[at + 3] !== 0) {
          bad++;
        }
      }
    }
    return bad;
  };
  const scale = pixelLayerScale(w, h);
  const png = writeLayerPng(art);
  const img = await decode(png);
  log(img.width() === w * scale && mismatches(img, frames[0], scale) === 0, 'réteg-PNG pontos és éles', `${img.width()}×${img.height()}, eltérés ${mismatches(img, frames[0], scale)}/${w * h}`);

  const gifUri = writePixelGif(art, 4);
  const gifData = await Skia.Data.fromURI(gifUri);
  const gif = Skia.AnimatedImage.MakeAnimatedImageFromEncoded(gifData);
  log(gif?.getFrameCount() === 3, 'GIF: a Skia három kockát olvas', `${gif?.getFrameCount()}`);
  log(Math.abs((gif?.currentFrameDuration() ?? 0) - 120) <= 10, 'GIF: 8 fps időzítés', `${gif?.currentFrameDuration()} ms`);
  for (let n = 0; n < 3 && gif; n++) {
    const shot = gif.getCurrentFrame();
    const bad = shot ? mismatches(shot, frames[n], 4) : -1;
    log(bad === 0, `GIF ${n + 1}. kocka pixelre pontos`, `eltérés ${bad}/${w * h}`);
    gif.decodeNextFrame();
  }
  const sheetUri = writeSpriteSheet(art, 2);
  const sheet = await decode(sheetUri);
  log(sheet.width() === 128 && sheet.height() === 128 && mismatches(sheet, frames[2], 2, 0, 64) === 0, 'sprite-lap: a 3. kocka a helyén', `${sheet.width()}×${sheet.height()}, eltérés ${mismatches(sheet, frames[2], 2, 0, 64)}`);

  let n = 0;
  const id = () => `pix${++n}`;
  const base = createImageDoc('pixel', '1:1', id, { width: 1080, height: 1080, background: '#20242e' });
  const box = pixelLayerBox(w, h, 1080, 1080);
  const doc = addLayer(base, { kind: 'photo', id: id(), name: 'p', uri: png, position: { x: 0.5, y: 0.5 }, ...box, fit: 'stretch', pixelArt: art } as PhotoLayer);
  const project = { ...createEmptyProject('smoke pixel', '1:1', undefined, 'image'), imageDocs: [doc] };
  await saveProject(project);
  // a mentés a projekt mappájába költözteti a képet: a visszaolvasott dokumentum az érvényes
  const savedDoc = (await loadProject(project.id))?.imageDocs?.[0] ?? doc;
  const reopened = (savedDoc.layers[1] as PhotoLayer | undefined)?.pixelArt;
  log(reopened?.frames.join('|') === art.frames.join('|'), 'mentés után a rács szerkeszthető marad', `${reopened?.frames.length} kocka`);

  const v = createRef<View>() as RefObject<View>;
  setHarness(
    <View style={{ width: 340, height: 340 }}>
      <ImageCanvas doc={savedDoc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
    </View>
  );
  await sleep(1200);
  const shot = await captureRef(v, { format: 'png', quality: 1, width: 320, height: 320 });
  const canvasImg = await decode(shot);
  setHarness(null);
  await sleep(80);
  const [e, c] = [await renderImageDoc(savedDoc, 320 * ratio), await renderImageDoc(base, 320 * ratio)];
  if (e && c) {
    const diff = (p: SkImage, q: SkImage) => {
      let sum = 0;
      for (let i = 1; i < 40; i++) {
        for (let j = 1; j < 40; j++) {
          const [x, y] = [(j + 0.5) / 40, (i + 0.5) / 40];
          const [u, t] = [pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height())), pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()))];
          sum += (Math.abs(u[0] - t[0]) + Math.abs(u[1] - t[1]) + Math.abs(u[2] - t[2])) / 3;
        }
      }
      return sum / (39 * 39);
    };
    const [d, ctl] = [diff(canvasImg, await decode(e)), diff(canvasImg, await decode(c))];
    log(d <= 7 && ctl >= d * 1.5, 'pixel-réteg: vászon = export', `átlag ${d.toFixed(1)}/255; ellenpróba ${ctl.toFixed(1)}`);
    removeFile(e);
    removeFile(c);
  } else {
    log(false, 'pixel-réteg: vászon = export', 'nincs render');
  }
  await deleteProject(project.id);
  [shot, png, gifUri, sheetUri].forEach(removeFile);
  setHarness(<PixelStudio initial={art} onDone={() => {}} onClose={() => {}} />);
  await sleep(1500);
  log(true, 'FOTÓZHATÓ', 'pixel-szerkesztő');
  await sleep(8000);
  setHarness(null);
}
