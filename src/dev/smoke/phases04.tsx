/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import type { ReactNode } from 'react';
import { getRecordingPermissionsAsync } from 'expo-audio';
import { Dimensions, Platform } from 'react-native';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { exportAudioToFile } from '@/lib/render';
import { audioExportSettings } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { offlineMixPlan , encodeWav16, wavHeader16 } from '@/lib/offlineMix';
import { startSyncProbe, stopSyncProbe, summarizeDrift } from '@/lib/audioSyncProbe';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { readPowerState } from '@/lib/powerStateClient';
import { matrixRow } from '@/lib/perfMatrix';
import { audioModelDownloads, ensureAudioModel, runAudioModelSmoke } from '@/lib/audioModels';
import { denoiseStereo } from '@/lib/denoise';
import { formantCorrect } from '@/lib/formant';
import { previewEngine } from '@/lib/previewEngine';
import '@/lib/dspNativeClient';
import { canSegment, LongSource } from '@/lib/longSource';
import { catalogRuntime, removeModel } from '@/lib/modelRegistryClient';
import { catalogEntry, catalogUsable } from '@/lib/modelCatalog';
import { integratedLoudness } from '@/lib/loudness';
import { getStretchProxySync, stretchProxyKey } from '@/lib/stretchProxy';
import { trimAudioRight } from '@/lib/audioTrim';
import { startVoiceRecording } from '@/lib/voiceRecording';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, type RecordHandle, RecordHarness, cloudInThisBuild, longToneFile, sleep, toneWav } from './shared';

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
/**
 * 🎛️ Hangmotor-próba (#6/#7): a react-native-audio-api (natív Web Audio) gráfja. Offline:
 * a StereoPanner és a BiquadFilter mintapontos hatása (L/R szint, szűrés). Valós időben: a gráf
 * szól (analyser) és az órája a falióra szerint halad (master-órának alkalmas-e).
 */
export async function smokeEngineSpike(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const api = await loadAudioApi();
  if (!api) {
    log(false, 'react-native-audio-api elérhető');
    return;
  }
  const SR = 44100;
  const rms = (x: Float32Array) => 10 * Math.log10(x.reduce((a, v) => a + v * v, 0) / x.length + 1e-30);
  const A = api;
  type Off = InstanceType<typeof A.OfflineAudioContext>;
  const render = async (build: (ctx: Off, src: AudioNode) => AudioNode, freq: number) => {
    const ctx = new A.OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR });
    const buf = ctx.createBuffer(2, SR, SR);
    const tone = Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / SR));
    buf.copyToChannel(tone, 0);
    buf.copyToChannel(tone, 1);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    build(ctx, node as unknown as AudioNode).connect(ctx.destination);
    node.start(0);
    const out = await ctx.startRendering();
    return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
  };
  type AudioNode = { connect: (n: unknown) => AudioNode };
  // pan
  for (const pan of [-1, -0.5, 0, 1]) {
    const [l, r] = await render((ctx, src) => {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      return src.connect(p);
    }, 440);
    log(null, `pan ${pan}`, `L ${rms(l).toFixed(1)} dB · R ${rms(r).toFixed(1)} dB`);
  }
  const [hl, hr] = await render((ctx, src) => { const p = ctx.createStereoPanner(); p.pan.value = -1; return src.connect(p); }, 440);
  log(rms(hl) > -10 && rms(hr) < -60, 'pan −1: a hang csak balra szól', `L ${rms(hl).toFixed(1)} · R ${rms(hr).toFixed(1)} dB`);
  // EQ: 5 kHz-es hang 500 Hz-es aluláteresztőn
  const [dry] = await render((_ctx, src) => src, 5000);
  const [wet] = await render((ctx, src) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; return src.connect(f); }, 5000);
  log(rms(dry) - rms(wet) > 30, 'EQ (biquad): az 500 Hz-es aluláteresztő az 5 kHz-et elnyomja', `${(rms(dry) - rms(wet)).toFixed(1)} dB`);
  // valós idő: szól + óra
  const ctx = new api.AudioContext({ sampleRate: SR });
  const buf = ctx.createBuffer(2, SR * 4, SR);
  const tone = Float32Array.from({ length: SR * 4 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR));
  buf.copyToChannel(tone, 0);
  buf.copyToChannel(tone, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const pan = ctx.createStereoPanner();
  pan.pan.value = 0.6;
  const an = ctx.createAnalyser();
  src.connect(pan);
  pan.connect(an);
  an.connect(ctx.destination);
  await ctx.resume();
  src.start(ctx.currentTime + 0.05);
  const c0 = ctx.currentTime;
  const w0 = Date.now();
  await sleep(600);
  const td = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(td);
  log(rms(td) > -40, 'valós idő: a gráf szól (analyser a pan után)', `${rms(td).toFixed(1)} dB`);
  await sleep(2400);
  const dc = ctx.currentTime - c0;
  const dw = (Date.now() - w0) / 1000;
  log(Math.abs(dc - dw) < 0.03, 'valós idő: a hangóra a falióra szerint halad', `hang ${dc.toFixed(3)} s · fal ${dw.toFixed(3)} s`);
  src.stop();
  await ctx.close();
}
/**
 * 🎧 Előre renderelt előnézet (az exporttal azonos keverés): 3 sáv, pan, fade — a szeletek
 * rés nélkül, időben ütemeződnek; a lejátszófej a hangórával halad; a futás közbeni
 * szerkesztés (pan-váltás) a még el nem indult szeleteket cseréli.
 */
