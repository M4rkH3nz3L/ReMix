/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import { Dimensions, Platform } from 'react-native';
import { listPostsByIds, remixFromPost } from '@/lib/feed';
import type { FeedPost } from '@/types/social';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { offlineMixPlan , encodeWav16, pcm16, wavHeader16 } from '@/lib/offlineMix';
import { exportOfflineWav, recentExportPower } from '@/lib/offlineMixClient';
import { readPowerState } from '@/lib/powerStateClient';
import { packFromProject } from '@/lib/soundPack';
import { ensureStemModel, separateOnDevice, stemKernels, stemOnDeviceSupported } from '@/lib/stemSeparationClient';
import { measureDelay } from '@/lib/aiDenoise';
import { aiDenoiseFile } from '@/lib/aiDenoiseClient';
import { jsResampler, makeResampler, nativeResamplerAvailable } from '@/lib/nativeResampler';
import { jsStemKernels, separateTwoStems } from '@/lib/stemSeparation';
import { getPayload, listShopItems, purchaseItem, storeSoundPack, syncOwnedSoundPacks } from '@/lib/shop';
import { useSoundPacks } from '@/store/soundPackStore';
import { previewEngine } from '@/lib/previewEngine';
import '@/lib/dspNativeClient';
import { useAuth } from '@/store/authStore';
import { devTypeAssistant } from '@/components/studio/audio/AudioAssistantBar';
import { catalogRuntime, modelFileUri, removeModel } from '@/lib/modelRegistryClient';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, longToneFile, sleep, smokeFileHost, toneWav } from './shared';

/** a próbabeszéd (a Mac fájlszerveréről) 44,1 kHz-en */
async function smokeSpeech(): Promise<Float32Array> {
  const sp = new File(Paths.document, 'smoke_stem_speech.wav');
  if (!sp.exists) await File.downloadFileAsync(`${smokeFileHost()}/speech_hu.wav`, sp);
  const api = (await loadAudioApi())!;
  return (await api.decodeAudioData(sp.uri, 44100)).getChannelData(0);
}
/**
 * 🔇 V8: AI-zajszűrés — valódi beszéd + zaj (fehér, 50 Hz-es búgás, „ventilátor”) → a klip műveletével: a jel/zaj
 * javul, a szünetekben a zaj lemegy, a kimenet időben a helyén (késés-kiegyenlítés), egy undo, visszaállítás,
 * újra-alkalmazás az eredetiből; 5 perces fájl sebessége (folyamatos feldolgozás).
 */
