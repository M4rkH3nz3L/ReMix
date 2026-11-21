/** 🧪 Füstteszt — gyorsított/visszafelé lejátszott klipek hangja (előnézet, telefonos és natív export). (Áthelyezve: phases03, phases04; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { Asset } from 'expo-asset';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { startSyncProbe, stopSyncProbe, summarizeDrift } from '@/lib/audioSyncProbe';
import { exportOfflineWav, measureStretchLatency } from '@/lib/offlineMixClient';
import { canRenderLocally, renderLocal } from '@/lib/nativeRender';
import type { RenderSettings } from '@/lib/render';
import { encodeWav16 } from '@/lib/offlineMix';
import { canDetachAudio, detachAudioCommands } from '@/lib/audioExtract';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip, AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { getStretchProxySync, stretchProxyKey } from '@/lib/stretchProxy';
import { trimAudioRight } from '@/lib/audioTrim';
import '@/lib/dspNativeClient';

/**
 * ⏩ A gyorsított videóklip hangja leválasztható (lista #21): a valódi parancs-út (egy undo), és a
 * Hang Stúdióban a hangmagasság-tartó, 1,5×-es előnézet szinkronja a szondával.
 */
export async function smokeAudioSpeed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = 'prj_smoke_audiospeed';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioSpeed', caught));
  const base = createEmptyProject('smoke gyorsított hang', '16:9', undefined, 'audio');
  const video = { id: 'v', kind: 'video', uri, start: 0, duration: 6, trimIn: 0.5, sourceDuration: 10, speed: 1.5, volume: 1, filterId: 'none' } as VideoClip;
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [video] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const st = () => useEditorStore.getState();
  const voice = () => (st().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const vol = () => (st().project?.tracks.find((t) => t.type === 'video')?.clips[0] as VideoClip | undefined)?.volume;
  log(canDetachAudio(video), 'az 1,5×-es videóklip hangja leválasztható');
  const detach = () => st().applyBatch(detachAudioCommands(video, 'leválasztott', st().project?.links).commands, 'user');
  detach();
  const a = voice()[0];
  log(a?.speed === 1.5 && a.trimIn === 0.5 && a.duration === 6 && vol() === 0, 'a hangklip átvette a sebességet és a vágást, a videó elnémult', a ? `${a.speed}×, trimIn ${a.trimIn}` : 'nincs');
  st().undo();
  log(voice().length === 0 && vol() === 1, 'egy visszavonás mindent visszaállít');
  detach();
  const clipId = voice()[0]?.id ?? '';
  st().setPlayhead(0);
  await sleep(600);
  // 1. kör: a tanulás; 2. kör: a mért szinkron
  st().setPlaying(true);
  await sleep(2500);
  st().setPlaying(false);
  await sleep(500);
  st().setPlayhead(0);
  await sleep(600);
  startSyncProbe();
  st().setPlaying(true);
  await sleep(1500);
  const rate = runDevAction(`audio.nativeRate.${clipId}`) as number | undefined;
  await sleep(3500);
  const head = st().playhead;
  st().setPlaying(false);
  const { samples, seeks } = stopSyncProbe();
  log(Math.abs((rate ?? 0) - 1.5) < 0.01, 'az előnézet 1,5×-en szól (hangmagasság-tartással)', `rate ${rate}`);
  // a szonda forrás-időben mér: idővonal-időre a sebességgel osztva
  for (const [cid, d] of summarizeDrift(samples.filter((x) => x.sinceStart > 2))) {
    log(d.maxMs / 1.5 <= 45, `szinkron beállás után (${cid === clipId ? 'gyorsított hang' : cid})`, `max ${(d.maxMs / 1.5).toFixed(0)} ms idővonal-időben, ${d.n} minta`);
  }
  log(seeks <= 3, 'a lejátszás nem tekereget folyamatosan', `${seeks} korrekció`);
  const tr = samples.filter((x) => x.clipId === clipId);
  log(null, 'nyom gyorsított', tr.filter((_, k) => k % 8 === 0).map((x) => `${x.sinceStart.toFixed(1)}:${((x.drift * 1000) / 1.5).toFixed(0)}`).join(' '));
  log(Math.abs(head - 5) < 0.4, 'a lejátszófej a valós idővel halad', `${head.toFixed(2)} s`);
  router.back();
}
/**
 * ⏩ A gyorsított hang a TELEFONOS exportban (natív, hangmagasság-tartó nyújtás): forrás 2 s
 * 440 Hz + 2 s 880 Hz. Mérve: a hossz, a frekvencia (marad-e a hangmagasság) és a hangváltás
 * ideje (a nyújtó nem késleltet-e) — ugyanazok, mint a szerveres ffmpeg-tesztben.
 */
