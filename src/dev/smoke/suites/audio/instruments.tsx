/** 🧪 Füstteszt — hangszerek: offline beégetés, velocity/swing, hangszer-szerkesztés, dokkolás. (Áthelyezve: phases08, phases09, phases12; viselkedés-változás nélkül.) */
import { File } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { warmPreview, auditionNote, lastStartMs, auditionDrum, playPcm, previewPosition, previewLooping, stopPreview, lastLoopPcm } from '@/lib/instrumentPreview';
import { renderSynthPcm, renderDrumsPcm, renderSamplerPcm } from '@/lib/instrumentRender';
import { decodeSample } from '@/lib/instrumentClient';
import { renderSynthToClip } from '@/lib/synthClient';
import { renderDrumsToClip } from '@/lib/drumsClient';
import { renderSamplerToClip } from '@/lib/samplerClient';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { type Log, sleep } from '../../helpers/core';
import { toneWav } from '../../helpers/audio';
import { emptyPattern, DRUM_ACCENT, DRUM_SOFT, patternHits } from '@/lib/drums';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import { emptySampler } from '@/lib/sampler';
import type { AudioClip } from '@/types/project';
import '@/lib/dspNativeClient';

/** 🎹🥁🎛️ Hangszerek offline: beégetés a telefonon (WAV = az előhallgatott PCM), élő előhallgatás, a dobgép szól. */
export async function smokeInstruments(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const maxDiff = (a: Float32Array, b: Float32Array) => {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  // 1) beégetés a telefonon — a fájl az, amit az előhallgatás játszik
  const notes = [{ id: 'a', midi: 60, startBeat: 0, lengthBeats: 1 }, { id: 'b', midi: 64, startBeat: 1, lengthBeats: 1 }, { id: 'c', midi: 67, startBeat: 2, lengthBeats: 2, velocity: 80 }];
  let t0 = Date.now();
  const syn = await renderSynthToClip(notes, { bpm: 120, wave: 'square' });
  const synMs = Date.now() - t0;
  const synD = syn ? maxDiff(await left(syn.uri), renderSynthPcm(notes, 'square', 120)[0]) : 1;
  log(!!syn && syn.uri.endsWith('.wav') && synD < 1e-4 && Math.abs(syn.durationSec - 2) < 1e-6, 'synth: a telefonon (WAV, szerver nélkül), a fájl = az előhallgatott hang', `${synMs} ms, ${syn?.durationSec} s, eltérés ${synD.toExponential(1)} (16 bit)`);
  const hits = [{ voice: 'kick' as const, step: 0 }, { voice: 'snare' as const, step: 4 }, { voice: 'hihat' as const, step: 2 }, { voice: 'clap' as const, step: 12 }];
  t0 = Date.now();
  const dr = await renderDrumsToClip(hits, { bpm: 120, bars: 1 });
  const drD = dr ? maxDiff(await left(dr.uri), renderDrumsPcm(hits, 1, 120)[0]) : 1;
  log(!!dr && dr.uri.endsWith('.wav') && drD < 1e-4 && Math.abs(dr.durationSec - 2) < 1e-6, 'dobgép: a telefonon, pontosan a rács hossza (loopolható)', `${Date.now() - t0} ms, ${dr?.durationSec} s, eltérés ${drD.toExponential(1)}`);
  const sampleUri = toneWav('smoke_instr_sample.wav', 0.2);
  t0 = Date.now();
  const pattern = Array.from({ length: 16 }, (_, i) => i % 4 === 0);
  const sm = await renderSamplerToClip(sampleUri, pattern, { bpm: 120, bars: 1 });
  const sample = await decodeSample(sampleUri);
  const smD = sm && sample ? maxDiff(await left(sm.uri), renderSamplerPcm(sample, [0, 4, 8, 12], 1, 120)[0]) : 1;
  log(!!sm && sm.uri.endsWith('.wav') && smD < 1e-4, 'sampler: a saját minta a telefonon a lépésekre', `${Date.now() - t0} ms, ${sm?.durationSec} s, eltérés ${smD.toExponential(1)}`);
  for (const c of [syn, dr, sm]) if (c) new File(c.uri).delete();
  // 2) élő előhallgatás (a lap megnyitása előkészíti a hangkontextust)
  await warmPreview();
  const a1 = await auditionNote(64, 'triangle', 120);
  log(a1 && lastStartMs < 30, 'koppintás (a lap nyitása után): a hang azonnal megszólal', `indítás ${lastStartMs} ms`);
  const a2 = await auditionDrum('snare');
  log(a2 && lastStartMs < 30, 'koppintás: a dob azonnal megszólal', `indítás ${lastStartMs} ms`);
  const loopPcm = renderDrumsPcm(hits, 1, 120);
  await playPcm(loopPcm, true);
  await sleep(700);
  const p1 = previewPosition() ?? -1;
  log(previewLooping() && p1 > 0.5 && p1 < 0.95, 'a minta loopolva szól, a lejátszófej halad (a hangkimenet órája)', `${p1.toFixed(3)} s 700 ms után`);
  await playPcm(renderDrumsPcm([...hits, { voice: 'kick', step: 8 }], 1, 120), true, true);
  const p2 = previewPosition() ?? -1;
  log(Math.abs(p2 - p1) < 0.15, 'szerkesztés közben: az új minta a lejátszófej helyéről folytatódik', `${p1.toFixed(3)} → ${p2.toFixed(3)} s`);
  await sleep(1800);
  const p3 = previewPosition() ?? -1;
  log(p3 >= 0 && p3 < 2, 'a loop körbefordul (2 s-os rács)', `${p3.toFixed(3)} s`);
  stopPreview();
  log(!previewLooping(), 'Állj: elhallgat', '');
  // 3) a dobgép a stúdióban, a „▶” gombbal
  const id = 'prj_smoke_instruments';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instruments', caught));
  const base = createEmptyProject('smoke hangszerek', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.openDrums');
  await sleep(800);
  const n = runDevAction('drums.demo') as number;
  await sleep(300);
  const playing = (await runDevAction('preview.drums-play')) as boolean;
  await sleep(600);
  log(n === 12 && playing && previewLooping() && (previewPosition() ?? 0) > 0.3, 'a dobgép „▶” gombja: a demó-ütem (12 ütés) loopolva szól', `${n} ütés, ${(previewPosition() ?? -1).toFixed(2)} s`);
  log(true, 'FOTÓZHATÓ', 'a dobgép a demó-ütemmel, a „Lejátszás” gomb aktív');
  await sleep(3000);
  await runDevAction('preview.drums-play');
  log(!previewLooping(), 'a gomb újra: elhallgat', '');
  router.back();
}

/**
 * 🥁🎹 R7: velocity + swing — a dobgép és a piano roll a felületen át (dev-akciók) beállítva,
 * „Sávra” sütve, a fájlon mérve: a velocity a csúcsszintben, a swing a páros 16-odok késésében
 * (± 1 ms); az élő előhallgatás („▶”) PCM-je = a beégetett klip.
 */
export async function smokeVelSwing(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const peakOf = (x: Float32Array, a: number, b: number) => {
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) m = Math.max(m, Math.abs(x[i]));
    return m;
  };
  const maxDiff = (a: Float32Array, b: Float32Array) => {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  const id = 'prj_smoke_velswing';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:velswing', caught));
  const base = createEmptyProject('smoke velocity swing', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const musicClips = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const waitClip = async (n: number) => {
    for (let i = 0; i < 100 && musicClips().length < n; i++) await sleep(100);
    return musicClips()[n - 1];
  };
  const created: string[] = [];
  try {
    // 1) dobgép: hihat az 1–4. 16-odon; a 2. hangsúlyos, a 3. halk; swing 40 %
    runDevAction('audio.openDrums');
    await sleep(800);
    const pattern = { ...emptyPattern(1), hihat: Array.from({ length: 16 }, (_, i) => i < 4) };
    runDevAction('drums.set', { pattern, velocity: { hihat: [undefined, DRUM_ACCENT, DRUM_SOFT] }, swing: 0.4 });
    await sleep(300);
    const hits = runDevAction('drums.hits') as string;
    log(hits === 'hihat0,hihat1.4v127,hihat2v64,hihat3.4', 'a dobgép ütései: a páros 16-odok 40 %-kal később, a szint ütésenként', hits);
    // élő előhallgatás (a „Sávra” bezárja a lapot → előtte)
    const playing = (await runDevAction('preview.drums-play')) as boolean;
    await sleep(500);
    const dLive = playing && previewLooping() ? (lastLoopPcm?.[0] ?? null) : null;
    log(true, 'FOTÓZHATÓ', 'a dobgép: a hangsúlyos (fehér keret) és a halk (halvány) ütés, swing 40 %');
    await sleep(2500);
    await runDevAction('preview.drums-play');
    runDevAction('drums.bake');
    const dc = await waitClip(1);
    if (!dc?.uri) {
      log(false, 'a dobminta a sávra kerül', 'nincs klip');
      return;
    }
    created.push(dc.uri);
    const d = await left(dc.uri);
    const step = 0.125; // 120 BPM, 16-od
    const onsetMs = (fromSec: number) => {
      const i0 = Math.round(fromSec * SR);
      for (let i = i0; i < d.length; i++) if (Math.abs(d[i]) > 1e-4) return (i / SR) * 1000;
      return -1;
    };
    const on = [0, 1, 2, 3].map((k) => onsetMs(k * step - (k ? 0.002 : 0)));
    const late = [on[1] - 125, on[3] - 375];
    const pk = on.map((ms) => peakOf(d, Math.round((ms / 1000) * SR), Math.round((ms / 1000 + 0.06) * SR)));
    log(Math.abs(on[0]) <= 1 && Math.abs(on[2] - 250) <= 1 && late.every((l) => Math.abs(l - 50) <= 1), 'swing 40 %: a páros 16-odok 50 ms-mal később (± 1 ms), a páratlanok a rácson', `kezdetek ${on.map((x) => x.toFixed(2)).join(' · ')} ms → késés ${late.map((x) => x.toFixed(2)).join(' / ')} ms`);
    const r1 = pk[1] / pk[0];
    const r2 = pk[2] / pk[0];
    log(Math.abs(r1 - 1 / 0.9) < 0.02 && Math.abs(r2 - DRUM_SOFT / 127 / 0.9) < 0.02 && Math.abs(pk[3] / pk[0] - 1) < 0.02, 'velocity: a csúcsszint a hangsúlyosnál ×1,11, a halknál ×0,56 (a normálhoz)', `csúcsok ${pk.map((x) => x.toFixed(3)).join(' · ')} → ×${r1.toFixed(3)} / ×${r2.toFixed(3)} (várt ×1,111 / ×0,560)`);
    const dd = dLive ? maxDiff(dLive, d) : 1;
    log(!!dLive && dd < 1e-4 && Math.abs(dLive.length - d.length) <= 1, 'az élő előhallgatás („▶”) = a beégetett klip', `eltérés ${dd.toExponential(1)} (16 bit), ${(d.length / SR).toFixed(3)} s`);
    await sleep(400);
    // 2) piano roll: A4 három erősséggel (halk · közepes · erős)
    runDevAction('audio.openPianoRoll');
    await sleep(800);
    runDevAction('synth.set', { wave: 'sine', bars: 1, notes: [{ midi: 69, startBeat: 0, lengthBeats: 1, velocity: 50 }, { midi: 69, startBeat: 1, lengthBeats: 1, velocity: 100 }, { midi: 69, startBeat: 2, lengthBeats: 1, velocity: 127 }] });
    await sleep(300);
    const notes = runDevAction('synth.notes') as string;
    const sPlaying = (await runDevAction('preview.pianoroll-play')) as boolean;
    await sleep(500);
    const live = lastLoopPcm?.[0] ?? null;
    await runDevAction('preview.pianoroll-play');
    runDevAction('synth.bake');
    const sc = await waitClip(2);
    if (!sc?.uri) {
      log(false, 'a dallam a sávra kerül', 'nincs klip');
      return;
    }
    created.push(sc.uri);
    const sx = await left(sc.uri);
    const spk = [0, 1, 2].map((b) => peakOf(sx, Math.round((b * 0.5 + 0.1) * SR), Math.round((b * 0.5 + 0.4) * SR)));
    log(Math.abs(spk[0] / spk[2] - 50 / 127) < 0.01 && Math.abs(spk[1] / spk[2] - 100 / 127) < 0.01, 'piano roll velocity: a csúcsszint a velocity-vel arányos (50 · 100 · 127)', `${notes} → csúcsok ${spk.map((x) => x.toFixed(3)).join(' · ')} (×${(spk[0] / spk[2]).toFixed(3)} / ×${(spk[1] / spk[2]).toFixed(3)}, várt ×0,394 / ×0,787)`);
    const sd = live ? maxDiff(live, sx) : 1;
    log(sPlaying && sd < 1e-4, 'az élő előhallgatás = a beégetett dallam (a közös hossz)', `eltérés ${sd.toExponential(1)}`);
    runDevAction('audio.closePianoRoll');
    // 3) egy visszavonás: a dallam-klip eltűnik
    st().undo();
    log(musicClips().length === 1, 'a beégetés egy visszavonással visszavonható', `${musicClips().length} klip`);
  } finally {
    stopPreview();
    for (const u of created) {
      try {
        const f = new File(u);
        if (f.exists) f.delete();
      } catch (caught) {
        logCaught('lib/imageSmoke.tsx:velswing-clean', caught);
      }
    }
    router.back();
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:velswing-del', caught));
  }
}
/** 👆 R7 valódi érintéssel (adb / ember): hosszú nyomás = ütés-szint, a swing-gomb lépked. */
export async function smokeVelTouch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_veltouch';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:veltouch', caught));
  await saveProject({ ...createEmptyProject('smoke veltouch', '9:16', undefined, 'audio'), id });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  runDevAction('audio.openDrums');
  await sleep(800);
  const hits = () => runDevAction('drums.hits') as string;
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  try {
    log(null, 'READY', 'long1');
    const a = await waitFor(() => hits() === 'hihat5v127', 25000);
    log(a, 'hosszú nyomás az üres cellán: hangsúlyos ütés', hits());
    log(null, 'READY', 'long2');
    const b = await waitFor(() => hits() === 'hihat5v64', 25000);
    log(b, 'újra hosszan: halk', hits());
    log(null, 'READY', 'swing');
    const c = await waitFor(() => hits() === 'hihat5.2v64', 25000);
    log(c, 'swing + ×2 (20 %): a páros 16-od 0,2 lépéssel később', hits());
    log(null, 'READY', 'tap');
    const d = await waitFor(() => hits() === '', 25000);
    log(d, 'rövid koppintás: az ütés ki', hits() || '(üres)');
  } finally {
    runDevAction('audio.closeDrums');
    router.back();
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:veltouch-del', caught));
  }
}
/**
 * 🎹🥁 AP2 (MU1): a sütött dob-klip mintája megmarad (mentés + újratöltés után is), a klipszerkesztőből
 * újranyitható, módosítva újrasütve a klip hangja az új minta, a helye/hangereje/effektje marad; egy undo.
 */
