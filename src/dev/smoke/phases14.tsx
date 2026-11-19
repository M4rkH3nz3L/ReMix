/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { File, Paths } from 'expo-file-system';
import { Dimensions, Platform } from 'react-native';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import { exportAudioToFile } from '@/lib/render';
import { audioExportSettings } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { mixRange, offlineMixPlan , encodeWav16 } from '@/lib/offlineMix';
import { editGridRate } from '@/lib/frames';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { previewEngine } from '@/lib/previewEngine';
import { beatSplitTimes } from '@/lib/audioTransport';
import { cloudAvailable } from '@/lib/backend';
import { highShelfNorm, KERNEL, nativeDspActive, runKernel, runKernelJs, type KernelKind } from '@/lib/dspKernels';
import '@/lib/dspNativeClient';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { useSpeechEdit } from '@/store/speechEditStore';
import { currentSpeechWords } from '@/components/studio/audio/SpeechEditBar';
import { clearSpeechWordCache } from '@/lib/speechEditClient';
import { wordCutRanges } from '@/lib/speechEdit';
import { gccPhatLag, SYNC_MIN_CONFIDENCE } from '@/lib/audioSync';
import { syncClipTo } from '@/lib/audioSyncClient';
import { exportParts } from '@/components/studio/audio/exportParts';
import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { crc32, localDataOffset, parseCentralDirectory, parseEocd } from '@/lib/zipStore';
import { t as i18nT, type TFunction } from 'i18next';
import { canSegment, setLongThresholdForTest } from '@/lib/longSource';
import { whisperEngineAvailable } from '@/lib/nativeEngines';
import { catalogRuntime, downloadModel, listCachedModels } from '@/lib/modelRegistryClient';
import { bestUsableWhisperModelId, lastRawTokens, runWhisperSmokeTest, transcribeWordsOnDevice } from '@/lib/whisperClient';
import { catalogAvailability, catalogEntry } from '@/lib/modelCatalog';
import { decodeToMono16k } from '@/lib/audioDecode';
import { findClipSilences } from '@/lib/audioSilenceClient';
import { trimAudioRight } from '@/lib/audioTrim';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { mixForExport } from '@/lib/audioExportMix';
import { createEmptyProject, splitClip } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, cloudInThisBuild, sleep, smokeFileHost, toneWav } from './shared';

