/** 🧪 Füstteszt — segédek: mixjavaslat, hang-asszisztens, hangellenőrzés, presetek. (Áthelyezve: phases08; viselkedés-változás nélkül.) */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { USER_PRESETS_KEY, useUserPresets } from '@/store/userPresetStore';
import type { CheckIssue } from '@/lib/audioCheck';
import { runAudioCheck } from '@/lib/audioCheckClient';
import { devTypeAssistant, parseNow } from '@/components/studio/audio/AudioAssistantBar';
import { type AudioIntentResult, ASR_HINT } from '@/lib/audioIntent';
import { t as i18nT } from 'i18next';
import { transcribeMediaOnDevice, bestUsableWhisperModelId } from '@/lib/whisperClient';
import { integratedLoudness } from '@/lib/loudness';
import { encodeWav16 } from '@/lib/offlineMix';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { mixForExport } from '@/lib/audioExportMix';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { toneWav } from '../../helpers/audio';
import { smokeFileHost } from '../../helpers/env';
import '@/lib/dspNativeClient';

/** kulcs-sorrendtől független JSON (szerkezeti egyezéshez) */
function sortedJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
}
/** 🎚️🤖 Mixjavaslat és mastering-segéd: egy rossz keverés javaslatai, alkalmazás után eltűnnek; a master eléri a célt. */
export async function smokeMixAssist(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // a beszéd: nagy dinamikájú (váltakozó hangos/halk mondatok), zajos és dübörgő
  const voice = Float32Array.from({ length: 13 * SR }, (_, i) => {
    const t = i / SR;
    const on = t % 1.3 < 1;
    const lvl = Math.floor(t / 1.3) % 2 === 0 ? 0.4 : 0.04;
    let v = on ? lvl * (0.6 * Math.sin(2 * Math.PI * 150 * t) + 0.3 * Math.sin(2 * Math.PI * 450 * t) + 0.15 * Math.sin(2 * Math.PI * 1200 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    return v + 0.2 * Math.sin(2 * Math.PI * 35 * t) + 0.01 * rnd();
  });
  const musicPcm = Float32Array.from({ length: 13 * SR }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / SR));
  const write = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  const vUri = write('smoke_mix_voice.wav', voice);
  const mUri = write('smoke_mix_music.wav', musicPcm);
  const id = 'prj_smoke_mixassist';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:mixassist', caught));
  const base = createEmptyProject('smoke mixjavaslat', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', uri: vUri, start: 0, duration: 13, sourceDuration: 13, id: 'x', ...over });
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'm', label: 'zene', uri: mUri })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const t0 = Date.now();
  runDevAction('audio.mixAssist');
  let keys: string[] = [];
  for (let i = 0; i < 120 && keys.length === 0; i++) {
    await sleep(250);
    keys = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  }
  const ms = Date.now() - t0;
  const want = ['duckMusic', 'compressVoice', 'highpassVoice', 'denoiseVoice'];
  log(want.every((k) => keys.includes(k)), 'a rossz keverés javaslatai: zene a beszéd alatt, dinamika, dübörgés, zaj', `${keys.join(', ')} (${ms} ms)`);
  log(true, 'FOTÓZHATÓ', 'a mixjavaslat-lap a javaslatokkal és a mastering-segéddel');
  await sleep(3000);
  const n = runDevAction('mixAssist.applyAll') as number;
  const v = st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  const m = st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
  log(n >= 4 && m.autoDuck === true && !!v.audioFx?.compressor && v.audioFx?.highpass === 80 && !!v.audioFx?.denoise, 'mind alkalmazva (egy visszavonás): halkítás, kompresszor, felüláteresztő, zajszűrés', `${n} parancs`);
  await runDevAction('mixAssist.reanalyze');
  await sleep(600); // a lap újrarajzol (a javaslat-lista a render után frissül)
  const after = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  log(!['duckMusic', 'compressVoice', 'highpassVoice', 'denoiseVoice'].some((k) => after.includes(k)), 'újramérés: az alkalmazott javaslatok nem térnek vissza', after.join(', ') || '—');
  runDevAction('mixAssist.targetSpotify');
  await sleep(200);
  const res = (await runDevAction('mixAssist.applyMaster')) as { stats: { lufs: number; peak: number }; lufs: number; tp: number } | null;
  const peakDb = res ? 20 * Math.log10(res.stats.peak) : 99;
  log(!!res && Math.abs(res.stats.lufs - -14) <= 1 && peakDb <= -1 + 0.3 && st().project!.audioMaster?.target === 'spotify', 'mastering-segéd (Spotify): alkalmazás után a mérés −14 ± 1 LUFS, csúcs ≤ −1 dBFS', res ? `${res.stats.lufs.toFixed(2)} LUFS, csúcs ${peakDb.toFixed(2)} dBFS` : 'null');
  st().undo();
  st().undo();
  log(!st().project!.audioMaster && !(st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).autoDuck, 'két visszavonás: a master és a javaslatok is vissza', '');
  runDevAction('audio.mixAssistClose');
  router.back();
}
/** 🎙️🤖 Hang-asszisztens: beírt mondat → lépések → végrehajtás egy undo-ban; kimondott parancs a Whisperrel → ugyanaz. */
export async function smokeAudioAssistant(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_assistant';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:assistant', caught));
  const base = createEmptyProject('smoke asszisztens', '9:16', undefined, 'audio');
  const uri = toneWav('smoke_assist.wav', 8);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri, start: 0, duration: 8, sourceDuration: 8, id: 'x', ...over });
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'm', label: 'zene' })] } : t.type === 'sfx' ? { ...t, clips: [ac({ id: 'f', label: 'effekt', start: 2, duration: 1 })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  runDevAction('audio.assistant');
  await sleep(500);
  const sentence = 'Tegyél zengést a beszédre, halkítsd a zenét 3 dB-lel, halkuljon a zene a beszéd alatt és masterelj Spotify-ra';
  // a sáv felcsatolása (a lassú eszközön 0,5 s-nál tovább tart): addig a beírásnak nincs címzettje
  for (let i = 0; i < 50 && runDevAction('assistant.text') === undefined; i++) await sleep(100);
  for (let k = 0; k < 5 && runDevAction('assistant.text') !== sentence; k++) {
    devTypeAssistant(sentence);
    await sleep(300);
  }
  const tt = i18nT as unknown as (k: string) => string;
  const parsed = parseNow(sentence, tt);
  log(parsed.unknown.length === 0 && parsed.steps.map((x) => x.key).join(',') === 'fxOn,trackGain,duckOn,master', 'a mondat 4 lépésre bomlik, nincs nem értett rész', parsed.steps.map((x) => x.key).join(' · '));
  log(true, 'FOTÓZHATÓ', 'az asszisztens-sáv a felismert lépésekkel');
  await sleep(3000);
  const before = st().project!;
  const n = runDevAction('assistant.apply') as number;
  const p = st().project!;
  const clipOf = (cid: string) => p.tracks.flatMap((x) => x.clips).find((c) => c.id === cid) as AudioClip;
  const ok = clipOf('v').audioFx?.reverb === 0.4 && Math.abs((p.trackMix?.music?.gain ?? 1) - Math.pow(10, -3 / 20)) < 1e-3 && clipOf('m').autoDuck === true && p.audioMaster?.target === 'spotify';
  log(n === 4 && ok, 'végrehajtva: zengés a beszéden, zene −3 dB, a zene halkul a beszéd alatt, Spotify-master', `${n} parancs; gain ${p.trackMix?.music?.gain}, master ${p.audioMaster?.target}`);
  st().undo();
  log(JSON.stringify(st().project!.tracks) === JSON.stringify(before.tracks) && !st().project!.audioMaster && !st().project!.trackMix?.music, 'egyetlen visszavonás mindent visszaállít', '');
  devTypeAssistant('némítsd a zenét');
  await sleep(300);
  runDevAction('assistant.apply');
  log(!st().isTrackAudible('music'), 'művelet: a zene némítva (munkamenet)', '');
  st().toggleTrackFlag('music', 'mute');
  // 🎤 kimondott parancsok: a telefon Whisperje írja át (a mikrofon helyett felolvasott fájl)
  // ellenőrző mondatok: a hu2/hu3/hu5 kimenetére általános tűrés készült; a hu4, hu6, hu7 egyikre sem volt hangolva
  const sig = (r: AudioIntentResult) => [...r.steps.map((x) => (x.key === 'master' ? `master:${x.params?.target}` : x.key)), ...r.actions.map((a) => a.kind)].join(',');
  const cases: [string, string][] = [
    ['cmd_hu.wav', 'fxOn,trackGain'],
    ['cmd_en.wav', 'fxOn,master:spotify'],
    ['cmd_hu2.wav', 'fxOn,master:spotify'],
    ['cmd_hu3.wav', 'duckOn,fadeIn'],
    ['cmd_hu4.wav', 'fxOn,trackGain'],
    ['cmd_hu5.wav', 'master:youtube,marker'],
    ['cmd_hu6.wav', 'fxOn,master:tiktok'],
    ['cmd_hu7.wav', 'trackGain,silence'],
  ];
  let hits = 0;
  for (const [file, expected] of cases) {
    const local = await downloadToCache(`${smokeFileHost()}/${file}`, `smoke_${file}`);
    const t0 = Date.now();
    const r = local ? await transcribeMediaOnDevice(local, { prompt: ASR_HINT }) : null;
    const said = (r?.lines ?? []).map((l) => l.text).join(' ').trim();
    const res = parseNow(said, tt);
    const ok = res.unknown.length === 0 && sig(res) === expected;
    if (ok) hits++;
    // egyenként naplózva (INFO): a felismerés a modell és a hang függvénye, a mérce az arány
    log(null, `kimondott parancs ${ok ? '✓' : '✗'} (${file})`, `„${said}” → ${sig(res)}${res.unknown.length ? ` ?${res.unknown.join('|')}` : ''} (várt: ${expected}; ${Date.now() - t0} ms, ${bestUsableWhisperModelId()})`);
  }
  log(hits >= 7, 'kimondott parancsok: legalább 7/8 helyesen értelmezve (a lépések végrehajtás előtt mindig látszanak)', `${hits}/${cases.length}`);
  devTypeAssistant('');
  router.back();
}
/** 🩺 Hangellenőrzés: egy szándékosan hibás projekt minden hibája a helyén, a hangosság = a WAV-exporté; a jó projekt hibátlan. */
export async function smokeAudioCheck(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const wav = (name: string, sec: number, amp: number, invertRight = false) => {
    const x = Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * 330 * i) / SR));
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, invertRight ? x.map((v) => -v) : x], SR, () => 0.5));
    return f.uri;
  };
  const loud = wav('smoke_chk_loud.wav', 3, 0.7);
  const anti = wav('smoke_chk_anti.wav', 2, 0.4, true);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', uri: loud, start: 0, duration: 3, sourceDuration: 3, id: 'x', ...over });
  const id = 'prj_smoke_check';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:check', caught));
  const base = createEmptyProject('smoke hangellenőrzés', '9:16', undefined, 'audio');
  const bad: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'a' }), ac({ id: 'ph', uri: anti, start: 8, duration: 2, sourceDuration: 2 }), ac({ id: 'sl', start: 10.2, duration: 0.05 })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'b', start: 2, duration: 2 }), ac({ id: 'gone', uri: 'file:///nincs/ilyen.wav', start: 4.5, duration: 1 }), ac({ id: 'z', start: 10.5, duration: 1, volume: 0 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'm', start: 10, duration: 2 })] }
            : t
    ),
  };
  await saveProject(bad);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  if (!st().mutedTracks.includes('music')) st().toggleTrackFlag('music', 'mute');
  const t0 = Date.now();
  const issues = ((await runDevAction('audio.runCheck')) as CheckIssue[] | null) ?? [];
  const ms = Date.now() - t0;
  const at = (k: string) => issues.find((i) => i.kind === k);
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 0.11;
  log(near(at('clipping')?.start, 2) && near(at('clipping')?.end, 3), 'túlvezérlés a két átfedő hang alatt (2–3 s)', `${at('clipping')?.start?.toFixed(2)}–${at('clipping')?.end?.toFixed(2)} s`);
  log(near(at('silence')?.start, 4) && near(at('silence')?.end, 8), 'hosszú csend (4–8 s: a 4 s-nál véget érő hang és a 8 s-nál induló közt; a hiányzó fájl helyén is)', `${at('silence')?.start?.toFixed(2)}–${at('silence')?.end?.toFixed(2)} s`);
  log(near(at('phase')?.start, 8) && near(at('phase')?.end, 10), 'fázis-kioltás (8–10 s)', `${at('phase')?.start}–${at('phase')?.end} s`);
  log(at('missing')?.start === 4.5 && at('sliver')?.start === 10.2 && at('zeroVolume')?.start === 10.5 && at('muted')?.params?.track === 'music', 'szerkezeti: hiányzó fájl (4,5 s), vágási maradék (10,2 s), néma klip (10,5 s), némított zene-sáv', issues.map((i) => i.kind).join(', '));
  log(issues.findIndex((i) => i.severity === 'warn') > issues.findIndex((i) => i.severity === 'error') && issues.filter((i) => i.severity === 'error').every((i, k, a) => k === 0 || (a[k - 1].start ?? -1) <= (i.start ?? -1)), 'a lista: hibák elöl, időrendben', `${issues.length} tétel, ${ms} ms alatt`);
  log(true, 'FOTÓZHATÓ', 'a hangellenőrzés eredmény-lapja');
  await sleep(3000);
  runDevAction('audio.closeCheck');
  // a mért hangosság = a WAV-exporté (ugyanaz a keverés)
  const mix = mixForExport(st().project!, st().isTrackAudible, st().masterVolume)!;
  const playable = { ...mix, tracks: mix.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== 'gone') })) };
  const out = await exportOfflineWav(playable, new File(projectExportDir(), 'smoke_chk.wav'), undefined, undefined, 'float32');
  const buf = await (await loadAudioApi())!.decodeAudioData(out.uri, SR);
  const ref = integratedLoudness(buf.getChannelData(0), buf.getChannelData(1), SR);
  new File(out.uri).delete();
  const measured = (await runAudioCheck(st().project!, { isTrackAudible: st().isTrackAudible, masterVolume: st().masterVolume, mutedTracks: st().mutedTracks, soloTracks: st().soloTracks })).stats!.lufs;
  log(Math.abs(measured - ref) < 0.01, 'a mért hangosság = a WAV-export hangossága (BS.1770)', `${measured.toFixed(3)} / ${ref.toFixed(3)} LUFS`);
  st().toggleTrackFlag('music', 'mute');
  router.back();
  await sleep(800);
  // a jó projekt (masterrel): nincs hiba
  const id2 = 'prj_smoke_check_ok';
  await deleteProject(id2).catch((caught) => logCaught('lib/imageSmoke.tsx:check2', caught));
  const good: Project = {
    ...base,
    id: id2,
    audioMaster: { target: 'custom', lufs: -16, truePeak: -1, dynamics: 'balanced' },
    tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'g', uri: wav('smoke_chk_ok.wav', 6, 0.3), duration: 6, sourceDuration: 6 })] } : t)),
  };
  await saveProject(good);
  router.push(`/studio/audio/${id2}` as Href);
  for (let i = 0; i < 60 && st().project?.id !== id2; i++) {
    await sleep(200);
  }
  await sleep(1000);
  const okIssues = ((await runDevAction('audio.runCheck')) as CheckIssue[] | null) ?? ['x'];
  log(Array.isArray(okIssues) && okIssues.length === 0, 'a rendben lévő, masterelt projektre nincs hiba', JSON.stringify(okIssues));
  runDevAction('audio.closeCheck');
  router.back();
}
/** ⭐ A klipszerkesztő presetsora (képernyőkép): beépített presetek alatt a saját. */
export async function smokePresetPhoto(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const backup = await AsyncStorage.getItem(USER_PRESETS_KEY);
  try {
    await AsyncStorage.removeItem(USER_PRESETS_KEY);
    useUserPresets.setState({ list: [], loaded: false });
    await useUserPresets.getState().save('clipFx', 'Meleg hang', { compressor: true, eq: { low: 2, mid: 0, high: -1 } });
    await useUserPresets.getState().save('clipFx', 'Termi beszéd', { reverb: 0.5, highpass: 90 });
    const id = 'prj_smoke_presetphoto';
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:presetphoto', caught));
    const base = createEmptyProject('smoke preset-sor', '9:16', undefined, 'audio');
    const vo: AudioClip = { kind: 'audio', id: 'vo', label: 'hang', uri: toneWav('smoke_presetphoto.wav', 3), start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
    await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [vo] } : t)) });
    router.push(`/studio/audio/${id}` as Href);
    const st = useEditorStore.getState;
    for (let i = 0; i < 60 && st().project?.id !== id; i++) {
      await sleep(200);
    }
    await sleep(1200);
    st().selectClip('vo');
    runDevAction('audio.editClip');
    await sleep(1000);
    runDevAction('clipEdit.scrollToPresets');
    await sleep(400);
    log(true, 'FOTÓZHATÓ', 'a klipszerkesztő: beépített presetek, alattuk a két saját (csillag) + Mentés');
    await sleep(3000);
    runDevAction('clipEdit.done');
    router.back();
  } finally {
    if (backup !== null) await AsyncStorage.setItem(USER_PRESETS_KEY, backup);
    else await AsyncStorage.removeItem(USER_PRESETS_KEY);
    useUserPresets.setState({ list: [], loaded: false });
  }
}
/** ⭐ Saját presetek: klip-effekt és dobminta mentése, alkalmazása, megmaradása „újraindítás” után, sérült tár. */
export async function smokeUserPresets(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // a teszteszköz meglévő presetjei a végén visszakerülnek
  const backup = await AsyncStorage.getItem(USER_PRESETS_KEY);
  await AsyncStorage.removeItem(USER_PRESETS_KEY);
  useUserPresets.setState({ list: [], loaded: false });
  try {
    const id = 'prj_smoke_presets';
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:presets', caught));
    const base = createEmptyProject('smoke presetek', '9:16', undefined, 'audio');
    const fx = { compressor: true, reverb: 0.4, eq: { low: 2, mid: 0, high: 1 } };
    const vo: AudioClip = { kind: 'audio', id: 'vo', label: 'hang', uri: toneWav('smoke_presets.wav', 4), start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: fx };
    await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [vo] } : t)) });
    router.push(`/studio/audio/${id}` as Href);
    const st = useEditorStore.getState;
    for (let i = 0; i < 60 && st().project?.id !== id; i++) {
      await sleep(200);
    }
    await sleep(1200);
    const clipFx = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip).audioFx ?? {};
    // klip-effekt: mentés → a klip effektjei törölve → alkalmazás → a „Kész” a klipre írja
    st().selectClip('vo');
    runDevAction('audio.editClip');
    await sleep(800);
    const saved = await runDevAction('presets.clipFx.saveAs');
    runDevAction('clipEdit.done');
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'vo', patch: { audioFx: {} } }, 'user');
    await sleep(300);
    runDevAction('audio.editClip');
    await sleep(800);
    const applied = runDevAction('presets.clipFx.applyFirst');
    await sleep(300); // a lap az új effektekkel újrarajzol (mint egy valódi koppintás után)
    runDevAction('clipEdit.done');
    await sleep(300);
    log(saved === true && applied === 'Füstteszt clipFx' && sortedJson(clipFx()) === sortedJson(fx), 'klip-effekt preset: mentés, a klip effektjei törölve, alkalmazás → a klipen újra a mentett lánc', JSON.stringify(clipFx()));
    st().undo();
    log(JSON.stringify(clipFx()) === '{}', 'az alkalmazás egy visszavonással visszavonható', JSON.stringify(clipFx()));
    // dobminta
    runDevAction('audio.openDrums');
    await sleep(800);
    runDevAction('drums.demo');
    await sleep(200);
    const demo = runDevAction('drums.hits') as string;
    await runDevAction('presets.drums.saveAs');
    log(true, 'FOTÓZHATÓ', 'a dobgép a saját preset csillagos chipjével');
    await sleep(2500);
    runDevAction('audio.closeDrums');
    await sleep(400);
    // „újraindítás”: a memória üres, a tárból töltődik
    useUserPresets.setState({ list: [], loaded: false });
    await useUserPresets.getState().load();
    const kinds = useUserPresets.getState().list.map((p) => p.kind).sort().join(',');
    log(kinds === 'clipFx,drums', 'a presetek megmaradnak (a tárból újratöltve)', kinds);
    runDevAction('audio.openDrums');
    await sleep(800);
    const empty = runDevAction('drums.hits') as string;
    runDevAction('presets.drums.applyFirst');
    await sleep(200);
    const back = runDevAction('drums.hits') as string;
    log(empty === '' && back === demo && demo.length > 0, 'dobminta preset: az újranyitott üres gépen alkalmazva = a mentett ütem', `${demo.split(',').length} ütés`);
    runDevAction('audio.closeDrums');
    // sérült tár: csak az érvényes bejegyzés töltődik be
    await AsyncStorage.setItem(USER_PRESETS_KEY, JSON.stringify([{ kind: 'clipFx', id: 'x', name: 'Jó', value: { gate: true } }, { kind: 'bad' }, 'x', { kind: 'master', id: 'm', name: 'M', value: { lufs: 'sok' } }]));
    await useUserPresets.getState().load();
    log(useUserPresets.getState().list.length === 1, 'sérült tár: csak az érvényes bejegyzés töltődik be, nincs összeomlás', `${useUserPresets.getState().list.length} preset`);
    router.back();
  } finally {
    if (backup !== null) await AsyncStorage.setItem(USER_PRESETS_KEY, backup);
    else await AsyncStorage.removeItem(USER_PRESETS_KEY);
    useUserPresets.setState({ list: [], loaded: false });
  }
}