export async function smokePreviewEngine(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_engine.wav', 12);
  const base = createEmptyProject('smoke motor', '9:16', undefined, 'audio');
  const mk = (id: string, start: number, pan: number): AudioClip => ({ kind: 'audio', id, uri, label: id, start, duration: 8, trimIn: 0, sourceDuration: 12, volume: 0.3, fadeIn: 0.2, fadeOut: 0.3, pan, source: 'imported' });
  const project = (pan: number): Project => ({ ...base, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('a', 0, pan)] } : t.type === 'sfx' ? { ...t, clips: [mk('b', 1, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('c', 2, 0)] } : t)) });
  const t0 = Date.now();
  await previewEngine.setPlan(offlineMixPlan(project(-1)));
  log(null, 'terv + dekódolás', `${Date.now() - t0} ms`);
  previewEngine.takeStats();
  const w0 = Date.now();
  await previewEngine.play(0.5);
  await sleep(1500);
  const p1 = previewEngine.position();
  const w1 = (Date.now() - w0) / 1000;
  // futás közbeni szerkesztés: a pan átvált
  const e0 = Date.now();
  await previewEngine.setPlan(offlineMixPlan(project(1)));
  const editMs = Date.now() - e0;
  await sleep(2500);
  const p2 = previewEngine.position();
  const w2 = (Date.now() - w0) / 1000;
  previewEngine.pause();
  const st = previewEngine.takeStats();
  log(st.late === 0, 'a szeletek rés nélkül, időben szólnak', `${st.chunks} szelet, ${st.late} késett, legkisebb előny ${st.minLeadMs.toFixed(0)} ms`);
  // a két mérés közti haladás (az indítás ideje — a hangmotor ébresztése — kiesik)
  log(Math.abs(p2 - p1 - (w2 - w1)) < 0.03, 'a lejátszófej a hangórával halad (nincs elcsúszás)', `${(p2 - p1).toFixed(3)} s hang · ${(w2 - w1).toFixed(3)} s fal`);
  log(st.replaced > 0 && st.replaced <= 8, 'a szerkesztés csak a még el nem indult szeleteket cseréli', `${st.replaced} szelet, az új terv ${editMs} ms alatt`);
  await sleep(300);
  log(Math.abs(previewEngine.position() - p2) < 0.01, 'szünetnél a lejátszófej megáll', `${previewEngine.position().toFixed(3)} s`);
  new File(uri).delete();
}
/** 🎧 A Hang Stúdió az előre renderelt motorról szól: óra, némítás és ugrás futás közben, megszakítás. */
export async function smokeEngineStudio(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_enginestudio';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:engineStudio', caught));
  const uri = toneWav('smoke_enginestudio.wav', 20);
  const base = createEmptyProject('smoke motor-stúdió', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number, pan: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, pan, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.8)] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 1, 0.8)] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = useEditorStore.getState;
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(800);
  {
    const proj = st().project;
    const plan = proj ? offlineMixPlan(proj) : null;
    log(null, 'motor-állapot', `armed ${previewEngine.clock() !== null}, playing ${previewEngine.isPlaying()}, unsupported [${plan?.unsupported.join(',')}], uris ${plan?.clips.map((c) => c.uri.slice(0, 12)).join(' ')}`);
  }
  log(previewEngine.isPlaying() && st().videoVoiceActive, 'a stúdió az előre renderelt motorról szól');
  const h1 = st().playhead;
  const w1 = Date.now();
  await sleep(2000);
  const h2 = st().playhead;
  const w2 = Date.now();
  log(Math.abs(h2 - h1 - (w2 - w1) / 1000) < 0.05, 'a lejátszófej a hangórával halad', `${(h2 - h1).toFixed(3)} s fej · ${((w2 - w1) / 1000).toFixed(3)} s fal`);
  // némítás futás közben → az exporttal azonos terv, a még el nem indult szeletek cserélődnek
  st().toggleTrackFlag('sfx', 'mute');
  await sleep(500);
  // ugrás futás közben
  st().setPlayhead(8);
  await sleep(400);
  log(Math.abs(previewEngine.position() - st().playhead) < 0.05 && st().playhead > 8 && st().playhead < 8.6, 'ugrás futás közben: a motor onnan folytatja', `fej ${st().playhead.toFixed(2)} · motor ${previewEngine.position().toFixed(2)}`);
  const stats = previewEngine.takeStats();
  log(stats.late === 0, 'rés nélkül szólt (némítás és ugrás közben is)', `${stats.chunks} szelet, ${stats.late} késett, ${stats.replaced} cserélve, legkisebb előny ${stats.minLeadMs.toFixed(0)} ms`);
  // rendszer-megszakítás (a hangmotor felfüggesztése, mint híváskor)
  await previewEngine.debugSuspend();
  await sleep(300);
  log(!st().isPlaying && !previewEngine.isPlaying(), 'hívás / Siri: a felfüggesztett motorral a transzport megáll');
  st().setPlaying(true);
  await sleep(1000);
  log(previewEngine.isPlaying() && st().isPlaying, 'újraindítva ismét szól');
  st().setPlaying(false);
  st().toggleTrackFlag('sfx', 'mute');
  // 🎙️ rájátszás: felvétel indul, közben a motor játssza a többi sávot
  const perm = await getRecordingPermissionsAsync();
  if (perm.granted) {
    const voice = () => (st().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
    const h = await new Promise<RecordHandle>((resolve) => setHarness(<RecordHarness onReady={resolve} start={() => st().playhead} />));
    st().setPlayhead(2);
    await startVoiceRecording(h.recorder);
    st().setPlaying(true);
    await sleep(2000);
    const h1 = st().playhead;
    log(previewEngine.isPlaying() && h.recorder.getStatus().isRecording && h1 > 3.5, 'rájátszás: felvétel közben a motor szól és halad', `fej ${h1.toFixed(2)} s`);
    st().setPlaying(false);
    await h.finish.current();
    const v = voice()[0];
    log(!!v && v.duration > 1.5, 'rájátszás: a felvétel klip lett', v ? `${v.duration.toFixed(2)} s` : 'nincs');
    setHarness(null);
    // előbb a klip kerül ki a projektből, csak utána a fájl (különben a hullámforma a hiányzót keresi)
    const files = voice().map((c) => c.uri);
    for (const c of voice()) st().removeClip(c.id);
    await sleep(300);
    for (const f of files) new File(f).delete();
  }
  router.back();
}
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
/** 🗜️ Három sáv, mindegyiken a teljes támogatott effekt-lánc: a motor valós időben, akadás nélkül. */
export async function smokeEngineFx(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_enginefx';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:engineFx', caught));
  const uri = toneWav('smoke_enginefx.wav', 20);
  const fx = { highpass: 90, lowpass: 12000, eq: { low: 3, mid: -2, high: 2 }, gate: true, deEsser: true, compressor: true, reverb: 0.5, delay: 0.4, stereoWide: true, limiter: true };
  const base = createEmptyProject('smoke motor-fx', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number, pan: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, pan, audioFx: fx, source: 'imported' });
  const project: Project = { ...base, id, audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: -1, high: 1.5 }, multiband: true }, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.5)] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 0.5, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('v', 1, 0)] } : t)) };
  const plan = offlineMixPlan(project);
  log(plan.unsupported.length === 0, 'a teljes támogatott lánc a motorral szól (nem a régi úton)', `[${plan.unsupported.join(',')}]`);
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = useEditorStore.getState;
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(5000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.late === 0 && stats.minLeadMs > 20, 'valós időben, akadás nélkül (3 sáv × teljes lánc)', `${stats.chunks} szelet, ${stats.late} késett, legkisebb előny ${stats.minLeadMs.toFixed(0)} ms, késések: ${stats.lateAt.join(',')} ms, indulás ${stats.startMs} ms, keverés ${(stats.mixMs / Math.max(1, stats.chunks)).toFixed(0)} ms/szelet (max ${stats.maxMixMs}) — a szelet 125 ms`);
  router.back();
}
/** 🎚️ Próba: a natív nyújtó `detune`-ja hangmagasság-tartással (pitch eltolás, hossz marad?). */
export async function smokePitchSpike(log: Log) {
  const api = await loadAudioApi();
  const SR = 44100;
  const tone = Float32Array.from({ length: 2 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR));
  const freq = (x: Float32Array, a: number, b: number) => {
    let n = 0;
    for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (b - a);
  };
  for (const cents of [1200, 700, -500]) {
    const ctx = new api!.OfflineAudioContext({ numberOfChannels: 1, length: 2 * SR, sampleRate: SR });
    const buf = ctx.createBuffer(1, 2 * SR, SR);
    buf.copyToChannel(tone, 0);
    const node = ctx.createBufferSource({ pitchCorrection: true });
    node.buffer = buf;
    node.detune.value = cents;
    node.connect(ctx.destination);
    node.start(0);
    const out = (await ctx.startRendering()).getChannelData(0).slice();
    const want = 440 * Math.pow(2, cents / 1200);
    const f = freq(out, 0.3, 1.7);
    let lastLoud = 0;
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > 0.05) lastLoud = i;
    log(Math.abs(f - want) < 6, `detune ${cents} cent: ${want.toFixed(0)} Hz várt`, `${f.toFixed(1)} Hz, hang vége ${(lastLoud / SR).toFixed(3)} s`);
  }
}
/** 🧹📏 Zajszűrés + normalizálás a telefonon: 60 mp-es zajos klip — idő, hatás és a −16 LUFS. */
export async function smokeDenoise(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // valódi fehér zaj (mulberry32; a túlcsorduló LCG rövid ciklusba ragadhat)
  let a = 5;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const n = 60 * SR;
  // 0,5 s hang / 0,5 s szünet, végig halk zaj
  const x = Float32Array.from({ length: n }, (_, i) => (Math.floor(i / (SR / 2)) % 2 === 0 ? 0.05 * Math.sin((2 * Math.PI * 330 * i) / SR) : 0) + 0.005 * rnd());
  const src = new File(Paths.document, 'smoke_denoise.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const base = createEmptyProject('smoke zajszűrés', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'dn', uri: src.uri, label: 'dn', start: 0, duration: 60, trimIn: 0, sourceDuration: 60, volume: 1, fadeIn: 0, fadeOut: 0, audioFx: { denoise: true, normalize: true }, source: 'voiceover' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
  log(offlineMixPlan(project).unsupported.length === 0, 'zajszűrés + normalizálás a közös DSP-ben (nem a régi úton)');
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_denoise_out.wav'));
  const ms = Date.now() - t0;
  log(ms < 40000, '60 mp zajszűrése + normalizálása a telefonon', `${(ms / 1000).toFixed(1)} s (${((ms / 60000) * 1000).toFixed(0)} ms / hang-mp)`);
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out, SR);
  const l = buf.getChannelData(0).slice();
  const r = buf.getChannelData(1).slice();
  const lufs = integratedLoudness(l, r, SR);
  log(Math.abs(lufs - -16) < 1, 'a kimenet −16 LUFS', `${lufs.toFixed(2)} LUFS`);
  const gapDb = (y: Float32Array, scale: number) => {
    let s = 0;
    let k = 0;
    for (let i = Math.round(10.6 * SR); i < Math.round(10.9 * SR); i++) {
      s += (y[i] / scale) ** 2;
      k++;
    }
    return 10 * Math.log10(s / k + 1e-30);
  };
  // a normalizálás erősítését kivéve: a szünetben a zaj a bemenethez képest
  const gain = Math.pow(10, (lufs - integratedLoudness(x, x, SR)) / 20);
  log(gapDb(l, gain) - gapDb(x, 1) < -8, 'a szünetekben a zaj legalább 8 dB-lel csökkent', `${(gapDb(l, gain) - gapDb(x, 1)).toFixed(1)} dB`);
  new File(out).delete();
  // 🎙️ hangjavítás + visszhang-csökkentés (egygombos csomagok) ugyanezen a jelen, 20 mp
  const c2: AudioClip = { ...c, id: 've', duration: 20, audioFx: undefined, voiceEnhance: true, deReverb: true };
  const p2: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c2] } : t)) };
  log(offlineMixPlan(p2).unsupported.length === 0, 'hangjavítás + visszhang-csökkentés a közös DSP-ben');
  const t1 = Date.now();
  const { uri: out2 } = await exportOfflineWav(p2, new File(projectExportDir(), 'smoke_voice_out.wav'));
  const b2 = await api!.decodeAudioData(out2, SR);
  const l2 = b2.getChannelData(0).slice();
  const lufs2 = integratedLoudness(l2, b2.getChannelData(1).slice(), SR);
  const g2 = Math.pow(10, (lufs2 - integratedLoudness(x.subarray(0, 20 * SR), x.subarray(0, 20 * SR), SR)) / 20);
  log(Math.abs(lufs2 - -16) < 1 && gapDb(l2, g2) - gapDb(x, 1) < -8, 'hangjavítás: −16 LUFS, a szünetekben kevesebb zaj', `${lufs2.toFixed(2)} LUFS, zaj ${(gapDb(l2, g2) - gapDb(x, 1)).toFixed(1)} dB, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  new File(out2).delete();
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
/**
 * 🎧 20 percnél hosszabb forrás: 25 perces fájl, szakaszos (natív ablak-) dekódolással — a minták
 * a helyükön (szakaszhatáron is), a motor a 22. percnél akadás nélkül szól ≤ 8 szakasszal, és a
 * telefonos export a fájl végéről is pontos.
 */
export async function smokeLongSource(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const SEC = 25 * 60;
  // a frekvencia 20 mp-enként lép: f(k) = 200 + 7k Hz — a minta értéke a helyéből számolható
  const value = (i: number) => {
    const k = Math.floor(i / (20 * SR));
    return 0.3 * Math.sin((2 * Math.PI * (200 + 7 * k) * i) / SR);
  };
  const src = new File(Paths.document, 'smoke_long_25min.wav');
  const t0 = Date.now();
  if (!src.exists) {
    src.create();
    const h = src.open();
    h.writeBytes(wavHeader16(SEC * SR, 1, SR));
    const CH = SR * 10;
    for (let a = 0; a < SEC * SR; a += CH) {
      const n = Math.min(CH, SEC * SR - a);
      const buf = new Int16Array(n);
      for (let i = 0; i < n; i++) buf[i] = Math.round(value(a + i) * 32767);
      h.writeBytes(new Uint8Array(buf.buffer));
    }
    h.close();
  }
  log(null, '25 perces forrás', `${((src.size ?? 0) / 1048576).toFixed(0)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(canSegment(), 'a build szakaszosan dekódol (natív ablak)');
  const long = new LongSource(src.uri);
  const check = async (fromSec: number, sec: number) => {
    const a = Math.round(fromSec * SR);
    const b = a + Math.round(sec * SR);
    const t1 = Date.now();
    await long.ensure(a, b);
    const ms = Date.now() - t1;
    const w = long.read(a, b);
    let max = 0;
    for (let i = 0; i < b - a; i++) max = Math.max(max, Math.abs((w?.[0][i] ?? 9) - value(a + i)));
    return { max, ms };
  };
  const edge = await check(39.9, 0.2);
  log(edge.max < 1e-4, 'a szakaszhatáron (40 s) a minták a helyükön', `max eltérés ${edge.max.toExponential(1)}, ${edge.ms} ms`);
  const far = await check(22 * 60 - 0.5, 1);
  log(far.max < 1e-4, 'a 22. percnél a minták a helyükön (szakaszhatár is)', `max eltérés ${far.max.toExponential(1)}, ${far.ms} ms`);
  log(long.loaded() <= 8, 'a memóriában legfeljebb 8 szakasz', `${long.loaded()} szakasz`);
  // a motor a 22. percnél (a teljes 25 perces klip a projektben)
  const id = 'prj_smoke_long';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:long', caught));
  const base = createEmptyProject('smoke hosszú forrás', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'L', uri: src.uri, label: 'podcast', start: 0, duration: SEC, trimIn: 0, sourceDuration: SEC, volume: 0.5, fadeIn: 0, fadeOut: 0, audioFx: { highpass: 80, compressor: true }, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = useEditorStore.getState;
  st().setPlayhead(22 * 60 - 2);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(4500);
  const head = st().playhead;
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(previewEngine.clock() !== null, 'a hosszú forrású projekt az előre renderelt motorról szól');
  // a mérce a 1320 s-os szakaszhatár átlépése akadás nélkül (az indulás eszközönként eltér: az emulátoron ~0,5 s)
  log(stats.late === 0 && head > 22 * 60 + 1, 'a 22. percnél akadás nélkül, a szakaszhatáron át', `${stats.chunks} szelet, ${stats.late} késett (${stats.lateAt.join(',')} ms-nál), indulás ${stats.startMs} ms, fej ${head.toFixed(1)} s`);
  log(previewEngine.loadedSegments().every((n) => n <= 8), 'a motor memóriájában legfeljebb 8 szakasz', previewEngine.loadedSegments().join(','));
  router.back();
  // telefonos export a fájl végéről (2 perces részlet a 21. perctől)
  const ep: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [{ ...c, start: 0, duration: 120, trimIn: 21 * 60 }] } : t)) };
  const t2 = Date.now();
  const { uri: out } = await exportOfflineWav(ep, new File(projectExportDir(), 'smoke_long_out.wav'), undefined, undefined, 'float32');
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out, SR);
  const x = buf.getChannelData(0);
  // a kimenet a 21. perctől: a magas-áteresztő miatt a hangnem (frekvencia) a mérce
  const freq = (y: Float32Array, a: number, b: number) => {
    let n = 0;
    for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) if ((y[i - 1] < 0) !== (y[i] < 0)) n++;
    return n / 2 / (b - a);
  };
  const want1 = 200 + 7 * Math.floor((21 * 60 + 5) / 20);
  const want2 = 200 + 7 * Math.floor((21 * 60 + 65) / 20);
  log(Math.abs(buf.duration - 120) < 0.01 && Math.abs(freq(x, 5, 6) - want1) < 2 && Math.abs(freq(x, 65, 66) - want2) < 2, 'telefonos export a 21. perctől: hossz és hangmagasság pontos', `${buf.duration.toFixed(2)} s, ${freq(x, 5, 6).toFixed(1)}/${want1} Hz, ${freq(x, 65, 66).toFixed(1)}/${want2} Hz, ${((Date.now() - t2) / 1000).toFixed(1)} s`);
  new File(out).delete();
}
/**
 * 📊 V13: eszközmátrix — szabványos mérőkör (motor lejátszás közben, 8 sávos export, hosszú forrás
 * hideg ablaka, zajszűrés, formáns); a végén a tervdokumentum táblázatának kész sora (`MATRIX`).
 */