export async function smokeAiDenoise(log: Log) {
  const SR = 44100;
  {
    // ⚡ a natív átmintavételező = a JS (bitre), fel és le, változó darabolással
    let sd = 5;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const x = Float32Array.from({ length: 3 * SR }, () => rnd() * 0.5);
    let worst = 0;
    let lens = '';
    for (const [a, b] of [[44100, 48000], [48000, 44100]] as const) {
      const js = jsResampler(a, b, 1);
      const nat = makeResampler(a, b, 1);
      const take = (r: typeof js) => {
        const parts: Float32Array[] = [];
        for (let at = 0, k = 0; at < x.length; k++) {
          const n = [1000, 4410, 7, 30000][k % 4];
          parts.push(r.process([x.subarray(at, Math.min(x.length, at + n))])[0]);
          at += n;
        }
        parts.push(r.flush()[0]);
        const out = new Float32Array(parts.reduce((s2, p2) => s2 + p2.length, 0));
        let o = 0;
        for (const p2 of parts) {
          out.set(p2, o);
          o += p2.length;
        }
        return out;
      };
      const y1 = take(js);
      const y2 = take(nat);
      lens += `${y1.length}/${y2.length} `;
      if (y1.length !== y2.length) worst = Infinity;
      for (let i = 0; i < Math.min(y1.length, y2.length); i++) worst = Math.max(worst, Math.abs(y1[i] - y2[i]));
    }
    log(nativeResamplerAvailable() && worst === 0, 'a natív átmintavételező bitre = a JS (44,1 ↔ 48 kHz)', `max eltérés ${worst}, hosszak ${lens}`);
  }
  const speech = await smokeSpeech();
  const n = 20 * SR;
  const clean = new Float32Array(n);
  for (let i = 0; i < n; i++) clean[i] = speech[i % speech.length] * 0.8;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let fan = 0;
  const noise = Float32Array.from({ length: n }, (_, i) => {
    fan = fan * 0.995 + rnd() * 0.02;
    return 0.02 * rnd() + 0.04 * Math.sin((2 * Math.PI * 50 * i) / SR) + 0.5 * fan;
  });
  const noisy = Float32Array.from(clean, (x, i) => x + noise[i]);
  const f = new File(Paths.document, 'smoke_aidenoise_in.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([noisy, noisy], SR));
  const id = `prj_smoke_aidn_${Date.now().toString(36)}`;
  const base = createEmptyProject('smoke AI-zajszűrés', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'v', uri: f.uri, label: 'beszéd', start: 0, duration: 20, trimIn: 0, sourceDuration: 20, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [clip] } : t)) });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const undo0 = st().past?.length ?? 0;
    const r = (await runDevAction('aiDenoise.apply', { clipId: 'v', strength: 1 })) as { vad: number; ms: number } | null;
    const c1 = st().project?.tracks.flatMap((t) => t.clips).find((c) => c.id === 'v') as AudioClip | undefined;
    log(!!r && !!c1?.aiDenoise && c1.uri !== f.uri && c1.aiDenoise.sourceUri === f.uri && (st().past?.length ?? 0) - undo0 === 1, 'a klip a tisztított fájlra mutat, az eredeti megőrizve, egy undo', r ? `${r.ms} ms (20 s → ${(20000 / r.ms).toFixed(1)}× valós idő), VAD ${r.vad.toFixed(2)}` : 'nincs eredmény');
    if (!c1?.aiDenoise) return;
    const api = (await loadAudioApi())!;
    const out = (await api.decodeAudioData(c1.uri, SR)).getChannelData(0);
    const lag = measureDelay(clean.subarray(0, 5 * SR), out.subarray(0, 5 * SR + 4096), 4096);
    log(Math.abs(out.length - n) <= 1 && lag <= 2, 'a kimenet időben a helyén (késés-kiegyenlítés), a hossz pontos', `eltolás ${lag} minta, hossz ${out.length}/${n}`);
    let ce = 0;
    let ne = 0;
    let ee = 0;
    for (let i = 0; i < n; i++) {
      ce += clean[i] ** 2;
      ne += noise[i] ** 2;
      ee += (out[i] - clean[i]) ** 2;
    }
    const snrIn = 10 * Math.log10(ce / ne);
    const snrOut = 10 * Math.log10(ce / ee);
    log(snrOut > snrIn + 6, 'a jel/zaj viszony javul (≥ 6 dB)', `${snrIn.toFixed(1)} → ${snrOut.toFixed(1)} dB`);
    // a beszéd-szünetek (a tiszta jel 50 ms-os ablakban csendes) zaja
    const W = 2205;
    let pin = 0;
    let pout = 0;
    let cnt = 0;
    for (let a = 0; a + W < n; a += W) {
      let e = 0;
      for (let i = a; i < a + W; i++) e += clean[i] ** 2;
      if (e / W < 1e-6) {
        for (let i = a; i < a + W; i++) {
          pin += noisy[i] ** 2;
          pout += out[i] ** 2;
        }
        cnt++;
      }
    }
    log(cnt > 0 && 10 * Math.log10(pin / Math.max(pout, 1e-12)) > 15, 'a szünetekben a zaj ≥ 15 dB-lel lemegy', `${cnt} szünet-ablak, −${(10 * Math.log10(pin / Math.max(pout, 1e-12))).toFixed(1)} dB`);
    runDevAction('audio.resetAiDenoise', 'v');
    await sleep(200);
    const c2 = st().project?.tracks.flatMap((t) => t.clips).find((c) => c.id === 'v') as AudioClip | undefined;
    log(c2?.uri === f.uri && !c2.aiDenoise, 'visszaállítás: az eredeti fájl');
    const r2 = (await runDevAction('aiDenoise.apply', { clipId: 'v', strength: 0.5 })) as { ms: number } | null;
    const c3 = st().project?.tracks.flatMap((t) => t.clips).find((c) => c.id === 'v') as AudioClip | undefined;
    log(!!r2 && c3?.aiDenoise?.strength === 0.5 && c3.aiDenoise.sourceUri === f.uri, 'újra 50%-on — az eredetiből');
    // az asszisztens: „AI-zajszűrés a beszédre” → a beszéd klipje (az eredetiből, 100%), egy undo
    runDevAction('audio.resetAiDenoise', 'v');
    await sleep(200);
    const u0 = st().past?.length ?? 0;
    runDevAction('audio.assistant');
    await sleep(400);
    devTypeAssistant('AI-zajszűrés a beszédre');
    await sleep(400);
    runDevAction('assistant.apply');
    for (let i = 0; i < 100 && (st().past?.length ?? 0) === u0; i++) await sleep(200);
    const c4 = st().project?.tracks.flatMap((t) => t.clips).find((c) => c.id === 'v') as AudioClip | undefined;
    log(c4?.aiDenoise?.strength === 1 && c4.aiDenoise.sourceUri === f.uri && (st().past?.length ?? 0) - u0 === 1, 'asszisztens: „AI-zajszűrés a beszédre” — a beszéd klipjén, egy undo');
    devTypeAssistant('');
    // folyamatos feldolgozás: 5 perces fájl
    const long = new File(Paths.document, 'smoke_aidenoise_long.wav');
    if (long.exists) long.delete();
    long.create();
    const h = long.open();
    h.writeBytes(wavHeader16(300 * SR, 1, SR));
    for (let k = 0; k < 15; k++) h.writeBytes(pcm16([noisy]));
    h.close();
    const t0 = Date.now();
    const lr = await aiDenoiseFile(long.uri, 1);
    const ms = Date.now() - t0;
    log(!!lr && Math.abs(lr.durationSec - 300) < 0.01, '5 perces fájl folyamatosan (a memória a darabbal arányos)', `${(ms / 1000).toFixed(1)} s = ${(300 / (ms / 1000)).toFixed(1)}× valós idő · ${JSON.stringify(lr?.timings)}`);
    if (lr) new File(lr.uri).delete();
    long.delete();
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:aidenoise', caught));
  }
}
/**
 * 🥁 V8: AI-dob — a dobgépben (folytatás / variáció / új groove, a megtartott rész változatlan), a lejátszófejnél az
 * asszisztens („tegyél alá 2 ütem AI-dobot”): szerkeszthető dob-minta szabad sávon, egy undo.
 */
