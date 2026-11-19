/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, getRecordingPermissionsAsync } from 'expo-audio';
import { Dimensions, Platform } from 'react-native';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache, probeAudioDuration } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { previewEngine } from '@/lib/previewEngine';
import { barsBeatsLabel } from '@/lib/audioTransport';
import { useProgressStore } from '@/store/progressStore';
import { useRecordPrefs } from '@/store/recordPrefsStore';
import '@/lib/dspNativeClient';
import { lastTakeAlign, setTakeAlignForTest } from '@/lib/recordTakeClient';
import { selectTakeCommand } from '@/lib/punchRecord';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { devTypeAssistant } from '@/components/studio/audio/AudioAssistantBar';
import { canSegment, LongSource } from '@/lib/longSource';
import { encodeWav16 } from '@/lib/offlineMix';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { clearWaveformMemory, getWaveform, lastWaveformMode, waveformCacheKey } from '@/lib/waveform';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep, smokeFileHost, toneWav } from './shared';

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
/** 📑 Másol / Beilleszt / Duplikál a Hang Stúdió eszköztárán (parancs-busz, undo). */
export async function smokeClipboard(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_clip.wav', 6);
  const id = 'prj_smoke_clipboard';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:clipboard', caught));
  const base = createEmptyProject('smoke vágólap', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'cb', uri, label: 'minta', start: 1, duration: 2, trimIn: 0, sourceDuration: 6, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'sfx' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const sfx = () => (st().project?.tracks.find((t) => t.type === 'sfx')?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('cb');
  runDevAction('audio.duplicate');
  await sleep(200);
  log(sfx().length === 2 && Math.abs(sfx()[1].start - 3) < 1e-6, 'Duplikál: a másolat közvetlenül utána (3 s)', sfx().map((x) => x.start).join(', '));
  log(st().clipClipboard === null, 'a duplikálás a vágólapot nem írja felül');
  st().undo();
  log(sfx().length === 1, 'a duplikálás visszavonható');
  st().selectClip('cb');
  runDevAction('audio.copy');
  // a lejátszófej a projekt hosszán belül (a store a végére korlátozza)
  st().setPlayhead(2.5);
  runDevAction('audio.paste');
  await sleep(200);
  log(sfx().length === 2 && Math.abs(sfx()[1].start - 2.5) < 0.05, 'Másol + Beilleszt: a lejátszófejnél, a kijelölt klip sávjára', sfx().map((x) => x.start.toFixed(2)).join(', '));
  runDevAction('audio.fit');
  log(true, 'FOTÓZHATÓ', 'az eszköztár: Másol · Beilleszt · Duplikál');
  await sleep(4000);
  router.back();
}
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
/** 🎧 Hosszú tömörített forrás szakaszosan (mp3 44,1/48 kHz, m4a 48 kHz): időzítés (eltolás) és pontosság a jel ismert értékéhez. */
export async function smokeLongCodec(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(canSegment(), 'a build szakaszosan dekódol (natív ablak)', `${Platform.OS}`);
  const SR = 44100;
  // a frekvencia 0,1 s-onként vált (200 + 37·(k mod 50) Hz): a mérőablakban az eltolás egyértelmű
  const value = (i: number) => 0.3 * Math.sin((2 * Math.PI * (200 + 37 * (Math.floor((i / SR) * 10) % 50)) * i) / SR);
  for (const name of ['hop_44k.mp3', 'hop_48k.mp3', 'hop_48k.m4a']) {
    const t0 = Date.now();
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `smoke_${name}`);
    if (!local) {
      log(false, `${name}: letöltés`, '-');
      continue;
    }
    const long = new LongSource(local);
    // a mérőablakok frekvencia-határon (20 s-onként vált) — a tiszta szinuszon a korreláció periodikus, ott az eltolás nem egyértelmű
    for (const [label, from] of [['1 s', 1.0], ['40 s (szakaszhatár)', 39.95], ['22. perc (1320 s)', 22 * 60 - 0.05]] as const) {
      const a = Math.round(from * SR);
      const n = 4410;
      const pad = 6000;
      const t1 = Date.now();
      await long.ensure(a - pad, a + n + pad);
      const w = long.read(a - pad, a + n + pad);
      const ms = Date.now() - t1;
      if (!w) {
        log(false, `${name} @ ${label}`, 'nincs adat');
        continue;
      }
      const x = w[0];
      // az eltolás: a legjobb egyezés a referenciával ±6000 mintán belül
      let bestLag = 0;
      let best = -Infinity;
      for (let lag = -pad; lag <= pad; lag++) {
        let c = 0;
        for (let i = 0; i < n; i += 2) c += x[pad + lag + i] * value(a + i);
        if (c > best) {
          best = c;
          bestLag = lag;
        }
      }
      let sig = 0;
      let err = 0;
      for (let i = 0; i < n; i++) {
        const r = value(a + i);
        sig += r * r;
        err += (x[pad + i] - r) * (x[pad + i] - r);
      }
      const snr = 10 * Math.log10(sig / Math.max(1e-20, err));
      let errB = 0;
      for (let i = 0; i < n; i++) errB += (x[pad + bestLag + i] - value(a + i)) ** 2;
      log(null, `${name} @ ${label}: a legjobb illesztés`, `eltolás ${bestLag}, SNR ott ${(10 * Math.log10(sig / Math.max(1e-20, errB))).toFixed(1)} dB`);
      log(Math.abs(bestLag) <= 1 && snr > 25, `${name} @ ${label}: a minták a helyükön`, `eltolás ${bestLag} minta, SNR ${snr.toFixed(1)} dB, ${ms} ms`);
    }
    log(long.loaded() <= 8, `${name}: a memóriában legfeljebb 8 szakasz`, `${long.loaded()} (letöltés+mérés ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
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
/** 〰️🎧 Hosszú forrás hullámformája szakaszosan: 30 perces mp3/m4a, percenként 0,25 s-os impulzus a 30. mp-nél — a csúcsok a helyükön a fájl végén is. */
export async function smokeLongWave(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const name of ['env_44k.mp3', 'env_48k.m4a']) {
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `smoke_${name}`);
    if (!local) {
      log(false, `${name}: letöltés`, '-');
      continue;
    }
    const f = new File(local);
    const cached = new File(Paths.cache, `${waveformCacheKey(local, f.size ?? 0, f.modificationTime ?? 0)}.json`);
    if (cached.exists) cached.delete();
    clearWaveformMemory();
    const t0 = Date.now();
    const w = await getWaveform(local, { userInitiated: true });
    const ms = Date.now() - t0;
    if (!w) {
      log(false, `${name}: hullámforma`, 'null');
      continue;
    }
    log(lastWaveformMode() === 'segmented' && Math.abs(w.peaks.length - 1800 * 64) <= 2, `${name}: szakaszosan számolva, 30 perc × 64 csúcs`, `${lastWaveformMode()}, ${w.peaks.length} csúcs, ${(ms / 1000).toFixed(1)} s`);
    // az impulzus a perc 30,00–30,25 mp-e = a 1920–1935. csúcs; a széleken ±1 csúcs (16 ms) tűrés
    const rows: string[] = [];
    let ok = true;
    for (const m of [1, 15, 29]) {
      const b = m * 3840 + 1920;
      const inside = w.peaks.slice(b + 1, b + 15);
      const before = w.peaks.slice(b - 6, b - 1);
      const after = w.peaks.slice(b + 17, b + 22);
      // a próbafájl szintjei: alap 0,1·0,707, impulzus 0,8·0,707 (az ffmpeg mono→sztereó −3 dB)
      const good = inside.every((x) => x >= 0.45) && before.every((x) => x <= 0.15) && after.every((x) => x <= 0.15);
      ok &&= good;
      rows.push(`${m}. perc: bent ${Math.min(...inside).toFixed(2)}–${Math.max(...inside).toFixed(2)}, előtte ≤ ${Math.max(...before).toFixed(2)}, utána ≤ ${Math.max(...after).toFixed(2)}`);
    }
    log(ok, `${name}: az impulzusok a helyükön (1., 15., 29. perc, ±16 ms)`, rows.join(' · '));
    const again = Date.now();
    clearWaveformMemory();
    const w2 = await getWaveform(local, { userInitiated: true });
    log(!!w2 && w2.peaks.length === w.peaks.length && Date.now() - again < 3000, `${name}: másodszor a lemez-cache-ből`, `${Date.now() - again} ms`);
  }
}
/** ⚡ T1 a valós menetben: a Hang Stúdió megnyitása (hidegen), majd export — a leghosszabb képkocka-szünet mindkettőben. */
export async function smokeExportGap(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // a forrás megmarad a futások között (a hullámforma lemez-cache-e a módosítás idejéhez kötött)
  const keep = new File(Paths.document, 'smoke_xgap_keep.wav');
  const uri = keep.exists ? keep.uri : toneWav('smoke_xgap_keep.wav', 60);
  const id = 'prj_smoke_xgap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:xgap', caught));
  const base = createEmptyProject('smoke export-akadás', '1:1', undefined, 'audio');
  const mk = (cid: string, start: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 40, trimIn: 0, sourceDuration: 60, volume: 0.5, fadeIn: 1, fadeOut: 1, source: 'imported' });
  const project: Project = { ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('a', 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('b', 10)] } : tr.type === 'voiceover' ? { ...tr, clips: [mk('c', 20)] } : tr)) };
  await saveProject(project);
  // a hullámforma a lemez-cache-ből jöjjön (mint egy már megnyitott projektnél) — az első futás
  // kiszámolja (és betölti a modult), ezért a mérés csak lemez-cache találatkor érvényes
  const wf = new File(Paths.cache, `${waveformCacheKey(uri, new File(uri).size ?? 0, new File(uri).modificationTime ?? 0)}.json`);
  const cold = wf.exists;
  if (!cold) await getWaveform(uri, { userInitiated: true });
  const watch = () => {
    let gap = 0;
    let at = 0;
    let last = Date.now();
    const t0 = last;
    let on = true;
    const tick = () => {
      const now = Date.now();
      if (now - last > gap) {
        gap = now - last;
        at = last - t0;
      }
      last = now;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      on = false;
      return { gap, at };
    };
  };
  // a megnyitás utáni 8 s: minden > 30 ms-os képkocka-szünet időbélyeggel
  const gaps: string[] = [];
  let lastF = Date.now();
  const tOpen = lastF;
  let onF = true;
  const tickF = () => {
    const now = Date.now();
    if (now - lastF > 30) gaps.push(`${now - lastF} ms @${lastF - tOpen}`);
    lastF = now;
    if (onF) requestAnimationFrame(tickF);
  };
  requestAnimationFrame(tickF);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(100);
  await sleep(8000);
  onF = false;
  log(null, 'megnyitás utáni 8 s (> 30 ms-os szünetek)', gaps.join(' · ') || '—');
  // ellenpróba: 3 s üresjárat (nincs képkocka-kérés) után munka NÉLKÜL indított figyelő
  await sleep(3000);
  const idle = watch();
  await sleep(300);
  const idleRes = idle();
  log(null, 'ellenpróba: munka nélkül, üresjárat után', `leghosszabb szünet ${idleRes.gap} ms @${idleRes.at} ms`);
  await sleep(3000);
  // a megnyitott stúdió már betöltötte a hang-modult (a lejátszó-motor) — az export nem fizeti meg
  const tl = Date.now();
  await loadAudioApi();
  log(cold ? Date.now() - tl < 10 : null, 'a hang-modul a megnyitott stúdióban már betöltve (az export nem tölti be hidegen)', `${Date.now() - tl} ms${cold ? '' : ' — első futás: a hullámforma számolása töltötte be, nem mérvadó'}`);
  const stopExport = watch();
  await sleep(80);
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_xgap.wav'));
  const ms = Date.now() - t0;
  const exp = stopExport();
  new File(out).delete();
  log(exp.gap <= 50, 'T1 export a megnyitott stúdióból: a felület nem akad (leghosszabb képkocka-szünet ≤ 50 ms)', `${exp.gap} ms @${exp.at} ms, export ${ms} ms`);
  router.back();
}
/** ⏸️🎙️ T2 felvétel szünettel: 1 s felvétel → 1 s szünet → 1 s felvétel = EGY klip (~2 s), a szintmérő él, a szünet nem zárja le. */
export async function smokeRecPause(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const id = 'prj_smoke_recpause';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:recpause', caught));
  const base = createEmptyProject('smoke felvétel-szünet', '9:16', undefined, 'audio');
  const bed: AudioClip = { kind: 'audio', id: 'bed', uri: toneWav('smoke_recpause_bed.wav', 8), label: 'alap', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [bed] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  st().setPlayhead(1);
  await sleep(200);
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const state = () => runDevAction('audio.recordState') as { active: boolean; recording: boolean; paused: boolean; metering?: number; hot: boolean; durationMillis: number };
  const pastBefore = st().past.length;
  await runDevAction('audio.recordToggle');
  const meters: number[] = [];
  for (let i = 0; i < 10; i++) {
    await sleep(100);
    const m = state().metering;
    if (typeof m === 'number') meters.push(m);
  }
  log(state().recording && meters.length > 0 && meters.some((m) => m > -160), 'felvétel közben a szintmérő él (dBFS)', `${meters.map((m) => m.toFixed(0)).join(' ')}`);
  const loud = meters.some((m) => m >= -3);
  log(state().hot === loud, `„túl hangos” jelzés pontosan a −3 dBFS fölötti szintnél (${loud ? 'itt bekapcsol' : 'itt nincs'})`, `jelzés ${state().hot}, legnagyobb ${Math.max(...meters).toFixed(1)} dBFS`);
  log(true, 'FOTÓZHATÓ', 'a felvételi sáv: szünet-gomb, idő, szintmérő');
  await sleep(2500);
  runDevAction('audio.recordPause');
  await sleep(200);
  const p0 = state();
  await sleep(1500);
  const p1 = state();
  log(p0.paused && !p0.recording && p0.active && Math.abs(p1.durationMillis - p0.durationMillis) < 150 && voice().length === 0, 'szünet: a take él (nem zárul le magától), az idő áll', `${p0.durationMillis} → ${p1.durationMillis} ms, klip ${voice().length}`);
  runDevAction('audio.recordPause');
  await sleep(1000);
  const recorded = state().durationMillis;
  await runDevAction('audio.recordToggle');
  await sleep(800);
  const v = voice();
  const c = v[0];
  const fileDur = c ? await probeAudioDuration(c.uri) : 0;
  // felvett idő: ~1,1 s (a mérő-minták) + 2,5 s (kép) a szünet előtt, ~1 s utána
  log(v.length === 1 && !!c && Math.abs(c.duration - recorded / 1000) < 0.25 && Math.abs(fileDur - c.duration) < 0.25, 'szünet után folytatva: EGY klip, a hossza a felvett idő (a szünet nélkül), a fájl is', `${v.length} klip, klip ${c?.duration.toFixed(2)} s, felvett ${(recorded / 1000).toFixed(2)} s, fájl ${fileDur.toFixed(2)} s`);
  log(!!c && c.start === 1 && !state().active, 'a klip a felvétel kezdeténél (1 s), a felvételi sáv eltűnt', `start ${c?.start}`);
  log(st().past.length === pastBefore + 1, 'egy history-lépés', `${st().past.length - pastBefore}`);
  st().undo();
  log(voice().length === 0, 'egy visszavonás: a klip vissza', '');
  router.back();
}
/**
 * ⏱️🎯 T3 count-in + punch-in. Mindkét take kétszer: (1) az áthallás-illesztéssel (az app a hallott
 * kattanásokhoz / zenéhez igazít és kalibrál), (2) KIKAPCSOLT illesztéssel, csak a tárolt kalibrációval —
 * ezt a füstteszt a felvett hangon FÜGGETLENÜL méri (kattanás-kezdetek / a zene keresztkorrelációja).
 */
export async function smokePunch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const SR = 44100;
  // zene: a frekvencia 0,1 s-onként ugrik — az áthallásban az eltolás egyértelmű
  const music = (tt: number) => 0.45 * Math.sin(2 * Math.PI * (300 + 40 * (Math.floor(tt * 10) % 25)) * tt);
  const mPcm = Float32Array.from({ length: 12 * SR }, (_, i) => music(i / SR));
  const mFile = new File(Paths.document, 'smoke_punch_music.wav');
  if (mFile.exists) mFile.delete();
  mFile.create();
  mFile.write(encodeWav16([mPcm, mPcm], SR, () => 0.5));
  const old = toneWav('smoke_punch_old.wav', 12);
  const id = 'prj_smoke_punch';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:punch', caught));
  const base = createEmptyProject('smoke punch-in', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'x', uri: old, label: 'x', start: 0, duration: 10, trimIn: 0, sourceDuration: 12, volume: 0.05, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'old', label: 'régi' })] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'm', uri: mFile.uri, label: 'zene', duration: 12, volume: 1 })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  const state = () => runDevAction('audio.recordState') as { active: boolean };
  const api = (await loadAudioApi())!;
  const mono = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0).slice();
  const ms = (x: number) => `${(x * 1000).toFixed(1)} ms`;

  // ── count-in: 1 ütem 120 BPM-en = 2,0 s ──
  useRecordPrefs.getState().setPunch(false);
  useRecordPrefs.getState().setCountIn(1);
  const countInTake = async (alignOn: boolean) => {
    setTakeAlignForTest(alignOn);
    st().setPlayhead(1);
    await sleep(300);
    await runDevAction('audio.recordToggle');
    await sleep(3800);
    await runDevAction('audio.recordToggle');
    for (let k = 0; k < 100 && !voice().some((c) => c.id !== 'old'); k++) await sleep(100);
    await sleep(300);
    const ci = voice().find((c) => c.id !== 'old');
    const info = lastTakeAlign();
    if (!ci) return { ci: null, info, err: null as number[] | null };
    // független mérés: a kattanások kezdete a felvett hangban (a legnagyobb csúcs negyede fölött)
    const y = await mono(ci.uri);
    let peak = 0;
    for (let k = 0; k < Math.min(y.length, 2.6 * SR); k++) peak = Math.max(peak, Math.abs(y[k]));
    const onsets: number[] = [];
    for (let k = 0; k < Math.min(y.length, 2.6 * SR) && onsets.length < 4; k++) {
      if (Math.abs(y[k]) > Math.max(0.02, peak * 0.25)) {
        onsets.push(k / SR);
        k += Math.round(0.3 * SR);
      }
    }
    const e0 = (ci.trimIn ?? 0) - 2;
    const err = onsets.length === 4 ? onsets.map((o, k) => o - (e0 + k * 0.5)) : null;
    return { ci, info, err };
  };
  const c1 = await countInTake(true);
  log(!!c1.ci && c1.ci.start === 1 && Math.abs(c1.ci.duration + (c1.ci.trimIn ?? 0) - (c1.ci.sourceDuration ?? 0)) < 0.01, 'count-in: a take a lejátszófejnél, az előszámlálás levágva', `trimIn ${c1.ci?.trimIn?.toFixed(3)} s, hossz ${c1.ci?.duration.toFixed(2)} s; igazítás: ${c1.info?.measured ? `a hallott kattanásokból (${ms(c1.info.shift)}, ρ ${c1.info.rho?.toFixed(2)})` : `tárolt kalibráció (próbált ρ ${c1.info?.rho?.toFixed(2) ?? '—'})`}`);
  log(c1.err ? c1.err.every((e) => Math.abs(e) <= 0.02) : null, 'count-in (illesztéssel): a 4 hallott kattanás a levágás előtt pontosan 0,5 s-onként (±20 ms, független mérés)', c1.err ? `eltérés ${c1.err.map(ms).join(' / ')}` : 'nincs áthallás — nem mérhető');
  st().undo();
  await sleep(300);
  const c2 = await countInTake(false);
  log(c2.err ? c2.err.every((e) => Math.abs(e) <= 0.02) : null, 'count-in CSAK a tárolt kalibrációval (a hangot az app nem nézte): a hallott kattanásokhoz igazítva (±20 ms)', c2.err ? `eltérés ${c2.err.map(ms).join(' / ')} (kalibráció ${ms(c2.info?.shift ?? 0)})` : 'nincs áthallás — nem mérhető');
  st().undo();
  await sleep(300);

  // ── punch-in 4–6 s között, 2 s preroll ──
  useRecordPrefs.getState().setCountIn(0);
  useRecordPrefs.getState().setPunch(true);
  st().setPlayhead(4);
  st().setRangeIn();
  st().setPlayhead(6);
  st().setRangeOut();
  const punchTake = async (alignOn: boolean) => {
    setTakeAlignForTest(alignOn);
    await sleep(300);
    const pastBefore = st().past.length;
    const t0 = Date.now();
    await runDevAction('audio.recordToggle');
    const RR = requireOptionalNativeModule<{ ioLatency?: () => { route?: string; category: string; options?: number } }>('RemixRender');
    const routes = new Set<string>();
    for (let k = 0; k < 120 && (Date.now() - t0 < 1000 || state().active); k++) {
      await sleep(100);
      const io = RR?.ioLatency?.();
      if (io) routes.add(`${io.route}/${io.category.replace('AVAudioSessionCategory', '')}/${io.options}`);
    }
    log(null, 'kimeneti útvonal a punch alatt', [...routes].join(' | ') || '—');
    // a take a take-illesztés (dekódolás + korreláció) után kerül a projektbe
    for (let k = 0; k < 100 && !voice().some((c) => c.uri !== old); k++) await sleep(100);
    await sleep(300);
    const v = voice();
    const take = v.find((c) => c.uri !== old) ?? null;
    const info = lastTakeAlign();
    let resid: number | null = null;
    let rho = 0;
    if (take) {
      // független mérés: a take-ben áthallott zene keresztkorrelációja a projekt idejében
      const y = await mono(take.uri);
      const recStart = take.start - (take.trimIn ?? 0);
      const from = Math.round(((take.trimIn ?? 0) + 0.7) * SR);
      const n = Math.round(0.5 * SR);
      const corrAt = (lag: number, step: number) => {
        let c = 0;
        let e1 = 0;
        let e2 = 0;
        for (let k = 0; k < n; k += step) {
          const x = y[from + k] ?? 0;
          const r = music(recStart + (from + k + lag) / SR);
          c += x * r;
          e1 += x * x;
          e2 += r * r;
        }
        return c / Math.sqrt(Math.max(1e-20, e1 * e2));
      };
      let bl = 0;
      let bv = -Infinity;
      for (let lag = -Math.round(0.3 * SR); lag <= Math.round(0.3 * SR); lag += 8) {
        const c = corrAt(lag, 4);
        if (c > bv) {
          bv = c;
          bl = lag;
        }
      }
      let fl = bl;
      let fv = -Infinity;
      for (let lag = bl - 8; lag <= bl + 8; lag++) {
        const c = corrAt(lag, 2);
        if (c > fv) {
          fv = c;
          fl = lag;
        }
      }
      rho = fv;
      resid = fv > 0.3 ? fl / SR : null;
    }
    return { v, take, info, resid, rho, steps: st().past.length - pastBefore };
  };
  const p1 = await punchTake(true);
  const geo = (v: AudioClip[], take: AudioClip | null) => v.length === 3 && !!take && Math.abs(take.start + take.duration - 6) < 1e-6 && Math.abs(take.start - 4) < 0.1 && v[0].id === 'old' && Math.abs(v[0].duration - 4) < 1e-6 && Math.abs(v[2].start - 6) < 1e-6 && Math.abs((v[2].trimIn ?? 0) - 6) < 1e-6;
  log(geo(p1.v, p1.take) && p1.steps === 1 && !st().isPlaying, 'punch: a take 4–6 s között, a régi klip 0–4 és 6–10 darabra (a forrás-pozíció 6 s), egy lépés, a lejátszás leállt', `${p1.v.map((c) => `${c.uri === old ? 'régi' : 'take'} ${c.start.toFixed(3)}+${c.duration.toFixed(3)} (trimIn ${(c.trimIn ?? 0).toFixed(3)})`).join(' · ')}; igazítás: ${p1.info?.measured ? `az áthallott zenéből (${ms(p1.info.shift)}, ρ ${p1.info.rho?.toFixed(2)})` : `tárolt kalibráció (próbált ρ ${p1.info?.rho?.toFixed(2) ?? '—'})`}`);
  log(p1.resid !== null ? Math.abs(p1.resid) <= 0.02 : null, 'punch (illesztéssel): a take a projekt idejében ott, amit a felhasználó hallott (±20 ms, független mérés)', p1.resid !== null ? `maradék eltérés ${ms(p1.resid)} (ρ ${p1.rho.toFixed(2)})` : `nincs áthallás (ρ ${p1.rho.toFixed(2)}) — nem mérhető`);
  st().undo();
  await sleep(300);
  const p2 = await punchTake(false);
  log(p2.resid !== null ? Math.abs(p2.resid) <= 0.02 : null, 'punch CSAK a tárolt kalibrációval (a hangot az app nem nézte): a hallotthoz igazítva (±20 ms)', p2.resid !== null ? `maradék eltérés ${ms(p2.resid)} (kalibráció ${ms(p2.info?.shift ?? 0)}, ρ ${p2.rho.toFixed(2)})` : `nincs áthallás (ρ ${p2.rho.toFixed(2)}) — nem mérhető`);
  st().undo();
  log(voice().length === 1 && voice()[0].id === 'old' && voice()[0].duration === 10, 'egy visszavonás: a régi klip egészben vissza', '');
  setTakeAlignForTest(true);
  useRecordPrefs.getState().setPunch(false);
  router.back();
}
/** 🔬 Áthallás-kísérlet: felvétel közben mit „hall” a mikrofon — (a) expo-audio lejátszó, (b) a stúdió lejátszó-motorja. */
export async function smokeBleed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const tone = toneWav('smoke_bleed_tone.wav', 6);
  const id = 'prj_smoke_bleed';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bleed', caught));
  const base = createEmptyProject('smoke áthallás', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri: tone, label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const api = (await loadAudioApi())!;
  const env = async (uri: string) => {
    const y = (await api.decodeAudioData(uri, SR)).getChannelData(0);
    const out: string[] = [];
    for (let b = 0; b < y.length; b += Math.round(0.25 * SR)) {
      let m = 0;
      for (let k = b; k < b + 0.25 * SR && k < y.length; k++) m = Math.max(m, Math.abs(y[k]));
      out.push(m.toFixed(3));
    }
    return out.join(' ');
  };
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]);
  const take = async (label: string, during: () => Promise<void>) => {
    await runDevAction('audio.recordToggle');
    await during();
    await runDevAction('audio.recordToggle');
    await sleep(700);
    const v = voice();
    const last = v[v.length - 1];
    log(null, `áthallás — ${label} (csúcs 250 ms-onként)`, last ? await env(last.uri) : 'nincs take');
    st().undo();
    await sleep(300);
  };
  await take('csend (alapzaj)', async () => {
    await sleep(2500);
  });
  await take('expo-audio lejátszó (440 Hz, 0,5)', async () => {
    const p = createAudioPlayer(tone);
    await sleep(200);
    p.play();
    await sleep(2300);
    p.remove();
  });
  await take('a stúdió lejátszó-motorja (a projekt szól)', async () => {
    st().setPlayhead(0);
    st().setPlaying(true);
    await sleep(2500);
    st().setPlaying(false);
  });
  router.back();
}
/** 🎙️🔁 T4 take-ek: 3 punch ugyanarra a helyre = 3 take (nem vágás), a 2. választva az export a 2. take hangja; egy undo; mentés után is megvan mind. */
export async function smokeTakes(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const SR = 44100;
  const id = 'prj_smoke_takes';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:takes', caught));
  const base = createEmptyProject('smoke take-ek', '9:16', undefined, 'audio');
  const bed: AudioClip = { kind: 'audio', id: 'bed', uri: toneWav('smoke_takes_bed.wav', 8), label: 'alap', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.02, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [bed] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]);
  const state = () => runDevAction('audio.recordState') as { active: boolean };
  useRecordPrefs.getState().setCountIn(0);
  useRecordPrefs.getState().setPunch(true);
  st().setPlayhead(2);
  st().setRangeIn();
  st().setPlayhead(4);
  st().setRangeOut();
  const takes: string[] = [];
  for (let k = 0; k < 3; k++) {
    const before = voice()[0]?.uri;
    const t0 = Date.now();
    await runDevAction('audio.recordToggle');
    for (let i = 0; i < 120 && (Date.now() - t0 < 1000 || state().active); i++) await sleep(100);
    for (let i = 0; i < 100 && voice()[0]?.uri === before; i++) await sleep(100);
    await sleep(300);
    takes.push(voice()[0]?.uri ?? '');
    const al = lastTakeAlign();
    log(null, `${k + 1}. take igazítása`, al ? `${al.measured ? 'mért' : 'kalibráció'} ${(al.shift * 1000).toFixed(1)} ms, ρ ${al.rho?.toFixed(2) ?? '—'}` : '—');
  }
  const c = voice()[0];
  log(voice().length === 1 && c?.takes?.length === 3 && c.activeTake === c.takes[2].id && c.uri === takes[2] && new Set(takes).size === 3, '3 punch ugyanarra a helyre: EGY klip 3 take-kel, az utolsó szól', `${voice().length} klip, ${c?.takes?.length ?? 0} take, aktív ${(c?.takes?.findIndex((x) => x.id === c?.activeTake) ?? -1) + 1}.`);
  if (!c?.takes || c.takes.length !== 3) {
    router.back();
    return;
  }
  // a take-választó a klipszerkesztőben (képernyőkép)
  st().selectClip(c.id);
  runDevAction('audio.editClip');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a klipszerkesztő tetején a take-választó (3 take, előhallgatással)');
  await sleep(2500);
  // a 2. take választása (a lap útja: függő beállítás nélkül egy lépés)
  const past0 = st().past.length;
  st().dispatch(selectTakeCommand(voice()[0], c.takes[1].id)!);
  const c2 = voice()[0];
  log(st().past.length === past0 + 1 && c2.uri === takes[1] && c2.activeTake === c.takes[1].id && Math.abs(c2.start - c.takes[1].start) < 1e-9 && Math.abs((c2.trimIn ?? 0) - c.takes[1].trimIn) < 1e-9, 'a 2. take választva: a klip a 2. take hangja és helye, egy lépés', `trimIn ${c2.trimIn?.toFixed(3)} s`);
  await sleep(600);
  runDevAction('clipEdit.done');
  await sleep(400);
  // az export a választott take hangja: korreláció mindhárom take fájljával (a take-ek külön felvételek)
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_takes.wav'), undefined, undefined, 'float32');
  const api = (await loadAudioApi())!;
  const y = (await api.decodeAudioData(out, SR)).getChannelData(0);
  new File(out).delete();
  const corr = async (take: { uri: string; trimIn: number; start: number }) => {
    const x = (await api.decodeAudioData(take.uri, SR)).getChannelData(0);
    // a klip közepe (a mikro-fade-ek nélkül): export[start + j] ↔ take[trimIn + j]
    const a = Math.round((c2.start + 0.1) * SR);
    const n = Math.round(1.6 * SR);
    const off = Math.round(take.trimIn * SR) - Math.round(take.start * SR);
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let j = a; j < a + n; j++) {
      const p = y[j] ?? 0;
      const q = x[j + off] ?? 0;
      xy += p * q;
      xx += p * p;
      yy += q * q;
    }
    return xy / Math.sqrt(Math.max(1e-30, xx * yy));
  };
  const rs: number[] = [];
  for (const tk of c.takes) rs.push(await corr({ uri: tk.uri, trimIn: c2.trimIn ?? 0, start: c2.start }));
  const distinct = Math.max(Math.abs(rs[0]), Math.abs(rs[2])) < 0.9;
  log(rs[1] > 0.99 ? (distinct ? true : null) : false, 'az export a 2. take hangja (korreláció ≥ 0,99), a másik kettőé nem', `take 1/2/3: ${rs.map((r) => r.toFixed(3)).join(' / ')}${distinct ? '' : ' — a take-ek hangja itt nem különböztethető meg (azonos bemenet)'}`);
  // egy visszavonás: az előző (3.) take
  st().undo();
  log(voice()[0].uri === takes[2] && voice()[0].activeTake === c.takes[2].id, 'egy visszavonás: az előző take szól újra', '');
  st().redo();
  // mentés + újratöltés a tárból
  await saveProject(st().project!);
  const re = await loadProject(id);
  const rc = re?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip | undefined;
  log(rc?.takes?.length === 3 && rc.activeTake === c.takes[1].id && rc.uri === takes[1] && rc.takes.every((x) => new File(x.uri).exists), 'mentés után újratöltve: mind a 3 take megvan (a fájlok is), a 2. szól', `${rc?.takes?.length ?? 0} take`);
  useRecordPrefs.getState().setPunch(false);
  router.back();
}
