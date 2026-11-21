/** 🧪 Füstteszt — minták: loopok, felhős könyvtár, Sampler 2.0, ének-hangolás. (Áthelyezve: phases13; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { encodeWav16 } from '@/lib/offlineMix';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import '@/lib/dspNativeClient';

/** 🔁 V2: beépített loopok — a telefon a projekt tempóján süti (100 BPM): a house-loop lábdobja 0,600 s-onként,
 *  a klip 4 ütem, a minta szerkeszthető hangszer-dokumentum; a dallamos loop is; egy visszavonás eltávolítja. */
export async function smokeLoops(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_loops';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:loops', caught));
  const base = createEmptyProject('smoke loopok', '9:16', undefined, 'audio');
  await saveProject({ ...base, id, bpm: 100 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const uris: string[] = [];
  try {
    st().setPlayhead(0);
    runDevAction('audio.loops');
    await sleep(600);
    const t0 = Date.now();
    const clipId = (await runDevAction('loops.place', 'house')) as string | null;
    const ms = Date.now() - t0;
    const p1 = st().project!;
    const clip = p1.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) as AudioClip | undefined;
    const doc = p1.instrumentDocs?.find((d) => d.id === clip?.instrumentDocId);
    const bar = (4 * 60) / 100;
    log(!!clip && Math.abs(clip.duration - 4 * bar) < 0.7 && doc?.kind === 'drums' && doc.bars === 4 && doc.bpm === 100, 'a house-loop a lejátszófejnél: 4 ütem 100 BPM-en, szerkeszthető dob-minta', `${clip?.duration.toFixed(3)} s (4 ütem = ${(4 * bar).toFixed(1)} s) · minta ${doc?.kind} ${doc?.bars} ütem ${doc?.bpm} BPM · ${ms} ms`);
    // a lábdob (minden negyed) a telefonos exportban 0,600 s-onként
    const out = await exportOfflineWav(p1, new File(projectExportDir(), 'smoke_loops_house.wav'), undefined, undefined, 'float32');
    uris.push(out.uri);
    const h = new File(out.uri).open();
    let l: Float32Array;
    try {
      const b = h.readBytes(h.size ?? 0);
      const f = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
      l = Float32Array.from({ length: f.length / 2 }, (_, i) => f[i * 2]);
    } finally {
      h.close();
    }
    // energia-burkoló 5 ms-os ablakokban, a kezdetek a hirtelen emelkedésnél (≥ 0,5 s távolsággal)
    const SR = 44100;
    const win = Math.round(0.005 * SR);
    const env: number[] = [];
    for (let i = 0; i + win <= l.length; i += win) {
      let e = 0;
      for (let k = i; k < i + win; k++) e += l[k] * l[k];
      env.push(e);
    }
    const peak = Math.max(...env);
    const onsets: number[] = [];
    for (let j = 1; j < env.length; j++) {
      const t = (j * win) / SR;
      if (env[j] > peak * 0.25 && env[j - 1] < env[j] * 0.3 && (onsets.length === 0 || t - onsets[onsets.length - 1] > 0.45)) onsets.push(t);
    }
    const gaps = onsets.slice(1, 9).map((t, i) => t - onsets[i]);
    const worst = Math.max(...gaps.map((g) => Math.abs(g - 0.6)));
    log(gaps.length >= 6 && worst < 0.012, 'a lábdob a telefonos exportban 0,600 s-onként (100 BPM, negyedek) — ütemre, nyújtás nélkül', `közök ${gaps.map((g) => g.toFixed(3)).join(' ')} s · legnagyobb eltérés ${(worst * 1000).toFixed(1)} ms`);
    // dallamos loop: szinti-minta
    st().setPlayhead(4 * bar);
    const c2 = (await runDevAction('loops.place', 'chordsPop')) as string | null;
    const p2 = st().project!;
    const clip2 = p2.tracks.flatMap((t) => t.clips).find((c) => c.id === c2) as AudioClip | undefined;
    const doc2 = p2.instrumentDocs?.find((d) => d.id === clip2?.instrumentDocId);
    log(!!clip2 && Math.abs(clip2.start - 4 * bar) < 1e-3 && doc2?.kind === 'synth' && (doc2.synth?.notes.length ?? 0) === 12, 'az akkord-loop a 4. ütem végén: szinti-minta (12 hang), a piano rollban szerkeszthető', `kezdet ${clip2?.start.toFixed(3)} s · ${doc2?.kind} · ${doc2?.synth?.notes.length} hang`);
    st().undo();
    const p3 = st().project!;
    log(!p3.tracks.flatMap((t) => t.clips).some((c) => c.id === c2) && !(p3.instrumentDocs ?? []).some((d) => d.id === doc2?.id), 'egy visszavonás: a klip és a minta is eltűnik', `${p3.tracks.flatMap((t) => t.clips).length} klip, ${(p3.instrumentDocs ?? []).length} minta`);
    runDevAction('audio.loops');
    await sleep(800);
    log(true, 'FOTÓZHATÓ', 'a Loopok lap');
    await sleep(1500);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:loops-del', caught));
    for (const u of uris) {
      const f = new File(u);
      if (f.exists) f.delete();
    }
  }
}
/** 🔁 V2.2: a szerveres teljes könyvtár Pro — Free-ben a Pro-ajánlat nyílik és nem kerül be semmi; Pro-ban a zene
 *  a lejátszófejnél, ismert forrás-tempónál a projekt tempójára nyújtva (120 → 100 BPM: sebesség 0,8333). */