export async function smokeAiDrums(log: Log) {
  const id = `prj_smoke_aidr_${Date.now().toString(36)}`;
  await saveProject({ ...createEmptyProject('smoke AI-dob', '9:16', undefined, 'audio'), id, bpm: 100 });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    // a dobgépben
    runDevAction('audio.openDrums');
    await sleep(800);
    runDevAction('drums.demo');
    await sleep(200);
    const before = String(runDevAction('drums.hits'));
    const t0 = Date.now();
    const n1 = (await runDevAction('drums.ai', { mode: 'continue', temp: 'safe', seed: 3 })) as number;
    const ms = Date.now() - t0;
    await sleep(300);
    const after = String(runDevAction('drums.hits'));
    const firstBarSame = before.split(',').every((h) => after.split(',').includes(h));
    const second = after.split(',').filter((h) => Number(h.replace(/^[a-z]+/, '').split('v')[0]) >= 16);
    log(n1 > 0 && firstBarSame && second.length > 0, 'folytatás: az első ütem változatlan, a második a modellé', `${ms} ms, ${second.length} új ütés (pl. ${second.slice(0, 6).join(',')})`);
    const n2 = (await runDevAction('drums.ai', { mode: 'vary', temp: 'creative', seed: 5 })) as number;
    await sleep(300);
    const vary = String(runDevAction('drums.hits'));
    log(n2 > 0 && before.split(',').every((h) => vary.split(',').includes(h)), 'variáció: az első ütem marad');
    const n3 = (await runDevAction('drums.ai', { mode: 'groove', temp: 'bold', seed: 9 })) as number;
    await sleep(300);
    const groove = String(runDevAction('drums.hits'));
    log(n3 > 0 && groove.includes('kick0'), 'új groove: lábdobbal indul', groove.split(',').slice(0, 8).join(','));
    const undoBake = st().past?.length ?? 0;
    runDevAction('drums.bake');
    for (let i = 0; i < 40 && (st().past?.length ?? 0) === undoBake; i++) await sleep(200);
    log((st().past?.length ?? 0) - undoBake === 1, 'a „Sávra” egy undo-lépés');
    runDevAction('audio.closeDrums');
    await sleep(400);
    // az asszisztens: AI-dob a lejátszófejnél
    // a lejátszófej a projekt hosszán belül (az üres részre nem állítható) — a tényleges értékhez mérünk
    st().setPlayhead(2);
    const ph = st().playhead;
    const undo0 = st().past?.length ?? 0;
    runDevAction('audio.assistant');
    await sleep(400);
    devTypeAssistant('tegyél alá 2 ütem AI-dobot');
    await sleep(400);
    runDevAction('assistant.apply');
    for (let i = 0; i < 60 && (st().past?.length ?? 0) === undo0; i++) await sleep(200);
    const p = st().project!;
    const clip = p.tracks.flatMap((t) => t.clips.map((c) => ({ t, c: c as AudioClip }))).find((x) => Math.abs(x.c.start - ph) < 0.05 && x.c.label === 'AI-dob');
    const doc = clip ? p.instrumentDocs?.find((d) => d.id === clip.c.instrumentDocId) : undefined;
    log(!!doc?.drums && doc.bars === 2 && Math.abs((clip?.c.duration ?? 0) - 4.8) < 0.05 && (st().past?.length ?? 0) - undo0 === 1, 'asszisztens: 2 ütem AI-dob a lejátszófejnél (100 BPM = 4,8 s), szerkeszthető minta, egy undo', `${clip?.t.type} @ ${ph.toFixed(2)} s, ${clip?.c.duration.toFixed(2)} s, ${doc?.drums ? Object.values(doc.drums.pattern).reduce((s, r) => s + r.filter(Boolean).length, 0) : 0} ütés`);
    devTypeAssistant('');
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:aidrums', caught));
  }
}
/**
 * 🎚️ V5: a felhasználói út — a modell a VALÓDI R2-címről (a helyi példány törölve), a stúdió-művelet a klipből két
 * új sávot csinál (ének, kíséret) a klip vágásával, az eredeti elnémul; egy undo.
 */
export async function smokeStemsUi(log: Log) {
  const SR = 44100;
  // a modell a katalógusból: előbb törölve → a művelet tölti le (sha256) és ellenőrzi
  removeModel('spleeter-2stems');
  const sp = new File(Paths.document, 'smoke_stem_speech.wav');
  if (!sp.exists) await File.downloadFileAsync(`${smokeFileHost()}/speech_hu.wav`, sp);
  const api = (await loadAudioApi())!;
  const speech = (await api.decodeAudioData(sp.uri, SR)).getChannelData(0);
  const n = 30 * SR;
  const mix = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    mix[i] = speech[i % speech.length] + 0.08 * Math.sign(Math.sin(2 * Math.PI * 110 * tt)) + 0.3 * Math.exp(-((tt % 0.5) * 30)) * Math.sin(2 * Math.PI * 55 * tt);
  }
  const f = new File(Paths.document, 'smoke_stemsui_mix.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([mix, mix], SR));
  const id = `prj_smoke_stemsui_${Date.now().toString(36)}`;
  const base = createEmptyProject('smoke stem', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'mix', uri: f.uri, label: 'dal', start: 1, duration: 20, trimIn: 5, sourceDuration: 30, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const undo0 = st().past?.length ?? 0;
    const t0 = Date.now();
    const ids = (await runDevAction('stems.onDevice', 'mix')) as string[] | null;
    const ms = Date.now() - t0;
    log(modelFileUri('spleeter-2stems') !== null && catalogRuntime().smoke?.['spleeter-2stems'] === 'pass', 'a modell a katalógusból letöltve (sha256) és ellenőrizve', `${ms} ms összesen (letöltés + ellenőrzés + szétválasztás)`);
    const p = st().project!;
    const added = p.tracks.flatMap((t) => t.clips.map((c) => ({ t, c: c as AudioClip }))).filter((x) => ids?.includes(x.c.id));
    log(added.length === 2 && added.every((x) => x.t.type.startsWith('aux') && x.c.start === 1 && x.c.trimIn === 5 && x.c.duration === 20), 'két új sáv (ének, kíséret) a klip vágásával', added.map((x) => `${x.t.type}:${x.t.name}`).join(', '));
    const orig = p.tracks.flatMap((t) => t.clips).find((c) => c.id === 'mix') as AudioClip | undefined;
    log(orig?.volume === 0 && (st().past?.length ?? 0) - undo0 === 1, 'az eredeti néma, egy undo-lépés');
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:stemsui', caught));
  }
}
/**
 * 🎚️ V5 (prototípus) mérés: Spleeter 2stems Core ML-lel a telefonon — a modell a Mac fájlszerveréről, a keverék
 * valódi beszéd (ének helyett) + szintetikus kíséret (akkord + lábdob), 3 / 5 / 10 perc; idő, modell-idő, az ének
 * SDR-je az első 60 s-on (a keverékhez képest), a hőállapot.
 */
