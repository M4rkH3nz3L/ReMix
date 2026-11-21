/** 🧪 Füstteszt — Hang Stúdió felülete: szinkron, illesztés, vonalzó, album-lap, módok, érintés, videó-referencia. (Áthelyezve: phases03, phases05, phases08, phases14, phases15; viselkedés-változás nélkül.) */
import type { ReactNode } from 'react';
import { addSong, initAlbum, makeSong } from '@/lib/albumDoc';
import { AlbumSheet } from '@/components/studio/audio/AlbumSheet';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import { type Log, sleep } from '../../helpers/core';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { saveProject, deleteProject } from '@/lib/storage';
import { useAudioEditMode } from '@/store/audioEditModeStore';
import type { AudioClip } from '@/types/project';
import { toneWav } from '../../helpers/audio';
import { File } from 'expo-file-system';
import { smokeFileHost } from '../../helpers/env';
import { startSyncProbe, stopSyncProbe, summarizeDrift } from '@/lib/audioSyncProbe';
import '@/lib/dspNativeClient';

/** A45: az album-lap a szám-sorokkal (ceruza = átnevezés) — képernyőkép. */
export async function smokeAlbumSheet(log: Log, setHarness: (n: ReactNode) => void) {
  const base = createEmptyProject('smoke album', '1:1', undefined, 'audio');
  const album = addSong(initAlbum(makeSong('s1', 'Első dal', base.tracks)), makeSong('s2', 'Második, nagyon hosszú című dal a lapon', base.tracks));
  useEditorStore.getState().loadProject({ ...base, album }, []);
  setHarness(<AlbumSheet onClose={() => {}} onShareAlbum={() => {}} />);
  log(true, 'FOTÓZHATÓ', 'az album-lap a szám-sorokkal');
  await sleep(5000);
  setHarness(null);
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
/** ✋✂️↔️ Érintéses módok (Android emulátoron valódi adb-koppintással/-húzással): vágás, kijelölés, mozgatás; nagy sávok. */
/**
 * ♿ S8 (AUDIO-PROD): minden hang-vezérlőnek van neve a képernyőolvasónak. A Hang Stúdió lapjai
 * SORBAN nyitva maradnak; mindegyiknél `READY <név>` → a héj (`adb shell uiautomator dump`) a
 * `content-desc`/`text` mezőket menti és a címkézetlen érinthető elemeket számolja. A statikus
 * őrteszt (`a11yGuard.test.ts`) a forrást zárja, ez a VALÓDI natív a11y-fát.
 */
export async function smokeA11y(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_a11y';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:a11y', caught));
  const base = createEmptyProject('smoke a11y', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_a11y.wav', 4), start: 1, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  runDevAction('audio.fit');
  const HOLD = 8000;
  const views: string[] = [];
  const hold = async (name: string, open?: string, close?: string) => {
    if (open) {
      runDevAction(open);
      await sleep(900);
    }
    log(null, 'READY', name);
    views.push(name);
    await sleep(HOLD);
    if (close) {
      runDevAction(close);
      await sleep(500);
    }
  };
  try {
    await hold('studio');
    await hold('drums', 'audio.openDrums', 'audio.closeDrums');
    await hold('pianoroll', 'audio.openPianoRoll', 'audio.closePianoRoll');
    await hold('sampler', 'audio.openSampler', 'audio.closeSampler');
    await hold('master', 'audio.master', 'audio.closeMaster');
    await hold('mixer', 'audio.mixer', 'audio.closeMixer');
    await hold('addmedia', 'audio.openAddMedia', 'audio.closeAddMedia');
    await hold('tts', 'audio.openTts', 'audio.closeTts');
    st().selectClip('c');
    await sleep(200);
    await hold('clipedit', 'audio.editClip', 'clipEdit.done');
    log(true, 'a lapok sorban nyitva voltak (a címkéket a héj a uiautomator-dumpból számolja)', views.join(', '));
  } finally {
    router.back();
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:a11y-del', caught));
  }
}
export async function smokeTouchModes(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_touch';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:touch', caught));
  const base = createEmptyProject('smoke érintés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_touch.wav', 6), start: 1, duration: 6, trimIn: 0, sourceDuration: 6, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  await sleep(500);
  const clips = () => (st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  // 1) vágás-mód: egy koppintás a klip közepén → két darab (a vágás a koppintás helyén, a rácson)
  useAudioEditMode.getState().setMode('cut');
  log(null, 'READY', 'cut');
  const cut = await waitFor(() => clips().length === 2, 25000);
  const at = cut ? clips()[1].start : NaN;
  log(cut && Math.abs(at - 4) < 0.6 && Math.abs(at * 44100 - Math.round(at * 44100)) < 1e-6, 'vágás-mód: egy koppintás a klipen → ott vág, a minta-rácson (V6)', `${clips().length} darab, vágás ${at.toFixed(3)} s`);
  st().undo();
  await sleep(300);
  // 2) kijelölés-mód: a gyors (hosszú nyomás nélküli) húzás NEM mozdítja a klipet
  useAudioEditMode.getState().setMode('select');
  log(null, 'READY', 'select');
  await sleep(6000);
  log(clips().length === 1 && clips()[0].start === 1, 'kijelölés-mód: a gyors húzás nem mozdítja a klipet (véletlen mozgatás ellen)', `kezdet ${clips()[0].start} s`);
  // 3) mozgatás-mód: ugyanez a húzás azonnal mozgat
  useAudioEditMode.getState().setMode('move');
  log(null, 'READY', 'move');
  const moved = await waitFor(() => clips()[0].start !== 1, 25000);
  log(moved && clips()[0].start > 1.5, 'mozgatás-mód: a gyors húzás azonnal mozgatja a klipet', `kezdet 1 → ${clips()[0].start.toFixed(3)} s`);
  st().undo();
  useAudioEditMode.getState().setMode('select');
  // 4) nagy sávok
  if (!useAudioEditMode.getState().large) useAudioEditMode.getState().toggleLarge();
  await sleep(500);
  log(true, 'FOTÓZHATÓ', 'nagy sávok (nagyobb hullámforma), a módváltó gombok a transzporton');
  await sleep(3000);
  useAudioEditMode.getState().toggleLarge();
  router.back();
}
/** 🎬 AP8: a videóból nyitott Hang Stúdióban a lejátszófejhez tartozó videó-képkocka látszik (± 1 kocka). */
export async function smokeVideoRef(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { downloadToCache } = await import('@/lib/media');
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, 'smoke_videoref.mp4');
  if (!vid) {
    log(false, 'a teszt-videó letöltése', 'nincs');
    return;
  }
  const id = 'prj_smoke_videoref';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoref', caught));
  const base = createEmptyProject('smoke videó-referencia', '9:16');
  const video = { kind: 'video', id: 'vv', uri: vid, label: 'videó', start: 0, duration: 6, trimIn: 0, speed: 1, volume: 1 } as unknown as AudioClip;
  const music: AudioClip = { kind: 'audio', id: 'aa', label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, uri: toneWav('smoke_videoref.wav', 6), volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, fps: 30, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video] } : t.type === 'music' ? { ...t, clips: [music] } : t)) });
  router.push(`/editor/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  try {
    st().openAudioStudio('aa');
    await sleep(1200);
    for (const at of [2.5, 4.0]) {
      st().setPlayhead(at);
      type Ref = { ms: number; clipId: string; uri: string; at: number };
      let ref = null as Ref | null;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        ref = runDevAction('audio.videoRef') as Ref | null;
        if (ref && Math.abs(ref.at - at) < 1e-6) break;
      }
      const ok = !!ref && ref.clipId === 'vv' && Math.abs(ref.ms - at * 1000) <= 34 && new File(ref.uri).exists;
      log(ok, `lejátszófej ${at} s → a videó ${at} s-os képkockája látszik (± 1 kocka)`, ref ? `${ref.ms} ms, ${ref.clipId}` : 'nincs kép');
      if (at === 2.5) {
        log(true, 'FOTÓZHATÓ', 'a videóból nyitott Hang Stúdió a lebegő videó-képkockával');
        await sleep(2000);
      }
    }
  } finally {
    st().closeAudioStudio();
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoref-del', caught));
  }
}

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
