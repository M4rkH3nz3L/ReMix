/** 🧪 Füstteszt — festés: ecset-motor, festett maszk, retus. (Áthelyezve: phases01, phases02; viselkedés-változás nélkül.) */
import { type SkImage, Skia, ImageFormat } from '@shopify/react-native-skia';
import { type ReactNode, type RefObject, createRef } from 'react';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { renderStrokes, type BrushHandle, BrushOverlay } from '@/components/studio/image/BrushOverlay';
import { type Stroke, DEFAULT_BRUSH, type RetouchTool } from '@/lib/brushEngine';
import { renderImageDoc } from '@/lib/imageDocClient';
import type { ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { pixel, decode, removeFile, meanDiff } from '../../helpers/image';
import { File } from 'expo-file-system';
import { updateLayer } from '@/lib/imageDoc';
import { applyRing, rectRing, selectionToMask } from '@/lib/selection';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { projectMediaDir } from '@/lib/projectFolderClient';
import '@/lib/dspNativeClient';

/** Az ecset-motor a valódi Skia-rajzon, a valódi overlay-en át; a hibás logikát mind ellenpróba fogja meg. */
export async function smokeBrushEngine(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const line = (extra: Partial<Stroke>, y = 0.5): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color: '#ff0000', width: 0.1, hardness: 1, opacity: 1, eraser: false, ...extra });
  const size = 400;
  const alpha = (img: SkImage, x: number, y: number) => pixel(img, x, y)[3];

  // átlátszóság: önmagát keresztező vonás a metszésben sem sötétedik
  const cross: Stroke = { ...line({ opacity: 0.5 }), points: [{ x: 0.1, y: 0.5, p: 1 }, { x: 0.9, y: 0.5, p: 1 }, { x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }] };
  const a = renderStrokes([cross], size, size)!;
  const [one, both] = [alpha(a, 100, 200), alpha(a, 200, 200)];
  log(Math.abs(one - 128) <= 3 && Math.abs(both - one) <= 3, 'átlátszóság: a vonás önmagán nem halmozódik', `vonalon α=${one}, keresztezésben α=${both}`);
  const twice = renderStrokes([line({ opacity: 0.5 }), line({ opacity: 0.5 })], size, size)!;
  log(alpha(twice, 200, 200) > 180, 'ellenpróba: két külön vonás már fed', `α=${alpha(twice, 200, 200)}`);

  // keménység: az él mennyire fokozatos
  const edgeBand = (s: Stroke) => {
    const img = renderStrokes([s], size, size)!;
    let band = 0;
    for (let y = 120; y < 200; y++) {
      const v = alpha(img, 200, y);
      if (v > 12 && v < 243) band += 1;
    }
    return band;
  };
  const [hard, soft] = [edgeBand(line({ hardness: 1 })), edgeBand(line({ hardness: 0 }))];
  log(hard <= 3 && soft >= 10, 'keménység: a lágy él fokozatos, a kemény éles', `átmenet: kemény ${hard} px, lágy ${soft} px`);

  // nyomás
  const widthAt = (p: number) => {
    const img = renderStrokes([{ ...line({}), points: [{ x: 0.1, y: 0.5, p }, { x: 0.9, y: 0.5, p }] }], size, size)!;
    let n = 0;
    for (let y = 100; y < 300; y++) if (alpha(img, 200, y) > 128) n += 1;
    return n;
  };
  const [light, heavy] = [widthAt(0), widthAt(1)];
  log(Math.abs(heavy - 40) <= 1 && Math.abs(light - 10) <= 1, 'nyomás: a vastagság a nyomást követi', `könnyű ${light} px, erős ${heavy} px`);

  // radír: csak a metszetben lyukaszt
  const erased = renderStrokes([line({}), { ...line({ eraser: true }), points: [{ x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }] }], size, size)!;
  log(alpha(erased, 200, 200) === 0 && alpha(erased, 100, 200) === 255, 'radír: a keresztezésben lyuk, mellette érintetlen', `metszet α=${alpha(erased, 200, 200)}, mellette α=${alpha(erased, 100, 200)}`);

  // a valódi overlay: vonásonkénti undo, és az előnézet = export
  const box = { w: 300, h: 300 };
  const ref = createRef<BrushHandle>();
  const view = createRef<View>() as RefObject<View>;
  const history: string[] = [];
  const mount = (baseUri?: string) =>
    setHarness(
      <View ref={view} collapsable={false} style={{ width: box.w, height: box.h, backgroundColor: 'transparent' }}>
        <BrushOverlay ref={ref} box={box} settings={DEFAULT_BRUSH} baseUri={baseUri} onHistory={(u, r) => history.push(`${u}/${r}`)} />
      </View>
    );
  mount();
  await sleep(500);
  ref.current!.addStroke(line({ color: '#00ff00', opacity: 0.6, hardness: 0.3 }, 0.3));
  ref.current!.addStroke(line({ color: '#0000ff' }, 0.7));
  await sleep(300);
  ref.current!.undo();
  await sleep(300);
  const undone = await decode(ref.current!.exportPng(300, 300)!);
  log(alpha(undone, 150, 90) > 100 && alpha(undone, 150, 210) === 0, 'undo: csak az utolsó vonás tűnik el', `első α=${alpha(undone, 150, 90)}, második α=${alpha(undone, 150, 210)}`);
  log(history[history.length - 1] === 'true/true', 'a gombok állapota követi az előzményt', history[history.length - 1]);
  ref.current!.redo();
  await sleep(300);
  const shot = await captureRef(view, { format: 'png', quality: 1, width: 300 / ratio, height: 300 / ratio });
  const uri = ref.current!.exportPng(300, 300)!;
  const [screen, png] = [await decode(shot), await decode(uri)];
  // egyetlen élpixel bármit mutathat, ezért a rácspontok arányát mérjük
  let bad = 0;
  let total = 0;
  const sample: string[] = [];
  for (let y = 10; y < 290; y += 6) {
    for (let x = 40; x < 260; x += 6) {
      const [p, q] = [pixel(screen, x, y), pixel(png, x, y)];
      total += 1;
      // az alig látszó szélen a szín nem számít, az alfa viszont kiszúrná a hiányzó rajzot
      const seen = p[3] > 64 && q[3] > 64;
      if (Math.abs(p[3] - q[3]) > 40 || (seen && [0, 1, 2].some((c) => Math.abs(p[c] - q[c]) > 40))) {
        bad += 1;
        if (sample.length < 3) sample.push(`${x},${y}: ${p} / ${q}`);
      }
    }
  }
  log(bad / total <= 0.03 && alpha(png, 150, 210) === 255, 'előnézet = PNG az overlay-en', `${bad}/${total} rácspont tér el ${sample.join(' | ')}`);
  removeFile(shot);

  // festett réteg folytatása: a radír a korábbi festést is törli
  setHarness(null);
  await sleep(100);
  mount(uri);
  await sleep(900);
  ref.current!.addStroke({ ...line({ eraser: true }, 0.7) });
  await sleep(300);
  const reopened = await decode(ref.current!.exportPng(300, 300)!);
  log(alpha(reopened, 150, 90) > 100 && alpha(reopened, 150, 210) === 0, 'újranyitott festésen a radír a régi vonást törli', `megmaradó α=${alpha(reopened, 150, 90)}, törölt α=${alpha(reopened, 150, 210)}`);

  // az export a szerver útján is ugyanazt adja
  const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 300, height: 300, layers: [{ kind: 'photo', id: 'p', uri, paint: true, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'contain' }] } as unknown as ImageDoc;
  const server = await renderImageDoc(doc, 300);
  if (server) {
    const s = await decode(server);
    const [g, b] = [pixel(s, 150, 90), pixel(s, 150, 210)];
    const [eg, eb] = [pixel(png, 150, 90), pixel(png, 150, 210)];
    log(Math.abs(b[2] - eb[2]) <= 8 && Math.abs(b[3] - eb[3]) <= 8 && Math.abs(g[3] - eg[3]) <= 20, 'a szerver-export a festést adja', `kék ${b} (várt ${eb}), zöld ${g} (várt ${eg})`);
    removeFile(server);
  } else {
    log(false, 'a szerver-export a festést adja', 'nincs render');
  }
  removeFile(uri);
  setHarness(null);
}
/** A festett maszk: a valódi overlay festi, a valódi vászon mutatja, a szerver ellen mérve. */
export async function smokePaintMask(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
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
  const png = new File(projectMediaDir(), `smoke_pm_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as PhotoLayer;
  const docOf = (l: PhotoLayer) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, l] }) as unknown as ImageDoc;
  const line = (color: string, y: number, extra: Partial<Stroke> = {}): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color, width: 0.14, hardness: 1, opacity: 1, eraser: false, ...extra });

  const ref = createRef<BrushHandle>();
  setHarness(
    <View style={{ width: 300, height: 300, backgroundColor: '#406080' }}>
      <BrushOverlay ref={ref} box={{ w: 300, h: 300 }} settings={DEFAULT_BRUSH} maskMode />
    </View>
  );
  await sleep(500);
  ref.current!.addStroke(line('#000000', 0.3));
  ref.current!.addStroke(line('#000000', 0.7, { hardness: 0.2, opacity: 0.6 }));
  await sleep(400);
  log(true, 'FOTÓZHATÓ', 'a maszk-festés nézete a kijelzőn');
  await sleep(5000);
  const uri = ref.current!.exportPng(320, 320)!;
  const m = await decode(uri);
  log(pixel(m, 160, 96)[0] < 10 && pixel(m, 160, 10)[0] > 245, 'a maszk: rejtett fekete, a többi fehér', `rejtett ${pixel(m, 160, 96)}, látható ${pixel(m, 160, 10)}`);
  setHarness(null);
  await sleep(80);

  // a meglévő kijelölésből induló festés a formát hozza
  const seedRing = applyRing(null, rectRing({ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }), 'new')!;
  const seeded = renderStrokes([], 320, 320, null, null, selectionToMask(seedRing))!;
  log(pixel(seeded, 160, 160)[0] > 245 && pixel(seeded, 20, 20)[0] < 10, 'a meglévő maszk formája átjön a festésbe', `belül ${pixel(seeded, 160, 160)}, kívül ${pixel(seeded, 20, 20)}`);

  const mask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: uri } as PhotoLayer['mask'];
  const moved = updateLayer<PhotoLayer>(docOf(photo({ mask })), 'p', { position: { x: 0.62, y: 0.55 } });
  const cases: [string, ImageDoc][] = [
    ['festett maszk', docOf(photo({ mask }))],
    ['lágy szélű maszk', docOf(photo({ mask: { ...mask!, feather: 0.015 } }))],
    ['mozgatott réteg maszkja', moved],
    ['elforgatott réteg', docOf(photo({ mask, rotation: 25, w: 0.7, h: 0.7 }))],
  ];
  for (const [name, doc] of cases) {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const plainDoc = { ...doc, layers: doc.layers.map((l) => (l.kind === 'photo' ? { ...l, mask: undefined } : l)) } as ImageDoc;
    const [out, plain] = [await renderImageDoc(doc, 320), await renderImageDoc(plainDoc, 320)];
    if (!out || !plain) {
      log(false, `festett maszk = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(out), 320, 320);
    const ctl = meanDiff(a, await decode(plain), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `festett maszk = export: ${name}`, `átlag ${d.toFixed(1)}/255; maszk nélkül ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(out);
    removeFile(plain);
  }
  removeFile(uri);
  removeFile(png.uri);
}
/** A retus-eszközök a valódi Skia-rajzon: a vonás alatt változik, mellette a réteg átlátszó marad. */
export async function smokeRetouch(log: Log) {
  const size = 400;
  const surface = Skia.Surface.MakeOffscreen(size, size)!;
  const c = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#606060'));
  c.drawRect(Skia.XYWHRect(0, 0, size, size), paint);
  paint.setColor(Skia.Color('#d04020'));
  c.drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  paint.setColor(Skia.Color('#ffffff'));
  for (let i = 0; i < 20; i++) {
    c.drawRect(Skia.XYWHRect(0, i * 20, 200, 4), paint); // mintázat a klónhoz
  }
  surface.flush();
  const source = surface.makeImageSnapshot().makeNonTextureImage()!;
  const line = (tool: RetouchTool, y: number, offset?: { x: number; y: number }, extra: Partial<Stroke> = {}): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color: '#000000', width: 0.1, hardness: 1, opacity: 1, eraser: false, tool, offset, ...extra });
  const render = (s: Stroke) => renderStrokes([s], size, size, null, null, null, source)!;

  // klón: a jobb alsó szürke helyre a bal felső mintás piros kerül
  const clone = render(line('clone', 0.75, { x: -0.5, y: -0.5 }));
  const [dst, src] = [pixel(clone, 300, 303), pixel(source, 100, 103)];
  log(Math.abs(dst[0] - src[0]) <= 2 && Math.abs(dst[1] - src[1]) <= 2 && dst[3] === 255, 'klón: a forrás pixele kerül a célra', `cél ${dst}, forrás ${src}`);
  log(pixel(clone, 300, 100)[3] === 0, 'klón: a vonáson kívül átlátszó', `α=${pixel(clone, 300, 100)[3]}`);

  // folt: a minta jön át, de a cél szürke tónusa marad (a klón pirosat adna)
  const heal = render(line('heal', 0.75, { x: -0.5, y: -0.5 }, { width: 0.1 }));
  // egy pixel a minta miatt eltérhet: a terület átlagos színe a döntő
  const mean = (img: SkImage) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = 285; y < 315; y++) {
      for (let x = 240; x < 340; x += 3) {
        const p = pixel(img, x, y);
        [0, 1, 2].forEach((k) => (sum[k] += p[k]));
        n += 1;
      }
    }
    return sum.map((v) => Math.round(v / n));
  };
  const [hm, cm] = [mean(heal), mean(clone)];
  const healSpread = Math.max(...hm) - Math.min(...hm);
  const cloneSpread = Math.max(...cm) - Math.min(...cm);
  let [hi0, lo0] = [0, 255];
  for (let y = 285; y < 315; y++) {
    const v = pixel(heal, 300, y)[1];
    hi0 = Math.max(hi0, v);
    lo0 = Math.min(lo0, v);
  }
  log(healSpread <= 40 && Math.abs(hm[1] - 96) <= 45 && cloneSpread > 60 && hi0 - lo0 > 40, 'folt: a cél tónusa marad, a minta átjön', `folt átlag ${hm}, klón átlag ${cm}, minta terjedelme ${hi0 - lo0}`);

  const base = pixel(source, 300, 300);
  const dodge = pixel(render(line('dodge', 0.75)), 300, 300);
  const burn = pixel(render(line('burn', 0.75)), 300, 300);
  log(Math.abs(dodge[0] - base[0] * 1.35) <= 3 && Math.abs(burn[0] - base[0] * 0.65) <= 3, 'világosít és sötétít', `alap ${base[0]}, világos ${dodge[0]}, sötét ${burn[0]}`);
  const half = pixel(render(line('dodge', 0.75, undefined, { opacity: 0.5 })), 300, 300);
  log(Math.abs(half[3] - 128) <= 3, 'az erősség az átlátszóságon át hat', `α=${half[3]}`);

  // elmosás: a piros-szürke él elmosódik; élesítés: túllövés az élen
  const edge = (y: number, tool: RetouchTool) => pixel(render({ ...line(tool, 0.5), points: [{ x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }], width: 0.2 }), 200 + y, 310);
  const blurred = edge(-3, 'blur');
  log(blurred[0] > 100 && blurred[0] < 130 + 60, 'elmosás: az él átmenetet kap', `él mellett ${blurred}`);
  const sharpSurface = render({ ...line('sharpen', 0.25), points: [{ x: 0.1, y: 0.25, p: 1 }, { x: 0.45, y: 0.25, p: 1 }], width: 0.2 });
  let [hi, orig] = [0, 0];
  for (let y = 60; y < 140; y++) {
    hi = Math.max(hi, pixel(sharpSurface, 100, y)[1]);
    orig = Math.max(orig, pixel(source, 100, y)[1]);
  }
  let lo = 255;
  for (let y = 60; y < 140; y++) lo = Math.min(lo, pixel(sharpSurface, 100, y)[1]);
  const origLo = pixel(source, 100, 110)[1];
  log(lo < origLo - 10, 'élesítés: a sötét oldal mélyül az élen', `legsötétebb ${lo}, eredeti ${origLo}`);

  // forrás nélkül nincs rajz
  const empty = renderStrokes([line('clone', 0.75, { x: 0, y: 0 })], size, size)!;
  log(pixel(empty, 300, 300)[3] === 0, 'forrás nélkül nem fest feketét', `${pixel(empty, 300, 300)}`);
}
