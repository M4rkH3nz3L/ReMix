/**
 * 🌡️ S19: a hosszú telefonos export hő-alkalmazkodása (expo-mentes, tiszta mag).
 *
 * A natív `powerState` 0–3 hőszintjére: névleges/emelkedett → teljes tempó; súlyos → minden
 * munkaszelet után ugyanannyi pihenő (50% kitöltés, a gép hűlhet, a felület is lélegzik);
 * kritikus → szünet, amíg le nem hűl — de exportonként legfeljebb `MAX_CRITICAL_PAUSE_MS`, utána
 * a súlyos tempóval megy tovább (az export SOSEM áll meg végleg).
 */

export type PowerState = {
  /** 0 névleges · 1 emelkedett · 2 súlyos · 3 kritikus */
  thermal: number;
  /** 0–1, −1 = ismeretlen */
  battery: number;
  charging: boolean;
  lowPower: boolean;
};

/** ilyen sűrűn kérdezzük a natív állapotot (olcsó, de nem minden szeletben) */
export const POWER_POLL_MS = 2000;
/** kritikus hőnél egy várakozási lépés */
export const CRITICAL_STEP_MS = 2000;
/** kritikus hőnél exportonként összesen legfeljebb ennyi szünet */
export const MAX_CRITICAL_PAUSE_MS = 120_000;

export type ThrottleState = { criticalPausedMs: number };

export function newThrottle(): ThrottleState {
  return { criticalPausedMs: 0 };
}

/**
 * Egy `workMs` hosszú munkaszelet után ennyi ms pihenő jár (0 = csak a szokásos átadás).
 * A kritikus szünetet a hívó lépésenként (`CRITICAL_STEP_MS`) kéri újra, friss állapottal.
 */
export function restAfterSlice(power: PowerState | null, workMs: number, st: ThrottleState): number {
  if (!power || power.thermal <= 1) {
    return 0;
  }
  if (power.thermal >= 3 && st.criticalPausedMs < MAX_CRITICAL_PAUSE_MS) {
    const step = Math.min(CRITICAL_STEP_MS, MAX_CRITICAL_PAUSE_MS - st.criticalPausedMs);
    st.criticalPausedMs += step;
    return step;
  }
  return Math.max(0, Math.round(workMs));
}

/** egy export hő- és akkumulátor-naplója (a füstteszt és a hibajelentés olvassa) */
export type PowerSample = { atMs: number; thermal: number; battery: number; charging: boolean; lowPower: boolean };

export type PowerSummary = {
  samples: number;
  maxThermal: number;
  /** ennyi ideig volt súlyos (≥2) a hő a mintavételek szerint */
  hotMs: number;
  /** akkumulátor-esés százalékpontban (töltés közben / ismeretlen esetén null) */
  batteryDropPct: number | null;
  restMs: number;
};

export function summarizePower(samples: PowerSample[], restMs: number): PowerSummary {
  let maxThermal = 0;
  let hotMs = 0;
  for (let i = 0; i < samples.length; i++) {
    maxThermal = Math.max(maxThermal, samples[i].thermal);
    if (samples[i].thermal >= 2 && i + 1 < samples.length) {
      hotMs += samples[i + 1].atMs - samples[i].atMs;
    }
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const known = first && last && first.battery >= 0 && last.battery >= 0 && !samples.some((s) => s.charging);
  return {
    samples: samples.length,
    maxThermal,
    hotMs,
    batteryDropPct: known ? Math.round((first.battery - last.battery) * 1000) / 10 : null,
    restMs,
  };
}
