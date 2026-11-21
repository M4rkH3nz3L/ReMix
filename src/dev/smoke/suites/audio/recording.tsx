/** 🧪 Füstteszt — felvétel: szünet, punch-in, áthallás, take-ek, valódi mikrofon. (Áthelyezve: phases06, phases15; viselkedés-változás nélkül.) */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { File, Paths } from 'expo-file-system';
import { getRecordingPermissionsAsync, createAudioPlayer } from 'expo-audio';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { probeAudioDuration } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { useRecordPrefs } from '@/store/recordPrefsStore';
import { setTakeAlignForTest, lastTakeAlign } from '@/lib/recordTakeClient';
import { selectTakeCommand } from '@/lib/punchRecord';
import { encodeWav16 } from '@/lib/offlineMix';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { toneWav, type RecordHandle, RecordHarness } from '../../helpers/audio';
import type { ReactNode } from 'react';
import { startVoiceRecording } from '@/lib/voiceRecording';
import '@/lib/dspNativeClient';

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
/** A10/A43 valódi mikrofonnal: leállítva és a felület bezárásakor is klip lesz, utána szól a lejátszás. */
export async function smokeRecording(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status}) — a felvétel nem mérhető ember nélkül`);
    return;
  }
  const project = createEmptyProject('smoke felvétel', '9:16');
  useEditorStore.getState().loadProject(project, []);
  const voiceClips = () => (useEditorStore.getState().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const mount = () =>
    new Promise<RecordHandle>((resolve) => {
      // a felvétel indításakor rögzített lejátszófej (üres projektben a playhead 0-ra korlátos)
      setHarness(<RecordHarness onReady={resolve} start={() => 1.01} />);
    });

  // A: felvétel → leállítás
  let h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(1500);
  await h.finish.current();
  const a = voiceClips()[0];
  const aDur = a ? await probeAudioDuration(a.uri) : 0;
  log(!!a && Math.abs(a.duration - 1.5) < 0.3, 'A10 a leállított felvétel klip lett, a recorder idejével', `${a?.duration.toFixed(2)} s`);
  log(!!a && Math.abs(aDur - a.duration) < 0.3, 'a fájl hossza egyezik a klipével', `${aDur.toFixed(2)} s`);
  log(a?.start === 1 && a.trimIn === 0 && a.sourceDuration === a.duration, 'A43 frame-rácsra ül, van trimIn és sourceDuration', `start ${a?.start}`);
  log(!!a && !a.uri.includes('/Caches/'), 'a felvétel a projekt-mappába került', a?.uri.split('/').slice(-2).join('/'));

  // a lejátszás a felvétel után halad (a felvételi mód nem ragadt be)
  const tone = toneWav('smoke_after_rec.wav', 2);
  const player = createAudioPlayer(tone);
  await sleep(400);
  player.play();
  await sleep(900);
  const pos = player.currentTime;
  player.remove();
  new File(tone).delete();
  log(pos > 0.4, 'A43 a lejátszás a felvétel után halad', `${pos.toFixed(2)} s`);

  // B: felvétel közben a felület bezárul
  h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(1500);
  setHarness(null);
  await sleep(1500);
  const b = voiceClips()[1];
  const bDur = b ? await probeAudioDuration(b.uri) : 0;
  log(!!b && bDur > 1, 'A10 a bezáráskor futó felvétel is klip lett, a fájl ép', b ? `${b.duration.toFixed(2)} s klip, ${bDur.toFixed(2)} s fájl` : 'nincs klip');
  for (const c of voiceClips()) {
    new File(c.uri).delete();
  }
}
