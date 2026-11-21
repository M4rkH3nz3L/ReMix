/** 🧪 Füstteszt — telefonos hang-export: WAV, sebesség, szűrők, Pro-paritás, export-rés, opciók, profil. (Áthelyezve: phases04, phases06, phases12, phases14; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { exportAudioToFile } from '@/lib/render';
import { audioExportSettings } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { encodeWav16, offlineMixPlan } from '@/lib/offlineMix';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { cloudInThisBuild } from '../../helpers/env';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { waveformCacheKey, getWaveform } from '@/lib/waveform';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { toneWav } from '../../helpers/audio';
import { runDevAction } from '@/lib/devActions';
import { cloudAvailable } from '@/lib/backend';
import '@/lib/dspNativeClient';

/** 🎛️ Szűrők + EQ a közös DSP-ben: a telefonos export = a szerveres (ffmpeg) export, kivonva. */
export async function smokeOfflineFx(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // a telefon ↔ szerver összevetéshez felhő kell — felhő nélküli (release) buildben jelzetten kimarad
  if (!cloudInThisBuild()) {
    log(null, 'felhő nélküli build: a telefon ↔ szerver összevetés kimarad (az élesítéskor újramérendő)', '');
    return;
  }
  const SR = 44100;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const noiseL = Float32Array.from({ length: 4 * SR }, () => 0.25 * rnd());
  const noiseR = Float32Array.from({ length: 4 * SR }, () => 0.25 * rnd());
  const src = new File(Paths.document, 'smoke_fx_noise.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([noiseL, noiseR], SR, () => 0.5));
  const base = createEmptyProject('smoke fx', '1:1', undefined, 'audio');
  const fx = { highpass: 200, lowpass: 6000, eq: { low: 4, mid: -3, high: 5 } };
  const c: AudioClip = { kind: 'audio', id: 'fx', uri: src.uri, label: 'fx', start: 0.25, duration: 3, trimIn: 0.2, sourceDuration: 4, volume: 0.8, fadeIn: 0.2, fadeOut: 0.3, pan: 0.3, audioFx: fx, source: 'imported' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  log(offlineMixPlan(project).unsupported.length === 0, 'a szűrős-EQ-s projekt az előnézeti motorról és a telefonos exporttal szól');
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_fx_phone.wav'));
  log(null, 'telefonos export', `${Date.now() - t0} ms`);
  const serverFile = new File(projectExportDir(), 'smoke_fx_server.wav');
  await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 44100, channels: 2 }), serverFile);
  const api = await loadAudioApi();
  const mine = await api!.decodeAudioData(out, SR);
  const theirs = await api!.decodeAudioData(serverFile.uri, SR);
  const db = (xs: Float32Array) => 10 * Math.log10(xs.reduce((a, v) => a + v * v, 0) / Math.max(1, xs.length) + 1e-30);
  for (const ch of [0, 1]) {
    const a = mine.getChannelData(ch);
    const b = theirs.getChannelData(ch);
    const n = Math.min(a.length, b.length);
    const diff = Float32Array.from({ length: n }, (_, i) => a[i] - b[i]);
    const snr = db(b.subarray(0, n)) - db(diff);
    log(snr > 60, `szűrők + EQ: telefon = szerver (${ch === 0 ? 'bal' : 'jobb'})`, `${snr.toFixed(1)} dB a jel alatt, hossz ${a.length}/${b.length}`);
  }
  new File(out).delete();
  serverFile.delete();
  src.delete();
}
/**
 * 🎧 Pro szerveres export = a telefon keverése: dinamika-effektes, masteres projekt — a szerverre
 * a telefon kész keverése megy fel; a letöltött 24 bites fájl = a telefonos keverés (kivonva).
 */
