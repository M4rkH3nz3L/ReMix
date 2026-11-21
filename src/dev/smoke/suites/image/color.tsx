/** 🧪 Füstteszt — szín: HSL/fényerő, korrekciós HSL, színprofil-bevitel, lookok. (Áthelyezve: phases02, phases10, phases11; viselkedés-változás nélkül.) */
import { Skia, ImageFormat, ColorType, AlphaType, type SkImage } from '@shopify/react-native-skia';
import { File } from 'expo-file-system';
import { type ReactNode, type RefObject, createRef } from 'react';
import { View, Dimensions, Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { renderImageDoc } from '@/lib/imageDocClient';
import { layerHistogram } from '@/components/studio/image/HistogramView';
import { HslSheet } from '@/components/studio/image/HslSheet';
import { computeHistogram, histogramShift } from '@/lib/histogram';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { projectMediaDir } from '@/lib/projectFolderClient';
import type { PhotoLayer, ImageDoc } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { decode, meanDiff, removeFile, pixel } from '../../helpers/image';
import { ingestImageFile } from '@/lib/media';
import { type RenderStageHandle, RenderStage } from '@/components/studio/image/RenderStage';
import { toSrgbIfNeeded } from '@/lib/colorIntakeClient';
import { createAdjustment, flattenAdjustments } from '@/lib/adjustmentStack';
import { IMAGE_LOOKS, applyLook } from '@/lib/imageLooks';
import '@/lib/dspNativeClient';

/** A színenkénti HSL és a fényerő a vásznon a szerver ellen; a hisztogram a kész export eloszlása ellen. */
export async function smokeColor(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  const colors = ['#e02020', '#e08020', '#e0d020', '#30c040', '#20c0c0', '#2040e0', '#8040e0', '#e020a0', '#808080'];
  colors.forEach((col, i) => {
    paint.setColor(Skia.Color(col));
    c.drawRect(Skia.XYWHRect((i % 3) * 107, Math.floor(i / 3) * 107, 107, 107), paint);
  });
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_col_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const photo = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as PhotoLayer;
  const docOf = (l: PhotoLayer) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [l] }) as unknown as ImageDoc;
  const source = await decode(png.uri);
  const cases: [string, Partial<PhotoLayer>][] = [
    ['piros kifakítva', { hsl: { red: { s: -1 } } }],
    ['kék árnyalat', { hsl: { blue: { h: 1 } } }],
    ['zöld világosítva', { hsl: { green: { l: 1 } } }],
    ['több sáv', { hsl: { orange: { h: -0.7, s: 0.5 }, aqua: { l: -0.8 }, magenta: { s: -0.6, h: 0.4 } } }],
    ['HSL + korrekció', { adjust: { contrast: 0.3 }, hsl: { yellow: { s: -1 } } }],
    ['fényerő', { adjust: { brightness: 0.2 } }],
  ];
  for (const [name, extra] of cases) {
    const layer = photo(extra);
    const doc = docOf(layer);
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
    const [uri, plainUri] = [await renderImageDoc(doc, 320), await renderImageDoc(docOf(photo({})), 320)];
    if (!uri || !plainUri) {
      log(false, `szín = export: ${name}`, 'nincs render');
      continue;
    }
    const server = await decode(uri);
    const d = meanDiff(a, server, 320, 320);
    const ctl = meanDiff(a, await decode(plainUri), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `szín = export: ${name}`, `átlag ${d.toFixed(1)}/255; a beállítás nélkül ${ctl.toFixed(1)}`);
    // a hisztogram az eszközön számolt: a kész exporttal kell egyeznie, az eredetitől eltérnie
    const hist = layerHistogram(source, layer)!;
    const px = server.readPixels(0, 0, { width: 320, height: 320, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
    const real = computeHistogram(px);
    const before = layerHistogram(source, photo({}))!;
    const dist = Math.max(histogramShift(hist.r, real.r), histogramShift(hist.g, real.g), histogramShift(hist.b, real.b));
    const change = Math.max(histogramShift(before.r, real.r), histogramShift(before.g, real.g), histogramShift(before.b, real.b));
    log(dist <= 3 && change >= dist * 2, `hisztogram = export: ${name}`, `eltérés ${dist.toFixed(1)} szint; az eredetitől ${change.toFixed(1)} szint`);
    removeFile(shot);
    removeFile(uri);
    removeFile(plainUri);
  }
  setHarness(
    <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center', height: 320 }}>
      <HslSheet doc={docOf(photo({ hsl: { red: { s: -0.5 } } }))} layer={photo({ hsl: { red: { s: -0.5 } } })} commit={() => {}} onClose={() => {}} />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a HSL-lap a kijelzőn');
  await sleep(6000);
  setHarness(null);
  removeFile(png.uri);
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
