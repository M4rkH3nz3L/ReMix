/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import { File, Paths } from 'expo-file-system';
import { Dimensions, Platform } from 'react-native';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import '@/lib/dspNativeClient';
import { extractVideoAudio } from '@/lib/videoAudioImport';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import { sendMixdownToVideo } from '@/lib/linkedAssetClient';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, AudioFx, Project } from '@/types/project';
import { type Log, sleep, smokeFileHost, toneWav } from './shared';

/**
 * 🎹 S11 (MU2): piano roll — hanghossz koppintással (a hang vége után hosszabbodik, belül rövidül), rács-felbontás
 * (1/16, triola), skála-illesztés (C-dúr: a C# a legközelebbi skálahangra), oktáv-görgetés C1…C7; a sütés egy undo.
 */
export async function smokePianoRoll2(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_pianoroll2';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:pianoroll2', caught));
  await saveProject({ ...createEmptyProject('smoke piano roll', '9:16', undefined, 'audio'), id, bpm: 120 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const music = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  try {
    runDevAction('audio.openPianoRoll');
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      await sleep(100);
      ready = runDevAction('synth.notesFull') !== undefined;
    }
    log(ready, 'a piano roll nyílik', `${ready}`);
    // 1) 1/16-os rács: négy szomszédos koppintás egy 1 ütemes hangot ad (a vége után koppintva hosszabbodik)
    runDevAction('synth.grid', 4);
    await sleep(200);
    for (const beat of [0, 0.25, 0.5, 0.75]) {
      runDevAction('synth.tap', { midi: 60, beat });
      await sleep(80);
    }
    await sleep(200);
    const n1 = runDevAction('synth.notesFull') as string;
    log(n1 === '60@0+1', 'hanghossz: a vége utáni cellák egy 1 ütemes hanggá hosszabbítják (1/16-os rács)', n1);
    // 2) belül koppintva rövidül (0,5-nél végződik)
    runDevAction('synth.tap', { midi: 60, beat: 0.5 });
    await sleep(200);
    const n2 = runDevAction('synth.notesFull') as string;
    log(n2 === '60@0+0.5', 'belül koppintva a hang ott végződik (0,5 ütem)', n2);
    // 3) triola-rács: a lépés 1/3 ütem
    runDevAction('synth.grid', 3);
    await sleep(200);
    runDevAction('synth.tap', { midi: 64, beat: 1 });
    await sleep(200);
    const n3 = runDevAction('synth.notesFull') as string;
    log(n3 === '60@0+0.5,64@1+0.333', 'triola-rács: az új hang 1/3 ütem hosszú', n3);
    // 4) skála-illesztés: C-dúrban a C# (61) koppintása a legközelebbi skálahangra (60, döntetlennél lefelé) esik
    //    (a lassú eszközön a lap újrarajzolását megvárjuk: a koppintás a friss skála-állapottal menjen)
    const scaleIs = (want: string | null) => (runDevAction('synth.state') as { key: { scale: string } | null } | undefined)?.key?.scale === want || (want === null && (runDevAction('synth.state') as { key: unknown } | undefined)?.key === null);
    runDevAction('synth.grid', 4);
    runDevAction('synth.scale', { root: 0, scale: 'major', snap: true });
    await waitFor(() => scaleIs('major'), 3000);
    await sleep(150);
    runDevAction('synth.tap', { midi: 61, beat: 2 });
    await sleep(200);
    const n4 = runDevAction('synth.notesFull') as string;
    log(n4.endsWith('60@2+0.25'), 'skála-illesztés: a C# a C-dúr legközelebbi hangjára (C) esik', n4);
    // skála ki → a C# marad C#
    runDevAction('synth.scale', null);
    await waitFor(() => scaleIs(null), 3000);
    await sleep(150);
    runDevAction('synth.tap', { midi: 61, beat: 3 });
    await sleep(200);
    const n5 = runDevAction('synth.notesFull') as string;
    log(n5.endsWith('61@3+0.25'), 'skála nélkül a koppintott sor marad', n5);
    // 5) oktáv-görgetés: C3–C6 → C4–C7 → a tetőn marad; vissza C1-ig (a lassú eszközön az újrarajzolást megvárjuk)
    const rangeNow = () => (runDevAction('synth.state') as { range: { lowMidi: number; highMidi: number } }).range;
    const octave = async (dir: 1 | -1, expectLow: number) => {
      runDevAction('synth.octave', dir);
      await waitFor(() => rangeNow().lowMidi === expectLow, 3000);
      return rangeNow();
    };
    const s0 = rangeNow();
    const s1 = await octave(1, 60);
    const s2 = await octave(1, 60);
    let s3 = s2;
    for (let i = 0; i < 6; i++) s3 = await octave(-1, Math.max(24, s3.lowMidi - 12));
    const ok5 = s0.lowMidi === 48 && s1.lowMidi === 60 && s1.highMidi === 96 && s2.lowMidi === 60 && s3.lowMidi === 24;
    log(ok5, 'oktáv-görgetés: C3–C6 → C4–C7 (a tetőn marad), le C1-ig', `${s0.lowMidi}→${s1.lowMidi}→${s2.lowMidi}→${s3.lowMidi}`);
    // 6) sütés: a hangok a klipbe, a minta a projektben (3 hang), egy undo
    runDevAction('synth.bake');
    const baked = await waitFor(() => music().length === 1, 15000);
    const c = music()[0];
    const doc = c ? instrumentDocOf(st().project, c.instrumentDocId) : null;
    // az utolsó hang vége 3,25 ütem = 1,625 s 120 BPM-en (a tört hosszak a renderben is pontosak)
    log(baked && doc?.kind === 'synth' && doc.synth?.notes.length === 4 && Math.abs(c.duration - 1.625) < 0.05, 'sütés: a klip a mintára hivatkozik (4 hang, tört hosszakkal), a hossz a hangokból (3,25 ütem = 1,625 s)', `${doc?.synth?.notes.length} hang, ${c?.duration.toFixed(3)} s`);
    st().undo();
    await sleep(300);
    log(music().length === 0, 'egy visszavonás: nincs klip', `${music().length}`);
  } finally {
    runDevAction('audio.closePianoRoll');
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:pianoroll2-del', caught));
  }
}
/**
 * 🥁 S12 (MU3): dobgép 8 hanggal (tom, rim, crash, perc) és beépített készletekkel (Alap · House · Hip-hop):
 * a készlet a rácsot tölti (hangsúlyok, swing), a régi 4 soros minta újranyitva 8 sorra egészül ki, a sütés egy undo.
 */
