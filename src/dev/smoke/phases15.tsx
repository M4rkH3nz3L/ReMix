/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { File, Paths } from 'expo-file-system';
import type { ReactNode } from 'react';
import { createAudioPlayer, getRecordingPermissionsAsync } from 'expo-audio';
import { AppState, Dimensions, Platform, View } from 'react-native';
import { Asset } from 'expo-asset';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache, probeAudioDuration, readFileTags } from '@/lib/media';
import { tagLabel } from '@/lib/audioTags';
import { exportAudioFile, exportAudioToFile, isRenderCancelledError } from '@/lib/render';
import { audioExportFileName, audioExportSettings } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { AudioExportSheet } from '@/components/studio/audio/AudioExportSheet';
import { analyzeMixOnDevice } from '@/lib/mixAssistClient';
import { runDevAction } from '@/lib/devActions';
import { recordingPhase } from '@/lib/interruption';
import { CLIP_LEVEL, levelDb, trackLevelAt } from '@/lib/levelMeter';
import { offlineMixPlan } from '@/lib/offlineMix';
import type { WaveformData } from '@/lib/waveform';
import { startSyncProbe, stopSyncProbe, summarizeDrift } from '@/lib/audioSyncProbe';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import '@/lib/dspNativeClient';
import { deleteCloudProject } from '@/lib/cloudSync';
import { freeDiskBytes, setFreeDiskOverride } from '@/lib/diskSpaceClient';
import { EXPORT_SPACE_MARGIN, RECORD_STOP_FREE, wavBytes } from '@/lib/diskSpace';
import { AudioOnlyExportSection } from '@/components/editor/panels/AudioOnlyExportSection';
import { startVoiceRecording } from '@/lib/voiceRecording';
import { audioApiState, loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { clearWaveformMemory, clipWindowPeaks, getWaveform, WAVEFORM_PPS } from '@/lib/waveform';
import { mixForExport } from '@/lib/audioExportMix';
import { classifyAudioIntake } from '@/lib/audioIntake';
import { flushProjectSave, useProjectAutosave } from '@/hooks/useProjectAutosave';
import { addLayer } from '@/lib/imageDoc';
import { renderImageDoc } from '@/lib/imageDocClient';
import { exportSize } from '@/lib/imageExport';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, listProjects, loadProject, loadVersions, readRecovery, recoveryIsFresher, saveProject, writeRecovery, clearRecovery } from '@/lib/storage';
import { findMissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, VideoClip, ImageLayer, PhotoLayer, Project, ShapeLayer } from '@/types/project';
import { AUDIO_KILL_ID, type Log, type RecordHandle, RecordHarness, cloudInThisBuild, decode, pixel, removeFile, sleep, testDoc, toneWav } from './shared';

