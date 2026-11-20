import { buildFxChain, NORMALIZE_LUFS, runChain, type FxState } from '@/lib/audioDsp';
import { integratedLoudness } from '@/lib/loudness';

import { type DecodedSource, OFFLINE_SAMPLE_RATE, type OfflineMixPlan } from './model';
import { mixRange } from './render';
import { sliceSource } from './sourcePrep';

/**
 * 📏 A normalizálás előmenete: a `normalize`-os klip ablakát a normalizálás ELŐTTI láncon
 * végigviszi, megméri az integrált hangosságát (BS.1770), és az erősítést a tervbe írja
 * (−16 LUFS-re). Az előnézet és az export is ezt futtatja (a `stretchJobs` után; a zajszűrés
 * addigra a szakaszon van).
 */
export function withNormalizeGains(
  plan: OfflineMixPlan,
  sources: Map<string, DecodedSource>,
  /** a mért erősítések klip-beállításonként (az előnézet A/B-váltása ne mérjen újra) */
  cache?: Map<string, number>
): OfflineMixPlan {
  const sr = OFFLINE_SAMPLE_RATE;
  const clips = plan.clips.map((c) => {
    if (!c.fx?.normalize) {
      return c;
    }
    const key = JSON.stringify([c.uri, c.trimIn, c.duration, c.fx, c.deReverb ?? false]);
    const known = cache?.get(key);
    if (known !== undefined) {
      return { ...c, normGain: known };
    }
    const src = sources.get(c.uri);
    if (!src || src.channels.length === 0) {
      return c;
    }
    const n = Math.round(c.duration * sr);
    const from = Math.round(c.trimIn * src.sampleRate);
    const [l, r] = sliceSource([src.channels[0], src.channels[1] ?? src.channels[0]], from, n, false);
    runChain(buildFxChain({ ...c.fx, normalize: false, limiter: false }, sr, 1, c.deReverb, c.fxKf), l, r, 0);
    const lufs = integratedLoudness(l, r, sr);
    const normGain = Number.isFinite(lufs) ? Math.pow(10, (NORMALIZE_LUFS - lufs) / 20) : 1;
    cache?.set(key, normGain);
    return { ...c, normGain };
  });
  return { ...plan, clips };
}

/**
 * 📏 A master hangosság-mérése (az első menet): a teljes keveréket a master EQ/multiband láncán
 * végigviszi, és a cél-LUFS-hez szükséges erősítést adja (a második menet ezzel szól — mint a
 * szerver kétmenetes `loudnorm`-ja lineáris módban). Kis darabokban, mindegyik után a felület jön.
 */
export async function measureMasterGain(
  plan: OfflineMixPlan,
  sources: Map<string, DecodedSource>,
  signal?: { aborted: boolean },
  /** 🎧 a hosszú (szakaszos) forrás betöltése a darab előtt */
  prepare?: (from: number, to: number) => Promise<void>
): Promise<number> {
  if (!plan.master) {
    return 1;
  }
  const sr = OFFLINE_SAMPLE_RATE;
  const n = Math.round(plan.duration * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const measuring: OfflineMixPlan = { ...plan, masterGain: undefined };
  const state = new Map<string, FxState>();
  // kis darabok, és MINDEN darab után a vezérlés visszaadása: az előnézet szeletei elsőbbséget
  // kapnak (mérve: 0,25 s-os darabokkal a háttér-mérés alatt az iPaden 5 szelet elkésett)
  const chunk = 4096;
  for (let a = 0; a < n; a += chunk) {
    if (signal?.aborted) {
      return Number.NaN;
    }
    const b = Math.min(n, a + chunk);
    await prepare?.(a, b);
    const part: [Float32Array, Float32Array] = [l.subarray(a, b), r.subarray(a, b)];
    mixRange(measuring, sources, part, a, b, 1, state);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const lufs = integratedLoudness(l, r, sr);
  return Number.isFinite(lufs) ? Math.pow(10, (plan.master.lufs - lufs) / 20) : 1;
}
