/** 🧪 Füstteszt — hosszú források és eszköz-terhelés: 25 perces forrás, kodekek, hullámforma, mátrix, hő. (Áthelyezve: phases04, phases05, phases06; viselkedés-változás nélkül.) */
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { wavHeader16, encodeWav16 } from '@/lib/offlineMix';
import { exportOfflineWav, recentExportPower } from '@/lib/offlineMixClient';
import { readPowerState } from '@/lib/powerStateClient';
import { matrixRow } from '@/lib/perfMatrix';
import { denoiseStereo } from '@/lib/denoise';
import { formantCorrect } from '@/lib/formant';
import { previewEngine } from '@/lib/previewEngine';
import { canSegment, LongSource } from '@/lib/longSource';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { longToneFile } from '../../helpers/audio';
import { downloadToCache } from '@/lib/media';
import { waveformCacheKey, clearWaveformMemory, getWaveform, lastWaveformMode } from '@/lib/waveform';
import { smokeFileHost } from '../../helpers/env';
import '@/lib/dspNativeClient';

/**
 * 🎧 20 percnél hosszabb forrás: 25 perces fájl, szakaszos (natív ablak-) dekódolással — a minták
 * a helyükön (szakaszhatáron is), a motor a 22. percnél akadás nélkül szól ≤ 8 szakasszal, és a
 * telefonos export a fájl végéről is pontos.
 */