export async function smokeProExport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let a = 3;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const x = Float32Array.from({ length: 4 * SR }, (_, i) => 0.3 * rnd() * (i % 22050 < 11025 ? 1 : 0.2));
  const src = new File(Paths.document, 'smoke_pro_src.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const base = createEmptyProject('smoke pro export', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'p', uri: src.uri, label: 'p', start: 0.2, duration: 3.5, trimIn: 0.1, sourceDuration: 4, volume: 0.8, fadeIn: 0.1, fadeOut: 0.2, pan: -0.3, audioFx: { compressor: true, reverb: 0.4, deEsser: true }, source: 'imported' };
  const project: Project = { ...base, audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', multiband: true }, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  // a telefon saját keverése (referencia)
  const phone = new File(projectExportDir(), 'smoke_pro_phone.wav');
  await exportOfflineWav(project, phone, undefined, undefined, 'float32');
  // a Pro szerveres export (24 bit) — a feltöltött keverésből
  const server = new File(projectExportDir(), 'smoke_pro_server.wav');
  const t0 = Date.now();
  await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 44100, channels: 2 }), server);
  log(null, 'Pro export', `${Date.now() - t0} ms`);
  const api = await loadAudioApi();
  const mine = await api!.decodeAudioData(phone.uri, SR);
  const theirs = await api!.decodeAudioData(server.uri, SR);
  const db = (xs: Float32Array) => 10 * Math.log10(xs.reduce((acc, v) => acc + v * v, 0) / Math.max(1, xs.length) + 1e-30);
  for (const ch of [0, 1]) {
    const m = mine.getChannelData(ch);
    const t = theirs.getChannelData(ch);
    const n = Math.min(m.length, t.length);
    const diff = Float32Array.from({ length: n }, (_, i) => m[i] - t[i]);
    const snr = db(t.subarray(0, n)) - db(diff);
    log(snr > 80, `Pro szerveres export = telefonos keverés (${ch === 0 ? 'bal' : 'jobb'})`, `${snr.toFixed(1)} dB a jel alatt, hossz ${m.length}/${t.length}`);
  }
  phone.delete();
  server.delete();
  src.delete();
}
/** ⚡ T1 a valós menetben: a Hang Stúdió megnyitása (hidegen), majd export — a leghosszabb képkocka-szünet mindkettőben. */
export async function smokeExportGap(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // a forrás megmarad a futások között (a hullámforma lemez-cache-e a módosítás idejéhez kötött)
  const keep = new File(Paths.document, 'smoke_xgap_keep.wav');
  const uri = keep.exists ? keep.uri : toneWav('smoke_xgap_keep.wav', 60);
  const id = 'prj_smoke_xgap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:xgap', caught));
  const base = createEmptyProject('smoke export-akadás', '1:1', undefined, 'audio');
  const mk = (cid: string, start: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 40, trimIn: 0, sourceDuration: 60, volume: 0.5, fadeIn: 1, fadeOut: 1, source: 'imported' });
  const project: Project = { ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('a', 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('b', 10)] } : tr.type === 'voiceover' ? { ...tr, clips: [mk('c', 20)] } : tr)) };
  await saveProject(project);
  // a hullámforma a lemez-cache-ből jöjjön (mint egy már megnyitott projektnél) — az első futás
  // kiszámolja (és betölti a modult), ezért a mérés csak lemez-cache találatkor érvényes
  const wf = new File(Paths.cache, `${waveformCacheKey(uri, new File(uri).size ?? 0, new File(uri).modificationTime ?? 0)}.json`);
  const cold = wf.exists;
  if (!cold) await getWaveform(uri, { userInitiated: true });
  const watch = () => {
    let gap = 0;
    let at = 0;
    let last = Date.now();
    const t0 = last;
    let on = true;
    const tick = () => {
      const now = Date.now();
      if (now - last > gap) {
        gap = now - last;
        at = last - t0;
      }
      last = now;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      on = false;
      return { gap, at };
    };
  };
  // a megnyitás utáni 8 s: minden > 30 ms-os képkocka-szünet időbélyeggel
  const gaps: string[] = [];
  let lastF = Date.now();
  const tOpen = lastF;
  let onF = true;
  const tickF = () => {
    const now = Date.now();
    if (now - lastF > 30) gaps.push(`${now - lastF} ms @${lastF - tOpen}`);
    lastF = now;
    if (onF) requestAnimationFrame(tickF);
  };
  requestAnimationFrame(tickF);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(100);
  await sleep(8000);
  onF = false;
  log(null, 'megnyitás utáni 8 s (> 30 ms-os szünetek)', gaps.join(' · ') || '—');
  // ellenpróba: 3 s üresjárat (nincs képkocka-kérés) után munka NÉLKÜL indított figyelő
  await sleep(3000);
  const idle = watch();
  await sleep(300);
  const idleRes = idle();
  log(null, 'ellenpróba: munka nélkül, üresjárat után', `leghosszabb szünet ${idleRes.gap} ms @${idleRes.at} ms`);
  await sleep(3000);
  // a megnyitott stúdió már betöltötte a hang-modult (a lejátszó-motor) — az export nem fizeti meg
  const tl = Date.now();
  await loadAudioApi();
  log(cold ? Date.now() - tl < 10 : null, 'a hang-modul a megnyitott stúdióban már betöltve (az export nem tölti be hidegen)', `${Date.now() - tl} ms${cold ? '' : ' — első futás: a hullámforma számolása töltötte be, nem mérvadó'}`);
  const stopExport = watch();
  await sleep(80);
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_xgap.wav'));
  const ms = Date.now() - t0;
  const exp = stopExport();
  new File(out).delete();
  log(exp.gap <= 50, 'T1 export a megnyitott stúdióból: a felület nem akad (leghosszabb képkocka-szünet ≤ 50 ms)', `${exp.gap} ms @${exp.at} ms, export ${ms} ms`);
  router.back();
}
/** 🎯 V12: az export-lapon a profil (podcast) javasolt formátuma, a cél és a mért hangosság ítélete; „Profil szerint” alkalmazza. */
export async function smokeExportProfile(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { masterPreset } = await import('@/lib/audioMaster');
  const { useReference } = await import('@/store/referenceStore');
  const id = 'prj_smoke_exprof';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:exprof', caught));
  const base = createEmptyProject('smoke export-profil', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_exprof.wav', 2), start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, audioMaster: masterPreset('podcast'), tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  try {
    useReference.getState().setMixLufs(-16.3);
    runDevAction('audio.exportSheet');
    await sleep(800);
    type S = { format: string; quality: { sampleRate: number; channels: number; bitDepth: number; bitrateKbps: number }; rec: { format: string; quality: { sampleRate: number; channels: number; bitDepth: number; bitrateKbps: number } } | null; verdict: string | null };
    const s0 = runDevAction('exportSheet.state') as S;
    const pro = s0.rec?.format === 'mp3';
    const recOk = pro ? s0.rec!.quality.channels === 1 && s0.rec!.quality.bitrateKbps === 128 : s0.rec?.format === 'wav' && s0.rec.quality.sampleRate === 44100 && s0.rec.quality.channels === 1;
    log(!!s0.rec && recOk && s0.verdict === 'ok', `podcast-profil: javaslat ${pro ? 'MP3 128 kbps mono (Pro)' : 'telefonos WAV 44,1 kHz mono (Free)'}; a mért −16,3 LUFS a −16-os célon`, JSON.stringify({ rec: s0.rec, verdict: s0.verdict }));
    useReference.getState().setMixLufs(-19);
    await sleep(300);
    const s1 = runDevAction('exportSheet.state') as S;
    log(s1.verdict === 'quiet', 'a mért −19 LUFS: „halkabb a célnál”', `${s1.verdict}`);
    runDevAction('exportSheet.applyProfile');
    await sleep(300);
    const s2 = runDevAction('exportSheet.state') as S;
    log(s2.format === s0.rec!.format && JSON.stringify(s2.quality) === JSON.stringify(s0.rec!.quality), '„Profil szerint”: a lap a javasolt formátumra és minőségre áll', `${s2.format} ${JSON.stringify(s2.quality)}`);
    log(true, 'FOTÓZHATÓ', 'az export-lap profil-sora');
    await sleep(1500);
  } finally {
    useReference.getState().setMixLufs(null);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:exprof-del', caught));
  }
}
/** 🎧 AUDIO-PROD (telefonos WAV-opciók): mono és 48 kHz a telefonos exportban — pontos fejléc és hossz, a tartalom
 *  a 44,1 kHz-es sztereó keverés mono-átlaga a pure átmintavételezőn át (a 16 bites kvantálás pontosságával). */
