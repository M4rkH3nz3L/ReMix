/** 🧪 Füstteszt — effektek: automáció, sorrend, paraméteres EQ/delay, formáns, ingyenes effekt, EQ-söprés. (Áthelyezve: phases05, phases07, phases12, phases13; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { encodeWav16 } from '@/lib/offlineMix';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { previewEngine } from '@/lib/previewEngine';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project, AudioFx } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { runDevAction } from '@/lib/devActions';
import { moveStage } from '@/lib/fxOrder';
import { LiveLoudness } from '@/lib/liveLoudness';
import { toneWav } from '../../helpers/audio';
import '@/lib/dspNativeClient';

/** 🎛️ Effekt-automáció: aluláteresztő-söprés a telefonos exportban és a motorban (valós időben). */
export async function smokeFxAutomation(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let a = 21;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const noise = Float32Array.from({ length: 6 * SR }, () => 0.3 * rnd());
  const src = new File(Paths.document, 'smoke_sweep.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([noise, noise], SR, () => 0.5));
  const id = 'prj_smoke_sweep';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sweep', caught));
  const base = createEmptyProject('smoke söprés', '9:16', undefined, 'audio');
  const sweep = [{ time: 0, value: 20000, easing: 'linear' as const }, { time: 6, value: 300, easing: 'linear' as const }];
  const c: AudioClip = { kind: 'audio', id: 'sw', uri: src.uri, label: 'söprés', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 0.6, fadeIn: 0, fadeOut: 0, keyframes: { fxLowpass: sweep, fxReverb: [{ time: 0, value: 0, easing: 'linear' }, { time: 6, value: 1, easing: 'linear' }] }, source: 'imported' };
  const project: Project = { ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_sweep_out.wav'));
  const api = await loadAudioApi();
  const y = (await api!.decodeAudioData(out, SR)).getChannelData(0);
  const hf = (from: number, to: number) => {
    let e = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) e += (y[i] - y[i - 1]) ** 2;
    return 10 * Math.log10(e / ((to - from) * SR) + 1e-30);
  };
  const drop = hf(0.2, 0.7) - hf(5.2, 5.7);
  // az 5,2–5,7 s-os ablakban a söprés kb. 2 kHz-nél jár (300 Hz-et 6 s-nál éri el), és nő a zengés is
  log(drop > 15, 'telefonos export: a szűrő-söprés a magas tartományt elnyomja', `${drop.toFixed(1)} dB`);
  new File(out).delete();
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const st = useEditorStore.getState;
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(4000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.late === 0, 'a motor valós időben, akadás nélkül játssza (szűrő + zengés automáció)', `${stats.chunks} szelet, ${stats.late} késett`);
  router.back();
  src.delete();
}
/** 🔀 R3 effekt-sorrend: kompresszor→zengés vs. zengés→kompresszor mérhetően más, az élő előnézet = az export (az adott sorrendben), egy undo. */
export async function smokeFxOrder(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 0,25 s-os hangos ütések 1 s-onként (a zengés farka a csendben látszik)
  const x = Float32Array.from({ length: 10 * SR }, (_, i) => ((i / SR) % 1 < 0.25 ? 0.6 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0));
  const f = new File(Paths.document, 'smoke_fxorder.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_fxorder';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fxorder', caught));
  const base = createEmptyProject('smoke effekt-sorrend', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: f.uri, label: 'ütések', start: 0, duration: 10, trimIn: 0, sourceDuration: 10, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: { compressor: true, reverb: 0.8 } };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const render = async (name: string) => {
    const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  // a zengés farkának energiája (az ütések utáni csendben, 0,3–0,9 s)
  const tail = (y: Float32Array) => {
    let e = 0;
    for (let k = 1; k < 9; k++) for (let i = Math.round((k + 0.3) * SR); i < Math.round((k + 0.9) * SR); i++) e += y[i] * y[i];
    return 10 * Math.log10(e / (8 * 0.6 * SR) + 1e-20);
  };
  const a = await render('smoke_fxo_a.wav');
  const before = JSON.stringify(st().project);
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'k', patch: { audioFx: { compressor: true, reverb: 0.8, order: moveStage(undefined, 'reverb', -1) } } });
  st().selectClip('k');
  runDevAction('audio.editClip');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a klipszerkesztőben az effekt-sorrend (zengés a kompresszor előtt)');
  await sleep(2500);
  runDevAction('clipEdit.done');
  const b = await render('smoke_fxo_b.wav');
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  log(d > 0.01 && Math.abs(tail(a) - tail(b)) > 1, 'a sorrend számít: kompresszor→zengés vs. zengés→kompresszor mérhetően más (a zengés farka)', `max eltérés ${d.toFixed(3)}, farok ${tail(a).toFixed(1)} vs ${tail(b).toFixed(1)} dB`);
  // az élő előnézet a választott sorrendben = az export (short-term LUFS)
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(4000);
  const live = previewEngine.loudness();
  const pos = st().playhead;
  st().setPlaying(false);
  // ugyanaz a mérő (short-term, kapu nélküli 3 s) az export ugyanazon pontjáig
  const end = Math.round(pos * SR);
  const meter = new LiveLoudness(SR);
  meter.push(0, b.subarray(0, end), b.subarray(0, end));
  const ref = meter.readAt(end).shortTerm;
  log(!!live && Math.abs(live.shortTerm - ref) <= 0.5, 'az élő előnézet a választott sorrendben szól: a short-term = az export ugyanazon 3 s-a (± 0,5 LU)', live ? `élő ${live.shortTerm.toFixed(2)} vs export ${ref.toFixed(2)} LUFS` : 'null');
  st().undo();
  log(JSON.stringify(st().project) === before, 'egy visszavonás: az alap sorrend', '');
  router.back();
}
/** 🎛️ V7: parametrikus EQ és tempóhoz kötött delay a telefonos exportban — a visszhang a tempóból számolt helyen
 *  (tempóváltás után is, egy undo-lépésben), a sáv a beállított frekvencián emel. */
export async function smokeFxParams(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const wav = (name: string, fill: (i: number) => number, seconds: number) => {
    const n = Math.round(seconds * SR);
    const b = new Uint8Array(44 + n * 2);
    const v = new DataView(b.buffer);
    const txt = (at: number, x: string) => [...x].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(fill(i) * 32767), true);
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.write(b);
    return f.uri;
  };
  const clickAt = Math.round(0.5 * SR);
  const clickUri = wav('smoke_fx_click.wav', (i) => (i === clickAt ? 0.9 : 0), 2);
  const sineUri = wav('smoke_fx_sine.wav', (i) => 0.25 * Math.sin((2 * Math.PI * 3000 * i) / SR), 1);
  const id = 'prj_smoke_fxparam';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fxparam', caught));
  const base = createEmptyProject('smoke fx-paraméterek', '9:16', undefined, 'audio');
  const mk = (cid: string, uri: string, dur: number): AudioClip => ({ kind: 'audio', id: cid, label: cid, uri, start: 0, duration: dur, trimIn: 0, sourceDuration: dur, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('click', clickUri, 2)] } : t.type === 'sfx' ? { ...t, clips: [mk('sine', sineUri, 1)] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const uris: string[] = [];
  const readL = (uri: string) => {
    const h = new File(uri).open();
    try {
      const bytes = h.readBytes(h.size ?? 0);
      const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
      return Float32Array.from({ length: f.length / 2 }, (_, i) => f[i * 2]);
    } finally {
      h.close();
    }
  };
  const only = (keep: string) => {
    const p = st().project!;
    return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id === keep) })) };
  };
  const echoAt = async (name: string) => {
    const out = await exportOfflineWav(only('click'), new File(projectExportDir(), name), undefined, undefined, 'float32');
    uris.push(out.uri);
    const l = readL(out.uri);
    let peak = 0;
    let at = -1;
    for (let i = clickAt + 200; i < l.length; i++) if (Math.abs(l[i]) > peak) { peak = Math.abs(l[i]); at = i; }
    return { ms: ((at - clickAt) / SR) * 1000, peak };
  };
  try {
    // 1) delay 1/8 120 BPM-en → 250 ms
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'click', patch: { audioFx: { delay: 0.8, delayBeats: 0.5 } } }, 'user');
    const fx1 = (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).audioFx;
    const e1 = await echoAt('smoke_fx_d1.wav');
    log(fx1?.delayMs === 250 && Math.abs(e1.ms - 250) < 0.05, 'delay 1/8 120 BPM-en: a visszhang 250 ms-nál (a telefonos exportban)', `delayMs ${fx1?.delayMs} · visszhang ${e1.ms.toFixed(2)} ms (csúcs ${e1.peak.toFixed(2)})`);
    // 2) tempóváltás 90 BPM → 1/8 = 333 ms, egy undo-lépés
    const hist = st().past?.length ?? 0;
    st().dispatch({ type: 'SET_BPM', bpm: 90 }, 'user');
    const fx2 = (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).audioFx;
    const e2 = await echoAt('smoke_fx_d2.wav');
    log(fx2?.delayMs === 333 && Math.abs(e2.ms - 333) < 0.05 && (st().past?.length ?? 0) === hist + 1, 'tempóváltás 90 BPM-re: a delay követi (333 ms), egy undo-lépésben', `delayMs ${fx2?.delayMs} · visszhang ${e2.ms.toFixed(2)} ms · history +${(st().past?.length ?? 0) - hist}`);
    st().undo();
    const fx3 = (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).audioFx;
    log(st().project!.bpm === 120 && fx3?.delayMs === 250, 'visszavonás: a tempó és a delay együtt áll vissza', `${st().project!.bpm} BPM · ${fx3?.delayMs} ms`);
    // 3) parametrikus EQ: +9 dB 3 kHz-en, Q 4
    const gain = async (fx: AudioFx | undefined, name: string) => {
      st().dispatch({ type: 'UPDATE_CLIP', clipId: 'sine', patch: { audioFx: fx } }, 'user');
      const out = await exportOfflineWav(only('sine'), new File(projectExportDir(), name), undefined, undefined, 'float32');
      uris.push(out.uri);
      const l = readL(out.uri);
      let e = 0;
      for (let i = SR / 4; i < (3 * SR) / 4; i++) e += l[i] * l[i];
      return 10 * Math.log10(e / (SR / 2));
    };
    const g0 = await gain(undefined, 'smoke_fx_e0.wav');
    const gParam = await gain({ eq: { low: 0, mid: 9, high: 0, midFreq: 3000, midQ: 4 } }, 'smoke_fx_e1.wav');
    const gOld = await gain({ eq: { low: 0, mid: 9, high: 0 } }, 'smoke_fx_e2.wav');
    log(Math.abs(gParam - g0 - 9) < 0.5 && gOld - g0 < 1.5, 'parametrikus EQ: a 3 kHz-re állított sáv +9 dB-t emel; a régi fix 1 kHz-es sáv ott alig', `paraméteres ${(gParam - g0).toFixed(2)} dB · régi ${(gOld - g0).toFixed(2)} dB`);
    st().selectClip('sine');
    runDevAction('audio.editClip');
    await sleep(900);
    log(true, 'FOTÓZHATÓ', 'a klipszerkesztő: parametrikus EQ és a delay ütemrész-választója');
    await sleep(1500);
    runDevAction('clipEdit.done');
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fxparam-del', caught));
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
  }
}

