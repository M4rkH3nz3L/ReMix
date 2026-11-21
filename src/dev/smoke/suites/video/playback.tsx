/** 🧪 Füstteszt — videó-szerkesztő: idővonal-zoom, shuttle, képszinkron, gyors hangerő, csak-hang export. (Áthelyezve: phases03, phases09, phases15; viselkedés-változás nélkül.) */
import { Platform, Dimensions, View } from 'react-native';
import { MAX_ZOOM, BASE_PX_PER_SEC } from '@/constants/editor';
import { router, type Href } from 'expo-router';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { createImageDoc } from '@/lib/imageDoc';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject, deleteProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { type Log, sleep } from '../../helpers/core';
import { logCaught } from '@/lib/logCaught';
import type { AudioClip, VideoClip, Project } from '@/types/project';
import { toneWav } from '../../helpers/audio';
import { File } from 'expo-file-system';
import type { ReactNode } from 'react';
import { Asset } from 'expo-asset';
import { exportAudioToFile } from '@/lib/render';
import { audioExportSettings } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { startSyncProbe, stopSyncProbe, summarizeDrift } from '@/lib/audioSyncProbe';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { AudioOnlyExportSection } from '@/components/editor/panels/AudioOnlyExportSection';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { mixForExport } from '@/lib/audioExportMix';
import '@/lib/dspNativeClient';

/** Tíz perces klip legnagyobb nagyításon a valódi szerkesztőben. */
export async function smokeTimelineZoom(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let n = 0;
  const doc = createImageDoc('t', '9:16', () => `tz${++n}`);
  const base = addImageDocToVideo(createEmptyProject('smoke idővonal', '9:16', undefined, 'video'), doc, 'file:///smoke.png');
  const project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: t.clips.map((c) => ({ ...c, duration: 600 })) } : t)) };
  await saveProject(project);
  router.push(`/editor/${project.id}` as Href);
  await sleep(3500);
  const store = useEditorStore.getState();
  store.setZoom(100);
  await sleep(1500);
  const zoom = useEditorStore.getState().zoom;
  log(zoom === MAX_ZOOM, 'a nagyítás felső határa', `${zoom}× = ${(zoom * BASE_PX_PER_SEC) / 30} pont/kocka 30 fps-en`);
  log((zoom * BASE_PX_PER_SEC) / 30 >= 30, 'egy kocka ujjal fogható', '≥ 30 pont');
  const start = performance.now();
  for (let i = 1; i <= 10; i++) {
    store.setPlayhead(i * 55);
    await sleep(150);
  }
  log(useEditorStore.getState().project?.id === project.id, 'tíz perces klip végiggörgetve a legnagyobb nagyításon', `${(performance.now() - start).toFixed(0)} ms`);
  log(true, 'FOTÓZHATÓ', 'idővonal');
  await sleep(5000);
  store.setZoom(1);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}
/** Gyors vissza és előre a valódi mesterórán: a lejátszófej a sebesség szerint halad. */
export async function smokeShuttle(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let n = 0;
  const base = addImageDocToVideo(createEmptyProject('smoke shuttle', '9:16', undefined, 'video'), createImageDoc('t', '9:16', () => `sh${++n}`), 'file:///smoke.png');
  const project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: t.clips.map((c) => ({ ...c, duration: 120 })) } : t)) };
  await saveProject(project);
  router.push(`/editor/${project.id}` as Href);
  const s = () => useEditorStore.getState();
  for (let i = 0; i < 40 && s().project?.id !== project.id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  s().setPlayhead(60);
  await sleep(300);
  const run = async (dir: 1 | -1, times: number, expected: number, name: string) => {
    s().setPlaybackRate(dir);
    for (let i = 0; i < times; i++) {
      s().shuttle(dir);
    }
    const [from, t0] = [s().playhead, performance.now()];
    await sleep(1500);
    const moved = s().playhead - from;
    const elapsed = (performance.now() - t0) / 1000;
    s().setPlaying(false);
    s().setPlaybackRate(1);
    const rate = moved / elapsed;
    log(Math.abs(rate - expected) < Math.abs(expected) * 0.25, name, `${rate.toFixed(2)}× (várt ${expected}×)`);
    await sleep(300);
  };
  await run(1, 1, 2, 'előre 2×');
  await run(1, 2, 4, 'előre 4×');
  await run(-1, 1, -2, 'vissza 2×');
  await run(-1, 2, -4, 'vissza 4×');
  const stopped = s().playhead;
  await sleep(600);
  log(s().playhead === stopped && !s().isPlaying, 'elengedés után megáll a helyén', `${stopped.toFixed(2)} mp`);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}