export async function smokeCloudLibrary(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { useEntitlement } = await import('@/store/entitlementStore');
  const { usePaywall } = await import('@/store/paywallStore');
  const { fetchSoundLibrary } = await import('@/lib/render');
  const saved = useEntitlement.getState();
  const prev = { tier: saved.tier, proUntil: saved.proUntil, devPro: saved.devPro };
  const id = 'prj_smoke_cloudlib';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:cloudlib', caught));
  const base = createEmptyProject('smoke felhő-könyvtár', '9:16', undefined, 'audio');
  await saveProject({ ...base, id, bpm: 100 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const clips = () => st().project!.tracks.flatMap((t) => t.clips);
  try {
    const lib = await fetchSoundLibrary().catch(() => []);
    const pick = lib[0];
    log(!!pick, 'a könyvtár listája elérhető (böngészhető)', `${lib.length} tétel`);
    if (!pick) return;
    const track = { ...pick, bpm: 120 };
    useEntitlement.setState({ tier: 'free', proUntil: null, devPro: false });
    usePaywall.setState({ visible: false });
    const n0 = clips().length;
    const r1 = await runDevAction('loops.placeCloud', track);
    log(r1 == null && usePaywall.getState().visible && clips().length === n0, 'Free: a letöltés a Pro-ajánlatot nyitja, nem kerül be klip', `paywall ${usePaywall.getState().visible} · klipek ${n0} → ${clips().length}`);
    usePaywall.setState({ visible: false });
    useEntitlement.setState({ devPro: true });
    const r2 = (await runDevAction('loops.placeCloud', track)) as string | null;
    const c = clips().find((x) => x.id === r2) as AudioClip | undefined;
    log(!!c && Math.abs((c.speed ?? 1) - 100 / 120) < 1e-6 && Math.abs(c.duration - pick.duration / (100 / 120)) < 1e-6 && new File(c.uri).exists, 'Pro: a zene a lejátszófejnél, a projekt tempójára nyújtva (120 → 100 BPM)', `sebesség ${(c?.speed ?? 0).toFixed(4)} · hossz ${c?.duration.toFixed(3)} s (forrás ${pick.duration} s) · ${c?.uri.split('/').pop()}`);
  } finally {
    useEntitlement.setState(prev);
    usePaywall.setState({ visible: false });
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:cloudlib-del', caught));
  }
}
/** 🎛️ V2.3: Sampler 2.0 — Pad mód (szeletelés tranziensre, 4 pad a rácson) és Dallam mód (a minta kromatikusan a
 *  piano rollban); a telefonos exportban a padek a saját szeletüket, a dallam a hangjegyek magasságát adja. */
export async function smokeSampler2(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const wav = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  // 4 ütés különböző hangmagassággal (300/600/900/1200 Hz) 0,25 s-onként → 4 szelet
  const hitsX = new Float32Array(SR);
  [300, 600, 900, 1200].forEach((hz, k) => {
    const at = Math.round(k * 0.25 * SR);
    for (let i = 0; i < 0.2 * SR; i++) hitsX[at + i] = 0.6 * Math.exp(-i / 6000) * Math.sin((2 * Math.PI * hz * i) / SR);
  });
  const hitsUri = wav('smoke_s2_hits.wav', hitsX);
  const a440 = wav('smoke_s2_a440.wav', Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR)));
  const id = 'prj_smoke_sampler2';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sampler2', caught));
  const base = createEmptyProject('smoke sampler 2', '9:16', undefined, 'audio');
  await saveProject({ ...base, id, bpm: 120 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const all = () => st().project!.tracks.flatMap((t) => t.clips) as AudioClip[];
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  const freqIn = (x: Float32Array, a: number, b: number) => {
    let zc = 0;
    const i0 = Math.round(a * SR);
    const i1 = Math.round(b * SR);
    for (let i = i0 + 1; i < i1; i++) if (x[i - 1] < 0 && x[i] >= 0) zc++;
    return (zc * SR) / (i1 - i0);
  };
  const exportL = async (clipId: string, name: string) => {
    const p = st().project!;
    const only = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id === clipId).map((c) => ({ ...c, start: 0 })) })) };
    const out = await exportOfflineWav(only, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const h = new File(out.uri).open();
    try {
      const b = h.readBytes(h.size ?? 0);
      const f = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
      return Float32Array.from({ length: f.length / 2 }, (_, i) => f[i * 2]);
    } finally {
      h.close();
      new File(out.uri).delete();
    }
  };
  try {
    // ── Pad mód ──
    runDevAction('audio.openSampler');
    await waitFor(() => runDevAction('sampler.state') !== undefined, 15000);
    runDevAction('sampler.set', { sampleUri: hitsUri, sampleName: 'ütések.wav', bars: 1 });
    runDevAction('sampler.mode', 'pads');
    await sleep(300);
    const slices = (await runDevAction('sampler.slice')) as number[];
    const okSlices = slices.length === 4 && [0, 0.25, 0.5, 0.75].every((at, k) => Math.abs(slices[k] - at * SR) <= 441);
    log(okSlices, 'szeletelés tranziensre: a 4 ütés kezdete (± 10 ms)', slices.map((x) => (x / SR).toFixed(3)).join(' · '));
    const pads = [0, 1, 2, 3].map((k) => Array.from({ length: 16 }, (_, i) => i === [12, 8, 4, 0][k]));
    runDevAction('sampler.setPads', pads);
    await sleep(300);
    const n0 = all().length;
    runDevAction('sampler.bakePads');
    await waitFor(() => all().length === n0 + 1, 10000);
    const padClip = all()[all().length - 1];
    if (!padClip) throw new Error('nincs pad-klip');
    const padDoc = st().project!.instrumentDocs?.find((d) => d.id === padClip?.instrumentDocId);
    log(!!padDoc?.sampler?.pads && padDoc.sampler.slices?.length === 4 && Math.abs(padClip.duration - 2) < 0.01, 'Pad mód: sütés → klip (1 ütem = 2,0 s) + a minta (szeletek és padek) a projektben', `${padClip?.duration.toFixed(3)} s · ${padDoc?.sampler?.slices?.length} szelet`);
    // fordított sorrend: a 4. pad (1200 Hz) az 1. negyeden, … az 1. pad (300 Hz) a 4. negyeden
    const px = await exportL(padClip.id, 'smoke_s2_pads.wav');
    const pf = [0, 0.5, 1, 1.5].map((t) => freqIn(px, t + 0.02, t + 0.15));
    log([1200, 900, 600, 300].every((hz, k) => Math.abs(pf[k] - hz) / hz < 0.05), 'a telefonos exportban a padek a saját szeletüket játsszák (1200 · 900 · 600 · 300 Hz)', pf.map((x) => x.toFixed(0)).join(' · '));
    // ── Dallam mód ──
    runDevAction('audio.openSampler');
    await waitFor(() => runDevAction('sampler.state') !== undefined, 15000);
    runDevAction('sampler.set', { sampleUri: a440, sampleName: 'a440.wav', bars: 1 });
    runDevAction('sampler.mode', 'melody');
    runDevAction('sampler.root', 69);
    await sleep(300);
    runDevAction('sampler.melody');
    await waitFor(() => runDevAction('synth.notes') !== undefined, 15000);
    runDevAction('synth.set', { notes: [{ midi: 69, startBeat: 0, lengthBeats: 1 }, { midi: 76, startBeat: 1, lengthBeats: 1 }, { midi: 81, startBeat: 2, lengthBeats: 1 }], bars: 1 });
    await sleep(300);
    const n1 = all().length;
    runDevAction('synth.bake');
    await waitFor(() => all().length === n1 + 1, 10000);
    const melClip = all()[all().length - 1];
    const melDoc = st().project!.instrumentDocs?.find((d) => d.id === melClip?.instrumentDocId);
    log(melDoc?.kind === 'sampler' && melDoc.sampler?.rootMidi === 69 && melDoc.sampler.notes?.length === 3, 'Dallam mód: a piano roll a minta hangjával süt → sampler-minta (alaphang A4, 3 hangjegy)', `${melDoc?.kind} · alaphang ${melDoc?.sampler?.rootMidi} · ${melDoc?.sampler?.notes?.length} hang`);
    const mx = await exportL(melClip.id, 'smoke_s2_mel.wav');
    const mf = [0.05, 0.55, 1.05].map((t) => freqIn(mx, t, t + 0.35));
    log([440, 659.26, 880].every((hz, k) => Math.abs(mf[k] - hz) / hz < 0.03), 'a telefonos exportban a hangjegyek magassága: A4 · E5 · A5 (440 · 659 · 880 Hz)', mf.map((x) => x.toFixed(0)).join(' · '));
    // „Minta szerkesztése”: a dallam-klip a piano rollt nyitja a mentett hangjegyekkel
    st().selectClip(melClip.id);
    runDevAction('audio.editClip');
    await sleep(800);
    runDevAction('clipEdit.editInstrument');
    await waitFor(() => ((runDevAction('synth.notes') as string | undefined) ?? '').split(',').length === 3, 15000);
    const notes = runDevAction('synth.notes') as string;
    log(notes?.split(',').length === 3 && notes.startsWith('69@0'), '„Minta szerkesztése”: a dallam a piano rollban nyílik a mentett hangjegyekkel', notes);
    runDevAction('audio.closePianoRoll');
    st().undo();
    log(!all().some((c) => c.id === melClip.id), 'egy visszavonás: a dallam-klip eltűnik', `${all().length} klip`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sampler2-del', caught));
  }
}
/** 🎤 V3.2: ének-hangolás hangonként — a hamis hangok a skálára (±10 cent), a tiszta marad; a terc-harmónia a
 *  hangnem szerint (G4 · B4 · C4) külön sávon; a hangszín marad; egy visszavonás az eredetit adja vissza. */