/** a sáv megjelenített neve (a stem-fájlnévhez) */
function laneLabelFor(type: string, t: TFunction): string {
  const lane = audioLanes(useEditorStore.getState().project).find((l) => l.type === type);
  return lane ? laneLabel(lane, t) : type;
}
/** 🎬 AP8: a videóból nyitott Hang Stúdióban a lejátszófejhez tartozó videó-képkocka látszik (± 1 kocka). */
export async function smokeVideoRef(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { downloadToCache } = await import('@/lib/media');
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, 'smoke_videoref.mp4');
  if (!vid) {
    log(false, 'a teszt-videó letöltése', 'nincs');
    return;
  }
  const id = 'prj_smoke_videoref';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoref', caught));
  const base = createEmptyProject('smoke videó-referencia', '9:16');
  const video = { kind: 'video', id: 'vv', uri: vid, label: 'videó', start: 0, duration: 6, trimIn: 0, speed: 1, volume: 1 } as unknown as AudioClip;
  const music: AudioClip = { kind: 'audio', id: 'aa', label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, uri: toneWav('smoke_videoref.wav', 6), volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, fps: 30, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video] } : t.type === 'music' ? { ...t, clips: [music] } : t)) });
  router.push(`/editor/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  try {
    st().openAudioStudio('aa');
    await sleep(1200);
    for (const at of [2.5, 4.0]) {
      st().setPlayhead(at);
      type Ref = { ms: number; clipId: string; uri: string; at: number };
      let ref = null as Ref | null;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        ref = runDevAction('audio.videoRef') as Ref | null;
        if (ref && Math.abs(ref.at - at) < 1e-6) break;
      }
      const ok = !!ref && ref.clipId === 'vv' && Math.abs(ref.ms - at * 1000) <= 34 && new File(ref.uri).exists;
      log(ok, `lejátszófej ${at} s → a videó ${at} s-os képkockája látszik (± 1 kocka)`, ref ? `${ref.ms} ms, ${ref.clipId}` : 'nincs kép');
      if (at === 2.5) {
        log(true, 'FOTÓZHATÓ', 'a videóból nyitott Hang Stúdió a lebegő videó-képkockával');
        await sleep(2000);
      }
    }
  } finally {
    st().closeAudioStudio();
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoref-del', caught));
  }
}
/** ⏱️ DSP-profil az eszközön (Hermes): 3 klip 8 s-a fokozatonként (ideiglenes mérés). */
export async function smokeDspProf(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const src = Float32Array.from({ length: 20 * SR }, (_, i) => Math.sin(i / 20) * 0.3);
  const run = (fx: object, master: boolean, sec = 2) => {
    const base = createEmptyProject('x', '9:16', undefined, 'audio');
    const mk = (cid: string, start: number, pan: number) => ({ kind: 'audio', id: cid, uri: 'file:///a.wav', label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, pan, audioFx: fx, source: 'imported' });
    const project = { ...base, ...(master ? { audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: -1, high: 1.5 }, multiband: true } } : {}), tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.5)] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 0.5, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('v', 1, 0)] } : t)) } as unknown as Project;
    const plan = { ...offlineMixPlan(project), masterGain: 1 };
    const sources = new Map([['file:///a.wav', { channels: [src, src], sampleRate: SR }]]);
    const state = new Map();
    const CH = Math.round(0.125 * SR);
    const t0 = Date.now();
    for (let a = SR; a < (1 + sec) * SR; a += CH) {
      const out: [Float32Array, Float32Array] = [new Float32Array(CH), new Float32Array(CH)];
      mixRange(plan, sources as never, out, a, a + CH, 1, state);
    }
    return Math.round((Date.now() - t0) / (sec * 8));
  };
  const all = { highpass: 90, lowpass: 12000, eq: { low: 3, mid: -2, high: 2 }, gate: true, deEsser: true, compressor: true, reverb: 0.5, delay: 0.4, stereoWide: true, limiter: true };
  run({}, false, 1);
  const rows = [`semmi ${run({}, false)}`, `master ${run({}, true)}`];
  for (const [k, v] of Object.entries(all)) rows.push(`${k} ${run({ [k]: v }, false)}`);
  rows.push(`mind ${run(all, false)}`, `mind+master ${run(all, true)}`);
  log(null, 'ms / 125 ms-os szelet (3 klip)', rows.join(' | '));
  // egy mag-hívás ára (5512 mintás sztereó szelet): a natív számítás vs a híváskeret
  const bl = new Float32Array(5512);
  const br = new Float32Array(5512);
  const bp = Float64Array.of(0.2, 0.4, 0.2, -0.5, 0.3);
  const bs = new Float64Array(8);
  let t1 = Date.now();
  for (let k = 0; k < 200; k++) runKernel(KERNEL.BIQUAD, bl, br, bp, bs);
  const nat = (Date.now() - t1) / 200;
  t1 = Date.now();
  for (let k = 0; k < 20; k++) runKernelJs(KERNEL.BIQUAD, bl, br, bp, bs);
  const jsMs = (Date.now() - t1) / 20;
  const sm = new Float32Array(64);
  t1 = Date.now();
  for (let k = 0; k < 2000; k++) runKernel(KERNEL.BIQUAD, sm, sm, bp, bs);
  log(null, 'egy biquad-hívás', `natív ${nat.toFixed(3)} ms · JS ${jsMs.toFixed(2)} ms · üres hívás ${((Date.now() - t1) / 2000).toFixed(3)} ms`);
}
/** ⚡ A natív DSP-mag = a JS-mag, bitre (minden fajta, darabolva, eltolt `subarray`-jel is); és a sebesség. */
export async function smokeDspNative(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(nativeDspActive(), 'a natív DSP-mag be van kötve (a build tudja)', `${nativeDspActive()}`);
  if (!nativeDspActive()) return;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const sig = (n: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * (Math.sin(i / 7) * 0.6 + rnd() * 0.4) * (i % 3000 < 1500 ? 1 : 0.02));
  const hs = highShelfNorm(5500, 0, 44100);
  const cases: { name: string; kind: KernelKind; p: () => Float64Array; st: () => Float64Array; aux?: () => Float32Array }[] = [
    { name: 'biquad', kind: KERNEL.BIQUAD, p: () => Float64Array.of(0.2, 0.4, 0.2, -0.5, 0.3), st: () => new Float64Array(8) },
    { name: 'kompresszor', kind: KERNEL.COMP, p: () => Float64Array.of(-18, 3, 0.004, 0.0002, 9), st: () => new Float64Array(1) },
    { name: 'kapu', kind: KERNEL.GATE, p: () => Float64Array.of(-26, -24.4, 9, 0.004, 0.0003), st: () => Float64Array.of(0, 1) },
    { name: 'limiter', kind: KERNEL.LIMIT, p: () => Float64Array.of(0.5, 0.0005), st: () => Float64Array.of(1) },
    { name: 'szaturáció', kind: KERNEL.SAT, p: () => Float64Array.of(3.8, 1 / Math.tanh(3.8)), st: () => new Float64Array(0) },
    { name: 'haas', kind: KERNEL.HAAS, p: () => Float64Array.of(90, 93), st: () => new Float64Array(1), aux: () => new Float32Array(94) },
    { name: 'visszhang', kind: KERNEL.ECHO, p: () => Float64Array.of(0.8, 0.9, 2, 1764, 3308, 0.55, 0.39), st: () => new Float64Array(2), aux: () => new Float32Array(2 * 3309) },
    { name: 'de-esser', kind: KERNEL.DEESS, p: () => Float64Array.of(0.25, 0.01, 0.0004, 44100, 7, ...hs), st: () => { const x = new Float64Array(24); x[2] = 1; x[3] = 1; return x; } },
  ];
  const eqBits = (a: Float32Array | Float64Array, b: Float32Array | Float64Array) => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  for (const c of cases) {
    const N = 6000;
    const L0 = sig(N + 64, 0.9);
    const R0 = sig(N + 64, 0.7);
    const run = (fn: typeof runKernel) => {
      const l = Float32Array.from(L0);
      const r = Float32Array.from(R0);
      const p = c.p();
      const st = c.st();
      const aux = c.aux ? c.aux() : null;
      // három darab, a középső eltolt nézet (subarray) — a darabolás és az eltolás is számít
      fn(c.kind, l.subarray(0, 2000), r.subarray(0, 2000), p, st, aux);
      fn(c.kind, l.subarray(2000, 4100), r.subarray(2000, 4100), p, st, aux);
      fn(c.kind, l.subarray(4100, N), r.subarray(4100, N), p, st, aux);
      return { l, r, st, aux };
    };
    const js = run(runKernelJs);
    const nat = run(runKernel);
    const same = eqBits(js.l, nat.l) && eqBits(js.r, nat.r) && eqBits(js.st, nat.st) && (!js.aux || eqBits(js.aux, nat.aux!));
    let maxd = 0;
    for (let i = 0; i < N; i++) maxd = Math.max(maxd, Math.abs(js.l[i] - nat.l[i]), Math.abs(js.r[i] - nat.r[i]));
    log(same || (Platform.OS === 'android' && maxd < 1e-6), `${c.name}: natív = JS ${same ? '(bitre)' : '(a libm utolsó bitjén belül)'}`, `max eltérés ${maxd.toExponential(1)}`);
  }
}
/** ✂️🎚️ Tartomány- és stem-export: a tartomány = a teljes export szelete (masterrel), Σ stem = keverés master nélkül, a némított sáv kimarad. */
export async function smokeStemExport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const mk = (name: string, sec: number, f: number, gate?: (t: number) => number) => {
    const x = Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => 0.4 * Math.sin((2 * Math.PI * f * i) / SR) * (gate ? gate(i / SR) : 1));
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(encodeWav16([x, x], SR, () => 0.5));
    return file.uri;
  };
  const voice = mk('smoke_stem_voice.wav', 4, 220, (t) => (t > 1 && t < 2.5 ? 1 : 0));
  const music = mk('smoke_stem_music.wav', 4, 440);
  const fx = mk('smoke_stem_fx.wav', 1, 880);
  const id = 'prj_smoke_stems';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:stems', caught));
  const base = createEmptyProject('smoke stemek', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: voice, start: 0, duration: 4, sourceDuration: 4, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    audioMaster: { target: 'custom', lufs: -16, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: 0, high: 1 }, multiband: true },
    audioBuses: [{ id: 'rev', name: 'Zengés', fx: { reverb: 0.5 }, gain: 0.8 }],
    audioSends: { sfx: { rev: 0.6 } },
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] }
        : t.type === 'music'
          ? { ...t, clips: [ac({ id: 'm', label: 'zene', uri: music, autoDuck: true })] }
          : t.type === 'sfx'
            ? { ...t, clips: [ac({ id: 'f', label: 'hang', uri: fx, start: 2, duration: 1, sourceDuration: 1 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const tt = i18nT as unknown as TFunction;
  /** 24 bites, sztereó WAV-bájtok → bal csatorna (dither nélkül pontos) */
  const wav24Left = (b: Uint8Array) => {
    const n = (b.length - 44) / 6;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 6;
      let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      out[i] = v / 8388607;
    }
    return out;
  };
  const readAll = (uri: string) => {
    const h = new File(uri).open();
    try {
      return h.readBytes(h.size ?? 0);
    } finally {
      h.close();
    }
  };
  // a teljes export (masterrel), 24 bit
  const mix = mixForExport(st().project!, st().isTrackAudible, st().masterVolume)!;
  const full = await exportOfflineWav(mix, new File(projectExportDir(), 'smoke_stem_full.wav'), undefined, undefined, 'pcm16', { bits: 24 });
  const fullL = wav24Left(readAll(full.uri));
  // In–Out a transzporttal
  st().setPlayhead(1.2);
  st().setRangeIn();
  st().setPlayhead(3.1);
  st().setRangeOut();
  const rng = await exportParts(st().project!, { range: true, stems: false }, 24, tt, false);
  const rL = rng ? wav24Left(readAll(rng.uri)) : new Float32Array();
  const a0 = Math.round(1.2 * SR);
  let d = 0;
  for (let i = 0; i < rL.length; i++) d = Math.max(d, Math.abs(rL[i] - fullL[a0 + i]));
  log(rL.length === Math.round(3.1 * SR) - a0 && d === 0, 'tartomány (In 1,2 – Out 3,1 s, master-lánccal): mintára a teljes export szelete', `${(rL.length / SR).toFixed(3)} s, max eltérés ${d}`);
  // stemek
  const zipRes = await exportParts(st().project!, { range: false, stems: true }, 24, tt, false);
  const zb = zipRes ? readAll(zipRes.uri) : new Uint8Array();
  const eocd = parseEocd(zb, 0)!;
  const entries = parseCentralDirectory(zb.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize), eocd.count);
  const stems = entries.map((e) => {
    const off = localDataOffset(zb.subarray(e.headerOffset, e.headerOffset + 300), e.headerOffset);
    const data = zb.subarray(off, off + e.size);
    return { name: e.name, crcOk: crc32(data) === e.crc, left: wav24Left(data) };
  });
  log(stems.length === 3 && stems.every((x) => x.crcOk), 'a ZIP: 3 stem, mind ép (CRC)', stems.map((x) => x.name).join(' · '));
  const ref = await exportOfflineWav({ ...mix, audioMaster: undefined }, new File(projectExportDir(), 'smoke_stem_ref.wav'), undefined, undefined, 'pcm16', { bits: 24 });
  const refL = wav24Left(readAll(ref.uri));
  let ds = 0;
  for (let i = 0; i < refL.length; i++) ds = Math.max(ds, Math.abs(stems.reduce((s2, x) => s2 + (x.left[i] ?? 0), 0) - refL[i]));
  log(ds < 4e-7, 'Σ stem = a keverés master nélkül (a halkítás és a zengés-busz is benne)', `max eltérés ${ds.toExponential(1)} (24 bit: 1 LSB = 1,2e-7)`);
  const musicStem = stems.find((x) => x.name.includes(laneLabelFor('music', tt)))?.left;
  const lvl = (x: Float32Array | undefined, s0: number, s1: number) => {
    if (!x) return -999;
    let e = 0;
    for (let i = Math.round(s0 * SR); i < Math.round(s1 * SR); i++) e += x[i] * x[i];
    return 10 * Math.log10(e / ((s1 - s0) * SR) + 1e-30);
  };
  const duck = lvl(musicStem, 1.6, 2.3) - lvl(musicStem, 0.3, 0.9);
  log(duck < -6, 'a zene-stem a beszéd alatt halkul (a némított beszéd a kulcs)', `${duck.toFixed(1)} dB`);
  // a némított sáv kimarad; tartomány + stemek
  st().toggleTrackFlag('sfx', 'mute');
  const muted = await exportParts(st().project!, { range: true, stems: true }, 16, tt, false);
  const mb = muted ? readAll(muted.uri) : new Uint8Array();
  const me = parseEocd(mb, 0)!;
  const ment = parseCentralDirectory(mb.subarray(me.cdOffset, me.cdOffset + me.cdSize), me.count);
  const frames = (bytes: number) => (bytes - 44) / 4;
  log(ment.length === 2 && ment.every((e) => frames(e.size) === Math.round(3.1 * SR) - a0), 'a némított effekt-sáv kimarad; tartomány + stemek: minden stem pontosan a tartomány hosszú (16 bit)', ment.map((e) => `${e.name} ${(frames(e.size) / SR).toFixed(3)} s`).join(' · '));
  st().toggleTrackFlag('sfx', 'mute');
  for (const u of [full.uri, ref.uri, rng?.uri, zipRes?.uri, muted?.uri]) if (u) new File(u).delete();
  runDevAction('audio.exportSheet');
  log(true, 'FOTÓZHATÓ', 'az export-lap: Tartomány és Tartalom');
  await sleep(3500);
  st().clearRange();
  router.back();
}
/** 🔗 Külső hang szinkronja: ismert eltolású, tompább, zajos „külön mikrofon” a kamera hangjához. */
export async function smokeExtSync(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const refUri = await downloadToCache(`${smokeFileHost()}/speech_en.wav`, 'smoke_sync_ref.wav');
  const huUri = await downloadToCache(`${smokeFileHost()}/speech_hu.wav`, 'smoke_sync_hu.wav');
  if (!refUri || !huUri) {
    log(false, 'a próbahangok letöltése', '-');
    return;
  }
  const api = (await loadAudioApi())!;
  const x = (await api.decodeAudioData(refUri, SR)).getChannelData(0);
  // „külön mikrofon”: 1,2345 s szobazaj elöl, tompább (egypólusú aluláteresztő), halkabb, zajos
  const P = Math.round(1.2345 * SR);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let lp = 0;
  const y = new Float32Array(P + x.length);
  for (let i = 0; i < y.length; i++) {
    const v = i >= P ? x[i - P] : 0;
    lp = 0.6 * lp + 0.4 * v;
    y[i] = 0.4 * lp + 0.01 * rnd();
  }
  const extFile = new File(Paths.document, 'smoke_sync_ext.wav');
  if (extFile.exists) extFile.delete();
  extFile.create();
  extFile.write(encodeWav16([y, y], SR, () => 0.5));
  const truth = 2 - P / SR; // a kamera-hang 2 s-nál indul → a külön mikrofon helye
  const id = 'prj_smoke_sync';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sync', caught));
  const base = createEmptyProject('smoke szinkron', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: refUri, start: 0, duration: 8.2, sourceDuration: 8.2, id: 'x', ...over });
  const extDur = Math.floor((y.length / SR) * 1000) / 1000;
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'cam', label: 'kamera', start: 2 })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'mic', label: 'mikrofon', uri: extFile.uri, start: 1, duration: extDur, sourceDuration: extDur })] }
          : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().selectClip('mic');
  const t0 = Date.now();
  const r = (await runDevAction('audio.syncSelected')) as { target: number; confidence: number; lag: number } | null;
  const mic = st().project!.tracks.find((t) => t.type === 'sfx')!.clips[0] as AudioClip;
  const placed = mic.start - (mic.trimIn ?? 0); // a forrás 0 pontja az idővonalon
  const errMs = r ? (r.target - truth) * 1000 : NaN;
  log(!!r && Math.abs(errMs) < 0.1 && r.confidence >= SYNC_MIN_CONFIDENCE, 'a talált eltolás a valóditól < 0,1 ms (más hangszín, halkabb, zajos)', `hiba ${errMs.toFixed(4)} ms, egyezés ${r?.confidence.toFixed(1)}, ${Date.now() - t0} ms alatt`);
  log(Math.abs(placed - truth) < 1e-4 && Math.abs(mic.start * 44100 - Math.round(mic.start * 44100)) < 1e-4, 'a klip a minta-rácson (V6), a maradék a trimIn-ben — a hang mintapontosan a helyén', `kezdet ${mic.start.toFixed(6)} (rács), trimIn ${mic.trimIn?.toFixed(6)}, forrás-0 @ ${placed.toFixed(6)} (valódi ${truth.toFixed(6)})`);
  log(true, 'FOTÓZHATÓ', 'a mikrofon-klip a kamera-hang alá igazítva');
  await sleep(2500);
  // a keverőn át: a két sáv külön exportja egymáshoz mérve
  const render = async (keep: string, name: string) => {
    const p: Project = { ...st().project!, tracks: st().project!.tracks.map((t) => (t.type === keep ? t : { ...t, clips: [] })) };
    const { uri: o } = await exportOfflineWav(p, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const d = (await api.decodeAudioData(o, SR)).getChannelData(0);
    new File(o).delete();
    return d;
  };
  const camOut = await render('voiceover', 'smoke_sync_cam.wav');
  const micOut = await render('sfx', 'smoke_sync_mic.wav');
  const w0 = Math.round(3 * SR);
  const w1 = Math.round(7 * SR);
  const check = gccPhatLag(camOut.subarray(w0 - SR, w1 + SR), micOut.subarray(w0, w1), SR, 1.5);
  const mixErr = (check.lag - 1) * 1000;
  log(Math.abs(mixErr) < 0.1, 'a lejátszásban (export) a két sáv együtt szól: eltérés < 0,1 ms', `${mixErr.toFixed(4)} ms (${((mixErr / 1000) * SR).toFixed(2)} minta)`);
  st().undo();
  const back = st().project!.tracks.find((t) => t.type === 'sfx')!.clips[0];
  log(back.start === 1, 'egy visszavonás: a klip vissza az eredeti helyére', `${back.start}`);
  // idegen felvétel: nincs egyezés, a klip nem mozdul
  const hu: AudioClip = ac({ id: 'hu', uri: huUri, start: 1, duration: 9.3, sourceDuration: 9.3 });
  const camClip = st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  const neg = await syncClipTo(camClip, hu, 30);
  log(!!neg && neg.confidence < SYNC_MIN_CONFIDENCE, 'idegen felvételre (magyar beszéd) nincs egyezés', `egyezés ${neg?.confidence.toFixed(2)} < ${SYNC_MIN_CONFIDENCE}`);
  await sleep(1000);
  router.back();
}
/** 🇭🇺 Magyar beszédvágás: az alap modell szóhibái, a pontosabb (small) modell letöltése az átirat-sávból, újra-mérés, egy szó kivágása. */
export async function smokeSpeechHu(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = await downloadToCache(`${smokeFileHost()}/speech_hu.wav`, 'smoke_speech_hu.wav');
  if (!src) {
    log(false, 'a próbahang letöltése', '-');
    return;
  }
  clearSpeechWordCache();
  const norm = (ws: { text: string }[]) => ws.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' ');
  const expected = 'sziasztok és üdv a műsorban ma arról beszélünk hogyan lehet szöveggel hangot vágni ha törölsz egy szót a hang is kivágódik';
  const wordDiff = (a: string, b: string) => {
    const x = a.split(' ');
    const y = b.split(' ');
    const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  };
  const pcm = await decodeToMono16k(src);
  // viszonyítás: az eszközön meglévő kisebb modell (base, ennek hiányában tiny)
  const smallerId = ['whisper-base-q5', 'whisper-tiny-q8'].find((m) => {
    const e = catalogEntry(m);
    return e && catalogAvailability(e, catalogRuntime()) === 'validated';
  });
  const base = pcm && smallerId ? await transcribeWordsOnDevice(pcm, 0, { modelId: smallerId }) : null;
  const baseHeard = base ? norm(base.words) : 'null';
  const baseErr = wordDiff(baseHeard, expected);
  log(!!base, `a kisebb modell (${smallerId ?? '-'})`, `${baseHeard} — ${baseErr} szóhiba / 20`);
  const id = 'prj_smoke_speech_hu';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:speechhu', caught));
  const p0 = createEmptyProject('smoke magyar beszédvágás', '9:16', undefined, 'audio');
  const vo: AudioClip = { kind: 'audio', id: 'vo', label: 'beszéd', uri: src, start: 0, duration: 9.3, trimIn: 0, sourceDuration: 9.3, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...p0, id, tracks: p0.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [vo] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().selectClip('vo');
  await runDevAction('audio.speechStart');
  const t0 = Date.now();
  const n = (await runDevAction('audio.speechUpgrade')) as number | null;
  const small = norm(currentSpeechWords());
  const smallErr = wordDiff(small, expected);
  log(bestUsableWhisperModelId() === 'whisper-small-q5' && n !== null, '„Pontosabb felismerés”: a small letöltve (sha256 + próba), a sáv újra átírva', `${bestUsableWhisperModelId()}, ${n} szó, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(!!base && smallErr < baseErr, 'a small magyarul pontosabb, mint a kisebb modell', `${small} — ${smallErr} szóhiba / 20 (${smallerId}: ${baseErr})`);
  log(true, 'FOTÓZHATÓ', 'a magyar átirat a small modellel');
  await sleep(2500);
  // egy magyar szó kivágása, az eredmény újra-átírva
  const ws = currentSpeechWords();
  const target = ws.find((w) => norm([w]) === 'hangot') ?? ws[0];
  useSpeechEdit.setState({ selected: new Set([target.key]), mode: 'track' });
  runDevAction('audio.speechApply');
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_hu_out.wav'));
  const p2 = await decodeToMono16k(out);
  new File(out).delete();
  const re = p2 ? await transcribeWordsOnDevice(p2, 0) : null;
  const got = re ? norm(re.words) : 'null';
  const want = small.split(' ').filter((x) => x !== norm([target])).join(' ');
  log(!!re && !got.split(' ').includes(norm([target])) && wordDiff(got, want) <= 3, `„${target.text}” kivágva (folyamatos beszédből): az újra-átírásban nincs, a többi megvan (≤ 3 szó eltérés — a felismerő futásonként ennyit ingadozik)`, `${got} — ${wordDiff(got, want)} szó`);
  st().undo();
  await sleep(1000);
  router.back();
}
/** ✂️💬 Beszédvágás szöveggel: átirat, töltelékek kijelölése, kivágás, az eredmény újra-átírva, undo, minden sáv. */
export async function smokeSpeechEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = await downloadToCache(`${smokeFileHost()}/speech_en.wav`, 'smoke_speech_en.wav');
  if (!src) {
    log(false, 'a próbahang letöltése', '-');
    return;
  }
  clearSpeechWordCache();
  const norm = (ws: { text: string }[]) => ws.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')).filter(Boolean).join(' ');
  const expected = 'hello and welcome to the show um today we talk about uh editing audio with text delete a word and the sound is cut';
  const id = 'prj_smoke_speech';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:speech', caught));
  const base = createEmptyProject('smoke beszédvágás', '9:16', undefined, 'audio');
  const bed = toneWav('smoke_speech_bed.wav', 9);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported', uri: src, start: 0, duration: 8.2, sourceDuration: 8.2, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'vo', label: 'beszéd' })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'fx', label: 'hang', uri: bed, start: 7.5, duration: 0.5, sourceDuration: 9, volume: 0.2 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'bed', label: 'zene', uri: bed, duration: 8.2, sourceDuration: 9, volume: 0.1 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const track = (type: string) => (st().project?.tracks.find((t) => t.type === type)?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('vo');
  const t0 = Date.now();
  const count = (await runDevAction('audio.speechStart')) as number | null;
  const words = currentSpeechWords();
  // szó-szintű eltérés (Levenshtein a szavakon)
  const wordDiff = (a: string, b: string) => {
    const x = a.split(' ');
    const y = b.split(' ');
    const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  };
  const heard = norm(words);
  // a modellek a töltelékeket eltérően írják (uh/ah), és egy-egy szót félrehallhatnak
  log(wordDiff(heard, expected) <= 2, `az átirat a telefonon (${bestUsableWhisperModelId()}, ${Date.now() - t0} ms, ${count} szó) ≈ a felolvasott szöveg (≤ 2 szó eltérés)`, `${heard} — eltérés ${wordDiff(heard, expected)}`);
  const fillers = runDevAction('audio.speechFillers') as number;
  const picked = words.filter((w) => useSpeechEdit.getState().selected.has(w.key)).map((w) => w.text).join(' ');
  const pickedNorm = words.filter((w) => useSpeechEdit.getState().selected.has(w.key)).map((w) => norm([w]));
  const minus = words.filter((w) => !useSpeechEdit.getState().selected.has(w.key)).map((w) => norm([w])).join(' ');
  log(fillers === 2 && pickedNorm.every((x) => ['um', 'uh', 'ah', 'er', 'erm', 'umm', 'uhh'].includes(x)), 'Töltelékek: a két töltelék („um”, „uh”) kijelölve', picked);
  log(true, 'FOTÓZHATÓ', 'az átirat-sáv két áthúzott töltelékkel, a sávon pirosan');
  await sleep(2500);
  // a stúdió rácsa (V6: hang-projektben a minta) — ugyanúgy, mint a szövegvágó sáv
  const plannedCuts = wordCutRanges(currentSpeechWords(), useSpeechEdit.getState().selected, editGridRate(st().project));
  const beforeCut = st().project!;
  const cuts = runDevAction('audio.speechApply') as number;
  const vo = track('voiceover');
  const kept = vo.reduce((s, c) => s + c.duration, 0);
  log(cuts === 2 && vo.length === 3, 'Kivágás: 2 tartomány, a beszéd 3 darabban', `${vo.map((c) => `${c.start.toFixed(2)}+${c.duration.toFixed(2)}`).join(' · ')} (−${(8.2 - kept).toFixed(2)} s)`);
  const after = currentSpeechWords();
  log(norm(after) === minus && after.every((w, i) => i === 0 || w.start >= after[i - 1].start), 'az átirat magától frissül: a töltelékek eltűntek, a többi a helyén', norm(after));
  log(track('sfx')[0]?.start === 7.5 && track('music').length === 1, 'csak ez a sáv: a többi érintetlen', `effekt ${track('sfx')[0]?.start}, zene ${track('music').length}`);
  // a valódi bizonyíték: az eredmény hangját újra átírjuk
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_out.wav'));
  const pcm = await decodeToMono16k(out);
  new File(out).delete();
  const re = pcm ? await transcribeWordsOnDevice(pcm, 0) : null;
  // betű-szintű eltérés (a szóközök nélkül — a tiny modell néha összevon két szót)
  const charDiff = (a: string, b: string) => wordDiff(a.replace(/ /g, '').split('').join(' '), b.replace(/ /g, '').split('').join(' '));
  const reHeard = re ? norm(re.words) : 'null';
  log(!!re && charDiff(reHeard, minus) <= 3 && !/\b(um|uh|ah)\b/.test(reHeard), 'az export újra-átírva ≈ az eredeti átirat a két töltelék nélkül (nincs „um”/„uh”, ≤ 3 betű eltérés)', `${reHeard} — ${charDiff(reHeard, minus)} betű (${pcm ? (pcm.length / 16000).toFixed(2) : '-'} s)`);
  // a hang mintára: a vágások közti szakaszok = az eredeti, a kivágott idővel eltolva
  const SR = 44100;
  const render = async (p: Project, name: string) => {
    const { uri: o } = await exportOfflineWav(voOnly(p), new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(o, SR)).getChannelData(0);
    new File(o).delete();
    return y;
  };
  const yA = await render(beforeCut, 'smoke_sp_a.wav');
  const yB = await render(st().project!, 'smoke_sp_b.wav');
  let shift = 0;
  let maxD = 0;
  let from = 0;
  for (const r of [...plannedCuts, { start: 8.2, end: 8.2 }]) {
    // a szakasz belseje (a vágás-varratok 10 ms-os mikro-fade-je nélkül)
    for (let i = Math.round((from + 0.012) * SR); i < Math.round((r.start - 0.012) * SR); i++) maxD = Math.max(maxD, Math.abs(yA[i] - (yB[i - shift] ?? 0)));
    shift += Math.round((r.end - r.start) * SR);
    from = r.end;
  }
  log(maxD < 1e-6 && plannedCuts.length === 2, 'a hang mintára: a megmaradt beszéd = az eredeti, a kivágott idővel előbb', `max eltérés ${maxD.toExponential(1)}, vágások ${plannedCuts.map((r) => `${r.start.toFixed(3)}–${r.end.toFixed(3)}`).join(', ')}`);
  st().undo();
  log(track('voiceover').length === 1 && norm(currentSpeechWords()) === heard, 'egy visszavonás: az egész klip és a teljes átirat vissza (újra-átírás nélkül)', `${track('voiceover').length} klip`);
  // minden sáv: az effekt is a kivágott idővel előbb jön
  runDevAction('audio.speechFillers');
  runDevAction('audio.speechModeAll');
  runDevAction('audio.speechApply');
  const removed = 8.2 - track('voiceover').reduce((s, c) => s + c.duration, 0);
  log(Math.abs((track('sfx')[0]?.start ?? 0) - (7.5 - removed)) < 1e-4 && track('music').length === 1 && track('music')[0].start === 0, 'minden sáv: az effekt előbb jön, a zene nem vágódik', `effekt ${track('sfx')[0]?.start.toFixed(6)} (7,5 − ${removed.toFixed(6)}), zene ${track('music').map((c) => `${c.start}+${c.duration}`).join(',')}`);
  st().undo();
  // szón belüli vágás folyamatos beszédben: az „audio” az „editing audio” közepéről
  const reCut = async (word: string) => {
    const ws = currentSpeechWords();
    const w = ws.find((x) => norm([x]) === word);
    if (!w) return null;
    useSpeechEdit.setState({ selected: new Set([w.key]), mode: 'track' });
    runDevAction('audio.speechApply');
    const { uri: o } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_w.wav'));
    const p16 = await decodeToMono16k(o);
    new File(o).delete();
    const r2 = p16 ? await transcribeWordsOnDevice(p16, 0) : null;
    const base0 = norm(ws);
    st().undo();
    return { want: base0.split(' ').filter((x, i, arr) => !(x === word && arr.indexOf(word) === i)).join(' '), got: r2 ? norm(r2.words) : 'null' };
  };
  const inner = await reCut('audio');
  // folyamatos beszédben a vágásnak nincs szünete: a felismerő a varratnál egy szót félrehallhat
  log(!!inner && wordDiff(inner.got, inner.want) <= 1 && !/\baudio\b/.test(inner.got), 'szón belüli vágás („editing audio” → „editing”): az újra-átírásban nincs „audio”, a többi megvan (≤ 1 szó eltérés)', inner ? `${inner.got} — ${wordDiff(inner.got, inner.want)} szó` : '-');
  await sleep(1500);
  router.back();
}
/** 🧪 Whisper szó-szintű szonda: motor, modell, és a felismert szavak egy ismert szövegű felvételen. */
export async function smokeWhisperProbe(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(null, 'motor', `${whisperEngineAvailable()} · modellek: ${listCachedModels().map((m) => m.id).join(', ') || '-'} · legjobb: ${bestUsableWhisperModelId() ?? '-'}`);
  if (!bestUsableWhisperModelId()) {
    const entry = catalogEntry('whisper-base-q5');
    const t0 = Date.now();
    const res = entry?.manifest ? await downloadModel(entry.manifest) : null;
    const smoke = res?.ok ? await runWhisperSmokeTest('whisper-base-q5') : false;
    log(!!res?.ok && smoke, 'a Whisper base letöltése + próbája (az app saját útja)', `${res?.ok} / ${smoke}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  for (const name of ['speech_en.wav', 'speech_hu.wav']) {
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `probe_${name}`);
    const pcm = local ? await decodeToMono16k(local) : null;
    log(null, 'forrás', `${name}: ${pcm ? (pcm.length / 16000).toFixed(2) : '-'} s`);
    if (!pcm) continue;
    const t0 = Date.now();
    const r = await transcribeWordsOnDevice(pcm, 0);
    log(null, 'nyelv (auto)', r?.language ?? '-');
    log(null, 'tokenek', lastRawTokens.map((k) => `[${k.text}]${k.start.toFixed(2)}-${k.end.toFixed(2)}`).join(' '));
    log(!!r && r.words.length > 0, `szavak (${name}, ${Date.now() - t0} ms)`, r ? r.words.map((w) => `${w.text}@${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join(' ') : 'null');
  }
}
/** 🔇 Csendek jóváhagyással: keresés, egyenkénti kihagyás, kivágás (csak ez a sáv / minden sáv), undo, hang. */
export async function smokeSilence(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // beszéd-szerű jel; csendek: 1,5–3 (1,5 s) és 4,5–5,2 (0,7 s); a 6,5–6,9 szünet (0,4 s) marad
  const talk: [number, number][] = [[0, 1.5], [3, 4.5], [5.2, 6.5], [6.9, 8]];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const x = Float32Array.from({ length: 8 * SR }, (_, i) => {
    const t = i / SR;
    return talk.some(([a, b]) => t >= a && t < b) ? 0.3 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0.001 * rnd();
  });
  const src = new File(Paths.document, 'smoke_silence_src.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_silence';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:silence', caught));
  const base = createEmptyProject('smoke csendek', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: src.uri, start: 0, duration: 8, sourceDuration: 8, id: 'x', ...over });
  const music = toneWav('smoke_silence_bed.wav', 8);
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'vo', label: 'beszéd' })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'fx', label: 'hang', uri: music, start: 7, duration: 0.5, sourceDuration: 8, volume: 0.2 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'bed', label: 'zene', uri: music, volume: 0.1 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const track = (type: string) => (st().project?.tracks.find((t) => t.type === type)?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('vo');
  const t0 = Date.now();
  const found = (await runDevAction('audio.silenceFind')) as number | null;
  const rv = useSilenceReview.getState().review;
  const r = rv?.ranges ?? [];
  const fr = r.map((q) => `${q.start.toFixed(3)}–${q.end.toFixed(3)}`).join(', ');
  log(found === 2, 'a keresés 2 csendet talál; a 0,4 s-os szünet marad', `${found} csend: ${fr} (${Date.now() - t0} ms)`);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1 / 30 + 0.011;
  log(r.length === 2 && near(r[0].start, 1.62) && near(r[0].end, 2.88) && near(r[1].start, 4.62) && near(r[1].end, 5.08), 'a határok: a beszéd felől 0,12 s levegő, minta-rácson (V6)', fr);
  // 🎧 hosszú forrás útja (szakaszos natív dekóder, 44,1 kHz) ugyanazokat a csendeket adja
  setLongThresholdForTest(1);
  const longR = await findClipSilences(track('voiceover')[0] as AudioClip, editGridRate(st().project)); // V6: a stúdió rácsa
  setLongThresholdForTest(null);
  const lr = (longR ?? []).map((q) => `${q.start.toFixed(3)}–${q.end.toFixed(3)}`).join(', ');
  log(canSegment() && lr === fr, 'hosszú forrás (szakaszos dekódolás): ugyanazok a csendek', lr);
  log(true, 'FOTÓZHATÓ', 'a két csend pirosan a beszéd-sávon, alul a jóváhagyó sáv');
  await sleep(2500);
  runDevAction('audio.silenceToggle1');
  const kept = useSilenceReview.getState().review?.ranges.map((q) => q.on).join(',');
  log(kept === 'true,false', 'koppintás: a 2. csend megmarad (kihagyva a kivágásból)', kept ?? '-');
  const before = st().project!;
  runDevAction('audio.silenceApply');
  const vo = track('voiceover');
  const cut = r[0].end - r[0].start;
  log(vo.length === 2 && near(vo[1].start, r[0].start) && Math.abs(vo[0].duration + vo[1].duration - (8 - cut)) < 1e-5, 'csak ez a sáv: 1 csend kivágva, a beszéd összezár', `${vo.map((c) => `${c.start.toFixed(3)}+${c.duration.toFixed(3)}`).join(' · ')}`);
  log(track('sfx')[0]?.start === 7 && track('music').length === 1, 'a többi sáv érintetlen', `effekt ${track('sfx')[0]?.start} s, zene ${track('music').length} klip`);
  log(useSilenceReview.getState().review === null, 'a kivágás után a jóváhagyás bezárul', '');
  // a hang: a vágás utáni beszéd = az eredeti, a kivágott idővel előbb
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(p, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    return y;
  };
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const orig = await render(voOnly(before), 'smoke_sil_a.wav');
  const after = await render(voOnly(st().project!), 'smoke_sil_b.wav');
  let d1 = 0;
  let d2 = 0;
  for (let i = Math.round(0.05 * SR); i < Math.round(1.5 * SR); i++) d1 = Math.max(d1, Math.abs(orig[i] - after[i]));
  const shift = Math.round(cut * SR);
  for (let i = Math.round(3.05 * SR); i < Math.round(7.9 * SR); i++) d2 = Math.max(d2, Math.abs(orig[i] - after[i - shift]));
  log(d1 < 1e-5 && d2 < 1e-5 && Math.abs(after.length - (orig.length - shift)) <= 2, 'a hang: a beszéd érintetlen, a vágás után pontosan a kivágott idővel előbb', `eltérés ${d1.toExponential(1)} / ${d2.toExponential(1)}, ${(orig.length / SR).toFixed(3)} → ${(after.length / SR).toFixed(3)} s`);
  st().undo();
  log(track('voiceover').length === 1 && track('voiceover')[0].duration === 8, 'egyetlen visszavonás visszaállítja', `${track('voiceover').length} klip`);
  // minden sáv: az effekt is tolódik, a zene folyamatos
  st().selectClip('vo');
  await runDevAction('audio.silenceFind');
  runDevAction('audio.silenceModeAll');
  runDevAction('audio.silenceApply');
  const removed = r.reduce((s, q) => s + q.end - q.start, 0);
  log(near(track('sfx')[0]?.start ?? -1, 7 - removed) && track('music').length === 1 && track('music')[0].start === 0 && track('voiceover').length === 3, 'minden sáv: az effekt a kivágott idővel előbb, a zene nem vágva', `effekt ${track('sfx')[0]?.start.toFixed(3)} s (7 − ${removed.toFixed(3)}), zene ${track('music').length} klip, beszéd ${track('voiceover').length} darab`);
  st().undo();
  await sleep(1500);
  router.back();
}
/** ✂️🥁 Vágás az ütemrácson: 3/4 @ 120 — darabszám, határok a rácson, egy undo, a hang változatlan. */
export async function smokeBeatSplit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const uri = toneWav('smoke_beatsplit.wav', 8);
  const id = 'prj_smoke_beatsplit';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:beatsplit', caught));
  const base = createEmptyProject('smoke ütem-vágás', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'bs', uri, label: 'dal', start: 0.3, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const meter = { beatsPerBar: 3, beatUnit: 4 as const };
  const project: Project = { ...base, id, bpm: 120, timeSignature: meter, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const clips = () => (st().project?.tracks.find((t) => t.type === 'music')?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('bs');
  const nBars = runDevAction('audio.beatSplitBars') as number;
  const bars = clips();
  const cuts = bars.slice(1).map((x) => x.start);
  log(nBars === 5 && bars.length === 6, 'ütemenként (3/4 @ 120 = 1,5 s): 5 vágás → 6 darab', `${nBars} vágás, ${bars.length} darab`);
  log(cuts.every((x, i) => Math.abs(x - 1.5 * (i + 1)) < 1e-6), 'a határok az ütemvonalakon', cuts.join(' · '));
  const seamless = bars.every((x, i) => i === 0 || Math.abs(bars[i - 1].start + bars[i - 1].duration - x.start) < 1e-6);
  const trims = bars.every((x) => x.kind === 'audio' && Math.abs((x.trimIn ?? 0) - (x.start - 0.3)) < 1e-6);
  log(seamless && trims && bars[0].id === 'bs', 'hézag nélkül, a forrás-pozíció (trimIn) folytonos, az első darab tartja az azonosítót', `${bars.map((x) => x.duration.toFixed(2)).join('+')} s`);
  const split = { ...project, tracks: st().project!.tracks };
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(p, new File(projectExportDir(), name));
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    return y;
  };
  const whole = await render(project, 'smoke_bs_whole.wav');
  const parts = await render(split, 'smoke_bs_split.wav');
  let diff = 0;
  for (let i = 0; i < Math.min(whole.length, parts.length); i++) diff = Math.max(diff, Math.abs(whole[i] - parts[i]));
  log(whole.length === parts.length && diff < 1e-4, 'a vágás nem hallható: a darabolt export = az egész klip exportja', `max eltérés ${diff.toExponential(1)}, ${parts.length} minta`);
  st().undo();
  log(clips().length === 1 && clips()[0].duration === 8, 'egyetlen visszavonás visszaállítja az egész klipet', `${clips().length} klip`);
  st().selectClip('bs');
  const nBeats = runDevAction('audio.beatSplitBeats') as number;
  const expect = beatSplitTimes(c, 120, meter, 'beat').length;
  log(nBeats === 16 && nBeats === expect && clips().length === 17, 'ütemrészenként (0,5 s): 0,5 … 8,0 → 16 vágás, 17 darab', `${nBeats} vágás, ${clips().length} darab`);
  st().undo();
  st().selectClip('bs');
  runDevAction('audio.beatSplitBars');
  runDevAction('audio.fit');
  log(true, 'FOTÓZHATÓ', '6 darab a 3/4-es ütemvonalakon');
  await sleep(4000);
  router.back();
}
/** 🔁 Loop-klip: 1 s-os minta 4 s-ig ismétlődik (export + motor), a jobb él a forráson túl húzható. */
export async function smokeLoopClip(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 1 s: 0,15 s hang, utána csend — a hurok minden másodpercben megszólal
  const x = Float32Array.from({ length: SR }, (_, i) => (i < 0.15 * SR ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0));
  const src = new File(Paths.document, 'smoke_loop_src.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_loop';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:loop', caught));
  const base = createEmptyProject('smoke loop-klip', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'lp', uri: src.uri, label: 'ütem', start: 0, duration: 1, trimIn: 0, sourceDuration: 1, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', loopLength: 1 };
  const ext = trimAudioRight(c, 4);
  log(Math.abs(ext.duration - 4) < 1e-9, 'loop-klipnél a jobb él a forrás végén túl húzható', `${ext.duration} s (a forrás 1 s)`);
  const looped: AudioClip = { ...c, duration: ext.duration };
  const project: Project = { ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [looped] } : t)) };
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_loop_out.wav'));
  const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
  new File(out).delete();
  const lvl = (t: number) => {
    let e = 0;
    for (let i = Math.round(t * SR); i < Math.round((t + 0.1) * SR); i++) e += y[i] * y[i];
    return 10 * Math.log10(e / (0.1 * SR) + 1e-30);
  };
  const hits = [0.02, 1.02, 2.02, 3.02].map(lvl);
  const gaps = [0.5, 1.5, 2.5, 3.5].map(lvl);
  log(hits.every((h) => Math.abs(h - hits[0]) < 0.5) && gaps.every((g) => g < -80), 'export: a minta minden másodpercben megszólal, köztük csend', `${hits.map((h) => h.toFixed(1)).join(' / ')} dB, szünetek ${Math.max(...gaps).toFixed(0)} dB`);
  // ✂️ a kettévágott loop-klip (1,5 s-nál, a hurok közepén) ugyanúgy szól, mint az egész
  const [la, lb] = splitClip(looped, 1.5) as [AudioClip, AudioClip];
  const { uri: out2 } = await exportOfflineWav({ ...project, tracks: project.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [la, lb] } : t)) }, new File(projectExportDir(), 'smoke_loop_split.wav'));
  const y2 = (await (await loadAudioApi())!.decodeAudioData(out2, SR)).getChannelData(0);
  new File(out2).delete();
  let ld = 0;
  for (let i = 0; i < Math.min(y.length, y2.length); i++) ld = Math.max(ld, Math.abs(y[i] - y2[i]));
  log(lb.loopOffset === 0.5 && lb.trimIn === 0 && ld < 1e-4, 'a kettévágott loop-klip = az egész (a 2. darab a hurok közepéről)', `fázis ${lb.loopOffset} s, max eltérés ${ld.toExponential(1)}`);
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(3000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.chunks > 10 && stats.late === 0, 'a motor a loop-klipet akadás nélkül játssza', `${stats.chunks} szelet, ${stats.late} késett`);
  log(true, 'FOTÓZHATÓ', 'a loop-klip hullámformája négyszer ismétlődik');
  await sleep(4000);
  router.back();
  src.delete();
}
/** A26: a telefonos WAV-export a valódi natív dekóderrel — és a szerveres renderrel kivonva. */
export async function smokeOfflineExport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_offline_src.wav', 3);
  const base = createEmptyProject('smoke offline', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'o1', uri, label: 'tone', start: 0.5, duration: 2, trimIn: 0.5, sourceDuration: 3, volume: 0.6, fadeIn: 0.3, fadeOut: 0.4, pan: -0.5, source: 'imported',
    keyframes: { volume: [{ time: 0, value: 0.2, easing: 'linear' }, { time: 2, value: 0.9, easing: 'linear' }] } as AudioClip['keyframes'] };
  const project: Project = { ...base, trackMix: { music: { gain: 0.8 } }, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [c] } : tr)) };
  const started = Date.now();
  const target = new File(projectExportDir(), 'smoke_offline.wav');
  const { uri: out } = await exportOfflineWav(project, target);
  const ms = Date.now() - started;
  const size = new File(out).size ?? 0;
  log(Math.abs(size - (44 + 2.5 * 44100 * 4)) < 8, 'A26 a WAV a telefonon készült, a várt hosszal', `${size} bájt, ${ms} ms`);
  if (!cloudInThisBuild()) {
    log(!cloudAvailable(), 'felhő nélküli build: a Pro felhasználó is a telefonos WAV-ot kapja (az export-lap telefonos módban)', `felhő: ${cloudAvailable()}`);
    log(null, 'A26 telefon = szerver: kimarad', 'ebben a buildben nincs felhő-cím (a telefonos út a fenti)');
    return;
  }
  const serverFile = new File(projectExportDir(), 'smoke_server.wav');
  await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 44100, channels: 2 }), serverFile);
  const api = await loadAudioApi();
  if (!api) {
    log(false, 'dekóder', 'nincs');
    return;
  }
  const mine = await api.decodeAudioData(out, 44100);
  const theirs = await api.decodeAudioData(serverFile.uri, 44100);
  const db = (xs: Float32Array) => 10 * Math.log10(xs.reduce((s, v) => s + v * v, 0) / Math.max(1, xs.length) + 1e-30);
  for (const ch of [0, 1]) {
    const a = mine.getChannelData(ch);
    const b = theirs.getChannelData(ch);
    const n = Math.min(a.length, b.length);
    const diff = Float32Array.from({ length: n }, (_, i) => a[i] - b[i]);
    const snr = db(b.subarray(0, n)) - db(diff);
    log(snr > 60, `A26 telefon = szerver (${ch === 0 ? 'bal' : 'jobb'} csatorna)`, `${snr.toFixed(1)} dB a jel alatt, hossz ${a.length}/${b.length}`);
  }
  new File(out).delete();
  serverFile.delete();
  new File(uri).delete();
}
/** A26 sebesség: 60 mp-es, három klipes projekt a telefonon (a 20 perces felső határhoz). */
export async function smokeOfflineSpeed(log: Log) {
  const uri = toneWav('smoke_offline_long.wav', 60);
  const base = createEmptyProject('smoke offline hosszú', '1:1', undefined, 'audio');
  const mk = (id: string, start: number): AudioClip => ({ kind: 'audio', id, uri, label: id, start, duration: 40, trimIn: 0, sourceDuration: 60, volume: 0.5, fadeIn: 1, fadeOut: 1, source: 'imported' });
  const project: Project = { ...base, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('a', 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('b', 10)] } : tr.type === 'voiceover' ? { ...tr, clips: [mk('c', 20)] } : tr)) };
  // a mérés kétszer: az első futás a hang-modul első betöltését is tartalmazza (hidegindítás)
  for (const run of ['első (hideg)', 'második (meleg)']) {
  // T2: a felület folyékonysága export közben — a leghosszabb szünet két képkocka között
  let frameGap = 0;
  let lastFrame = Date.now();
  let watching = true;
  let gapPhase = '';
  let currentPhase = 'indul';
  const tick = () => {
    const now = Date.now();
    if (now - lastFrame > frameGap) {
      frameGap = now - lastFrame;
      gapPhase = currentPhase;
    }
    lastFrame = now;
    if (watching) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const phases: string[] = [];
  let last = Date.now();
  const started = last;
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_long.wav'), (u) => {
    currentPhase = `${u.phase} ${Math.round((u.ratio ?? 0) * 100)}%`;
    if (phases[phases.length - 1]?.split(':')[0] !== u.phase) {
      phases.push(`${u.phase}: +${Date.now() - last} ms`);
      last = Date.now();
    }
  });
  const ms = Date.now() - started;
  watching = false;
  // a hideg futás a hang-modul első betöltését is méri (a Hang Stúdióban ez a megnyitáskor megtörténik — `exportgap`)
  log(run.startsWith('első') ? null : frameGap <= 50, `T2 a felület export közben is folyékony (leghosszabb képkocka-szünet) — ${run}`, `${frameGap} ms — ${gapPhase} után`);
  log(ms < 30000, 'A26 egy perc keverés a telefonon', `${ms} ms (${(ms / 60).toFixed(0)} ms / mp hang) · ${phases.join(' · ')}`);
  new File(out).delete();
  }
  new File(uri).delete();
}