/** 🆓 2026-11-14: ami a telefonon fut, ingyenes — Free-fiókkal a klip-effekt (preset) paywall nélkül a klipre kerül,
 *  és a telefonos export „nem támogatott” jelzés nélkül, hallhatóan alkalmazza. */
export async function smokeFreeFx(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { useEntitlement } = await import('@/store/entitlementStore');
  const { usePaywall } = await import('@/store/paywallStore');
  const saved = useEntitlement.getState();
  const prev = { tier: saved.tier, proUntil: saved.proUntil, devPro: saved.devPro };
  const id = 'prj_smoke_freefx';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:freefx', caught));
  const base = createEmptyProject('smoke free fx', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_freefx.wav', 2), start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const uris: string[] = [];
  try {
    useEntitlement.setState({ tier: 'free', proUntil: null, devPro: false });
    usePaywall.setState({ visible: false });
    log(!useEntitlement.getState().isPro(), 'Free-fiók beállítva a mérésre', useEntitlement.getState().tier);
    st().selectClip('c');
    runDevAction('audio.editClip');
    await sleep(900);
    runDevAction('clipEdit.applyFxPreset', 'radio');
    await sleep(200);
    runDevAction('clipEdit.done');
    await sleep(500);
    const fx = (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).audioFx;
    log(!!fx && !usePaywall.getState().visible, 'a „Rádió” effekt Free-ben paywall nélkül a klipre kerül', JSON.stringify(fx));
    const dryP = { ...st().project!, tracks: st().project!.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => ({ ...x, audioFx: undefined }) as AudioClip) })) };
    const dry = await exportOfflineWav(dryP, new File(projectExportDir(), 'smoke_freefx_dry.wav'), undefined, undefined, 'float32');
    const wet = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_freefx_wet.wav'), undefined, undefined, 'float32');
    uris.push(dry.uri, wet.uri);
    const rms = (uri: string) => {
      const h = new File(uri).open();
      try {
        const b = h.readBytes(h.size ?? 0);
        const f = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
        let e = 0;
        for (let i = 0; i < f.length; i++) e += f[i] * f[i];
        return Math.sqrt(e / f.length);
      } finally {
        h.close();
      }
    };
    const d = 20 * Math.log10(rms(wet.uri) / rms(dry.uri));
    log(wet.unsupported.length === 0 && Math.abs(d) > 0.5, 'a telefonos export az effekttel szól (nincs „nem támogatott” jelzés)', `eltérés a száraztól ${d.toFixed(2)} dB · nem támogatott: ${JSON.stringify(wet.unsupported)}`);
  } finally {
    useEntitlement.setState(prev);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:freefx-del', caught));
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
  }
}
/** 🗣️ V7.3: formáns-megőrző hangmagasság a telefonos exportban — a +5 félhanggal tolt magánhangzó hangszíne
 *  (spektrális súlypontja) formánssal az eredeti marad, nélküle felcsúszik; a harmónia-hang is. */
