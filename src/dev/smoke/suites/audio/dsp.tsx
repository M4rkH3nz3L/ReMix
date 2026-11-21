/** 🧪 Füstteszt — DSP: zajszűrés, natív magok bit-paritása és sebessége, szakaszos dekódolás. (Áthelyezve: phases04, phases12, phases13, phases14; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { encodeWav16, offlineMixPlan, mixRange } from '@/lib/offlineMix';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { integratedLoudness } from '@/lib/loudness';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';
import type { Log } from '../../helpers/core';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { downloadToCache } from '@/lib/media';
import { smokeFileHost } from '../../helpers/env';
import { runKernel, KERNEL, runKernelJs, nativeDspActive, highShelfNorm, type KernelKind } from '@/lib/dspKernels';
import '@/lib/dspNativeClient';

/** 🧹📏 Zajszűrés + normalizálás a telefonon: 60 mp-es zajos klip — idő, hatás és a −16 LUFS. */
export async function smokeDenoise(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // valódi fehér zaj (mulberry32; a túlcsorduló LCG rövid ciklusba ragadhat)
  let a = 5;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const n = 60 * SR;
  // 0,5 s hang / 0,5 s szünet, végig halk zaj
  const x = Float32Array.from({ length: n }, (_, i) => (Math.floor(i / (SR / 2)) % 2 === 0 ? 0.05 * Math.sin((2 * Math.PI * 330 * i) / SR) : 0) + 0.005 * rnd());
  const src = new File(Paths.document, 'smoke_denoise.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const base = createEmptyProject('smoke zajszűrés', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'dn', uri: src.uri, label: 'dn', start: 0, duration: 60, trimIn: 0, sourceDuration: 60, volume: 1, fadeIn: 0, fadeOut: 0, audioFx: { denoise: true, normalize: true }, source: 'voiceover' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
  log(offlineMixPlan(project).unsupported.length === 0, 'zajszűrés + normalizálás a közös DSP-ben (nem a régi úton)');
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_denoise_out.wav'));
  const ms = Date.now() - t0;
  log(ms < 40000, '60 mp zajszűrése + normalizálása a telefonon', `${(ms / 1000).toFixed(1)} s (${((ms / 60000) * 1000).toFixed(0)} ms / hang-mp)`);
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out, SR);
  const l = buf.getChannelData(0).slice();
  const r = buf.getChannelData(1).slice();
  const lufs = integratedLoudness(l, r, SR);
  log(Math.abs(lufs - -16) < 1, 'a kimenet −16 LUFS', `${lufs.toFixed(2)} LUFS`);
  const gapDb = (y: Float32Array, scale: number) => {
    let s = 0;
    let k = 0;
    for (let i = Math.round(10.6 * SR); i < Math.round(10.9 * SR); i++) {
      s += (y[i] / scale) ** 2;
      k++;
    }
    return 10 * Math.log10(s / k + 1e-30);
  };
  // a normalizálás erősítését kivéve: a szünetben a zaj a bemenethez képest
  const gain = Math.pow(10, (lufs - integratedLoudness(x, x, SR)) / 20);
  log(gapDb(l, gain) - gapDb(x, 1) < -8, 'a szünetekben a zaj legalább 8 dB-lel csökkent', `${(gapDb(l, gain) - gapDb(x, 1)).toFixed(1)} dB`);
  new File(out).delete();
  // 🎙️ hangjavítás + visszhang-csökkentés (egygombos csomagok) ugyanezen a jelen, 20 mp
  const c2: AudioClip = { ...c, id: 've', duration: 20, audioFx: undefined, voiceEnhance: true, deReverb: true };
  const p2: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c2] } : t)) };
  log(offlineMixPlan(p2).unsupported.length === 0, 'hangjavítás + visszhang-csökkentés a közös DSP-ben');
  const t1 = Date.now();
  const { uri: out2 } = await exportOfflineWav(p2, new File(projectExportDir(), 'smoke_voice_out.wav'));
  const b2 = await api!.decodeAudioData(out2, SR);
  const l2 = b2.getChannelData(0).slice();
  const lufs2 = integratedLoudness(l2, b2.getChannelData(1).slice(), SR);
  const g2 = Math.pow(10, (lufs2 - integratedLoudness(x.subarray(0, 20 * SR), x.subarray(0, 20 * SR), SR)) / 20);
  log(Math.abs(lufs2 - -16) < 1 && gapDb(l2, g2) - gapDb(x, 1) < -8, 'hangjavítás: −16 LUFS, a szünetekben kevesebb zaj', `${lufs2.toFixed(2)} LUFS, zaj ${(gapDb(l2, g2) - gapDb(x, 1)).toFixed(1)} dB, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  new File(out2).delete();
  src.delete();
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
/** 🔬 diagnózis: a natív `decodeWindow` ugyanarra a videóra többször — a kimenet hossza és eltolása az ismert jelhez */
export async function smokeDecodeDiag(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const Nat = requireOptionalNativeModule<{ decodeWindow(u: string, s: number, d: number, o: string): Promise<{ frames: number; channels: number }> }>('RemixRender');
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, `smoke_diag_${Date.now()}.mp4`);
  if (!Nat || !vid) {
    log(false, 'diag', 'nincs natív modul vagy videó');
    return;
  }
  const SR = 44100;
  const ref = (i: number) => 0.4 * Math.sin(2 * Math.PI * (300 + 40 * (Math.floor((i / SR) * 10) % 25)) * (i / SR));
  for (let run = 0; run < 8; run++) {
    const f = new File(Paths.cache, `diag_${run}.f32`);
    const start = run % 2 === 0 ? 0 : 0.5;
    const info = await Nat.decodeWindow(vid, start, 4, f.uri.replace('file://', ''));
    const h = f.open();
    const b = h.readBytes(h.size ?? 0);
    h.close();
    f.delete();
    const ch = info.channels;
    const { to44k } = await import('@/lib/longSource');
    const a = await to44k(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)), ch, (info as { sampleRate?: number }).sampleRate);
    let bl = 0;
    let bv = -Infinity;
    for (let lag = -200; lag <= 200; lag++) {
      let xy = 0;
      const off = Math.round(start * SR);
      for (let j = SR; j < 2 * SR; j += 2) xy += (a[(j - off + lag) * ch] ?? 0) * ref(j);
      if (xy > bv) {
        bv = xy;
        bl = lag;
      }
    }
    log(null, `decodeWindow #${run} (kezdet ${start} s)`, `frames ${info.frames} @ ${(info as { sampleRate?: number }).sampleRate ?? 44100} Hz → ${a.length / ch} @ 44100, ch ${ch}, eltolás ${bl}`);
  }
}
/** ⚡ S20: a zajszűrés natív magja — bitre azonos a JS-sel (az arany ujjlenyomattal is), és a sebesség: a cél
 *  10 perc hang ≤ 1 perc (≤ 0,1 s / hang-mp) iPaden. */
