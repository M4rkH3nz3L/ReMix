/** 🧪 Füstteszt — keverés: sávok és buszok, LUFS, klip-erősítés, master-dinamika, referencia, pult, sidechain. (Áthelyezve: phases06, phases07, phases13; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { previewEngine } from '@/lib/previewEngine';
import { encodeWav16 } from '@/lib/offlineMix';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { dbToVolume } from '@/lib/clipGain';
import { masterPreset } from '@/lib/audioMaster';
import { useReference } from '@/store/referenceStore';
import { measureReference, applyReference } from '@/lib/referenceClient';
import { measureMastered } from '@/lib/mixAssistClient';
import { LiveLoudness } from '@/lib/liveLoudness';
import { toneWav } from '../../helpers/audio';
import '@/lib/dspNativeClient';

/** 🎚️ Több sáv + effekt-busz: „+ Sáv”, a negyedik sáv klipje és a zengés-busz szól (motor + export). */
export async function smokeTracksBuses(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // rövid hangcsomag 0,5 s-onként (a zengés a szünetekben hallható)
  const burst = Float32Array.from({ length: 4 * SR }, (_, i) => (i % (SR / 2) < 2205 ? 0.5 * Math.sin((2 * Math.PI * 660 * i) / SR) : 0));
  const src = new File(Paths.document, 'smoke_bursts.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([burst, burst], SR, () => 0.5));
  const id = 'prj_smoke_tracks';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tracks', caught));
  const base = createEmptyProject('smoke sávok + busz', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.addLane');
  await sleep(200);
  const aux = st().project?.tracks.find((t) => t.type === 'aux1');
  log(!!aux, 'a „+ Sáv” gomb új hangsávot ad', aux?.name ?? 'nincs');
  st().undo();
  log(!st().project?.tracks.some((t) => t.type === 'aux1'), 'az új sáv visszavonható');
  st().redo();
  const c: AudioClip = { kind: 'audio', id: 'b4', uri: src.uri, label: 'csomagok', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  st().dispatch({ type: 'ADD_CLIP', trackType: 'aux1', clip: c });
  st().dispatch({ type: 'SET_AUDIO_BUSES', buses: [{ id: 'rv', name: 'Zengés-busz', fx: { reverb: 0.8 }, gain: 1 }] });
  st().dispatch({ type: 'SET_TRACK_SEND', trackType: 'aux1', busId: 'rv', amount: 0.8 });
  await sleep(600);
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(3000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.chunks > 10 && stats.late === 0, 'a negyedik sáv és a busz a motorral szól, akadás nélkül', `${stats.chunks} szelet, ${stats.late} késett`);
  // export: a busz zengése a hangcsomag UTÁN (50–90 ms) hallható; küldés nélkül csend
  const tail = async (project: Project) => {
    const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_tracks.wav'));
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    let e = 0;
    const a = Math.round(0.56 * SR);
    const b = Math.round(0.6 * SR);
    for (let i = a; i < b; i++) e += y[i] * y[i];
    return 10 * Math.log10(e / (b - a) + 1e-30);
  };
  const p = st().project!;
  const wet = await tail(p);
  const dry = await tail({ ...p, audioSends: {} });
  log(wet > -45 && dry < -80, 'telefonos export: a busz zengése a hang után szól, küldés nélkül nem', `küldéssel ${wet.toFixed(1)} dB, nélküle ${dry.toFixed(1)} dB`);
  runDevAction('audio.mixer');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a keverő: 4 sáv, küldés a zengés-buszra, a busz szintje');
  await sleep(4000);
  router.back();
  src.delete();
}

/** 📊 T5 élő LUFS + true-peak: a lejátszott (exporttal azonos) keverésből — ismert jeleken a mért érték az elméleti. */
export async function smokeLiveLufs(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const write = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  // 0–5 s: 1 kHz −14 dBFS (sztereó) = −14 LUFS; 5–10 s: fs/4 szinusz 45°-os fázissal, 0,5 → true-peak −6,02 dBTP (mintacsúcs −9,03)
  const a14 = Math.pow(10, -14 / 20);
  const x = Float32Array.from({ length: 10 * SR }, (_, i) => (i < 5 * SR ? a14 * Math.sin((2 * Math.PI * 1000 * i) / SR) : 0.5 * Math.sin((Math.PI / 2) * i + Math.PI / 4)));
  const uri = write('smoke_lufs_ref.wav', x);
  const id = 'prj_smoke_lufs';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:lufs', caught));
  const base = createEmptyProject('smoke élő LUFS', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri, label: 'ref', start: 0, duration: 10, trimIn: 0, sourceDuration: 10, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  st().setPlayhead(0);
  previewEngine.takeStats();
  const tPlay = Date.now();
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  log(null, 'az előnézet-motor szól', `${previewEngine.isPlaying()} (${Date.now() - tPlay} ms után)`);
  await sleep(4200);
  const r1 = previewEngine.loudness();
  log(true, 'FOTÓZHATÓ', 'a transzporton az élő short-term LUFS és true-peak');
  await sleep(600);
  log(!!r1 && Math.abs(r1.shortTerm - -14) <= 0.5 && Math.abs(r1.momentary - -14) <= 0.5, 'élő hangosság: 1 kHz −14 dBFS sztereó → short-term és momentary −14 ± 0,5 LUFS', r1 ? `S ${r1.shortTerm.toFixed(2)} · M ${r1.momentary.toFixed(2)} · I ${r1.integrated.toFixed(2)} LUFS` : 'null');
  st().setPlaying(false);
  await sleep(300);
  st().setPlayhead(5.2);
  await sleep(200);
  st().setPlaying(true);
  await sleep(2500);
  const r2 = previewEngine.loudness();
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(!!r2 && Math.abs(r2.truePeak - -6.02) <= 0.2, 'élő true-peak: fs/4 szinusz 45°-kal, 0,5 → −6,02 ± 0,2 dBTP (a mintacsúcs −9,03 dB — a minták közti csúcsot is látja)', r2 ? `TP ${r2.truePeak.toFixed(2)} dBTP (max ${r2.truePeakMax.toFixed(2)})` : 'null');
  log(stats.late === 0, 'a mérés mellett sem késik szelet', `${stats.chunks} szelet, ${stats.late} késett`);
  router.back();
}
/** 🔊 T7 klip-erősítés 0 dB fölé: −20 dBFS jel +6 dB-lel → az export −14,0 dBFS, az élő motor −14 LUFS; a régi (0–1) hangerő változatlan. */
export async function smokeClipGain(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const a20 = Math.pow(10, -20 / 20);
  const x = Float32Array.from({ length: 6 * SR }, (_, i) => a20 * Math.sin((2 * Math.PI * 1000 * i) / SR));
  const f = new File(Paths.document, 'smoke_gain_ref.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_gain';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:gain', caught));
  const base = createEmptyProject('smoke klip-erősítés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'g', uri: f.uri, label: 'ref', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const peakDb = async () => {
    const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_gain.wav'), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    let m = 0;
    for (let i = Math.round(0.1 * SR); i < y.length - Math.round(0.1 * SR); i++) m = Math.max(m, Math.abs(y[i]));
    return 20 * Math.log10(m);
  };
  const old = await peakDb();
  log(Math.abs(old - -26.02) <= 0.05, 'régi projekt (hangerő 0,5 = −6,02 dB): az export −26,02 dBFS, változatlan', `${old.toFixed(2)} dBFS`);
  // a csúszka útja: dB → szorzó (ugyanaz a függvény), egy lépés
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'g', patch: { volume: dbToVolume(6) } });
  const boosted = await peakDb();
  log(Math.abs(boosted - -14.0) <= 0.05, '+6 dB: az export −14,0 dBFS (−20 + 6)', `${boosted.toFixed(2)} dBFS, szorzó ${dbToVolume(6).toFixed(4)}`);
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(3800);
  const r = previewEngine.loudness();
  st().setPlaying(false);
  log(!!r && Math.abs(r.shortTerm - -14) <= 0.1 && Math.abs(r.truePeak - -14) <= 0.1, 'az előnézet is erősít: élő short-term −14 ± 0,1 LUFS, true-peak −14 ± 0,1 dBTP', r ? `S ${r.shortTerm.toFixed(2)} LUFS, TP ${r.truePeak.toFixed(2)} dBTP` : 'null (a motor nem szólt)');
  st().undo();
  log((st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).volume === 0.5, 'egy visszavonás: 0,5', '');
  router.back();
}
/** 🗜️🔥 R4 master-kompresszor + szaturáció: a hangos/halk különbség csökken, megjelenik a 3. felharmonikus; az élő előnézet = az export. */
export async function smokeMasterDyn(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 1 kHz, 1 s-onként váltva −6 / −26 dBFS (20 dB különbség)
  const x = Float32Array.from({ length: 8 * SR }, (_, i) => (Math.floor(i / SR) % 2 === 0 ? 0.5 : 0.05) * Math.sin((2 * Math.PI * 1000 * i) / SR));
  const f = new File(Paths.document, 'smoke_masterdyn.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_masterdyn';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:masterdyn', caught));
  const base = createEmptyProject('smoke master-dinamika', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: f.uri, label: 'jel', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
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
  const rmsDb = (y: Float32Array, a: number, b: number) => {
    let e = 0;
    for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += y[i] * y[i];
    return 10 * Math.log10(e / ((b - a) * SR) + 1e-20);
  };
  // a hangos (2. s) és a halk (3. s) rész különbsége (a beállás után)
  const spread = (y: Float32Array) => rmsDb(y, 2.3, 2.9) - rmsDb(y, 3.3, 3.9);
  const goertzel = (y: Float32Array, hz: number, a: number, n: number) => {
    const w = (2 * Math.PI * hz) / SR;
    const cw = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = a; i < a + n; i++) {
      const s0 = y[i] + cw * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - cw * s1 * s2);
  };
  const h3 = (y: Float32Array) => 20 * Math.log10(goertzel(y, 3000, Math.round(2.3 * SR), 22050) / Math.max(1e-12, goertzel(y, 1000, Math.round(2.3 * SR), 22050)));
  const master = { ...masterPreset('youtube'), target: 'custom' as const };
  st().dispatch({ type: 'SET_AUDIO_MASTER', audioMaster: master });
  const plain = await render('smoke_md_a.wav');
  st().dispatch({ type: 'SET_AUDIO_MASTER', audioMaster: { ...master, compressor: { threshold: -24, ratio: 4 }, saturation: 0.6 } });
  const dyn = await render('smoke_md_b.wav');
  log(spread(plain) > 19 && spread(dyn) < spread(plain) - 6, 'master-kompresszor: a hangos/halk különbség érezhetően csökken', `${spread(plain).toFixed(1)} → ${spread(dyn).toFixed(1)} dB`);
  log(h3(plain) < -60 && h3(dyn) > -40, 'szaturáció: megjelenik a 3. felharmonikus (3 kHz)', `${h3(plain).toFixed(1)} → ${h3(dyn).toFixed(1)} dB (az alaphanghoz)`);
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(4000);
  const live = previewEngine.loudness();
  const pos = st().playhead;
  st().setPlaying(false);
  const end = Math.round(pos * SR);
  const meter = new LiveLoudness(SR);
  meter.push(0, dyn.subarray(0, end), dyn.subarray(0, end));
  const ref = meter.readAt(end).shortTerm;
  log(!!live && Math.abs(live.shortTerm - ref) <= 0.5, 'az élő előnézet a kompresszorral és a szaturációval szól: = az export (± 0,5 LU)', live ? `élő ${live.shortTerm.toFixed(2)} vs export ${ref.toFixed(2)} LUFS` : 'null');
  runDevAction('audio.master');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a master-lapon a kompresszor (küszöb, arány) és a szaturáció');
  await sleep(2500);
  router.back();
}
/** 🎧🅰️🅱️ R5 referencia A/B: a referencia (−8 LUFS) a keverés (−20 LUFS) hangosságára illesztve szól, ugyanott, lejátszás közben váltva; a projekt nem változik. */
export async function smokeRefAB(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const write = (name: string, amp: number, hz: number) => {
    const x = Float32Array.from({ length: 14 * SR }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  const mixUri = write('smoke_ref_mix.wav', 0.1, 1000);
  const refUri = write('smoke_ref_song.wav', 0.4, 440);
  const id = 'prj_smoke_refab';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:refab', caught));
  const base = createEmptyProject('smoke referencia', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: mixUri, label: 'keverés', start: 0, duration: 14, trimIn: 0, sourceDuration: 14, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const before = JSON.stringify(st().project);
  // a felület útja: a referencia mérése + a keverés hangossága (ugyanazok a függvények)
  const m = await measureReference(refUri);
  const mixStats = await measureMastered(st().project!, { isTrackAudible: st().isTrackAudible, masterVolume: st().masterVolume });
  log(!!m && Math.abs(m.lufs - -8) <= 1 && !!mixStats && Math.abs(mixStats.lufs - -20) <= 0.3, 'a referencia és a keverés hangossága mérve', `referencia ${m?.lufs.toFixed(2)} LUFS, keverés ${mixStats?.lufs.toFixed(2)} LUFS`);
  if (!m || !mixStats) return;
  await applyReference({ uri: refUri, name: 'referencia', ...m });
  useReference.getState().setMixLufs(mixStats.lufs);
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(3600);
  const a = previewEngine.loudness();
  const headA = st().playhead;
  useReference.getState().setListening(true);
  await sleep(3600);
  const b = previewEngine.loudness();
  const headB = st().playhead;
  log(true, 'FOTÓZHATÓ', 'B: a referencia szól (a master-lapon)');
  useReference.getState().setListening(false);
  await sleep(300);
  st().setPlaying(false);
  log(!!a && !!b && Math.abs(a.shortTerm - mixStats.lufs) <= 0.5 && Math.abs(b.shortTerm - mixStats.lufs) <= 0.5, 'A: a keverés, B: a referencia — mindkettő a keverés hangosságán (± 0,5 LU); illesztés nélkül a B 12 dB-lel hangosabb volna', a && b ? `A ${a.shortTerm.toFixed(2)} · B ${b.shortTerm.toFixed(2)} LUFS (a referencia saját: ${m.lufs.toFixed(1)})` : 'null');
  log(headB > headA + 3, 'a váltás nem ugrik vissza: a lejátszás ugyanott folytatódik', `${headA.toFixed(2)} → ${headB.toFixed(2)} s`);
  log(JSON.stringify(st().project) === before, 'a projekt nem változott', '');
  useReference.getState().setRef(null);
  router.back();
}
/** 🎚️ Keverőpult tableten: függőleges faderek egymás mellett (képernyőkép), a fader akadálymentes állítása. */
export async function smokeConsole(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_console';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:console', caught));
  const base = createEmptyProject('smoke keverőpult', '9:16', undefined, 'audio');
  const uri = toneWav('smoke_console.wav', 4);
  const ac = (cid: string): AudioClip => ({ kind: 'audio', id: cid, label: cid, uri, start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, trackMix: { music: { gain: 0.5 }, voiceover: { gain: 1 }, sfx: { gain: 0.25 } }, tracks: base.tracks.map((t) => (['music', 'voiceover', 'sfx'].includes(t.type) ? { ...t, clips: [ac(t.type)] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.mixer');
  await sleep(1200);
  // telefonon (keskeny ablak) a keverőpult-nézet nem alkalmazható — tájékoztató sor, nem hiba
  const wide = Dimensions.get('window').width >= 700;
  log(wide ? true : null, wide ? 'tablet-szélesség: keverőpult-nézet' : 'telefon-szélesség: a keverőpult-nézet csak tableten (nem mérhető itt)', `${Dimensions.get('window').width} pt`);
  log(true, 'FOTÓZHATÓ', 'a keverőpult: zene −6 dB, beszéd 0 dB, effekt −12 dB függőleges faderen');
  await sleep(3000);
  router.back();
}
/** 🎚️ V9: sávonkénti sidechain — a pad (zene) a lábdob (Aux 1) alatt halkul a telefonos exportban, ugyanúgy, mint a
 *  szerveres renderben (ott valódi ffmpeggel mérve 25,0 dB); egy visszavonás kikapcsolja. */
export async function smokeSidechain(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const n = 4 * SR;
  const wav = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  const pad = wav('smoke_sc_pad.wav', Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR)));
  const kick = wav('smoke_sc_kick.wav', Float32Array.from({ length: n }, (_, i) => (i % SR < 0.1 * SR ? 0.8 * Math.sin((2 * Math.PI * 60 * i) / SR) : 0)));
  const id = 'prj_smoke_sidechain';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sc', caught));
  const base = createEmptyProject('smoke sidechain', '9:16', undefined, 'audio');
  const mk = (cid: string, uri: string): AudioClip => ({ kind: 'audio', id: cid, label: cid, uri, start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: [...base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('pad', pad)] } : t)), { id: 'trk_a1', type: 'aux1', name: 'Dob', clips: [mk('kick', kick)] }] });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const level = async () => {
    const out = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_sc.wav'), undefined, undefined, 'float32');
    const h = new File(out.uri).open();
    let l: Float32Array;
    try {
      const b = h.readBytes(h.size ?? 0);
      const f = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
      l = Float32Array.from({ length: f.length / 2 }, (_, i) => f[i * 2]);
    } finally {
      h.close();
      new File(out.uri).delete();
    }
    const rms = (a: number, b: number) => {
      let e = 0;
      for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += l[i] ** 2;
      return 10 * Math.log10(e / ((b - a) * SR));
    };
    return { during: rms(1.12, 1.2), between: rms(1.7, 1.9) };
  };
  try {
    const off = await level();
    st().dispatch({ type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'aux1', ratio: 10 } }, 'user');
    const on = await level();
    const dip = on.between - on.during;
    log(Math.abs(off.between - off.during) < 0.5 && dip > 22 && dip < 28 && on.between > -18, 'a pad a lábdob alatt halkul (≈ 25 dB, mint a szerveren), az ütések között visszajön', `KI ${(off.between - off.during).toFixed(1)} dB · BE ${dip.toFixed(1)} dB (ütés után ${on.during.toFixed(1)}, között ${on.between.toFixed(1)} dBFS; szerver: 25,0)`);
    runDevAction('audio.mixer');
    await sleep(900);
    log(true, 'FOTÓZHATÓ', 'a keverő Sidechain szakasza');
    await sleep(1500);
    st().undo();
    log(!st().project!.trackMix?.music?.sidechain, 'egy visszavonás kikapcsolja', JSON.stringify(st().project!.trackMix ?? {}));
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sc-del', caught));
  }
}
/** 🎚️ V9.2: effekt-busz — a telefonos export ugyanúgy szól, mint a szerveres render (ott valódi ffmpeggel mérve:
 *  közvetlen −6,1 dB, visszhang −22,0 dB egy 0,05 s-os ütés után, zengés-busz 0,6 küldéssel, 0,8 visszatéréssel). */
export async function smokeBusParity(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const n = 2 * SR;
  const x = Float32Array.from({ length: n }, (_, i) => (i >= 0.5 * SR && i < 0.55 * SR ? 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR) : 0));
  const f = new File(Paths.document, 'smoke_bus_burst.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const base = createEmptyProject('smoke busz', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 's', label: 's', uri: f.uri, start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const project = { ...base, id: 'prj_smoke_bus', audioBuses: [{ id: 'rev', name: 'Z', fx: { reverb: 0.6 }, gain: 0.8 }], audioSends: { sfx: { rev: 0.6 } }, tracks: base.tracks.map((t) => (t.type === 'sfx' ? { ...t, clips: [clip] } : t)) };
  const out = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_bus.wav'), undefined, undefined, 'float32');
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
  const db = (a: number, b: number) => {
    let e = 0;
    for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += l[i] ** 2;
    return 10 * Math.log10(e / ((b - a) * SR) + 1e-20);
  };
  const direct = db(0.5, 0.55);
  const echo = db(0.56, 0.66);
  log(Math.abs(direct + 6.1) < 1 && Math.abs(echo + 22.0) < 1.5, 'a zengés-busz a telefonos exportban ugyanúgy szól, mint a szerveren (±1 dB)', `közvetlen ${direct.toFixed(1)} dB (szerver −6,1) · visszhang ${echo.toFixed(1)} dB (szerver −22,0)`);
}
