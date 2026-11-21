/** 🧪 Füstteszt — stabilitás: hang-autosave kilövés, szélsőséges esetek, tárhelyhiány, megszakítás. (Áthelyezve: phases03, phases15; viselkedés-változás nélkül.) */
import { Platform, Dimensions, AppState } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { AUDIO_KILL_ID, toneWav, type RecordHandle, RecordHarness } from '../../helpers/audio';
import { Paths, File } from 'expo-file-system';
import type { ReactNode } from 'react';
import { getRecordingPermissionsAsync } from 'expo-audio';
import { probeAudioDuration } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { recordingPhase } from '@/lib/interruption';
import { trackLevelAt } from '@/lib/levelMeter';
import { offlineMixPlan } from '@/lib/offlineMix';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { freeDiskBytes, setFreeDiskOverride } from '@/lib/diskSpaceClient';
import { wavBytes, EXPORT_SPACE_MARGIN, RECORD_STOP_FREE } from '@/lib/diskSpace';
import { startVoiceRecording } from '@/lib/voiceRecording';
import { mixForExport } from '@/lib/audioExportMix';
import '@/lib/dspNativeClient';

/** Hang-autosave a valódi képernyőn: szerkesztés, majd a külső kilövés előtt megállunk. */
export async function smokeAudioKillPrepare(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  await deleteProject(AUDIO_KILL_ID).catch((caught) => logCaught('lib/imageSmoke.tsx:audioKill', caught));
  await saveProject({ ...createEmptyProject('smoke hang-autosave', '9:16', undefined, 'audio'), id: AUDIO_KILL_ID });
  router.push(`/studio/audio/${AUDIO_KILL_ID}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== AUDIO_KILL_ID; i++) {
    await sleep(200);
  }
  await sleep(800);
  useEditorStore.getState().addClip('music', { kind: 'audio', id: 'smoke-kill-clip', uri: 'file:///smoke.m4a', label: 'kilövés előtt', start: 0, duration: 4, volume: 1, fadeIn: 0, fadeOut: 0 } as AudioClip);
  // a klip vágása is a mentésbe kerül
  useEditorStore.getState().splitClipAt('smoke-kill-clip', 2);
  await sleep(2500);
  log(null, 'KILLREADY', AUDIO_KILL_ID);
  await sleep(60000);
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
export async function smokeAudioKillVerify(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const saved = await loadProject(AUDIO_KILL_ID);
  const clips = saved?.tracks.find((t) => t.type === 'music')?.clips ?? [];
  log(clips.length === 2, 'a kilövés előtti szerkesztés megmaradt', `${clips.length} klip a zene-sávon`);
  const second = clips.find((c) => c.start > 0) as AudioClip | undefined;
  log(second?.start === 2 && second.trimIn === 2, 'a vágás helyes a visszatöltött projektben', `start ${second?.start}, trimIn ${second?.trimIn}`);
  await deleteProject(AUDIO_KILL_ID);
}