export async function smokeOfflineStretch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.cache, 'smoke_two_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const api = await loadAudioApi();
  const freqAt = (x: Float32Array, from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  /** az első 20 ms-os ablak, ahol a frekvencia 660 Hz fölé megy */
  const switchAt = (x: Float32Array, from: number, to: number) => {
    for (let t = from; t < to; t += 0.005) if (freqAt(x, t, t + 0.02) > 660) return t + 0.01;
    return Number.NaN;
  };
  const run = async (name: string, over: Partial<AudioClip>) => {
    const base = createEmptyProject('smoke nyújtás', '1:1', undefined, 'audio');
    const c: AudioClip = { kind: 'audio', id: 's', uri: src.uri, label: 's', start: 0, duration: 2, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'voiceover', ...over };
    const p: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
    const t0 = Date.now();
    const { uri, unsupported } = await exportOfflineWav(p, new File(projectExportDir(), `${name}.wav`));
    const ms = Date.now() - t0;
    const buf = await api!.decodeAudioData(uri, SR);
    const x = buf.getChannelData(0).slice();
    new File(uri).delete();
    return { x, dur: buf.duration, ms, unsupported };
  };
  for (const sp of [2, 0.5]) {
    const lat = await measureStretchLatency(sp);
    log(null, `nyújtó késése ${sp}×`, `${lat} minta = ${(((lat ?? 0) / SR) * 1000).toFixed(1)} ms`);
  }
  try {
    const fast = await run('smoke_stretch_2x', { start: 0.5, duration: 2, speed: 2 });
    log(fast.unsupported.length === 0, '2×: a telefonos export nem hagyja ki', `${fast.ms} ms`);
    log(Math.abs(fast.dur - 2.5) < 0.01, '2×: a hossz pontos', `${fast.dur.toFixed(3)} s`);
    const f1 = freqAt(fast.x, 0.6, 1.4);
    const f2 = freqAt(fast.x, 1.6, 2.4);
    log(Math.abs(f1 - 440) < 8 && Math.abs(f2 - 880) < 8, '2×: a hangmagasság marad (nem 880 / 1760 Hz)', `${f1.toFixed(0)} Hz → ${f2.toFixed(0)} Hz`);
    const sw = switchAt(fast.x, 1.2, 1.8);
    log(Math.abs(sw - 1.5) < 0.03, '2×: a hangváltás a helyén (a nyújtó nem késleltet)', `${sw.toFixed(3)} s (várt 1,500)`);
    const slow = await run('smoke_stretch_05x', { start: 0, duration: 4, speed: 0.5, trimIn: 1 });
    // forrás 1–3 s: 440 Hz 1 s-ig, váltás a forrás 2 s-ánál = idővonal 2 s
    const s1 = freqAt(slow.x, 0.2, 1.8);
    const s2 = freqAt(slow.x, 2.2, 3.8);
    log(Math.abs(slow.dur - 4) < 0.01 && Math.abs(s1 - 440) < 8 && Math.abs(s2 - 880) < 8, '0,5×: hossz és hangmagasság', `${slow.dur.toFixed(3)} s, ${s1.toFixed(0)} → ${s2.toFixed(0)} Hz`);
    const sw2 = switchAt(slow.x, 1.7, 2.3);
    log(Math.abs(sw2 - 2) < 0.04, '0,5×: a hangváltás a helyén', `${sw2.toFixed(3)} s (várt 2,000)`);
    // 🎚️ hangmagasság +7 félhang (a hossz marad): 440 → 659 Hz, 880 → 1319 Hz, a váltás a helyén
    const up = await run('smoke_pitch_7', { start: 0, duration: 4, audioFx: { pitchSemitones: 7 } });
    const u1 = freqAt(up.x, 0.3, 1.7);
    const u2 = freqAt(up.x, 2.3, 3.7);
    log(up.unsupported.length === 0 && Math.abs(u1 - 659.3) < 8 && Math.abs(u2 - 1318.5) < 12, 'hangmagasság +7: 440 → 659, 880 → 1319 Hz', `${u1.toFixed(0)} → ${u2.toFixed(0)} Hz, ${up.dur.toFixed(3)} s`);
    let usw = Number.NaN;
    for (let t = 1.7; t < 2.3 && Number.isNaN(usw); t += 0.005) if (freqAt(up.x, t, t + 0.02) > 990) usw = t + 0.01;
    log(Math.abs(usw - 2) < 0.04, 'hangmagasság: a váltás a helyén (a nyújtó késése kalibrálva)', `${usw.toFixed(3)} s (várt 2,000)`);
  } finally {
    src.delete();
  }
}
/**
 * ⏩ A natív (iOS) videó-render a gyorsított hangklipet is skálázza: videó (némítva) + 2×-es
 * hangklip (2 s 440 Hz + 2 s 880 Hz forrás) → MP4 a telefonon; a kimenet hangjában a hossz,
 * a hangmagasság és a hangváltás helye.
 */
