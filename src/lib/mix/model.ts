import type { FxAutomation } from '@/lib/audioDsp';
import type { AudioBus, AudioFx, AudioMaster, Keyframe, TrackType } from '@/types/project';

// 🎧 a keverő közös típusai és állandói

export const OFFLINE_SAMPLE_RATE = 44100;
/** kattogásmentes vágás: mikro-fade a klip szélén (a szerver `EDGE_FADE_SEC`-je; szerződés-teszt) */
export const EDGE_FADE_SEC = 0.01; // 44,1 és 48 kHz-en is egész mintaszám (441 / 480)
export const EDGE_EPS = 1e-4;

export interface DecodedSource {
  channels: Float32Array[];
  sampleRate: number;
  /**
   * 🎧 hosszú forrás szakaszosan (a `channels` ilyenkor üres): a `[from, to)` mintatartomány
   * csatornái (a forráson kívül csend), vagy null, ha a szükséges szakasz még nincs betöltve
   */
  segmented?: { read(from: number, to: number): Float32Array[] | null };
}

export interface OfflineMixClip {
  /** a sáv, amin a klip ül (a sávonkénti szintmérőhöz) */
  track: TrackType;
  uri: string;
  start: number;
  duration: number;
  trimIn: number;
  volume: number;
  volumeKf?: Keyframe[];
  fadeIn: number;
  fadeOut: number;
  pan: number;
  panKf?: Keyframe[];
  /** sáv- × master-erősítés */
  gain: number;
  /** a klip azonosítója (az effekt-állapot kulcsa a darabos keverésben) */
  id: string;
  /** a forrás teljes hossza (mp) — a hosszú forrás szakaszos olvasásához */
  sourceDuration?: number;
  /** 🎛️ a klip effektjei (a közös DSP: `audioDsp.ts`) */
  fx?: AudioFx;
  /** ⏩ forrás-mp / idővonal-mp (hangmagasság-tartással); 1 = nincs nyújtás */
  speed: number;
  /** ⏪ a forrás-ablak visszafelé szól (a videóklip `reversed`-je) */
  reversed: boolean;
  /** 🎚️ hangmagasság-eltolás félhangban (a hossz marad); 0 = nincs */
  pitch: number;
  /** 🗣️ V7.3: a hangmagasság-eltolás formáns-korrekcióval (a hangszín marad) */
  formant?: boolean;
  /** 📏 a normalizálás előmenetben mért erősítése (`withNormalizeGains`) */
  normGain?: number;
  /** 🏚️ visszhang-csökkentés (a lánc elején) */
  deReverb?: boolean;
  /** 🎛️ az effekt-automáció görbéi (a klip saját idejében) */
  fxKf?: FxAutomation;
  /** 🎚️ a sáv küldései: busz-azonosító → mérték 0–1 (a fader után) */
  sends?: Record<string, number>;
  /** 🔁 loop-klip: a forrás `trimIn`-től ennyi mp-es szakasza ismétlődik */
  loopLength?: number;
  /** 🔁 a hurok fázisa a klip elején (mp) */
  loopOffset?: number;
  /** 🦆 a halkítás szerepe: `key` = a beszéd (vezérel), `duck` = halkul alatta */
  role?: 'key' | 'duck';
}

export type OfflineUnsupported = 'effects' | 'voiceEnhance' | 'deReverb' | 'autoDuck' | 'master' | 'videoSpeed';

export interface OfflineMixPlan {
  duration: number;
  clips: OfflineMixClip[];
  unsupported: OfflineUnsupported[];
  /** 🦆 van duck-klip ÉS beszéd-kulcs (a szerver csak ekkor halkít) */
  ducking?: boolean;
  /** 🎛️ a projekt mastere (EQ, multiband, cél-LUFS, csúcsplafon) */
  master?: AudioMaster;
  /** 📏 a master mért erősítése a cél-LUFS-re (`measureMasterGain`); hiányzó = mérés folyik */
  masterGain?: number;
  /** 🎚️ effekt-buszok (a sávok küldéseiből, a master előtt) */
  buses?: AudioBus[];
  /** 🎚️ V9: sávonkénti sidechain-csoportok — a `target` sáv a `from` sáv eredeti jele alatt halkul */
  sidechains?: { target: string; from: string; ratio: number }[];
  /**
   * 🎚️ stem: csak ezek a sávok szólnak a kimenetre (és a buszokra); a többi sáv beszéde csak a
   * halkítás kulcsát adja — így a stem pontosan úgy halkul, mint a keverésben
   */
  solo?: string[];
}

/**
 * ⏩⏪ Egy nyújtandó/megfordítandó forrás-szakasz: a kliens a dekódolt forrásból kivágja a
 * `[from, from + sourceSec)` ablakot, megfordítja (`reversed`), majd hangmagasság-tartással
 * `duration` hosszúra nyújtja — a kész szakasz `key` néven 1×-es forrásként kerül a keverőbe.
 */
export interface StretchJob {
  key: string;
  uri: string;
  from: number;
  sourceSec: number;
  duration: number;
  speed: number;
  reversed: boolean;
  /** 🎚️ hangmagasság-eltolás félhangban (a hossz marad) */
  pitch: number;
  /** 🧹 spektrális zajszűrés a kész szakaszon (`denoise.ts`) */
  denoise: boolean;
  /** 🗣️ V7.3: formáns-korrekció a hangmagasság-eltolás után */
  formant?: boolean;
}
