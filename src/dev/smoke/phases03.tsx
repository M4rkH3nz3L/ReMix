/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef, Profiler } from 'react';
import { Dimensions, Modal, PixelRatio, Platform, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { Asset } from 'expo-asset';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { remixFromPost } from '@/lib/feed';
import { remixRoute } from '@/lib/imageRemix';
import { loginWithIdentifier } from '@/lib/loginIdentifier';
import { useActionMenu } from '@/store/actionMenuStore';
import { LayerMenuSheet } from '@/components/studio/image/LayerMenuSheet';
import { LiveQuickGrid } from '@/components/live/LiveQuickGrid';
import { MultiSelectBar } from '@/components/studio/image/body/MultiSelectBar';
import { BASE_PX_PER_SEC, MAX_ZOOM } from '@/constants/editor';
import { endLive, startLive } from '@/lib/live';
import { setRecord } from '@/lib/liveDoc';
import { RecordToggle } from '@/components/live/RecordToggle';
import { DEFAULT_PALETTE, encodeFrame, floodFill, paintLine, pixelLayerBox, pixelLayerScale, type PixelArt, type PixelFrame } from '@/lib/pixelArt';
import { writeLayerPng, writePixelGif, writeSpriteSheet } from '@/lib/pixelArtClient';
import { PixelStudio } from '@/components/studio/image/PixelStudio';
import type { FeedPost } from '@/types/social';
import { type Href, router } from 'expo-router';
import { useBrandStyle } from '@/store/brandStyleStore';
import { TemplatesSheet } from '@/components/studio/image/TemplatesSheet';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { variantDoc } from '@/lib/imageVariants';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { startSyncProbe, stopSyncProbe, summarizeDrift } from '@/lib/audioSyncProbe';
import { exportOfflineWav, measureStretchLatency } from '@/lib/offlineMixClient';
import { canRenderLocally, renderLocal } from '@/lib/nativeRender';
import '@/lib/dspNativeClient';
import type { RenderSettings } from '@/lib/render';
import { encodeWav16 } from '@/lib/offlineMix';
import { canDetachAudio, detachAudioCommands } from '@/lib/audioExtract';
import { addSong, initAlbum, makeSong } from '@/lib/albumDoc';
import { AlbumSheet } from '@/components/studio/audio/AlbumSheet';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { updateLayer , addLayer, createImageDoc } from '@/lib/imageDoc';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { renderImageDoc } from '@/lib/imageDocClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, listProjects, loadProject, saveProjectAndEvents, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, ImageClip, VideoClip, ImageDoc, ImageLayer, PhotoLayer, Project } from '@/types/project';
import { AUDIO_KILL_ID, type Log, decode, pixel, removeFile, sleep } from './shared';

/** Sablonok, méretváltozat és a kép→videó a valódi vásznon, szerveren és tárolón át. */
export async function smokeEcosystem(log: Log, setHarness: (n: ReactNode) => void, ratio: number, brandOnly = false) {
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
    // a márka-alkalmazás az eredeti négy sablonon (a vászon itt egy apró tesztkeretben fotózódik, ahol a
    // magas sablon szövege a kis pontméret miatt máshol tördel); a teljes könyvtár paritását a `templib` méri
    for (const tpl of IMAGE_TEMPLATES.filter((x) => ['youtubeThumb', 'instaPost', 'story', 'banner'].includes(x.key))) {
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
/** Kép-poszt remixe valódi hálózati képekből: projekt, megnyitás a stúdióban, vászon = export. */
export async function smokeRemix(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  // nyilvános https-kép kell: a szerver privát címről védelemből nem tölt le (SSRF)
  const base = 'https://raw.githubusercontent.com/M4rkH3nz3L/ReMix/main/assets/images';
  const post = {
    id: 'smoke-post',
    title: 'Teszt',
    remixable: true,
    videoUri: null,
    images: [`${base}/icon.png`, `${base}/android-icon-background.png`],
    aspectRatio: '1:1',
    creator: { displayName: 'Teszt Elek' },
  } as unknown as FeedPost;
  const id = await remixFromPost(post);
  const saved = id ? await loadProject(id) : null;
  const docs = saved?.imageDocs ?? [];
  log(saved?.kind === 'image' && docs.length === 2 && saved.remixOf?.postId === 'smoke-post', 'remix: új kép-projekt két lappal, forrással', `${saved?.kind} ${docs.length} lap, ${saved?.remixOf?.postId}`);
  if (!id || docs.length !== 2) {
    return;
  }
  log(remixRoute(post, id) === `/studio/image/${id}`, 'remix: a képstúdióba visz', remixRoute(post, id));
  const v = createRef<View>() as RefObject<View>;
  setHarness(
    <View style={{ width: 340, height: 340 }}>
      <ImageCanvas doc={docs[0]} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
    </View>
  );
  // a hálózati kép lassabban ér ide, mint a helyi
  await sleep(6000);
  const shot = await captureRef(v, { format: 'png', quality: 1, width: 320, height: 320 });
  const a = await decode(shot);
  setHarness(null);
  await sleep(80);
  const [e, c] = [await renderImageDoc(docs[0], 320 * ratio), await renderImageDoc(docs[1], 320 * ratio)];
  if (!e || !c) {
    log(false, 'remix: hálózati kép az exportban', 'nincs render');
  } else {
    const diff = (p: SkImage, q: SkImage) => {
      let sum = 0;
      for (let i = 1; i < 30; i++) {
        for (let j = 1; j < 30; j++) {
          const [x, y] = [(j + 0.5) / 30, (i + 0.5) / 30];
          const [u, w] = [pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height())), pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()))];
          sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
        }
      }
      return sum / (29 * 29);
    };
    const [d, ctl] = [diff(a, await decode(e)), diff(a, await decode(c))];
    log(d <= 7 && ctl >= 20, 'remix: a hálózati kép a vásznon = export', `átlag ${d.toFixed(1)}/255; a másik lap ${ctl.toFixed(1)}`);
    removeFile(e);
    removeFile(c);
  }
  removeFile(shot);
  router.push(remixRoute(post, id) as Href);
  await sleep(4000);
  const open = useEditorStore.getState().project;
  log(open?.id === id && open.imageDocs?.length === 2, 'remix: a valódi képstúdió megnyitotta', `${open?.name}, ${open?.imageDocs?.length} lap`);
  log(true, 'FOTÓZHATÓ', 'a remix a képstúdióban');
  await sleep(7000);
  router.back();
  await sleep(2000);
  await deleteProject(id);
  log((await loadProject(id)) === null, 'remix: a tesztprojekt törölve', id);
}
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
/** A gesztus-terület a valódi képernyőkön: megnyílnak, és a tárolóban él az undo-lánc. */
export async function smokeGestureScreens(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const [kind, path] of [['video', '/editor'], ['audio', '/studio/audio'], ['live', '/live/studio']] as const) {
    const project = createEmptyProject(`smoke gesztus ${kind}`, '9:16', undefined, kind);
    await saveProject(project);
    const start = performance.now();
    router.push(`${path}/${project.id}` as Href);
    for (let i = 0; i < 100 && useEditorStore.getState().project?.id !== project.id; i++) {
      await sleep(200);
    }
    const open = useEditorStore.getState().project;
    log(open?.id === project.id, `${kind}: a képernyő megnyílt a gesztus-területtel`, `${Math.round(performance.now() - start)} ms`);
    await sleep(1000);
    router.back();
    await sleep(1500);
    await deleteProject(project.id);
  }
}
/** Élő adás két eszközön: az egyik ad, a másik néz; a szerver oldali ellenőrzés a Macről fut. */
export async function smokeLiveHost(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const project = createEmptyProject('smoke live', '9:16', undefined, 'live');
  await saveProject(project);
  const session = await startLive('smoke live');
  log(null, 'LIVEID', session.id);
  router.push(`/live/${session.id}?project=${project.id}` as Href);
  await sleep(60000);
  await endLive(session.id);
  log(null, 'LIVEEND', session.id);
  await sleep(1500);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}