export async function smokeNativeSpeed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const asset = Asset.fromModule(require('../../../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.cache, 'smoke_native_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const base = createEmptyProject('smoke natív sebesség', '16:9');
  const video = { id: 'v', kind: 'video', uri: asset.localUri ?? asset.uri, start: 0, duration: 4, trimIn: 0, sourceDuration: 10, speed: 1, volume: 0, filterId: 'none' } as VideoClip;
  const voice: AudioClip = { kind: 'audio', id: 'h', uri: src.uri, label: 'h', start: 0.5, duration: 2, trimIn: 0, sourceDuration: 4, speed: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'voiceover' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video] } : t.type === 'voiceover' ? { ...t, clips: [voice] } : t)) };
  const settings: RenderSettings = { resolution: 720, fps: 30, quality: 'medium', codec: 'h264' };
  const local = canRenderLocally(project, settings);
  log(local, 'a gyorsított hangklipes projekt a telefonon renderelhető (az új build jelzi a képességet)');
  if (!local) return;
  const t0 = Date.now();
  const out = await renderLocal(project, settings);
  log(null, 'natív render', `${Date.now() - t0} ms`);
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out.uri, SR);
  const x = buf.getChannelData(0).slice();
  const freqAt = (from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  let sw = Number.NaN;
  for (let t = 1.2; t < 1.8 && Number.isNaN(sw); t += 0.005) if (freqAt(t, t + 0.02) > 660) sw = t + 0.01;
  const f1 = freqAt(0.6, 1.4);
  const f2 = freqAt(1.6, 2.4);
  log(Math.abs(f1 - 440) < 10 && Math.abs(f2 - 880) < 10, 'a hangmagasság marad (nem 880 / 1760 Hz)', `${f1.toFixed(0)} Hz → ${f2.toFixed(0)} Hz`);
  log(Math.abs(sw - 1.5) < 0.04, 'a hangváltás a helyén (2× = a forrás 2 s-a az idővonal 1,5 s-ánál)', `${sw.toFixed(3)} s`);
  log(freqAt(2.6, 3.4) < 50, 'a klip után csend (a hang nem nyúlik túl)', `${freqAt(2.6, 3.4).toFixed(0)} Hz`);
  out.delete();
  src.delete();
}

/**
 * ⏪⏩ Előnézet visszafelé és 3×-en (a lejátszó ezt nem tudja): a telefon előre nyújtott szakaszt
 * készít, és azt játssza 1×-en. Mérve: a szakasz tartalma (frekvencia-sorrend, hossz), a
 * lejátszás szinkronja és hogy vágás után új szakasz készül.
 */