export async function smokeFormant(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const n = SR * 2;
  const src = new Float64Array(n);
  for (let t = 0; t < n; t += SR / 150) src[Math.round(t)] = 1;
  let x = src;
  for (const f of [700, 1200]) {
    const r = Math.exp((-Math.PI * 80) / SR);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / SR);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] + a1 * (y[i - 1] ?? 0) - r * r * (y[i - 2] ?? 0);
    x = y;
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const b = new Uint8Array(44 + n * 2);
  const dv = new DataView(b.buffer);
  const txt = (at: number, s0: string) => [...s0].forEach((c, i) => dv.setUint8(at + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); txt(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(((0.4 * x[i]) / peak) * 32767), true);
  const f0 = new File(Paths.cache, 'smoke_formant_vowel.wav');
  if (f0.exists) f0.delete();
  f0.create();
  f0.write(b);
  const centroid = (a: Float32Array) => {
    const N = 4096;
    const off = (a.length >> 1) - N / 2;
    let num = 0;
    let den = 0;
    for (let k = Math.round((250 * N) / SR); k <= Math.round((3000 * N) / SR); k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
        re += a[off + i] * w * Math.cos((2 * Math.PI * k * i) / N);
        im -= a[off + i] * w * Math.sin((2 * Math.PI * k * i) / N);
      }
      num += (re * re + im * im) * ((k * SR) / N);
      den += re * re + im * im;
    }
    return num / den;
  };
  const base = createEmptyProject('smoke formáns', '9:16', undefined, 'audio');
  const proj = (fx: AudioFx) => ({ ...base, id: 'prj_smoke_formant', tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [{ kind: 'audio', id: 'c', label: 'v', uri: f0.uri, start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: fx } as AudioClip] } : t)) });
  const uris: string[] = [];
  const render = async (fx: AudioFx, name: string) => {
    const t0 = Date.now();
    const out = await exportOfflineWav(proj(fx), new File(projectExportDir(), name), undefined, undefined, 'float32');
    uris.push(out.uri);
    const h = new File(out.uri).open();
    try {
      const bytes = h.readBytes(h.size ?? 0);
      const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
      return { c: centroid(Float32Array.from({ length: f.length / 2 }, (_, i) => f[i * 2])), ms: Date.now() - t0, unsupported: out.unsupported };
    } finally {
      h.close();
    }
  };
  try {
    const dry = await render({}, 'smoke_formant_dry.wav');
    const off = await render({ pitchSemitones: 5 }, 'smoke_formant_off.wav');
    const on = await render({ pitchSemitones: 5, formant: true }, 'smoke_formant_on.wav');
    log(off.c / dry.c > 1.2 && Math.abs(on.c / dry.c - 1) < 0.1 && on.unsupported.length === 0, '+5 félhang: formáns nélkül a hangszín felcsúszik, formánssal az eredeti marad', `eredeti ${dry.c.toFixed(0)} Hz · formáns KI ${off.c.toFixed(0)} Hz (${(off.c / dry.c).toFixed(2)}×) · BE ${on.c.toFixed(0)} Hz (${(on.c / dry.c).toFixed(2)}×) · ${on.ms} ms`);
    const hOff = await render({ pitchSemitones: 5, harmony: 7 }, 'smoke_formant_hoff.wav');
    const hOn = await render({ pitchSemitones: 5, harmony: 7, formant: true }, 'smoke_formant_hon.wav');
    log(hOff.c / dry.c > 1.3 && Math.abs(hOn.c / dry.c - 1) < 0.12, 'harmóniával (+12 együtt): a formáns a harmónia-hangra is', `KI ${(hOff.c / dry.c).toFixed(2)}× · BE ${(hOn.c / dry.c).toFixed(2)}× · ${hOn.ms} ms`);
  } finally {
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
    if (f0.exists) f0.delete();
  }
}
/** 🎛️ V7.4: a sáv-frekvencia automációja a telefonos exportban — a közép-sáv 500 Hz-ről 4 kHz-re söpör: az 500 Hz-es
 *  hang az elején emelt (+12 dB körül), a végén nem. */