export async function smokePerfMatrix(log: Log) {
  const SR = 44100;
  const os = `${Device.osName ?? Platform.OS} ${Device.osVersion ?? ''}`.trim();
  const device = Device.modelName ?? `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`;
  log(null, 'eszköz', `${device}, ${os}`);
  let maxThermal = (await readPowerState())?.thermal ?? -1;
  const noteThermal = async () => {
    const p = await readPowerState();
    if (p) maxThermal = Math.max(maxThermal, p.thermal);
  };
  // 8 sáv × 60 s, különböző hangok és effektek
  const SEC = 60;
  const types = ['music', 'voiceover', 'sfx', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5'] as const;
  const fxs: AudioClip['audioFx'][] = [
    { eq: { low: 3, mid: -2, high: 2 }, compressor: true },
    { highpass: 80, compressor: true, reverb: 0.3 },
    { delay: 0.3 },
    { lowpass: 8000, stereoWide: true },
    { eq: { low: -2, mid: 2, high: 1 }, reverb: 0.2 },
    { highpass: 120, delay: 0.2 },
    { compressor: true, limiter: true },
    { eq: { low: 1, mid: 1, high: -3 } },
  ];
  const clips = types.map((type, k) => {
    const f = new File(Paths.document, `smoke_perf_${k}.wav`);
    if (!f.exists) {
      f.create();
      const x = Float32Array.from({ length: SEC * SR }, (_, i) => 0.15 * Math.sin((2 * Math.PI * (110 * (k + 1)) * i) / SR));
      f.write(encodeWav16([x, x], SR, () => 0.5));
    }
    const c: AudioClip = { kind: 'audio', id: `pm${k}`, uri: f.uri, label: type, start: 0, duration: SEC, trimIn: 0, sourceDuration: SEC, volume: 0.4, fadeIn: 0, fadeOut: 0, pan: (k % 3) / 3 - 0.33, audioFx: fxs[k], source: 'imported' };
    return { type, c };
  });
  // futásonként új azonosító: a meleg ismétlésnél a stúdió még az előző (azonos id-jű) projekten áll
  const id = `prj_smoke_perf_${Date.now().toString(36)}`;
  const base = createEmptyProject('smoke mátrix', '9:16', undefined, 'audio');
  const tracks = [
    ...base.tracks.map((t) => {
      const hit = clips.find((x) => x.type === t.type);
      return hit ? { ...t, clips: [hit.c] } : t;
    }),
    ...clips.filter((x) => !base.tracks.some((t) => t.type === x.type)).map((x) => ({ id: `trk_${x.type}`, type: x.type, name: x.type, clips: [x.c] })),
  ];
  const project: Project = { ...base, id, tracks };
  await saveProject(project);
  // motor lejátszás közben
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  // dev-módban a Metro a hidegindítás után lustán tölti a modulokat → a stúdió több mp is lehet
  for (let i = 0; i < 150 && st().project?.id !== id; i++) await sleep(200);
  log(st().project?.id === id, 'a mérőprojekt betöltött a stúdióban');
  await sleep(2500);
  st().setPlayhead(5);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(8000);
  const head = st().playhead;
  st().setPlaying(false);
  const es = previewEngine.takeStats();
  log(null, 'motor-diag', `fej ${head.toFixed(2)} s (5 → +8 s várt), lejátszik: ${previewEngine.clock() !== null}`);
  const engine = { chunks: es.chunks, late: es.late, avgMixMs: es.chunks > 0 ? es.mixMs / es.chunks : 0, maxMixMs: es.maxMixMs };
  log(previewEngine.clock() !== null && es.late === 0 && es.chunks >= 60 && head > 12, 'motor: 8 sáv effektekkel, akadás nélkül, végig szólt', `${es.chunks} szelet, átlag ${engine.avgMixMs.toFixed(1)} ms, max ${es.maxMixMs} ms, ${es.late} késett (${es.lateAt.join(',')} ms-nál), min. előny ${Math.round(es.minLeadMs)} ms, indulás ${es.startMs} ms`);
  router.back();
  await sleep(500);
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:perf', caught));
  await noteThermal();
  // telefonos export
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_perf_out.wav'));
  const exportMs = Date.now() - t0;
  new File(out).delete();
  log(exportMs < SEC * 1000, 'export: 8 sáv × 60 s gyorsabb a valós időnél', `${exportMs} ms = ${(SEC / (exportMs / 1000)).toFixed(1)}×`);
  await noteThermal();
  // hosszú forrás: hideg ablak a 27. percnél
  const long = new LongSource(longToneFile().uri);
  const a = 27 * 60 * SR;
  const t1 = Date.now();
  await long.ensure(a, a + SR);
  const longSourceMs = Date.now() - t1;
  log(longSourceMs < 1000, 'hosszú forrás: hideg ablak 1 s alatt', `${longSourceMs} ms`);
  // zajszűrés 60 s sztereó
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const nl = Float32Array.from({ length: 60 * SR }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 300 * i) / SR) + 0.05 * rnd());
  const nr = Float32Array.from(nl);
  const t2 = Date.now();
  await denoiseStereo(nl, nr);
  const denoise60Ms = Date.now() - t2;
  log(denoise60Ms * 10 < 60_000, 'zajszűrés: 10 perc becsülten 60 s alatt', `60 s → ${denoise60Ms} ms`);
  await noteThermal();
  // formáns 10 s mono
  const ref = nl.subarray(0, 10 * SR);
  const shifted = Float32Array.from(ref, (v, i) => ref[Math.min(ref.length - 1, Math.round(i * 1.12))] ?? v);
  const t3 = Date.now();
  formantCorrect(ref, shifted, SR);
  const formant10Ms = Date.now() - t3;
  log(formant10Ms < 10_000, 'formáns: 10 s valós időnél gyorsabban', `${formant10Ms} ms`);
  await noteThermal();
  const row = matrixRow({ date: new Date().toISOString().slice(0, 10), device, os, engine, exportRun: { tracks: 8, sec: SEC, ms: exportMs }, longSourceMs, denoise60Ms, formant10Ms, maxThermal });
  log(null, 'MATRIX', row);
}
/** 📸 V8 fotózható állapotok: a dobgép AI-sora (20 s), utána a klip-szerkesztő AI-zajszűrés része (20 s) */
export async function smokeAiShot(log: Log) {
  const st = useEditorStore.getState;
  const id = `prj_smoke_aishot_${Date.now().toString(36)}`;
  const f = new File(Paths.document, 'smoke_aidenoise_in.wav');
  const base = createEmptyProject('AI-próba', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'v', uri: f.uri, label: 'beszéd', start: 0, duration: 20, trimIn: 0, sourceDuration: 20, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: f.exists ? [clip] : [] } : t)) });
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    runDevAction('audio.openDrums');
    await sleep(800);
    runDevAction('drums.demo');
    await runDevAction('drums.ai', { mode: 'continue', temp: 'creative', seed: 3 });
    log(true, 'FOTÓZHATÓ-1', 'a dobgép az AI-sorral');
    await sleep(20_000);
    runDevAction('audio.closeDrums');
    await sleep(600);
    st().selectClip('v');
    runDevAction('audio.editClip');
    log(true, 'FOTÓZHATÓ-2', 'a klip-szerkesztő AI-zajszűréssel');
    await sleep(20_000);
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:aishot', caught));
  }
}
/**
 * 🤖 V8: a telefonos hang-AI modellek a gyári katalógusból — törölve → letöltés (sha256) + önellenőrzés (PASS);
 * a második használat NEM tölt le (letöltés után hálózat nélkül, repülő módban is megy).
 */
export async function smokeAiModels(log: Log) {
  log(null, 'eszköz', `${Device.modelName ?? Platform.OS}`);
  const ids = ['rnnoise-v02', 'magenta-drums', 'spleeter-2stems'] as const;
  for (const id of ids) removeModel(id);
  const d0 = audioModelDownloads();
  for (const id of ids) {
    const t0 = Date.now();
    const ok = await ensureAudioModel(id);
    const rt = catalogRuntime();
    log(ok && rt.smoke?.[id] === 'pass' && catalogUsable(catalogEntry(id)!, rt), `${id}: letöltve (sha256), ellenőrizve, használható`, `${Date.now() - t0} ms`);
  }
  const d1 = audioModelDownloads();
  for (const id of ids) await ensureAudioModel(id);
  log(d1 - d0 === 3 && audioModelDownloads() === d1, 'a második használat letöltés nélkül (offline / repülő módban is)', `${d1 - d0} letöltés, utána ${audioModelDownloads() - d1}`);
  const card = await runAudioModelSmoke('rnnoise-v02');
  log(card, 'a Profil-kártya önellenőrzése (ugyanaz a függvény) PASS');
}