export async function smokeAudioReverse(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.3 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.document, 'smoke_reverse_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const id = 'prj_smoke_audioreverse';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioReverse', caught));
  const base = createEmptyProject('smoke visszafelé', '9:16', undefined, 'audio');
  const rev: AudioClip = { kind: 'audio', id: 'rev', uri: src.uri, label: 'visszafelé', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, reversed: true, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'voiceover' };
  const fast: AudioClip = { kind: 'audio', id: 'fast', uri: src.uri, label: '3×', start: 0, duration: 4 / 3, trimIn: 0, sourceDuration: 4, speed: 3, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [rev] } : t.type === 'music' ? { ...t, clips: [fast] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  const api = await loadAudioApi();
  const freqAt = (x: Float32Array, from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  const waitProxy = async (key: string) => {
    const t0 = Date.now();
    for (let i = 0; i < 100 && !getStretchProxySync(key); i++) await sleep(100);
    return { uri: getStretchProxySync(key), ms: Date.now() - t0 };
  };
  try {
    const rk = stretchProxyKey(src.uri, rev);
    const r = await waitProxy(rk);
    log(!!r.uri, 'visszafelé: az előnézeti szakasz elkészült', `${r.ms} ms`);
    if (r.uri) {
      const b = await api!.decodeAudioData(r.uri, SR);
      const x = b.getChannelData(0).slice();
      log(Math.abs(b.duration - 4) < 0.01 && Math.abs(freqAt(x, 0.2, 1.8) - 880) < 8 && Math.abs(freqAt(x, 2.2, 3.8) - 440) < 8, 'visszafelé: előbb 880, aztán 440 Hz, 4 s', `${b.duration.toFixed(3)} s, ${freqAt(x, 0.2, 1.8).toFixed(0)} → ${freqAt(x, 2.2, 3.8).toFixed(0)} Hz`);
    }
    const fk = stretchProxyKey(src.uri, fast);
    const f = await waitProxy(fk);
    if (f.uri) {
      const b = await api!.decodeAudioData(f.uri, SR);
      const x = b.getChannelData(0).slice();
      log(Math.abs(b.duration - 4 / 3) < 0.01 && Math.abs(freqAt(x, 0.05, 0.6) - 440) < 10 && Math.abs(freqAt(x, 0.75, 1.3) - 880) < 10, '3×: a hangmagasság marad, 1,33 s', `${b.duration.toFixed(3)} s, ${freqAt(x, 0.05, 0.6).toFixed(0)} → ${freqAt(x, 0.75, 1.3).toFixed(0)} Hz`);
    } else {
      log(false, '3×: az előnézeti szakasz elkészült');
    }
    // lejátszás: a kész szakasz 1×-en, szinkronban
    const st = useEditorStore.getState;
    st().setPlayhead(0);
    st().setPlaying(true);
    await sleep(2000);
    st().setPlaying(false);
    await sleep(500);
    st().setPlayhead(0);
    await sleep(600);
    startSyncProbe();
    st().setPlaying(true);
    await sleep(1000);
    const rate = runDevAction('audio.nativeRate.rev') as number | undefined;
    const playing = runDevAction('audio.nativePlaying.rev') === true;
    await sleep(2800);
    st().setPlaying(false);
    const { samples } = stopSyncProbe();
    log(playing && rate === 1, 'visszafelé: a szakasz 1×-en szól', `rate ${rate}`);
    for (const [cid, d] of summarizeDrift(samples.filter((x) => x.sinceStart > 2 && x.clipId === 'rev'))) {
      log(d.maxMs <= 45, `szinkron beállás után (${cid})`, `max ${d.maxMs.toFixed(0)} ms, ${d.n} minta`);
    }
    const trace = samples.filter((x) => x.clipId === 'rev');
    log(null, 'nyom rev', trace.filter((_, k) => k % 6 === 0).map((x) => `${x.sinceStart.toFixed(1)}:${(x.drift * 1000).toFixed(0)}`).join(' '));
    // vágás után új szakasz (a jobb él a forrás eleje: a trimIn mozdul); a lejátszó csak a
    // lejátszófej környéki klipet tölti be — a fej a klipen álljon
    st().setPlayhead(0.5);
    st().updateClip('rev', trimAudioRight(rev, 3));
    const cut = st().project?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip;
    const nk = stretchProxyKey(src.uri, cut);
    const n = await waitProxy(nk);
    log(nk !== rk && !!n.uri && cut.trimIn === 1, 'vágás után új szakasz készül (a trimIn a forrás eleje felől mozdult)', `trimIn ${cut.trimIn}, ${n.ms} ms`);
  } finally {
    router.back();
    src.delete();
  }
}
