/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { File, Paths } from 'expo-file-system';
import { Dimensions, Platform } from 'react-native';
import { remixFromPost } from '@/lib/feed';
import { remixRoute } from '@/lib/imageRemix';
import type { FeedPost } from '@/types/social';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav, measureStretchLatency, probeStretchTiming } from '@/lib/offlineMixClient';
import { previewEngine } from '@/lib/previewEngine';
import '@/lib/dspNativeClient';
import { useAuth } from '@/store/authStore';
import { useCollabLive } from '@/store/collabLiveStore';
import { ensureShared, inviteMember, pullSharedProject, removeMember, respondToInvite } from '@/lib/collab';
import { deleteCloudProject } from '@/lib/cloudSync';
import { canUseCloud } from '@/lib/backend';
import { dbToVolume } from '@/lib/clipGain';
import { tempoMatchPatch } from '@/lib/tempoMatch';
import { moveStage } from '@/lib/fxOrder';
import { masterPreset } from '@/lib/audioMaster';
import { useReference } from '@/store/referenceStore';
import { applyReference, measureReference } from '@/lib/referenceClient';
import { measureMastered } from '@/lib/mixAssistClient';
import { previewLocalUri } from '@/lib/previewRemoteCache';
import { canExtractAudio, extractVideoAudio } from '@/lib/videoAudioImport';
import { LiveLoudness } from '@/lib/liveLoudness';
import { encodeWav16 } from '@/lib/offlineMix';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { getWaveform } from '@/lib/waveform';
import { supabase } from '@/lib/supabase';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep, smokeFileHost, toneWav } from './shared';

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
/** ⏸️➕✂️↩️ T6 csend beszúrása + összeillesztés: az export mintára (a beszúrás pontosan 1 s-mal tolja a folytatást; a vágás + összeillesztés = az eredeti, bitre). */
export async function smokeGapEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // a beszéd: a frekvencia 0,1 s-onként ugrik (a tolás mintára ellenőrizhető)
  const v = Float32Array.from({ length: 8 * SR }, (_, i) => 0.4 * Math.sin(2 * Math.PI * (220 + 30 * (Math.floor((i / SR) * 10) % 20)) * (i / SR)));
  const f = new File(Paths.document, 'smoke_gap_voice.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([v, v], SR, () => 0.5));
  const id = 'prj_smoke_gap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:gap', caught));
  const base = createEmptyProject('smoke csend + illesztés', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'v', uri: f.uri, label: 'beszéd', start: 0, duration: 4, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  await saveProject({ ...base, id, markers: [{ id: 'mk', time: 3, label: 'jel' }], tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({})] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'mu', uri: toneWav('smoke_gap_bed.wav', 8), duration: 6, volume: 0.2 })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(voOnly(p), new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  const origin = JSON.stringify(st().project);
  const A = await render(st().project!, 'smoke_gap_a.wav');
  const maxDiff = (x: Float32Array, y: Float32Array, from: number, to: number, shift = 0) => {
    let d = 0;
    for (let i = from; i < to; i++) d = Math.max(d, Math.abs((x[i] ?? 0) - (y[i + shift] ?? 0)));
    return d;
  };
  // 1) csend 1 s a 2. mp-nél, csak a beszéd-sávon
  st().selectClip('v');
  st().setPlayhead(2);
  const n1 = runDevAction('audio.insertSilence1Track') as number;
  const vClips = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  log(n1 === 1 && vClips().length === 2 && vClips()[1].start === 3 && Math.abs((vClips()[1].trimIn ?? 0) - 2) < 1e-9, 'csend beszúrása (csak ez a sáv): a klip kettéválik, a jobb fele 1 s-mal később, a forrás folytatásával', vClips().map((c) => `${c.start}+${c.duration} (trimIn ${c.trimIn})`).join(' · '));
  const B = await render(st().project!, 'smoke_gap_b.wav');
  const seam = Math.round(0.012 * SR);
  const before = maxDiff(A, B, 0, 2 * SR - seam);
  const after = maxDiff(A, B, 2 * SR + seam, 4 * SR - seam, SR);
  let gapPeak = 0;
  for (let i = 2 * SR + seam; i < 3 * SR - seam; i++) gapPeak = Math.max(gapPeak, Math.abs(B[i]));
  log(before === 0 && after === 0 && gapPeak === 0 && B.length - A.length === SR, 'a hang: előtte változatlan, a beszúrás néma, utána ugyanaz pontosan 44 100 mintával később (a varratok 10 ms-os mikro-fade-je nélkül)', `eltérés ${before} / ${after}, csend csúcsa ${gapPeak}, hossz +${B.length - A.length} minta`);
  log(st().project!.markers?.[0]?.time === 3 && (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).duration === 6, 'csak ez a sáv: a zene és a jelölő a helyén', '');
  st().undo();
  log(JSON.stringify(st().project) === origin, 'egy visszavonás: pontosan az eredeti', '');
  // 2) minden sáv
  st().setPlayhead(2);
  runDevAction('audio.insertSilence1All');
  const mus = (st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  log(mus.length === 2 && mus[1].start === 3 && st().project!.markers?.[0]?.time === 4, 'minden sáv: a zene is kettéválik és tolódik, a jelölő 3 → 4 s', mus.map((c) => `${c.start}+${c.duration}`).join(' · '));
  st().undo();
  // 3) vágás → összeillesztés = az eredeti (bitre)
  st().splitClipAt('v', 1.7);
  st().selectClip('v');
  const parts = vClips().length;
  const n3 = runDevAction('audio.join') as number;
  const C = await render(st().project!, 'smoke_gap_c.wav');
  log(parts === 2 && n3 === 2 && vClips().length === 1 && vClips()[0].duration === 4 && maxDiff(A, C, 0, A.length) === 0 && A.length === C.length, 'vágás (1,7 s) → összeillesztés: egy klip, a hang bitre az eredeti', `${parts} → ${vClips().length} klip, eltérés ${maxDiff(A, C, 0, A.length)}`);
  st().undo();
  st().undo();
  log(JSON.stringify(st().project) === origin, 'két visszavonás: pontosan az eredeti', '');
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
/** 👤 ki van bejelentkezve ezen az eszközön (a kétkészülékes collab-próbához) */
export async function smokeWhoAmI(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const u = useAuth.getState().user;
  log(null, 'fiók', u ? `${u.email} (${u.id.slice(0, 8)}…)` : 'nincs bejelentkezve');
  log(null, 'megosztás (collab) engedélyezett', String(canUseCloud('collab')));
}
const COLLAB_PID = 'prj_smoke_collab_audio';
const trackDump = (p: Project | null) =>
  JSON.stringify((p?.tracks ?? []).filter((t) => t.clips.length > 0).map((t) => [t.type, t.clips.map((c) => { const { uri, ...rest } = c as AudioClip; return { ...rest, uri: uri.split('/').pop() }; })]));
// a tartalom ujjlenyomata: rendezett kulcsok, eszközfüggő uri nélkül (a felhőből letöltött projekt
// JSON-jában más a kulcsok sorrendje, és a társnál a média helyi fájlra mutat)
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'uri').sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
const fingerprint = (p: Project | null) => {
  const str = JSON.stringify(canon(p?.tracks ?? []));
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
/** 👥 T10 tulaj (iPad): megosztja és meghívja a társat, a Hang Stúdióban szerkeszt; méri az oda-vissza időt, a visszavonást és a végső egyezést. */
export async function smokeCollabOwner(log: Log) {
  const me = useAuth.getState().user;
  log(null, '[tulaj] fiók', me?.email ?? '—');
  if (!me) return;
  const base = createEmptyProject('smoke közös hang', '9:16', undefined, 'audio');
  const tone = toneWav('smoke_collab_tone.wav', 6);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'm', uri: tone, label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  const project: Project = { ...base, id: COLLAB_PID, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [ac({})] } : t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd', duration: 3 })] } : t)) };
  await saveProject(project);
  await ensureShared(project);
  const inv = await inviteMember({ ownerId: me.id, projectId: COLLAB_PID, projectName: project.name, email: 'h3nz3l@gmail.com', role: 'editor' }).catch((e: Error) => ({ status: `hiba: ${e.message}` }));
  log(null, '[tulaj] megosztva + meghívás', String(inv.status));
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  let peers: { name: string }[] = [];
  const tw = Date.now();
  for (let i = 0; i < 240 && peers.length === 0; i++) {
    await sleep(500);
    peers = useCollabLive.getState().participants;
  }
  log(peers.length > 0, '[tulaj] a társ belépett a hang-projekt élő szobájába (közvetlenül megnyitott Hang Stúdió)', `${peers.map((p) => p.name).join(', ') || '—'} (${((Date.now() - tw) / 1000).toFixed(1)} s várakozás)`);
  if (peers.length === 0) return;
  await sleep(2000);
  // E1 → a társ E2-vel válaszol (pan −0,5 a beszéden): oda-vissza idő
  const t1 = Date.now();
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.4 } });
  const v = () => st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  for (let i = 0; i < 300 && v().pan !== -0.5; i++) await sleep(50);
  const rtt = Date.now() - t1;
  log(v().pan === -0.5 && rtt <= 4000, '[tulaj] oda-vissza: a szerkesztésem a társnál, az övé nálam (≤ 4 s)', `${rtt} ms`);
  // E3: asszisztens-szerű köteg (egy undo) → a társ látja; utána visszavonom → a társnál is vissza
  st().applyBatch([{ type: 'UPDATE_CLIP', clipId: 'v', patch: { audioFx: { reverb: 0.4 } } }, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 }], 'ai');
  await sleep(3000);
  st().undo();
  await sleep(4000);
  log(null, '[tulaj] ujjlenyomat a végén', fingerprint(st().project));
  await sleep(4000);
  router.back();
}
/** 👥 T10 tag (iPhone): elfogadja a meghívást, megnyitja a hang-projektet; válaszol a tulaj szerkesztésére, figyeli a köteget és a visszavonást. */
export async function smokeCollabMember(log: Log) {
  const me = useAuth.getState().user;
  log(null, '[tag] fiók', me?.email ?? '—');
  if (!me || !supabase) return;
  let owner: string | null = null;
  for (let i = 0; i < 240 && !owner; i++) {
    const { data } = await supabase.from('project_members').select('owner_id,status').eq('project_id', COLLAB_PID).eq('member_id', me.id).maybeSingle();
    if (data?.owner_id) {
      owner = data.owner_id as string;
      if (data.status === 'invited') await respondToInvite(owner, COLLAB_PID, true);
    } else await sleep(500);
  }
  if (!owner) {
    log(false, '[tag] meghívás', 'nem érkezett');
    return;
  }
  const pulled = await pullSharedProject(owner, COLLAB_PID);
  if (!pulled) {
    log(false, '[tag] a megosztott projekt letöltése', 'null');
    return;
  }
  await saveProject(pulled);
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  const m = () => st().project?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip | undefined;
  const v = () => st().project?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip | undefined;
  for (let i = 0; i < 1200 && m()?.volume !== 0.4; i++) await sleep(100);
  log(m()?.volume === 0.4, '[tag] a tulaj szerkesztése megérkezett (zene 0,4)', '');
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'v', patch: { pan: -0.5 } });
  for (let i = 0; i < 200 && v()?.audioFx?.reverb !== 0.4; i++) await sleep(50);
  const gotBatch = v()?.audioFx?.reverb === 0.4 && st().project?.trackMix?.music?.gain === 0.5;
  log(gotBatch, '[tag] a tulaj köteg-szerkesztése (zengés + sáv-hangerő) megérkezett', '');
  for (let i = 0; i < 200 && v()?.audioFx?.reverb === 0.4; i++) await sleep(50);
  log(!v()?.audioFx?.reverb && st().project?.trackMix?.music?.gain !== 0.5, '[tag] a tulaj visszavonása nálam is visszavonta', '');
  await sleep(2500);
  log(null, '[tag] ujjlenyomat a végén', fingerprint(st().project));
  await sleep(5000);
  router.back();
}
/** 🧹 a T10 tesztadatának törlése az app saját útján (tulaj: tagságok + felhős projekt + helyi; tag: helyi másolat) */
export async function smokeCollabCleanup(log: Log) {
  const me = useAuth.getState().user;
  if (!me || !supabase) {
    log(false, 'fiók', 'nincs');
    return;
  }
  const { data: rows } = await supabase.from('project_members').select('owner_id,member_id,role').eq('project_id', COLLAB_PID);
  const mine = (rows ?? []).filter((r) => r.owner_id === me.id);
  if (mine.length > 0) {
    for (const r of mine.filter((x) => x.member_id !== me.id)) await removeMember(me.id, COLLAB_PID, r.member_id as string);
    await removeMember(me.id, COLLAB_PID, me.id);
  }
  // a felhős példány (a saját sor) mindig — egy félbeszakadt takarítás után is
  const cloud = await deleteCloudProject(COLLAB_PID).catch((caught) => { logCaught('lib/imageSmoke.tsx:cleanup', caught); return false; });
  log(null, 'felhős példány törlése', String(cloud));
  await deleteProject(COLLAB_PID).catch((caught) => logCaught('lib/imageSmoke.tsx:cleanup', caught));
  const { data: left } = await supabase.from('project_members').select('member_id').eq('project_id', COLLAB_PID);
  log(mine.length === 0 || (left ?? []).length === 0, `${me.email}: a tesztprojekt tagságai és a helyi példány törölve`, `maradt tagság-sor (látható): ${(left ?? []).length}`);
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
/** 🔒 R2 tulaj (iPad): megosztja a hang-projektet, zárolja a zenét, majd felold; ellenőrzi, hogy a tag zene-szerkesztése csak feloldás után jön át. */
export async function smokeLockOwner(log: Log) {
  const me = useAuth.getState().user;
  if (!me) return;
  const base = createEmptyProject('smoke közös zár', '9:16', undefined, 'audio');
  const tone = toneWav('smoke_lock_tone.wav', 6);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'm', uri: tone, label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  const project: Project = { ...base, id: COLLAB_PID, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [ac({})] } : t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd', duration: 3 })] } : t)) };
  await saveProject(project);
  await ensureShared(project);
  await inviteMember({ ownerId: me.id, projectId: COLLAB_PID, projectName: project.name, email: 'h3nz3l@gmail.com', role: 'editor' }).catch((e: Error) => log(null, '[tulaj] meghívás', e.message));
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  for (let i = 0; i < 240 && useCollabLive.getState().participants.length === 0; i++) await sleep(500);
  log(useCollabLive.getState().participants.length > 0, '[tulaj] a társ a szobában', '');
  await sleep(2000);
  st().toggleTrackFlag('music', 'lock');
  log(null, '[tulaj] zene zárolva', '');
  const m = () => st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
  const v = () => st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  for (let i = 0; i < 300 && v().pan !== -0.3; i++) await sleep(50);
  await sleep(1500);
  log(v().pan === -0.3 && m().volume === 1, '[tulaj] zárolt zene: a tag zene-szerkesztése NEM jött át, a beszéd-szerkesztése igen', `zene ${m().volume}, beszéd pan ${v().pan}`);
  st().toggleTrackFlag('music', 'lock');
  log(null, '[tulaj] zene feloldva', '');
  for (let i = 0; i < 300 && m().volume !== 0.25; i++) await sleep(50);
  log(m().volume === 0.25, '[tulaj] feloldás után a tag zene-szerkesztése átjött', `zene ${m().volume}`);
  await sleep(2500);
  log(null, '[tulaj] ujjlenyomat a végén', fingerprint(st().project));
  log(null, '[tulaj] sávok', trackDump(st().project));
  log(null, '[tulaj] a kapott távoli parancsok', st().events.filter((e) => e.actor === 'remote').map((e) => `${e.command.type}${'clipId' in e.command ? `:${(e.command as { clipId: string }).clipId}` : ''}`).join(', ') || '—');
  await sleep(4000);
  router.back();
}
/** 🔒 R2 tag (iPhone): a tulaj zárolása nála is zár; a zárolt sávra írás nem megy át, a többi igen; feloldás után a zene is. */
export async function smokeLockMember(log: Log) {
  const me = useAuth.getState().user;
  if (!me || !supabase) return;
  let owner: string | null = null;
  for (let i = 0; i < 240 && !owner; i++) {
    const { data } = await supabase.from('project_members').select('owner_id,status').eq('project_id', COLLAB_PID).eq('member_id', me.id).maybeSingle();
    if (data?.owner_id) {
      owner = data.owner_id as string;
      if (data.status === 'invited') await respondToInvite(owner, COLLAB_PID, true);
    } else await sleep(500);
  }
  if (!owner) {
    log(false, '[tag] meghívás', 'nem érkezett');
    return;
  }
  const pulled = await pullSharedProject(owner, COLLAB_PID);
  if (!pulled) return;
  await saveProject(pulled);
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  for (let i = 0; i < 1200 && !st().lockedTracks.includes('music'); i++) await sleep(100);
  log(st().lockedTracks.includes('music'), '[tag] a tulaj zárolása nálam is zár (zene)', st().lockedTracks.join(',') || '—');
  const okMusic = st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.25 } });
  const okPan = st().dispatch({ type: 'UPDATE_CLIP', clipId: 'v', patch: { pan: -0.3 } });
  log(null, '[tag] a beszéd pan helyben', `dispatch → ${okPan}, pan most ${(st().project?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip | undefined)?.pan}`);
  log(!okMusic, '[tag] a zárolt zenére írás nálam is no-op', `dispatch → ${okMusic}`);
  for (let i = 0; i < 600 && st().lockedTracks.includes('music'); i++) await sleep(100);
  log(!st().lockedTracks.includes('music'), '[tag] a feloldás nálam is felold', '');
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.25 } });
  await sleep(3000);
  log(null, '[tag] ujjlenyomat a végén', fingerprint(st().project));
  log(null, '[tag] sávok', trackDump(st().project));
  await sleep(4000);
  router.back();
}
/** 🔒 R2 egy eszközön (prod nélkül): a sáv-zár a projekt része — mentés + újratöltés után is zár, a zárolt sávra írás no-op. */
export async function smokeLockPersist(log: Log) {
  const id = 'prj_smoke_lockpersist';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:lockpersist', caught));
  const base = createEmptyProject('smoke zár mentése', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri: toneWav('smoke_lockp.wav', 4), label: 'zene', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(800);
  st().toggleTrackFlag('music', 'lock');
  const blocked = !st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } });
  log(st().project?.lockedTracks?.includes('music') === true && blocked, 'zárolás: a projektben (parancs-buszon), a zárolt sávra írás no-op', `lockedTracks ${JSON.stringify(st().project?.lockedTracks)}`);
  await saveProject(st().project!);
  router.back();
  await sleep(1200);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(800);
  log(st().lockedTracks.includes('music') && !st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } }), 'újranyitás után is zárolt (a mentett projektből)', st().lockedTracks.join(','));
  log(true, 'FOTÓZHATÓ', 'a zárolt zene-sáv (lakat) újranyitás után');
  await sleep(2500);
  st().toggleTrackFlag('music', 'lock');
  log(st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } }), 'feloldás után írható', '');
  router.back();
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
/** 🎵 R6 hang-poszt remixe: a poszt videójának hangja kinyerve → hang-projekt (a Hang Stúdióban nyílik), a forrás megjelölve. Prod nélkül: szintetikus poszt a teszt-szerver videójával. */
export async function smokeAudioRemix(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const post = { id: 'post_smoke_audio', title: 'Hang-poszt', description: '', hashtags: [], videoUri: `${smokeFileHost()}/vid_audio.mp4`, posterUri: null, aspectRatio: '9:16', durationSec: 6, projectId: 'orig_audio', rendered: true, remixable: true, sourceKind: 'audio', visibility: 'public', moderationStatus: 'approved', createdAt: new Date().toISOString(), counts: { likes: 0, comments: 0, shares: 0, saves: 0, views: 0, remixes: 0 }, creator: { id: 'c', username: 'kata', displayName: 'Kata' } } as unknown as FeedPost;
  const t0 = Date.now();
  const pid = await remixFromPost(post);
  const p = pid ? await loadProject(pid) : null;
  const clip = p?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip | undefined;
  log(!!p && p.kind === 'audio' && !!clip && clip.uri.endsWith('.m4a') && new File(clip.uri).exists && Math.abs(clip.duration - 6) <= 1 / 30 && p.remixOf?.postId === post.id, 'a hang-poszt remixe hang-projekt: a videó hangja M4A-ként, a forrás megjelölve', `${p?.kind}, ${clip?.duration.toFixed(3)} s, ${clip?.uri.split('/').pop()}, ${Date.now() - t0} ms`);
  if (!pid || !p) return;
  const route = remixRoute(post, pid);
  router.push(route as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== pid; i++) await sleep(200);
  await sleep(800);
  log(route === `/studio/audio/${pid}` && st().project?.id === pid, 'a Hang Stúdióban nyílik meg', route);
  log(true, 'FOTÓZHATÓ', 'a hang-remix a Hang Stúdióban');
  await sleep(2500);
  router.back();
  await deleteProject(pid).catch((caught) => logCaught('lib/imageSmoke.tsx:audioremix', caught));
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
