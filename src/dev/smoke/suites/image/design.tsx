/** 🧪 Füstteszt — design: sablon-könyvtár, saját font, márka-logó, reszponzív változat, PDF. (Áthelyezve: phases09, phases10; viselkedés-változás nélkül.) */
import { type SkImage, Skia, ImageFormat } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { type ReactNode, type RefObject, createRef } from 'react';
import { Platform, Dimensions, View } from 'react-native';
import { Asset } from 'expo-asset';
import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { router, type Href } from 'expo-router';
import { useBrandStyle } from '@/store/brandStyleStore';
import { IMAGE_TEMPLATES, docFromTemplate, templateFromDoc } from '@/lib/imageTemplates';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { importFontFromUri } from '@/lib/projectFontsClient';
import { insertBrandLogoWatermark } from '@/lib/brandLogoClient';
import { useUserTemplates } from '@/store/userTemplatesStore';
import AsyncStorageTpl from '@react-native-async-storage/async-storage';
import { renderOnDevice } from '@/lib/renderStageRegistry';
import { type RenderStageHandle, RenderStage } from '@/components/studio/image/RenderStage';
import { renderImageDoc } from '@/lib/imageDocClient';
import { makeId } from '@/lib/id';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { PhotoLayer, ImageLayer, ImageDoc, ShapeLayer } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { pixel, decode, removeFile, alphaImage, gridDiff } from '../../helpers/image';
import { variantDoc } from '@/lib/imageVariants';
import { brandLogoLayer } from '@/lib/imageBrand';
import { jpegSize, jpegToPdf } from '@/lib/rasterPdf';
import '@/lib/dspNativeClient';

/**
 * 🧩 IMAGE-PROD S9 (DS1): sablon-könyvtár — minden sablon a telefonon renderelve = a szerver-render
 * (a helyőrző mindkettőből kimarad); a helyőrzőbe tett kép a helyén marad (valódi stúdió, egy
 * visszavonás); a saját sablon a telefonon tárolva, a fotó helyőrzővé válik.
 */