export async function smokeWavOptions(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { readFileFormat } = await import('@/lib/media');
  const { StreamResampler } = await import('@/lib/streamResampler');
  const base = createEmptyProject('smoke wav-opciók', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_wavopt.wav', 3), start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.6, fadeIn: 0.2, fadeOut: 0.2, source: 'imported' };
  const project = { ...base, id: 'prj_smoke_wavopt', tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  const readAll = (uri: string) => {
    const h = new File(uri).open();
    try {
      return h.readBytes(h.size ?? 0);
    } finally {
      h.close();
    }
  };
  const uris: string[] = [];
  try {
    const ref = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_ref.wav'), undefined, undefined, 'float32');
    uris.push(ref.uri);
    const rb = readAll(ref.uri);
    const rv = new DataView(rb.buffer, rb.byteOffset);
    const n = (rb.length - 44) / 8;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (rv.getFloat32(44 + i * 8, true) + rv.getFloat32(48 + i * 8, true)) * 0.5;
    const rs = new StreamResampler(44100, 48000, 1);
    const a = rs.process([mono])[0];
    const b = rs.flush()[0];
    const expect = new Float32Array(a.length + b.length);
    expect.set(a);
    expect.set(b, a.length);
    const t0 = Date.now();
    const out = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_m48.wav'), undefined, undefined, 'pcm16', { bits: 16, channels: 1, sampleRate: 48000 });
    const ms = Date.now() - t0;
    uris.push(out.uri);
    const fmt = readFileFormat(out.uri);
    const ob = readAll(out.uri);
    const frames = StreamResampler.outFrames(n, 44100, 48000);
    log(fmt.container === 'wav' && fmt.sampleRate === 48000 && fmt.channels === 1 && fmt.bitDepth === 16 && ob.length === 44 + frames * 2, 'mono 48 kHz 16 bit: a fejléc és a fájlméret pontos', `${JSON.stringify(fmt)} · ${ob.length} bájt (várt ${44 + frames * 2}) · ${ms} ms`);
    const ov = new DataView(ob.buffer, ob.byteOffset);
    let d = 0;
    for (let i = 0; i < frames; i++) d = Math.max(d, Math.abs(ov.getInt16(44 + i * 2, true) / 32767 - expect[i]));
    log(d <= 1.55 / 32767, 'a tartalom = a sztereó keverés mono-átlaga 48 kHz-en (a pure átmintavételező; 16 bit TPDF-ditherrel ≤ 1,5 LSB)', `max eltérés ${(d * 32767).toFixed(2)} LSB`);
    const st24 = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_s48.wav'), undefined, undefined, 'pcm16', { bits: 24, channels: 2, sampleRate: 48000 });
    uris.push(st24.uri);
    const f2 = readFileFormat(st24.uri);
    const sz = new File(st24.uri).size ?? 0;
    log(f2.sampleRate === 48000 && f2.channels === 2 && f2.bitDepth === 24 && sz === 44 + frames * 6, 'sztereó 48 kHz 24 bit: fejléc és méret', `${JSON.stringify(f2)} · ${sz} bájt`);
    const m44 = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_m44.wav'), undefined, undefined, 'pcm16', { channels: 1 });
    uris.push(m44.uri);
    const mb = readAll(m44.uri);
    const mv = new DataView(mb.buffer, mb.byteOffset);
    let dm = 0;
    for (let i = 0; i < n; i++) dm = Math.max(dm, Math.abs(mv.getInt16(44 + i * 2, true) / 32767 - mono[i]));
    log(readFileFormat(m44.uri).channels === 1 && mb.length === 44 + n * 2 && dm <= 1.55 / 32767, 'mono 44,1 kHz (podcast): átmintavételezés nélkül, a mono-átlag mintára (dither ≤ 1,5 LSB)', `${mb.length} bájt · max eltérés ${(dm * 32767).toFixed(2)} LSB`);
  } finally {
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
  }
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
