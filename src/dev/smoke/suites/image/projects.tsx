/** 🧪 Füstteszt — kép-projektek útjai: import/export, asszisztens, ökoszisztéma, remix, gyors létrehozás. (Áthelyezve: phases02, phases03, phases11; viselkedés-változás nélkül.) */
import { Skia, ImageFormat, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { type ReactNode, type RefObject, createRef } from 'react';
import { View, Modal, Platform, Dimensions, PixelRatio } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { Asset } from 'expo-asset';
import { AssistantBar } from '@/components/studio/image/body/AssistantBar';
import { parseImageIntent, applyImageCommands } from '@/lib/imageIntent';
import { renderImageDoc, ExportCancelled } from '@/lib/imageDocClient';
import { photoBytesPerPixel } from '@/components/studio/image/exportEstimate';
import { readExportFacts } from '@/components/studio/image/exportVerify';
import { layerOnlyDoc, expectsAlpha, exportProblems, selectionOnlyDoc } from '@/lib/imageExportCheck';
import { customExportSize, formatBytes } from '@/lib/imageExport';
import { ingestImageFile } from '@/lib/media';
import { applyRing, rectRing } from '@/lib/selection';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { ImageDoc, PhotoLayer, ImageLayer, ImageClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { removeFile, decode, pixel, meanDiff } from '../../helpers/image';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { remixFromPost } from '@/lib/feed';
import { remixRoute } from '@/lib/imageRemix';
import type { FeedPost } from '@/types/social';
import { router, type Href } from 'expo-router';
import { useBrandStyle } from '@/store/brandStyleStore';
import { TemplatesSheet } from '@/components/studio/image/TemplatesSheet';
import { IMAGE_TEMPLATES, docFromTemplate } from '@/lib/imageTemplates';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { variantDoc } from '@/lib/imageVariants';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject, loadProject, deleteProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { docIsEmpty } from '@/lib/imageDoc';
import { useSeoGate } from '@/store/seoGateStore';
import '@/lib/dspNativeClient';

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
  const art = (await Asset.fromModule(require('../../../../../assets/images/icon.png')).downloadAsync()).localUri!;
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
