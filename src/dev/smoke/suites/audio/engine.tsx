/** 🧪 Füstteszt — hangmotor: natív gráf, előre renderelt előnézet, effekt-lánc, pitch, kimenet-váltás, távoli forrás. (Áthelyezve: phases04, phases07, phases12, phases13; viselkedés-változás nélkül.) */
import { File } from 'expo-file-system';
import type { ReactNode } from 'react';
import { getRecordingPermissionsAsync } from 'expo-audio';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { offlineMixPlan } from '@/lib/offlineMix';
import { previewEngine } from '@/lib/previewEngine';
import { startVoiceRecording } from '@/lib/voiceRecording';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { toneWav, type RecordHandle, RecordHarness } from '../../helpers/audio';
import { dbToVolume } from '@/lib/clipGain';
import { previewLocalUri } from '@/lib/previewRemoteCache';
import { getWaveform } from '@/lib/waveform';
import { smokeFileHost } from '../../helpers/env';
import { measureStretchLatency } from '@/lib/offlineMixClient';
import '@/lib/dspNativeClient';

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
/** 🌐🔊 R1: távoli (http) forrású klip +6 dB-lel — a motor átveszi (letöltve a cache-be), az élő mérés −14 LUFS (a tartalék lejátszó nem erősítene). */
export async function smokeRemoteGain(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const url = `${smokeFileHost()}/gain_ref12.wav`;
  const id = 'prj_smoke_remotegain';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:remotegain', caught));
  const base = createEmptyProject('smoke távoli klip', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'r', uri: url, label: 'távoli', start: 0, duration: 12, trimIn: 0, sourceDuration: 12, volume: dbToVolume(6), fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  const t0 = Date.now();
  for (let i = 0; i < 100 && !previewLocalUri(url); i++) await sleep(100);
  log(!!previewLocalUri(url), 'a távoli forrás letöltve az előnézeti cache-be (nem a projekt-mappába)', `${Date.now() - t0} ms`);
  // a lejátszás AZONNAL a megnyitás után (a motor még indulhat) — a tartalék → motor átváltás nem állíthatja le
  const stops: string[] = [];
  const origSet = st().setPlaying;
  useEditorStore.setState({
    setPlaying: (p: boolean) => {
      if (!p) stops.push((new Error().stack ?? '').split('\n').slice(1, 6).map((l) => l.trim().replace(/\(.*\)/, '')).join(' < '));
      origSet(p);
    },
  });
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 60 && !previewEngine.isPlaying(); i++) await sleep(50);
  const onEngine = previewEngine.isPlaying();
  const probe: string[] = [];
  for (let i = 0; i < 19; i++) {
    await sleep(200);
    if (i % 4 === 0) probe.push(`${(st().playhead).toFixed(2)}:${st().isPlaying ? 'P' : '-'}${previewEngine.isPlaying() ? 'E' : '-'}`);
  }
  const r = previewEngine.loudness();
  log(null, 'állapot lejátszás közben (lejátszófej:transzport/motor)', probe.join(' '));
  log(null, 'ki állította le', stops.slice(0, 2).join(' || ') || '—');
  useEditorStore.setState({ setPlaying: origSet });
  st().setPlaying(false);
  const wf = await getWaveform(url, { userInitiated: true });
  log(!!wf && wf.peaks.length >= 12 * 64 - 2, 'a távoli klipnek is van hullámformája (a helyi másolatból)', `${wf?.peaks.length ?? 0} csúcs`);
  log(onEngine && !!r && Math.abs(r.shortTerm - -14) <= 0.1, 'a távoli klipet a motor játssza, a +6 dB hallható: −20 dBFS → élő −14 ± 0,1 LUFS', r ? `S ${r.shortTerm.toFixed(2)} LUFS, TP ${r.truePeak.toFixed(2)} dBTP` : `motor ${onEngine}`);
  router.back();
}
/**
 * 🎧 S15: kimenet-/munkamenet-váltás lejátszás közben (a hang-mód átállítása ugyanazt a natív útvonal-
 * változást váltja ki, mint a fejhallgató ki/be) — a motor ne álljon meg, a lejátszófej haladjon tovább.
 */
export async function smokeRouteChange(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { setAudioModeAsync } = await import('expo-audio');
  const id = 'prj_smoke_route';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:route', caught));
  const base = createEmptyProject('smoke kimenet', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_route.wav', 12), start: 0, duration: 12, trimIn: 0, sourceDuration: 12, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  try {
    st().setPlayhead(0);
    st().setPlaying(true);
    await sleep(3000);
    const before = st().playhead;
    // a munkamenet átállítása (felvétel-mód be, majd vissza) — útvonal-/kategória-változás a natív oldalon
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await sleep(400);
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    await sleep(2500);
    const after = st().playhead;
    const playing = st().isPlaying;
    st().setPlaying(false);
    log(playing && after - before > 2.2, 'munkamenet-váltás lejátszás közben: a lejátszás folytatódik, a lejátszófej halad', `játszik ${playing}, ${before.toFixed(2)} → ${after.toFixed(2)} s`);
  } finally {
    st().setPlaying(false);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:route-del', caught));
  }
}
/** 🔬 diagnózis: a natív nyújtó késése 1-es sebességen különböző hangmagasság-eltolásoknál */
export async function smokeShiftLatency(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const c of [0, -35, 40, 100, 265, 440, -300, 700]) {
    const t0 = Date.now();
    const lat = await measureStretchLatency(1, c);
    log(null, `késés ${c} cent`, `${lat} minta (${Date.now() - t0} ms mérés)`);
  }
}
