/** 🧪 Füstteszt — sávszétválasztás (stem): felület, eszköz-mérés, tartomány- és stem-export. (Áthelyezve: phases05, phases14; viselkedés-változás nélkül.) */
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { encodeWav16 } from '@/lib/offlineMix';
import { readPowerState } from '@/lib/powerStateClient';
import { stemOnDeviceSupported, stemKernels, ensureStemModel, separateOnDevice } from '@/lib/stemSeparationClient';
import { separateTwoStems, jsStemKernels } from '@/lib/stemSeparation';
import { removeModel, modelFileUri, catalogRuntime } from '@/lib/modelRegistryClient';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject, deleteProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { smokeFileHost } from '../../helpers/env';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { exportParts } from '@/components/studio/audio/exportParts';
import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { parseEocd, parseCentralDirectory, localDataOffset, crc32 } from '@/lib/zipStore';
import { type TFunction, t as i18nT } from 'i18next';
import { mixForExport } from '@/lib/audioExportMix';
import '@/lib/dspNativeClient';

/**
 * 🎚️ V5: a felhasználói út — a modell a VALÓDI R2-címről (a helyi példány törölve), a stúdió-művelet a klipből két
 * új sávot csinál (ének, kíséret) a klip vágásával, az eredeti elnémul; egy undo.
 */
export async function smokeStemsUi(log: Log) {
  const SR = 44100;
  // a modell a katalógusból: előbb törölve → a művelet tölti le (sha256) és ellenőrzi
  removeModel('spleeter-2stems');
  const sp = new File(Paths.document, 'smoke_stem_speech.wav');
  if (!sp.exists) await File.downloadFileAsync(`${smokeFileHost()}/speech_hu.wav`, sp);
  const api = (await loadAudioApi())!;
  const speech = (await api.decodeAudioData(sp.uri, SR)).getChannelData(0);
  const n = 30 * SR;
  const mix = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    mix[i] = speech[i % speech.length] + 0.08 * Math.sign(Math.sin(2 * Math.PI * 110 * tt)) + 0.3 * Math.exp(-((tt % 0.5) * 30)) * Math.sin(2 * Math.PI * 55 * tt);
  }
  const f = new File(Paths.document, 'smoke_stemsui_mix.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([mix, mix], SR));
  const id = `prj_smoke_stemsui_${Date.now().toString(36)}`;
  const base = createEmptyProject('smoke stem', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'mix', uri: f.uri, label: 'dal', start: 1, duration: 20, trimIn: 5, sourceDuration: 30, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const undo0 = st().past?.length ?? 0;
    const t0 = Date.now();
    const ids = (await runDevAction('stems.onDevice', 'mix')) as string[] | null;
    const ms = Date.now() - t0;
    log(modelFileUri('spleeter-2stems') !== null && catalogRuntime().smoke?.['spleeter-2stems'] === 'pass', 'a modell a katalógusból letöltve (sha256) és ellenőrizve', `${ms} ms összesen (letöltés + ellenőrzés + szétválasztás)`);
    const p = st().project!;
    const added = p.tracks.flatMap((t) => t.clips.map((c) => ({ t, c: c as AudioClip }))).filter((x) => ids?.includes(x.c.id));
    log(added.length === 2 && added.every((x) => x.t.type.startsWith('aux') && x.c.start === 1 && x.c.trimIn === 5 && x.c.duration === 20), 'két új sáv (ének, kíséret) a klip vágásával', added.map((x) => `${x.t.type}:${x.t.name}`).join(', '));
    const orig = p.tracks.flatMap((t) => t.clips).find((c) => c.id === 'mix') as AudioClip | undefined;
    log(orig?.volume === 0 && (st().past?.length ?? 0) - undo0 === 1, 'az eredeti néma, egy undo-lépés');
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:stemsui', caught));
  }
}
/**
 * 🎚️ V5 (prototípus) mérés: Spleeter 2stems Core ML-lel a telefonon — a modell a Mac fájlszerveréről, a keverék
 * valódi beszéd (ének helyett) + szintetikus kíséret (akkord + lábdob), 3 / 5 / 10 perc; idő, modell-idő, az ének
 * SDR-je az első 60 s-on (a keverékhez képest), a hőállapot.
 */