export async function smokeTemplateLibrary(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(
    <View style={{ width: 1, height: 1 }}>
      <RenderStage ref={ref} />
    </View>
  );
  await sleep(300);
  // 1) a teljes könyvtár: telefon = szerver (640 px magasan, átlagos színeltérés — mint a márka-mérés)
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 60; j++) {
        const [x, y] = [(j + 0.5) / 60, (i + 0.5) / 60];
        const u = pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height()));
        const w = pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()));
        sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
        count += 1;
      }
    }
    return sum / count;
  };
  let ok = 0;
  const bad: string[] = [];
  const all: string[] = [];
  const t0 = Date.now();
  for (const tpl of IMAGE_TEMPLATES) {
    const doc = docFromTemplate(tpl, tpl.key, () => makeId('lyr'));
    const h = 640;
    const w = Math.round((h * tpl.width) / tpl.height);
    const dev = await ref.current!.render(doc, h);
    const srv = await renderImageDoc(doc, h).catch((caught) => {
      logCaught('lib/imageSmoke.tsx:templib', caught);
      return null;
    });
    if (!dev || !srv) {
      bad.push(`${tpl.key}:nincs`);
      continue;
    }
    const a = await decode(dev);
    const d = meanDiff(a, await decode(srv));
    all.push(`${tpl.key} ${d.toFixed(1)}`);
    if (Math.abs(a.width() - w) <= 1 && d <= 7) {
      ok += 1;
      removeFile(dev);
      removeFile(srv);
    } else {
      bad.push(`${tpl.key}:${d.toFixed(1)}`);
      // az eltérő pár megmarad a vizsgálathoz (a Mac-re másolható)
      const keep = (uri: string, tag: string) => new File(uri).move(new File(projectMediaDir(), `smoke_cmp_${tpl.key}_${tag}.png`));
      keep(dev, 'dev');
      keep(srv, 'srv');
    }
  }
  log(null, 'sablononként (átlag /255)', all.join(' · '));
  log(null, 'eltérő párok helye', projectMediaDir().uri);
  log(ok === IMAGE_TEMPLATES.length, `mind a ${IMAGE_TEMPLATES.length} sablon: telefon = szerver (a helyőrző kimarad)`, `${ok}/${IMAGE_TEMPLATES.length} egyezik (≤ 7/255), ${Date.now() - t0} ms${bad.length ? ` — eltér: ${bad.join(', ')}` : ''}`);
  setHarness(null);

  // 2) a helyőrző kitöltése a valódi stúdióban
  const id = 'prj_smoke_templib';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:templib-del0', caught));
  const surface = Skia.Surface.MakeOffscreen(200, 200)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#20c060'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  surface.flush();
  const img = new File(projectMediaDir(), `smoke_tpl_${Date.now().toString(36)}.png`);
  img.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const tpl = IMAGE_TEMPLATES.find((x) => x.key === 'postPhoto')!;
  const page = docFromTemplate(tpl, 'Fotó', () => makeId('lyr'));
  const base = createEmptyProject('smoke sablon-könyvtár', '1:1', undefined, 'design');
  await saveProject({ ...base, id, imageDocs: [page] });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/design/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1500);
    const phLayer = st().project!.imageDocs![0].layers.find((l) => l.kind === 'photo') as PhotoLayer;
    const filled = (await runDevAction('image.fillPlaceholder', { layerId: phLayer.id, uri: img.uri })) as boolean;
    await sleep(400);
    const after = st().project!.imageDocs![0].layers.find((l) => l.id === phLayer.id) as PhotoLayer;
    const r = await renderOnDevice(st().project!.imageDocs![0], 320);
    const mid = r ? pixel(await decode(r), 160, 120).slice(0, 3) : [];
    log(filled && after.uri === img.uri && !after.placeholder && after.w === phLayer.w && after.h === phLayer.h && mid[1] > 150 && mid[0] < 80, 'a helyőrzőbe tett kép a helyén és méretében, a kész képen is', `${after.w}×${after.h} (helyőrző ${phLayer.w}×${phLayer.h}), a kép közepe ${mid.join(',')}`);
    log(true, 'FOTÓZHATÓ', 'a kitöltött sablon a Design munkaterületen');
    await sleep(4000);
    st().undo();
    await sleep(300);
    const undone = st().project!.imageDocs![0].layers.find((l) => l.id === phLayer.id) as PhotoLayer;
    log(!!undone.placeholder && undone.uri === '', 'egy visszavonás: újra helyőrző');
    st().redo();
    // 3) mentés sablonként → a telefonon tárolva, a fotó helyőrző, a kategória a méretből
    const mine = templateFromDoc(st().project!.imageDocs![0], 'tpl_smoke', 'smoke saját');
    await useUserTemplates.getState().add(mine);
    const stored = JSON.parse((await AsyncStorageTpl.getItem('remix.imagetemplates.v1')) ?? '[]') as { key: string; layers: { kind: string; placeholder?: boolean; uri?: string }[]; category: string }[];
    const saved = stored.find((x) => x.key === 'tpl_smoke');
    log(!!saved && saved.category === 'post' && saved.layers.some((l) => l.kind === 'photo' && l.placeholder && l.uri === '') && !JSON.stringify(saved).includes(img.uri), 'mentés sablonként: a telefonon tárolva, a fotóból helyőrző (nincs fájl-hivatkozás)', `${saved?.category}, ${saved?.layers.length} réteg`);
    await useUserTemplates.getState().remove('tpl_smoke');
    if (r) removeFile(r);
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:templib-del', caught));
    removeFile(img.uri);
  }
}
/**
 * 🔤 IMAGE-PROD S10 (DS2): saját font — import a projektbe (tartalom-ellenőrzéssel), a telefonos és a
 * szerveres kész kép is azzal a betűvel rajzol; mentés után is megvan.
 */