/** „Élő mentése videó-projektbe”: adás felvétellel, kilépés, a felvételből szerkeszthető projekt. */
export async function smokeLiveRecord(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  setHarness(<View><RecordToggle value={false} onToggle={() => {}} /><RecordToggle value onToggle={() => {}} /></View>);
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'kapcsoló két állapotban');
  await sleep(4000);
  setHarness(null);
  const blank = createEmptyProject('smoke felvétel', '9:16', undefined, 'live');
  const project = { ...blank, live: setRecord(blank.live!, true) };
  await saveProject(project);
  const before = new Set((await listProjects()).map((p) => p.id));
  const session = await startLive('smoke felvétel');
  log(null, 'LIVEID', session.id);
  router.push(`/live/${session.id}?project=${project.id}` as Href);
  await sleep(35000);
  router.back();
  await sleep(4000);
  const created = (await listProjects()).filter((p) => !before.has(p.id) && p.kind === 'video');
  log(created.length === 1, 'a felvételből videóprojekt lett', `${created.length} új projekt`);
  const full = created[0] ? await loadProject(created[0].id) : null;
  const clip = full?.tracks.find((t) => t.type === 'video')?.clips[0] as VideoClip | undefined;
  log(!!clip?.uri && /^https:/.test(clip.uri), 'a projekt videósávján ott a felvétel', `${clip?.duration.toFixed(0)} mp, ${clip?.uri.slice(0, 48)}`);
  let size = 0;
  for (let i = 0; i < 45 && clip?.uri && size === 0; i++) {
    await sleep(2000);
    const res = await fetch(clip.uri, { headers: { Range: 'bytes=0-1' } }).catch((caught) => { logCaught('lib/imageSmoke.tsx:vod', caught); return null; });
    size = res && res.status < 300 ? Number(res.headers.get('content-range')?.split('/')[1] ?? 1) : 0;
  }
  log(size > 0, 'az MP4 letölthető a tárból', `${Math.round(size / 1024)} kB`);
  if (created[0]) {
    await deleteProject(created[0].id);
  }
  await endLive(session.id).catch((caught) => { logCaught('lib/imageSmoke.tsx:liveRecord', caught); });
}
export async function smokeLiveView(log: Log, id: string) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  router.push(`/live/${id}` as Href);
  await sleep(30000);
  log(true, 'FOTÓZHATÓ', 'néző');
  await sleep(6000);
  router.back();
}
/** Tíz perces klip legnagyobb nagyításon a valódi szerkesztőben. */
export async function smokeTimelineZoom(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let n = 0;
  const doc = createImageDoc('t', '9:16', () => `tz${++n}`);
  const base = addImageDocToVideo(createEmptyProject('smoke idővonal', '9:16', undefined, 'video'), doc, 'file:///smoke.png');
  const project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: t.clips.map((c) => ({ ...c, duration: 600 })) } : t)) };
  await saveProject(project);
  router.push(`/editor/${project.id}` as Href);
  await sleep(3500);
  const store = useEditorStore.getState();
  store.setZoom(100);
  await sleep(1500);
  const zoom = useEditorStore.getState().zoom;
  log(zoom === MAX_ZOOM, 'a nagyítás felső határa', `${zoom}× = ${(zoom * BASE_PX_PER_SEC) / 30} pont/kocka 30 fps-en`);
  log((zoom * BASE_PX_PER_SEC) / 30 >= 30, 'egy kocka ujjal fogható', '≥ 30 pont');
  const start = performance.now();
  for (let i = 1; i <= 10; i++) {
    store.setPlayhead(i * 55);
    await sleep(150);
  }
  log(useEditorStore.getState().project?.id === project.id, 'tíz perces klip végiggörgetve a legnagyobb nagyításon', `${(performance.now() - start).toFixed(0)} ms`);
  log(true, 'FOTÓZHATÓ', 'idővonal');
  await sleep(5000);
  store.setZoom(1);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}