export async function smokeStemDevice(log: Log) {
  log(null, 'eszköz', `${Device.modelName ?? Platform.OS}`);
  log(stemOnDeviceSupported(), 'a build tartalmazza a stem-modult');
  {
    // natív (vDSP) jelút = JS jelút (azonos „modellel”), 20 s sztereó
    const n = 20 * 44100;
    const l = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i * 0.031) + 0.1 * Math.sin(i * 0.23));
    const r = Float32Array.from({ length: n }, (_, i) => 0.25 * Math.sin(i * 0.017 + 1));
    const fake = async (mag: Float32Array): Promise<[Float32Array, Float32Array]> => [mag, Float32Array.from(mag, (x, i) => x * ((i % 7) / 7))];
    const t1 = Date.now();
    const js = await separateTwoStems(l, r, fake, undefined, jsStemKernels);
    const jsMs = Date.now() - t1;
    const t2 = Date.now();
    const nat = await separateTwoStems(l, r, fake, undefined, stemKernels());
    const natMs = Date.now() - t2;
    let worst = 0;
    for (const [x, y] of [[js.vocals[0], nat.vocals[0]], [js.vocals[1], nat.vocals[1]], [js.accompaniment[0], nat.accompaniment[0]], [js.accompaniment[1], nat.accompaniment[1]]] as const) {
      for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]));
    }
    log(stemKernels() !== jsStemKernels && worst < 1e-4, 'a natív jelút = a JS jelút (20 s)', `max eltérés ${worst.toExponential(1)} · JS ${jsMs} ms, natív ${natMs} ms`);
  }
  const t0 = Date.now();
  const ok = await ensureStemModel();
  log(ok, 'a modell letöltve és betöltve (Core ML)', `${Date.now() - t0} ms`);
  if (!ok) return;
  const SR = 44100;
  const sp = new File(Paths.document, 'smoke_stem_speech.wav');
  if (!sp.exists) await File.downloadFileAsync(`${smokeFileHost()}/speech_hu.wav`, sp);
  const api = (await loadAudioApi())!;
  const speech = (await api.decodeAudioData(sp.uri, SR)).getChannelData(0);
  for (const min of [3, 5, 10]) {
    const n = min * 60 * SR;
    const voc = new Float32Array(n);
    for (let i = 0; i < n; i++) voc[i] = speech[i % speech.length];
    const acc = new Float32Array(n);
    const fr = [110, 138.6, 164.8, 220];
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      let v = 0;
      for (let k = 0; k < 4; k++) v += 0.08 * Math.sign(Math.sin(2 * Math.PI * fr[k] * tt + k));
      v += 0.3 * Math.exp(-((tt % 0.5) * 30)) * Math.sin(2 * Math.PI * 55 * tt);
      acc[i] = v;
    }
    const mixL = Float32Array.from(voc, (x, i) => x + acc[i]);
    const f = new File(Paths.document, `smoke_stem_mix_${min}.wav`);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([mixL, mixL], SR));
    const p0 = await readPowerState();
    const res = await separateOnDevice(f.uri);
    const p1 = await readPowerState();
    f.delete();
    if (!res) {
      log(false, `${min} perc: szétválasztás`, 'nem sikerült');
      continue;
    }
    const est = (await api.decodeAudioData(res.vocalsUri, SR)).getChannelData(0);
    const m = Math.min(60 * SR, est.length);
    let num = 0;
    let den = 0;
    let den0 = 0;
    for (let i = 0; i < m; i++) {
      num += voc[i] * voc[i];
      den += (voc[i] - est[i]) ** 2;
      den0 += acc[i] * acc[i];
    }
    const sdr = 10 * Math.log10(num / den);
    const sdr0 = 10 * Math.log10(num / den0);
    const tm = res.timings;
    log(sdr > sdr0 + 5, `${min} perc: az ének elválik (SDR ${sdr.toFixed(1)} dB, a keverék ${sdr0.toFixed(1)} dB)`, `${(tm.totalMs / 1000).toFixed(1)} s összesen = ${((min * 60) / (tm.totalMs / 1000)).toFixed(1)}× valós idő · modell ${(tm.modelMs / 1000).toFixed(1)} s (${tm.blocks} blokk, ${Math.round(tm.modelMs / tm.blocks)} ms/blokk) · hő ${p0?.thermal}→${p1?.thermal}`);
    new File(res.vocalsUri).delete();
    new File(res.accompanimentUri).delete();
  }
}
/**
 * 🎵 V8: dúdolásból dallam — szintetikus „dúdolás” (felharmonikusok, vibrátó, kis szünetek: C4 E4 G4 C5, 120 BPM,
 * negyedenként) egy klipben a 2. mp-nél → a telefon hangjegyekre bontja: szinti-minta a dúdolás kezdeténél,
 * szabad sávon, a hangok és a rács pontosak; egy undo.
 */
export async function smokeHumMelody(log: Log) {
  const SR = 44100;
  const midis = [60, 64, 67, 72];
  const len = 2.2 * SR;
  const x = new Float32Array(len);
  // a vibrátós frekvencia FÁZISA összegezve (a sin(2π·f(t)·t) alak az idővel növekvő hamis eltolást adna)
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const tSec = i / SR;
    const k = Math.floor(tSec / 0.5);
    const inNote = tSec - k * 0.5;
    const f = 440 * Math.pow(2, (midis[Math.min(k, midis.length - 1)] - 69) / 12) * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * tSec));
    ph += (2 * Math.PI * f) / SR;
    if (k >= midis.length || inNote > 0.44) continue;
    const env = Math.min(1, inNote / 0.02, (0.44 - inNote) / 0.02);
    x[i] = env * 0.25 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph));
  }
  const f = new File(Paths.document, 'smoke_hum.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = `prj_smoke_hum_${Date.now().toString(36)}`;
  const base = createEmptyProject('smoke dúdolás', '9:16', undefined, 'audio');
  const hum: AudioClip = { kind: 'audio', id: 'hum', uri: f.uri, label: 'dúdolás', start: 2, duration: 2.2, trimIn: 0, sourceDuration: 2.2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [hum] } : t)) });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const undoBefore = st().past?.length ?? 0;
    const t0 = Date.now();
    const cid = (await runDevAction('hum.melody', { clipId: 'hum', root: 0, minor: false })) as string | null;
    const ms = Date.now() - t0;
    const p = st().project!;
    const tr = p.tracks.find((t) => t.clips.some((c) => c.id === cid));
    const c = tr?.clips.find((x2) => x2.id === cid) as AudioClip | undefined;
    const doc = c ? p.instrumentDocs?.find((d) => d.id === c.instrumentDocId) : undefined;
    const notes = doc?.synth?.notes ?? [];
    log(!!c && Math.abs(c.start - 2) < 0.02 && tr?.type === 'music', 'a dallam a dúdolás kezdeténél, a szabad zene-sávon', `${tr?.type}, ${c?.start.toFixed(2)} s, ${ms} ms`);
    log(notes.map((n) => n.midi).join(',') === midis.join(',') && notes.map((n) => n.startBeat).join(',') === '0,1,2,3', 'a hangok és a rács pontosak (C4 E4 G4 C5, negyedenként)', notes.map((n) => `${n.midi}@${n.startBeat}/${n.lengthBeats}`).join(' '));
    log((st().past?.length ?? 0) - undoBefore === 1, 'egy undo-lépés');
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:hum', caught));
  }
}
/**
 * 🔀 C3 e2e a VALÓDI feeden (prod — engedéllyel, 2026-11-15): egy teszt-alkotó nem listázott hang-posztja
 * sáv-leírással (a Mac-ről, azonosító a fájlszerveren); az iPad a valódi úton olvassa (RLS, ellenőrző) és
 * remixeli: a fájl az R2-ről letöltve, a remix szerkeszthető sávokkal.
 */