export async function smokeVocalTune(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { pitchTrack } = await import('@/lib/vocalTune');
  const SR = 44100;
  const voice = (hz: number, sec: number) => {
    let ph = 0;
    return Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => {
      ph += (2 * Math.PI * hz * (1 + 0.003 * Math.sin((2 * Math.PI * 5 * i) / SR))) / SR;
      const env = Math.min(1, i / 400, (sec * SR - i) / 400);
      return env * (0.3 * Math.sin(ph) + 0.15 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph));
    });
  };
  const parts = [voice(329.63 * 2 ** (35 / 1200), 0.8), new Float32Array(Math.round(0.25 * SR)), voice(392 * 2 ** (-40 / 1200), 0.8), new Float32Array(Math.round(0.1 * SR)), voice(220, 0.8), new Float32Array(Math.round(0.3 * SR))];
  const x = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    x.set(p, at);
    at += p.length;
  }
  const f = new File(Paths.document, 'smoke_vocal_sung.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_vocaltune';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:vocaltune', caught));
  const base = createEmptyProject('smoke ének-hangolás', '9:16', undefined, 'audio');
  const dur = x.length / SR;
  const c: AudioClip = { kind: 'audio', id: 'v', label: 'ének', uri: f.uri, start: 0, duration: dur, trimIn: 0, sourceDuration: dur, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const exportOne = async (clipId: string, name: string) => {
    const p = st().project!;
    const only = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((cl) => cl.id === clipId) })) };
    const out = await exportOfflineWav(only, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const h = new File(out.uri).open();
    try {
      const b = h.readBytes(h.size ?? 0);
      const fl = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
      return Float32Array.from({ length: fl.length / 2 }, (_, i) => fl[i * 2]);
    } finally {
      h.close();
      new File(out.uri).delete();
    }
  };
  const pitchAt = (y: Float32Array, t0: number, t1: number) => {
    const fr = pitchTrack(y, SR).filter((p) => p.time >= t0 && p.time <= t1 && p.hz > 0).map((p) => p.hz).sort((a, b) => a - b);
    return fr[fr.length >> 1] ?? 0;
  };
  const cents = (hz: number, want: number) => (hz > 0 ? 1200 * Math.log2(hz / want) : 9999);
  try {
    const t0 = Date.now();
    const r = (await runDevAction('tune.apply', { clipId: 'v', root: 0, minor: false, strength: 1, harmonySteps: 2 })) as { notes: number; shifted: number; harmonyClipId: string | null; timings?: Record<string, number> } | null;
    const ms = Date.now() - t0;
    log(null, 'időmérés (ms)', JSON.stringify(r?.timings ?? {}));
    const clip = st().project!.tracks.flatMap((t) => t.clips).find((cl) => cl.id === 'v') as AudioClip;
    log(!!r && r.notes === 3 && r.shifted === 2 && clip.uri !== f.uri && clip.tune?.sourceUri === f.uri && !!r.harmonyClipId, 'hangolás: 3 hang felismerve, 2 hamis tolva, a klip az új fájlra mutat, az eredeti megjegyezve, harmónia-sáv', `${r?.notes} hang · ${r?.shifted} tolva · ${ms} ms`);
    const y = await exportOne('v', 'smoke_vocal_tuned.wav');
    const notes = [[0.2, 0.6, 329.63], [1.25, 1.65, 392], [2.25, 2.65, 220]] as const;
    const got = notes.map(([a, b, want]) => cents(pitchAt(y, a, b), want));
    log(got.every((cc) => Math.abs(cc) < 10), 'a telefonos exportban a hangok a skálán: E4 · G4 · A3 (±10 cent)', got.map((cc) => `${cc >= 0 ? '+' : ''}${cc.toFixed(1)}`).join(' · ') + ' cent (előtte +35 · −40 · 0)');
    const hy = await exportOne(r!.harmonyClipId!, 'smoke_vocal_harm.wav');
    const harm = [[0.2, 0.6, 392], [1.25, 1.65, 493.88], [2.25, 2.65, 261.63]] as const;
    const hg = harm.map(([a, b, want]) => cents(pitchAt(hy, a, b), want));
    log(hg.every((cc) => Math.abs(cc) < 15), 'a terc-harmónia a hangnem szerint: G4 · B4 · C4 (±15 cent), külön sávon', hg.map((cc) => `${cc >= 0 ? '+' : ''}${cc.toFixed(1)}`).join(' · ') + ' cent');
    st().undo();
    const back = st().project!.tracks.flatMap((t) => t.clips);
    log((back.find((cl) => cl.id === 'v') as AudioClip).uri === f.uri && !back.some((cl) => cl.id === r!.harmonyClipId), 'egy visszavonás: az eredeti ének és nincs harmónia-klip', `${back.length} klip`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:vocaltune-del', caught));
  }
}
