import { create } from 'zustand';

import { makeId } from '@/lib/id';
import { ProgressTracker, type ProgressSnapshot, type ProgressUpdate } from '@/lib/progress';

/**
 * ⏳ Futó hosszú műveletek — EGY hely, amit a loader-felület olvas.
 *
 * Minden hosszú művelet (render, export, import, felirat, AI) itt jelenik meg,
 * így a felhasználó mindig látja: MI fut, HOL tart, MENNYI van hátra.
 * A `ProgressTracker` a store-on kívül él (nem szerializálható), a UI a
 * `snapshot`-ot kapja.
 */

export interface ProgressTask {
  id: string;
  /** a művelet neve — pl. „Export", „AI-felirat" */
  label: string;
  snapshot: ProgressSnapshot;
  /** megszakítás, ha a művelet támogatja */
  cancel?: () => void;
}

interface ProgressState {
  tasks: ProgressTask[];
  begin: (label: string, cancel?: () => void) => string;
  report: (id: string, update: ProgressUpdate) => void;
  end: (id: string) => void;
  /** az eltelt idő/ETA frissítése új jelentés nélkül is (a UI ütemezi) */
  tick: () => void;
}

const trackers = new Map<string, ProgressTracker>();

export const useProgressStore = create<ProgressState>((set, get) => ({
  tasks: [],

  begin: (label, cancel) => {
    const id = makeId('task');
    const tracker = new ProgressTracker();
    trackers.set(id, tracker);
    tracker.report({ phase: 'Indítás…' });
    set({
      tasks: [...get().tasks, { id, label, snapshot: tracker.snapshot(), cancel }],
    });
    return id;
  },

  report: (id, update) => {
    const tracker = trackers.get(id);
    if (!tracker) {
      return;
    }
    tracker.report(update);
    const snapshot = tracker.snapshot();
    set({
      tasks: get().tasks.map((t) => (t.id === id ? { ...t, snapshot } : t)),
    });
  },

  end: (id) => {
    trackers.delete(id);
    set({ tasks: get().tasks.filter((t) => t.id !== id) });
  },

  tick: () => {
    const tasks = get().tasks;
    if (tasks.length === 0) {
      return;
    }
    set({
      tasks: tasks.map((t) => {
        const tracker = trackers.get(t.id);
        return tracker ? { ...t, snapshot: tracker.snapshot() } : t;
      }),
    });
  },
}));

/**
 * Egy hosszú műveletet futtat regisztrált progresszel. A `fn` egy `report`
 * függvényt kap, amivel jelenti, hol tart:
 *
 *   await withProgress('Export', async (report) => {
 *     report({ phase: 'Feltöltés', ratio: 0.2 });
 *     …
 *   });
 *
 * A művelet a végén MINDIG kikerül a listából (hibánál is).
 */
export async function withProgress<T>(
  label: string,
  fn: (report: (update: ProgressUpdate) => void) => Promise<T>,
  cancel?: () => void
): Promise<T> {
  const store = useProgressStore.getState();
  const id = store.begin(label, cancel);
  try {
    return await fn((update) => useProgressStore.getState().report(id, update));
  } finally {
    useProgressStore.getState().end(id);
  }
}

/**
 * Mint a `withProgress`, de MEGSZAKÍTHATÓ: a kártyán megjelenik a ✕, és a
 * `fn` egy AbortSignalt is kap, amit továbbadhat a hosszú műveletnek.
 */
export async function withCancellableProgress<T>(
  label: string,
  fn: (
    report: (update: ProgressUpdate) => void,
    signal: AbortSignal
  ) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const store = useProgressStore.getState();
  const id = store.begin(label, () => controller.abort());
  try {
    return await fn(
      (update) => useProgressStore.getState().report(id, update),
      controller.signal
    );
  } finally {
    useProgressStore.getState().end(id);
  }
}