export async function smokeStemDevice(log: Log) {
  log(null, 'eszköz', `${Device.modelName ?? Platform.OS}`);
  log(stemOnDeviceSupported(), 'a build tartalmazza a stem-modult');
  {
    // natív (vDSP) jelút = JS jelút (azonos „modellel”), 20 s sztereó
    const n = 20 * 44100;
    const l = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i * 0.031) + 0.1 * Math.sin(i * 0.23));
    const r = Float32Array.from({ length: n }, (_, i) => 0.25 * Math.sin(i * 0.017 + 1));
    const fake = async (mag: Float32Array): Promise<[Float32Array, Float32Array]> => [mag, Float32Array.from(mag, (x, i) => x * ((i % 7) / 7))];
    const t1 = Date.now();
    const js = await separateTwoStems(l, r, fake, undefined, jsStemKernels);
    const jsMs = Date.now() - t1;
    const t2 = Date.now();
    const nat = await separateTwoStems(l, r, fake, undefined, stemKernels());
    const natMs = Date.now() - t2;
    let worst = 0;
    for (const [x, y] of [[js.vocals[0], nat.vocals[0]], [js.vocals[1], nat.vocals[1]], [js.accompaniment[0], nat.accompaniment[0]], [js.accompaniment[1], nat.accompaniment[1]]] as const) {
      for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(x[i] - y[i]));
    }
    log(stemKernels() !== jsStemKernels && worst < 1e-4, 'a natív jelút = a JS jelút (20 s)', `max eltérés ${worst.toExponential(1)} · JS ${jsMs} ms, natív ${natMs} ms`);
  }
  const t0 = Date.now();
  const ok = await ensureStemModel();
  log(ok, 'a modell letöltve és betöltve (Core ML)', `${Date.now() - t0} ms`);
  if (!ok) return;
  const SR = 44100;
  const sp = new File(Paths.document, 'smoke_stem_speech.wav');
  if (!sp.exists) await File.downloadFileAsync(`${smokeFileHost()}/speech_hu.wav`, sp);
  const api = (await loadAudioApi())!;
  const speech = (await api.decodeAudioData(sp.uri, SR)).getChannelData(0);
  for (const min of [3, 5, 10]) {
    const n = min * 60 * SR;
    const voc = new Float32Array(n);
    for (let i = 0; i < n; i++) voc[i] = speech[i % speech.length];
    const acc = new Float32Array(n);
    const fr = [110, 138.6, 164.8, 220];
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      let v = 0;
      for (let k = 0; k < 4; k++) v += 0.08 * Math.sign(Math.sin(2 * Math.PI * fr[k] * tt + k));
      v += 0.3 * Math.exp(-((tt % 0.5) * 30)) * Math.sin(2 * Math.PI * 55 * tt);
      acc[i] = v;
    }
    const mixL = Float32Array.from(voc, (x, i) => x + acc[i]);
    const f = new File(Paths.document, `smoke_stem_mix_${min}.wav`);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([mixL, mixL], SR));
    const p0 = await readPowerState();
    const res = await separateOnDevice(f.uri);
    const p1 = await readPowerState();
    f.delete();
    if (!res) {
      log(false, `${min} perc: szétválasztás`, 'nem sikerült');
      continue;
    }
    const est = (await api.decodeAudioData(res.vocalsUri, SR)).getChannelData(0);
    const m = Math.min(60 * SR, est.length);
    let num = 0;
    let den = 0;
    let den0 = 0;
    for (let i = 0; i < m; i++) {
      num += voc[i] * voc[i];
      den += (voc[i] - est[i]) ** 2;
      den0 += acc[i] * acc[i];
    }
    const sdr = 10 * Math.log10(num / den);
    const sdr0 = 10 * Math.log10(num / den0);
    const tm = res.timings;
    log(sdr > sdr0 + 5, `${min} perc: az ének elválik (SDR ${sdr.toFixed(1)} dB, a keverék ${sdr0.toFixed(1)} dB)`, `${(tm.totalMs / 1000).toFixed(1)} s összesen = ${((min * 60) / (tm.totalMs / 1000)).toFixed(1)}× valós idő · modell ${(tm.modelMs / 1000).toFixed(1)} s (${tm.blocks} blokk, ${Math.round(tm.modelMs / tm.blocks)} ms/blokk) · hő ${p0?.thermal}→${p1?.thermal}`);
    new File(res.vocalsUri).delete();
    new File(res.accompanimentUri).delete();
  }
}

