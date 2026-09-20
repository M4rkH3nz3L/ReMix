/**
 * 🎓 Interaktív tutorial MAGja (expo-mentes → tesztelhető).
 *
 * A STUDIO.md „Interaktív tutorial — leckék" specjét futtatja: minden LECKE
 * lépések sora, minden LÉPÉS három szöveggel — **Művelet** (mit tegyél) · **Hol**
 * (melyik UI-elem) · **Eredmény** (mit látsz) — és opcionálisan egy `target`-tel,
 * amit a felület-vezető (TutorialOverlay) kiemel (spotlight).
 *
 * A szövegek i18n-kulcsok (`tutorial.lessons.<lessonId>.<stepKey>_action|_where|_result`),
 * hogy hu/en/de-n is menjen. Ez a modul csak az ADAT + a navigáció logikája —
 * nincs benne React/mérés.
 */

/** A kiemelhető UI-elemek stabil azonosítói (a `TutorialTarget id`-je). */
export type TutorialTargetId =
  | 'toolbar.addVideo'
  | 'toolbar.ai'
  | 'transport.playPause'
  | 'timeline';

export interface TutorialStep {
  /** i18n al-kulcs: `tutorial.lessons.<lessonId>.<key>_action|_where|_result` */
  key: string;
  /** melyik UI-elemet emelje ki (ha nincs, középre igazított kártya) */
  target?: TutorialTargetId;
}

export interface TutorialLesson {
  id: string;
  level: 'beginner' | 'advanced' | 'pro';
  /** Pro-lecke (a fejlécben jelezhető) */
  pro?: boolean;
  steps: TutorialStep[];
}

/** Mért képernyő-téglalap (a spotlighthoz), a `measureInWindow` kimenete. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A beépített leckék. Bővíthető a STUDIO.md teljes készletével — most a
 * végponttól-végpontig működő KEZDŐ tour + az AI-előnézet lecke van élesítve,
 * valós `target`-ekkel. A többi lecke ugyanígy adható hozzá (adat + i18n).
 */
export const TUTORIAL_LESSONS: TutorialLesson[] = [
  {
    id: 'basics',
    level: 'beginner',
    steps: [
      { key: 's1', target: 'toolbar.addVideo' },
      { key: 's2', target: 'transport.playPause' },
      { key: 's3', target: 'timeline' },
      { key: 's4', target: 'timeline' },
    ],
  },
  {
    id: 'aiPreview',
    level: 'pro',
    pro: true,
    steps: [
      { key: 's1', target: 'toolbar.ai' },
      { key: 's2' },
      { key: 's3' },
    ],
  },
];

export function getLesson(id: string): TutorialLesson | undefined {
  return TUTORIAL_LESSONS.find((l) => l.id === id);
}

/**
 * A következő lépés indexe; ha túlfut, `-1` = a lecke KÉSZ. Tiszta függvény,
 * hogy a léptetés-logika a store/overlay nélkül is tesztelhető legyen.
 */
export function nextStepIndex(current: number, total: number): number {
  return current + 1 >= total ? -1 : current + 1;
}

/** Az előző lépés indexe (0 alá nem megy). */
export function prevStepIndex(current: number): number {
  return current > 0 ? current - 1 : 0;
}

/** i18n al-kulcsokat épít egy léptehez (`_action` / `_where` / `_result`). */
export function stepI18nKeys(lessonId: string, step: TutorialStep): {
  action: string;
  where: string;
  result: string;
} {
  const base = `tutorial.lessons.${lessonId}.${step.key}`;
  return { action: `${base}_action`, where: `${base}_where`, result: `${base}_result` };
}