export async function smokeEqSweep(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const x = Float32Array.from({ length: SR }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 500 * i) / SR));
  const f = new File(Paths.document, 'smoke_eqsweep.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const base = createEmptyProject('smoke eq-söprés', '9:16', undefined, 'audio');
  const kf = [{ id: 'a', time: 0, value: 500, easing: 'linear' as const }, { id: 'b', time: 0.3, value: 500, easing: 'linear' as const }, { id: 'c', time: 0.7, value: 4000, easing: 'linear' as const }, { id: 'd', time: 1, value: 4000, easing: 'linear' as const }];
  const clip: AudioClip = { kind: 'audio', id: 'c', label: 'c', uri: f.uri, start: 0, duration: 1, trimIn: 0, sourceDuration: 1, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: { eq: { low: 0, mid: 12, high: 0, midQ: 4 } }, keyframes: { fxEqMidFreq: kf } };
  const project = { ...base, id: 'prj_smoke_eqsweep', tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) };
  const out = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_eqsweep_out.wav'), undefined, undefined, 'float32');
  const h = new File(out.uri).open();
  let l: Float32Array;
  try {
    const b = h.readBytes(h.size ?? 0);
    const fl = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
    l = Float32Array.from({ length: fl.length / 2 }, (_, i) => fl[i * 2]);
  } finally {
    h.close();
    new File(out.uri).delete();
  }
  const lvl = (a: number, b: number) => {
    let e = 0;
    for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += l[i] * l[i];
    return 20 * Math.log10(Math.sqrt(e / ((b - a) * SR)) / (0.1 / Math.SQRT2));
  };
  const a0 = lvl(0.05, 0.25);
  const a1 = lvl(0.75, 0.95);
  log(a0 > 10 && a1 < 2 && out.unsupported.length === 0, 'a közép-sáv frekvencia-görbéje: 500 Hz-en +12 dB körül, 4 kHz-re söpörve az 500 Hz-es hang visszaesik', `eleje ${a0.toFixed(1)} dB · vége ${a1.toFixed(1)} dB`);
}
