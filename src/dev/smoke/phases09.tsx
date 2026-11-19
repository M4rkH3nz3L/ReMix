/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { Asset } from 'expo-asset';
import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { type Href, router } from 'expo-router';
import { useBrandStyle } from '@/store/brandStyleStore';
import { docFromTemplate, IMAGE_TEMPLATES, templateFromDoc } from '@/lib/imageTemplates';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { previewEngine } from '@/lib/previewEngine';
import { useRecordPrefs } from '@/store/recordPrefsStore';
import { clickSample } from '@/lib/metronome';
import '@/lib/dspNativeClient';
import { canSpeakOnDevice } from '@/lib/ttsOnDevice';
import { lastLoopPcm, previewLooping, stopPreview } from '@/lib/instrumentPreview';
import { DRUM_ACCENT, DRUM_SOFT, emptyPattern, patternHits } from '@/lib/drums';
import { renderDrumsPcm, renderSamplerPcm } from '@/lib/instrumentRender';
import { decodeSample } from '@/lib/instrumentClient';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import { emptySampler } from '@/lib/sampler';
import { importFontFromUri } from '@/lib/projectFontsClient';
import { insertBrandLogoWatermark } from '@/lib/brandLogoClient';
import { useUserTemplates } from '@/store/userTemplatesStore';
import AsyncStorageTpl from '@react-native-async-storage/async-storage';
import { renderOnDevice } from '@/lib/renderStageRegistry';
import { integratedLoudness } from '@/lib/loudness';
import { encodeWav16 } from '@/lib/offlineMix';
import { detectBeats, lastBeatPath } from '@/lib/beats';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { RenderStage, type RenderStageHandle } from '@/components/studio/image/RenderStage';
import { renderImageDoc } from '@/lib/imageDocClient';
import { makeId } from '@/lib/id';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject, CURRENT_SCHEMA_VERSION } from '@/lib/projectUtils';
import { deleteProject, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';
import { type Log, alphaImage, decode, pixel, removeFile, sleep, toneWav } from './shared';

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
/** 📐 AP1: az újabb app-verzió projektje csak olvasható — a szerkesztés nem megy át, a tárolt bájtok változatlanok. */
export async function smokeNewerSchema(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_newer';
  const key = `vided.project.v1.${id}`;
  const base = createEmptyProject('smoke újabb séma', '9:16', undefined, 'audio');
  const stored = { ...base, id, schemaVersion: 99, futureField: { x: 1 } };
  const raw = JSON.stringify(stored);
  await AsyncStorage.setItem(key, raw);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const opened = st().project?.id === id && st().project?.schemaVersion === 99;
  const ok = st().dispatch({ type: 'RENAME_PROJECT', name: 'felülírva' });
  log(opened && !ok && st().project?.name === base.name, 'a v99-es projekt megnyílik, a szerkesztés nem megy át', `séma ${st().project?.schemaVersion}, dispatch ${ok}`);
  log(true, 'FOTÓZHATÓ', 'a „csak olvasható” sáv a Hang Stúdió tetején');
  await sleep(2500);
  router.back();
  await sleep(1500); // a kilépéskori mentés is lefut
  const after = await AsyncStorage.getItem(key);
  log(after === raw, 'kilépés után a tárolt projekt bájtra változatlan (az ismeretlen mező is megmaradt)', `${raw.length} bájt`);
  await AsyncStorage.removeItem(key);
  // a mai projekt a jelenlegi sémával mentődik
  const cur = { ...createEmptyProject('smoke v7', '9:16', undefined, 'audio'), id: 'prj_smoke_v7' };
  await saveProject(cur);
  const back = JSON.parse((await AsyncStorage.getItem('vided.project.v1.prj_smoke_v7')) ?? '{}') as { schemaVersion?: number };
  log(back.schemaVersion === CURRENT_SCHEMA_VERSION, `az új projekt a jelenlegi sémán (v${CURRENT_SCHEMA_VERSION}) mentődik`, `v${back.schemaVersion}`);
  await deleteProject('prj_smoke_v7').catch((caught) => logCaught('lib/imageSmoke.tsx:newerschema', caught));
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
/** 🥁 AP3: a tempó-felismerés a telefonon fut (worker nélkül); 120 és 93 BPM klikk-sávon ±1 BPM, a beatek a rácson. */
export async function smokeBpmOffline(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const click = (name: string, bpm: number, sec: number) => {
    const x = new Float32Array(Math.round(sec * SR));
    let seed = bpm;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    const period = (60 / bpm) * SR;
    for (let k = 0; k * period < x.length; k++) {
      const at = Math.round(k * period);
      const amp = k % 4 === 0 ? 0.9 : 0.5;
      for (let i = 0; i < 1600 && at + i < x.length; i++) x[at + i] += amp * Math.exp(-i / 240) * rnd();
    }
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(encodeWav16([x, x], SR, () => 0.5));
    return file.uri;
  };
  const id = 'prj_smoke_bpm';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bpm', caught));
  const base = createEmptyProject('smoke bpm', '9:16', undefined, 'audio');
  const files = [click('smoke_click_120.wav', 120, 20), click('smoke_click_93.wav', 93, 20)];
  const mk = (uri: string, cid: string): AudioClip => ({ kind: 'audio', id: cid, label: cid, start: 0, duration: 20, trimIn: 0, sourceDuration: 20, uri, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, bpm: 100, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk(files[0], 'c120')] } : t.type === 'sfx' ? { ...t, clips: [mk(files[1], 'c93')] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  try {
    for (const [cid, bpm] of [['c120', 120], ['c93', 93]] as const) {
      st().selectClip(cid);
      await sleep(200);
      const t0 = Date.now();
      await runDevAction('audio.autoBpm');
      const ms = Date.now() - t0;
      const got = st().project!.bpm ?? 0;
      const grid = await detectBeats(files[cid === 'c120' ? 0 : 1]);
      const period = 60 / bpm;
      const offs = (grid?.beats ?? []).slice(1, -1).map((b) => {
        const o = ((b % period) + period) % period;
        return o > period / 2 ? o - period : o;
      });
      const worst = Math.max(...offs.map((o) => Math.abs(o) * 1000));
      const mean = (offs.reduce((a, o) => a + o, 0) / Math.max(1, offs.length)) * 1000;
      log(Math.abs(got - bpm) <= 1 && lastBeatPath() === 'device' && worst <= 52 && Math.abs(mean) <= 25, `${bpm} BPM klikk-sáv: a stúdió „Tempó felismerése” a telefonon (worker nélkül) ±1 BPM, a beatek a rácson`, `${got} BPM, ${lastBeatPath()}, ${ms} ms, beat-eltérés átlag ${mean.toFixed(1)} / max ${worst.toFixed(1)} ms`);
    }
    log(true, 'FOTÓZHATÓ', 'a felismert tempó és a beat-vonalak az idővonalon');
    await sleep(2500);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bpm-del', caught));
    for (const f of files) new File(f).delete();
  }
}
/**
 * ⏱️ AP4: a metronóm a lejátszás alatt mintapontosan a rácson szól (hangsúlyos ütem-egy), a mérőbe és
 * az exportba nem kerül; metronómos felvételnél a lejátszás a projekt végén túl is fut, a take a
 * lejátszófejtől szól.
 */
export async function smokeMetronome(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const silent = new File(Paths.document, 'smoke_metro_silence.wav');
  if (silent.exists) silent.delete();
  silent.create();
  silent.write(encodeWav16([new Float32Array(4 * SR)], SR, () => 0.5));
  const id = 'prj_smoke_metro';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:metro', caught));
  const base = createEmptyProject('smoke metronóm', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'sil', label: 'csend', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, uri: silent.uri, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const prefs = useRecordPrefs.getState();
  const was = { metronome: prefs.metronome, gain: prefs.metronomeGain, countIn: prefs.countInBars, punch: prefs.punch };
  try {
    // 1) lejátszás metronómmal: a motor kimenete = a klikkek (a klip néma)
    useRecordPrefs.setState({ metronome: true, metronomeGain: 0.6, countInBars: 0, punch: false });
    await sleep(300);
    previewEngine.debugTap(true);
    st().setPlayhead(0);
    st().setPlaying(true);
    let lufs: number | null = null;
    for (let i = 0; i < 25; i++) {
      await sleep(100);
      const r = previewEngine.loudness();
      if (r) lufs = Math.max(lufs ?? -Infinity, r.shortTerm ?? -Infinity);
    }
    st().setPlaying(false);
    const chunks = previewEngine.debugTap(false).sort((a, b) => a.from - b.from);
    const total = chunks.length ? chunks[chunks.length - 1].from + chunks[chunks.length - 1].left.length : 0;
    const out = new Float32Array(total);
    for (const c of chunks) out.set(c.left, c.from);
    const beats = [0, 1, 2, 3, 4].map((k) => Math.round(k * 0.5 * SR)).filter((at) => at + 2 < total);
    const exact = beats.every((at) => (at === 0 || out[at - 1] === 0) && out[at] === 0 && Math.abs(out[at + 1] - 0.6 * clickSample(at === 0 || at === Math.round(2 * SR) ? true : false, 1, SR)) < 1e-6);
    const pk = (at: number) => out.subarray(at, at + Math.round(0.04 * SR)).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const ratio = beats.length > 1 ? pk(beats[0]) / pk(beats[1]) : 0;
    log(exact && beats.length >= 4, 'lejátszás közben a klikkek mintapontosan a beateken (120 BPM: 0,5 s-onként)', `${beats.length} klikk, ${chunks.length} szelet`);
    log(Math.abs(ratio - 0.8 / 0.55) < 0.05, 'az ütem-egy hangsúlyos (×1,45)', `×${ratio.toFixed(3)}`);
    log(lufs === null || !Number.isFinite(lufs) || lufs < -70, 'a hangosságmérő nem látja a klikket (a mérés előtt keveredik)', `short-term ${lufs === null || !Number.isFinite(lufs) ? '−∞' : lufs.toFixed(1)} LUFS`);
    // 2) az export néma (a metronóm nem kerül bele)
    const { uri: exp } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_metro_export.wav'));
    const api = (await loadAudioApi())!;
    const ex = (await api.decodeAudioData(exp, SR)).getChannelData(0);
    const exPeak = ex.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    // a 16 bites export TPDF-ditherrel készül: a „csend” ±1–2 LSB (a klikk 0,6 volna)
    log(exPeak <= 2 / 32768, 'az export néma: a metronóm nem kerül bele (csak a 16 bites dither, ≤ 2 LSB)', `csúcs ${(exPeak * 32768).toFixed(1)} LSB`);
    new File(exp).delete();
    // 3) metronómos felvétel a projekt végén túl: 1 ütem előszámlálás, a take a lejátszófejtől
    useRecordPrefs.setState({ countInBars: 1 });
    st().setPlayhead(3);
    await sleep(300);
    await runDevAction('audio.recordToggle');
    let maxHead = 0;
    for (let i = 0; i < 45; i++) {
      await sleep(100);
      maxHead = Math.max(maxHead, st().playhead);
    }
    const through = st().playThrough && st().isPlaying;
    await runDevAction('audio.recordToggle');
    for (let i = 0; i < 40 && (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips.length === 0); i++) await sleep(100);
    const take = st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip | undefined;
    log(through && maxHead > 4.3, 'felvétel közben a lejátszás a projekt végén (4 s) túl is fut', `lejátszófej max ${maxHead.toFixed(2)} s`);
    log(!!take && Math.abs(take.start - 3) < 0.15 && take.duration > 1.5 && !st().playThrough && !st().isPlaying, 'a take a lejátszófejtől (3 s) szól, az előszámlálás nélkül; leállítás után a transzport alaphelyzetben', take ? `kezdet ${take.start.toFixed(3)} s, ${take.duration.toFixed(2)} s, levágva ${(take.trimIn ?? 0).toFixed(3)} s` : 'nincs take');
    log(true, 'FOTÓZHATÓ', 'a metronóm-gomb aktív a transzporton, a take a 3. mp-nél');
    await sleep(2000);
  } finally {
    useRecordPrefs.setState({ metronome: was.metronome, metronomeGain: was.gain, countInBars: was.countIn, punch: was.punch });
    st().setPlaying(false);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:metro-del', caught));
    if (silent.exists) silent.delete();
  }
}
/** 🗣️ AP5: az AI-hang a telefonon készül (offline, szerver nélkül): WAV a voiceover sávon, valódi beszéd, egy undo. */
export async function smokeTtsDevice(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_tts';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tts', caught));
  await saveProject({ ...createEmptyProject('smoke tts', '9:16', undefined, 'audio'), id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const voice = () => st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[];
  try {
    runDevAction('audio.openTts');
    let info: { device: string[] | null; server: number } = { device: null, server: 0 };
    for (let i = 0; i < 50 && !info.device; i++) {
      await sleep(200);
      info = (runDevAction('tts.voices') as typeof info) ?? info;
    }
    log(canSpeakOnDevice() && (info.device?.length ?? 0) > 0, 'a telefon beszédhangjai elérhetők (szerver nélkül)', `${info.device?.length ?? 0} nyelv: ${(info.device ?? []).slice(0, 6).join(', ')}`);
    log(true, 'FOTÓZHATÓ', 'az AI-hang lap a telefon hangjaival');
    await sleep(1500);
    runDevAction('tts.text', 'Szia! Ez a ReMix telefonos hangja. Egy, kettő, három, négy.');
    await sleep(300);
    const head = st().playhead;
    const t0 = Date.now();
    const ok = (await runDevAction('tts.generate')) as boolean;
    const ms = Date.now() - t0;
    const clip = voice()[0];
    const api = (await loadAudioApi())!;
    const buf = clip ? await api.decodeAudioData(clip.uri, 44100) : null;
    const l = buf?.getChannelData(0);
    const lufs = l ? integratedLoudness(l, l, 44100) : -Infinity;
    log(ok && !!clip && clip.uri.startsWith('file:') && clip.uri.endsWith('.wav') && Math.abs(clip.start - head) < 0.05 && clip.duration > 1.5, 'a beszéd a telefonon készült (WAV a projekt-mappában), klipként a lejátszófejnél a voiceover sávon', clip ? `${ms} ms, ${clip.duration.toFixed(2)} s, kezdet ${clip.start}` : 'nincs klip');
    log(lufs > -40, 'a fájlban valódi beszéd szól (nem csend)', `${lufs.toFixed(1)} LUFS`);
    st().undo();
    log(voice().length === 0, 'egy visszavonás: a klip eltűnik', `${voice().length} klip`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tts-del', caught));
  }
}
/** 🔊 AP6: a videó-szerkesztő gyors hangerő-léptetője dB-ben lép — a +6 dB-es klip egy „−” után +5 dB (nem 0 dB). Valódi érintés (adb). */
export async function smokeQuickVolume(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_quickvol';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:quickvol', caught));
  const base = createEmptyProject('smoke gyors hangerő', '9:16');
  const uri = toneWav('smoke_quickvol.wav', 4);
  const v6 = Math.pow(10, 6 / 20);
  const clip: AudioClip = { kind: 'audio', id: 'qv', label: 'zene', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, uri, volume: v6, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/editor/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const vol = () => (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).volume;
  try {
    st().selectClip('qv');
    st().setPanel('audio');
    await sleep(800);
    log(null, 'READY', 'voldown');
    for (let i = 0; i < 250 && Math.abs(vol() - v6) < 1e-9; i++) await sleep(100);
    const db = 20 * Math.log10(vol());
    log(Math.abs(db - 5) < 0.05, 'a „Hangerő −” egy érintésre +6 → +5 dB (eddig 0–1 közé vágott: 0 dB lett volna)', `${db.toFixed(2)} dB`);
    log(true, 'FOTÓZHATÓ', 'a gyors hangerő-léptető dB-ben');
    await sleep(1500);
  } finally {
    st().setPanel(null);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:quickvol-del', caught));
  }
}
/** 🧩 AP7: az „Új projekt” űrlap hang-sablonnal (a valódi létrehozási út): zene és podcast. */
/**
 * 🎨 IMAGE-PROD S8 (DS0): a „+ Új projekt → Design" a VALÓDI létrehozási úton a választott sablonnal
 * (márkára színezve) a Kép Stúdió Design munkaterületén nyílik; a munkaterület váltható, offline.
 */
export async function smokeDesignEntry(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const created: string[] = [];
  const name = 'smoke design thumbnail';
  try {
    router.replace('/studio' as Href);
    await sleep(1500);
    runDevAction('studio.fillCreate', { name, kind: 'design', designTemplate: 'youtubeThumb' });
    await sleep(400);
    const t0 = Date.now();
    await runDevAction('studio.create');
    for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
    await sleep(1500);
    const p = st().project;
    if (p?.name === name) created.push(p.id);
    const doc = p?.imageDocs?.[0];
    const kinds = (doc?.layers ?? []).map((l) => l.kind).join('+');
    log(p?.kind === 'design' && doc?.width === 1280 && doc.height === 720 && (doc.layers.length ?? 0) >= 3, 'a Design-projekt a sablon vásznán és szerkeszthető rétegeivel indul', p ? `${p.kind}, ${doc?.width}×${doc?.height}, rétegek: ${kinds}, ${Date.now() - t0} ms` : 'nincs projekt');
    const ws = (await runDevAction('image.workspace')) as { ws: string; tools: string[] } | undefined;
    log(ws?.ws === 'design' && ws.tools[0] === 'templates' && ws.tools[1] === 'size', 'a Kép Stúdió a Design munkaterületen nyílik: sablon és méret elöl', `${ws?.ws}: ${ws?.tools.join(', ')}`);
    log(true, 'FOTÓZHATÓ', 'a Design munkaterület (sablonból nyílt lap, Design-sín)');
    await sleep(6000);
    const back = (await runDevAction('image.workspace', 'image')) as { ws: string } | undefined;
    await sleep(300);
    const now = (await runDevAction('image.workspace')) as { ws: string; tools: string[] } | undefined;
    log(back !== undefined && now?.ws === 'image' && now.tools[0] === 'photo' && st().project?.id === p?.id, 'a munkaterület váltható (ugyanaz a dokumentum)', `${now?.ws}: ${now?.tools.slice(0, 3).join(', ')}…`);
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke design ')).map((m) => m.id);
    for (const id of new Set([...created, ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:design-del', caught));
      await deleteCloudProject(id);
    }
    const remain = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke design ')).length;
    log(remain === 0, 'takarítás: a teszt-projekt a felhőből is törölve', `maradt ${remain}`);
  }
}
/**
 * 🧩 IMAGE-PROD S9 (DS1): sablon-könyvtár — minden sablon a telefonon renderelve = a szerver-render
 * (a helyőrző mindkettőből kimarad); a helyőrzőbe tett kép a helyén marad (valódi stúdió, egy
 * visszavonás); a saját sablon a telefonon tárolva, a fotó helyőrzővé válik.
 */
export async function smokeTemplateLibrary(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(
    <View style={{ width: 1, height: 1 }}>
      <RenderStage ref={ref} />
    </View>
  );
  await sleep(300);
  // 1) a teljes könyvtár: telefon = szerver (640 px magasan, átlagos színeltérés — mint a márka-mérés)
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 60; j++) {
        const [x, y] = [(j + 0.5) / 60, (i + 0.5) / 60];
        const u = pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height()));
        const w = pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()));
        sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
        count += 1;
      }
    }
    return sum / count;
  };
  let ok = 0;
  const bad: string[] = [];
  const all: string[] = [];
  const t0 = Date.now();
  for (const tpl of IMAGE_TEMPLATES) {
    const doc = docFromTemplate(tpl, tpl.key, () => makeId('lyr'));
    const h = 640;
    const w = Math.round((h * tpl.width) / tpl.height);
    const dev = await ref.current!.render(doc, h);
    const srv = await renderImageDoc(doc, h).catch((caught) => {
      logCaught('lib/imageSmoke.tsx:templib', caught);
      return null;
    });
    if (!dev || !srv) {
      bad.push(`${tpl.key}:nincs`);
      continue;
    }
    const a = await decode(dev);
    const d = meanDiff(a, await decode(srv));
    all.push(`${tpl.key} ${d.toFixed(1)}`);
    if (Math.abs(a.width() - w) <= 1 && d <= 7) {
      ok += 1;
      removeFile(dev);
      removeFile(srv);
    } else {
      bad.push(`${tpl.key}:${d.toFixed(1)}`);
      // az eltérő pár megmarad a vizsgálathoz (a Mac-re másolható)
      const keep = (uri: string, tag: string) => new File(uri).move(new File(projectMediaDir(), `smoke_cmp_${tpl.key}_${tag}.png`));
      keep(dev, 'dev');
      keep(srv, 'srv');
    }
  }
  log(null, 'sablononként (átlag /255)', all.join(' · '));
  log(null, 'eltérő párok helye', projectMediaDir().uri);
  log(ok === IMAGE_TEMPLATES.length, `mind a ${IMAGE_TEMPLATES.length} sablon: telefon = szerver (a helyőrző kimarad)`, `${ok}/${IMAGE_TEMPLATES.length} egyezik (≤ 7/255), ${Date.now() - t0} ms${bad.length ? ` — eltér: ${bad.join(', ')}` : ''}`);
  setHarness(null);

  // 2) a helyőrző kitöltése a valódi stúdióban
  const id = 'prj_smoke_templib';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:templib-del0', caught));
  const surface = Skia.Surface.MakeOffscreen(200, 200)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#20c060'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  surface.flush();
  const img = new File(projectMediaDir(), `smoke_tpl_${Date.now().toString(36)}.png`);
  img.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const tpl = IMAGE_TEMPLATES.find((x) => x.key === 'postPhoto')!;
  const page = docFromTemplate(tpl, 'Fotó', () => makeId('lyr'));
  const base = createEmptyProject('smoke sablon-könyvtár', '1:1', undefined, 'design');
  await saveProject({ ...base, id, imageDocs: [page] });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/design/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1500);
    const phLayer = st().project!.imageDocs![0].layers.find((l) => l.kind === 'photo') as PhotoLayer;
    const filled = (await runDevAction('image.fillPlaceholder', { layerId: phLayer.id, uri: img.uri })) as boolean;
    await sleep(400);
    const after = st().project!.imageDocs![0].layers.find((l) => l.id === phLayer.id) as PhotoLayer;
    const r = await renderOnDevice(st().project!.imageDocs![0], 320);
    const mid = r ? pixel(await decode(r), 160, 120).slice(0, 3) : [];
    log(filled && after.uri === img.uri && !after.placeholder && after.w === phLayer.w && after.h === phLayer.h && mid[1] > 150 && mid[0] < 80, 'a helyőrzőbe tett kép a helyén és méretében, a kész képen is', `${after.w}×${after.h} (helyőrző ${phLayer.w}×${phLayer.h}), a kép közepe ${mid.join(',')}`);
    log(true, 'FOTÓZHATÓ', 'a kitöltött sablon a Design munkaterületen');
    await sleep(4000);
    st().undo();
    await sleep(300);
    const undone = st().project!.imageDocs![0].layers.find((l) => l.id === phLayer.id) as PhotoLayer;
    log(!!undone.placeholder && undone.uri === '', 'egy visszavonás: újra helyőrző');
    st().redo();
    // 3) mentés sablonként → a telefonon tárolva, a fotó helyőrző, a kategória a méretből
    const mine = templateFromDoc(st().project!.imageDocs![0], 'tpl_smoke', 'smoke saját');
    await useUserTemplates.getState().add(mine);
    const stored = JSON.parse((await AsyncStorageTpl.getItem('remix.imagetemplates.v1')) ?? '[]') as { key: string; layers: { kind: string; placeholder?: boolean; uri?: string }[]; category: string }[];
    const saved = stored.find((x) => x.key === 'tpl_smoke');
    log(!!saved && saved.category === 'post' && saved.layers.some((l) => l.kind === 'photo' && l.placeholder && l.uri === '') && !JSON.stringify(saved).includes(img.uri), 'mentés sablonként: a telefonon tárolva, a fotóból helyőrző (nincs fájl-hivatkozás)', `${saved?.category}, ${saved?.layers.length} réteg`);
    await useUserTemplates.getState().remove('tpl_smoke');
    if (r) removeFile(r);
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:templib-del', caught));
    removeFile(img.uri);
  }
}
/**
 * 🔤 IMAGE-PROD S10 (DS2): saját font — import a projektbe (tartalom-ellenőrzéssel), a telefonos és a
 * szerveres kész kép is azzal a betűvel rajzol; mentés után is megvan.
 */