export async function smokeRemixTracksProd(log: Log) {
  const postId = (await (await fetch(`${smokeFileHost()}/c3post.txt`)).text()).trim();
  const [post] = await listPostsByIds([postId]);
  log(!!post && post.sourceKind === 'audio' && !!post.remixTracks, 'a poszt a feedről: hang-poszt, ellenőrzött sáv-leírással', post ? `${post.remixTracks?.tracks.length ?? 0} sáv` : `nincs (${postId.slice(0, 8)})`);
  if (!post) return;
  const id = await remixFromPost(post);
  const p = id ? await loadProject(id) : null;
  const clips = (p?.tracks ?? []).flatMap((t) => t.clips as AudioClip[]);
  const ok = clips.length === 2 && clips.every((c) => c.uri.startsWith('file://') && (new File(c.uri).size ?? 0) > 1000);
  log(!!p && p.bpm === 92 && ok && p.remixOf?.postId === post.id, 'a remix az R2-ről letöltött sávokkal, tempóval, eredettel', `${clips.length} klip, ${p?.bpm} BPM, ${clips.map((c) => new File(c.uri).size).join('/')} bájt`);
  if (id) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:remixtracksprod', caught));
}
/**
 * 🔀 C3: a hang-poszt remixe a sávokkal — a sáv-leírású poszt (a Mac fájlszerverén lévő hangokkal, a prod
 * nélkül) az app `remixFromPost`-ján át: a fájlok letöltve, a sávok és a tempó megvannak, a klipek helyiek.
 */
