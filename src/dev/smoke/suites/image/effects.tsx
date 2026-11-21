/** 🧪 Füstteszt — réteg-effektek és szöveg: belső stílusok, lencse, sorköz, maszk-követés, szöveg-effekt, pixel-élesség. (Áthelyezve: phases10; viselkedés-változás nélkül.) */
import { type SkSurface as SkSurfaceT, Skia, ImageFormat, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { type ReactNode, type RefObject, createRef } from 'react';
import { Platform, Dimensions, View } from 'react-native';
import { updateLayer } from '@/lib/imageDoc';
import { type RenderStageHandle, RenderStage } from '@/components/studio/image/RenderStage';
import { renderImageDoc } from '@/lib/imageDocClient';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { ImageLayer, ImageDoc, ClipMask, PhotoLayer } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { pixel, decode, removeFile } from '../../helpers/image';
import '@/lib/dspNativeClient';

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
