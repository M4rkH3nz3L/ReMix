import type { EditorCommand } from '@/lib/commands';
import type { Project, TrackType } from '@/types/project';

/** 🎙️🤖 A hang-asszisztens szerződése: a lépések, a parancs-buszon kívüli műveletek, az eredmény és a kontextus. */

export interface AudioStep {
  /** a lépés leírásának i18n-kulcsa (`studio.audio.assistant.step.*`) és paraméterei */
  key: string;
  params?: Record<string, string | number>;
  commands: EditorCommand[];
}

/** a parancs-buszon kívüli műveletek (munkamenet-állapot vagy meglévő folyamat) */
export type AudioAction =
  | { kind: 'mute' | 'unmute' | 'solo'; track: TrackType }
  | { kind: 'silence' | 'beatSplitBars' | 'beatSplitBeats' | 'check' | 'sync' | 'transcript' | 'mixSuggest' | 'masterAssist' }
  /** 🔗 C7: a hang-projekt mixdownja HIVATKOZÁSKÉNT a videóba (C2): új videó, a legutóbbi videó, vagy választás */
  | { kind: 'toVideo'; target: 'new' | 'latest' | 'pick' }
  /** 🥁 V8: AI-dob (Magenta, a telefonon) — új groove a lejátszófejnél, szerkeszthető dob-mintaként */
  | { kind: 'aiDrums'; bars: number }
  /** 🔇 V8: AI-zajszűrés (RNNoise, a telefonon) a megnevezett sávok klipjein (alap: a beszéd / a kijelölt) */
  | { kind: 'aiDenoise'; tracks: TrackType[] };

export interface AudioIntentResult {
  steps: AudioStep[];
  actions: AudioAction[];
  /** a nem értett mondatrészek (az eredeti alakjukban) */
  unknown: string[];
}

export interface AudioIntentContext {
  project: Project;
  playhead: number;
  selectedClipId: string | null;
  /** a sávok megjelenített neve (az átnevezett sávokra is lehet hivatkozni) */
  trackNames: Partial<Record<TrackType, string>>;
  makeId: (prefix: string) => string;
  /** belső: a szomszéd tagmondat sávjai, ha ebben nincs megnevezve („kompresszort és zengést a beszédre”) */
  inherited?: TrackType[];
}