export async function smokeDrumKit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const id = 'prj_smoke_drumkit';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:drumkit', caught));
  await saveProject({ ...createEmptyProject('smoke dobkészlet', '9:16', undefined, 'audio'), id, bpm: 120 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const music = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  try {
    runDevAction('audio.openDrums');
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      await sleep(100);
      ready = runDevAction('drums.hits') !== undefined;
    }
    log(ready, 'a dobgép nyílik', `${ready}`);
    // 1) House-készlet: 4-on-floor kick (az első hangsúlyos), clap 2/4, offbeat hihat, perc
    runDevAction('drums.kit', 'house');
    let hits = '';
    await waitFor(() => (hits = String(runDevAction('drums.hits') ?? '')).includes('perc'), 3000);
    log(hits.includes('kick0v127') && hits.includes('kick4') && hits.includes('clap4') && hits.includes('hihat2') && hits.includes('perc3'), 'House-készlet: 4-on-floor (hangsúlyos 1.), clap, offbeat hihat, perc', hits.slice(0, 80));
    // 2) Hip-hop: swing (a páros 16-odok 0,2 lépéssel), rim, tom
    runDevAction('drums.kit', 'hiphop');
    await waitFor(() => (hits = String(runDevAction('drums.hits') ?? '')).includes('rim'), 3000);
    log(hits.includes('kick3.2') && hits.includes('rim7.2') && hits.includes('tom14') && hits.includes('snare4v127'), 'Hip-hop-készlet: swing a páros 16-odokon, rim és tom, hangsúlyos snare', hits.slice(0, 90));
    // 3) sütés: az új hangok a klipben hallhatók (nem csend), a minta a projektben 8 sorral
    runDevAction('drums.bake');
    const baked = await waitFor(() => music().length === 1, 15000);
    const c = music()[0];
    const doc = c ? instrumentDocOf(st().project, c.instrumentDocId) : null;
    const pcm = c ? await left(c.uri) : new Float32Array(0);
    log(baked && doc?.kind === 'drums' && Object.keys(doc.drums?.pattern ?? {}).length === 8 && doc.drums?.swing === 0.2 && peak(pcm) > 0.2, 'sütés: a minta 8 sorral és swinggel a projektben, a klip hangja nem csend', `${Object.keys(doc?.drums?.pattern ?? {}).length} sor, csúcs ${peak(pcm).toFixed(3)}`);
    // 4) a régi (4 soros) minta újranyitva 8 sorra egészül ki — a doc-ot 4 sorosra szűkítjük, és újranyitjuk
    if (doc) {
      const four = { ...doc, drums: { ...doc.drums!, pattern: { kick: doc.drums!.pattern.kick, snare: doc.drums!.pattern.snare, hihat: doc.drums!.pattern.hihat, clap: doc.drums!.pattern.clap } as never } };
      st().dispatch({ type: 'UPSERT_INSTRUMENT_DOC', doc: four });
      runDevAction('audio.closeDrums');
      await sleep(300);
      st().selectClip(c.id);
      runDevAction('audio.editClip');
      await sleep(800);
      const opened = runDevAction('clipEdit.editInstrument') === true;
      await sleep(900);
      const h2 = String(runDevAction('drums.hits') ?? '');
      log(opened && h2.includes('kick0') && h2.includes('snare4v127') && !h2.includes('tom'), 'régi 4 soros minta újranyitva: a sorok 8-ra egészülnek ki, az ütések maradnak', h2.slice(0, 60));
    }
    st().undo();
    st().undo();
    await sleep(300);
    log(music().length === 0, 'visszavonás: nincs klip', `${music().length}`);
  } finally {
    runDevAction('audio.closeDrums');
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:drumkit-del', caught));
  }
}
/**
 * 🎼 S13 (MU4): tempo-map — tempóváltás a lejátszófejnél; a rács, az ütem:beat kijelzés, az ugrás, az ütemre vágás
 * és a metronóm a tempóváltást követi; a ± az itteni szakaszt lépteti; egy undo; a metronóm klikkjei az új rácson.
 */