export async function smokeRemixTracks(log: Log) {
  const host = smokeFileHost();
  const clipOf = (id: string, file: string, start: number): AudioClip => ({ kind: 'audio', id, uri: `${host}/${file}`, label: file, start, duration: 2, trimIn: 0, sourceDuration: 2, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported' });
  const post = {
    id: `smoke_rt_${Date.now().toString(36)}`,
    creator: { id: 'x', username: 'smoke', displayName: 'Smoke' },
    title: 'Sávos poszt',
    description: '',
    hashtags: [],
    videoUri: null,
    posterUri: null,
    aspectRatio: '9:16',
    durationSec: 4,
    rendered: false,
    sourceKind: 'audio',
    remixable: true,
    remixTracks: {
      v: 1,
      bpm: 104,
      tracks: [
        { id: 't1', type: 'voiceover', name: 'Ének', clips: [clipOf('a', 'speech_hu.wav', 0), clipOf('b', 'speech_hu.wav', 2)] },
        { id: 't2', type: 'aux1', name: 'Második hang', clips: [clipOf('c', 'speech_en.wav', 1)] },
      ],
      trackMix: { voiceover: { gain: -2 } },
    },
  } as unknown as FeedPost;
  const id = await remixFromPost(post);
  const p = id ? await loadProject(id) : null;
  const clips = (p?.tracks ?? []).flatMap((t) => t.clips.map((c) => ({ t: t.type, c: c as AudioClip })));
  log(!!p && p.kind === 'audio' && p.bpm === 104 && p.remixOf?.postId === post.id, 'a remix hang-projekt, a poszt tempójával és eredetével', p ? `${p.kind}, ${p.bpm} BPM` : 'nincs projekt');
  log(clips.length === 3 && clips.filter((x) => x.t === 'voiceover').length === 2 && clips.some((x) => x.t === 'aux1'), 'a sávok és a klipek megvannak (2 + 1)', clips.map((x) => `${x.t}:${x.c.start}`).join(', '));
  const localOk = clips.every((x) => x.c.uri.startsWith('file://') && new File(x.c.uri).exists);
  const shared = new Set(clips.filter((x) => x.t === 'voiceover').map((x) => x.c.assetId)).size === 1;
  log(localOk && shared && p?.trackMix?.voiceover?.gain === -2, 'a klipek helyi fájlokra mutatnak (közös fájl → közös asset), a keverés átjött', `${clips.map((x) => (x.c.uri.split('/').pop() ?? '').slice(0, 24)).join(', ')}`);
  if (id) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:remixtracks', caught));
}
/**
 * 🛍️ V4 e2e a VALÓDI Shopon (prod adatbázis — engedéllyel, 2026-11-15): a „SMOKE V4 hangcsomag” ingyenes
 * tételt egy teszt-eladó teszi ki (a Mac-ről); a bejelentkezett felhasználó az app kódján át megveszi
 * (RPC), a tartalom RLS-sel olvasható, a csomag a tárba kerül, „új eszközön” a fiókból visszajön, és a
 * loopja a stúdióban szól. Ingyenes tétel → nincs Coin-mozgás.
 */
export async function smokeShopPack(log: Log) {
  const me = useAuth.getState().user;
  log(!!me, 'bejelentkezett vevő', me ? `${me.email?.slice(0, 2)}…` : 'nincs bejelentkezve');
  if (!me) return;
  const item = (await listShopItems({ kind: 'soundpack' })).find((i) => i.title === 'SMOKE V4 hangcsomag');
  log(!!item && item.sellerId !== me.id && item.priceCents === 0, 'a teszt-hangcsomag a piacon (más eladótól, ingyen)', item ? `${item.id.slice(0, 8)}, ${item.priceCents} cent` : 'nincs');
  if (!item) return;
  let payload: unknown = null;
  try {
    payload = await purchaseItem(item.id);
  } catch (e) {
    // a korábbi futás már megvette (egyedi vásárlás) → a tartalom a payload-táblából
    log(null, 'vásárlás', e instanceof Error ? e.message : String(e));
    payload = await getPayload(item.id);
  }
  log(storeSoundPack(item.id, payload), 'a megvett tartalom ellenőrizve, a csomag a telefonon', `${(payload as { loops?: unknown[] } | null)?.loops?.length ?? 0} loop`);
  log((await getPayload(item.id)) !== null, 'a tartalom a vevőnek olvasható (RLS)');
  // „új eszköz”: a helyi tárból törölve, a fiókból visszajön
  useSoundPacks.getState().removePack(item.id);
  const added = await syncOwnedSoundPacks();
  log(added >= 1 && useSoundPacks.getState().packs.some((p) => p.itemId === item.id), 'új eszközön a fiókból visszaszinkronizálva', `${added} csomag`);
  const st = useEditorStore.getState;
  const id = `prj_smoke_shoppack_${Date.now().toString(36)}`;
  await saveProject({ ...createEmptyProject('smoke shop-csomag', '9:16', undefined, 'audio'), id });
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const c = await runDevAction('loops.place', `pack_${item.id}_pk0`);
    const placed = st().project?.tracks.flatMap((tr) => tr.clips).find((x): x is AudioClip => x.id === c && x.kind === 'audio');
    const doc = placed ? st().project?.instrumentDocs?.find((d) => d.id === placed.instrumentDocId) : undefined;
    log(placed?.label === 'Smoke dob' && doc?.kind === 'drums' && doc.drums?.pattern.kick.filter(Boolean).length === 12, 'a megvett loop a stúdióban: dob-minta 4 ütemre (3 lábdob × 4)', `${placed?.label}, ${doc?.drums?.pattern.kick.filter(Boolean).length} lábdob`);
    router.back();
    await sleep(500);
  } finally {
    useSoundPacks.getState().removePack(item.id);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:shoppack', caught));
  }
}
/**
 * 🛍️ V4: hangcsomag — beépített loopokból hangszer-mintás projekt → csomag → (JSON, a vevői ellenőrzőn át) a
 * telefonos tárba → a loop-könyvtárból visszahelyezve ugyanaz a minta, a csomag-loop nevével; offline,
 * a Shop (prod adatbázis) nélkül.
 */
export async function smokeSoundPack(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const id = `prj_smoke_pack_${Date.now().toString(36)}`;
  const itemId = `smoke_${Date.now().toString(36)}`;
  await saveProject({ ...createEmptyProject('smoke csomag', '9:16', undefined, 'audio'), id });
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const a = await runDevAction('loops.place', 'house');
    st().setPlayhead(10);
    const b = await runDevAction('loops.place', 'bassWalk');
    const src = st().project!;
    log(typeof a === 'string' && typeof b === 'string' && (src.instrumentDocs?.length ?? 0) >= 2, 'a forrás-projektben két hangszer-minta (dob + basszus)', `${a}, ${b}, ${src.instrumentDocs?.length} minta`);
    const pack = packFromProject(src, 'Smoke csomag');
    log(pack?.loops.length === 2 && pack.loops[0].category === 'drums' && pack.loops[1].category === 'bass', 'a projektből csomag: dob + basszus loop', pack?.loops.map((l) => `${l.name}/${l.category}`).join(', '));
    // a vevő oldala: a payload JSON-ként jön, az ellenőrzőn át kerül a tárba
    const stored = storeSoundPack(itemId, JSON.parse(JSON.stringify(pack)));
    log(stored && useSoundPacks.getState().packs.some((p) => p.itemId === itemId), 'a megvett csomag a telefonos tárban');
    const drumId = `pack_${itemId}_pk0`;
    st().setPlayhead(20);
    const c = await runDevAction('loops.place', drumId);
    const p2 = st().project!;
    const placed = p2.tracks.flatMap((tr) => tr.clips).find((x): x is AudioClip => x.id === c && x.kind === 'audio');
    const doc = placed ? p2.instrumentDocs?.find((d) => d.id === placed.instrumentDocId) : undefined;
    const orig = src.instrumentDocs?.find((d) => d.kind === 'drums');
    const same = !!doc?.drums && !!orig?.drums && JSON.stringify(doc.drums.pattern) === JSON.stringify(orig.drums.pattern);
    log(!!placed && placed.label === pack?.loops[0].name && same, 'a csomag-loop visszahelyezve: a minta azonos, a felirat a csomagé', `${placed?.label}, minta ${same ? 'azonos' : 'ELTÉR'}`);
    router.back();
    await sleep(500);
  } finally {
    useSoundPacks.getState().removePack(itemId);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:soundpack', caught));
  }
}
/** 🎛️ V10 fotózható állapot: Zene mód, a „Több” nyitva, a módválasztó nyitva — 25 s-ig áll */
export async function smokeModeShot(log: Log) {
  const st = useEditorStore.getState;
  const id = `prj_smoke_modeshot_${Date.now().toString(36)}`;
  const base = createEmptyProject('Mód-teszt', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    runDevAction('audio.setStudioMode', 'music');
    await sleep(300);
    runDevAction('audio.toggleMore');
    runDevAction('audio.toggleModePicker');
    log(true, 'FOTÓZHATÓ', 'Zene mód, „Több” és módválasztó nyitva');
    await sleep(25_000);
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:modeshot', caught));
  }
}
/**
 * 🎛️ V10: az Audio Stúdió módjai — Gyors · Keverés · Zene · AI. Az új hang-projekt Gyors módban,
 * a zene-munkaterület Zene módban nyílik; a választás projektenként megmarad; az AI mód kinyitja
 * az asszisztenst; a „Több” a módon kívüli csoportokat mutatja.
 */