/** a sáv megjelenített neve (a stem-fájlnévhez) */
function laneLabelFor(type: string, t: TFunction): string {
  const lane = audioLanes(useEditorStore.getState().project).find((l) => l.type === type);
  return lane ? laneLabel(lane, t) : type;
}
/** ✂️🎚️ Tartomány- és stem-export: a tartomány = a teljes export szelete (masterrel), Σ stem = keverés master nélkül, a némított sáv kimarad. */
export async function smokeStemExport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const mk = (name: string, sec: number, f: number, gate?: (t: number) => number) => {
    const x = Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => 0.4 * Math.sin((2 * Math.PI * f * i) / SR) * (gate ? gate(i / SR) : 1));
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(encodeWav16([x, x], SR, () => 0.5));
    return file.uri;
  };
  const voice = mk('smoke_stem_voice.wav', 4, 220, (t) => (t > 1 && t < 2.5 ? 1 : 0));
  const music = mk('smoke_stem_music.wav', 4, 440);
  const fx = mk('smoke_stem_fx.wav', 1, 880);
  const id = 'prj_smoke_stems';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:stems', caught));
  const base = createEmptyProject('smoke stemek', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: voice, start: 0, duration: 4, sourceDuration: 4, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    audioMaster: { target: 'custom', lufs: -16, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: 0, high: 1 }, multiband: true },
    audioBuses: [{ id: 'rev', name: 'Zengés', fx: { reverb: 0.5 }, gain: 0.8 }],
    audioSends: { sfx: { rev: 0.6 } },
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] }
        : t.type === 'music'
          ? { ...t, clips: [ac({ id: 'm', label: 'zene', uri: music, autoDuck: true })] }
          : t.type === 'sfx'
            ? { ...t, clips: [ac({ id: 'f', label: 'hang', uri: fx, start: 2, duration: 1, sourceDuration: 1 })] }
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
  const tt = i18nT as unknown as TFunction;
  /** 24 bites, sztereó WAV-bájtok → bal csatorna (dither nélkül pontos) */
  const wav24Left = (b: Uint8Array) => {
    const n = (b.length - 44) / 6;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 6;
      let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      out[i] = v / 8388607;
    }
    return out;
  };
  const readAll = (uri: string) => {
    const h = new File(uri).open();
    try {
      return h.readBytes(h.size ?? 0);
    } finally {
      h.close();
    }
  };
  // a teljes export (masterrel), 24 bit
  const mix = mixForExport(st().project!, st().isTrackAudible, st().masterVolume)!;
  const full = await exportOfflineWav(mix, new File(projectExportDir(), 'smoke_stem_full.wav'), undefined, undefined, 'pcm16', { bits: 24 });
  const fullL = wav24Left(readAll(full.uri));
  // In–Out a transzporttal
  st().setPlayhead(1.2);
  st().setRangeIn();
  st().setPlayhead(3.1);
  st().setRangeOut();
  const rng = await exportParts(st().project!, { range: true, stems: false }, 24, tt, false);
  const rL = rng ? wav24Left(readAll(rng.uri)) : new Float32Array();
  const a0 = Math.round(1.2 * SR);
  let d = 0;
  for (let i = 0; i < rL.length; i++) d = Math.max(d, Math.abs(rL[i] - fullL[a0 + i]));
  log(rL.length === Math.round(3.1 * SR) - a0 && d === 0, 'tartomány (In 1,2 – Out 3,1 s, master-lánccal): mintára a teljes export szelete', `${(rL.length / SR).toFixed(3)} s, max eltérés ${d}`);
  // stemek
  const zipRes = await exportParts(st().project!, { range: false, stems: true }, 24, tt, false);
  const zb = zipRes ? readAll(zipRes.uri) : new Uint8Array();
  const eocd = parseEocd(zb, 0)!;
  const entries = parseCentralDirectory(zb.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize), eocd.count);
  const stems = entries.map((e) => {
    const off = localDataOffset(zb.subarray(e.headerOffset, e.headerOffset + 300), e.headerOffset);
    const data = zb.subarray(off, off + e.size);
    return { name: e.name, crcOk: crc32(data) === e.crc, left: wav24Left(data) };
  });
  log(stems.length === 3 && stems.every((x) => x.crcOk), 'a ZIP: 3 stem, mind ép (CRC)', stems.map((x) => x.name).join(' · '));
  const ref = await exportOfflineWav({ ...mix, audioMaster: undefined }, new File(projectExportDir(), 'smoke_stem_ref.wav'), undefined, undefined, 'pcm16', { bits: 24 });
  const refL = wav24Left(readAll(ref.uri));
  let ds = 0;
  for (let i = 0; i < refL.length; i++) ds = Math.max(ds, Math.abs(stems.reduce((s2, x) => s2 + (x.left[i] ?? 0), 0) - refL[i]));
  log(ds < 4e-7, 'Σ stem = a keverés master nélkül (a halkítás és a zengés-busz is benne)', `max eltérés ${ds.toExponential(1)} (24 bit: 1 LSB = 1,2e-7)`);
  const musicStem = stems.find((x) => x.name.includes(laneLabelFor('music', tt)))?.left;
  const lvl = (x: Float32Array | undefined, s0: number, s1: number) => {
    if (!x) return -999;
    let e = 0;
    for (let i = Math.round(s0 * SR); i < Math.round(s1 * SR); i++) e += x[i] * x[i];
    return 10 * Math.log10(e / ((s1 - s0) * SR) + 1e-30);
  };
  const duck = lvl(musicStem, 1.6, 2.3) - lvl(musicStem, 0.3, 0.9);
  log(duck < -6, 'a zene-stem a beszéd alatt halkul (a némított beszéd a kulcs)', `${duck.toFixed(1)} dB`);
  // a némított sáv kimarad; tartomány + stemek
  st().toggleTrackFlag('sfx', 'mute');
  const muted = await exportParts(st().project!, { range: true, stems: true }, 16, tt, false);
  const mb = muted ? readAll(muted.uri) : new Uint8Array();
  const me = parseEocd(mb, 0)!;
  const ment = parseCentralDirectory(mb.subarray(me.cdOffset, me.cdOffset + me.cdSize), me.count);
  const frames = (bytes: number) => (bytes - 44) / 4;
  log(ment.length === 2 && ment.every((e) => frames(e.size) === Math.round(3.1 * SR) - a0), 'a némított effekt-sáv kimarad; tartomány + stemek: minden stem pontosan a tartomány hosszú (16 bit)', ment.map((e) => `${e.name} ${(frames(e.size) / SR).toFixed(3)} s`).join(' · '));
  st().toggleTrackFlag('sfx', 'mute');
  for (const u of [full.uri, ref.uri, rng?.uri, zipRes?.uri, muted?.uri]) if (u) new File(u).delete();
  runDevAction('audio.exportSheet');
  log(true, 'FOTÓZHATÓ', 'az export-lap: Tartomány és Tartalom');
  await sleep(3500);
  st().clearRange();
  router.back();
}
