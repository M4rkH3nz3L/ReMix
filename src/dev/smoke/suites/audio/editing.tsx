/** 🧪 Füstteszt — hang-szerkesztés: crossfade, A/B, markerek, vágólap, csend, összeillesztés. (Áthelyezve: phases05, phases06, phases07, phases14; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { offlineMixPlan, encodeWav16 } from '@/lib/offlineMix';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { previewEngine } from '@/lib/previewEngine';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { toneWav } from '../../helpers/audio';
import { editGridRate } from '@/lib/frames';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { setLongThresholdForTest, canSegment } from '@/lib/longSource';
import { findClipSilences } from '@/lib/audioSilenceClient';
import '@/lib/dspNativeClient';

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
/** ⏸️➕✂️↩️ T6 csend beszúrása + összeillesztés: az export mintára (a beszúrás pontosan 1 s-mal tolja a folytatást; a vágás + összeillesztés = az eredeti, bitre). */
export async function smokeGapEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // a beszéd: a frekvencia 0,1 s-onként ugrik (a tolás mintára ellenőrizhető)
  const v = Float32Array.from({ length: 8 * SR }, (_, i) => 0.4 * Math.sin(2 * Math.PI * (220 + 30 * (Math.floor((i / SR) * 10) % 20)) * (i / SR)));
  const f = new File(Paths.document, 'smoke_gap_voice.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([v, v], SR, () => 0.5));
  const id = 'prj_smoke_gap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:gap', caught));
  const base = createEmptyProject('smoke csend + illesztés', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'v', uri: f.uri, label: 'beszéd', start: 0, duration: 4, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  await saveProject({ ...base, id, markers: [{ id: 'mk', time: 3, label: 'jel' }], tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({})] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'mu', uri: toneWav('smoke_gap_bed.wav', 8), duration: 6, volume: 0.2 })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(voOnly(p), new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  const origin = JSON.stringify(st().project);
  const A = await render(st().project!, 'smoke_gap_a.wav');
  const maxDiff = (x: Float32Array, y: Float32Array, from: number, to: number, shift = 0) => {
    let d = 0;
    for (let i = from; i < to; i++) d = Math.max(d, Math.abs((x[i] ?? 0) - (y[i + shift] ?? 0)));
    return d;
  };
  // 1) csend 1 s a 2. mp-nél, csak a beszéd-sávon
  st().selectClip('v');
  st().setPlayhead(2);
  const n1 = runDevAction('audio.insertSilence1Track') as number;
  const vClips = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  log(n1 === 1 && vClips().length === 2 && vClips()[1].start === 3 && Math.abs((vClips()[1].trimIn ?? 0) - 2) < 1e-9, 'csend beszúrása (csak ez a sáv): a klip kettéválik, a jobb fele 1 s-mal később, a forrás folytatásával', vClips().map((c) => `${c.start}+${c.duration} (trimIn ${c.trimIn})`).join(' · '));
  const B = await render(st().project!, 'smoke_gap_b.wav');
  const seam = Math.round(0.012 * SR);
  const before = maxDiff(A, B, 0, 2 * SR - seam);
  const after = maxDiff(A, B, 2 * SR + seam, 4 * SR - seam, SR);
  let gapPeak = 0;
  for (let i = 2 * SR + seam; i < 3 * SR - seam; i++) gapPeak = Math.max(gapPeak, Math.abs(B[i]));
  log(before === 0 && after === 0 && gapPeak === 0 && B.length - A.length === SR, 'a hang: előtte változatlan, a beszúrás néma, utána ugyanaz pontosan 44 100 mintával később (a varratok 10 ms-os mikro-fade-je nélkül)', `eltérés ${before} / ${after}, csend csúcsa ${gapPeak}, hossz +${B.length - A.length} minta`);
  log(st().project!.markers?.[0]?.time === 3 && (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).duration === 6, 'csak ez a sáv: a zene és a jelölő a helyén', '');
  st().undo();
  log(JSON.stringify(st().project) === origin, 'egy visszavonás: pontosan az eredeti', '');
  // 2) minden sáv
  st().setPlayhead(2);
  runDevAction('audio.insertSilence1All');
  const mus = (st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  log(mus.length === 2 && mus[1].start === 3 && st().project!.markers?.[0]?.time === 4, 'minden sáv: a zene is kettéválik és tolódik, a jelölő 3 → 4 s', mus.map((c) => `${c.start}+${c.duration}`).join(' · '));
  st().undo();
  // 3) vágás → összeillesztés = az eredeti (bitre)
  st().splitClipAt('v', 1.7);
  st().selectClip('v');
  const parts = vClips().length;
  const n3 = runDevAction('audio.join') as number;
  const C = await render(st().project!, 'smoke_gap_c.wav');
  log(parts === 2 && n3 === 2 && vClips().length === 1 && vClips()[0].duration === 4 && maxDiff(A, C, 0, A.length) === 0 && A.length === C.length, 'vágás (1,7 s) → összeillesztés: egy klip, a hang bitre az eredeti', `${parts} → ${vClips().length} klip, eltérés ${maxDiff(A, C, 0, A.length)}`);
  st().undo();
  st().undo();
  log(JSON.stringify(st().project) === origin, 'két visszavonás: pontosan az eredeti', '');
  router.back();
}
/** 🔇 Csendek jóváhagyással: keresés, egyenkénti kihagyás, kivágás (csak ez a sáv / minden sáv), undo, hang. */
export async function smokeSilence(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // beszéd-szerű jel; csendek: 1,5–3 (1,5 s) és 4,5–5,2 (0,7 s); a 6,5–6,9 szünet (0,4 s) marad
  const talk: [number, number][] = [[0, 1.5], [3, 4.5], [5.2, 6.5], [6.9, 8]];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const x = Float32Array.from({ length: 8 * SR }, (_, i) => {
    const t = i / SR;
    return talk.some(([a, b]) => t >= a && t < b) ? 0.3 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0.001 * rnd();
  });
  const src = new File(Paths.document, 'smoke_silence_src.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_silence';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:silence', caught));
  const base = createEmptyProject('smoke csendek', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: src.uri, start: 0, duration: 8, sourceDuration: 8, id: 'x', ...over });
  const music = toneWav('smoke_silence_bed.wav', 8);
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'vo', label: 'beszéd' })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'fx', label: 'hang', uri: music, start: 7, duration: 0.5, sourceDuration: 8, volume: 0.2 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'bed', label: 'zene', uri: music, volume: 0.1 })] }
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
  const track = (type: string) => (st().project?.tracks.find((t) => t.type === type)?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('vo');
  const t0 = Date.now();
  const found = (await runDevAction('audio.silenceFind')) as number | null;
  const rv = useSilenceReview.getState().review;
  const r = rv?.ranges ?? [];
  const fr = r.map((q) => `${q.start.toFixed(3)}–${q.end.toFixed(3)}`).join(', ');
  log(found === 2, 'a keresés 2 csendet talál; a 0,4 s-os szünet marad', `${found} csend: ${fr} (${Date.now() - t0} ms)`);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1 / 30 + 0.011;
  log(r.length === 2 && near(r[0].start, 1.62) && near(r[0].end, 2.88) && near(r[1].start, 4.62) && near(r[1].end, 5.08), 'a határok: a beszéd felől 0,12 s levegő, minta-rácson (V6)', fr);
  // 🎧 hosszú forrás útja (szakaszos natív dekóder, 44,1 kHz) ugyanazokat a csendeket adja
  setLongThresholdForTest(1);
  const longR = await findClipSilences(track('voiceover')[0] as AudioClip, editGridRate(st().project)); // V6: a stúdió rácsa
  setLongThresholdForTest(null);
  const lr = (longR ?? []).map((q) => `${q.start.toFixed(3)}–${q.end.toFixed(3)}`).join(', ');
  log(canSegment() && lr === fr, 'hosszú forrás (szakaszos dekódolás): ugyanazok a csendek', lr);
  log(true, 'FOTÓZHATÓ', 'a két csend pirosan a beszéd-sávon, alul a jóváhagyó sáv');
  await sleep(2500);
  runDevAction('audio.silenceToggle1');
  const kept = useSilenceReview.getState().review?.ranges.map((q) => q.on).join(',');
  log(kept === 'true,false', 'koppintás: a 2. csend megmarad (kihagyva a kivágásból)', kept ?? '-');
  const before = st().project!;
  runDevAction('audio.silenceApply');
  const vo = track('voiceover');
  const cut = r[0].end - r[0].start;
  log(vo.length === 2 && near(vo[1].start, r[0].start) && Math.abs(vo[0].duration + vo[1].duration - (8 - cut)) < 1e-5, 'csak ez a sáv: 1 csend kivágva, a beszéd összezár', `${vo.map((c) => `${c.start.toFixed(3)}+${c.duration.toFixed(3)}`).join(' · ')}`);
  log(track('sfx')[0]?.start === 7 && track('music').length === 1, 'a többi sáv érintetlen', `effekt ${track('sfx')[0]?.start} s, zene ${track('music').length} klip`);
  log(useSilenceReview.getState().review === null, 'a kivágás után a jóváhagyás bezárul', '');
  // a hang: a vágás utáni beszéd = az eredeti, a kivágott idővel előbb
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(p, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    return y;
  };
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const orig = await render(voOnly(before), 'smoke_sil_a.wav');
  const after = await render(voOnly(st().project!), 'smoke_sil_b.wav');
  let d1 = 0;
  let d2 = 0;
  for (let i = Math.round(0.05 * SR); i < Math.round(1.5 * SR); i++) d1 = Math.max(d1, Math.abs(orig[i] - after[i]));
  const shift = Math.round(cut * SR);
  for (let i = Math.round(3.05 * SR); i < Math.round(7.9 * SR); i++) d2 = Math.max(d2, Math.abs(orig[i] - after[i - shift]));
  log(d1 < 1e-5 && d2 < 1e-5 && Math.abs(after.length - (orig.length - shift)) <= 2, 'a hang: a beszéd érintetlen, a vágás után pontosan a kivágott idővel előbb', `eltérés ${d1.toExponential(1)} / ${d2.toExponential(1)}, ${(orig.length / SR).toFixed(3)} → ${(after.length / SR).toFixed(3)} s`);
  st().undo();
  log(track('voiceover').length === 1 && track('voiceover')[0].duration === 8, 'egyetlen visszavonás visszaállítja', `${track('voiceover').length} klip`);
  // minden sáv: az effekt is tolódik, a zene folyamatos
  st().selectClip('vo');
  await runDevAction('audio.silenceFind');
  runDevAction('audio.silenceModeAll');
  runDevAction('audio.silenceApply');
  const removed = r.reduce((s, q) => s + q.end - q.start, 0);
  log(near(track('sfx')[0]?.start ?? -1, 7 - removed) && track('music').length === 1 && track('music')[0].start === 0 && track('voiceover').length === 3, 'minden sáv: az effekt a kivágott idővel előbb, a zene nem vágva', `effekt ${track('sfx')[0]?.start.toFixed(3)} s (7 − ${removed.toFixed(3)}), zene ${track('music').length} klip, beszéd ${track('voiceover').length} darab`);
  st().undo();
  await sleep(1500);
  router.back();
}