export async function smokeStudioModes(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  type Info = { mode: string; front: string[]; more: string[]; showMore: boolean; assistantOpen: boolean };
  const st = useEditorStore.getState;
  const info = () => runDevAction('audio.studioMode') as Info | undefined;
  const stamp = Date.now().toString(36);
  const ids = [`prj_smoke_modes_a_${stamp}`, `prj_smoke_modes_b_${stamp}`, `prj_smoke_modes_m_${stamp}`];
  const open = async (id: string, ws?: string) => {
    router.push(`/studio/audio/${id}${ws ? `?ws=${ws}` : ''}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || info() === undefined); i++) await sleep(200);
    await sleep(800);
  };
  const close = async () => {
    router.back();
    await sleep(800);
  };
  try {
    for (const id of ids) {
      const base = createEmptyProject(`smoke mód ${id.slice(-8)}`, '9:16', undefined, 'audio');
      await saveProject({ ...base, id });
    }
    await open(ids[0]);
    let i = info();
    log(i?.mode === 'quick' && i.front.join(',') === 'editModes,zoom,markers' && !i.showMore, 'új hang-projekt: Gyors mód, rövid transzport-sor', JSON.stringify(i));
    runDevAction('audio.toggleMore');
    await sleep(300);
    i = info();
    log(i?.showMore === true && i.more.includes('instruments') && i.more.includes('tempo'), 'a „Több” a módon kívüli csoportokat mutatja (hangszerek, tempó is)', i?.more.join(','));
    runDevAction('audio.setStudioMode', 'mix');
    await sleep(300);
    i = info();
    log(i?.mode === 'mix' && i.front[0] === 'ab' && !i.showMore, 'Keverés mód: A/B elöl, a „Több” becsukódik', JSON.stringify(i));
    await close();
    await open(ids[1]);
    log(info()?.mode === 'quick', 'a mód projektenként: a másik projekt Gyors maradt', info()?.mode);
    await close();
    await open(ids[0]);
    log(info()?.mode === 'mix', 'újranyitva az első projekt Keverés módban maradt', info()?.mode);
    runDevAction('audio.setStudioMode', 'ai');
    await sleep(500);
    i = info();
    log(i?.mode === 'ai' && i.front[0] === 'assistant' && i.assistantOpen, 'AI mód: az asszisztens elöl és nyitva', JSON.stringify(i));
    await close();
    await open(ids[2], 'music');
    i = info();
    log(i?.mode === 'music' && i.front[0] === 'instruments', 'zene-munkaterület: Zene mód, hangszerek elöl', JSON.stringify(i));
    await close();
  } finally {
    for (const id of ids) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:modes', caught));
  }
}
/**
 * 🌡️ S19: 30 perces, effektezett, két sávos telefonos export — a hőállapot és az akkumulátor
 * naplózva, súlyos hőnél a keverés pihen (lásd `thermalPolicy`). Hosszú (~percek) mérés.
 */
export async function smokeThermal(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const SEC = 30 * 60;
  const p0 = await readPowerState();
  log(p0 !== null, 'a build adja a hő- és akkumulátor-állapotot', JSON.stringify(p0));
  const src = longToneFile();
  const base = createEmptyProject('smoke hő', '9:16', undefined, 'audio');
  const voice: AudioClip = { kind: 'audio', id: 'TV', uri: src.uri, label: 'hang', start: 0, duration: SEC, trimIn: 0, sourceDuration: SEC, volume: 0.6, fadeIn: 0, fadeOut: 0, audioFx: { highpass: 80, eq: { low: 2, mid: -2, high: 3 }, compressor: true, reverb: 0.3 }, source: 'imported' };
  const music: AudioClip = { ...voice, id: 'TM', label: 'zene', volume: 0.3, pan: -0.3, audioFx: { lowpass: 9000, delay: 0.3, stereoWide: true } };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [voice] } : t.type === 'music' ? { ...t, clips: [music] } : t)) };
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_thermal_out.wav'));
  const ms = Date.now() - t0;
  const p1 = await readPowerState();
  const size = new File(out).size ?? 0;
  const want = 44 + SEC * SR * 4;
  log(Math.abs(size - want) <= 8, '30 perces export elkészült, a hossz pontos', `${(size / 1048576).toFixed(0)} MB, ${(ms / 1000).toFixed(1)} s = ${(SEC / (ms / 1000)).toFixed(1)}× valós idő`);
  const rec = recentExportPower()[recentExportPower().length - 1];
  log(rec !== undefined && rec.summary.samples >= Math.floor(ms / 4000), 'az export hőnaplót vett', rec ? `${rec.summary.samples} minta` : 'nincs');
  if (rec) {
    const s = rec.summary;
    log(null, 'hő', `max ${s.maxThermal}, súlyos ${(s.hotMs / 1000).toFixed(0)} s, pihenő ${(s.restMs / 1000).toFixed(1)} s`);
    log(null, 'akkumulátor', s.batteryDropPct === null ? `töltés közben / ismeretlen (${p0?.battery} → ${p1?.battery})` : `−${s.batteryDropPct} %-pont (${p0?.battery} → ${p1?.battery})`);
    // percenkénti idővonal (hőszint), hogy látszódjon a felmelegedés
    const line: string[] = [];
    for (const x of rec.samples) if (line.length === 0 || x.atMs >= line.length * 60_000) line.push(`${Math.round(x.atMs / 1000)}s:${x.thermal}`);
    log(null, 'hő-idővonal', line.join(' '));
    log(s.maxThermal < 2 || s.restMs > 0, 'súlyos hőnél a keverés pihent (vagy nem melegedett túl)');
  }
  new File(out).delete();
}
/** ✖️ Automatikus crossfade: átfedő klipek — a szint folytonos (telefonos export), X a sávon. */
export async function smokeCrossfade(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const uri = toneWav('smoke_xfade.wav', 8);
  const id = 'prj_smoke_crossfade';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:crossfade', caught));
  const base = createEmptyProject('smoke crossfade', '9:16', undefined, 'audio');
  // ugyanaz a hang folytatódik: a második klip forrása ott kezdődik, ahol az idővonalon belép
  const a: AudioClip = { kind: 'audio', id: 'xa', uri, label: 'A', start: 0, duration: 4, trimIn: 0, sourceDuration: 8, volume: 0.6, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const b: AudioClip = { ...a, id: 'xb', label: 'B', start: 3, duration: 4, trimIn: 3 };
  const project: Project = { ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [a, b] } : t)) };
  const plan = offlineMixPlan(project);
  log(Math.abs((plan.clips.find((c) => c.id === 'xa')?.fadeOut ?? 0) - 1) < 1e-6 && Math.abs((plan.clips.find((c) => c.id === 'xb')?.fadeIn ?? 0) - 1) < 1e-6, 'az 1 s-os átfedés crossfade lett (A ki, B be)');
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_xfade.wav'));
  const api = await loadAudioApi();
  const x = (await api!.decodeAudioData(out, SR)).getChannelData(0);
  const db = (from: number, to: number) => {
    let acc = 0;
    for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) acc += x[i] * x[i];
    return 10 * Math.log10(acc / ((to - from) * SR) + 1e-30);
  };
  const before = db(2.0, 2.8);
  const levels = [3.1, 3.4, 3.7].map((t) => db(t, t + 0.1) - before);
  const after = db(4.2, 5.0) - before;
  log(levels.every((d) => Math.abs(d) < 0.5) && Math.abs(after) < 0.5, 'a szint az átfedésen át folytonos (nincs lyuk, nincs dupla hangerő)', `${levels.map((d) => d.toFixed(2)).join(' / ')} dB, utána ${after.toFixed(2)} dB`);
  new File(out).delete();
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  useEditorStore.getState().setPlayhead(2);
  log(true, 'FOTÓZHATÓ', 'a crossfade X-e a zene sávon (3–4 s)');
  await sleep(4000);
  router.back();
}
/** 🅰️🅱️ A/B: lejátszás közben eredeti ↔ feldolgozott (zajszűrés + normalizálás) — gyors, akadás nélkül. */
export async function smokeAbCompare(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let a = 11;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const x = Float32Array.from({ length: 12 * SR }, (_, i) => (Math.floor(i / (SR / 2)) % 2 === 0 ? 0.05 * Math.sin((2 * Math.PI * 330 * i) / SR) : 0) + 0.005 * rnd());
  const src = new File(Paths.document, 'smoke_ab.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_ab';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:ab', caught));
  const base = createEmptyProject('smoke A/B', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'ab', uri: src.uri, label: 'beszéd', start: 0, duration: 12, trimIn: 0, sourceDuration: 12, volume: 1, fadeIn: 0, fadeOut: 0, audioFx: { denoise: true, normalize: true }, source: 'voiceover' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) });
  const st = useEditorStore.getState;
  st().setFxBypass(false);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  // az első terv a zajszűréssel (előmenet)
  for (let i = 0; i < 100 && previewEngine.lastPlanMs === 0; i++) await sleep(100);
  await sleep(6000);
  const first = previewEngine.lastPlanMs;
  log(null, 'első terv (zajszűrés + normalizálás)', `${first} ms`);
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(1500);
  st().setFxBypass(true);
  await sleep(1200);
  const toOriginal = previewEngine.lastPlanMs;
  st().setFxBypass(false);
  await sleep(1200);
  const back = previewEngine.lastPlanMs;
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(toOriginal < 300, 'A/B: az eredetire váltás gyors', `${toOriginal} ms`);
  log(back < 300, 'A/B: a visszaváltás nem számolja újra a zajszűrést', `${back} ms (az első ${first} ms volt)`);
  log(stats.late === 0 && stats.replaced > 0, 'a váltások lejátszás közben, akadás nélkül', `${stats.chunks} szelet, ${stats.late} késett, ${stats.replaced} cserélve`);
  router.back();
  src.delete();
}
/** 🔖 Markerek a Hang Stúdióban: a gomb a lejátszófejnél, undo, a közös projektben; képernyőkép. */
export async function smokeAudioMarkers(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_markers.wav', 12);
  const id = 'prj_smoke_markers';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:markers', caught));
  const base = createEmptyProject('smoke markerek', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'mk', uri, label: 'dal', start: 0, duration: 12, trimIn: 0, sourceDuration: 12, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().setPlayhead(2);
  runDevAction('audio.marker');
  await sleep(200);
  const m1 = st().project?.markers ?? [];
  log(m1.length === 1 && Math.abs(m1[0].time - 2) < 1e-6, 'a Marker gomb a lejátszófejnél jelöl', m1.map((m) => `${m.label}@${m.time}`).join(', '));
  st().undo();
  log((st().project?.markers ?? []).length === 0, 'a marker visszavonható (parancs-busz)');
  st().redo();
  st().setPlayhead(6);
  runDevAction('audio.marker');
  st().setPlayhead(9.5);
  runDevAction('audio.marker');
  // zenei szakasz-címke (ugyanaz, amit a hosszan nyomás menüje állít)
  const list = st().project?.markers ?? [];
  st().dispatch({ type: 'SET_MARKERS', markers: list.map((m, i) => (i === 1 ? { ...m, label: 'Refrén', color: '#f472b6' } : m)) });
  await sleep(300);
  log((st().project?.markers ?? []).length === 3, 'több marker, időrendben', (st().project?.markers ?? []).map((m) => `${m.label}@${m.time}`).join(', '));
  log(true, 'FOTÓZHATÓ', 'markerek a vonalzón (2 s, Refrén 6 s, 9,5 s)');
  await sleep(4000);
  router.back();
}
/** 🎛️ Effekt-automáció: aluláteresztő-söprés a telefonos exportban és a motorban (valós időben). */
export async function smokeFxAutomation(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let a = 21;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const noise = Float32Array.from({ length: 6 * SR }, () => 0.3 * rnd());
  const src = new File(Paths.document, 'smoke_sweep.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([noise, noise], SR, () => 0.5));
  const id = 'prj_smoke_sweep';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sweep', caught));
  const base = createEmptyProject('smoke söprés', '9:16', undefined, 'audio');
  const sweep = [{ time: 0, value: 20000, easing: 'linear' as const }, { time: 6, value: 300, easing: 'linear' as const }];
  const c: AudioClip = { kind: 'audio', id: 'sw', uri: src.uri, label: 'söprés', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 0.6, fadeIn: 0, fadeOut: 0, keyframes: { fxLowpass: sweep, fxReverb: [{ time: 0, value: 0, easing: 'linear' }, { time: 6, value: 1, easing: 'linear' }] }, source: 'imported' };
  const project: Project = { ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_sweep_out.wav'));
  const api = await loadAudioApi();
  const y = (await api!.decodeAudioData(out, SR)).getChannelData(0);
  const hf = (from: number, to: number) => {
    let e = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) e += (y[i] - y[i - 1]) ** 2;
    return 10 * Math.log10(e / ((to - from) * SR) + 1e-30);
  };
  const drop = hf(0.2, 0.7) - hf(5.2, 5.7);
  // az 5,2–5,7 s-os ablakban a söprés kb. 2 kHz-nél jár (300 Hz-et 6 s-nál éri el), és nő a zengés is
  log(drop > 15, 'telefonos export: a szűrő-söprés a magas tartományt elnyomja', `${drop.toFixed(1)} dB`);
  new File(out).delete();
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const st = useEditorStore.getState;
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(4000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.late === 0, 'a motor valós időben, akadás nélkül játssza (szűrő + zengés automáció)', `${stats.chunks} szelet, ${stats.late} késett`);
  router.back();
  src.delete();
}
