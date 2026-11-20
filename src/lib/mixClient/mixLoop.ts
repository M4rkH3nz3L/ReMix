import type { FxState } from '@/lib/audioDsp';
import { mixRange, OFFLINE_SAMPLE_RATE, type OfflineMixPlan } from '@/lib/offlineMix';
import { readPowerState } from '@/lib/powerStateClient';
import { newThrottle, POWER_POLL_MS, restAfterSlice, summarizePower, type PowerSample, type PowerState, type PowerSummary } from '@/lib/thermalPolicy';
import { RenderCancelledError } from '@/lib/render';

import type { Prepared } from './prepare';

const CHUNK_SEC = 0.25;
/** egy szeletben legfeljebb ennyi munka, utána a felület jön (60 Hz-en egy képkocka ~16 ms) */
const FRAME_BUDGET_MS = 12;

/** 🌡️ S19: a legutóbbi keverések hő-/akkumulátor-naplója (a füstteszt és a diagnosztika olvassa) */
const recentPower: { durationMs: number; summary: PowerSummary; samples: PowerSample[] }[] = [];
export function recentExportPower(): readonly { durationMs: number; summary: PowerSummary; samples: PowerSample[] }[] {
  return recentPower;
}

/**
 * A keverés darabonként 0-tól `b`-ig; az `[a, b)` darabjai mennek az `onOut`-ba. A keverés mindig
 * 0-tól fut (az effektek, a halkítás és a master állapota így pontosan az, ami a teljes exportban).
 */
export async function mixLoop(
  prep: Prepared,
  plan: OfflineMixPlan,
  [a, b]: [number, number],
  onOut: (l: Float32Array, r: Float32Array) => void,
  onRatio: (r: number) => void,
  signal?: AbortSignal
): Promise<void> {
  // 🎛️ az effektek állapota szeletről szeletre megmarad (folytonos szűrés)
  const fxState = new Map<string, FxState>();
  // T2: időkeretes feldolgozás — negyed mp-es darabok, és ~12 ms munka után mindig visszaadjuk
  // a vezérlést (mérve: az 5 mp-es darabok 392 ms-ig fogták a felületet, látható akadás)
  const chunk = Math.round(CHUNK_SEC * OFFLINE_SAMPLE_RATE);
  // 🌡️ S19: a hőállapot ~2 mp-enként (háttérben) → súlyos hőnél pihenő, kritikusnál szünet
  const t0 = Date.now();
  const throttle = newThrottle();
  const samples: PowerSample[] = [];
  let power: PowerState | null = null;
  let polledAt = -Infinity;
  let polling = false;
  let restMs = 0;
  const poll = () => {
    if (polling || Date.now() - polledAt < POWER_POLL_MS) {
      return;
    }
    polling = true;
    polledAt = Date.now();
    void readPowerState().then((s) => {
      polling = false;
      if (s) {
        power = s;
        samples.push({ atMs: Date.now() - t0, ...s });
      }
    });
  };
  poll();
  let sliceStart = Date.now();
  for (let from = 0; from < b; from += chunk) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    const to = Math.min(b, from + chunk);
    if (prep.long.size > 0) {
      await prep.prepare(from, to);
    }
    const out: [Float32Array, Float32Array] = [new Float32Array(to - from), new Float32Array(to - from)];
    mixRange(plan, prep.sources, out, from, to, 1, fxState);
    if (to > a) {
      const skip = Math.max(0, a - from);
      onOut(skip > 0 ? out[0].subarray(skip) : out[0], skip > 0 ? out[1].subarray(skip) : out[1]);
    }
    const work = Date.now() - sliceStart;
    if (work >= FRAME_BUDGET_MS) {
      onRatio(to / b);
      poll();
      const rest = restAfterSlice(power, work, throttle);
      restMs += rest;
      await new Promise((resolve) => setTimeout(resolve, rest));
      sliceStart = Date.now();
    }
  }
  const durationMs = Date.now() - t0;
  if (b / OFFLINE_SAMPLE_RATE >= 60) {
    recentPower.push({ durationMs, summary: summarizePower(samples, restMs), samples });
    recentPower.splice(0, Math.max(0, recentPower.length - 4));
  }
}