/** A hosszú nyomás menüje és a többes sáv a kijelzőn. */
export async function smokeMenus(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const layer = { kind: 'shape', id: 'm', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, fill: '#fff' } as ImageLayer;
  setHarness(
    <View style={{ width: Math.min(420, Dimensions.get('window').width) }}>
      <MultiSelectBar count={3} onAction={() => {}} onClose={() => {}} />
      <LiveQuickGrid sources={[{ id: 'k', kind: 'camera', label: 'Kamera', visible: true }, { id: 'l', kind: 'logo', label: 'Logó', visible: false }, { id: 't', kind: 'text', label: 'Felirat', visible: true }]} micMuted={false} onToggle={() => {}} onMic={() => {}} onFlip={() => {}} />
      <LayerMenuSheet layer={layer} onPick={() => {}} onClose={() => {}} />
    </View>
  );
  await sleep(1500);
  log(true, 'FOTÓZHATÓ', 'menü és többes sáv');
  await sleep(6000);
  setHarness(null);
}
/** Gyors vissza és előre a valódi mesterórán: a lejátszófej a sebesség szerint halad. */
export async function smokeShuttle(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let n = 0;
  const base = addImageDocToVideo(createEmptyProject('smoke shuttle', '9:16', undefined, 'video'), createImageDoc('t', '9:16', () => `sh${++n}`), 'file:///smoke.png');
  const project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: t.clips.map((c) => ({ ...c, duration: 120 })) } : t)) };
  await saveProject(project);
  router.push(`/editor/${project.id}` as Href);
  const s = () => useEditorStore.getState();
  for (let i = 0; i < 40 && s().project?.id !== project.id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  s().setPlayhead(60);
  await sleep(300);
  const run = async (dir: 1 | -1, times: number, expected: number, name: string) => {
    s().setPlaybackRate(dir);
    for (let i = 0; i < times; i++) {
      s().shuttle(dir);
    }
    const [from, t0] = [s().playhead, performance.now()];
    await sleep(1500);
    const moved = s().playhead - from;
    const elapsed = (performance.now() - t0) / 1000;
    s().setPlaying(false);
    s().setPlaybackRate(1);
    const rate = moved / elapsed;
    log(Math.abs(rate - expected) < Math.abs(expected) * 0.25, name, `${rate.toFixed(2)}× (várt ${expected}×)`);
    await sleep(300);
  };
  await run(1, 1, 2, 'előre 2×');
  await run(1, 2, 4, 'előre 4×');
  await run(-1, 1, -2, 'vissza 2×');
  await run(-1, 2, -4, 'vissza 4×');
  const stopped = s().playhead;
  await sleep(600);
  log(s().playhead === stopped && !s().isPlaying, 'elengedés után megáll a helyén', `${stopped.toFixed(2)} mp`);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}
