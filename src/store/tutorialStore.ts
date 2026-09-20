import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { getLesson, nextStepIndex, prevStepIndex, type Rect } from '@/lib/tutorial';

/**
 * 🎓 Tutorial-store — a felület-vezető állapota + a kiemelhető UI-elemek
 * regisztere.
 *
 * - `activeLessonId`/`stepIndex`: hol tart a felhasználó a leckében.
 * - `completed`: a befejezett leckék (AsyncStorage-ban marad, eszköz-szinten —
 *   nem érzékeny adat).
 * - `targets`: a `TutorialTarget id` → „mérd meg magad" függvény. Az overlay a
 *   lépés `target`-jét ezen keresztül méri le (`measureInWindow`), így a
 *   spotlight a VALÓS elemre ül. A regiszter azért él a store-ban, mert a
 *   target-komponens és az overlay külön fán vannak.
 */

const STORAGE_KEY = 'remix.tutorial.v1';

interface TutorialState {
  activeLessonId: string | null;
  stepIndex: number;
  completed: string[];
  hydrated: boolean;
  targets: Record<string, () => Promise<Rect | null>>;
  start: (lessonId: string) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
  registerTarget: (id: string, measure: () => Promise<Rect | null>) => void;
  unregisterTarget: (id: string) => void;
  hydrate: () => Promise<void>;
}

function persistCompleted(completed: string[]): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(completed)).catch(() => {
    // best-effort: a tutorial-állapot elvesztése nem kritikus
  });
}

export const useTutorial = create<TutorialState>((set, get) => ({
  activeLessonId: null,
  stepIndex: 0,
  completed: [],
  hydrated: false,
  targets: {},

  start: (lessonId) => {
    if (!getLesson(lessonId)) {
      return;
    }
    set({ activeLessonId: lessonId, stepIndex: 0 });
  },

  next: () => {
    const { activeLessonId, stepIndex, completed } = get();
    if (!activeLessonId) {
      return;
    }
    const lesson = getLesson(activeLessonId);
    if (!lesson) {
      set({ activeLessonId: null, stepIndex: 0 });
      return;
    }
    const nextIdx = nextStepIndex(stepIndex, lesson.steps.length);
    if (nextIdx < 0) {
      // a lecke kész → jelöljük befejezettnek és zárjuk
      const done = completed.includes(activeLessonId) ? completed : [...completed, activeLessonId];
      set({ activeLessonId: null, stepIndex: 0, completed: done });
      persistCompleted(done);
      return;
    }
    set({ stepIndex: nextIdx });
  },

  prev: () => {
    const { activeLessonId, stepIndex } = get();
    if (!activeLessonId) {
      return;
    }
    set({ stepIndex: prevStepIndex(stepIndex) });
  },

  stop: () => set({ activeLessonId: null, stepIndex: 0 }),

  registerTarget: (id, measure) =>
    set((s) => ({ targets: { ...s.targets, [id]: measure } })),

  unregisterTarget: (id) =>
    set((s) => {
      if (!(id in s.targets)) {
        return s;
      }
      const next = { ...s.targets };
      delete next[id];
      return { targets: next };
    }),

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const completed = raw ? (JSON.parse(raw) as string[]) : [];
      set({ completed: Array.isArray(completed) ? completed : [], hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));