export async function smokeDenoiseNative(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const dn = await import('@/lib/denoise');
  const native = dn.getNativeDenoise();
  log(!!native, 'a natív zajszűrő-mag be van kötve', `${!!native}`);
  if (!native) return;
  const hash = (xs: Float32Array[]) => {
    let h = 2166136261;
    for (const x of xs) {
      const u = new Uint32Array(x.buffer, x.byteOffset, x.length);
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
    }
    return h.toString(16);
  };
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const n = 44100 * 3;
  const l = Float32Array.from({ length: n }, (_, i) => 0.05 * rnd() + (i > 44100 && i < 88200 ? 0.4 * Math.sin(i / 7) : 0));
  const r = Float32Array.from({ length: n }, (_, i) => 0.05 * rnd() + (i > 44100 && i < 88200 ? 0.3 * Math.sin(i / 9) : 0));
  const hn = hash(await dn.denoiseStereo(l, r));
  dn.setNativeDenoise(null);
  let hj = '';
  try {
    hj = hash(await dn.denoiseStereo(l, r));
  } finally {
    dn.setNativeDenoise(native);
  }
  log(hn === hj && hn === '80181d20', 'natív = JS bitre (és az arany ujjlenyomat)', `natív ${hn} · JS ${hj} · arany 80181d20`);
  // sebesség: 60 s zajos „beszéd” sztereóban
  const m = 44100 * 60;
  const bl = Float32Array.from({ length: m }, (_, i) => 0.03 * rnd() + 0.3 * Math.sin(i / 11) * (Math.floor(i / 22050) % 2));
  const br = Float32Array.from(bl, (v) => v * 0.9);
  let t0 = Date.now();
  await dn.denoiseStereo(bl, br);
  const tn = (Date.now() - t0) / 1000;
  dn.setNativeDenoise(null);
  let tj = 0;
  try {
    t0 = Date.now();
    await dn.denoiseStereo(bl.subarray(0, 44100 * 10), br.subarray(0, 44100 * 10));
    tj = ((Date.now() - t0) / 1000) * 6;
  } finally {
    dn.setNativeDenoise(native);
  }
  log(tn / 60 <= 0.1, 'sebesség: 10 perc hang ≤ 1 perc (≤ 0,1 s / hang-mp)', `natív ${(tn / 60).toFixed(3)} s/mp (60 s: ${tn.toFixed(1)} s, 10 perc ≈ ${(tn * 10).toFixed(0)} s) · JS ≈ ${(tj / 60).toFixed(3)} s/mp · ${(tj / tn).toFixed(0)}×`);
}
/** ⚡ a formáns-korrekció natív magja — bitre azonos a JS-sel, és a sebesség (az ének-hangolás szűk keresztmetszete) */
export async function smokeFormantNative(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const fm = await import('@/lib/formant');
  const native = fm.getNativeFormant();
  log(!!native, 'a natív formáns-mag be van kötve', `${!!native}`);
  if (!native) return;
  const SR = 44100;
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const mk = (hz: number, sec: number) => {
    let ph = 0;
    return Float32Array.from({ length: Math.round(sec * SR) }, () => {
      ph += (2 * Math.PI * hz) / SR;
      return 0.3 * Math.sin(ph) + 0.15 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph) + 0.01 * rnd();
    });
  };
  const ref = mk(200, 3);
  const sh = mk(267, 3);
  const hash = (x: Float32Array) => {
    let h = 2166136261;
    const u = new Uint32Array(x.buffer, x.byteOffset, x.length);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
    return h.toString(16);
  };
  let t0 = Date.now();
  const a = fm.formantCorrect(ref, sh, SR);
  const tn = (Date.now() - t0) / 1000;
  fm.setNativeFormant(null);
  let b: Float32Array = new Float32Array(0);
  let tj = 0;
  try {
    t0 = Date.now();
    b = fm.formantCorrect(ref, sh, SR);
    tj = (Date.now() - t0) / 1000;
  } finally {
    fm.setNativeFormant(native);
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  log(hash(a) === hash(b), 'natív = JS bitre', `natív ${hash(a)} · JS ${hash(b)} · max eltérés ${d.toExponential(1)}`);
  log(tn < tj, 'sebesség: 3 s hang formáns-korrekciója', `natív ${(tn * 1000).toFixed(0)} ms · JS ${(tj * 1000).toFixed(0)} ms · ${(tj / Math.max(tn, 0.001)).toFixed(0)}×`);
}
/** ⏱️ DSP-profil az eszközön (Hermes): 3 klip 8 s-a fokozatonként (ideiglenes mérés). */
export async function smokeDspProf(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const src = Float32Array.from({ length: 20 * SR }, (_, i) => Math.sin(i / 20) * 0.3);
  const run = (fx: object, master: boolean, sec = 2) => {
    const base = createEmptyProject('x', '9:16', undefined, 'audio');
    const mk = (cid: string, start: number, pan: number) => ({ kind: 'audio', id: cid, uri: 'file:///a.wav', label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, pan, audioFx: fx, source: 'imported' });
    const project = { ...base, ...(master ? { audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: -1, high: 1.5 }, multiband: true } } : {}), tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.5)] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 0.5, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('v', 1, 0)] } : t)) } as unknown as Project;
    const plan = { ...offlineMixPlan(project), masterGain: 1 };
    const sources = new Map([['file:///a.wav', { channels: [src, src], sampleRate: SR }]]);
    const state = new Map();
    const CH = Math.round(0.125 * SR);
    const t0 = Date.now();
    for (let a = SR; a < (1 + sec) * SR; a += CH) {
      const out: [Float32Array, Float32Array] = [new Float32Array(CH), new Float32Array(CH)];
      mixRange(plan, sources as never, out, a, a + CH, 1, state);
    }
    return Math.round((Date.now() - t0) / (sec * 8));
  };
  const all = { highpass: 90, lowpass: 12000, eq: { low: 3, mid: -2, high: 2 }, gate: true, deEsser: true, compressor: true, reverb: 0.5, delay: 0.4, stereoWide: true, limiter: true };
  run({}, false, 1);
  const rows = [`semmi ${run({}, false)}`, `master ${run({}, true)}`];
  for (const [k, v] of Object.entries(all)) rows.push(`${k} ${run({ [k]: v }, false)}`);
  rows.push(`mind ${run(all, false)}`, `mind+master ${run(all, true)}`);
  log(null, 'ms / 125 ms-os szelet (3 klip)', rows.join(' | '));
  // egy mag-hívás ára (5512 mintás sztereó szelet): a natív számítás vs a híváskeret
  const bl = new Float32Array(5512);
  const br = new Float32Array(5512);
  const bp = Float64Array.of(0.2, 0.4, 0.2, -0.5, 0.3);
  const bs = new Float64Array(8);
  let t1 = Date.now();
  for (let k = 0; k < 200; k++) runKernel(KERNEL.BIQUAD, bl, br, bp, bs);
  const nat = (Date.now() - t1) / 200;
  t1 = Date.now();
  for (let k = 0; k < 20; k++) runKernelJs(KERNEL.BIQUAD, bl, br, bp, bs);
  const jsMs = (Date.now() - t1) / 20;
  const sm = new Float32Array(64);
  t1 = Date.now();
  for (let k = 0; k < 2000; k++) runKernel(KERNEL.BIQUAD, sm, sm, bp, bs);
  log(null, 'egy biquad-hívás', `natív ${nat.toFixed(3)} ms · JS ${jsMs.toFixed(2)} ms · üres hívás ${((Date.now() - t1) / 2000).toFixed(3)} ms`);
}
/** ⚡ A natív DSP-mag = a JS-mag, bitre (minden fajta, darabolva, eltolt `subarray`-jel is); és a sebesség. */
export async function smokeDspNative(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(nativeDspActive(), 'a natív DSP-mag be van kötve (a build tudja)', `${nativeDspActive()}`);
  if (!nativeDspActive()) return;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const sig = (n: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * (Math.sin(i / 7) * 0.6 + rnd() * 0.4) * (i % 3000 < 1500 ? 1 : 0.02));
  const hs = highShelfNorm(5500, 0, 44100);
  const cases: { name: string; kind: KernelKind; p: () => Float64Array; st: () => Float64Array; aux?: () => Float32Array }[] = [
    { name: 'biquad', kind: KERNEL.BIQUAD, p: () => Float64Array.of(0.2, 0.4, 0.2, -0.5, 0.3), st: () => new Float64Array(8) },
    { name: 'kompresszor', kind: KERNEL.COMP, p: () => Float64Array.of(-18, 3, 0.004, 0.0002, 9), st: () => new Float64Array(1) },
    { name: 'kapu', kind: KERNEL.GATE, p: () => Float64Array.of(-26, -24.4, 9, 0.004, 0.0003), st: () => Float64Array.of(0, 1) },
    { name: 'limiter', kind: KERNEL.LIMIT, p: () => Float64Array.of(0.5, 0.0005), st: () => Float64Array.of(1) },
    { name: 'szaturáció', kind: KERNEL.SAT, p: () => Float64Array.of(3.8, 1 / Math.tanh(3.8)), st: () => new Float64Array(0) },
    { name: 'haas', kind: KERNEL.HAAS, p: () => Float64Array.of(90, 93), st: () => new Float64Array(1), aux: () => new Float32Array(94) },
    { name: 'visszhang', kind: KERNEL.ECHO, p: () => Float64Array.of(0.8, 0.9, 2, 1764, 3308, 0.55, 0.39), st: () => new Float64Array(2), aux: () => new Float32Array(2 * 3309) },
    { name: 'de-esser', kind: KERNEL.DEESS, p: () => Float64Array.of(0.25, 0.01, 0.0004, 44100, 7, ...hs), st: () => { const x = new Float64Array(24); x[2] = 1; x[3] = 1; return x; } },
  ];
  const eqBits = (a: Float32Array | Float64Array, b: Float32Array | Float64Array) => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  for (const c of cases) {
    const N = 6000;
    const L0 = sig(N + 64, 0.9);
    const R0 = sig(N + 64, 0.7);
    const run = (fn: typeof runKernel) => {
      const l = Float32Array.from(L0);
      const r = Float32Array.from(R0);
      const p = c.p();
      const st = c.st();
      const aux = c.aux ? c.aux() : null;
      // három darab, a középső eltolt nézet (subarray) — a darabolás és az eltolás is számít
      fn(c.kind, l.subarray(0, 2000), r.subarray(0, 2000), p, st, aux);
      fn(c.kind, l.subarray(2000, 4100), r.subarray(2000, 4100), p, st, aux);
      fn(c.kind, l.subarray(4100, N), r.subarray(4100, N), p, st, aux);
      return { l, r, st, aux };
    };
    const js = run(runKernelJs);
    const nat = run(runKernel);
    const same = eqBits(js.l, nat.l) && eqBits(js.r, nat.r) && eqBits(js.st, nat.st) && (!js.aux || eqBits(js.aux, nat.aux!));
    let maxd = 0;
    for (let i = 0; i < N; i++) maxd = Math.max(maxd, Math.abs(js.l[i] - nat.l[i]), Math.abs(js.r[i] - nat.r[i]));
    log(same || (Platform.OS === 'android' && maxd < 1e-6), `${c.name}: natív = JS ${same ? '(bitre)' : '(a libm utolsó bitjén belül)'}`, `max eltérés ${maxd.toExponential(1)}`);
  }
}
