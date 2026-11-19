/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { ImageFormat, Skia, type SkImage, type SkSurface as SkSurfaceT } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { type Href, router } from 'expo-router';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { variantDoc } from '@/lib/imageVariants';
import { brandLogoLayer } from '@/lib/imageBrand';
import { logCaught } from '@/lib/logCaught';
import { ingestImageFile } from '@/lib/media';
import { runDevAction } from '@/lib/devActions';
import '@/lib/dspNativeClient';
import { jpegSize, jpegToPdf } from '@/lib/rasterPdf';
import { renderOnDevice } from '@/lib/renderStageRegistry';
import { updateLayer } from '@/lib/imageDoc';
import { deleteSelection, maskFromSelection, rasterSubForSelection, replaceWithSelectionRaster } from '@/lib/imageSelectionOps';
import { applyRing, rectRing, type Selection as ImgSelection, selectionContains } from '@/lib/selection';
import { RenderStage, type RenderStageHandle } from '@/components/studio/image/RenderStage';
import { renderImageDoc } from '@/lib/imageDocClient';
import { colorRangeSelect, magicWandSelect, refineSelectionToEdges } from '@/lib/magicWandClient';
import { toSrgbIfNeeded } from '@/lib/colorIntakeClient';
import { createAdjustment, flattenAdjustments } from '@/lib/adjustmentStack';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { ClipMask, ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';
import { type Log, decode, gridDiff, pixel, removeFile, sleep } from './shared';

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
/**
 * 🎨 IMAGE-PROD S13 (DS5): belső réteg-stílusok — színátfedés, belső ragyogás, belső árnyék fotón
 * (átlátszatlan és átlátszó szélű) és formán: a telefonos kép = a szerveres, ellenpróbával.
 */
export async function smokeInnerFx(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const png = (draw: (c: ReturnType<SkSurfaceT['getCanvas']>, p: ReturnType<typeof Skia.Paint>) => void, name: string) => {
    const surface = Skia.Surface.MakeOffscreen(200, 200)!;
    const paint = Skia.Paint();
    draw(surface.getCanvas(), paint);
    surface.flush();
    const f = new File(projectMediaDir(), `smoke_inner_${name}_${Date.now().toString(36)}.png`);
    f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
    return f.uri;
  };
  const grey = png((c, p) => { p.setColor(Skia.Color('#909090')); c.drawRect(Skia.XYWHRect(0, 0, 200, 200), p); }, 'grey');
  const disc = png((c, p) => { p.setColor(Skia.Color('#909090')); c.drawCircle(100, 100, 90, p); }, 'disc');
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
  const bg = { id: 'bg', kind: 'fill', fill: '#203040' } as unknown as ImageLayer;
  const mk = (layer: Record<string, unknown>) => ({ id: 'fx', name: 'fx', aspectRatio: '1:1', width: 400, height: 400, layers: [bg, layer] }) as unknown as ImageDoc;
  const photo = (uri: string, fx: Record<string, unknown>) => ({ id: 'p', kind: 'photo', uri, position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fit: 'stretch', ...fx });
  const shape = (fx: Record<string, unknown>) => ({ id: 's', kind: 'shape', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fill: '#909090', ...fx });
  const FX: [string, Record<string, unknown>][] = [
    ['színátfedés', { colorOverlay: { color: '#ff2d95', opacity: 0.7 } }],
    ['belső ragyogás', { innerGlow: { color: '#ffee00', size: 0.05, opacity: 1 } }],
    ['belső árnyék', { innerShadow: { color: '#000000', dx: 0.02, dy: 0.02, blur: 0.012, opacity: 0.8 } }],
  ];
  const cases: [string, (fx: Record<string, unknown>) => Record<string, unknown>][] = [
    ['fotó', (fx) => photo(grey, fx)],
    ['átlátszó szélű fotó', (fx) => photo(disc, fx)],
    ['forma', (fx) => shape(fx)],
  ];
  for (const [cname, make] of cases) {
    const plain = await ref.current!.render(mk(make({})), 400);
    for (const [fname, fx] of FX) {
      const doc = mk(make(fx));
      const dev = await ref.current!.render(doc, 400);
      const srv = await renderImageDoc(doc, 400);
      if (!dev || !srv || !plain) {
        log(false, `${cname}: ${fname}`, 'nincs kép');
        continue;
      }
      const a = await decode(dev);
      const d = meanDiff(a, await decode(srv));
      const ctl = meanDiff(a, await decode(plain));
      log(d <= 6 && ctl > d * 2, `${cname}: ${fname} — telefon = szerver`, `${d.toFixed(2)} · ellenpróba (effekt nélkül) ${ctl.toFixed(2)} /255`);
      removeFile(dev);
      removeFile(srv);
    }
    if (plain) removeFile(plain);
  }
  setHarness(null);
  [grey, disc].forEach((u) => removeFile(u));
}
/** 🔍 S15: kromatikus aberráció és lencsetorzítás — a vászon/telefon shadere = a szerver `rgbashift`/`lenscorrection`-je */
export async function smokeLensFx(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  // éles szélű, színes minta: a csatorna-eltolás és a torzítás is látszik rajta
  const surface = Skia.Surface.MakeOffscreen(240, 240)!;
  const c = surface.getCanvas();
  const paint = Skia.Paint();
  const cols = ['#f0f0f0', '#202020', '#e03030', '#30a0f0'];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    paint.setColor(Skia.Color(cols[(i + j * 2) % 4]));
    c.drawRect(Skia.XYWHRect(i * 40, j * 40, 40, 40), paint);
  }
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_lens_${Date.now().toString(36)}.png`);
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
  const bg = { id: 'bg', kind: 'fill', fill: '#203040' } as unknown as ImageLayer;
  const mk = (detail: Record<string, number>) => ({ id: 'lens', name: 'lens', aspectRatio: '1:1', width: 400, height: 400, layers: [bg, { id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fit: 'stretch', develop: { base: {}, detail } }] }) as unknown as ImageDoc;
  const plain = await ref.current!.render(mk({}), 400);
  const CASES: [string, Record<string, number>][] = [
    ['kromatikus aberráció 0,5', { chromaticAberration: 0.5 }],
    ['kromatikus aberráció 1', { chromaticAberration: 1 }],
    ['hordótorzítás +0,6', { lensDistortion: 0.6 }],
    ['párnatorzítás −0,6', { lensDistortion: -0.6 }],
    ['mindkettő', { chromaticAberration: 0.7, lensDistortion: 0.4 }],
  ];
  for (const [name, detail] of CASES) {
    const doc = mk(detail);
    const dev = await ref.current!.render(doc, 400);
    const srv = await renderImageDoc(doc, 400);
    if (!dev || !srv || !plain) {
      log(false, name, 'nincs kép');
      continue;
    }
    const a = await decode(dev);
    const d = meanDiff(a, await decode(srv));
    const ctl = meanDiff(a, await decode(plain));
    log(d <= 6 && ctl > d * 2, `${name} — telefon = szerver`, `${d.toFixed(2)} · ellenpróba (effekt nélkül) ${ctl.toFixed(2)} /255`);
    removeFile(dev);
    removeFile(srv);
  }
  if (plain) removeFile(plain);
  setHarness(null);
  removeFile(f.uri);
}
/** 📏 S15: a szöveg sorköze — a vászon/telefon = a szerver (egy- és többsoros, alap és megadott sorköz) */
export async function smokeLeading(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  // a tinta függőleges kiterjedése (sorok, ahol a háttértől eltér) a kép magasságára normálva
  const ink = (img: SkImage) => {
    const W = img.width();
    const H = img.height();
    let top = -1;
    let bottom = -1;
    // az alsó sáv kimarad (a szerveres kép vízjele)
    for (let y = 0; y < H * 0.88; y += 1) {
      let hit = false;
      for (let x = 0; x < W && !hit; x += 3) {
        const p = pixel(img, x, y);
        if (p[0] > 150 && p[1] > 150) hit = true;
      }
      if (hit) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    return { top: top / H, bottom: bottom / H };
  };
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
  const bg = { id: 'bg', kind: 'fill', fill: '#203040' } as unknown as ImageLayer;
  const mk = (text: string, extra: Record<string, unknown>) => ({ id: 'lead', name: 'lead', aspectRatio: '1:1', width: 600, height: 600, layers: [bg, { id: 't', kind: 'text', text, position: { x: 0.5, y: 0.5 }, fontSize: 12, color: '#ffffff', fontFamily: 'Inter', fontWeight: 'bold', textAlign: 'center', backgroundColor: null, ...extra }] }) as unknown as ImageDoc;
  const CASES: [string, string, Record<string, unknown>][] = [
    ['egysoros, alap sorköz', 'Sorköz', {}],
    ['kétsoros, alap sorköz', 'Első sor\nMásodik', {}],
    ['háromsoros, alap sorköz', 'Egy\nKettő\nHárom', {}],
    ['kétsoros, sorköz 1,0', 'Első sor\nMásodik', { lineHeight: 1 }],
    ['kétsoros, sorköz 1,6', 'Első sor\nMásodik', { lineHeight: 1.6 }],
    ['kétsoros körvonallal, sorköz 1,0', 'Első sor\nMásodik', { lineHeight: 1, textStyle: { stroke: { color: '#ff3030', width: 0.06 } } }],
    ['Poppins egysoros, alap', 'Sorköz', { fontFamily: 'Poppins' }],
    ['Poppins kétsoros, alap', 'Első sor\nMásodik', { fontFamily: 'Poppins' }],
    ['Anton kétsoros, sorköz 1,0', 'ELSŐ SOR\nMÁSODIK', { fontFamily: 'Anton', lineHeight: 1 }],
    ['Pacifico kétsoros, alap', 'Első sor\nMásodik', { fontFamily: 'Pacifico', fontWeight: 'normal' }],
    ['ArchivoBlack kétsoros, alap', 'Első sor\nMásodik', { fontFamily: 'ArchivoBlack', fontWeight: 'normal' }],
    ['tördelt (dobozszélesség), alap', 'hosszú szöveg ami két sorba törik', { boxWidth: 0.6, fontSize: 6 }],
  ];
  for (const [name, text, extra] of CASES) {
    const doc = mk(text, extra);
    const dev = await ref.current!.render(doc, 600);
    const srv = await renderImageDoc(doc, 600);
    if (!dev || !srv) {
      log(false, name, 'nincs kép');
      continue;
    }
    const a = await decode(dev);
    const b = await decode(srv);
    const ia = ink(a);
    const ib = ink(b);
    const d = meanDiff(a, b);
    const off = Math.max(Math.abs(ia.top - ib.top), Math.abs(ia.bottom - ib.bottom)) * 600;
    log(off <= 6 && d <= 6, `${name} — a sorok helye telefon = szerver (72 px-es betű)`, `tinta telefon ${(ia.top * 600).toFixed(0)}–${(ia.bottom * 600).toFixed(0)} · szerver ${(ib.top * 600).toFixed(0)}–${(ib.bottom * 600).toFixed(0)} px · eltérés ${off.toFixed(1)} px · átlag ${d.toFixed(2)}/255`);
    removeFile(dev);
    removeFile(srv);
  }
  setHarness(null);
}
/** 🎭 S15: a maszk a réteg forgatását és méretezését is követi — telefon = szerver, a látható rész a rétegen marad */
export async function smokeMaskFollow(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const surface = Skia.Surface.MakeOffscreen(200, 200)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#e0e0e0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_mfollow_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  // a látható (világos) képpontok aránya és súlypontja
  const lit = (img: SkImage) => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    const N = 120;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const p = pixel(img, Math.floor(((j + 0.5) / N) * img.width()), Math.floor(((i + 0.5) / N) * img.height()));
      if (p[0] > 150) { n += 1; sx += j / N; sy += i / N; }
    }
    return { area: n / (N * N), cx: n ? sx / n : 0, cy: n ? sy / n : 0 };
  };
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
  const bg = { id: 'bg', kind: 'fill', fill: '#203040' } as unknown as ImageLayer;
  const MASKS: [string, ClipMask][] = [
    ['ellipszis', { shape: 'ellipse', x: 0.55, y: 0.45, w: 0.2, h: 0.12, feather: 0 }],
    ['téglalap', { shape: 'rectangle', x: 0.45, y: 0.55, w: 0.18, h: 0.1, feather: 0 }],
  ];
  for (const [mname, mask] of MASKS) {
    const base = { id: 'mf', name: 'mf', aspectRatio: '16:9', width: 640, height: 360, layers: [bg, { id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.5, fit: 'stretch', mask }] } as unknown as ImageDoc;
    const before = lit(await decode((await ref.current!.render(base, 360))!));
    const moved = updateLayer<PhotoLayer>(updateLayer<PhotoLayer>(base, 'p', { rotation: 35 }), 'p', { w: 0.6 });
    const stuck = { ...moved, layers: [bg, { ...(moved.layers[1] as PhotoLayer), mask }] } as ImageDoc;
    const dev = await ref.current!.render(moved, 360);
    const srv = await renderImageDoc(moved, 360);
    const old = await ref.current!.render(stuck, 360);
    if (!dev || !srv || !old) {
      log(false, mname, 'nincs kép');
      continue;
    }
    const a = await decode(dev);
    const d = meanDiff(a, await decode(srv));
    const ctl = meanDiff(a, await decode(old));
    log(d <= 6 && ctl > d * 2, `${mname}: forgatott + nyújtott réteg — telefon = szerver`, `${d.toFixed(2)} · ellenpróba (a maszk nem követ) ${ctl.toFixed(2)} /255`);
    // a látható rész a réteggel nő (a szélesség 1,5×), és a réteg közepéhez képest ugyanott forog
    const after = lit(a);
    const ratio = after.area / Math.max(before.area, 1e-6);
    const m2 = (moved.layers[1] as PhotoLayer).mask!;
    log(Math.abs(ratio - 1.5) < 0.15, `${mname}: a látható rész a réteggel nő (1,5×)`, `${ratio.toFixed(2)}× · súlypont ${after.cx.toFixed(3)},${after.cy.toFixed(3)} · maszk ${m2.shape} ${m2.x.toFixed(3)},${m2.y.toFixed(3)}`);
    [dev, srv, old].forEach((u) => removeFile(u));
  }
  setHarness(null);
  removeFile(f.uri);
}
/** ✨ S15: a szöveg ragyogása és árnyéka — energia és hely a vásznon = a kész képen */
export async function smokeTextFx(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  // a ragyogás/árnyék színcsatornájának többlete (a fehér betű r=g=b, a fekete háttér 0) és súlypontja
  const fx = (img: SkImage, ch: 0 | 2) => {
    let e = 0;
    let sx = 0;
    let sy = 0;
    const N = 160;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const p = pixel(img, Math.floor(((j + 0.5) / N) * img.width()), Math.floor(((i + 0.5) / N) * img.height()));
      const v = Math.max(0, p[ch] - p[1]);
      e += v;
      sx += v * (j / N);
      sy += v * (i / N);
    }
    return { e: e / (N * N), cx: e ? sx / e : 0, cy: e ? sy / e : 0 };
  };
  const bg = { id: 'bg', kind: 'fill', fill: '#000000' } as unknown as ImageLayer;
  const mk = (textStyle: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'tfx', name: 'tfx', aspectRatio: '1:1', width: 600, height: 600, layers: [bg, { id: 't', kind: 'text', text: 'Fény', position: { x: 0.5, y: 0.5 }, fontSize: 14, color: '#ffffff', fontFamily: 'Poppins', fontWeight: 'bold', textAlign: 'center', backgroundColor: null, stylePreset: 'plain', textStyle, ...extra }] }) as unknown as ImageDoc;
  const CASES: [string, Record<string, unknown>, 0 | 2, Record<string, unknown>?][] = [
    ['neon stílus', {}, 0, { stylePreset: 'neon', color: '#ff0000' }],
    ['ragyogás kicsi', { glow: { color: '#ff0000', size: 0.15 } }, 0],
    ['ragyogás nagy', { glow: { color: '#ff0000', size: 0.4 } }, 0],
    ['árnyék éles', { shadow: { color: '#0000ff', dx: 0.06, dy: 0.06, blur: 0 } }, 2],
    ['árnyék lágy', { shadow: { color: '#0000ff', dx: 0.05, dy: 0.08, blur: 0.1 } }, 2],
  ];
  for (const [name, style, ch, extra] of CASES) {
    const doc = mk(style, extra);
    const dev = await ref.current!.render(doc, 600);
    const srv = await renderImageDoc(doc, 600);
    if (!dev || !srv) {
      log(false, name, 'nincs kép');
      continue;
    }
    const a = fx(await decode(dev), ch);
    const b = fx(await decode(srv), ch);
    const ratio = a.e / Math.max(b.e, 1e-6);
    const off = Math.hypot(a.cx - b.cx, a.cy - b.cy) * 600;
    log(Math.abs(ratio - 1) <= 0.12 && off <= 4, `${name} — energia és hely telefon = szerver`, `energia ${ratio.toFixed(2)}× (telefon ${a.e.toFixed(2)} · szerver ${b.e.toFixed(2)}) · súlypont-eltérés ${off.toFixed(1)} px`);
    removeFile(dev);
    removeFile(srv);
  }
  setHarness(null);
}
/** 👾 S15: a pixel-art réteg a dokumentum-exportban is éles (legközelebbi szomszéd), telefon = szerver */
export async function smokePixelSharp(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  // 16×16-os sakktábla, cellánként 64 px (mint a `pixelLayerScale` 1024-es rétegképe)
  const surface = Skia.Surface.MakeOffscreen(1024, 1024)!;
  const paint = Skia.Paint();
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
    paint.setColor(Skia.Color((i + j) % 2 ? '#ff2040' : '#20e0ff'));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 64, j * 64, 64, 64), paint);
  }
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_pixel_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  // a réteg dobozán belül a „vegyes” (egyik cellaszínhez sem közeli) képpontok aránya — elmosott él = sok
  const mixed = (img: SkImage, box: { x0: number; y0: number; x1: number; y1: number }) => {
    let n = 0;
    let bad = 0;
    for (let y = Math.ceil(box.y0) + 2; y < box.y1 - 2; y += 1) for (let x = Math.ceil(box.x0) + 2; x < box.x1 - 2; x += 1) {
      const p = pixel(img, x, y);
      const dA = Math.abs(p[0] - 0xff) + Math.abs(p[1] - 0x20) + Math.abs(p[2] - 0x40);
      const dB = Math.abs(p[0] - 0x20) + Math.abs(p[1] - 0xe0) + Math.abs(p[2] - 0xff);
      if (Math.min(dA, dB) > 60) bad += 1;
      n += 1;
    }
    return bad / Math.max(n, 1);
  };
  // az él szélessége: a sorokban a cellahatárokon átlépő vegyes képpontok száma határonként (éles ≤ 1 px)
  const edge = (img: SkImage) => {
    let bad = 0;
    let rows = 0;
    for (let k = 0; k < 16; k++) {
      const y = Math.round(box.y0 + (k + 0.5) * ((box.y1 - box.y0) / 16));
      rows += 1;
      for (let x = Math.ceil(box.x0) + 2; x < box.x1 - 2; x += 1) {
        const p = pixel(img, x, y);
        const dA = Math.abs(p[0] - 0xff) + Math.abs(p[1] - 0x20) + Math.abs(p[2] - 0x40);
        const dB = Math.abs(p[0] - 0x20) + Math.abs(p[1] - 0xe0) + Math.abs(p[2] - 0xff);
        if (Math.min(dA, dB) > 60) bad += 1;
      }
    }
    return bad / (rows * 15);
  };
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
  const bg = { id: 'bg', kind: 'fill', fill: '#000000' } as unknown as ImageLayer;
  // nem egész szorzó: 600 × 0,77 = 462 px a 16 cellára (28,9 px/cella)
  const layer = (pixelArt: unknown) => ({ id: 'px', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 0.77, h: 0.77, fit: 'stretch', ...(pixelArt ? { pixelArt } : {}) });
  const art = { width: 16, height: 16, palette: ['#000000'], frames: [] };
  const doc = (pa: unknown) => ({ id: 'pxd', name: 'pxd', aspectRatio: '1:1', width: 600, height: 600, layers: [bg, layer(pa)] }) as unknown as ImageDoc;
  const box = { x0: 300 - 231, y0: 300 - 231, x1: 300 + 231, y1: 300 + 231 };
  const dev = await ref.current!.render(doc(art), 600);
  const srv = await renderImageDoc(doc(art), 600);
  const devSoft = await ref.current!.render(doc(null), 600);
  const srvSoft = await renderImageDoc(doc(null), 600);
  if (!dev || !srv || !devSoft || !srvSoft) {
    log(false, 'pixel art', 'nincs kép');
  } else {
    const [a, b, c, d] = [await decode(dev), await decode(srv), await decode(devSoft), await decode(srvSoft)];
    const [ma, mb, mc, md] = [mixed(a, box), mixed(b, box), mixed(c, box), mixed(d, box)];
    const [ea, eb, ec, ed] = [edge(a), edge(b), edge(c), edge(d)];
    log(ea <= 1 && ec > ea * 1.5, 'telefon: a pixel-art réteg éles (él-szélesség határonként)', `${ea.toFixed(2)} px · ellenpróba (sima fotóként) ${ec.toFixed(2)} px · vegyes képpont ${(ma * 100).toFixed(2)}% (${(mc * 100).toFixed(2)}%)`);
    log(eb <= 1 && ed > eb * 1.5, 'szerver: a pixel-art réteg éles (él-szélesség határonként)', `${eb.toFixed(2)} px · ellenpróba (sima fotóként) ${ed.toFixed(2)} px · vegyes képpont ${(mb * 100).toFixed(2)}% (${(md * 100).toFixed(2)}%)`);
    const diff = meanDiff(a, b);
    log(diff <= 6, 'pixel art: telefon = szerver', `${diff.toFixed(2)}/255`);
  }
  [dev, srv, devSoft, srvSoft].forEach((u) => u && removeFile(u));
  setHarness(null);
  removeFile(f.uri);
}
/** 🎨 S16: a bevitt kép színprofilja és alfája — a valódi Fájlokból-import útján, telefon és szerver */
const FIX_P3_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABY2lDQ1BrQ0dDb2xvclNwYWNlRGlzcGxheVAzAAAokX2QsUvDUBDGv1aloHUQHRwcMolDlJIKuji0FURxCFXB6pS+pqmQxkeSIgU3/4GC/4EKzm4Whzo6OAiik+jm5KTgouV5L4mkInqP435877vjOCA5bnBu9wOoO75bXMorm6UtJfWMBL0gDObxnK6vSv6uP+P9PvTeTstZv///jcGK6TGqn5QZxl0fSKjE+p7PJe8Tj7m0FHFLshXyieRyyOeBZ71YIL4mVljNqBC/EKvlHt3q4brdYNEOcvu06WysyTmUE1jEDjxw2DDQhAId2T/8s4G/gF1yN+FSn4UafOrJkSInmMTLcMAwA5VYQ4ZSk3eO7ncX3U+NtYMnYKEjhLiItZUOcDZHJ2vH2tQ8MDIEXLW54RqB1EeZrFaB11NguASM3lDPtlfNauH26Tww8CjE2ySQOgS6LSE+joToHlPzA3DpfAEDp2ITpJYOWwAAAARjSUNQDA0AAW4D4+8AAAA4ZVhJZk1NACoAAAAIAAGHaQAEAAAAAQAAABoAAAAAAAKgAgAEAAAAAQAAAECgAwAEAAAAAQAAAEAAAAAAZZlgigAAALFJREFUaAXt0tENgCAUxVBxMPdhRpczzHA+zEvKf2+gZb37uSafe/Llz917wN8FK1ABNNAXQoGMV4AV4kAFUCDjFWCFOFABFMh4BVghDlQABTJeAVaIAxVAgYxXgBXiQAVQIOMVYIU4UAEUyHgFWCEOVAAFMl4BVogDFUCBjFeAFeJABVAg4xVghThQARTIeAVYIQ5UAAUyXgFWiAMVQIGMV4AV4kAFUCDjFWCFODC+wAf7CwHi/UQylwAAAABJRU5ErkJggg==';
const FIX_P3_HEIC = 'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAAD021ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAC9mlwcnAAAALVaXBjbwAAAiRjb2xycHJvZgAAAhhhcHBsBAAAAG1udHJSR0IgWFlaIAfmAAEAAQAAAAAAAGFjc3BBUFBMAAAAAEFQUEwAAAAAAAAAAAAAAAAAAAAAAAD21gABAAAAANMtYXBwbAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACmRlc2MAAAD8AAAAMGNwcnQAAAEsAAAAUHd0cHQAAAF8AAAAFHJYWVoAAAGQAAAAFGdYWVoAAAGkAAAAFGJYWVoAAAG4AAAAFHJUUkMAAAHMAAAAIGNoYWQAAAHsAAAALGJUUkMAAAHMAAAAIGdUUkMAAAHMAAAAIG1sdWMAAAAAAAAAAQAAAAxlblVTAAAAFAAAABwARABpAHMAcABsAGEAeQAgAFAAM21sdWMAAAAAAAAAAQAAAAxlblVTAAAANAAAABwAQwBvAHAAeQByAGkAZwBoAHQAIABBAHAAcABsAGUAIABJAG4AYwAuACwAIAAyADAAMgAyWFlaIAAAAAAAAPbVAAEAAAAA0yxYWVogAAAAAAAAg98AAD2/////u1hZWiAAAAAAAABKvwAAsTcAAAq5WFlaIAAAAAAAACg4AAARCwAAyLlwYXJhAAAAAAADAAAAAmZmAADypwAADVkAABPQAAAKW3NmMzIAAAAAAAEMQgAABd7///MmAAAHkwAA/ZD///ui///9owAAA9wAAMBuAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcGh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAIkIBAQNwAAADALAAAAMAAAMAHqAUIEHBj4h7kWVTcCAgYAiiAAEACUQBwGFyyERTZAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAsaWxvYwAAAABEAAACAAEAAAABAAAESQAAAC4AAgAAAAEAAAQHAAAAQgAAAAFtZGF0AAAAAAAAAIAAAAAGRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAAAAAAAqKAGvovJGxX/tg//qV8hykfjPcRP/+8lH/+yXv/6CxP6f/T5uBwmY4qj8';
const FIX_P3_JPG = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBARXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/+ICKElDQ19QUk9GSUxFAAEBAAACGGFwcGwEAAAAbW50clJHQiBYWVogB+YAAQABAAAAAAAAYWNzcEFQUEwAAAAAQVBQTAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1hcHBsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAwY3BydAAAASwAAABQd3RwdAAAAXwAAAAUclhZWgAAAZAAAAAUZ1hZWgAAAaQAAAAUYlhZWgAAAbgAAAAUclRSQwAAAcwAAAAgY2hhZAAAAewAAAAsYlRSQwAAAcwAAAAgZ1RSQwAAAcwAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAUAAAAHABEAGkAcwBwAGwAYQB5ACAAUAAzbWx1YwAAAAAAAAABAAAADGVuVVMAAAA0AAAAHABDAG8AcAB5AHIAaQBnAGgAdAAgAEEAcABwAGwAZQAgAEkAbgBjAC4ALAAgADIAMAAyADJYWVogAAAAAAAA9tUAAQAAAADTLFhZWiAAAAAAAACD3wAAPb////+7WFlaIAAAAAAAAEq/AACxNwAACrlYWVogAAAAAAAAKDgAABELAADIuXBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbc2YzMgAAAAAAAQxCAAAF3v//8yYAAAeTAAD9kP//+6L///2jAAAD3AAAwG7/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwCnRRRX85n9aH//2Q==';
const FIX_ALPHA_HEIC = 'AAAAKGZ0eXBoZWljAAAAAG1pZjFNaUhFTWlQcm1pYWZNaUhCaGVpYwAAAoFtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAA5waXRtAAAAAAABAAAAOGlpbmYAAAAAAAIAAAAVaW5mZQIAAAAAAQAAaHZjMQAAAAAVaW5mZQIAAAEAAgAAaHZjMQAAAAAaaXJlZgAAAAAAAAAOYXV4bAACAAEAAQAAAaRpcHJwAAABe2lwY28AAAATY29scm5jbHgAAgACAAaAAAAADGNsbGkAywBAAAAAFGlzcGUAAAAAAAAAEAAAABAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAADnBpeGkAAAAAAQgAAAA3YXV4QwAAAAB1cm46bXBlZzpoZXZjOjIwMTU6YXV4aWQ6MQAAAAAMAAAACE4BpQQAAf5AAAAAcWh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAI0IBAQNwAAADALAAAAMAAAMAHqAUIEHAkwziHuRZVNwICBgCogABAAlEAcBhcshEU2QAAABxaHZjQwEECAAAAL/IAAAAAB7wAPz8+PgAAAsDoAABABdAAQwB//8ECAAAAwC/yAAAAwAAHhcCQKEAAQAjQgEBBAgAAAMAv8gAAAMAAB7AUIEHASMGOIF7kWVTcCAgIAiiAAEACUQBwGHSyERTZAAAACFpcG1hAAAAAAAAAAIAAQaBAgMFiIQAAgUDBoeJhAAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAK5AAAAPAACAAAAAQAAAvUAAAAlAAAAAW1kYXQAAAAAAAAAcQAAADgoAa+jVyq07i9b/+j9/+Nj1R//h+I/9+EP/gSVXf/wC8v1k9+//Ozv+/76aaEtNRwgM8ULq1Lu4AAAACEoAa9FtDXhj7xX5aJ+Z5cf0vJG3+b4QYzrQ466VVyAAHA=';
export async function smokeColorIntake(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  const write = (b64: string, name: string) => {
    const f = new File(projectMediaDir(), `smoke_ci_${Date.now().toString(36)}_${name}`);
    f.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    return f.uri;
  };
  const doc = (uri: string) => ({ id: 'ci', name: 'ci', aspectRatio: '1:1', width: 200, height: 200, layers: [{ id: 'bg', kind: 'fill', fill: '#000000' }, { id: 'p', kind: 'photo', uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' }] }) as unknown as ImageDoc;
  const at = async (uri: string | null, x: number, y: number) => (uri ? pixel(await decode(uri), x, y) : []);
  // a P3-ban kódolt szín sRGB-ben (200,100,50); nyers értékként olvasva (187,105,62) lenne
  for (const [name, b64, file] of [['P3 PNG', FIX_P3_PNG, 'p3.png'], ['P3 HEIC (iPhone-fotó)', FIX_P3_HEIC, 'p3.heic']] as const) {
    const src = write(b64, file);
    const got = await ingestImageFile(src);
    if (got.status !== 'ok') {
      log(false, `${name}: import`, 'nem olvasható');
      continue;
    }
    const dev = await ref.current!.render(doc(got.uri), 200);
    const srv = await renderImageDoc(doc(got.uri), 200);
    const [a, b] = [await at(dev, 100, 100), await at(srv, 100, 100)];
    const err = (p: number[]) => (p.length ? Math.max(Math.abs(p[0] - 200), Math.abs(p[1] - 100), Math.abs(p[2] - 50)) : 999);
    log(err(a) <= 4, `${name}: telefon — a szín sRGB-ben helyes`, `${a.slice(0, 3).join(',')} (várt 200,100,50; nyersen 187,105,62) · import: ${got.uri.split('.').pop()}`);
    log(err(b) <= 4, `${name}: szerver — a szín sRGB-ben helyes`, `${b.slice(0, 3).join(',')}`);
    [src, got.uri, dev, srv].forEach((u) => u && removeFile(u));
  }
  // sebesség: 12 MP-es (4032×3024) JPEG a P3-profillal (egy kis P3-JPEG APP2-darabja a SOI mögé illesztve)
  {
    const small = Uint8Array.from(atob(FIX_P3_JPG), (c) => c.charCodeAt(0));
    let o = 2;
    let app2: Uint8Array | null = null;
    while (o + 4 <= small.length && small[o] === 0xff) {
      const len = (small[o + 2] << 8) | small[o + 3];
      if (small[o + 1] === 0xe2) app2 = small.subarray(o, o + 2 + len);
      o += 2 + len;
    }
    const surf = Skia.Surface.MakeOffscreen(4032, 3024)!;
    const pt = Skia.Paint();
    pt.setColor(Skia.Color('rgb(187,105,62)'));
    surf.getCanvas().drawRect(Skia.XYWHRect(0, 0, 4032, 3024), pt);
    surf.flush();
    const jpg = surf.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 92);
    const big = new Uint8Array(jpg.length + (app2?.length ?? 0));
    big.set(jpg.subarray(0, 2), 0);
    if (app2) big.set(app2, 2);
    big.set(jpg.subarray(2), 2 + (app2?.length ?? 0));
    const f = new File(projectMediaDir(), `smoke_ci_big_${Date.now().toString(36)}.jpg`);
    f.write(big);
    const t0 = Date.now();
    const r = await toSrgbIfNeeded(f.uri);
    const ms = Date.now() - t0;
    const px = pixel(await decode(f.uri), 2000, 1500);
    log(r.converted && ms < 3000 && Math.abs(px[0] - 200) <= 4, '12 MP-es P3-fotó sRGB-re váltása', `${ms} ms · ${r.kind} · középpont ${px.slice(0, 3).join(',')}`);
    removeFile(f.uri);
  }
  // alfás HEIC: bal fele zöld, jobb fele átlátszó
  const src = write(FIX_ALPHA_HEIC, 'alpha.heic');
  const got = await ingestImageFile(src);
  if (got.status !== 'ok') {
    log(false, 'alfás HEIC: import', 'nem olvasható');
  } else {
    const img = await decode(got.uri);
    const [l, r] = [pixel(img, 2, 8), pixel(img, 13, 8)];
    log(l[3] === 255 && r[3] === 0, 'alfás HEIC: az import megtartja az átlátszóságot', `${got.uri.split('.').pop()} · bal α=${l[3]}, jobb α=${r[3]}`);
    const srv = await renderImageDoc(doc(got.uri), 200);
    const s2 = await at(srv, 150, 100);
    log(s2.length > 0 && s2[0] + s2[1] + s2[2] < 30, 'alfás HEIC: a szerveres képen az átlátszó rész a háttér (fekete)', `${s2.slice(0, 3).join(',')}`);
    [got.uri, srv].forEach((u) => u && removeFile(u));
  }
  removeFile(src);
  setHarness(null);
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
/** 🎨 S17: színenkénti HSL korrekciós rétegen (maszkkal is) és színegyensúly a veremben — telefon = szerver */
export async function smokeAdjustHsl(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(<View style={{ width: 1, height: 1 }}><RenderStage ref={ref} /></View>);
  await sleep(300);
  // négy színsáv: piros, zöld, kék, szürke
  const surface = Skia.Surface.MakeOffscreen(400, 400)!;
  const paint = Skia.Paint();
  ['#d03030', '#30b040', '#3050d0', '#808080'].forEach((col, i) => {
    paint.setColor(Skia.Color(col));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 100, 0, 100, 400), paint);
  });
  surface.flush();
  const f = new File(projectMediaDir(), `smoke_adjhsl_${Date.now().toString(36)}.png`);
  f.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
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
  const photo = (extra: Record<string, unknown> = {}) => ({ id: 'p', kind: 'photo', uri: f.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra });
  const doc = (layers: unknown[]) => ({ id: 'ah', name: 'ah', aspectRatio: '1:1', width: 400, height: 400, layers }) as unknown as ImageDoc;
  const hsl = { red: { h: 0.4, s: 0.3 }, blue: { l: -0.4 } };
  const stack = [createAdjustment('colorBalance', { balance: { sh: { b: 0.4 }, mid: { r: 0.3, g: -0.2 }, hi: { g: 0.3 } } }, 'cb')];
  const CASES: [string, ImageDoc][] = [
    ['HSL korrekciós rétegen', doc([photo(), { id: 'a', kind: 'adjust', hsl }])],
    ['HSL maszkolt korrekciós rétegen', doc([photo(), { id: 'a', kind: 'adjust', hsl, mask: { shape: 'rectangle', x: 0.25, y: 0.5, w: 0.5, h: 1, feather: 0 } }])],
    ['HSL + grade + adjust egy korrekciós rétegen', doc([photo(), { id: 'a', kind: 'adjust', grade: 'teal-orange', adjust: { saturation: 0.3 }, hsl }])],
    ['színegyensúly a veremben', doc([photo({ adjustmentStack: stack, adjust: flattenAdjustments(stack) })])],
  ];
  const plain = await ref.current!.render(doc([photo()]), 400);
  for (const [name, d] of CASES) {
    const dev = await ref.current!.render(d, 400);
    const srv = await renderImageDoc(d, 400);
    if (!dev || !srv || !plain) {
      log(false, name, 'nincs kép');
      continue;
    }
    const a = await decode(dev);
    const diff = meanDiff(a, await decode(srv));
    const ctl = meanDiff(a, await decode(plain));
    log(diff <= 6 && ctl > diff * 2, `${name} — telefon = szerver`, `${diff.toFixed(2)} · ellenpróba (korrekció nélkül) ${ctl.toFixed(2)} /255`);
    [dev, srv].forEach((u) => removeFile(u));
  }
  if (plain) removeFile(plain);
  setHarness(null);
  removeFile(f.uri);
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
