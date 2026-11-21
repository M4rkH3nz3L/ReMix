/** 🧪 Füstteszt — videó-export: thumbnail-lap, kép-klip natívan, szöveg-overlay, Free-export. (Áthelyezve: phases08, phases11; viselkedés-változás nélkül.) */
import { Platform, Dimensions, PixelRatio, Alert } from 'react-native';
import { Asset } from 'expo-asset';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { thumbnailFramesOnDevice } from '@/lib/thumbStudio';
import { thumbnailDoc, thumbnailDocOf, posterNeedsRefresh } from '@/lib/thumbnailDoc';
import { renderOnDevice } from '@/lib/renderStageRegistry';
import { projectPreviewSource } from '@/lib/projectPreview';
import { makeId } from '@/lib/id';
import { createEmptyProject, CURRENT_SCHEMA_VERSION } from '@/lib/projectUtils';
import { deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { decode, pixel, removeFile } from '../../helpers/image';
import { Skia, ImageFormat, type SkImage, ColorType, AlphaType } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { runDevAction } from '@/lib/devActions';
import { canRenderLocally, renderLocal, deviceRenderGaps, buildRenderPlan } from '@/lib/nativeRender';
import { rasterTextOverlays } from '@/lib/overlayRasterBridge';
import * as StillThumbs from 'expo-video-thumbnails';
import { t as i18nT } from 'i18next';
import { createImageDoc } from '@/lib/imageDoc';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { usePaywall } from '@/store/paywallStore';
import { useEntitlement } from '@/store/entitlementStore';
import '@/lib/dspNativeClient';

/**
 * 🖼️ CORE K5 (IMAGE-PROD C3): szerkeszthető videó-thumbnail — kockák a telefonon, a lap a
 * videó-projektben (egy köteg), a Kép Stúdió ugyanazon a projekten nyitja, az előnézet és a
 * feed-poszter a lapból készül, mentés után is megvan.
 */
export async function smokeThumbDoc(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}, pixelarány ${PixelRatio.get()}`);
  const asset = Asset.fromModule(require('../../../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = 'prj_smoke_thumbdoc';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:thumbdoc', caught));
  const base = createEmptyProject('smoke thumbnail', '16:9', undefined, 'video');
  const clip = { id: 'v', kind: 'video', uri, start: 0, duration: 8, trimIn: 0, sourceDuration: 10, speed: 1, volume: 1, filterId: 'none' } as VideoClip;
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [clip] } : tr)) });
  const st = useEditorStore.getState;
  try {
    router.push(`/editor/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1200);
    // 1) kockák a telefonon (szerver nélkül)
    const t0 = Date.now();
    const frames = (await thumbnailFramesOnDevice(st().project!)) ?? [];
    const sizes = await Promise.all(frames.map(async (f) => (await decode(f.uri)).width()));
    log(frames.length === 4 && sizes.every((w) => w > 100), 'képkockák a telefonon a videóból', `${frames.length} kocka (${frames.map((f) => f.t).join(', ')} s), szélesség ${sizes.join('/')}, ${Date.now() - t0} ms`);
    if (frames.length === 0) throw new Error('nincs kocka');
    // 2) a választott kockából a lap — ugyanaz a köteg, amit az export-panel ad
    const doc = thumbnailDoc({ id: 'th', name: 'Thumbnail', frameUri: frames[1].uri, headline: 'NAGY CÍM', aspect: 16 / 9, aspectRatio: '16:9', layerId: makeId });
    const past0 = st().past.length;
    st().applyBatch([{ type: 'UPSERT_IMAGE_DOC', doc }, { type: 'SET_THUMBNAIL_DOC', docId: 'th' }], 'user');
    log(thumbnailDocOf(st().project!)?.id === 'th' && st().past.length === past0 + 1, 'a thumbnail-lap a videó-projektben, egy visszavonás-lépés', `${st().project!.imageDocs?.length} lap`);
    st().undo();
    log(!st().project!.thumbnailDocId && !st().project!.imageDocs?.some((d) => d.id === 'th'), 'egy visszavonás: a lap és a hivatkozás is eltűnik');
    st().redo();
    // 3) a Kép Stúdió ugyanazon a projekten nyitja a lapot, a cím szerkeszthető
    router.push(`/studio/image/${id}?doc=th` as Href);
    await sleep(2000);
    const live = st().project!.imageDocs!.find((d) => d.id === 'th')!;
    st().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: { ...live, layers: live.layers.map((l) => (l.kind === 'text' ? { ...l, text: 'JAVÍTOTT CÍM', color: '#ffcc00' } : l)) } }, 'user');
    const thumbed = await (async () => {
      for (let i = 0; i < 80; i++) {
        const d = st().project!.imageDocs!.find((x) => x.id === 'th');
        if (d?.thumbUri) return d.thumbUri;
        await sleep(100);
      }
      return null;
    })();
    log(st().project!.id === id && !!thumbed, 'a Kép Stúdió ugyanazt a projektet nyitja; a szerkesztett lapnak élő bélyegképe van (a telefonon)', `${thumbed?.split('/').pop()}`);
    router.back();
    await sleep(1200);
    // 4) az előnézet a lapból, a poszter a lapból (a telefonos színpadon, a videó-szerkesztőben)
    const prev = projectPreviewSource(st().project!);
    log(prev?.type === 'image' && prev.uri === thumbed, 'a projekt-előnézet a thumbnail-lap képe', `${prev?.type}`);
    const thumb = thumbnailDocOf(st().project!)!;
    const fake = { url: 'https://x/v.mp4', posterUrl: 'https://x/p.jpg', posterKey: 'régi' };
    log(null, 'FOTÓZHATÓ-RENDER', 'a poszter-render alatt a rejtett színpad nem látszik');
    const t1 = Date.now();
    let poster: string | null = null;
    while (Date.now() - t1 < 6000) poster = await renderOnDevice(thumb, 720, { format: 'jpg', quality: 0.9 });
    const pimg = poster ? await decode(poster) : null;
    const textPx = pimg ? pixel(pimg, Math.round(pimg.width() / 2), Math.round(pimg.height() * 0.8)) : [];
    log(posterNeedsRefresh(fake, thumb) && !!pimg && pimg.height() === 720 && pimg.width() === 1280, 'a feed-poszter a lapból, a telefonon (a régi poszter elavultként jelölve)', `${pimg?.width()}×${pimg?.height()}, a cím helyén ${textPx.slice(0, 3).join(',')}`);
    // 5) mentés + újratöltés: a lap és a hivatkozás megmarad, az aktuális sémával (v9 óta)
    await saveProject(st().project!);
    const reloaded = await loadProject(id);
    log(reloaded?.thumbnailDocId === 'th' && !!thumbnailDocOf(reloaded) && reloaded.schemaVersion === CURRENT_SCHEMA_VERSION, `mentés után is megvan (séma v${CURRENT_SCHEMA_VERSION})`, `v${reloaded?.schemaVersion}`);
    frames.forEach((f) => removeFile(f.uri));
    if (poster) removeFile(poster);
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:thumbdoc-del', caught));
  }
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