export async function smokeFontImport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = Asset.fromModule(require('../../../assets/fonts/Lobster-Regular.ttf'));
  await src.downloadAsync();
  const res = await importFontFromUri(src.localUri ?? src.uri, 'Saját Lobster.ttf');
  if (!res.ok) {
    log(false, 'font-import', res.reason);
    return;
  }
  const font = res.font;
  // az import a fájl tényleges megjelenését is megvárja (a betöltés azonnal jöhet)
  const fontFile = new File(font.uri);
  log(/^u_SajatLobster_[A-Za-z0-9]+$/.test(font.family) && fontFile.exists, 'a font a projekt mappájába került, CSS-biztos családnévvel', `${font.family} · ${font.name} · ${fontFile.exists ? `${fontFile.size} B` : `nincs: ${font.uri}`}`);
  // hibás fájl: a tartalom dönt (egy PNG .ttf névvel nem font)
  const fake = alphaImage(ImageFormat.PNG, 'png');
  const bad = await importFontFromUri(fake, 'nem-font.ttf');
  log(!bad.ok && bad.reason === 'invalid', 'a nem-font fájl elutasítva (a tartalom alapján)', bad.ok ? 'átment' : bad.reason);
  removeFile(fake);

  const id = 'prj_smoke_fontimport';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:font-del0', caught));
  const text = (family: string) => ({ id: 't', kind: 'text', text: 'Árvíztűrő', position: { x: 0.5, y: 0.5 }, fontSize: 16, color: '#ffffff', fontFamily: family, backgroundColor: null }) as unknown as ImageLayer;
  const mk = (family: string) => ({ id: 'lap', name: 'f', aspectRatio: '1:1', width: 640, height: 640, layers: [{ id: 'bg', kind: 'fill', fill: '#1c1c28' }, text(family)] }) as unknown as ImageDoc;
  const base = createEmptyProject('smoke saját font', '1:1', undefined, 'image');
  await saveProject({ ...base, id, imageDocs: [mk(font.family)], fonts: [font] });
  const st = useEditorStore.getState;
  const meanDiff = (p: SkImage, q: SkImage) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
      const u = pixel(p, Math.floor(((j + 0.5) / 60) * p.width()), Math.floor(((i + 0.5) / 60) * p.height()));
      const w = pixel(q, Math.floor(((j + 0.5) / 60) * q.width()), Math.floor(((i + 0.5) / 60) * q.height()));
      sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
      n += 1;
    }
    return sum / n;
  };
  try {
    router.push(`/studio/image/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1500);
    const fonts = st().project?.fonts ?? [];
    const own = await renderOnDevice(mk(font.family), 640);
    const builtIn = await renderOnDevice(mk('Lobster'), 640);
    const other = await renderOnDevice(mk('Poppins'), 640);
    if (!own || !builtIn || !other) throw new Error('nincs telefonos render');
    const [a, b, c] = [await decode(own), await decode(builtIn), await decode(other)];
    const dSame = meanDiff(a, b);
    const dOther = meanDiff(a, c);
    log(dSame < 1 && dOther > dSame * 3, 'telefonos kész kép: a saját font = ugyanaz a beépített font (ellenpróba: Poppins eltér)', `${dSame.toFixed(2)} · ellenpróba ${dOther.toFixed(2)} /255`);
    // a szerveres kép a feltöltött fontfájllal
    const srv = await renderImageDoc(mk(font.family), 640, { fonts });
    const noFont = await renderImageDoc(mk(font.family), 640);
    if (srv && noFont) {
      const s1 = await decode(srv);
      const dSrv = meanDiff(a, s1);
      const dCtl = meanDiff(s1, await decode(noFont));
      log(dSrv <= 7 && dCtl > 2, 'szerveres kész kép: a font a renderrel feltöltődik (= telefon); font nélkül tartalék-betű', `${dSrv.toFixed(2)} · ellenpróba ${dCtl.toFixed(2)} /255`);
      removeFile(srv);
      removeFile(noFont);
    } else {
      log(false, 'szerveres kész kép a saját fonttal', 'nincs render');
    }
    log(true, 'FOTÓZHATÓ', 'a saját fontú szöveg a vásznon');
    await sleep(4000);
    // mentés + újratöltés: a font a projektben marad, a fájl a projekt mappájában
    await saveProject(st().project!);
    const reloaded = await loadProject(id);
    const kept = reloaded?.fonts?.[0];
    log(kept?.family === font.family && !!kept && new File(kept.uri).exists && (reloaded?.schemaVersion ?? 0) >= 10, 'mentés után is megvan (a projekt mappájában)', `${kept?.uri.split('/').slice(-2).join('/')} · v${reloaded?.schemaVersion}`);
    [own, builtIn, other].forEach((u) => removeFile(u));
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:font-del', caught));
  }
}
/**
 * 🏷️ IMAGE-PROD S11 (DS3): a közös márka-logó egy koppintással a képre és a videóra — mindkettő a
 * projektbe MÁSOLT fájllal, ugyanott és ugyanakkora; a márka-fájl a projekt mentése után is megvan.
 */
export async function smokeBrandLogo(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const mine = await loadBrandStyle();
  const surface = Skia.Surface.MakeOffscreen(200, 200)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#e0102a'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  surface.flush();
  const src = new File(projectMediaDir(), `smoke_logo_src_${Date.now().toString(36)}.png`);
  src.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const brandUri = await useBrandStyle.getState().addLogo(src.uri);
  for (let i = 0; i < 40 && brandUri && !new File(brandUri).exists; i++) await sleep(50);
  const stored = await loadBrandStyle();
  log(!!brandUri && brandUri.includes('/brand/') && (stored.logos ?? []).includes(brandUri), 'a logó a közös márkában (a telefon márka-mappájában, tárolva)', brandUri?.split('/').slice(-2).join('/') ?? 'nincs');
  if (!brandUri) return;
  const st = useEditorStore.getState;
  const imgId = 'prj_smoke_brandlogo_img';
  const vidId = 'prj_smoke_brandlogo_vid';
  try {
    // 1) a képre (Kép Stúdió)
    await deleteProject(imgId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del0', caught));
    const page = { id: 'lap', name: 'l', aspectRatio: '16:9', width: 1280, height: 720, layers: [{ id: 'bg', kind: 'fill', fill: '#1c1c28' }] } as unknown as ImageDoc;
    await saveProject({ ...createEmptyProject('smoke márka-logó kép', '16:9', undefined, 'image'), id: imgId, imageDocs: [page] });
    router.push(`/studio/image/${imgId}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== imgId; i++) await sleep(200);
    await sleep(1200);
    runDevAction('image.insertBrandLogo', brandUri);
    await sleep(500);
    const doc = st().project!.imageDocs![0];
    const logo = doc.layers.find((l) => l.kind === 'photo') as PhotoLayer | undefined;
    const r = await renderOnDevice(doc, 720);
    const img = r ? await decode(r) : null;
    const px = img && logo ? pixel(img, Math.round(logo.position.x * img.width()), Math.round(logo.position.y * img.height())).slice(0, 3) : [];
    log(!!logo && logo.uri !== brandUri && !logo.uri.includes('/brand/') && px[0] > 180 && px[1] < 60, 'képre: a logó a jobb alsó sarokban, a projektbe másolt fájllal (a kész képen is)', `${logo?.w.toFixed(3)}×${logo?.h.toFixed(3)} @ ${logo?.position.x.toFixed(3)},${logo?.position.y.toFixed(3)} · szín ${px.join(',')}`);
    log(true, 'FOTÓZHATÓ', 'a márka-logó a lapon');
    await sleep(3500);
    st().undo();
    log(!st().project!.imageDocs![0].layers.some((l) => l.kind === 'photo'), 'egy visszavonás: a logó lekerül a lapról');
    st().redo();
    await saveProject(st().project!);
    router.back();
    await sleep(800);
    // 2) a videóra (ugyanaz a függvény, amit a márka-szekció hív)
    await deleteProject(vidId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del1', caught));
    await saveProject({ ...createEmptyProject('smoke márka-logó videó', '16:9', undefined, 'video'), id: vidId });
    router.push(`/editor/${vidId}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== vidId; i++) await sleep(200);
    await sleep(1200);
    const added = insertBrandLogoWatermark(brandUri, 'Vízjel');
    const wm = st().project!.tracks.find((t) => t.type === 'overlay')?.clips.find((c) => c.kind === 'shape') as ShapeLayer & { imageUri?: string } | undefined;
    log(added && !!wm && wm.imageUri !== brandUri && !String(wm.imageUri).includes('/brand/') && !!logo && Math.abs(wm.w - logo.w) < 1e-6 && Math.abs(wm.position.x - logo.position.x) < 1e-6, 'videóra: vízjel-klip ugyanott és ugyanakkora, a projektbe másolt fájllal', `${wm?.w.toFixed(3)}×${wm?.h.toFixed(3)} @ ${wm?.position.x.toFixed(3)},${wm?.position.y.toFixed(3)}`);
    await saveProject(st().project!);
    // 3) a márka-fájl a két projekt mentése után is a helyén (nem költözött a projektbe)
    log(new File(brandUri).exists, 'a márka-logó fájlja a mentések után is a márka-mappában');
    if (r) removeFile(r);
  } finally {
    if (st().project?.id === vidId || st().project?.id === imgId) {
      router.back();
      await sleep(500);
    }
    await deleteProject(imgId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del2', caught));
    await deleteProject(vidId).catch((caught) => logCaught('lib/imageSmoke.tsx:brandlogo-del3', caught));
    await useBrandStyle.getState().removeLogo(brandUri);
    // a felhasználó márkája visszaírva
    await saveBrandStyle(mine);
    useBrandStyle.setState({ colors: mine.colors, fontFamily: mine.fontFamily, logos: mine.logos ?? [] });
    removeFile(src.uri);
  }
}