export async function smokeTempoMap(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_tempomap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tempomap', caught));
  const base = createEmptyProject('smoke tempo', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_tempo.wav', 8), start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const music = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;
  try {
    // 1) tempóváltás 90 BPM-re a 4 s-nál (= 8. beat 120 BPM-en)
    st().setPlayhead(4);
    await sleep(200);
    const added = runDevAction('audio.tempoAdd', 90) === true;
    const map = runDevAction('audio.tempoMap') as { atBeat: number; bpm: number }[];
    log(added && map.length === 1 && map[0].atBeat === 8 && map[0].bpm === 90, 'tempóváltás a lejátszófejnél: a 8. beaten 90 BPM (a projektben, egy parancs)', JSON.stringify(map));
    // 2) a mérvadó BPM és az ütem:beat kijelzés a váltás után
    const b1 = runDevAction('audio.bpmAt', 3.9);
    const b2 = runDevAction('audio.bpmAt', 4.1);
    const bb = runDevAction('audio.barsBeats', 6);
    log(b1 === 120 && b2 === 90 && bb === '3.4', 'a BPM a szakasz szerint (120 → 90), a 6 s = 3. ütem 4. beat', `${b1} → ${b2}, ${bb}`);
    // 3) a rács: 4 s-ig 0,5 s-onként, utána 0,667 s-onként
    const lines = runDevAction('audio.gridLines', { from: 0, to: 8 }) as number[];
    log(near(lines[8], 4) && near(lines[9], 4 + 60 / 90) && near(lines[10], 4 + 2 * (60 / 90)), 'a rács követi a tempóváltást (0,5 s → 0,667 s)', lines.slice(7, 11).map((x) => x.toFixed(3)).join(' '));
    // 4) ugrás a következő beatre a váltás után
    st().setPlayhead(4.1);
    await sleep(150);
    runDevAction('audio.nextBeat');
    await sleep(150);
    const ph = st().playhead;
    log(near(ph, 4 + 60 / 90, 1e-3), 'ugrás a következő beatre a váltás után: 4,667 s', ph.toFixed(3));
    // 5) ütemre vágás a tempo-mapen: 7 vonal 4 s előtt, 6 utána
    st().selectClip('c');
    await sleep(150);
    const n = runDevAction('audio.beatSplitBeats') as number;
    const starts = music().map((x) => x.start).sort((a, b) => a - b);
    log(music().length === 14 && starts.filter((x) => x < 4 - 1e-6).length === 8 && near(starts[8], 4) && near(starts[9], 4 + 60 / 90), 'beatre vágás a tempo-mapen: 14 darab (8 a váltás előtt, 6 utána)', `${n} vágás, ${music().length} darab`);
    st().undo();
    await sleep(200);
    // 6) a ± az itteni szakaszt lépteti: a lejátszófej a 90-es szakaszban → 91 (új váltás nem jön létre), az induló tempó marad 120;
    //    az induló szakaszon a ± az induló tempót lépteti
    st().setPlayhead(5);
    await sleep(150);
    runDevAction('audio.tempoStep', 1);
    const map2 = runDevAction('audio.tempoMap') as { atBeat: number; bpm: number }[];
    st().setPlayhead(1);
    await sleep(100);
    runDevAction('audio.tempoStep', -1);
    const baseBpm = st().project!.bpm;
    st().setPlayhead(5);
    await sleep(100);
    log(map2.length === 1 && map2[0].atBeat === 8 && map2[0].bpm === 91 && baseBpm === 119, 'a ± a lejátszófej szakaszát lépteti (90 → 91, új váltás nélkül), az induló szakaszon az induló tempót (120 → 119)', `${JSON.stringify(map2)}, induló ${baseBpm}`);
    st().undo();
    await sleep(100);
    // 7) a metronóm a tempo-mapen (pure): a klikkek a váltás után 0,667 s-onként
    const { metronomeClicks } = await import('@/lib/metronome');
    const { projectTiming: pt } = await import('@/lib/audioTransport');
    const clicks = metronomeClicks(3.9, 6.1, 120, { beatsPerBar: 4, beatUnit: 4 }, pt(st().project!)).map((x) => x.t);
    log(clicks.length === 4 && near(clicks[0], 4) && near(clicks[1], 4 + 60 / 91), 'a metronóm klikkjei a tempóváltás után az új tempón', clicks.map((x) => x.toFixed(3)).join(' '));
    // 8) törlés hosszan nyomva (dev: tempoRemove) + egy undo visszahozza
    runDevAction('audio.tempoRemove');
    const gone = (runDevAction('audio.tempoMap') as unknown[]).length === 0;
    st().undo();
    await sleep(150);
    const back = runDevAction('audio.tempoMap') as { bpm: number }[];
    log(gone && back.length === 1 && back[0].bpm === 91, 'a tempóváltás törölhető, egy visszavonás visszahozza', `${gone} / ${JSON.stringify(back)}`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tempomap-del', caught));
  }
}
/**
 * 🎹 S14: iPad fekvőben a hangszer-szerkesztő dokkolva — a sávok (és a lejátszófej) fölötte látszanak; telefonon teljes képernyő.
 */
export async function smokeInstrumentDock(log: Log) {
  const { width, height } = Dimensions.get('screen');
  log(null, 'eszköz', `${Platform.OS} ${width}×${height}`);
  const id = 'prj_smoke_instdock';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instdock', caught));
  const base = createEmptyProject('smoke dokk', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_dock.wav', 4), start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  try {
    for (const [name, open, close] of [['dobgép', 'audio.openDrums', 'audio.closeDrums'], ['piano roll', 'audio.openPianoRoll', 'audio.closePianoRoll'], ['sampler', 'audio.openSampler', 'audio.closeSampler']] as const) {
      runDevAction(open);
      await sleep(900);
      const l = runDevAction('audio.layout') as { docked: boolean; workspaceTop: number | null; rootH: number };
      const tablet = Math.min(width, height) >= 700 && width > height;
      const ok = tablet ? l.docked && !!l.workspaceTop && l.workspaceTop > 0.3 * l.rootH && l.workspaceTop < 0.6 * l.rootH : !l.workspaceTop;
      log(ok, tablet ? `${name}: iPad fekvő — dokkolva, a sávok fölötte látszanak` : `${name}: telefonon / állóban teljes képernyő`, `docked ${l.docked}, top ${l.workspaceTop ?? '-'} / ${l.rootH}`);
      if (name === 'dobgép') {
        log(true, 'FOTÓZHATÓ', 'a dokkolt dobgép a sávok alatt');
        await sleep(2500);
      }
      runDevAction(close);
      await sleep(400);
    }
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instdock-del', caught));
  }
}
/**
 * 🧠 S17: a 16 kHz-es mono dekódolás hosszú forrásnál szakaszosan (20 s-os natív ablakok) — a hívó hossz nélkül
 * is (a dekóder méri); az eredmény a teljes dekódolással egyezik (hossz, korreláció), a csend-keresés is ezen fut.
 */
export async function smokeDecodeWindowed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { decodeToMono16k, detectSilenceOnDevice } = await import('@/lib/audioDecode');
  const { setLongThresholdForTest, canSegment } = await import('@/lib/longSource');
  // 45 s: hang 0–20 s, csend 20–30 s, hang 30–45 s (több 20 s-os szakaszhatáron át)
  const sr = 44100;
  const n = 45 * sr;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const txt = (at: number, x: string) => [...x].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const on = t < 20 || t >= 30;
    v.setInt16(44 + i * 2, on ? Math.round(Math.sin(2 * Math.PI * 440 * t) * 0.5 * 32767) : 0, true);
  }
  const f = new File(Paths.cache, 'smoke_decwin.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  try {
    log(canSegment(), 'a build tud szakaszosan dekódolni (natív decodeWindow)', `${canSegment()}`);
    setLongThresholdForTest(null);
    const full = await decodeToMono16k(f.uri);
    setLongThresholdForTest(10); // 45 s > 10 s → a szakaszos út, a hossz a dekóder mérése
    const t0 = Date.now();
    const win = await decodeToMono16k(f.uri);
    const ms = Date.now() - t0;
    const corrAt = (a: Float32Array, b: Float32Array, lag: number) => {
      let dot = 0, na = 0, nb = 0;
      const m = Math.min(a.length, b.length) - Math.abs(lag);
      for (let i = Math.max(0, -lag); i < m; i++) { const x = a[i], y = b[i + lag]; dot += x * y; na += x * x; nb += y * y; }
      return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
    };
    // (a) ugyanazzal az átmintavételezővel: a teljes 44,1 kHz-es dekódolás lineárisan 16 kHz-re = a szakaszos út?
    const api = (await loadAudioApi())!;
    const buf = await api.decodeAudioData(f.uri, sr);
    const { resampleLinear } = await import('@/lib/wav');
    const ref = resampleLinear(buf.getChannelData(0), sr, 16000);
    const same = win ? corrAt(ref, win, 0) : 0;
    log(!!win && Math.abs(ref.length - win.length) <= 32 && same > 0.999, 'hossz nélküli hívás: a szakaszos 16 kHz mono = a teljes dekódolás ugyanazzal az átmintavételezővel (hossz, korreláció)', `teljes ${ref.length}, szakaszos ${win?.length}, ρ ${same.toFixed(6)}, ${ms} ms`);
    // (b) a natív 16 kHz-es út az eltérő átmintavételező miatt eltolhat — a legjobb eltolás és korreláció (tájékoztató)
    let best = { lag: 0, c: 0 };
    for (let lag = -40; lag <= 40; lag++) { const c = full && win ? corrAt(full, win, lag) : 0; if (c > best.c) best = { lag, c }; }
    log(null, 'a natív 16 kHz-es teljes út vs. szakaszos', `ρ0 ${full && win ? corrAt(full, win, 0).toFixed(5) : '-'}, legjobb eltolás ${best.lag} minta (${(best.lag / 16).toFixed(2)} ms), ρ ${best.c.toFixed(5)}`);
    const sil = await detectSilenceOnDevice(f.uri);
    const hit = (sil ?? []).some((r) => r.start > 19 && r.start < 21 && r.end > 29 && r.end < 31);
    log(hit, 'a csend-keresés a szakaszos úton is megtalálja a 20–30 s csendet', JSON.stringify(sil?.map((r) => [Math.round(r.start * 10) / 10, Math.round(r.end * 10) / 10])));
  } finally {
    setLongThresholdForTest(null);
    if (f.exists) f.delete();
  }
}
/** 🎚️ S16: a hang-formátum a fájl fejlécéből valódi fájlokon (WAV 48 kHz/sztereó/24 bit, videóból kinyert M4A), és a klipszerkesztő mutatja. */
export async function smokeAudioFormat(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { readFileFormat, assetFormatFields } = await import('@/lib/media');
  // 1) 48 kHz, sztereó, 24 bites WAV (1 s)
  const sr = 48000, ch = 2, n = sr;
  const b = new Uint8Array(44 + n * ch * 3);
  const v = new DataView(b.buffer);
  const txt = (at: number, x: string) => [...x].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 3, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 3, true); v.setUint16(32, ch * 3, true); v.setUint16(34, 24, true); txt(36, 'data'); v.setUint32(40, n * ch * 3, true);
  const f = new File(Paths.cache, 'smoke_fmt48.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(b);
  const w = readFileFormat(f.uri);
  log(w.container === 'wav' && w.sampleRate === 48000 && w.channels === 2 && w.bitDepth === 24, 'WAV a fejlécből: 48 kHz, sztereó, 24 bit', JSON.stringify(w));
  // 2) a videóból kinyert M4A (natív kinyerés) — mintavétel és csatornák az mp4a leíróból
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, 'smoke_fmt_vid.mp4');
  const ex = vid ? await extractVideoAudio(vid, 'smoke_fmt.mp4') : null;
  const m = ex && ex.ok ? readFileFormat(ex.uri) : {};
  let headHex = '-';
  if (ex && ex.ok) {
    const h = new File(ex.uri).open();
    try { headHex = Array.from(h.readBytes(16)).map((x) => x.toString(16).padStart(2, '0')).join(' '); } finally { h.close(); }
  }
  // 2026-11-14: a videóból kinyert hang WAV (mintára pontos, 44,1 kHz, 16 bit) — az mp4a-leíró olvasását a
  // videófájl maga méri tovább
  log(m.container === 'wav' && m.sampleRate === 44100 && m.channels === 2 && m.bitDepth === 16, 'WAV (videóból kinyerve) a fejlécből: 44,1 kHz, sztereó, 16 bit', `${JSON.stringify(m)} · kinyerés ${vid ? (ex && ex.ok ? 'ok' : JSON.stringify(ex)) : 'nincs videó'} · fej ${headHex}`);
  const mv = vid ? readFileFormat(vid) : {};
  log(mv.container === 'm4a' && mv.sampleRate === 48000 && mv.channels === 2, 'a videófájl hangja (mp4a-leíró) a fejlécből: 48 kHz, sztereó', JSON.stringify(mv));
  // 3) a klipszerkesztő mutatja (az asset mezőiből)
  const id = 'prj_smoke_fmt';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fmt', caught));
  const base = createEmptyProject('smoke formátum', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: f.uri, assetId: 'a1', start: 0, duration: 1, trimIn: 0, sourceDuration: 1, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, assets: [{ id: 'a1', kind: 'audio', uri: f.uri, provider: 'local', name: 'hang', duration: 1, ...assetFormatFields(w) }], tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  try {
    const a = st().project?.assets.find((x) => x.id === 'a1');
    log(a?.sampleRate === 48000 && a.channels === 2 && a.bitDepth === 24, 'a formátum az asseten megmarad (mentés + betöltés)', JSON.stringify({ sr: a?.sampleRate, ch: a?.channels, bit: a?.bitDepth }));
    st().selectClip('c');
    runDevAction('audio.editClip');
    await sleep(900);
    log(true, 'FOTÓZHATÓ', 'a klipszerkesztő fejlécében: 48 kHz · sztereó · 24 bit');
    await sleep(1500);
    runDevAction('clipEdit.done');
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fmt-del', caught));
    if (f.exists) f.delete();
  }
}
/** 🔍 C6: „Hol használom?" — a hang-projektre hivatkozó videók listája (új és meglévő videóba küldve), a frissíthetők jelölve. */
export async function smokeUsages(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const audioId = 'prj_smoke_usage_audio';
  const created: string[] = [];
  await deleteProject(audioId).catch((caught) => logCaught('lib/imageSmoke.tsx:usages', caught));
  const base = createEmptyProject('smoke használat dal', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_usage.wav', 2), start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const audio: Project = { ...base, id: audioId, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  await saveProject(audio);
  const st = useEditorStore.getState;
  try {
    // 1) egy meglévő videó-projektbe és egy újba küldve (hivatkozással)
    const existing = { ...createEmptyProject('smoke használat A', '9:16', undefined, 'video'), id: 'prj_smoke_usage_va' };
    await saveProject(existing);
    created.push(existing.id);
    const v1 = await sendMixdownToVideo(audio, existing, { newName: '-' });
    const v2 = await sendMixdownToVideo(audio, null, { newName: 'smoke használat B' });
    if (v2) created.push(v2.id);
    log(null, 'diag0', `v1 ${v1?.id}, v2 ${v2?.id}`);
    router.push(`/studio/audio/${audioId}` as Href);
    const t0 = Date.now();
    for (let i = 0; i < 150 && st().project?.id !== audioId; i++) await sleep(200);
    log(null, 'diag1', `${Date.now() - t0} ms, projekt ${st().project?.id}`);
    log(true, 'FOTÓZHATÓ', 'nav');
    await sleep(4000);
    await sleep(1000);
    log(null, 'diag', `stúdió ${String(runDevAction('audio.workspace'))}, projekt ${st().project?.id}, akció ${typeof runDevAction('audio.usages')}`);
    const u1 = (await runDevAction('audio.usages')) as string[] | null;
    log(!!v1 && !!v2 && JSON.stringify(u1) === JSON.stringify(['smoke használat A', 'smoke használat B']), '„Hol használom?": a két hivatkozó videó (a meglévő és az új), név szerint', String(JSON.stringify(u1)));
    // 2) a zene változik → mindkettő frissíthető
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'c', patch: { volume: 1 } }, 'user');
    const u2 = (await runDevAction('audio.usages')) as string[] | null;
    log(JSON.stringify(u2) === JSON.stringify(['smoke használat A*', 'smoke használat B*']), 'a zene módosítása után mindkét videó „frissíthető"', JSON.stringify(u2));
  } finally {
    router.back();
    await sleep(500);
    for (const id of [audioId, ...created]) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:usages-del', caught));
  }
}
/** ▶️ C4: a Podcast-sablon a valódi létrehozási úton elindítja a Podcast-epizód munkafolyamatot; lépések, kihagyás, egy undo, a vége. */
export async function smokeWorkflow(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { currentStep, finishCurrent, isRunComplete, runProgress } = await import('@/lib/workflowTemplate');
  const st = useEditorStore.getState;
  const name = 'smoke munkafolyamat';
  let createdId: string | null = null;
  try {
    router.replace('/studio' as Href);
    await sleep(1500);
    runDevAction('studio.fillCreate', { name, kind: 'audio', audioTemplate: 'podcast' });
    await sleep(400);
    await runDevAction('studio.create');
    for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
    await sleep(1200);
    const p = st().project;
    createdId = p?.name === name ? p.id : null;
    const r0 = p?.workflowRun;
    log(!!r0 && r0.templateId === 'podcast-episode' && currentStep(r0)?.id === 'record' && r0.steps.length === 8, 'a Podcast-sablon elindítja a Podcast-epizód munkafolyamatot (8 lépés, a felvétel fut)', r0 ? `${r0.templateId}, ${currentStep(r0)?.id}` : 'nincs futás');
    log(true, 'FOTÓZHATÓ', 'a munkafolyamat-sáv a Hang Stúdió tetején');
    await sleep(2000);
    // kész → szinkron; kihagyás → tisztítás; egy undo → vissza a szinkronra
    const now = () => new Date().toISOString();
    st().dispatch({ type: 'SET_WORKFLOW_RUN', run: finishCurrent(st().project!.workflowRun!, 'done', now()) }, 'user');
    st().dispatch({ type: 'SET_WORKFLOW_RUN', run: finishCurrent(st().project!.workflowRun!, 'skipped', now()) }, 'user');
    const r1 = st().project!.workflowRun!;
    st().undo();
    const r2 = st().project!.workflowRun!;
    log(currentStep(r1)?.id === 'clean' && currentStep(r2)?.id === 'sync' && runProgress(r1).skipped === 1, 'kész / kihagyás a következő lépésre lép (egy parancs); egy visszavonás visszalép', `${currentStep(r1)?.id} → undo → ${currentStep(r2)?.id}`);
    // a végéig; mentés + újratöltés után is megvan
    let r = st().project!.workflowRun!;
    while (currentStep(r)) {
      st().dispatch({ type: 'SET_WORKFLOW_RUN', run: finishCurrent(r, 'done', now()) }, 'user');
      r = st().project!.workflowRun!;
    }
    await saveProject(st().project!);
    const reloaded = await loadProject(st().project!.id);
    log(isRunComplete(r) && !!reloaded?.workflowRun && isRunComplete(reloaded.workflowRun), 'a munkafolyamat végigmegy, és mentés + újratöltés után is megvan', `${runProgress(r).done}/${runProgress(r).total}`);
    st().dispatch({ type: 'SET_WORKFLOW_RUN', run: null }, 'user');
    log(!st().project!.workflowRun, 'a sáv bezárása a futást lezárja', '');
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name === name).map((m) => m.id);
    for (const id of new Set([...(createdId ? [createdId] : []), ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:wf-del', caught));
      await deleteCloudProject(id);
    }
  }
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
/** 🎼 V1: MIDI ki → be a piano rollban (valódi fájl a projekt Export-mappájában): azonos hangok, tört hosszal és erősséggel; a sütés egy undo. */
export async function smokeMidi(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_midi';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:midi', caught));
  await saveProject({ ...createEmptyProject('smoke midi', '9:16', undefined, 'audio'), id, bpm: 100 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  try {
    runDevAction('audio.openPianoRoll');
    for (let i = 0; i < 50 && runDevAction('synth.notesFull') === undefined; i++) await sleep(100);
    runDevAction('synth.set', { notes: [{ midi: 60, startBeat: 0, lengthBeats: 1.5, velocity: 127 }, { midi: 64, startBeat: 2, lengthBeats: 0.25, velocity: 50 }, { midi: 67, startBeat: 3, lengthBeats: 1, velocity: 100 }], bars: 1 });
    await sleep(400);
    const before = String(runDevAction('synth.notesFull'));
    const uri = (await runDevAction('synth.midiExport')) as string;
    const exists = !!uri && new File(uri).exists && (new File(uri).size ?? 0) > 30;
    log(exists, 'MIDI ki: a dallam .mid fájlként a projekt Export-mappájában', `${uri?.split('/').slice(-2).join('/')} · ${new File(uri).size} B`);
    runDevAction('synth.set', { notes: [], bars: 1 });
    await sleep(300);
    const ok = runDevAction('synth.midiImport', uri) === true;
    await sleep(400);
    const after = String(runDevAction('synth.notesFull'));
    const vel = String(runDevAction('synth.notes'));
    log(ok && after === before && vel === '60@0v127,64@2v50,67@3v100', 'MIDI be: ugyanazok a hangok (kezdet, hossz, erősség)', `${after} · ${vel}`);
    runDevAction('synth.bake');
    for (let i = 0; i < 100 && (st().project!.tracks.find((t) => t.type === 'music')!.clips.length === 0); i++) await sleep(100);
    const n = st().project!.tracks.find((t) => t.type === 'music')!.clips.length;
    st().undo();
    await sleep(200);
    log(n === 1 && st().project!.tracks.find((t) => t.type === 'music')!.clips.length === 0, 'a behúzott dallam sütése egy klip, egy visszavonás', `${n}`);
  } finally {
    runDevAction('audio.closePianoRoll');
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:midi-del', caught));
  }
}
/** 🎯 V12: az export-lapon a profil (podcast) javasolt formátuma, a cél és a mért hangosság ítélete; „Profil szerint” alkalmazza. */
export async function smokeExportProfile(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { masterPreset } = await import('@/lib/audioMaster');
  const { useReference } = await import('@/store/referenceStore');
  const id = 'prj_smoke_exprof';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:exprof', caught));
  const base = createEmptyProject('smoke export-profil', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_exprof.wav', 2), start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, audioMaster: masterPreset('podcast'), tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  try {
    useReference.getState().setMixLufs(-16.3);
    runDevAction('audio.exportSheet');
    await sleep(800);
    type S = { format: string; quality: { sampleRate: number; channels: number; bitDepth: number; bitrateKbps: number }; rec: { format: string; quality: { sampleRate: number; channels: number; bitDepth: number; bitrateKbps: number } } | null; verdict: string | null };
    const s0 = runDevAction('exportSheet.state') as S;
    const pro = s0.rec?.format === 'mp3';
    const recOk = pro ? s0.rec!.quality.channels === 1 && s0.rec!.quality.bitrateKbps === 128 : s0.rec?.format === 'wav' && s0.rec.quality.sampleRate === 44100 && s0.rec.quality.channels === 1;
    log(!!s0.rec && recOk && s0.verdict === 'ok', `podcast-profil: javaslat ${pro ? 'MP3 128 kbps mono (Pro)' : 'telefonos WAV 44,1 kHz mono (Free)'}; a mért −16,3 LUFS a −16-os célon`, JSON.stringify({ rec: s0.rec, verdict: s0.verdict }));
    useReference.getState().setMixLufs(-19);
    await sleep(300);
    const s1 = runDevAction('exportSheet.state') as S;
    log(s1.verdict === 'quiet', 'a mért −19 LUFS: „halkabb a célnál”', `${s1.verdict}`);
    runDevAction('exportSheet.applyProfile');
    await sleep(300);
    const s2 = runDevAction('exportSheet.state') as S;
    log(s2.format === s0.rec!.format && JSON.stringify(s2.quality) === JSON.stringify(s0.rec!.quality), '„Profil szerint”: a lap a javasolt formátumra és minőségre áll', `${s2.format} ${JSON.stringify(s2.quality)}`);
    log(true, 'FOTÓZHATÓ', 'az export-lap profil-sora');
    await sleep(1500);
  } finally {
    useReference.getState().setMixLufs(null);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:exprof-del', caught));
  }
}
/** 🎧 AUDIO-PROD (telefonos WAV-opciók): mono és 48 kHz a telefonos exportban — pontos fejléc és hossz, a tartalom
 *  a 44,1 kHz-es sztereó keverés mono-átlaga a pure átmintavételezőn át (a 16 bites kvantálás pontosságával). */
export async function smokeWavOptions(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { readFileFormat } = await import('@/lib/media');
  const { StreamResampler } = await import('@/lib/streamResampler');
  const base = createEmptyProject('smoke wav-opciók', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_wavopt.wav', 3), start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.6, fadeIn: 0.2, fadeOut: 0.2, source: 'imported' };
  const project = { ...base, id: 'prj_smoke_wavopt', tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  const readAll = (uri: string) => {
    const h = new File(uri).open();
    try {
      return h.readBytes(h.size ?? 0);
    } finally {
      h.close();
    }
  };
  const uris: string[] = [];
  try {
    const ref = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_ref.wav'), undefined, undefined, 'float32');
    uris.push(ref.uri);
    const rb = readAll(ref.uri);
    const rv = new DataView(rb.buffer, rb.byteOffset);
    const n = (rb.length - 44) / 8;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (rv.getFloat32(44 + i * 8, true) + rv.getFloat32(48 + i * 8, true)) * 0.5;
    const rs = new StreamResampler(44100, 48000, 1);
    const a = rs.process([mono])[0];
    const b = rs.flush()[0];
    const expect = new Float32Array(a.length + b.length);
    expect.set(a);
    expect.set(b, a.length);
    const t0 = Date.now();
    const out = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_m48.wav'), undefined, undefined, 'pcm16', { bits: 16, channels: 1, sampleRate: 48000 });
    const ms = Date.now() - t0;
    uris.push(out.uri);
    const fmt = readFileFormat(out.uri);
    const ob = readAll(out.uri);
    const frames = StreamResampler.outFrames(n, 44100, 48000);
    log(fmt.container === 'wav' && fmt.sampleRate === 48000 && fmt.channels === 1 && fmt.bitDepth === 16 && ob.length === 44 + frames * 2, 'mono 48 kHz 16 bit: a fejléc és a fájlméret pontos', `${JSON.stringify(fmt)} · ${ob.length} bájt (várt ${44 + frames * 2}) · ${ms} ms`);
    const ov = new DataView(ob.buffer, ob.byteOffset);
    let d = 0;
    for (let i = 0; i < frames; i++) d = Math.max(d, Math.abs(ov.getInt16(44 + i * 2, true) / 32767 - expect[i]));
    log(d <= 1.55 / 32767, 'a tartalom = a sztereó keverés mono-átlaga 48 kHz-en (a pure átmintavételező; 16 bit TPDF-ditherrel ≤ 1,5 LSB)', `max eltérés ${(d * 32767).toFixed(2)} LSB`);
    const st24 = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_s48.wav'), undefined, undefined, 'pcm16', { bits: 24, channels: 2, sampleRate: 48000 });
    uris.push(st24.uri);
    const f2 = readFileFormat(st24.uri);
    const sz = new File(st24.uri).size ?? 0;
    log(f2.sampleRate === 48000 && f2.channels === 2 && f2.bitDepth === 24 && sz === 44 + frames * 6, 'sztereó 48 kHz 24 bit: fejléc és méret', `${JSON.stringify(f2)} · ${sz} bájt`);
    const m44 = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_wavopt_m44.wav'), undefined, undefined, 'pcm16', { channels: 1 });
    uris.push(m44.uri);
    const mb = readAll(m44.uri);
    const mv = new DataView(mb.buffer, mb.byteOffset);
    let dm = 0;
    for (let i = 0; i < n; i++) dm = Math.max(dm, Math.abs(mv.getInt16(44 + i * 2, true) / 32767 - mono[i]));
    log(readFileFormat(m44.uri).channels === 1 && mb.length === 44 + n * 2 && dm <= 1.55 / 32767, 'mono 44,1 kHz (podcast): átmintavételezés nélkül, a mono-átlag mintára (dither ≤ 1,5 LSB)', `${mb.length} bájt · max eltérés ${(dm * 32767).toFixed(2)} LSB`);
  } finally {
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
  }
}
/** 🎧 V6: mintapontos vágás — hang-projektben a vágás a mintára ül, és a kettévágott klip exportja a vágatlannal
 *  mintára (bitre) egyezik; a videó-projekt marad a frame-rácson. Zajforrás (egy minta csúszása is látszana). */
export async function smokeSampleGrid(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const n = 3 * SR;
  const b = new Uint8Array(44 + n * 4);
  const v = new DataView(b.buffer);
  const txt = (at: number, x: string) => [...x].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 4, true);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n * 2; i++) v.setInt16(44 + i * 2, Math.round(rnd() * 12000), true);
  const src = new File(Paths.cache, 'smoke_grid_noise.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(b);
  const id = 'prj_smoke_grid';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:grid', caught));
  const base = createEmptyProject('smoke minta-rács', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'zaj', uri: src.uri, start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, fps: 30, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const readF32 = (uri: string) => {
    const h = new File(uri).open();
    try {
      const bytes = h.readBytes(h.size ?? 0);
      return new Float32Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
    } finally {
      h.close();
    }
  };
  const uris: string[] = [];
  try {
    const ref = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_grid_ref.wav'), undefined, undefined, 'float32');
    uris.push(ref.uri);
    const at = 1.23456;
    st().splitClipAt('c', at);
    const clips = st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
    const right = clips.find((x) => x.start > 0);
    const k = right ? right.start * SR : NaN;
    log(clips.length === 2 && Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) === Math.round(at * SR) && Math.abs(right!.start * 30 - Math.round(right!.start * 30)) > 0.01, 'a vágás a mintára ül (nem a 30 fps-es képkockára)', `${right?.start} s = ${k.toFixed(6)} minta (képkocka-rácson ${(Math.round(at * 30) / 30).toFixed(5)} s lett volna, ${Math.round(Math.abs(Math.round(at * 30) / 30 - at) * SR)} minta eltérés)`);
    const cut = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_grid_cut.wav'), undefined, undefined, 'float32');
    uris.push(cut.uri);
    const ra = readF32(ref.uri);
    const ca = readF32(cut.uri);
    let d = 0;
    let dAround = 0;
    const cutS = Math.round(at * SR) * 2;
    for (let i = 0; i < Math.min(ra.length, ca.length); i++) {
      const e = Math.abs(ra[i] - ca[i]);
      d = Math.max(d, e);
      if (Math.abs(i - cutS) < 2000) dAround = Math.max(dAround, e);
    }
    log(ra.length === ca.length && d === 0, 'null-teszt: a kettévágott klip exportja a vágatlannal mintára egyezik (a vágáspont körül is)', `${ra.length / 2} minta, max eltérés ${d} (vágás ±1000 minta: ${dAround})`);
    st().undo();
    const back = st().project!.tracks.find((t) => t.type === 'music')!.clips.length;
    log(back === 1, 'egy visszavonás: újra egy klip', `${back}`);
    st().setPlayhead(2.000013, true);
    log(Math.abs(st().playhead * SR - Math.round(st().playhead * SR)) < 1e-6 && Math.round(st().playhead * SR) === Math.round(2.000013 * SR), 'a lejátszófej (koppintás/scrub) is a mintára ül', `${st().playhead}`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:grid-del', caught));
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
    if (src.exists) src.delete();
  }
}
/** 🎛️ V7: parametrikus EQ és tempóhoz kötött delay a telefonos exportban — a visszhang a tempóból számolt helyen
 *  (tempóváltás után is, egy undo-lépésben), a sáv a beállított frekvencián emel. */
export async function smokeFxParams(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const wav = (name: string, fill: (i: number) => number, seconds: number) => {
    const n = Math.round(seconds * SR);
    const b = new Uint8Array(44 + n * 2);
    const v = new DataView(b.buffer);
    const txt = (at: number, x: string) => [...x].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(fill(i) * 32767), true);
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.write(b);
    return f.uri;
  };
  const clickAt = Math.round(0.5 * SR);
  const clickUri = wav('smoke_fx_click.wav', (i) => (i === clickAt ? 0.9 : 0), 2);
  const sineUri = wav('smoke_fx_sine.wav', (i) => 0.25 * Math.sin((2 * Math.PI * 3000 * i) / SR), 1);
  const id = 'prj_smoke_fxparam';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fxparam', caught));
  const base = createEmptyProject('smoke fx-paraméterek', '9:16', undefined, 'audio');
  const mk = (cid: string, uri: string, dur: number): AudioClip => ({ kind: 'audio', id: cid, label: cid, uri, start: 0, duration: dur, trimIn: 0, sourceDuration: dur, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('click', clickUri, 2)] } : t.type === 'sfx' ? { ...t, clips: [mk('sine', sineUri, 1)] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const uris: string[] = [];
  const readL = (uri: string) => {
    const h = new File(uri).open();
    try {
      const bytes = h.readBytes(h.size ?? 0);
      const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
      return Float32Array.from({ length: f.length / 2 }, (_, i) => f[i * 2]);
    } finally {
      h.close();
    }
  };
  const only = (keep: string) => {
    const p = st().project!;
    return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id === keep) })) };
  };
  const echoAt = async (name: string) => {
    const out = await exportOfflineWav(only('click'), new File(projectExportDir(), name), undefined, undefined, 'float32');
    uris.push(out.uri);
    const l = readL(out.uri);
    let peak = 0;
    let at = -1;
    for (let i = clickAt + 200; i < l.length; i++) if (Math.abs(l[i]) > peak) { peak = Math.abs(l[i]); at = i; }
    return { ms: ((at - clickAt) / SR) * 1000, peak };
  };
  try {
    // 1) delay 1/8 120 BPM-en → 250 ms
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'click', patch: { audioFx: { delay: 0.8, delayBeats: 0.5 } } }, 'user');
    const fx1 = (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).audioFx;
    const e1 = await echoAt('smoke_fx_d1.wav');
    log(fx1?.delayMs === 250 && Math.abs(e1.ms - 250) < 0.05, 'delay 1/8 120 BPM-en: a visszhang 250 ms-nál (a telefonos exportban)', `delayMs ${fx1?.delayMs} · visszhang ${e1.ms.toFixed(2)} ms (csúcs ${e1.peak.toFixed(2)})`);
    // 2) tempóváltás 90 BPM → 1/8 = 333 ms, egy undo-lépés
    const hist = st().past?.length ?? 0;
    st().dispatch({ type: 'SET_BPM', bpm: 90 }, 'user');
    const fx2 = (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).audioFx;
    const e2 = await echoAt('smoke_fx_d2.wav');
    log(fx2?.delayMs === 333 && Math.abs(e2.ms - 333) < 0.05 && (st().past?.length ?? 0) === hist + 1, 'tempóváltás 90 BPM-re: a delay követi (333 ms), egy undo-lépésben', `delayMs ${fx2?.delayMs} · visszhang ${e2.ms.toFixed(2)} ms · history +${(st().past?.length ?? 0) - hist}`);
    st().undo();
    const fx3 = (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).audioFx;
    log(st().project!.bpm === 120 && fx3?.delayMs === 250, 'visszavonás: a tempó és a delay együtt áll vissza', `${st().project!.bpm} BPM · ${fx3?.delayMs} ms`);
    // 3) parametrikus EQ: +9 dB 3 kHz-en, Q 4
    const gain = async (fx: AudioFx | undefined, name: string) => {
      st().dispatch({ type: 'UPDATE_CLIP', clipId: 'sine', patch: { audioFx: fx } }, 'user');
      const out = await exportOfflineWav(only('sine'), new File(projectExportDir(), name), undefined, undefined, 'float32');
      uris.push(out.uri);
      const l = readL(out.uri);
      let e = 0;
      for (let i = SR / 4; i < (3 * SR) / 4; i++) e += l[i] * l[i];
      return 10 * Math.log10(e / (SR / 2));
    };
    const g0 = await gain(undefined, 'smoke_fx_e0.wav');
    const gParam = await gain({ eq: { low: 0, mid: 9, high: 0, midFreq: 3000, midQ: 4 } }, 'smoke_fx_e1.wav');
    const gOld = await gain({ eq: { low: 0, mid: 9, high: 0 } }, 'smoke_fx_e2.wav');
    log(Math.abs(gParam - g0 - 9) < 0.5 && gOld - g0 < 1.5, 'parametrikus EQ: a 3 kHz-re állított sáv +9 dB-t emel; a régi fix 1 kHz-es sáv ott alig', `paraméteres ${(gParam - g0).toFixed(2)} dB · régi ${(gOld - g0).toFixed(2)} dB`);
    st().selectClip('sine');
    runDevAction('audio.editClip');
    await sleep(900);
    log(true, 'FOTÓZHATÓ', 'a klipszerkesztő: parametrikus EQ és a delay ütemrész-választója');
    await sleep(1500);
    runDevAction('clipEdit.done');
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fxparam-del', caught));
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
  }
}
