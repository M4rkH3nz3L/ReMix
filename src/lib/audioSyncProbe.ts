/**
 * 🎚️ Fejlesztői mérőpont a többsávos szinkronhoz (PRO-AUDIO 17/5): a hang-lejátszók
 * elvárt és tényleges forrás-ideje lejátszás közben, és hogy a klip hány mp késéssel szólalt
 * meg. Csak bekapcsolva gyűjt (a dev-füstteszt kapcsolja), élesben nem fut. Pure.
 */
export interface SyncSample {
  clipId: string;
  /** elvárt − tényleges forrás-idő (mp); pozitív = a hang késik */
  drift: number;
  /** hány mp-e szól már a klip (a beállás utáni szakasz szűréséhez) */
  sinceStart: number;
}

const state = { enabled: false, samples: [] as SyncSample[], starts: new Map<string, number>(), seeks: 0 };

export function startSyncProbe(): void {
  state.enabled = true;
  state.samples = [];
  state.starts = new Map();
  state.seeks = 0;
}

export function stopSyncProbe(): { samples: SyncSample[]; starts: Map<string, number>; seeks: number } {
  state.enabled = false;
  return { samples: state.samples, starts: state.starts, seeks: state.seeks };
}

export function syncProbeOn(): boolean {
  return state.enabled;
}

export function probeDrift(clipId: string, expected: number, actual: number, sinceStart = 0): void {
  if (state.enabled) {
    state.samples.push({ clipId, drift: expected - actual, sinceStart });
  }
}

/** az első „szól” pillanat: a forrás ekkor ennyivel járt a várt mögött (mp) */
export function probeStart(clipId: string, lateBy: number): void {
  if (state.enabled && !state.starts.has(clipId)) {
    state.starts.set(clipId, lateBy);
  }
}

export function probeSeek(): void {
  if (state.enabled) {
    state.seeks += 1;
  }
}

/** összegzés klipenként: átlagos és legnagyobb abszolút eltérés (ms) */
export function summarizeDrift(samples: SyncSample[]): Map<string, { meanMs: number; maxMs: number; n: number }> {
  const out = new Map<string, { meanMs: number; maxMs: number; n: number }>();
  for (const s of samples) {
    const cur = out.get(s.clipId) ?? { meanMs: 0, maxMs: 0, n: 0 };
    const abs = Math.abs(s.drift) * 1000;
    cur.meanMs = (cur.meanMs * cur.n + abs) / (cur.n + 1);
    cur.maxMs = Math.max(cur.maxMs, abs);
    cur.n += 1;
    out.set(s.clipId, cur);
  }
  return out;
}