/** PRO-AUDIO 17/5: többsávos lejátszás szinkronja a valódi stúdióban (két sáv, egyik később kezd). */
export async function smokeAudioSync(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_audiosync';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioSync', caught));
  const uri = toneWav('smoke_sync.wav', 12);
  const base = createEmptyProject('smoke szinkron', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number, trimIn: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 8, trimIn, sourceDuration: 12, volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('elejetol', 0, 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('kesobb', 2, 1)] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  // 1. kör: a tanulás (az indítási késést itt méri meg); 2. kör: a mért szinkron
  useEditorStore.getState().setPlayhead(0);
  useEditorStore.getState().setPlaying(true);
  await sleep(3000);
  useEditorStore.getState().setPlaying(false);
  await sleep(600);
  useEditorStore.getState().setPlayhead(0);
  await sleep(600);
  startSyncProbe();
  useEditorStore.getState().setPlaying(true);
  await sleep(9000);
  useEditorStore.getState().setPlaying(false);
  const { samples, starts, seeks } = stopSyncProbe();
  for (const [cid, st] of summarizeDrift(samples)) {
    log(null, `drift ${cid} (teljes)`, `átlag ${st.meanMs.toFixed(0)} ms, max ${st.maxMs.toFixed(0)} ms (${st.n} minta)`);
  }
  // a beállás után (a klip első 3 mp-e utáni szakasz) — ez a hallható, tartós szinkron
  for (const [cid, st] of summarizeDrift(samples.filter((x) => x.sinceStart > 3))) {
    log(st.maxMs <= 45, `szinkron beállás után: ${cid}`, `átlag ${st.meanMs.toFixed(0)} ms, max ${st.maxMs.toFixed(0)} ms`);
  }
  for (const [cid, late] of starts) {
    log(null, `megszólalás ${cid}`, `${(late * 1000).toFixed(0)} ms késéssel`);
  }
  log(null, 'korrekciós ugrások', String(seeks));
  for (const cid of ['elejetol', 'kesobb']) {
    const trace = samples.filter((x) => x.clipId === cid && x.sinceStart > 3);
    let worst = 0;
    trace.forEach((x, k) => {
      if (Math.abs(x.drift) > Math.abs(trace[worst]?.drift ?? 0)) worst = k;
    });
    const around = trace.slice(Math.max(0, worst - 6), worst + 10).map((x) => `${x.sinceStart.toFixed(2)}:${(x.drift * 1000).toFixed(0)}`).join(' ');
    log(null, `kiugrás ${cid}`, around);
  }
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(uri).delete();
}
/** PRO-AUDIO 17/8: élő szintmérő a valódi stúdióban (képernyőkép lejátszás közben). */
export async function smokeAudioMeter(log: Log) {
  const id = 'prj_smoke_audiometer';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioMeter', caught));
  const half = toneWav('smoke_meter_half.wav', 6);
  const loud = stereoRightWav('smoke_meter_loud.wav', 6, 0.99, 0);
  const base = createEmptyProject('smoke szintmérő', '9:16', undefined, 'audio');
  const mk = (cid: string, uri: string): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('fel', half)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('hangos1', loud), mk('hangos2', loud)] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  useEditorStore.getState().setPlayhead(0);
  useEditorStore.getState().setPlaying(true);
  await sleep(2000);
  const p = useEditorStore.getState().project!;
  const plan = offlineMixPlan(p);
  const waves = new Map<string, WaveformData>();
  for (const u of [half, loud]) {
    const w = await getWaveform(u, { userInitiated: true });
    if (w) waves.set(u, w);
  }
  const t = useEditorStore.getState().playhead;
  const music = trackLevelAt(plan.clips.filter((c) => c.track === 'music'), (u) => waves.get(u), t);
  const sfx = trackLevelAt(plan.clips.filter((c) => c.track === 'sfx'), (u) => waves.get(u), t);
  log(Math.abs(levelDb(music) + 6.2) < 1, 'zene-sáv szintje', `${levelDb(music).toFixed(1)} dB`);
  log(sfx >= CLIP_LEVEL, 'effekt-sáv túlvezérelt', `${levelDb(sfx).toFixed(1)} dB`);
  log(true, 'FOTÓZHATÓ', 'a szintmérők lejátszás közben');
  await sleep(2500);
  useEditorStore.getState().setPlaying(false);
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(half).delete();
  new File(loud).delete();
}
/** PRO-AUDIO 17/2: „illeszd” nagyítás és lejátszófej-követés a valódi stúdióban. */
export async function smokeAudioFit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_audiofit';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioFit', caught));
  const uri = toneWav('smoke_fit.wav', 60);
  const base = createEmptyProject('smoke illeszd', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'h', uri, label: 'hosszú', start: 0, duration: 60, trimIn: 0, sourceDuration: 60, volume: 0.2, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [c] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const view = () => runDevAction('audio.view') as { scrollX: number; pps: number; viewW: number; contentW: number };

  // követés: nagy nagyítás (220 px/mp), 7 mp lejátszás — a lejátszófejnek a nézetben kell maradnia
  for (let i = 0; i < 4; i++) {
    runDevAction('audio.zoomIn');
    await sleep(300);
  }
  useEditorStore.getState().setPlayhead(0);
  useEditorStore.getState().setPlaying(true);
  await sleep(9000);
  useEditorStore.getState().setPlaying(false);
  await sleep(300);
  const v1 = view();
  const x = useEditorStore.getState().playhead * v1.pps;
  log(x > v1.viewW && v1.scrollX > 0 && x >= v1.scrollX && x <= v1.scrollX + v1.viewW, 'a lejátszófej az első képernyőn túl is a nézetben marad (lapozott)', `lejátszófej ${x.toFixed(0)} px, nézet ${v1.scrollX.toFixed(0)}–${(v1.scrollX + v1.viewW).toFixed(0)} px (${v1.pps} px/mp)`);

  // illeszd: a teljes 60 mp kifér a nézetbe
  runDevAction('audio.fit');
  await sleep(600);
  const v2 = view();
  log(60 * v2.pps <= v2.viewW && v2.scrollX === 0, '„Illeszd”: a teljes projekt látszik', `${(60 * v2.pps).toFixed(0)} px a ${v2.viewW.toFixed(0)} px-es nézetben`);
  log(true, 'FOTÓZHATÓ', 'az illesztett idővonal');
  await sleep(4000);
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(uri).delete();
}
/** PRO-AUDIO 17/20: csak hang export egy videó-projektből — a videóklip hangja, a master rá is hat. */
export async function smokeVideoAudioExport(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../../assets/videos/fekvo.mp4'));
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
/** PRO-AUDIO 17/1: a címke a fájl VÉGÉN (WAV LIST/INFO a data után) — a telefonos fájlolvasással. */
export async function smokeAudioTags(log: Log) {
  const uri = toneWav('smoke_tags.wav', 1);
  const enc = (str: string) => Array.from(unescape(encodeURIComponent(str)), (ch) => ch.charCodeAt(0));
  const sub = (id: string, text: string) => {
    const v = [...enc(text), 0];
    if (v.length % 2) v.push(0);
    const n = v.length;
    return [...enc(id), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...v];
  };
  const info = [...enc('INFO'), ...sub('INAM', 'Őszi éjszaka'), ...sub('IART', 'Kovács Béla')];
  const list = [...enc('LIST'), info.length & 255, (info.length >> 8) & 255, 0, 0, ...info];
  const file = new File(uri);
  const old = file.bytesSync();
  const out = new Uint8Array(old.length + list.length);
  out.set(old, 0);
  out.set(list, old.length);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  file.write(out);
  const tags = readFileTags(uri);
  log(tags.title === 'Őszi éjszaka' && tags.artist === 'Kovács Béla', 'a fájl végén lévő címke a telefonon kiolvasva', JSON.stringify(tags));
  log(tagLabel(tags, 'smoke_tags.wav') === 'Kovács Béla – Őszi éjszaka', 'a klip neve a címkéből', tagLabel(tags, 'smoke_tags.wav'));
  file.delete();
}
/** Stabilitás: szélsőséges esetek a hang-oldalon — semmi ne essen szét, minden hiba érthető legyen. */
export async function smokeAudioEdge(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // 1) üres projekt
  const empty = createEmptyProject('smoke üres', '1:1', undefined, 'audio');
  const plan = offlineMixPlan(empty);
  log(mixForExport(empty, () => true, 1) === null && plan.clips.length === 0 && trackLevelAt(plan.clips, () => undefined, 0) === 0, 'üres projekt: nincs export, nincs hiba');
  // 2) hiányzó fájl a telefonos exportban: érthető hiba
  const missing: AudioClip = { kind: 'audio', id: 'm', uri: `${Paths.document.uri}nincs_ilyen.wav`, label: 'hiányzik', start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const withMissing: Project = { ...empty, tracks: empty.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [missing] } : tr)) };
  const err = await exportOfflineWav(withMissing, new File(projectExportDir(), 'smoke_missing.wav')).then(() => 'nincs hiba', (e: Error) => e.message);
  log(err.includes('nincs_ilyen.wav'), 'hiányzó fájl: érthető hibaüzenet, a fájl nevével', err);
  log(!new File(projectExportDir(), 'smoke_missing.wav').exists, 'hiányzó fájl: nem marad félkész export');
  // 3) túl hosszú projekt: a felső határ érthető
  const long: Project = { ...withMissing, tracks: withMissing.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [{ ...missing, duration: 21 * 60, sourceDuration: 21 * 60 }] } : tr)) };
  const errLong = await exportOfflineWav(long, new File(projectExportDir(), 'smoke_long.wav')).then(() => 'nincs hiba', (e: Error) => e.message);
  log(errLong.includes('nincs_ilyen.wav'), 'hiányzó HOSSZÚ (szakaszos) forrás: érthető hiba a fájl nevével, nem néma export', errLong);
  const tooLong: Project = { ...long, tracks: long.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [{ ...missing, duration: 3 * 3600 + 60, sourceDuration: 3 * 3600 + 60 }] } : tr)) };
  const errTooLong = await exportOfflineWav(tooLong, new File(projectExportDir(), 'smoke_toolong.wav')).then(() => 'nincs hiba', (e: Error) => e.message);
  log(/180/.test(errTooLong), 'túl hosszú projekt (3 óra fölött): érthető üzenet a határral', errTooLong);
  // 4) gyors nyitás-zárás a stúdióban
  const id = 'prj_smoke_audioedge';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioEdge', caught));
  const uri = toneWav('smoke_edge.wav', 4);
  const clip: AudioClip = { ...missing, id: 'e', uri, label: 'él', duration: 4, sourceDuration: 4, volume: 0.3 };
  await saveProject({ ...empty, id, tracks: empty.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr)) });
  for (let k = 0; k < 5; k++) {
    router.push(`/studio/audio/${id}` as Href);
    await sleep(700);
    useEditorStore.getState().setPlaying(true);
    await sleep(300);
    router.back();
    await sleep(500);
  }
  log(useEditorStore.getState().project?.id !== id && !useEditorStore.getState().isPlaying, 'ötszöri gyors nyitás-zárás után a stúdió rendben bezárult');
  // 5) szerkesztés- és visszavonás-vihar
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(800);
  const st = useEditorStore.getState();
  const clipsNow = () => JSON.stringify(useEditorStore.getState().project?.tracks.find((tr) => tr.type === 'music')?.clips);
  void st;
  // a) a napló korlátján (50) belül: 20 szerkesztés (40 művelet) teljesen visszavonható
  const before = clipsNow();
  for (let i = 0; i < 20; i++) {
    useEditorStore.getState().updateClip('e', { volume: (i % 10) / 10 + 0.05 });
    useEditorStore.getState().moveClip('e', 'music', (i % 5) * 0.5);
  }
  for (let i = 0; i < 100 && useEditorStore.getState().past.length > 0; i++) {
    useEditorStore.getState().undo();
  }
  log(clipsNow() === before, '20 gyors szerkesztés után a visszavonás az eredeti állapotot adja');
  for (let i = 0; i < 100 && useEditorStore.getState().future.length > 0; i++) {
    useEditorStore.getState().redo();
  }
  const redone = clipsNow();
  log(redone !== before && JSON.parse(redone ?? '[]')[0]?.start === 2, 'az újra-lépések a végállapotot adják', `start ${JSON.parse(redone ?? '[]')[0]?.start}`);
  // b) 100 művelet: a napló a korlátnál (50) megáll, nem nő tovább
  for (let i = 0; i < 50; i++) {
    useEditorStore.getState().updateClip('e', { volume: (i % 10) / 10 + 0.05 });
    useEditorStore.getState().moveClip('e', 'music', (i % 5) * 0.5);
  }
  log(useEditorStore.getState().past.length <= 50, 'a visszavonási napló a korlátnál (50) megáll', `${useEditorStore.getState().past.length} lépés`);
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(uri).delete();
}
/** T1: a videó-szerkesztő képe a lejátszófejhez képest (a zene, a felirat és a vágások ehhez igazodnak). */
export async function smokeVideoSync(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../../assets/videos/fekvo.mp4'));
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
/**
 * 💾 PRO-AUDIO 17/18 tárhelyhiány. A szabad hely a valódi `Paths.availableDiskSpace`; a betelt
 * lemezt a `setFreeDiskOverride` adja ugyanazon a kódúton (a lemez tényleges teleírása nélkül).
 */
export async function smokeDiskSpace(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const MB = 1024 * 1024;
  const real = freeDiskBytes();
  log(real > 0, 'a valódi szabad hely lekérdezhető', `${(real / MB / 1024).toFixed(1)} GB`);
  const uri = toneWav('smoke_disk_src.wav', 3);
  const base = createEmptyProject('smoke tárhely', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'd1', uri, label: 'tone', start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const project: Project = { ...base, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [c] } : tr)) };
  const need = wavBytes(3 * 44100, 2);
  try {
    // A: export — nem fér el → azonnal, érthető üzenettel áll le, fájl nélkül
    const target = new File(projectExportDir(), 'smoke_disk.wav');
    if (target.exists) target.delete();
    setFreeDiskOverride(need + EXPORT_SPACE_MARGIN - 1);
    const t0 = Date.now();
    const err = await exportOfflineWav(project, target).then(() => 'nincs hiba', (e: Error) => e.message);
    const ms = Date.now() - t0;
    log(err.includes('MB') && /hely|space|Speicher/i.test(err), 'export: kevés helynél érthető üzenet', err.slice(0, 90));
    log(ms < 300, 'export: a dekódolás el sem indul', `${ms} ms`);
    log(!target.exists, 'export: nem marad félkész fájl');
    // B: épp elfér → elkészül
    setFreeDiskOverride(need + EXPORT_SPACE_MARGIN);
    const ok = await exportOfflineWav(project, target).then((r) => new File(r.uri).size ?? 0, (e: Error) => { log(false, 'export: épp elfér', e.message); return 0; });
    log(Math.abs(ok - need) < 8, 'export: ha épp elfér, elkészül', `${ok} bájt`);
    if (target.exists) target.delete();

    // C: felvétel — kevés helynél nem indul
    const perm = await getRecordingPermissionsAsync();
    if (!perm.granted) {
      log(false, 'mikrofon-engedély', perm.status);
      return;
    }
    useEditorStore.getState().loadProject(createEmptyProject('smoke tárhely felvétel', '9:16'), []);
    const voiceClips = () => (useEditorStore.getState().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
    let lowSpace = 0;
    const h = await new Promise<RecordHandle>((resolve) => setHarness(<RecordHarness onReady={resolve} start={() => 0} onLowSpace={() => { lowSpace += 1; }} />));
    setFreeDiskOverride(50 * MB);
    const startErr = await startVoiceRecording(h.recorder).then(() => 'elindult', (e: Error) => e.message);
    log(startErr.includes('MB') && h.recorder.getStatus().isRecording === false, 'felvétel: kevés helynél nem indul, érthető üzenettel', startErr.slice(0, 90));
    // D: felvétel közben fogy a hely → a take magától lezárul, a felvett rész megmarad
    setFreeDiskOverride(null);
    await startVoiceRecording(h.recorder);
    await sleep(2000);
    setFreeDiskOverride(RECORD_STOP_FREE - 1);
    const t1 = Date.now();
    for (let i = 0; i < 40 && voiceClips().length === 0; i++) {
      await sleep(100);
    }
    const clip = voiceClips()[0];
    const dur = clip ? await probeAudioDuration(clip.uri) : 0;
    log(!!clip && h.recorder.getStatus().isRecording === false, 'felvétel: fogyó helynél magától lezárul', `${Date.now() - t1} ms alatt`);
    log(!!clip && dur > 1.8 && Math.abs(dur - clip.duration) < 0.3, 'felvétel: a felvett rész ép klip', clip ? `${clip.duration.toFixed(2)} s klip, ${dur.toFixed(2)} s fájl` : 'nincs klip');
    log(lowSpace === 1, 'felvétel: a felhasználó egyszer kap üzenetet', `${lowSpace}×`);
    for (const v of voiceClips()) new File(v.uri).delete();
  } finally {
    setFreeDiskOverride(null);
    setHarness(null);
    new File(uri).delete();
  }
}
/**
 * 📞 PRO-AUDIO 17/18 megszakítás. A hívás / Siri hatását ugyanazzal a natív hívással
 * idézzük elő, amit az iOS megszakításkor tesz (felvevő `pause()`, lejátszók `pause()`, a hívás
 * végén `play()`); a háttér-ágat (`bg`) a gazda-szkript valódi app-váltással (Beállítások) adja.
 */
