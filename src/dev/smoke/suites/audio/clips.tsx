/** 🧪 Füstteszt — klip-utak: hang videóból, külső hang szinkronja, ütemrács-vágás, loop-klip, mintapontos vágás. (Áthelyezve: phases07, phases12, phases14; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import { canExtractAudio, extractVideoAudio } from '@/lib/videoAudioImport';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject, splitClip } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { type Log, sleep } from '../../helpers/core';
import { smokeFileHost } from '../../helpers/env';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import type { AudioClip, Project } from '@/types/project';
import { runDevAction } from '@/lib/devActions';
import { encodeWav16 } from '@/lib/offlineMix';
import { previewEngine } from '@/lib/previewEngine';
import { beatSplitTimes } from '@/lib/audioTransport';
import { SYNC_MIN_CONFIDENCE, gccPhatLag } from '@/lib/audioSync';
import { syncClipTo } from '@/lib/audioSyncClient';
import { trimAudioRight } from '@/lib/audioTrim';
import { toneWav } from '../../helpers/audio';
import '@/lib/dspNativeClient';

/** 🎬→🎵 T8 hang videóból: a kinyert M4A = a videó hangja (eltolás 0, korreláció ≥ 0,99), a projekt-mappában; hangsáv nélkül érthető hiba, nincs maradék. */
export async function smokeFromVideo(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(canExtractAudio(), 'a build tud hangot kinyerni (natív)', '');
  const SR = 44100;
  const id = 'prj_smoke_fromvideo';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fromvideo', caught));
  const base = createEmptyProject('smoke hang videóból', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(800);
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, 'smoke_vid_audio.mp4');
  const noa = await downloadToCache(`${smokeFileHost()}/vid_noaudio.mp4`, 'smoke_vid_noaudio.mp4');
  if (!vid || !noa) {
    log(false, 'a próbavideók letöltése', '-');
    return;
  }
  const t0 = Date.now();
  const r = await extractVideoAudio(vid, 'próba videó.mp4');
  const ms = Date.now() - t0;
  if (!r.ok) {
    log(false, 'kinyerés', `${r.reason} ${r.message ?? ''}`);
    return;
  }
  const inFolder = r.uri.startsWith(projectMediaDir().uri) && new File(r.uri).exists;
  log(inFolder && r.uri.endsWith('.wav') && Math.abs(r.duration - 6) <= 1 / 30, 'a videó hangja WAV-ként a projekt-mappában, a hossza a videóé (± 1 képkocka)', `${r.duration.toFixed(3)} s, ${((new File(r.uri).size ?? 0) / 1024).toFixed(0)} kB, ${ms} ms, ${r.uri.split('/').slice(-2).join('/')}`);
  const api = (await loadAudioApi())!;
  const ex = (await api.decodeAudioData(r.uri, SR)).getChannelData(0);
  const orig = (await api.decodeAudioData(vid, SR)).getChannelData(0);
  const ref = (i: number) => 0.4 * Math.sin(2 * Math.PI * (300 + 40 * (Math.floor((i / SR) * 10) % 25)) * (i / SR));
  const best = (get: (i: number) => number) => {
    const a = SR;
    const n = SR;
    let bl = 0;
    let bv = -Infinity;
    for (let lag = -2000; lag <= 2000; lag++) {
      let xy = 0;
      for (let j = a; j < a + n; j += 8) xy += ex[j + lag] * get(j);
      if (xy > bv) {
        bv = xy;
        bl = lag;
      }
    }
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let j = a; j < a + n; j++) {
      const p = ex[j + bl];
      const q = get(j);
      xy += p * q;
      xx += p * p;
      yy += q * q;
    }
    return { lag: bl, rho: xy / Math.sqrt(xx * yy) };
  };
  // 2026-11-14: a próbavideó hangja az ismert jel (`ref`) — ez az igazság; az M4A-átmásolás 1303 mintát
  // késett (az AAC előtöltése), a WAV-kinyerés az előtöltést levágja
  const vsRef = best(ref);
  log(Math.abs(vsRef.lag) <= 1 && vsRef.rho >= 0.99, 'a kinyert hang = a videó ismert hangjele (eltolás 0 ± 1 minta, korreláció ≥ 0,99) — nincs AAC-előtöltés', `eltolás ${vsRef.lag} minta, ρ ${vsRef.rho.toFixed(4)}`);
  const vsVideo = best((j) => orig[j] ?? 0);
  log(null, 'a videó közvetlen dekódolásához képest (tájékoztató — a lejátszó-dekóder saját előtöltés-kezelése)', `eltolás ${vsVideo.lag} minta, ρ ${vsVideo.rho.toFixed(4)}`);
  // hangsáv nélküli videó: érthető hiba, nincs maradék fájl, a projekt változatlan
  const before = JSON.stringify(st().project);
  const extracted = () => projectMediaDir().list().filter((x) => /_hang\.(m4a|wav)$/.test(x.name)).length;
  const files0 = extracted();
  const r2 = await extractVideoAudio(noa, 'néma.mp4');
  log(!r2.ok && r2.reason === 'noAudio' && extracted() === files0 && JSON.stringify(st().project) === before, 'hangsáv nélküli videó: „nincs hangsáv” hiba, nincs maradék fájl, a projekt változatlan', `${r2.ok ? 'ok?!' : r2.reason}; kinyert fájlok ${files0} → ${extracted()}; projekt ${JSON.stringify(st().project) === before ? 'változatlan' : 'változott'}`);
  router.back();
}
/** 🎧 V6: mintapontos vágás — hang-projektben a vágás a mintára ül, és a kettévágott klip exportja a vágatlannal
 *  mintára (bitre) egyezik; a videó-projekt marad a frame-rácson. Zajforrás (egy minta csúszása is látszana). */
