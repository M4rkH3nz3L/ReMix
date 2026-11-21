/** 🧪 Füstteszt — AI-zajszűrés és az AI-műveletek visszavonása. (Áthelyezve: phases05, phases06; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { encodeWav16, wavHeader16, pcm16 } from '@/lib/offlineMix';
import { measureDelay } from '@/lib/aiDenoise';
import { aiDenoiseFile } from '@/lib/aiDenoiseClient';
import { jsResampler, makeResampler, nativeResamplerAvailable } from '@/lib/nativeResampler';
import { devTypeAssistant } from '@/components/studio/audio/AudioAssistantBar';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject, deleteProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { smokeFileHost } from '../../helpers/env';
import { type Log, sleep } from '../../helpers/core';
import { Platform, Dimensions } from 'react-native';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { useProgressStore } from '@/store/progressStore';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { toneWav } from '../../helpers/audio';
import '@/lib/dspNativeClient';

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
/** ↩️🤖 AI-műveletek visszavonása + hiba utáni helyreállítás: minden AI-lépés EGY visszavonás (pontosan az eredeti), újra = az eredmény; a hang a végén mintára az eredeti; megszakítás, hiányzó fájl, zárolt sáv. */
export async function smokeAiUndo(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // beszéd: nagy dinamika, dübörgés, zaj (a mixjavaslatnak); a „hang” sávon csendek (a csendkeresésnek)
  const voice = Float32Array.from({ length: 13 * SR }, (_, i) => {
    const t = i / SR;
    const lvl = Math.floor(t / 1.3) % 2 === 0 ? 0.4 : 0.04;
    const v = t % 1.3 < 1 ? lvl * (0.6 * Math.sin(2 * Math.PI * 150 * t) + 0.3 * Math.sin(2 * Math.PI * 450 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    return v + 0.2 * Math.sin(2 * Math.PI * 35 * t) + 0.01 * rnd();
  });
  const talk: [number, number][] = [[0, 1.5], [3, 4.5], [5.2, 8]];
  const fxPcm = Float32Array.from({ length: 8 * SR }, (_, i) => {
    const t = i / SR;
    return talk.some(([a, b]) => t >= a && t < b) ? 0.3 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0.001 * rnd();
  });
  const write = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  const vUri = write('smoke_aiu_voice.wav', voice);
  const fUri = write('smoke_aiu_fx.wav', fxPcm);
  const mUri = toneWav('smoke_aiu_music.wav', 13);
  const id = 'prj_smoke_aiundo';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:aiundo', caught));
  const base = createEmptyProject('smoke AI-visszavonás', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', uri: vUri, start: 0, duration: 13, sourceDuration: 13, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    bpm: 120,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] }
        : t.type === 'music'
          ? { ...t, clips: [ac({ id: 'm', label: 'zene', uri: mUri, volume: 0.5 })] }
          : t.type === 'sfx'
            ? { ...t, clips: [ac({ id: 'f', label: 'hang', uri: fUri, duration: 8, sourceDuration: 8, volume: 0.5 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(p, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  const audioBefore = await render(st().project!, 'smoke_aiu_a.wav');
  const snap = () => JSON.stringify(st().project);
  const origin = snap();
  /** egy AI-művelet: változtat, EGY history-lépés, a visszavonás = előtte, az újra = utána; a végén visszavonva */
  const check = async (name: string, run: () => unknown) => {
    const b = snap();
    const d = st().past.length;
    const n = await run();
    await sleep(300);
    const a = snap();
    const steps = st().past.length - d;
    const actor = st().events.at(-1)?.actor;
    st().undo();
    const u = snap() === b;
    st().redo();
    const r = snap() === a;
    st().undo();
    await sleep(200);
    log(a !== b && steps === 1 && u && r, `${name}: egy lépés — a visszavonás pontosan az előtte, az újra pontosan az utána`, `${typeof n === 'number' ? `${n} parancs, ` : ''}${steps} lépés, szereplő ${actor}, vissza ${u ? '=' : '≠'}, újra ${r ? '=' : '≠'}`);
    return a !== b && steps === 1 && u && r;
  };

  // 1) hang-asszisztens: négy lépés egy mondatból
  runDevAction('audio.assistant');
  await sleep(400);
  devTypeAssistant('Tegyél zengést a beszédre, halkítsd a zenét 3 dB-lel, halkuljon a zene a beszéd alatt és masterelj Spotify-ra');
  await sleep(400);
  await check('hang-asszisztens (4 lépés)', () => runDevAction('assistant.apply'));
  devTypeAssistant('');

  // 2) mixjavaslat: mind; visszavonás után a javaslatok újra alkalmazhatók
  runDevAction('audio.mixAssist');
  let keys: string[] = [];
  for (let i = 0; i < 160 && keys.length === 0; i++) {
    await sleep(250);
    keys = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  }
  await check(`mixjavaslat — mind (${keys.join(', ')})`, () => runDevAction('mixAssist.applyAll'));
  await sleep(300);
  const reAppliedKeys = (runDevAction('mixAssist.appliedKeys') as string[]) ?? [];
  const again = runDevAction('mixAssist.applyAll') as number;
  log(keys.length > 0 && reAppliedKeys.length === 0 && again > 0, 'visszavonás után a javaslat nem marad „✓”, újra alkalmazható', `alkalmazottnak jelölt: ${reAppliedKeys.length}, újra: ${again} parancs`);
  st().undo();
  await sleep(300);

  // 3) mastering-segéd: alkalmazás + mérés; visszavonás után a mérés-eredmény sem látszik
  runDevAction('mixAssist.targetSpotify');
  await sleep(200);
  await check('mastering-segéd (Spotify)', () => runDevAction('mixAssist.applyMaster'));
  await sleep(400);
  log(runDevAction('mixAssist.verifiedShown') === false, 'visszavont master: a „cél elérve” mérés nem látszik tovább', '');

  // 4) megszakítás: az elemzés közben — a projekt változatlan, nem marad futó feladat, utána újra megy
  const b4 = snap();
  const pending = runDevAction('mixAssist.reanalyze') as Promise<unknown>;
  let cancelled = false;
  for (let i = 0; i < 100 && !cancelled; i++) {
    await sleep(20);
    const task = useProgressStore.getState().tasks.find((x) => x.cancel);
    if (task) {
      task.cancel!();
      cancelled = true;
    }
  }
  const res = await pending;
  await sleep(300);
  log(cancelled && res === null && snap() === b4 && useProgressStore.getState().tasks.length === 0, 'megszakított elemzés: a projekt változatlan, nem marad futó feladat', `megszakítva ${cancelled}, eredmény ${res === null ? 'nincs' : 'van'}, feladat ${useProgressStore.getState().tasks.length}`);
  const back = (await runDevAction('mixAssist.reanalyze')) as unknown;
  await sleep(400);
  log(!!back && ((runDevAction('mixAssist.suggestions') as string[]) ?? []).length > 0, 'a megszakítás után az elemzés újra fut', '');
  runDevAction('audio.mixAssistClose');
  await sleep(400);

  // 5) csendek kivágása a jóváhagyás után
  st().selectClip('f');
  const found = (await runDevAction('audio.silenceFind')) as number | null;
  await check(`csendek kivágása (${found} csend)`, () => runDevAction('audio.silenceApply'));

  // 6) ütemenkénti vágás
  st().selectClip('m');
  await check('vágás ütemenként', () => runDevAction('audio.beatSplitBars'));

  // a hang a lépések és visszavonások után mintára az eredeti (a forrásfájlokhoz semmi nem nyúlt)
  const audioAfter = await render(st().project!, 'smoke_aiu_b.wav');
  let maxD = 0;
  for (let i = 0; i < Math.min(audioBefore.length, audioAfter.length); i++) maxD = Math.max(maxD, Math.abs(audioBefore[i] - audioAfter[i]));
  log(snap() === origin && audioBefore.length === audioAfter.length && maxD === 0, 'minden visszavonva: a projekt és a hang mintára az eredeti', `max eltérés ${maxD}, ${audioAfter.length} minta`);

  // 7) hiányzó fájl: a csendkeresés és a beszédvágás nem indul, a projekt változatlan, nem marad futó feladat
  const gone: AudioClip = ac({ id: 'gone', label: 'hiányzó', uri: `${Paths.document.uri}smoke_aiu_missing.wav`, start: 9, duration: 3, sourceDuration: 3 });
  st().addClip('sfx', gone);
  st().selectClip('gone');
  const b7 = snap();
  const sil = await runDevAction('audio.silenceFind');
  const sp = await runDevAction('audio.speechStart');
  await sleep(300);
  log(sil === null && sp === null && snap() === b7 && useSilenceReview.getState().review === null && useProgressStore.getState().tasks.length === 0, 'hiányzó fájl: a csendkeresés és a beszédvágás hibát jelez, a projekt változatlan', `csend ${String(sil)}, beszéd ${String(sp)}`);
  runDevAction('audio.mixAssist');
  let fin: string[] = [];
  for (let i = 0; i < 240 && fin.length === 0; i++) {
    await sleep(250);
    fin = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  }
  await sleep(300);
  // a hiányzó klip kimarad, a többi sáv elemzése ugyanazt adja
  log(snap() === b7 && useProgressStore.getState().tasks.length === 0 && fin.slice().sort().join() === keys.slice().sort().join(), 'hiányzó fájl a mixjavaslatban: kimarad, a többi sáv javaslatai ugyanazok, a projekt változatlan', `javaslatok: ${fin.join(', ') || '—'}`);
  runDevAction('audio.mixAssistClose');
  st().undo();
  await sleep(300);

  // 8) zárolt sáv: az asszisztens nem írja (a többi lépés igen), egy visszavonás
  st().toggleTrackFlag('music', 'lock');
  const music0 = JSON.stringify(st().project!.tracks.find((t) => t.type === 'music'));
  devTypeAssistant('tegyél zengést a beszédre és halkuljon a zene a beszéd alatt');
  await sleep(400);
  const ok8 = await check('zárolt zene-sáv mellett az asszisztens', () => runDevAction('assistant.apply'));
  st().redo();
  const music1 = JSON.stringify(st().project!.tracks.find((t) => t.type === 'music'));
  const vfx = (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip).audioFx?.reverb;
  st().undo();
  log(ok8 && music0 === music1 && !!vfx, 'zárolt sáv: a zene érintetlen, a beszéd zengést kap', `zengés ${vfx}`);
  st().toggleTrackFlag('music', 'lock');
  devTypeAssistant('');
  log(snap() === origin, 'a próba végén a projekt pontosan az eredeti', '');
  await sleep(800);
  router.back();
}