export async function smokeInterrupt(log: Log, setHarness: (n: ReactNode) => void, background: boolean) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const id = 'prj_smoke_interrupt';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:interrupt', caught));
  const uri = toneWav('smoke_interrupt.wav', 20);
  const base = createEmptyProject('smoke megszakítás', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('zene', 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('effekt', 0)] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = () => useEditorStore.getState();
  const voiceClips = () => (st().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const mount = () => new Promise<RecordHandle>((resolve) => setHarness(<RecordHarness onReady={resolve} start={() => st().playhead} />));
  const cleanup = () => {
    st().setPlaying(false);
    setHarness(null);
    for (const c of voiceClips()) {
      new File(c.uri).delete();
    }
  };

  if (background) {
    const h = await mount();
    await startVoiceRecording(h.recorder);
    st().setPlayhead(0);
    st().setPlaying(true);
    await sleep(2000);
    let left = -1;
    let back = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && left < 0) left = st().playhead;
      if (state === 'active' && left >= 0) back = true;
    });
    log(null, 'HÁTTÉR-KÉSZ', 'most vált a gazda-szkript másik appra');
    for (let i = 0; i < 150 && !back; i++) {
      await sleep(200);
    }
    sub.remove();
    await sleep(1500);
    log(back, 'az app háttérbe ment és visszajött', back ? `a lejátszófej távozáskor ${left.toFixed(2)} s` : 'nem történt app-váltás');
    log(!st().isPlaying, 'a lejátszás megállt a háttérbe lépéskor');
    log(Math.abs(st().playhead - left) < 0.3, 'a lejátszófej nem ugrott előre a kiesett idővel', `${left.toFixed(2)} → ${st().playhead.toFixed(2)} s`);
    const c = voiceClips()[0];
    const dur = c ? await probeAudioDuration(c.uri) : 0;
    log(!!c && dur > 1.5, 'a háttérbe lépéskor futó felvétel klip lett, a fájl ép', c ? `${c.duration.toFixed(2)} s klip, ${dur.toFixed(2)} s fájl` : 'nincs klip');
    log(recordingPhase(h.recorder.getStatus()) === 'idle' && voiceClips().length === 1, 'a felvevő lezárult, egyetlen klip', `${voiceClips().length} klip`);
    await sleep(1500);
    log(!st().isPlaying && ['zene', 'effekt'].every((cid) => runDevAction(`audio.nativePlaying.${cid}`) !== true), 'visszatérés után sem szól magától a hang');
    cleanup();
    return;
  }

  // A: felvétel — megszakítás nélkül nem zárul le idő előtt; a rendszer-szünet klip lesz
  let h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(2000);
  log(voiceClips().length === 0 && recordingPhase(h.recorder.getStatus()) === 'recording', 'zavartalan felvétel nem zárul le magától', `${voiceClips().length} klip`);
  h.recorder.pause();
  for (let i = 0; i < 20 && voiceClips().length === 0; i++) {
    await sleep(100);
  }
  const a = voiceClips()[0];
  const aDur = a ? await probeAudioDuration(a.uri) : 0;
  log(!!a && Math.abs(a.duration - 2) < 0.4, 'a megszakított felvétel klip lett, a felvett hosszal', a ? `${a.duration.toFixed(2)} s klip` : 'nincs klip');
  log(!!a && Math.abs(aDur - a.duration) < 0.3, 'a megszakított felvétel fájlja ép', `${aDur.toFixed(2)} s fájl`);
  log(recordingPhase(h.recorder.getStatus()) === 'idle', 'a felvevő lezárult (új felvétel nem írja felül)');
  // a lezárás után ugyanazzal a felvevővel új take indulhat
  await startVoiceRecording(h.recorder);
  await sleep(1000);
  await h.finish.current();
  log(voiceClips().length === 2 && voiceClips()[0].uri !== voiceClips()[1].uri, 'utána új felvétel külön fájlba megy', `${voiceClips().length} klip`);
  setHarness(null);

  // B: lejátszás — zavartalanul nem áll meg; a rendszer-némításra a transzport is megáll
  st().setPlayhead(0);
  st().setPlaying(true);
  await sleep(4000);
  log(st().isPlaying, 'zavartalan lejátszás nem áll meg magától (indulás + korrekciók)', `${st().playhead.toFixed(2)} s`);
  const pausedAt = st().playhead;
  for (const cid of ['zene', 'effekt']) {
    runDevAction(`audio.nativePause.${cid}`);
  }
  const t0 = Date.now();
  for (let i = 0; i < 30 && st().isPlaying; i++) {
    await sleep(50);
  }
  const reaction = Date.now() - t0;
  log(!st().isPlaying, 'a rendszer elnémította a hangot → a lejátszás megállt', `${reaction} ms alatt`);
  log(st().playhead - pausedAt < 1.2, 'a lejátszófej nem futott tovább néma hangra', `+${(st().playhead - pausedAt).toFixed(2)} s`);
  // C: a hívás végén az iOS magától folytatná — álló óránál nem szólhat
  await sleep(300);
  runDevAction('audio.nativePlay.zene');
  await sleep(700);
  log(runDevAction('audio.nativePlaying.zene') === false, 'a magától újrainduló hangot leállítja (álló óra)');
  // D: újraindítás után ismét szól
  st().setPlaying(true);
  await sleep(1500);
  log(st().isPlaying && runDevAction('audio.nativePlaying.zene') === true, 'újra lejátszva ismét szól');
  cleanup();
}
/** A10/A43 valódi mikrofonnal: leállítva és a felület bezárásakor is klip lesz, utána szól a lejátszás. */
export async function smokeRecording(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status}) — a felvétel nem mérhető ember nélkül`);
    return;
  }
  const project = createEmptyProject('smoke felvétel', '9:16');
  useEditorStore.getState().loadProject(project, []);
  const voiceClips = () => (useEditorStore.getState().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const mount = () =>
    new Promise<RecordHandle>((resolve) => {
      // a felvétel indításakor rögzített lejátszófej (üres projektben a playhead 0-ra korlátos)
      setHarness(<RecordHarness onReady={resolve} start={() => 1.01} />);
    });

  // A: felvétel → leállítás
  let h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(1500);
  await h.finish.current();
  const a = voiceClips()[0];
  const aDur = a ? await probeAudioDuration(a.uri) : 0;
  log(!!a && Math.abs(a.duration - 1.5) < 0.3, 'A10 a leállított felvétel klip lett, a recorder idejével', `${a?.duration.toFixed(2)} s`);
  log(!!a && Math.abs(aDur - a.duration) < 0.3, 'a fájl hossza egyezik a klipével', `${aDur.toFixed(2)} s`);
  log(a?.start === 1 && a.trimIn === 0 && a.sourceDuration === a.duration, 'A43 frame-rácsra ül, van trimIn és sourceDuration', `start ${a?.start}`);
  log(!!a && !a.uri.includes('/Caches/'), 'a felvétel a projekt-mappába került', a?.uri.split('/').slice(-2).join('/'));

  // a lejátszás a felvétel után halad (a felvételi mód nem ragadt be)
  const tone = toneWav('smoke_after_rec.wav', 2);
  const player = createAudioPlayer(tone);
  await sleep(400);
  player.play();
  await sleep(900);
  const pos = player.currentTime;
  player.remove();
  new File(tone).delete();
  log(pos > 0.4, 'A43 a lejátszás a felvétel után halad', `${pos.toFixed(2)} s`);

  // B: felvétel közben a felület bezárul
  h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(1500);
  setHarness(null);
  await sleep(1500);
  const b = voiceClips()[1];
  const bDur = b ? await probeAudioDuration(b.uri) : 0;
  log(!!b && bDur > 1, 'A10 a bezáráskor futó felvétel is klip lett, a fájl ép', b ? `${b.duration.toFixed(2)} s klip, ${bDur.toFixed(2)} s fájl` : 'nincs klip');
  for (const c of voiceClips()) {
    new File(c.uri).delete();
  }
}
/** A42: egy órás hang-projekt a valódi stúdióban — a vonalzó és a rács látszik (képernyőkép). */
export async function smokeAudioRuler(log: Log, lockMusic = false) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_audioruler';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioRuler', caught));
  const base = createEmptyProject('smoke egy órás hang', '9:16', undefined, 'audio');
  const long: AudioClip = { kind: 'audio', id: 'smoke-long', uri: 'file:///smoke-long.m4a', label: 'Podcast (60 perc)', start: 0, duration: 3600, trimIn: 0, sourceDuration: 3600, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [long] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  log(useEditorStore.getState().project?.id === id, 'az egy órás projekt megnyílt a stúdióban');
  if (lockMusic && !useEditorStore.getState().lockedTracks.includes('music')) {
    // A47: a videó-szerkesztővel közös zár — a stúdióban látszania kell
    useEditorStore.getState().toggleTrackFlag('music', 'lock');
    await sleep(500);
  }
  log(true, 'FOTÓZHATÓ', 'a vonalzó és az ütem-rács');
  await sleep(6000);
  if (lockMusic) {
    useEditorStore.getState().toggleTrackFlag('music', 'lock');
  }
  router.back();
  await sleep(800);
  await deleteProject(id);
}
export async function smokeAudioKillVerify(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const saved = await loadProject(AUDIO_KILL_ID);
  const clips = saved?.tracks.find((t) => t.type === 'music')?.clips ?? [];
  log(clips.length === 2, 'a kilövés előtti szerkesztés megmaradt', `${clips.length} klip a zene-sávon`);
  const second = clips.find((c) => c.start > 0) as AudioClip | undefined;
  log(second?.start === 2 && second.trimIn === 2, 'a vágás helyes a visszatöltött projektben', `start ${second?.start}, trimIn ${second?.trimIn}`);
  await deleteProject(AUDIO_KILL_ID);
}
/** 16 bites sztereó WAV: bal csatorna csend, jobb csatornán szinusz `amp` szinttel, `from` mp-től. */
function stereoRightWav(name: string, seconds: number, amp: number, from: number): string {
  const rate = 44100;
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 4);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 4, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 4, true);
  for (let i = 0; i < samples; i++) {
    const v = i / rate >= from ? Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amp * 32767) : 0;
    view.setInt16(44 + i * 4 + 2, v, true);
  }
  const file = new File(Paths.document, name);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
  return file.uri;
}
/** A20: új munkamenetben a háttér-hullámforma a korábbi bizonyításon múlik (`reset` törli). */
export async function smokeWaveformBackground(log: Log, reset: boolean) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  if (reset) {
    for (const name of Paths.document.list().map((e) => e.name).filter((n) => n.startsWith('.audioapi-ok-'))) {
      new File(Paths.document, name).delete();
    }
    log(null, 'bizonyítás törölve', 'a következő indítás bizonyítás nélkül fut');
    return;
  }
  const uri = stereoRightWav(`smoke_wavebg_${Date.now().toString(36)}.wav`, 2, 0.5, 0);
  log(null, 'dekóder-állapot az új munkamenet elején', audioApiState());
  const wave = await getWaveform(uri);
  log(null, 'A20 háttér-hullámforma új munkamenetben', wave ? `${wave.peaks.length} csúcs, max ${Math.max(...wave.peaks)}` : 'nincs');
  const studio = await getWaveform(`${uri}`, { userInitiated: true });
  log(!!studio, 'A20 a Hang Stúdió hullámformája bizonyítás nélkül is megjön', studio ? `${studio.peaks.length} csúcs` : 'nincs');
  new File(uri).delete();
}
/** A20/A22/A24 a valódi natív dekóderrel: iOS-en is fut, a jobb csatorna és a vágás számít. */
export async function smokeWaveform(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  clearWaveformMemory();
  // 2 mp csend, majd 2 mp 0.5-ös szinusz CSAK a jobb csatornán
  const uri = stereoRightWav(`smoke_wave_${Date.now().toString(36)}.wav`, 4, 0.5, 2);
  log(null, 'dekóder-állapot indulás előtt', audioApiState());
  const background = await getWaveform(uri);
  log(null, 'háttér-hívás az első dekódolás előtt', background ? 'van hullámforma' : 'nincs (iOS-őr)');
  clearWaveformMemory();
  const started = Date.now();
  const api = await loadAudioApi();
  const decoded = api ? await api.decodeAudioData(uri, 8000) : null;
  log(!!decoded, 'A20 a natív dekóder iOS-en fut, összeomlás nélkül', decoded ? `${decoded.numberOfChannels} csatorna, ${decoded.duration.toFixed(2)} s, ${Date.now() - started} ms` : 'nincs modul');
  if (decoded) {
    markAudioApi(true);
  }
  const wave = await getWaveform(uri);
  log(!!wave, 'A20 a háttér-hívás a bizonyítás után hullámformát ad', wave ? `${wave.peaks.length} csúcs` : 'null');
  if (wave) {
    const head = clipWindowPeaks(wave, 0, 2);
    const tail = clipWindowPeaks(wave, 2, 2);
    const max = (xs: number[]) => Math.max(0, ...xs);
    log(max(head) < 0.02, 'A22 a csendes szakasz csendes', `max ${max(head)}`);
    log(Math.abs(max(tail) - 0.5) < 0.05, 'A24 a csak jobb csatornás jel is látszik, helyes szinten', `max ${max(tail)}`);
    log(tail.length === 2 * WAVEFORM_PPS && head.length === 2 * WAVEFORM_PPS, 'A22 a vágott ablak pontos hosszú', `${head.length} + ${tail.length} csúcs`);
  }
  new File(uri).delete();
}
/** A6 és A19 valódi fájlon: a sérült hang nem kerül be, a mérés a jelenlegi mixet adja. */
export async function smokeAudioMix(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_tone.wav', 3);
  const broken = new File(Paths.document, 'smoke_broken.mp3');
  if (broken.exists) {
    broken.delete();
  }
  broken.write(new Uint8Array(4096).fill(7));
  const good = await probeAudioDuration(uri);
  log(Math.abs(good - 3) < 0.1, 'A6 az ép hang hossza a fájlból jön', `${good.toFixed(2)} s`);
  const bad = await probeAudioDuration(broken.uri);
  const intake = classifyAudioIntake({ uri: broken.uri, name: 'smoke_broken.mp3', durationSec: bad });
  log(bad === 0 && !intake.ok, 'A6 a sérült fájl nem kerül be', `${bad} s, ok=${intake.ok}`);
  broken.delete();

  const base = createEmptyProject('smoke mix', '1:1', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'smoke-mix-clip', uri, label: 'tone', start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const project: Project = {
    ...base,
    tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr)),
  };
  const measure = async (masterVolume: number) => {
    const mix = mixForExport(project, () => true, masterVolume);
    return mix ? analyzeMixOnDevice(mix) : null;
  };
  const full = await measure(1);
  const half = await measure(0.5);
  log(!!full && Number.isFinite(full.lufs), 'A19 a jelenlegi mix mérhető a telefonról', `${full?.lufs} LUFS`);
  const drop = (full?.lufs ?? 0) - (half?.lufs ?? 0);
  log(Math.abs(drop - 6) < 1, 'A19 a master-hangerő a mért értékben is látszik', `${drop.toFixed(1)} dB esés`);
  log(mixForExport(project, () => false, 1) === null, 'A15 némított projektből nincs export');

  if (!cloudInThisBuild()) {
    log(null, 'A28–A32 szerveres album-export: kimarad', 'ebben a buildben nincs felhő-cím');
    return;
  }
  // A32 album-út: veszteségmentes render, helyi fájlba letöltve (nem lejáró link)
  const url = await exportAudioFile(project, 'flac');
  const local = await downloadToCache(url, 'smoke_album.flac');
  const localDur = local ? await probeAudioDuration(local) : 0;
  log(!!local && local.startsWith('file:') && !local.includes('?t='), 'A32 a szám helyi fájlként marad meg', local?.split('/').pop());
  log(Math.abs(localDur - 3) < 0.1, 'A32 a letöltött FLAC teljes hosszú', `${localDur.toFixed(2)} s`);
  if (local) {
    new File(local).delete();
  }

  // A29: a ✕ a futó exportot leállítja, nem jön kész fájl
  const long: Project = {
    ...project,
    tracks: project.tracks.map((tr) =>
      tr.type === 'music' ? { ...tr, clips: Array.from({ length: 8 }, (_, i) => ({ ...clip, id: `smoke-long-${i}`, start: i * 3 })) } : tr
    ),
  };
  const controller = new AbortController();
  const started = Date.now();
  const pending = exportAudioFile(long, 'wav', undefined, controller.signal);
  setTimeout(() => controller.abort(), 1500);
  const outcome = await pending.then(() => 'kész fájl', (e: Error) => (isRenderCancelledError(e) ? 'megszakítva' : e.message));
  log(outcome === 'megszakítva', 'A29 a megszakítás leállítja az exportot', `${outcome}, ${Date.now() - started} ms`);

  // A28/A31: fájlba exportálás fejléces hitelesítéssel, a kért formátumban
  const target = new File(projectExportDir(), audioExportFileName('Smoke export', 'wav'));
  const saved = await exportAudioToFile(
    project,
    audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 48000, channels: 1 }),
    target
  );
  const size = new File(saved).size ?? 0;
  // 3 s × 48 000 minta × 3 bájt (24 bit, mono) + WAV-fejléc
  const expected = 3 * 48000 * 3;
  log(Math.abs(size - expected) < 2000, 'A31 24 bit 48 kHz mono WAV készült', `${size} bájt (várt ~${expected})`);
  log(saved.includes('/Export/') && saved.endsWith('Smoke_export.wav'), 'A28 a fájl a projekt Export-mappájában van', saved.split('/').slice(-2).join('/'));
  new File(saved).delete();
  new File(uri).delete();

  setHarness(<AudioExportSheet onClose={() => {}} onPreview={() => {}} onUseInVideo={() => {}} onDownload={() => {}} />);
  log(true, 'FOTÓZHATÓ', 'a hangexport-lap a kijelzőn');
  await sleep(5000);
  setHarness(null);
}
export async function smokeWorker(log: Log) {
  const doc = testDoc();
  const height = exportSize(doc, 2).height;
  const uri = await renderImageDoc(doc, height);
  if (!uri) {
    log(false, 'I9 worker-render a telefonról', 'null');
    return;
  }
  const img = await decode(uri);
  log(img.width() === 2160 && img.height() === 2160, 'I9 2× export a telefonról', `${img.width()}×${img.height()}`);
  log(pixel(img, 5, 5)[3] === 0, 'átlátszó háttér a telefonról kért exportban', `sarok α=${pixel(img, 5, 5)[3]}`);
  removeFile(uri);
}
function AutosaveProbe({ id }: { id: string }) {
  useProjectAutosave(id, true);
  return null;
}
export function tempProject(id?: string): Project {
  const p = createEmptyProject('__smoke__', '1:1', undefined, 'image');
  return { ...p, id: id ?? `smoke_${Date.now().toString(36)}`, imageDocs: [testDoc()] };
}
function addTextEdit() {
  const s = useEditorStore.getState();
  const doc = s.project!.imageDocs![0];
  const marker = { kind: 'shape', id: `marker_${Date.now()}`, shape: 'ellipse', position: { x: 0.2, y: 0.2 }, w: 0.1, h: 0.1, fill: '#00ff00' } as ShapeLayer;
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(doc, marker as ImageLayer), label: 'smoke' });
  return marker.id;
}
async function cleanupProject(id: string) {
  useEditorStore.getState().closeProject();
  await deleteProject(id).catch(() => {});
  await deleteCloudProject(id).catch(() => false);
  await clearRecovery(id).catch(() => {});
}
export async function smokeAutosave(log: Log, setHarness: (n: ReactNode) => void) {
  const p = tempProject();
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={p.id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  const onDisk = await loadProject(p.id);
  const saved = !!onDisk?.imageDocs?.[0].layers.some((l) => l.id === marker);
  log(saved, 'I1 autosave lemezre ír kilépés nélkül', saved ? 'a réteg a lemezen' : 'nincs a lemezen');
  log(!useEditorStore.getState().dirty, 'I1 mentés után nem piszkos');

  const second = addTextEdit();
  const flushed = await flushProjectSave();
  const afterFlush = await loadProject(p.id);
  log(flushed && !!afterFlush?.imageDocs?.[0].layers.some((l) => l.id === second), 'I1 azonnali mentés (háttérbe lépés útja)');

  const state = useEditorStore.getState();
  writeRecovery(state.project!, state.events);
  await sleep(300);
  const rec = await readRecovery(p.id);
  log(!!rec && recoveryIsFresher(rec.at, new Date(Date.now() - 60000).toISOString()), 'I1 recovery-pillanatkép visszaolvasható');

  // I3: hiányzó rétegfájl felismerése valódi fájlrendszeren
  const photo = { kind: 'photo', id: 'gone', uri: `${projectMediaDir().uri}/nincs_ilyen.png`, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover' } as PhotoLayer;
  const s = useEditorStore.getState();
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(s.project!.imageDocs![0], photo as ImageLayer), label: 'smoke' });
  const after = useEditorStore.getState().project!;
  log(after.assets.some((a) => a.uri === photo.uri), 'I2 a rétegfájl assetként regisztrálva');
  log(findMissingMedia(after).some((m) => m.uri === photo.uri), 'I3 a hiányzó rétegfájl felismerve');

  setHarness(null);
  await sleep(100);
  await cleanupProject(p.id);
  log((await loadProject(p.id)) == null, 'takarítás: az ideiglenes projekt törölve');
}
/** 1. fázis: szerkesztés + autosave, utána a Mac leállítja az appot */
export async function killPhase1(log: Log, setHarness: (n: ReactNode) => void, id: string) {
  const p = tempProject(id);
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  log(null, 'KILL-READY', marker);
}
/** 2. fázis: az app leállítása után a szerkesztés megvan-e a lemezen */
export async function killPhase2(log: Log, id: string) {
  const onDisk = await loadProject(id);
  const count = onDisk?.imageDocs?.[0].layers.filter((l) => l.id.startsWith('marker_')).length ?? 0;
  log(count === 1, 'I1 app-kill után a szerkesztés megmaradt', `${count} jelölő réteg`);
  await cleanupProject(id);
}
/** Csak olvas: a kép-projektek rétegei + a verzió-előzmény, hibakereséshez. */
export async function inspectProjects(log: Log) {
  const all = (await listProjects()).filter((p) => p.kind === 'image');
  for (const meta of all) {
    const p = await loadProject(meta.id);
    log(null, `PROJ ${meta.name} ${meta.id}`, `upd=${p?.updatedAt} docs=${p?.imageDocs?.length} assets=${p?.assets.length}`);
    for (const d of p?.imageDocs ?? []) {
      for (const l of d.layers) {
        const uri = (l as PhotoLayer).uri;
        const exists = uri ? (() => { try { return new File(uri).exists; } catch { return false; } })() : null;
        const pos = (l as PhotoLayer).position;
        log(null, `  ${l.kind} ${l.id}`, `w=${(l as PhotoLayer).w} h=${(l as PhotoLayer).h} pos=${pos?.x},${pos?.y} hidden=${!!l.hidden} file=${uri?.split('/').pop()} exists=${exists}`);
      }
    }
    const versions = await loadVersions(meta.id).catch(() => []);
    const summary = versions.slice(0, 6).map((v) => `${v.at.slice(11, 19)}:${v.project.imageDocs?.[0]?.layers.map((l) => (l as PhotoLayer).uri?.split('/').pop() ?? l.kind).join('+')}`);
    log(null, `  verziók: ${versions.length}`, summary.join(' | '));
  }
}
/** A JS-szál mérése 20 mp-ig: 250 ms-os ketyegés, a késés a fagyást mutatja. Túléli a navigációt. */
export function startFreezeWatch(log: Log) {
  let last = Date.now();
  let worst = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    worst = Math.max(worst, now - last - 250);
    last = now;
    ticks += 1;
    if (ticks === 80) {
      clearInterval(timer);
      const s = useEditorStore.getState();
      log(worst < 500, 'JS-szál a valódi stúdióban (20 mp)', `legnagyobb akadás ${worst} ms, dirty=${s.dirty}, past=${s.past.length}`);
      console.log('[IMG-SMOKE] WATCH-DONE');
    }
  }, 250);
}
