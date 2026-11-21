/** 🧪 Füstteszt — zene: piano roll, dobgép, MIDI, akkordmenet. (Áthelyezve: phases12, phases13; viselkedés-változás nélkül.) */
import { File } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import '@/lib/dspNativeClient';

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
/** 🎼 V3.1: akkordmenet — a pop-menet (I–V–vi–IV) C-dúrban 4 részre, 4 sávra, egy undo; a telefonos exportban
 *  ütemenként a három legerősebb hangosztály pontosan az akkord hangjai (C · G · Am · F). */
export async function smokeChords(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const id = 'prj_smoke_chords';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:chords', caught));
  const base = createEmptyProject('smoke akkordok', '9:16', undefined, 'audio');
  await saveProject({ ...base, id, bpm: 100 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  try {
    st().setPlayhead(0);
    const tracks0 = st().project!.tracks.length;
    runDevAction('audio.chords');
    await sleep(600);
    const t0 = Date.now();
    const ids = (await runDevAction('chords.place', { key: { root: 0, scale: 'major' }, prog: 'pop', parts: ['chords', 'bass', 'arp', 'drums'] })) as string[];
    const ms = Date.now() - t0;
    const p = st().project!;
    const clipsOf = ids.map((cid) => ({ clip: p.tracks.flatMap((t) => t.clips).find((c) => c.id === cid) as AudioClip, track: p.tracks.find((t) => t.clips.some((c) => c.id === cid))?.type }));
    const kinds = clipsOf.map(({ clip }) => p.instrumentDocs?.find((d) => d.id === clip?.instrumentDocId)?.kind);
    log(ids.length === 4 && new Set(clipsOf.map((x) => x.track)).size === 4 && p.tracks.length === tracks0 + 3 && kinds.filter((k) => k === 'synth').length === 3 && kinds.includes('drums'), '4 rész 4 sávon (a 3 új sáv a kötegben jött létre), mind szerkeszthető minta', `${clipsOf.map((x) => x.track).join(', ')} · ${kinds.join(', ')} · ${ms} ms`);
    // az akkord-rész exportja: ütemenként a hangosztályok energiája (Goertzel, 3–5. oktáv)
    const chordClip = clipsOf[0].clip;
    const only = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id === chordClip.id) })) };
    const out = await exportOfflineWav(only, new File(projectExportDir(), 'smoke_chords.wav'), undefined, undefined, 'float32');
    const h = new File(out.uri).open();
    let x: Float32Array;
    try {
      const b = h.readBytes(h.size ?? 0);
      const f = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
      x = Float32Array.from({ length: f.length / 2 }, (_, i) => f[i * 2]);
    } finally {
      h.close();
      new File(out.uri).delete();
    }
    const goertzel = (a: number, n: number, hz: number) => {
      const w = (2 * Math.PI * hz) / SR;
      const c = 2 * Math.cos(w);
      let s1 = 0;
      let s2 = 0;
      for (let i = a; i < a + n; i++) {
        const s0 = x[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return s1 * s1 + s2 * s2 - c * s1 * s2;
    };
    const bar = (4 * 60) / 100;
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const want = [['C', 'E', 'G'], ['D', 'G', 'B'], ['A', 'C', 'E'], ['A', 'C', 'F']];
    const got = [0, 1, 2, 3].map((k) => {
      const a = Math.round((k * bar + 0.3) * SR);
      const n = Math.round(1.2 * SR);
      const e = names.map((_, pc) => [48, 60, 72].reduce((sum, o) => sum + goertzel(a, n, 440 * Math.pow(2, (o + pc - 69) / 12)), 0));
      return e.map((v, pc) => [v, pc] as const).sort((p1, p2) => p2[0] - p1[0]).slice(0, 3).map(([, pc]) => names[pc]).sort();
    });
    log(got.every((g, k) => JSON.stringify(g) === JSON.stringify([...want[k]].sort())), 'a telefonos exportban ütemenként az akkord hangjai: C · G · Am · F', got.map((g) => g.join('')).join(' | '));
    st().undo();
    const p2 = st().project!;
    log(p2.tracks.length === tracks0 && !ids.some((cid) => p2.tracks.some((t) => t.clips.some((c) => c.id === cid))), 'egy visszavonás: a 4 klip és a 3 új sáv is eltűnik', `${p2.tracks.length} sáv`);
    runDevAction('audio.chords');
    await sleep(800);
    log(true, 'FOTÓZHATÓ', 'az Akkordmenet lap');
    await sleep(1500);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:chords-del', caught));
  }
}