export async function smokeSampleGrid(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const n = 3 * SR;
  const b = new Uint8Array(44 + n * 4);
  const v = new DataView(b.buffer);
  const txt = (at: number, x: string) => [...x].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 4, true);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n * 2; i++) v.setInt16(44 + i * 2, Math.round(rnd() * 12000), true);
  const src = new File(Paths.cache, 'smoke_grid_noise.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(b);
  const id = 'prj_smoke_grid';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:grid', caught));
  const base = createEmptyProject('smoke minta-rács', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'zaj', uri: src.uri, start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, fps: 30, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const readF32 = (uri: string) => {
    const h = new File(uri).open();
    try {
      const bytes = h.readBytes(h.size ?? 0);
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
    } finally {
      h.close();
    }
  };
  const uris: string[] = [];
  try {
    const ref = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_grid_ref.wav'), undefined, undefined, 'float32');
    uris.push(ref.uri);
    const at = 1.23456;
    st().splitClipAt('c', at);
    const clips = st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
    const right = clips.find((x) => x.start > 0);
    const k = right ? right.start * SR : NaN;
    log(clips.length === 2 && Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) === Math.round(at * SR) && Math.abs(right!.start * 30 - Math.round(right!.start * 30)) > 0.01, 'a vágás a mintára ül (nem a 30 fps-es képkockára)', `${right?.start} s = ${k.toFixed(6)} minta (képkocka-rácson ${(Math.round(at * 30) / 30).toFixed(5)} s lett volna, ${Math.round(Math.abs(Math.round(at * 30) / 30 - at) * SR)} minta eltérés)`);
    const cut = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_grid_cut.wav'), undefined, undefined, 'float32');
    uris.push(cut.uri);
    const ra = readF32(ref.uri);
    const ca = readF32(cut.uri);
    let d = 0;
    let dAround = 0;
    const cutS = Math.round(at * SR) * 2;
    for (let i = 0; i < Math.min(ra.length, ca.length); i++) {
      const e = Math.abs(ra[i] - ca[i]);
      d = Math.max(d, e);
      if (Math.abs(i - cutS) < 2000) dAround = Math.max(dAround, e);
    }
    log(ra.length === ca.length && d === 0, 'null-teszt: a kettévágott klip exportja a vágatlannal mintára egyezik (a vágáspont körül is)', `${ra.length / 2} minta, max eltérés ${d} (vágás ±1000 minta: ${dAround})`);
    st().undo();
    const back = st().project!.tracks.find((t) => t.type === 'music')!.clips.length;
    log(back === 1, 'egy visszavonás: újra egy klip', `${back}`);
    st().setPlayhead(2.000013, true);
    log(Math.abs(st().playhead * SR - Math.round(st().playhead * SR)) < 1e-6 && Math.round(st().playhead * SR) === Math.round(2.000013 * SR), 'a lejátszófej (koppintás/scrub) is a mintára ül', `${st().playhead}`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:grid-del', caught));
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
    if (src.exists) src.delete();
  }
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
