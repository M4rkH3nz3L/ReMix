import { sampleChannel } from '@/lib/keyframes';
import { buildFxChain, buildMasterChain, Ducker, FX_WARMUP, runChain, type FxState } from '@/lib/audioDsp';

import { fadeAt, panGains } from './gain';
import { type DecodedSource, OFFLINE_SAMPLE_RATE, type OfflineMixPlan } from './model';

// a hangerő-automáció ennyi mintánként lép, a klip elejétől — mint a szerver 64 mintás
// kereteiben (`asetnsamples`); a fade és az automatikus pan mintánként számolódik
const BLOCK = 64;

/**
 * A keverés a `[fromSample, toSample)` tartományra (darabokban hívható — a hosszú export
 * így nem fagyasztja a felületet). Kimenet: sztereó, `OFFLINE_SAMPLE_RATE`-en.
 */
export function mixRange(
  plan: OfflineMixPlan,
  sources: Map<string, DecodedSource>,
  out: [Float32Array, Float32Array],
  fromSample: number,
  toSample: number,
  monoGain = 1,
  fxState: Map<string, FxState> = new Map()
): void {
  const sr = OFFLINE_SAMPLE_RATE;
  // 🦆 halkításnál a duck-klipek külön sínre, a beszéd a kimenetre ÉS a kulcsra is szól
  const len = toSample - fromSample;
  const duckBus: [Float32Array, Float32Array] | null = plan.ducking ? [new Float32Array(len), new Float32Array(len)] : null;
  const keyBus: [Float32Array, Float32Array] | null = plan.ducking ? [new Float32Array(len), new Float32Array(len)] : null;
  // 🎚️ busz-pufferek (a küldések ide is szólnak)
  const busBufs = new Map<string, [Float32Array, Float32Array]>();
  for (const b of plan.buses ?? []) busBufs.set(b.id, [new Float32Array(len), new Float32Array(len)]);
  // 🎚️ V9: csoportonként a cél-sáv sínje és a forrás kulcsa (a forrás a kimenetre is szól, halkítás előtt)
  const scBus = new Map<string, [Float32Array, Float32Array]>();
  const scKeys = new Map<string, [Float32Array, Float32Array][]>();
  for (const sc of plan.sidechains ?? []) {
    const key: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
    scBus.set(sc.target, [new Float32Array(len), new Float32Array(len)]);
    scKeys.set(sc.from, [...(scKeys.get(sc.from) ?? []), key]);
    scKeys.set(`#${sc.target}`, [key]);
  }
  for (const clip of plan.clips) {
    const dst = scBus.get(clip.track) ?? (duckBus && clip.role === 'duck' ? duckBus : out);
    const sendTo = clip.sends ? Object.entries(clip.sends).map(([id, amt]) => [busBufs.get(id), amt] as const).filter(([b]) => b) : [];
    // a sidechain-csoport célsávja a régi halkításban nem vesz részt (a szerver tükre)
    const key = keyBus && clip.role === 'key' && !scBus.has(clip.track) ? keyBus : null;
    const keysSc = scKeys.get(clip.track) ?? [];
    const nScKeys = keysSc.length;
    const heard = !plan.solo || plan.solo.includes(clip.track);
    if (!heard && !key && nScKeys === 0) {
      continue;
    }
    const src = sources.get(clip.uri);
    if (!src || (src.channels.length === 0 && !src.segmented)) {
      continue;
    }
    const clipFrom = Math.round(clip.start * sr);
    const clipTo = clipFrom + Math.round(clip.duration * sr);
    const a = Math.max(fromSample, clipFrom);
    const b = Math.min(toSample, clipTo);
    const srcOffset = Math.round(clip.trimIn * src.sampleRate) - clipFrom;
    // 🔁 loop-klip: a klipen belüli minta a hurok hosszával körbejár (a forrás `trimIn`-től)
    const loopN = clip.loopLength && clip.loopLength > 0 ? Math.max(1, Math.round(clip.loopLength * src.sampleRate)) : 0;
    const trimN = Math.round(clip.trimIn * src.sampleRate);
    const phaseN = loopN ? Math.round((clip.loopOffset ?? 0) * src.sampleRate) - clipFrom : 0;
    const srcIndex = (i: number) => (loopN ? trimN + ((((i + phaseN) % loopN) + loopN) % loopN) : i + srcOffset);
    // 🎧 hosszú (szakaszos) forrásnál csak a most kellő ablak: a mintaindex az ablakon belül
    let left = src.channels[0];
    let right = src.channels[1] ?? src.channels[0];
    let base = 0;
    if (src.segmented) {
      if (b <= a) {
        continue;
      }
      const w0 = clip.fx ? Math.max(clipFrom, a - FX_WARMUP) : a;
      const win = src.segmented.read(w0 + srcOffset, b + srcOffset);
      if (!win) {
        continue; // a szakasz még töltődik: ebben a szeletben néma (a motor előre tölt)
      }
      left = win[0];
      right = win[1] ?? win[0];
      base = w0 + srcOffset;
    }
    const mono = src.segmented ? right === left : src.channels.length === 1;
    const staticPan = !clip.panKf || clip.panKf.length === 0 ? panGains(clip.pan) : null;
    const hasFade = clip.fadeIn > 0 || clip.fadeOut > 0;
    // 🎛️ effektek (a szerver sorrendjében: a pan és a hangerő ELŐTT): a forrás-szakasz előbb a
    // láncon megy át. Az állapot szeletről szeletre megmarad; ugrás után a lánc a megelőző
    // hanggal bejáratódik (különben az ugrás pontján kattanna).
    let fxL: Float32Array | null = null;
    let fxR: Float32Array | null = null;
    if (clip.fx && b > a) {
      const read = (from: number, to: number): [Float32Array, Float32Array] => {
        const l = new Float32Array(to - from);
        const r = new Float32Array(to - from);
        const offR = srcOffset - base;
        if (loopN === 0) {
          // folytonos forrás: egy blokkmásolás (natív memcpy) — a tartományon kívüli rész nulla marad
          const s0 = Math.max(from + offR, 0);
          const s1 = Math.min(to + offR, left.length);
          if (s1 > s0) {
            l.set(left.subarray(s0, s1), s0 - offR - from);
            r.set(right.subarray(s0, s1), s0 - offR - from);
          }
          return [l, r];
        }
        for (let i = from; i < to; i++) {
          const s = srcIndex(i) - base;
          if (s >= 0 && s < left.length) {
            l[i - from] = left[s];
            r[i - from] = right[s];
          }
        }
        return [l, r];
      };
      const key = `${clip.id}|${JSON.stringify(clip.fx)}|${clip.normGain ?? 1}|${clip.deReverb ? 'dr' : ''}|${clip.fxKf ? JSON.stringify(clip.fxKf) : ''}`;
      let st = fxState.get(key);
      if (!st || st.next !== a) {
        st = { chain: buildFxChain(clip.fx, sr, clip.normGain, clip.deReverb, clip.fxKf), next: a };
        const w0 = Math.max(clipFrom, a - FX_WARMUP);
        if (w0 < a) {
          const [wl, wr] = read(w0, a);
          runChain(st.chain, wl, wr, w0 - clipFrom);
        }
      }
      [fxL, fxR] = read(a, b);
      runChain(st.chain, fxL, fxR, a - clipFrom);
      st.next = b;
      fxState.set(key, st);
    }
    // a blokk-rács a klip elejéhez igazodik (a darabos hívás se tolja el)
    // ⚡ a mintánkénti ciklus a JIT nélküli Hermesben is gyors legyen: a mintán belül nincs allokáció
    // (pásztázás-tömb, iterátor), closure-hívás csak hurok-klipnél — az aritmetika és a sorrend változatlan
    const firstBlock = clipFrom + Math.floor((a - clipFrom) / BLOCK) * BLOCK;
    const loopIdx = loopN > 0;
    const off = srcOffset - base;
    const sLg = staticPan ? staticPan[0] : 0;
    const sRg = staticPan ? staticPan[1] : 0;
    const nSend = sendTo.length;
    const dstL = dst[0];
    const dstR = dst[1];
    const keyL = key ? key[0] : null;
    const keyR = key ? key[1] : null;
    const leftLen = left.length;
    for (let blockStart = firstBlock; blockStart < b; blockStart += BLOCK) {
      const blockEnd = Math.min(b, blockStart + BLOCK);
      const level = sampleChannel(clip.volumeKf, (blockStart - clipFrom) / sr, clip.volume) * clip.gain * (mono ? monoGain : 1);
      for (let i = Math.max(a, blockStart); i < blockEnd; i++) {
        const s = loopIdx ? srcIndex(i) - base : i + off;
        if (!fxL && (s < 0 || s >= leftLen)) {
          continue;
        }
        const t = (i - clipFrom) / sr;
        const g = hasFade ? level * fadeAt(clip, t) : level;
        let lg = sLg;
        let rg = sRg;
        if (!staticPan) {
          const pg = panGains(sampleChannel(clip.panKf, t, clip.pan));
          lg = pg[0];
          rg = pg[1];
        }
        const xl = fxL ? fxL[i - a] : left[s];
        const xr = fxR ? fxR![i - a] : right[s];
        const vl = xl * g * lg;
        const vr = xr * g * rg;
        const o = i - fromSample;
        if (keyL) {
          keyL[o] += vl;
          keyR![o] += vr;
        }
        for (let k = 0; k < nScKeys; k++) {
          keysSc[k][0][o] += vl;
          keysSc[k][1][o] += vr;
        }
        if (!heard) {
          continue;
        }
        dstL[o] += vl;
        dstR[o] += vr;
        for (let k = 0; k < nSend; k++) {
          const send = sendTo[k];
          send[0]![0][o] += vl * send[1];
          send[0]![1][o] += vr * send[1];
        }
      }
    }
  }
  // 🎚️ a buszok: a saját effekt-láncukon át (folytonos állapottal), a visszatérő szinttel a kimenetre
  for (const b of plan.buses ?? []) {
    const buf = busBufs.get(b.id)!;
    const id = `__bus:${b.id}|${JSON.stringify(b.fx)}`;
    let st = fxState.get(id);
    if (!st || st.next !== fromSample) {
      st = { chain: buildFxChain(b.fx, sr), next: fromSample };
    }
    runChain(st.chain, buf[0], buf[1], fromSample);
    st.next = toSample;
    fxState.set(id, st);
    const g = Math.max(0, Math.min(1, b.gain));
    for (let i = 0; i < len; i++) {
      out[0][i] += buf[0][i] * g;
      out[1][i] += buf[1][i] * g;
    }
  }
  // 🎚️ V9: a sidechain-csoportok (a halkító állapota csoportonként, szeletről szeletre megmarad)
  for (const sc of plan.sidechains ?? []) {
    const bus = scBus.get(sc.target)!;
    const key = scKeys.get(`#${sc.target}`)![0];
    const id = `__sc:${sc.target}<${sc.from}|${sc.ratio}`;
    const st = fxState.get(id);
    let ducker = st?.ducker;
    if (!ducker || st?.next !== fromSample) ducker = new Ducker(sr, 0.02, sc.ratio);
    ducker.process(bus[0], bus[1], key[0], key[1]);
    fxState.set(id, { chain: [], next: toSample, ducker });
    for (let i = 0; i < len; i++) {
      out[0][i] += bus[0][i];
      out[1][i] += bus[1][i];
    }
  }
  if (duckBus && keyBus) {
    // a halkító állapota szeletről szeletre megmarad (a sín kulcsa a mintapozíció)
    const st = fxState.get('__duck');
    let ducker = st?.ducker;
    if (!ducker || st?.next !== fromSample) {
      ducker = new Ducker(sr);
    }
    ducker.process(duckBus[0], duckBus[1], keyBus[0], keyBus[1]);
    fxState.set('__duck', { chain: [], next: toSample, ducker });
    for (let i = 0; i < len; i++) {
      out[0][i] += duckBus[0][i];
      out[1][i] += duckBus[1][i];
    }
  }
  if (plan.master) {
    // 🎛️ a master a kész keveréken; az állapota szeletről szeletre megmarad (ugrásnál újraindul —
    // az EQ azonnal, a kompresszorok ~250 ms alatt állnak be). Erősítés nélkül = a mérő menet.
    const id = `__master|${JSON.stringify(plan.master)}|${plan.masterGain ?? 'mérés'}`;
    let st = fxState.get(id);
    if (!st || st.next !== fromSample) {
      st = { chain: buildMasterChain(plan.master, sr, plan.masterGain), next: fromSample };
    }
    runChain(st.chain, out[0], out[1], fromSample);
    st.next = toSample;
    fxState.set(id, st);
  }
}
