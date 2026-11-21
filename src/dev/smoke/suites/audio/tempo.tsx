/** 🧪 Füstteszt — tempó és ütem: ütemjelzés, ütemhez nyújtás, tempó-felismerés, metronóm, tempo-map. (Áthelyezve: phases06, phases07, phases09, phases12; viselkedés-változás nélkül.) */
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { barsBeatsLabel } from '@/lib/audioTransport';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { toneWav } from '../../helpers/audio';
import { File, Paths } from 'expo-file-system';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { exportOfflineWav, probeStretchTiming, measureStretchLatency } from '@/lib/offlineMixClient';
import { tempoMatchPatch } from '@/lib/tempoMatch';
import { encodeWav16 } from '@/lib/offlineMix';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { previewEngine } from '@/lib/previewEngine';
import { useRecordPrefs } from '@/store/recordPrefsStore';
import { clickSample } from '@/lib/metronome';
import { detectBeats, lastBeatPath } from '@/lib/beats';
import '@/lib/dspNativeClient';

/** 🎼 Ütemjelzés: a gomb 4/4 → 3/4 → 2/4 → 6/8; a kijelzés és a rács követi; undo. */
export async function smokeMeter(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_meter.wav', 8);
  const id = 'prj_smoke_meter';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:meter', caught));
  const base = createEmptyProject('smoke ütemjelzés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri, label: 'dal', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  for (let i = 0; i < 3; i++) {
    runDevAction('audio.meter');
    await sleep(150);
  }
  const ts = st().project?.timeSignature;
  log(ts?.beatsPerBar === 6 && ts.beatUnit === 8, 'a gomb háromszor: 4/4 → 3/4 → 2/4 → 6/8', `${ts?.beatsPerBar}/${ts?.beatUnit}`);
  st().setPlayhead(1.75);
  await sleep(200);
  log(barsBeatsLabel(120, 1.75, ts) === '2.2', 'a kijelzés 6/8-ban: 1,75 s = 2. ütem 2. nyolcad', barsBeatsLabel(120, 1.75, ts));
  st().undo();
  log(st().project?.timeSignature?.beatsPerBar === 2, 'az ütemjelzés visszavonható (2/4)', `${st().project?.timeSignature?.beatsPerBar}/${st().project?.timeSignature?.beatUnit}`);
  st().redo();
  runDevAction('audio.fit');
  log(true, 'FOTÓZHATÓ', '6/8: nyolcados rács, ütemvonal 1,5 s-onként, a kijelző „6/8”');
  await sleep(4000);
  router.back();
}
/** 🥁↔️ T9 ütemhez nyújtás: 120 BPM-es kattanás 100 BPM-es projektben → az exportban 0,600 s-onként, a hangmagasság változatlan (1000 Hz ± 1 %). */
export async function smokeTempoMatch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 1 kHz-es, 40 ms-os ütések 0,5 s-onként (120 BPM), szinusz-burkolóval (nincs kattanás a széleken)
  const x = Float32Array.from({ length: 8 * SR }, (_, i) => {
    const ph = (i / SR) % 0.5;
    return ph < 0.04 ? 0.5 * Math.sin(Math.PI * (ph / 0.04)) * Math.sin(2 * Math.PI * 1000 * (i / SR)) : 0;
  });
  const f = new File(Paths.document, 'smoke_tempo_click120.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_tempo';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tempo', caught));
  const base = createEmptyProject('smoke tempó-illesztés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: f.uri, label: 'klikk 120', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 100, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const before = JSON.stringify(st().project);
  // a gomb útja: ugyanaz a függvény, egy lépés
  st().selectClip('k');
  runDevAction('audio.editClip');
  await sleep(600);
  log(true, 'FOTÓZHATÓ', 'a klipszerkesztőben a tempó-illesztés (forrás 120, „Illeszd: 100 BPM”)');
  await sleep(2500);
  // ellenpróba: az első ütés energia-középpontja nyújtás NÉLKÜL (a klip-eleji mikro-fade hatása)
  {
    const { uri: o0 } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_tempo0.wav'), undefined, undefined, 'float32');
    const y0 = (await (await loadAudioApi())!.decodeAudioData(o0, SR)).getChannelData(0);
    new File(o0).delete();
    const cAt = (from: number) => {
      let e = 0;
      let te = 0;
      for (let i = Math.round(from * SR); i < Math.round((from + 0.13) * SR); i++) {
        const p = y0[i] * y0[i];
        e += p;
        te += (i / SR) * p;
      }
      return te / e;
    };
    log(null, 'nyújtás nélkül: az 1. és a 2. ütés energia-középpontja', `${(cAt(0) * 1000).toFixed(1)} / ${((cAt(0.47) - 0.5) * 1000).toFixed(1)} ms (az ütés elejéhez)`);
  }
  const patch = tempoMatchPatch(st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip, 120, 100)!;
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'k', patch });
  runDevAction('clipEdit.done');
  await sleep(300);
  const k = st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
  log(Math.abs((k.speed ?? 1) - 100 / 120) < 1e-9 && Math.abs(k.duration - 9.6) < 1e-9 && k.sourceBpm === 120, 'illesztve: sebesség 0,8333, a klip 9,6 s (ugyanaz a forrás)', `×${k.speed?.toFixed(4)}, ${k.duration.toFixed(3)} s`);
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_tempo.wav'), undefined, undefined, 'float32');
  const ms = Date.now() - t0;
  const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
  new File(out).delete();
  // az ütések kezdete (a legnagyobb csúcs negyedénél)
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
  const onsets: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (Math.abs(y[i]) > peak * 0.25) {
      onsets.push(i / SR);
      i += Math.round(0.3 * SR);
    }
  }
  // az ütés ideje = az energia-középpontja (a nyújtás az ütés elejét elkeni — a küszöb-átlépés ütésenként mást mérne)
  const centroid = (o: number) => {
    let e = 0;
    let te = 0;
    for (let i = Math.max(0, Math.round((o - 0.03) * SR)); i < Math.min(y.length, Math.round((o + 0.1) * SR)); i++) {
      const p = y[i] * y[i];
      e += p;
      te += (i / SR) * p;
    }
    return te / e;
  };
  const cs = onsets.map(centroid);
  {
    const pr = await probeStretchTiming(100 / 120);
    log(null, 'szonda: burstönkénti késés 0,5 s-onként (0,8333×)', pr ? pr.map((x) => `${((x / SR) * 1000).toFixed(1)}`).join(' / ') + ' ms' : '—');
  }
  log(null, 'a nyújtó mért késése (0,8333×)', `${(((await measureStretchLatency(100 / 120)) ?? 0) / SR * 1000).toFixed(1)} ms`);
  log(null, 'nyújtva: az 1. és a 2. ütés energia-középpontja', `${(cs[0] * 1000).toFixed(1)} / ${((cs[1] - 0.6) * 1000).toFixed(1)} ms`);
  const gaps = cs.slice(1).map((o, i) => o - cs[i]);
  const worst = gaps.reduce((m, g) => Math.max(m, Math.abs(g - 0.6)), 0);
  const drift = cs.length > 1 ? cs[cs.length - 1] - cs[0] - 0.6 * (cs.length - 1) : NaN;
  log(onsets.length === 16 && worst <= 0.005 && Math.abs(drift) <= 0.005, 'az exportban az ütések 0,600 s-onként (100 BPM): ütésenként ± 5 ms, 15 ütésen át sincs csúszás', `${onsets.length} ütés, a legnagyobb eltérés ${(worst * 1000).toFixed(1)} ms, összcsúszás ${(drift * 1000).toFixed(1)} ms; közök ${gaps.map((g) => (g * 1000).toFixed(0)).join(' ')} ms (export ${ms} ms)`);
  // a hangmagasság: az ütésen belüli nullátmenetek (a középső 24 ms)
  const hz: number[] = [];
  for (const o of onsets.slice(1, 6)) {
    const a = Math.round((o + 0.008) * SR);
    const b = a + Math.round(0.024 * SR);
    let zc = 0;
    for (let i = a + 1; i < b; i++) if ((y[i - 1] < 0) !== (y[i] < 0)) zc++;
    hz.push(zc / 2 / 0.024);
  }
  const worstHz = hz.reduce((m, h) => Math.max(m, Math.abs(h - 1000) / 1000), 0);
  log(worstHz <= 0.01 ? true : worstHz <= 0.03 ? null : false, 'a hangmagasság változatlan: 1000 Hz ± 1 % (nem lassult le a hang)', `${hz.map((h) => h.toFixed(0)).join(' / ')} Hz`);
  st().undo();
  log(JSON.stringify(st().project) === before, 'egy visszavonás: az eredeti tempó', '');
  router.back();
}
/** 🥁 AP3: a tempó-felismerés a telefonon fut (worker nélkül); 120 és 93 BPM klikk-sávon ±1 BPM, a beatek a rácson. */
export async function smokeBpmOffline(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const click = (name: string, bpm: number, sec: number) => {
    const x = new Float32Array(Math.round(sec * SR));
    let seed = bpm;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    const period = (60 / bpm) * SR;
    for (let k = 0; k * period < x.length; k++) {
      const at = Math.round(k * period);
      const amp = k % 4 === 0 ? 0.9 : 0.5;
      for (let i = 0; i < 1600 && at + i < x.length; i++) x[at + i] += amp * Math.exp(-i / 240) * rnd();
    }
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(encodeWav16([x, x], SR, () => 0.5));
    return file.uri;
  };
  const id = 'prj_smoke_bpm';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bpm', caught));
  const base = createEmptyProject('smoke bpm', '9:16', undefined, 'audio');
  const files = [click('smoke_click_120.wav', 120, 20), click('smoke_click_93.wav', 93, 20)];
  const mk = (uri: string, cid: string): AudioClip => ({ kind: 'audio', id: cid, label: cid, start: 0, duration: 20, trimIn: 0, sourceDuration: 20, uri, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, bpm: 100, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk(files[0], 'c120')] } : t.type === 'sfx' ? { ...t, clips: [mk(files[1], 'c93')] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  try {
    for (const [cid, bpm] of [['c120', 120], ['c93', 93]] as const) {
      st().selectClip(cid);
      await sleep(200);
      const t0 = Date.now();
      await runDevAction('audio.autoBpm');
      const ms = Date.now() - t0;
      const got = st().project!.bpm ?? 0;
      const grid = await detectBeats(files[cid === 'c120' ? 0 : 1]);
      const period = 60 / bpm;
      const offs = (grid?.beats ?? []).slice(1, -1).map((b) => {
        const o = ((b % period) + period) % period;
        return o > period / 2 ? o - period : o;
      });
      const worst = Math.max(...offs.map((o) => Math.abs(o) * 1000));
      const mean = (offs.reduce((a, o) => a + o, 0) / Math.max(1, offs.length)) * 1000;
      log(Math.abs(got - bpm) <= 1 && lastBeatPath() === 'device' && worst <= 52 && Math.abs(mean) <= 25, `${bpm} BPM klikk-sáv: a stúdió „Tempó felismerése” a telefonon (worker nélkül) ±1 BPM, a beatek a rácson`, `${got} BPM, ${lastBeatPath()}, ${ms} ms, beat-eltérés átlag ${mean.toFixed(1)} / max ${worst.toFixed(1)} ms`);
    }
    log(true, 'FOTÓZHATÓ', 'a felismert tempó és a beat-vonalak az idővonalon');
    await sleep(2500);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bpm-del', caught));
    for (const f of files) new File(f).delete();
  }
}
/**
 * ⏱️ AP4: a metronóm a lejátszás alatt mintapontosan a rácson szól (hangsúlyos ütem-egy), a mérőbe és
 * az exportba nem kerül; metronómos felvételnél a lejátszás a projekt végén túl is fut, a take a
 * lejátszófejtől szól.
 */
export async function smokeMetronome(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const silent = new File(Paths.document, 'smoke_metro_silence.wav');
  if (silent.exists) silent.delete();
  silent.create();
  silent.write(encodeWav16([new Float32Array(4 * SR)], SR, () => 0.5));
  const id = 'prj_smoke_metro';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:metro', caught));
  const base = createEmptyProject('smoke metronóm', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'sil', label: 'csend', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, uri: silent.uri, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const prefs = useRecordPrefs.getState();
  const was = { metronome: prefs.metronome, gain: prefs.metronomeGain, countIn: prefs.countInBars, punch: prefs.punch };
  try {
    // 1) lejátszás metronómmal: a motor kimenete = a klikkek (a klip néma)
    useRecordPrefs.setState({ metronome: true, metronomeGain: 0.6, countInBars: 0, punch: false });
    await sleep(300);
    previewEngine.debugTap(true);
    st().setPlayhead(0);
    st().setPlaying(true);
    let lufs: number | null = null;
    for (let i = 0; i < 25; i++) {
      await sleep(100);
      const r = previewEngine.loudness();
      if (r) lufs = Math.max(lufs ?? -Infinity, r.shortTerm ?? -Infinity);
    }
    st().setPlaying(false);
    const chunks = previewEngine.debugTap(false).sort((a, b) => a.from - b.from);
    const total = chunks.length ? chunks[chunks.length - 1].from + chunks[chunks.length - 1].left.length : 0;
    const out = new Float32Array(total);
    for (const c of chunks) out.set(c.left, c.from);
    const beats = [0, 1, 2, 3, 4].map((k) => Math.round(k * 0.5 * SR)).filter((at) => at + 2 < total);
    const exact = beats.every((at) => (at === 0 || out[at - 1] === 0) && out[at] === 0 && Math.abs(out[at + 1] - 0.6 * clickSample(at === 0 || at === Math.round(2 * SR) ? true : false, 1, SR)) < 1e-6);
    const pk = (at: number) => out.subarray(at, at + Math.round(0.04 * SR)).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const ratio = beats.length > 1 ? pk(beats[0]) / pk(beats[1]) : 0;
    log(exact && beats.length >= 4, 'lejátszás közben a klikkek mintapontosan a beateken (120 BPM: 0,5 s-onként)', `${beats.length} klikk, ${chunks.length} szelet`);
    log(Math.abs(ratio - 0.8 / 0.55) < 0.05, 'az ütem-egy hangsúlyos (×1,45)', `×${ratio.toFixed(3)}`);
    log(lufs === null || !Number.isFinite(lufs) || lufs < -70, 'a hangosságmérő nem látja a klikket (a mérés előtt keveredik)', `short-term ${lufs === null || !Number.isFinite(lufs) ? '−∞' : lufs.toFixed(1)} LUFS`);
    // 2) az export néma (a metronóm nem kerül bele)
    const { uri: exp } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_metro_export.wav'));
    const api = (await loadAudioApi())!;
    const ex = (await api.decodeAudioData(exp, SR)).getChannelData(0);
    const exPeak = ex.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    // a 16 bites export TPDF-ditherrel készül: a „csend” ±1–2 LSB (a klikk 0,6 volna)
    log(exPeak <= 2 / 32768, 'az export néma: a metronóm nem kerül bele (csak a 16 bites dither, ≤ 2 LSB)', `csúcs ${(exPeak * 32768).toFixed(1)} LSB`);
    new File(exp).delete();
    // 3) metronómos felvétel a projekt végén túl: 1 ütem előszámlálás, a take a lejátszófejtől
    useRecordPrefs.setState({ countInBars: 1 });
    st().setPlayhead(3);
    await sleep(300);
    await runDevAction('audio.recordToggle');
    let maxHead = 0;
    for (let i = 0; i < 45; i++) {
      await sleep(100);
      maxHead = Math.max(maxHead, st().playhead);
    }
    const through = st().playThrough && st().isPlaying;
    await runDevAction('audio.recordToggle');
    for (let i = 0; i < 40 && (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips.length === 0); i++) await sleep(100);
    const take = st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip | undefined;
    log(through && maxHead > 4.3, 'felvétel közben a lejátszás a projekt végén (4 s) túl is fut', `lejátszófej max ${maxHead.toFixed(2)} s`);
    log(!!take && Math.abs(take.start - 3) < 0.15 && take.duration > 1.5 && !st().playThrough && !st().isPlaying, 'a take a lejátszófejtől (3 s) szól, az előszámlálás nélkül; leállítás után a transzport alaphelyzetben', take ? `kezdet ${take.start.toFixed(3)} s, ${take.duration.toFixed(2)} s, levágva ${(take.trimIn ?? 0).toFixed(3)} s` : 'nincs take');
    log(true, 'FOTÓZHATÓ', 'a metronóm-gomb aktív a transzporton, a take a 3. mp-nél');
    await sleep(2000);
  } finally {
    useRecordPrefs.setState({ metronome: was.metronome, metronomeGain: was.gain, countInBars: was.countIn, punch: was.punch });
    st().setPlaying(false);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:metro-del', caught));
    if (silent.exists) silent.delete();
  }
}
/**
 * 🎼 S13 (MU4): tempo-map — tempóváltás a lejátszófejnél; a rács, az ütem:beat kijelzés, az ugrás, az ütemre vágás
 * és a metronóm a tempóváltást követi; a ± az itteni szakaszt lépteti; egy undo; a metronóm klikkjei az új rácson.
 */
export async function smokeTempoMap(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_tempomap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tempomap', caught));
  const base = createEmptyProject('smoke tempo', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_tempo.wav', 8), start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const music = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;
  try {
    // 1) tempóváltás 90 BPM-re a 4 s-nál (= 8. beat 120 BPM-en)
    st().setPlayhead(4);
    await sleep(200);
    const added = runDevAction('audio.tempoAdd', 90) === true;
    const map = runDevAction('audio.tempoMap') as { atBeat: number; bpm: number }[];
    log(added && map.length === 1 && map[0].atBeat === 8 && map[0].bpm === 90, 'tempóváltás a lejátszófejnél: a 8. beaten 90 BPM (a projektben, egy parancs)', JSON.stringify(map));
    // 2) a mérvadó BPM és az ütem:beat kijelzés a váltás után
    const b1 = runDevAction('audio.bpmAt', 3.9);
    const b2 = runDevAction('audio.bpmAt', 4.1);
    const bb = runDevAction('audio.barsBeats', 6);
    log(b1 === 120 && b2 === 90 && bb === '3.4', 'a BPM a szakasz szerint (120 → 90), a 6 s = 3. ütem 4. beat', `${b1} → ${b2}, ${bb}`);
    // 3) a rács: 4 s-ig 0,5 s-onként, utána 0,667 s-onként
    const lines = runDevAction('audio.gridLines', { from: 0, to: 8 }) as number[];
    log(near(lines[8], 4) && near(lines[9], 4 + 60 / 90) && near(lines[10], 4 + 2 * (60 / 90)), 'a rács követi a tempóváltást (0,5 s → 0,667 s)', lines.slice(7, 11).map((x) => x.toFixed(3)).join(' '));
    // 4) ugrás a következő beatre a váltás után
    st().setPlayhead(4.1);
    await sleep(150);
    runDevAction('audio.nextBeat');
    await sleep(150);
    const ph = st().playhead;
    log(near(ph, 4 + 60 / 90, 1e-3), 'ugrás a következő beatre a váltás után: 4,667 s', ph.toFixed(3));
    // 5) ütemre vágás a tempo-mapen: 7 vonal 4 s előtt, 6 utána
    st().selectClip('c');
    await sleep(150);
    const n = runDevAction('audio.beatSplitBeats') as number;
    const starts = music().map((x) => x.start).sort((a, b) => a - b);
    log(music().length === 14 && starts.filter((x) => x < 4 - 1e-6).length === 8 && near(starts[8], 4) && near(starts[9], 4 + 60 / 90), 'beatre vágás a tempo-mapen: 14 darab (8 a váltás előtt, 6 utána)', `${n} vágás, ${music().length} darab`);
    st().undo();
    await sleep(200);
    // 6) a ± az itteni szakaszt lépteti: a lejátszófej a 90-es szakaszban → 91 (új váltás nem jön létre), az induló tempó marad 120;
    //    az induló szakaszon a ± az induló tempót lépteti
    st().setPlayhead(5);
    await sleep(150);
    runDevAction('audio.tempoStep', 1);
    const map2 = runDevAction('audio.tempoMap') as { atBeat: number; bpm: number }[];
    st().setPlayhead(1);
    await sleep(100);
    runDevAction('audio.tempoStep', -1);
    const baseBpm = st().project!.bpm;
    st().setPlayhead(5);
    await sleep(100);
    log(map2.length === 1 && map2[0].atBeat === 8 && map2[0].bpm === 91 && baseBpm === 119, 'a ± a lejátszófej szakaszát lépteti (90 → 91, új váltás nélkül), az induló szakaszon az induló tempót (120 → 119)', `${JSON.stringify(map2)}, induló ${baseBpm}`);
    st().undo();
    await sleep(100);
    // 7) a metronóm a tempo-mapen (pure): a klikkek a váltás után 0,667 s-onként
    const { metronomeClicks } = await import('@/lib/metronome');
    const { projectTiming: pt } = await import('@/lib/audioTransport');
    const clicks = metronomeClicks(3.9, 6.1, 120, { beatsPerBar: 4, beatUnit: 4 }, pt(st().project!)).map((x) => x.t);
    log(clicks.length === 4 && near(clicks[0], 4) && near(clicks[1], 4 + 60 / 91), 'a metronóm klikkjei a tempóváltás után az új tempón', clicks.map((x) => x.toFixed(3)).join(' '));
    // 8) törlés hosszan nyomva (dev: tempoRemove) + egy undo visszahozza
    runDevAction('audio.tempoRemove');
    const gone = (runDevAction('audio.tempoMap') as unknown[]).length === 0;
    st().undo();
    await sleep(150);
    const back = runDevAction('audio.tempoMap') as { bpm: number }[];
    log(gone && back.length === 1 && back[0].bpm === 91, 'a tempóváltás törölhető, egy visszavonás visszahozza', `${gone} / ${JSON.stringify(back)}`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tempomap-del', caught));
  }
}