export async function smokeFontImport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = Asset.fromModule(require('../../../../../assets/fonts/Lobster-Regular.ttf'));
  await src.downloadAsync();
  const res = await importFontFromUri(src.localUri ?? src.uri, 'Saját Lobster.ttf');
  if (!res.ok) {
    log(false, 'font-import', res.reason);
    return;
  }
  const font = res.font;
  // az import a fájl tényleges megjelenését is megvárja (a betöltés azonnal jöhet)
  const fontFile = new File(font.uri);
  log(/^u_SajatLobster_[A-Za-z0-9]+$/.test(font.family) && fontFile.exists, 'a font a projekt mappájába került, CSS-biztos családnévvel', `${font.family} · ${font.name} · ${fontFile.exists ? `${fontFile.size} B` : `nincs: ${font.uri}`}`);
  // hibás fájl: a tartalom dönt (egy PNG .ttf névvel nem font)
  const fake = alphaImage(ImageFormat.PNG, 'png');
  const bad = await importFontFromUri(fake, 'nem-font.ttf');
  log(!bad.ok && bad.reason === 'invalid', 'a nem-font fájl elutasítva (a tartalom alapján)', bad.ok ? 'átment' : bad.reason);
  removeFile(fake);

  const id = 'prj_smoke_fontimport';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:font-del0', caught));
  const text = (family: string) => ({ id: 't', kind: 'text', text: 'Árvíztűrő', position: { x: 0.5, y: 0.5 }, fontSize: 16, color: '#ffffff', fontFamily: family, backgroundColor: null }) as unknown as ImageLayer;
  const mk = (family: string) => ({ id: 'lap', name: 'f', aspectRatio: '1:1', width: 640, height: 640, layers: [{ id: 'bg', kind: 'fill', fill: '#1c1c28' }, text(family)] }) as unknown as ImageDoc;
  const base = createEmptyProject('smoke saját font', '1:1', undefined, 'image');
  await saveProject({ ...base, id, imageDocs: [mk(font.family)], fonts: [font] });
  const st = useEditorStore.getState;
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
      const u = pixel(p, Math.floor(((j + 0.5) / 60) * p.width()), Math.floor(((i + 0.5) / 60) * p.height()));
      const w = pixel(q, Math.floor(((j + 0.5) / 60) * q.width()), Math.floor(((i + 0.5) / 60) * q.height()));
      sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
      n += 1;
    }
    return sum / n;
  };
  try {
    router.push(`/studio/image/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1500);
    const fonts = st().project?.fonts ?? [];
    const own = await renderOnDevice(mk(font.family), 640);
    const builtIn = await renderOnDevice(mk('Lobster'), 640);
    const other = await renderOnDevice(mk('Poppins'), 640);
    if (!own || !builtIn || !other) throw new Error('nincs telefonos render');
    const [a, b, c] = [await decode(own), await decode(builtIn), await decode(other)];
    const dSame = meanDiff(a, b);
    const dOther = meanDiff(a, c);
    log(dSame < 1 && dOther > dSame * 3, 'telefonos kész kép: a saját font = ugyanaz a beépített font (ellenpróba: Poppins eltér)', `${dSame.toFixed(2)} · ellenpróba ${dOther.toFixed(2)} /255`);
    // a szerveres kép a feltöltött fontfájllal
    const srv = await renderImageDoc(mk(font.family), 640, { fonts });
    const noFont = await renderImageDoc(mk(font.family), 640);
    if (srv && noFont) {
      const s1 = await decode(srv);
      const dSrv = meanDiff(a, s1);
      const dCtl = meanDiff(s1, await decode(noFont));
      log(dSrv <= 7 && dCtl > 2, 'szerveres kész kép: a font a renderrel feltöltődik (= telefon); font nélkül tartalék-betű', `${dSrv.toFixed(2)} · ellenpróba ${dCtl.toFixed(2)} /255`);
      removeFile(srv);
      removeFile(noFont);
    } else {
      log(false, 'szerveres kész kép a saját fonttal', 'nincs render');
    }
    log(true, 'FOTÓZHATÓ', 'a saját fontú szöveg a vásznon');
    await sleep(4000);
    // mentés + újratöltés: a font a projektben marad, a fájl a projekt mappájában
    await saveProject(st().project!);
    const reloaded = await loadProject(id);
    const kept = reloaded?.fonts?.[0];
    log(kept?.family === font.family && !!kept && new File(kept.uri).exists && (reloaded?.schemaVersion ?? 0) >= 10, 'mentés után is megvan (a projekt mappájában)', `${kept?.uri.split('/').slice(-2).join('/')} · v${reloaded?.schemaVersion}`);
    [own, builtIn, other].forEach((u) => removeFile(u));
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:font-del', caught));
  }
}
/**
 * 🏷️ IMAGE-PROD S11 (DS3): a közös márka-logó egy koppintással a képre és a videóra — mindkettő a
 * projektbe MÁSOLT fájllal, ugyanott és ugyanakkora; a márka-fájl a projekt mentése után is megvan.
 */
export async function smokeBrandLogo(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const mine = await loadBrandStyle();
  const surface = Skia.Surface.MakeOffscreen(200, 200)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#e0102a'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  surface.flush();
  const src = new File(projectMediaDir(), `smoke_logo_src_${Date.now().toString(36)}.png`);
  src.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const brandUri = await useBrandStyle.getState().addLogo(src.uri);
  for (let i = 0; i < 40 && brandUri && !new File(brandUri).exists; i++) await sleep(50);
  const stored = await loadBrandStyle();
  log(!!brandUri && brandUri.includes('/brand/') && (stored.logos ?? []).includes(brandUri), 'a logó a közös márkában (a telefon márka-mappájában, tárolva)', brandUri?.split('/').slice(-2).join('/') ?? 'nincs');
  if (!brandUri) return;
  const st = useEditorStore.getState;
  const imgId = 'prj_smoke_brandlogo_img';
  const vidId = 'prj_smoke_brandlogo_vid';
  try {
    // 1) a képre (Kép Stúdió)
    await deleteProject(imgId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del0', caught));
    const page = { id: 'lap', name: 'l', aspectRatio: '16:9', width: 1280, height: 720, layers: [{ id: 'bg', kind: 'fill', fill: '#1c1c28' }] } as unknown as ImageDoc;
    await saveProject({ ...createEmptyProject('smoke márka-logó kép', '16:9', undefined, 'image'), id: imgId, imageDocs: [page] });
    router.push(`/studio/image/${imgId}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== imgId; i++) await sleep(200);
    await sleep(1200);
    runDevAction('image.insertBrandLogo', brandUri);
    await sleep(500);
    const doc = st().project!.imageDocs![0];
    const logo = doc.layers.find((l) => l.kind === 'photo') as PhotoLayer | undefined;
    const r = await renderOnDevice(doc, 720);
    const img = r ? await decode(r) : null;
    const px = img && logo ? pixel(img, Math.round(logo.position.x * img.width()), Math.round(logo.position.y * img.height())).slice(0, 3) : [];
    log(!!logo && logo.uri !== brandUri && !logo.uri.includes('/brand/') && px[0] > 180 && px[1] < 60, 'képre: a logó a jobb alsó sarokban, a projektbe másolt fájllal (a kész képen is)', `${logo?.w.toFixed(3)}×${logo?.h.toFixed(3)} @ ${logo?.position.x.toFixed(3)},${logo?.position.y.toFixed(3)} · szín ${px.join(',')}`);
    log(true, 'FOTÓZHATÓ', 'a márka-logó a lapon');
    await sleep(3500);
    st().undo();
    log(!st().project!.imageDocs![0].layers.some((l) => l.kind === 'photo'), 'egy visszavonás: a logó lekerül a lapról');
    st().redo();
    await saveProject(st().project!);
    router.back();
    await sleep(800);
    // 2) a videóra (ugyanaz a függvény, amit a márka-szekció hív)
    await deleteProject(vidId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del1', caught));
    await saveProject({ ...createEmptyProject('smoke márka-logó videó', '16:9', undefined, 'video'), id: vidId });
    router.push(`/editor/${vidId}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== vidId; i++) await sleep(200);
    await sleep(1200);
    const added = insertBrandLogoWatermark(brandUri, 'Vízjel');
    const wm = st().project!.tracks.find((t) => t.type === 'overlay')?.clips.find((c) => c.kind === 'shape') as ShapeLayer & { imageUri?: string } | undefined;
    log(added && !!wm && wm.imageUri !== brandUri && !String(wm.imageUri).includes('/brand/') && !!logo && Math.abs(wm.w - logo.w) < 1e-6 && Math.abs(wm.position.x - logo.position.x) < 1e-6, 'videóra: vízjel-klip ugyanott és ugyanakkora, a projektbe másolt fájllal', `${wm?.w.toFixed(3)}×${wm?.h.toFixed(3)} @ ${wm?.position.x.toFixed(3)},${wm?.position.y.toFixed(3)}`);
    await saveProject(st().project!);
    // 3) a márka-fájl a két projekt mentése után is a helyén (nem költözött a projektbe)
    log(new File(brandUri).exists, 'a márka-logó fájlja a mentések után is a márka-mappában');
    if (r) removeFile(r);
  } finally {
    if (st().project?.id === vidId || st().project?.id === imgId) {
      router.back();
      await sleep(500);
    }
    await deleteProject(imgId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del2', caught));
    await deleteProject(vidId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del3', caught));
    await useBrandStyle.getState().removeLogo(brandUri);
    // a felhasználó márkája visszaírva
    await saveBrandStyle(mine);
    useBrandStyle.setState({ colors: mine.colors, fontFamily: mine.fontFamily, logos: mine.logos ?? [] });
    removeFile(src.uri);
  }
}

/**
 * 📐 IMAGE-PROD S12 (DS4): reszponzív változat — a YouTube-indexkép (logóval) story-ként kézi igazítás
 * nélkül: a logó a sarokban, a szöveg nem ér a szélekhez; a telefonos kép = a szerveres.
 */
export async function smokeVariant(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const surface = Skia.Surface.MakeOffscreen(120, 120)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#20d060'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 120, 120), paint);
  surface.flush();
  const logoFile = new File(projectMediaDir(), `smoke_variant_logo_${Date.now().toString(36)}.png`);
  logoFile.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  let n = 0;
  const tpl = IMAGE_TEMPLATES.find((x) => x.key === 'youtubeThumb')!;
  const thumb = docFromTemplate(tpl, 'yt', () => `t${++n}`);
  const withLogo = { ...thumb, layers: [...thumb.layers, brandLogoLayer(logoFile.uri, 'logo', { width: 1280, height: 720 })] } as ImageDoc;
  for (const [name, W, H] of [['story', 1080, 1920], ['poszt', 1080, 1080], ['banner', 1500, 500]] as const) {
    const v = variantDoc(withLogo, W, H, name, () => `v${++n}`);
    const h = 640;
    const uri = await ref.current!.render(v, h);
    if (!uri) {
      log(false, `változat: ${name}`, 'nincs kép');
      continue;
    }
    const img = await decode(uri);
    const [w, hh] = [img.width(), img.height()];
    // a logó: zöld a jobb alsó sarokban
    const lg = v.layers.find((l) => l.id !== undefined && l.kind === 'photo') as PhotoLayer;
    const p = pixel(img, Math.round(lg.position.x * w), Math.round(lg.position.y * hh));
    const corner = 1 - (lg.position.x + lg.w / 2) < 0.06 && 1 - (lg.position.y + lg.h / 2) < 0.06;
    // a fehér szöveg nem ér a szélekhez (2%-os sáv)
    let edge = 0;
    for (let x = 0; x < w; x += 2) for (const y of [1, hh - 2]) { const q = pixel(img, x, y); if (q[0] > 230 && q[1] > 230 && q[2] > 230) edge += 1; }
    for (let y = 0; y < hh; y += 2) for (const x of [1, w - 2]) { const q = pixel(img, x, y); if (q[0] > 230 && q[1] > 230 && q[2] > 230) edge += 1; }
    const srv = await renderImageDoc(v, h);
    let parity = '—';
    let parityOk = true;
    if (srv) {
      const d = gridDiff(img, await decode(srv), w, Math.round(hh * 0.85));
      parity = `${d.bad}/${d.total}`;
      parityOk = d.bad / d.total <= 0.06;
      removeFile(srv);
    }
    log(corner && p[1] > 180 && p[0] < 80 && edge === 0 && parityOk, `változat ${name} ${W}×${H}: a logó a sarokban, a szöveg nem ér a szélhez, telefon = szerver`, `logó ${p.slice(0, 3).join(',')}, szélen ${edge} fehér pont, eltér ${parity}`);
    removeFile(uri);
  }
  setHarness(null);
  removeFile(logoFile.uri);
}
/**
 * 📄 IMAGE-PROD S14 (DS7): PDF a telefonon, szerver nélkül — a lap telefonos JPEG-je egy PDF-oldalon;
 * a fájlból visszaolvasott kép pixelre a lap képe, a mérete a valódi JPEG-fejlécből.
 */
export async function smokePdfOffline(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  let n = 0;
  const doc = docFromTemplate(IMAGE_TEMPLATES.find((x) => x.key === 'posterMinimal')!, 'Plakát ő', () => `t${++n}`);
  const t0 = Date.now();
  const jpg = await ref.current!.render(doc, 1754, { format: 'jpg', quality: 0.92 });
  if (!jpg) {
    log(false, 'telefonos JPEG', 'nincs');
    setHarness(null);
    return;
  }
  const bytes = await new File(jpg).bytes();
  const size = jpegSize(bytes);
  const pdf = jpegToPdf(bytes, { title: 'Plakát ő' });
  const out = new File(projectMediaDir(), `smoke_offline_${Date.now().toString(36)}.pdf`);
  out.write(pdf);
  const back = await out.bytes();
  const head = String.fromCharCode(...back.slice(0, 8));
  const text = Array.from(back.slice(0, 2000), (b) => String.fromCharCode(b)).join('');
  const at = Array.from(back, (b) => String.fromCharCode(b)).join('').indexOf('stream\n', text.indexOf('/DCTDecode')) + 7;
  const embedded = back.slice(at, at + bytes.length);
  const a = await decode(jpg);
  const tmp = new File(projectMediaDir(), `smoke_pdf_img_${Date.now().toString(36)}.jpg`);
  tmp.write(embedded);
  const b = await decode(tmp.uri);
  const d = gridDiff(a, b, a.width(), a.height() - 8);
  log(!!size && size.width === 1240 && size.height === 1754, 'a valódi telefonos JPEG mérete a fejlécből', `${size?.width}×${size?.height}`);
  log(head.startsWith('%PDF-1.4') && text.includes('/MediaBox [0 0 595.2 841.92]') && d.bad === 0, 'PDF a telefonon: érvényes, A4-es oldal (150 dpi), a beágyazott kép pixelre a lapé', `${(back.length / 1024).toFixed(0)} KB, ${Date.now() - t0} ms, eltér ${d.bad}/${d.total}`);
  [jpg, out.uri, tmp.uri].forEach((u) => removeFile(u));
  setHarness(null);
}