export async function smokeLongSource(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const SEC = 25 * 60;
  // a frekvencia 20 mp-enként lép: f(k) = 200 + 7k Hz — a minta értéke a helyéből számolható
  const value = (i: number) => {
    const k = Math.floor(i / (20 * SR));
    return 0.3 * Math.sin((2 * Math.PI * (200 + 7 * k) * i) / SR);
  };
  const src = new File(Paths.document, 'smoke_long_25min.wav');
  const t0 = Date.now();
  if (!src.exists) {
    src.create();
    const h = src.open();
    h.writeBytes(wavHeader16(SEC * SR, 1, SR));
    const CH = SR * 10;
    for (let a = 0; a < SEC * SR; a += CH) {
      const n = Math.min(CH, SEC * SR - a);
      const buf = new Int16Array(n);
      for (let i = 0; i < n; i++) buf[i] = Math.round(value(a + i) * 32767);
      h.writeBytes(new Uint8Array(buf.buffer));
    }
    h.close();
  }
  log(null, '25 perces forrás', `${((src.size ?? 0) / 1048576).toFixed(0)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(canSegment(), 'a build szakaszosan dekódol (natív ablak)');
  const long = new LongSource(src.uri);
  const check = async (fromSec: number, sec: number) => {
    const a = Math.round(fromSec * SR);
    const b = a + Math.round(sec * SR);
    const t1 = Date.now();
    await long.ensure(a, b);
    const ms = Date.now() - t1;
    const w = long.read(a, b);
    let max = 0;
    for (let i = 0; i < b - a; i++) max = Math.max(max, Math.abs((w?.[0][i] ?? 9) - value(a + i)));
    return { max, ms };
  };
  const edge = await check(39.9, 0.2);
  log(edge.max < 1e-4, 'a szakaszhatáron (40 s) a minták a helyükön', `max eltérés ${edge.max.toExponential(1)}, ${edge.ms} ms`);
  const far = await check(22 * 60 - 0.5, 1);
  log(far.max < 1e-4, 'a 22. percnél a minták a helyükön (szakaszhatár is)', `max eltérés ${far.max.toExponential(1)}, ${far.ms} ms`);
  log(long.loaded() <= 8, 'a memóriában legfeljebb 8 szakasz', `${long.loaded()} szakasz`);
  // a motor a 22. percnél (a teljes 25 perces klip a projektben)
  const id = 'prj_smoke_long';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:long', caught));
  const base = createEmptyProject('smoke hosszú forrás', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'L', uri: src.uri, label: 'podcast', start: 0, duration: SEC, trimIn: 0, sourceDuration: SEC, volume: 0.5, fadeIn: 0, fadeOut: 0, audioFx: { highpass: 80, compressor: true }, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = useEditorStore.getState;
  st().setPlayhead(22 * 60 - 2);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(4500);
  const head = st().playhead;
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(previewEngine.clock() !== null, 'a hosszú forrású projekt az előre renderelt motorról szól');
  // a mérce a 1320 s-os szakaszhatár átlépése akadás nélkül (az indulás eszközönként eltér: az emulátoron ~0,5 s)
  log(stats.late === 0 && head > 22 * 60 + 1, 'a 22. percnél akadás nélkül, a szakaszhatáron át', `${stats.chunks} szelet, ${stats.late} késett (${stats.lateAt.join(',')} ms-nál), indulás ${stats.startMs} ms, fej ${head.toFixed(1)} s`);
  log(previewEngine.loadedSegments().every((n) => n <= 8), 'a motor memóriájában legfeljebb 8 szakasz', previewEngine.loadedSegments().join(','));
  router.back();
  // telefonos export a fájl végéről (2 perces részlet a 21. perctől)
  const ep: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [{ ...c, start: 0, duration: 120, trimIn: 21 * 60 }] } : t)) };
  const t2 = Date.now();
  const { uri: out } = await exportOfflineWav(ep, new File(projectExportDir(), 'smoke_long_out.wav'), undefined, undefined, 'float32');
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out, SR);
  const x = buf.getChannelData(0);
  // a kimenet a 21. perctől: a magas-áteresztő miatt a hangnem (frekvencia) a mérce
  const freq = (y: Float32Array, a: number, b: number) => {
    let n = 0;
    for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) if ((y[i - 1] < 0) !== (y[i] < 0)) n++;
    return n / 2 / (b - a);
  };
  const want1 = 200 + 7 * Math.floor((21 * 60 + 5) / 20);
  const want2 = 200 + 7 * Math.floor((21 * 60 + 65) / 20);
  log(Math.abs(buf.duration - 120) < 0.01 && Math.abs(freq(x, 5, 6) - want1) < 2 && Math.abs(freq(x, 65, 66) - want2) < 2, 'telefonos export a 21. perctől: hossz és hangmagasság pontos', `${buf.duration.toFixed(2)} s, ${freq(x, 5, 6).toFixed(1)}/${want1} Hz, ${freq(x, 65, 66).toFixed(1)}/${want2} Hz, ${((Date.now() - t2) / 1000).toFixed(1)} s`);
  new File(out).delete();
}
/**
 * 📊 V13: eszközmátrix — szabványos mérőkör (motor lejátszás közben, 8 sávos export, hosszú forrás
 * hideg ablaka, zajszűrés, formáns); a végén a tervdokumentum táblázatának kész sora (`MATRIX`).
 */
export async function smokePerfMatrix(log: Log) {
  const SR = 44100;
  const os = `${Device.osName ?? Platform.OS} ${Device.osVersion ?? ''}`.trim();
  const device = Device.modelName ?? `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`;
  log(null, 'eszköz', `${device}, ${os}`);
  let maxThermal = (await readPowerState())?.thermal ?? -1;
  const noteThermal = async () => {
    const p = await readPowerState();
    if (p) maxThermal = Math.max(maxThermal, p.thermal);
  };
  // 8 sáv × 60 s, különböző hangok és effektek
  const SEC = 60;
  const types = ['music', 'voiceover', 'sfx', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5'] as const;
  const fxs: AudioClip['audioFx'][] = [
    { eq: { low: 3, mid: -2, high: 2 }, compressor: true },
    { highpass: 80, compressor: true, reverb: 0.3 },
    { delay: 0.3 },
    { lowpass: 8000, stereoWide: true },
    { eq: { low: -2, mid: 2, high: 1 }, reverb: 0.2 },
    { highpass: 120, delay: 0.2 },
    { compressor: true, limiter: true },
    { eq: { low: 1, mid: 1, high: -3 } },
  ];
  const clips = types.map((type, k) => {
    const f = new File(Paths.document, `smoke_perf_${k}.wav`);
    if (!f.exists) {
      f.create();
      const x = Float32Array.from({ length: SEC * SR }, (_, i) => 0.15 * Math.sin((2 * Math.PI * (110 * (k + 1)) * i) / SR));
      f.write(encodeWav16([x, x], SR, () => 0.5));
    }
    const c: AudioClip = { kind: 'audio', id: `pm${k}`, uri: f.uri, label: type, start: 0, duration: SEC, trimIn: 0, sourceDuration: SEC, volume: 0.4, fadeIn: 0, fadeOut: 0, pan: (k % 3) / 3 - 0.33, audioFx: fxs[k], source: 'imported' };
    return { type, c };
  });
  // futásonként új azonosító: a meleg ismétlésnél a stúdió még az előző (azonos id-jű) projekten áll
  const id = `prj_smoke_perf_${Date.now().toString(36)}`;
  const base = createEmptyProject('smoke mátrix', '9:16', undefined, 'audio');
  const tracks = [
    ...base.tracks.map((t) => {
      const hit = clips.find((x) => x.type === t.type);
      return hit ? { ...t, clips: [hit.c] } : t;
    }),
    ...clips.filter((x) => !base.tracks.some((t) => t.type === x.type)).map((x) => ({ id: `trk_${x.type}`, type: x.type, name: x.type, clips: [x.c] })),
  ];
  const project: Project = { ...base, id, tracks };
  await saveProject(project);
  // motor lejátszás közben
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  // dev-módban a Metro a hidegindítás után lustán tölti a modulokat → a stúdió több mp is lehet
  for (let i = 0; i < 150 && st().project?.id !== id; i++) await sleep(200);
  log(st().project?.id === id, 'a mérőprojekt betöltött a stúdióban');
  await sleep(2500);
  st().setPlayhead(5);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(8000);
  const head = st().playhead;
  st().setPlaying(false);
  const es = previewEngine.takeStats();
  log(null, 'motor-diag', `fej ${head.toFixed(2)} s (5 → +8 s várt), lejátszik: ${previewEngine.clock() !== null}`);
  const engine = { chunks: es.chunks, late: es.late, avgMixMs: es.chunks > 0 ? es.mixMs / es.chunks : 0, maxMixMs: es.maxMixMs };
  log(previewEngine.clock() !== null && es.late === 0 && es.chunks >= 60 && head > 12, 'motor: 8 sáv effektekkel, akadás nélkül, végig szólt', `${es.chunks} szelet, átlag ${engine.avgMixMs.toFixed(1)} ms, max ${es.maxMixMs} ms, ${es.late} késett (${es.lateAt.join(',')} ms-nál), min. előny ${Math.round(es.minLeadMs)} ms, indulás ${es.startMs} ms`);
  router.back();
  await sleep(500);
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:perf', caught));
  await noteThermal();
  // telefonos export
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_perf_out.wav'));
  const exportMs = Date.now() - t0;
  new File(out).delete();
  log(exportMs < SEC * 1000, 'export: 8 sáv × 60 s gyorsabb a valós időnél', `${exportMs} ms = ${(SEC / (exportMs / 1000)).toFixed(1)}×`);
  await noteThermal();
  // hosszú forrás: hideg ablak a 27. percnél
  const long = new LongSource(longToneFile().uri);
  const a = 27 * 60 * SR;
  const t1 = Date.now();
  await long.ensure(a, a + SR);
  const longSourceMs = Date.now() - t1;
  log(longSourceMs < 1000, 'hosszú forrás: hideg ablak 1 s alatt', `${longSourceMs} ms`);
  // zajszűrés 60 s sztereó
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const nl = Float32Array.from({ length: 60 * SR }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 300 * i) / SR) + 0.05 * rnd());
  const nr = Float32Array.from(nl);
  const t2 = Date.now();
  await denoiseStereo(nl, nr);
  const denoise60Ms = Date.now() - t2;
  log(denoise60Ms * 10 < 60_000, 'zajszűrés: 10 perc becsülten 60 s alatt', `60 s → ${denoise60Ms} ms`);
  await noteThermal();
  // formáns 10 s mono
  const ref = nl.subarray(0, 10 * SR);
  const shifted = Float32Array.from(ref, (v, i) => ref[Math.min(ref.length - 1, Math.round(i * 1.12))] ?? v);
  const t3 = Date.now();
  formantCorrect(ref, shifted, SR);
  const formant10Ms = Date.now() - t3;
  log(formant10Ms < 10_000, 'formáns: 10 s valós időnél gyorsabban', `${formant10Ms} ms`);
  await noteThermal();
  const row = matrixRow({ date: new Date().toISOString().slice(0, 10), device, os, engine, exportRun: { tracks: 8, sec: SEC, ms: exportMs }, longSourceMs, denoise60Ms, formant10Ms, maxThermal });
  log(null, 'MATRIX', row);
}
/**
 * 🌡️ S19: 30 perces, effektezett, két sávos telefonos export — a hőállapot és az akkumulátor
 * naplózva, súlyos hőnél a keverés pihen (lásd `thermalPolicy`). Hosszú (~percek) mérés.
 */
export async function smokeThermal(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const SEC = 30 * 60;
  const p0 = await readPowerState();
  log(p0 !== null, 'a build adja a hő- és akkumulátor-állapotot', JSON.stringify(p0));
  const src = longToneFile();
  const base = createEmptyProject('smoke hő', '9:16', undefined, 'audio');
  const voice: AudioClip = { kind: 'audio', id: 'TV', uri: src.uri, label: 'hang', start: 0, duration: SEC, trimIn: 0, sourceDuration: SEC, volume: 0.6, fadeIn: 0, fadeOut: 0, audioFx: { highpass: 80, eq: { low: 2, mid: -2, high: 3 }, compressor: true, reverb: 0.3 }, source: 'imported' };
  const music: AudioClip = { ...voice, id: 'TM', label: 'zene', volume: 0.3, pan: -0.3, audioFx: { lowpass: 9000, delay: 0.3, stereoWide: true } };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [voice] } : t.type === 'music' ? { ...t, clips: [music] } : t)) };
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_thermal_out.wav'));
  const ms = Date.now() - t0;
  const p1 = await readPowerState();
  const size = new File(out).size ?? 0;
  const want = 44 + SEC * SR * 4;
  log(Math.abs(size - want) <= 8, '30 perces export elkészült, a hossz pontos', `${(size / 1048576).toFixed(0)} MB, ${(ms / 1000).toFixed(1)} s = ${(SEC / (ms / 1000)).toFixed(1)}× valós idő`);
  const rec = recentExportPower()[recentExportPower().length - 1];
  log(rec !== undefined && rec.summary.samples >= Math.floor(ms / 4000), 'az export hőnaplót vett', rec ? `${rec.summary.samples} minta` : 'nincs');
  if (rec) {
    const s = rec.summary;
    log(null, 'hő', `max ${s.maxThermal}, súlyos ${(s.hotMs / 1000).toFixed(0)} s, pihenő ${(s.restMs / 1000).toFixed(1)} s`);
    log(null, 'akkumulátor', s.batteryDropPct === null ? `töltés közben / ismeretlen (${p0?.battery} → ${p1?.battery})` : `−${s.batteryDropPct} %-pont (${p0?.battery} → ${p1?.battery})`);
    // percenkénti idővonal (hőszint), hogy látszódjon a felmelegedés
    const line: string[] = [];
    for (const x of rec.samples) if (line.length === 0 || x.atMs >= line.length * 60_000) line.push(`${Math.round(x.atMs / 1000)}s:${x.thermal}`);
    log(null, 'hő-idővonal', line.join(' '));
    log(s.maxThermal < 2 || s.restMs > 0, 'súlyos hőnél a keverés pihent (vagy nem melegedett túl)');
  }
  new File(out).delete();
}
/** 🎧 Hosszú tömörített forrás szakaszosan (mp3 44,1/48 kHz, m4a 48 kHz): időzítés (eltolás) és pontosság a jel ismert értékéhez. */
export async function smokeLongCodec(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(canSegment(), 'a build szakaszosan dekódol (natív ablak)', `${Platform.OS}`);
  const SR = 44100;
  // a frekvencia 0,1 s-onként vált (200 + 37·(k mod 50) Hz): a mérőablakban az eltolás egyértelmű
  const value = (i: number) => 0.3 * Math.sin((2 * Math.PI * (200 + 37 * (Math.floor((i / SR) * 10) % 50)) * i) / SR);
  for (const name of ['hop_44k.mp3', 'hop_48k.mp3', 'hop_48k.m4a']) {
    const t0 = Date.now();
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `smoke_${name}`);
    if (!local) {
      log(false, `${name}: letöltés`, '-');
      continue;
    }
    const long = new LongSource(local);
    // a mérőablakok frekvencia-határon (20 s-onként vált) — a tiszta szinuszon a korreláció periodikus, ott az eltolás nem egyértelmű
    for (const [label, from] of [['1 s', 1.0], ['40 s (szakaszhatár)', 39.95], ['22. perc (1320 s)', 22 * 60 - 0.05]] as const) {
      const a = Math.round(from * SR);
      const n = 4410;
      const pad = 6000;
      const t1 = Date.now();
      await long.ensure(a - pad, a + n + pad);
      const w = long.read(a - pad, a + n + pad);
      const ms = Date.now() - t1;
      if (!w) {
        log(false, `${name} @ ${label}`, 'nincs adat');
        continue;
      }
      const x = w[0];
      // az eltolás: a legjobb egyezés a referenciával ±6000 mintán belül
      let bestLag = 0;
      let best = -Infinity;
      for (let lag = -pad; lag <= pad; lag++) {
        let c = 0;
        for (let i = 0; i < n; i += 2) c += x[pad + lag + i] * value(a + i);
        if (c > best) {
          best = c;
          bestLag = lag;
        }
      }
      let sig = 0;
      let err = 0;
      for (let i = 0; i < n; i++) {
        const r = value(a + i);
        sig += r * r;
        err += (x[pad + i] - r) * (x[pad + i] - r);
      }
      const snr = 10 * Math.log10(sig / Math.max(1e-20, err));
      let errB = 0;
      for (let i = 0; i < n; i++) errB += (x[pad + bestLag + i] - value(a + i)) ** 2;
      log(null, `${name} @ ${label}: a legjobb illesztés`, `eltolás ${bestLag}, SNR ott ${(10 * Math.log10(sig / Math.max(1e-20, errB))).toFixed(1)} dB`);
      log(Math.abs(bestLag) <= 1 && snr > 25, `${name} @ ${label}: a minták a helyükön`, `eltolás ${bestLag} minta, SNR ${snr.toFixed(1)} dB, ${ms} ms`);
    }
    log(long.loaded() <= 8, `${name}: a memóriában legfeljebb 8 szakasz`, `${long.loaded()} (letöltés+mérés ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
/** 〰️🎧 Hosszú forrás hullámformája szakaszosan: 30 perces mp3/m4a, percenként 0,25 s-os impulzus a 30. mp-nél — a csúcsok a helyükön a fájl végén is. */
export async function smokeLongWave(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const name of ['env_44k.mp3', 'env_48k.m4a']) {
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `smoke_${name}`);
    if (!local) {
      log(false, `${name}: letöltés`, '-');
      continue;
    }
    const f = new File(local);
    const cached = new File(Paths.cache, `${waveformCacheKey(local, f.size ?? 0, f.modificationTime ?? 0)}.json`);
    if (cached.exists) cached.delete();
    clearWaveformMemory();
    const t0 = Date.now();
    const w = await getWaveform(local, { userInitiated: true });
    const ms = Date.now() - t0;
    if (!w) {
      log(false, `${name}: hullámforma`, 'null');
      continue;
    }
    log(lastWaveformMode() === 'segmented' && Math.abs(w.peaks.length - 1800 * 64) <= 2, `${name}: szakaszosan számolva, 30 perc × 64 csúcs`, `${lastWaveformMode()}, ${w.peaks.length} csúcs, ${(ms / 1000).toFixed(1)} s`);
    // az impulzus a perc 30,00–30,25 mp-e = a 1920–1935. csúcs; a széleken ±1 csúcs (16 ms) tűrés
    const rows: string[] = [];
    let ok = true;
    for (const m of [1, 15, 29]) {
      const b = m * 3840 + 1920;
      const inside = w.peaks.slice(b + 1, b + 15);
      const before = w.peaks.slice(b - 6, b - 1);
      const after = w.peaks.slice(b + 17, b + 22);
      // a próbafájl szintjei: alap 0,1·0,707, impulzus 0,8·0,707 (az ffmpeg mono→sztereó −3 dB)
      const good = inside.every((x) => x >= 0.45) && before.every((x) => x <= 0.15) && after.every((x) => x <= 0.15);
      ok &&= good;
      rows.push(`${m}. perc: bent ${Math.min(...inside).toFixed(2)}–${Math.max(...inside).toFixed(2)}, előtte ≤ ${Math.max(...before).toFixed(2)}, utána ≤ ${Math.max(...after).toFixed(2)}`);
    }
    log(ok, `${name}: az impulzusok a helyükön (1., 15., 29. perc, ±16 ms)`, rows.join(' · '));
    const again = Date.now();
    clearWaveformMemory();
    const w2 = await getWaveform(local, { userInitiated: true });
    log(!!w2 && w2.peaks.length === w.peaks.length && Date.now() - again < 3000, `${name}: másodszor a lemez-cache-ből`, `${Date.now() - again} ms`);
  }
}