/** A Live Stúdió a valódi képernyőn: panelek, tablet-elrendezés, fogók. */
export async function smokeLiveStudio(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const project = createEmptyProject('smoke stúdió', '9:16', undefined, 'live');
  await saveProject(project);
  const start = performance.now();
  router.push(`/live/studio/${project.id}` as Href);
  for (let i = 0; i < 100 && useEditorStore.getState().project?.id !== project.id; i++) {
    await sleep(200);
  }
  log(useEditorStore.getState().project?.id === project.id, 'a Stúdió megnyílt', `${Math.round(performance.now() - start)} ms`);
  await sleep(1500);
  log(true, 'FOTÓZHATÓ', 'Live Stúdió');
  await sleep(7000);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}
/** A hosszú nyomás menüje a gyökérből, a valódi Modal-lal. */
export async function smokeActionMenu(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  useActionMenu.getState().open('Videó', [
    { label: 'Több kijelölése', icon: 'checkmark-done-outline', onPress: () => {} },
    { label: 'Vágás itt', icon: 'cut-outline', onPress: () => {} },
    { label: 'Duplikálás', icon: 'copy-outline', onPress: () => {} },
    { label: 'Törlés', icon: 'trash-outline', destructive: true, onPress: () => {} },
  ]);
  await sleep(1200);
  log(useActionMenu.getState().items?.length === 4, 'a menü nyitva', '4 elem');
  log(true, 'FOTÓZHATÓ', 'menülap');
  await sleep(5000);
  useActionMenu.getState().close();
  await sleep(500);
}
/** Belépés azonosítóval a valódi hálózaton: a válasz nem különbözteti meg az ismeretlen fiókot. */
export async function smokeLogin(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const out = await loginWithIdentifier('nincs_ilyen_felhasznalo', 'rossz-jelszo');
  log('error' in out && out.error === 'invalidCredentials', 'ismeretlen azonosító: általános hiba', JSON.stringify(out));
}
/** Hang-autosave a valódi képernyőn: szerkesztés, majd a külső kilövés előtt megállunk. */
export async function smokeAudioKillPrepare(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  await deleteProject(AUDIO_KILL_ID).catch((caught) => logCaught('lib/imageSmoke.tsx:audioKill', caught));
  await saveProject({ ...createEmptyProject('smoke hang-autosave', '9:16', undefined, 'audio'), id: AUDIO_KILL_ID });
  router.push(`/studio/audio/${AUDIO_KILL_ID}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== AUDIO_KILL_ID; i++) {
    await sleep(200);
  }
  await sleep(800);
  useEditorStore.getState().addClip('music', { kind: 'audio', id: 'smoke-kill-clip', uri: 'file:///smoke.m4a', label: 'kilövés előtt', start: 0, duration: 4, volume: 1, fadeIn: 0, fadeOut: 0 } as AudioClip);
  // a klip vágása is a mentésbe kerül
  useEditorStore.getState().splitClipAt('smoke-kill-clip', 2);
  await sleep(2500);
  log(null, 'KILLREADY', AUDIO_KILL_ID);
  await sleep(60000);
}
/** A45: az album-lap a szám-sorokkal (ceruza = átnevezés) — képernyőkép. */
export async function smokeAlbumSheet(log: Log, setHarness: (n: ReactNode) => void) {
  const base = createEmptyProject('smoke album', '1:1', undefined, 'audio');
  const album = addSong(initAlbum(makeSong('s1', 'Első dal', base.tracks)), makeSong('s2', 'Második, nagyon hosszú című dal a lapon', base.tracks));
  useEditorStore.getState().loadProject({ ...base, album }, []);
  setHarness(<AlbumSheet onClose={() => {}} onShareAlbum={() => {}} />);
  log(true, 'FOTÓZHATÓ', 'az album-lap a szám-sorokkal');
  await sleep(5000);
  setHarness(null);
}
/**
 * ⏩ A gyorsított videóklip hangja leválasztható (lista #21): a valódi parancs-út (egy undo), és a
 * Hang Stúdióban a hangmagasság-tartó, 1,5×-es előnézet szinkronja a szondával.
 */
export async function smokeAudioSpeed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = 'prj_smoke_audiospeed';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioSpeed', caught));
  const base = createEmptyProject('smoke gyorsított hang', '16:9', undefined, 'audio');
  const video = { id: 'v', kind: 'video', uri, start: 0, duration: 6, trimIn: 0.5, sourceDuration: 10, speed: 1.5, volume: 1, filterId: 'none' } as VideoClip;
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [video] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const st = () => useEditorStore.getState();
  const voice = () => (st().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const vol = () => (st().project?.tracks.find((t) => t.type === 'video')?.clips[0] as VideoClip | undefined)?.volume;
  log(canDetachAudio(video), 'az 1,5×-es videóklip hangja leválasztható');
  const detach = () => st().applyBatch(detachAudioCommands(video, 'leválasztott', st().project?.links).commands, 'user');
  detach();
  const a = voice()[0];
  log(a?.speed === 1.5 && a.trimIn === 0.5 && a.duration === 6 && vol() === 0, 'a hangklip átvette a sebességet és a vágást, a videó elnémult', a ? `${a.speed}×, trimIn ${a.trimIn}` : 'nincs');
  st().undo();
  log(voice().length === 0 && vol() === 1, 'egy visszavonás mindent visszaállít');
  detach();
  const clipId = voice()[0]?.id ?? '';
  st().setPlayhead(0);
  await sleep(600);
  // 1. kör: a tanulás; 2. kör: a mért szinkron
  st().setPlaying(true);
  await sleep(2500);
  st().setPlaying(false);
  await sleep(500);
  st().setPlayhead(0);
  await sleep(600);
  startSyncProbe();
  st().setPlaying(true);
  await sleep(1500);
  const rate = runDevAction(`audio.nativeRate.${clipId}`) as number | undefined;
  await sleep(3500);
  const head = st().playhead;
  st().setPlaying(false);
  const { samples, seeks } = stopSyncProbe();
  log(Math.abs((rate ?? 0) - 1.5) < 0.01, 'az előnézet 1,5×-en szól (hangmagasság-tartással)', `rate ${rate}`);
  // a szonda forrás-időben mér: idővonal-időre a sebességgel osztva
  for (const [cid, d] of summarizeDrift(samples.filter((x) => x.sinceStart > 2))) {
    log(d.maxMs / 1.5 <= 45, `szinkron beállás után (${cid === clipId ? 'gyorsított hang' : cid})`, `max ${(d.maxMs / 1.5).toFixed(0)} ms idővonal-időben, ${d.n} minta`);
  }
  log(seeks <= 3, 'a lejátszás nem tekereget folyamatosan', `${seeks} korrekció`);
  const tr = samples.filter((x) => x.clipId === clipId);
  log(null, 'nyom gyorsított', tr.filter((_, k) => k % 8 === 0).map((x) => `${x.sinceStart.toFixed(1)}:${((x.drift * 1000) / 1.5).toFixed(0)}`).join(' '));
  log(Math.abs(head - 5) < 0.4, 'a lejátszófej a valós idővel halad', `${head.toFixed(2)} s`);
  router.back();
}
/**
 * ⏩ A gyorsított hang a TELEFONOS exportban (natív, hangmagasság-tartó nyújtás): forrás 2 s
 * 440 Hz + 2 s 880 Hz. Mérve: a hossz, a frekvencia (marad-e a hangmagasság) és a hangváltás
 * ideje (a nyújtó nem késleltet-e) — ugyanazok, mint a szerveres ffmpeg-tesztben.
 */
export async function smokeOfflineStretch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.cache, 'smoke_two_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const api = await loadAudioApi();
  const freqAt = (x: Float32Array, from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  /** az első 20 ms-os ablak, ahol a frekvencia 660 Hz fölé megy */
  const switchAt = (x: Float32Array, from: number, to: number) => {
    for (let t = from; t < to; t += 0.005) if (freqAt(x, t, t + 0.02) > 660) return t + 0.01;
    return Number.NaN;
  };
  const run = async (name: string, over: Partial<AudioClip>) => {
    const base = createEmptyProject('smoke nyújtás', '1:1', undefined, 'audio');
    const c: AudioClip = { kind: 'audio', id: 's', uri: src.uri, label: 's', start: 0, duration: 2, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'voiceover', ...over };
    const p: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
    const t0 = Date.now();
    const { uri, unsupported } = await exportOfflineWav(p, new File(projectExportDir(), `${name}.wav`));
    const ms = Date.now() - t0;
    const buf = await api!.decodeAudioData(uri, SR);
    const x = buf.getChannelData(0).slice();
    new File(uri).delete();
    return { x, dur: buf.duration, ms, unsupported };
  };
  for (const sp of [2, 0.5]) {
    const lat = await measureStretchLatency(sp);
    log(null, `nyújtó késése ${sp}×`, `${lat} minta = ${(((lat ?? 0) / SR) * 1000).toFixed(1)} ms`);
  }
  try {
    const fast = await run('smoke_stretch_2x', { start: 0.5, duration: 2, speed: 2 });
    log(fast.unsupported.length === 0, '2×: a telefonos export nem hagyja ki', `${fast.ms} ms`);
    log(Math.abs(fast.dur - 2.5) < 0.01, '2×: a hossz pontos', `${fast.dur.toFixed(3)} s`);
    const f1 = freqAt(fast.x, 0.6, 1.4);
    const f2 = freqAt(fast.x, 1.6, 2.4);
    log(Math.abs(f1 - 440) < 8 && Math.abs(f2 - 880) < 8, '2×: a hangmagasság marad (nem 880 / 1760 Hz)', `${f1.toFixed(0)} Hz → ${f2.toFixed(0)} Hz`);
    const sw = switchAt(fast.x, 1.2, 1.8);
    log(Math.abs(sw - 1.5) < 0.03, '2×: a hangváltás a helyén (a nyújtó nem késleltet)', `${sw.toFixed(3)} s (várt 1,500)`);
    const slow = await run('smoke_stretch_05x', { start: 0, duration: 4, speed: 0.5, trimIn: 1 });
    // forrás 1–3 s: 440 Hz 1 s-ig, váltás a forrás 2 s-ánál = idővonal 2 s
    const s1 = freqAt(slow.x, 0.2, 1.8);
    const s2 = freqAt(slow.x, 2.2, 3.8);
    log(Math.abs(slow.dur - 4) < 0.01 && Math.abs(s1 - 440) < 8 && Math.abs(s2 - 880) < 8, '0,5×: hossz és hangmagasság', `${slow.dur.toFixed(3)} s, ${s1.toFixed(0)} → ${s2.toFixed(0)} Hz`);
    const sw2 = switchAt(slow.x, 1.7, 2.3);
    log(Math.abs(sw2 - 2) < 0.04, '0,5×: a hangváltás a helyén', `${sw2.toFixed(3)} s (várt 2,000)`);
    // 🎚️ hangmagasság +7 félhang (a hossz marad): 440 → 659 Hz, 880 → 1319 Hz, a váltás a helyén
    const up = await run('smoke_pitch_7', { start: 0, duration: 4, audioFx: { pitchSemitones: 7 } });
    const u1 = freqAt(up.x, 0.3, 1.7);
    const u2 = freqAt(up.x, 2.3, 3.7);
    log(up.unsupported.length === 0 && Math.abs(u1 - 659.3) < 8 && Math.abs(u2 - 1318.5) < 12, 'hangmagasság +7: 440 → 659, 880 → 1319 Hz', `${u1.toFixed(0)} → ${u2.toFixed(0)} Hz, ${up.dur.toFixed(3)} s`);
    let usw = Number.NaN;
    for (let t = 1.7; t < 2.3 && Number.isNaN(usw); t += 0.005) if (freqAt(up.x, t, t + 0.02) > 990) usw = t + 0.01;
    log(Math.abs(usw - 2) < 0.04, 'hangmagasság: a váltás a helyén (a nyújtó késése kalibrálva)', `${usw.toFixed(3)} s (várt 2,000)`);
  } finally {
    src.delete();
  }
}
/**
 * ⏩ A natív (iOS) videó-render a gyorsított hangklipet is skálázza: videó (némítva) + 2×-es
 * hangklip (2 s 440 Hz + 2 s 880 Hz forrás) → MP4 a telefonon; a kimenet hangjában a hossz,
 * a hangmagasság és a hangváltás helye.
 */
export async function smokeNativeSpeed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const asset = Asset.fromModule(require('../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.cache, 'smoke_native_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const base = createEmptyProject('smoke natív sebesség', '16:9');
  const video = { id: 'v', kind: 'video', uri: asset.localUri ?? asset.uri, start: 0, duration: 4, trimIn: 0, sourceDuration: 10, speed: 1, volume: 0, filterId: 'none' } as VideoClip;
  const voice: AudioClip = { kind: 'audio', id: 'h', uri: src.uri, label: 'h', start: 0.5, duration: 2, trimIn: 0, sourceDuration: 4, speed: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'voiceover' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video] } : t.type === 'voiceover' ? { ...t, clips: [voice] } : t)) };
  const settings: RenderSettings = { resolution: 720, fps: 30, quality: 'medium', codec: 'h264' };
  const local = canRenderLocally(project, settings);
  log(local, 'a gyorsított hangklipes projekt a telefonon renderelhető (az új build jelzi a képességet)');
  if (!local) return;
  const t0 = Date.now();
  const out = await renderLocal(project, settings);
  log(null, 'natív render', `${Date.now() - t0} ms`);
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out.uri, SR);
  const x = buf.getChannelData(0).slice();
  const freqAt = (from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  let sw = Number.NaN;
  for (let t = 1.2; t < 1.8 && Number.isNaN(sw); t += 0.005) if (freqAt(t, t + 0.02) > 660) sw = t + 0.01;
  const f1 = freqAt(0.6, 1.4);
  const f2 = freqAt(1.6, 2.4);
  log(Math.abs(f1 - 440) < 10 && Math.abs(f2 - 880) < 10, 'a hangmagasság marad (nem 880 / 1760 Hz)', `${f1.toFixed(0)} Hz → ${f2.toFixed(0)} Hz`);
  log(Math.abs(sw - 1.5) < 0.04, 'a hangváltás a helyén (2× = a forrás 2 s-a az idővonal 1,5 s-ánál)', `${sw.toFixed(3)} s`);
  log(freqAt(2.6, 3.4) < 50, 'a klip után csend (a hang nem nyúlik túl)', `${freqAt(2.6, 3.4).toFixed(0)} Hz`);
  out.delete();
  src.delete();
}