/** 🔊 AP6: a videó-szerkesztő gyors hangerő-léptetője dB-ben lép — a +6 dB-es klip egy „−” után +5 dB (nem 0 dB). Valódi érintés (adb). */
export async function smokeQuickVolume(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_quickvol';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:quickvol', caught));
  const base = createEmptyProject('smoke gyors hangerő', '9:16');
  const uri = toneWav('smoke_quickvol.wav', 4);
  const v6 = Math.pow(10, 6 / 20);
  const clip: AudioClip = { kind: 'audio', id: 'qv', label: 'zene', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, uri, volume: v6, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/editor/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const vol = () => (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).volume;
  try {
    st().selectClip('qv');
    st().setPanel('audio');
    await sleep(800);
    log(null, 'READY', 'voldown');
    for (let i = 0; i < 250 && Math.abs(vol() - v6) < 1e-9; i++) await sleep(100);
    const db = 20 * Math.log10(vol());
    log(Math.abs(db - 5) < 0.05, 'a „Hangerő −” egy érintésre +6 → +5 dB (eddig 0–1 közé vágott: 0 dB lett volna)', `${db.toFixed(2)} dB`);
    log(true, 'FOTÓZHATÓ', 'a gyors hangerő-léptető dB-ben');
    await sleep(1500);
  } finally {
    st().setPanel(null);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:quickvol-del', caught));
  }
}
/** PRO-AUDIO 17/20: csak hang export egy videó-projektből — a videóklip hangja, a master rá is hat. */
export async function smokeVideoAudioExport(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const base = createEmptyProject('smoke videó-hang', '16:9');
  const clip = { id: 'v', kind: 'video', uri, start: 0, duration: 10, trimIn: 0, sourceDuration: 10, speed: 1, volume: 1, filterId: 'none' } as VideoClip;
  const project: Project = { ...base, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [clip] } : tr)) };
  log(mixForExport(project, (t) => t !== 'video', 1) === null, 'a némított videósávból nincs hang-export');
  const api = await loadAudioApi();
  const measure = async (master: number, name: string) => {
    const mix = mixForExport(project, () => true, master)!;
    const target = new File(projectExportDir(), name);
    const out = await exportAudioToFile(mix, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 16, sampleRate: 44100, channels: 2 }), target);
    const buf = await api!.decodeAudioData(out, 44100);
    const ch = buf.getChannelData(0);
    const rms = Math.sqrt(ch.reduce((acc, v) => acc + v * v, 0) / ch.length);
    new File(out).delete();
    return { db: 20 * Math.log10(rms + 1e-12), dur: buf.duration };
  };
  const full = await measure(1, 'smoke_videohang_1.wav');
  log(Math.abs(full.dur - 10) < 0.1 && full.db > -40, 'a videóklip hangja exportálódik', `${full.dur.toFixed(2)} s, ${full.db.toFixed(1)} dB`);
  const half = await measure(0.5, 'smoke_videohang_05.wav');
  log(Math.abs(full.db - half.db - 6.02) < 0.5, 'a master a videóklip hangjára is hat', `${(full.db - half.db).toFixed(2)} dB esés`);
  {
    const probe = await api!.decodeAudioData(uri, 44100);
    log(null, 'mp4 dekódolás 44,1 kHz-re kérve', `sampleRate ${probe.sampleRate}, ${probe.length} minta, ${probe.duration.toFixed(3)} s → ${(probe.length / probe.duration).toFixed(0)} minta/s`);
  }
  // Free út: a telefon dekódolja az mp4 hangját és kever — a szerveres renderrel kivonva
  const onPhone = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_videohang_tel.wav'));
  const srv = await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 16, sampleRate: 44100, channels: 2 }), new File(projectExportDir(), 'smoke_videohang_srv.wav'));
  const a1 = await api!.decodeAudioData(onPhone.uri, 44100);
  const b1 = await api!.decodeAudioData(srv, 44100);
  const lvl = (xs: Float32Array) => 10 * Math.log10(xs.reduce((acc, x) => acc + x * x, 0) / Math.max(1, xs.length) + 1e-30);
  {
    // eltolás keresése: a telefonos és a szerveres jel keresztkorrelációja ±4096 mintán
    const x = a1.getChannelData(0);
    const y = b1.getChannelData(0);
    let best = -Infinity;
    let lag = 0;
    for (let d = -4096; d <= 4096; d += 1) {
      let acc = 0;
      for (let i = 44100; i < 88200; i += 3) acc += y[i] * (x[i + d] ?? 0);
      if (acc > best) {
        best = acc;
        lag = d;
      }
    }
    // a szerver régen 1-es sebességen is atempo-t tett a videó hangjára (287 minta késés)
    log(Math.abs(lag) <= 2, 'Free: a telefonos és a szerveres videó-hang nincs eltolva', `${lag} minta`);
    for (const ch of [0, 1]) {
      const xc = a1.getChannelData(ch);
      const yc = b1.getChannelData(ch);
      const n = Math.min(xc.length - Math.max(0, lag), yc.length) - 4410;
      const diff = Float32Array.from({ length: n }, (_, i) => xc[i + Math.max(0, lag)] - yc[i]);
      const snr = lvl(yc.subarray(0, n)) - lvl(diff);
      log(snr > 50 && Math.abs(xc.length - yc.length) < 64, `Free: telefon = szerver a videó hangján (${ch === 0 ? 'bal' : 'jobb'})`, `${snr.toFixed(1)} dB, hossz ${xc.length}/${yc.length}`);
    }
  }
  new File(onPhone.uri).delete();
  new File(srv).delete();
  useEditorStore.getState().loadProject(project, []);
  setHarness(
    <View style={{ width: Math.min(420, Dimensions.get('window').width), alignSelf: 'center' }}>
      <AudioOnlyExportSection />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a „Csak hang” szakasz az export-panelen');
  await sleep(4000);
  setHarness(null);
}
/** T1: a videó-szerkesztő képe a lejátszófejhez képest (a zene, a felirat és a vágások ehhez igazodnak). */
export async function smokeVideoSync(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = 'prj_smoke_videosync';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoSync', caught));
  const base = createEmptyProject('smoke kép-szinkron', '16:9');
  const v = (cid: string, start: number, trimIn: number) => ({ id: cid, kind: 'video', uri, start, duration: 4, trimIn, sourceDuration: 10, speed: 1, volume: 0.2, filterId: 'none' }) as VideoClip;
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [v('elso', 0, 0), v('masodik', 4, 5)] } : tr)) });
  router.push(`/editor/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(2500);
  useEditorStore.getState().setPlayhead(0);
  await sleep(600);
  startSyncProbe();
  useEditorStore.getState().setPlaying(true);
  await sleep(7500);
  useEditorStore.getState().setPlaying(false);
  const { samples } = stopSyncProbe();
  // a klip-idő (sinceStart) mindkét klipnél a saját elejétől számol; a korrekció ~2,5 mp alatt áll be
  const steady = summarizeDrift(samples.filter((x) => x.sinceStart > 2.5)).get('kép');
  log(steady ? steady.maxMs <= 60 : false, 'kép-szinkron beállás után a kép-tűrésen (60 ms) belül (mindkét klip)', steady ? `átlag ${steady.meanMs.toFixed(0)} ms, max ${steady.maxMs.toFixed(0)} ms (${steady.n} minta)` : 'nincs minta');
  const start = summarizeDrift(samples.filter((x) => x.sinceStart <= 2.5)).get('kép');
  log(null, 'átmenetek (indulás, klipváltás: első 2,5 mp)', start ? `átlag ${start.meanMs.toFixed(0)} ms, max ${start.maxMs.toFixed(0)} ms` : 'nincs minta');
  const trace = samples.filter((x) => x.clipId === 'kép');
  log(null, 'nyom kép', trace.filter((_, k) => k % Math.max(1, Math.floor(trace.length / 16)) === 0).map((x) => `${x.sinceStart.toFixed(1)}→${(x.drift * 1000).toFixed(0)}`).join(' '));
  router.back();
  await sleep(800);
  await deleteProject(id);
}