export async function smokeInstrumentEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const maxDiff = (a: Float32Array, b: Float32Array) => {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  const id = 'prj_smoke_instedit';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instedit', caught));
  await saveProject({ ...createEmptyProject('smoke minta', '9:16', undefined, 'audio'), id });
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
    // 1) sütés: kick az 1. és 9. lépésen, a 9. hangsúlyos, swing 20 %
    runDevAction('audio.openDrums');
    await sleep(800);
    let p1 = emptyPattern(1);
    p1 = { ...p1, kick: p1.kick.map((_, i) => i === 0 || i === 8) };
    runDevAction('drums.set', { pattern: p1, velocity: { kick: Object.assign([], { 8: DRUM_ACCENT }) }, swing: 0.2 });
    await sleep(300);
    runDevAction('drums.bake');
    const baked = await waitFor(() => music().length === 1, 10000);
    const c0 = music()[0];
    log(baked && !!c0?.instrumentDocId && st().project!.instrumentDocs?.length === 1, 'sütés: a klip a mintára hivatkozik, a minta a projektben', `${c0?.instrumentDocId}, ${st().project!.instrumentDocs?.length} minta`);
    // a klipet a felhasználó beállítja: hely, hangerő, effekt
    st().dispatch({ type: 'UPDATE_CLIP', clipId: c0.id, patch: { start: 1.5, volume: 0.6, audioFx: { reverb: 0.4 } } });
    // 2) mentés + újratöltés („az app újraindult”)
    await saveProject(st().project!);
    const reloaded = await loadProject(id);
    st().loadProject(reloaded!);
    await sleep(500);
    const doc0 = st().project!.instrumentDocs?.[0];
    log(!!doc0 && doc0.drums?.pattern.kick[8] === true && doc0.drums?.velocity?.kick?.[8] === DRUM_ACCENT && doc0.drums?.swing === 0.2, 'mentés és újratöltés után a minta megvan (ütések, szint, swing)', `${reloaded?.instrumentDocs?.length} minta`);
    // 3) „Minta szerkesztése” a klipszerkesztőből → a dobgép a mentett mintával nyílik
    st().selectClip(music()[0].id);
    runDevAction('audio.editClip');
    await sleep(800);
    const opened = runDevAction('clipEdit.editInstrument') === true;
    await sleep(900);
    const hits0 = runDevAction('drums.hits') as string;
    log(opened && hits0 === 'kick0,kick8v127', 'a klipszerkesztő „Minta szerkesztése”: a dobgép a mentett mintával nyílik', hits0);
    log(true, 'FOTÓZHATÓ', 'a dobgép a klip mentett mintájával');
    await sleep(2000);
    // 4) módosítás + újrasütés: snare a 2. és 4. negyeden, 2 ütem
    const p2 = { ...emptyPattern(2), kick: emptyPattern(2).kick.map((_, i) => i === 0 || i === 8 || i === 16), snare: emptyPattern(2).snare.map((_, i) => i === 4 || i === 12 || i === 20 || i === 28) };
    runDevAction('drums.set', { pattern: p2, swing: 0, bars: 2 });
    await sleep(300);
    const oldUri = music()[0].uri;
    runDevAction('drums.bake');
    const rebaked = await waitFor(() => music()[0].uri !== oldUri, 10000);
    const c1 = music()[0];
    const exp = renderDrumsPcm(patternHits(p2), 2, st().project!.bpm ?? 120)[0];
    const got = await left(c1.uri);
    const d = maxDiff(got, exp);
    log(rebaked && music().length === 1 && d < 1e-4 && Math.abs(c1.duration - 4) < 1e-6, 'újrasütés: ugyanaz a klip, a hangja = az új minta (2 ütem, 4 s)', `eltérés ${d.toExponential(1)}, ${c1.duration} s`);
    log(c1.start === 1.5 && c1.volume === 0.6 && c1.audioFx?.reverb === 0.4 && c1.instrumentDocId === c0.instrumentDocId, 'a klip helye, hangereje és effektje megmaradt', `kezdet ${c1.start}, hangerő ${c1.volume}, zengés ${c1.audioFx?.reverb}`);
    // 5) egy undo: a régi hang és a régi minta
    st().undo();
    const u = music()[0];
    const ud = st().project!.instrumentDocs?.[0];
    log(u.uri === oldUri && ud?.bars === 1 && ud?.drums?.swing === 0.2, 'egy visszavonás: a régi hang és a régi minta', `${ud?.bars} ütem`);
    // 6) 🎛️ S1: sampler-minta — saját hangfájl + rács; mentés + újratöltés; „Minta szerkesztése” → a sampler
    //    a mentett fájllal és ráccsal; újrasütés ugyanarra a klipre; egy undo
    runDevAction('audio.closeDrums');
    await sleep(400);
    const sampleUri = toneWav('smoke_instedit_sample.wav', 0.25);
    runDevAction('audio.openSampler');
    await sleep(800);
    const pat1 = emptySampler(1);
    pat1[0] = true;
    pat1[8] = true;
    runDevAction('sampler.set', { sampleUri, sampleName: 'minta.wav', pattern: pat1, bars: 1 });
    await sleep(300);
    runDevAction('sampler.bake');
    const sBaked = await waitFor(() => music().length === 2, 10000);
    const s0 = music().find((c) => instrumentDocOf(st().project, c.instrumentDocId)?.kind === 'sampler');
    const sDoc0 = instrumentDocOf(st().project, s0?.instrumentDocId);
    log(sBaked && !!s0 && sDoc0?.sampler?.sampleUri === sampleUri && sDoc0.sampler.pattern[8] === true, 'sampler: sütés → a minta (fájl + rács) a projektben, a klip hivatkozik rá', `${sDoc0?.sampler?.sampleName}, ${sDoc0?.sampler?.pattern.filter(Boolean).length} lépés`);
    if (!s0) throw new Error('nincs sampler-klip');
    st().dispatch({ type: 'UPDATE_CLIP', clipId: s0.id, patch: { start: 6, volume: 0.5 } });
    await saveProject(st().project!);
    const reloaded2 = await loadProject(id);
    st().loadProject(reloaded2!);
    await sleep(500);
    const sDoc1 = instrumentDocOf(st().project, s0.instrumentDocId);
    log(!!sDoc1?.sampler && sDoc1.sampler.pattern[8] === true && new File(sDoc1.sampler.sampleUri).exists, 'sampler: mentés + újratöltés után a minta megvan, a hangfájl létezik', sDoc1?.sampler?.sampleUri.split('/').slice(-2).join('/') ?? '-');
    st().selectClip(s0.id);
    runDevAction('audio.editClip');
    await sleep(800);
    const sOpened = runDevAction('clipEdit.editInstrument') === true;
    await sleep(900);
    const sState = runDevAction('sampler.state') as string;
    log(sOpened && sState === '1|minta.wav|0,8', 'sampler: „Minta szerkesztése” → a sampler a mentett fájllal és ráccsal nyílik', sState);
    const pat2 = emptySampler(2);
    for (const i of [0, 4, 8, 12, 16, 24]) pat2[i] = true;
    runDevAction('sampler.set', { pattern: pat2, bars: 2 });
    await sleep(300);
    const sOld = music().find((c) => c.id === s0.id)!.uri;
    runDevAction('sampler.bake');
    const sRebaked = await waitFor(() => music().find((c) => c.id === s0.id)?.uri !== sOld, 10000);
    const s1 = music().find((c) => c.id === s0.id)!;
    const sample = await decodeSample(sDoc1!.sampler!.sampleUri);
    const sd = sample ? maxDiff(await left(s1.uri), renderSamplerPcm(sample, [0, 4, 8, 12, 16, 24], 2, st().project!.bpm ?? 120)[0]) : 1;
    log(sRebaked && music().length === 2 && sd < 1e-4 && s1.start === 6 && s1.volume === 0.5 && s1.instrumentDocId === s0.instrumentDocId, 'sampler: újrasütés ugyanarra a klipre, a hang = az új minta (2 ütem), hely és hangerő marad', `eltérés ${sd.toExponential(1)}, ${s1.duration.toFixed(3)} s`);
    st().undo();
    const su = music().find((c) => c.id === s0.id)!;
    const sud = instrumentDocOf(st().project, s0.instrumentDocId);
    log(su.uri === sOld && sud?.bars === 1 && sud?.sampler?.pattern.filter(Boolean).length === 2, 'sampler: egy visszavonás a régi hangot és a régi mintát adja', `${sud?.bars} ütem, ${sud?.sampler?.pattern.filter(Boolean).length} lépés`);
  } finally {
    runDevAction('audio.closeDrums');
    runDevAction('audio.closeSampler');
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instedit-del', caught));
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
