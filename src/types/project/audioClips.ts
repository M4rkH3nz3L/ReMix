import type { DrumPattern, DrumVelocity } from '@/lib/drums';
import type { SynthNote, SynthWave } from '@/lib/synth';
import type { ClipBase } from './clipBase';
import type { ClipKeyframes } from './mediaClips';

/**
 * 🎛️ Per-klip audio-effekt lánc (Pro audio) — a RENDERBEN alkalmazódik (FFmpeg),
 * a `voiceEnhance`/`deReverb` egygombos csomag MELLETT, granuláris vezérléssel.
 * Az előnézet ezt (a szűrőkhöz hasonlóan) nem játssza pontosan — a render a
 * mérvadó (lásd README). Minden mező hiánya = kikapcsolt (semleges).
 */
export interface AudioFx {
  /** aluláteresztő: e Hz alatti dörej vágása (pl. 80); 0/hiányzó = ki */
  highpass?: number;
  /** felüláteresztő: e Hz fölötti sziszegés vágása (pl. 12000); 0/hiányzó = ki */
  lowpass?: number;
  /** 3-sávos EQ erősítés dB-ben (-12…12); mind 0 = ki. 🎛️ V7: sávonként állítható frekvencia és Q
   *  (hiányzó = 100 Hz / 1 kHz / 8 kHz, Q 1 — `fxParams.ts`, a szerver tükre) */
  eq?: { low: number; mid: number; high: number; lowFreq?: number; midFreq?: number; highFreq?: number; lowQ?: number; midQ?: number; highQ?: number };
  /** zajszűrés (afftdn) */
  denoise?: boolean;
  /** sziszegés-csökkentés (deesser) */
  deEsser?: boolean;
  /** kompresszor (dinamika-szűkítés) */
  compressor?: boolean;
  /** limiter (kemény plafon a csúcsokra) */
  limiter?: boolean;
  /** loudness-normalizálás −16 LUFS-re (loudnorm) */
  normalize?: boolean;
  /** 🚪 zajkapu (agate): a küszöb alatti halk részeket (háttérzaj/szünetek) lehalkítja */
  gate?: boolean;
  /** 🎧 sztereó-szélesítés (haas): a mono/szűk jelből szélesebb sztereó-kép (zenéhez) */
  stereoWide?: boolean;
  /** visszhang-tér mértéke 0–1 (aecho) */
  reverb?: number;
  /** echo/delay mértéke 0–1 (aecho) */
  delay?: number;
  /** 🥁 V7: tempóhoz kötött delay — ütemrész negyedhangban (0,25 = 1/16 … 1 = 1/4); hiányzó = mérték-alapú idő */
  delayBeats?: number;
  /** a `delayBeats` a projekt tempójából ms-ben (a reducer számolja — `retimeTempoDelays`; a szerver ezt olvassa) */
  delayMs?: number;
  /** 🎚️ hangmagasság-eltolás félhangban (−12…+12; 0/hiányzó = nincs). A renderben
   *  asetrate+atempo-val, a HOSSZ változatlan (nem chipmunk-effekt). */
  pitchSemitones?: number;
  /** 🎵 harmónia-hang: a klip MELLÉ kevert, e félhanggal eltolt halkabb másodhang
   *  (−12…+12; 0/hiányzó = nincs). Pl. +7 = kvint, +4 = nagy terc. A renderben. */
  harmony?: number;
  /** 🗣️ V7.3: a hangmagasság-eltolás megtartja a hangszínt (formáns-korrekció — `formant.ts`, a szerver tükre);
   *  a harmónia-hangra is vonatkozik; hiányzó = ki (a „mókus/óriás" hatás szándékos is lehet) */
  formant?: boolean;
  /** 🔀 a mozgatható fokozatok sorrendje (`fxOrder.ts`); hiányzó = az alap sorrend */
  order?: string[];
}

/** 🎙️ egy felvett take (lásd `AudioClip.takes`) */
export interface AudioTake {
  id: string;
  uri: string;
  label: string;
  start: number;
  duration: number;
  trimIn: number;
  sourceDuration: number;
  /** a felvétel ideje (ISO) */
  at?: string;
}

/** 🎼 egy tempóváltás: ettől a beat-pozíciótól ez a BPM (a `musicTime` TempoSegment-je a projektben) */
export interface TempoChange {
  atBeat: number;
  bpm: number;
}

/** 🎹🥁🎛️ egy hangszer-minta (a sütött klip szerkeszthető forrása) */
export interface InstrumentDoc {
  id: string;
  kind: 'synth' | 'drums' | 'sampler';
  /** a sütéskori tempó (a rács ehhez tartozik) */
  bpm: number;
  bars: number;
  synth?: { wave: SynthWave; notes: SynthNote[] };
  drums?: { pattern: DrumPattern; velocity?: DrumVelocity; swing?: number };
  /**
   * 🎛️ sampler (S1): a felhasználó saját one-shot mintája a step-rácson. A `sampleUri` a projekt
   * mappájában élő hangfájl (a mentés a mappába veszi, a média-GC és az `.rp` a projekt-JSON
   * szövegéből látja, mint minden más uri-t); a `pattern` lépésenként igaz/hamis.
   */
  sampler?: {
    sampleUri: string;
    sampleName?: string;
    pattern: boolean[];
    /** 🎛️ V2.3 Dallam mód: a minta alaphangja és a hangjegyek (kromatikus játék — `samplerPlus.ts`) */
    rootMidi?: number;
    notes?: SynthNote[];
    /** 🎛️ V2.3 Pad mód: a szelet-kezdetek (minta, 44,1 kHz) és a 4 pad lépés-sora */
    slices?: number[];
    pads?: boolean[][];
  };
}

export interface AudioClip extends ClipBase {
  kind: 'audio';
  /** a hivatkozott asset; az uri denormalizált gyorsítás */
  assetId?: string;
  uri: string;
  label: string;
  /** 🎚️ forráson belüli kezdet (mp) — mint a VideoClip.trimIn; hiányzó = 0 */
  trimIn?: number;
  /** a forrás teljes hossza (mp) — a trim ENNYIN belül mozoghat; hiányzó = duration */
  sourceDuration?: number;
  /**
   * ⏩ lejátszási sebesség, hangmagasság-tartással (a gyorsított videóklip leválasztott hangja);
   * hiányzó = 1. A forrás-idő: `trimIn + (t − start) · speed`.
   */
  speed?: number;
  /** ⏪ visszafelé szól (a visszafelé játszott videóklip leválasztott hangja); a forrás-ablak
   * ugyanaz (`trimIn` … `trimIn + duration·speed`), csak a végéről indul */
  reversed?: boolean;
  /**
   * 🔁 loop-klip: a forrás `trimIn`-től kezdődő, ennyi mp-es szakasza ismétlődik, amíg a klip tart
   * (a jobb él a forrás végén túl is húzható). Hiányzó = nincs ismétlés.
   */
  loopLength?: number;
  /**
   * 🔁 a hurok fázisa a klip elején (mp, 0 ≤ … < `loopLength`): a vágott/balról húzott loop-klip
   * a minta közepéről folytatódik, a hurok-ablak (`trimIn` … `trimIn + loopLength`) marad. Hiányzó = 0.
   */
  loopOffset?: number;
  /** 🥁 a forrás tempója (BPM) — az „Illeszd a projekt tempójához” ebből számolja a `speed`-et */
  sourceBpm?: number;
  /**
   * 🎙️🔁 take-ek: ugyanarra a helyre ismételt felvételek (punch-in). Az aktív take adatai a klip saját
   * mezői (`uri`, `trimIn`, `sourceDuration`, `start`, `duration`) — az export és a lejátszás így
   * változatlan; a lista mindet tartalmazza (az aktívat is). Hiányzó = egyetlen felvétel.
   */
  takes?: AudioTake[];
  /** az aktív take azonosítója (a `takes`-ből) */
  activeTake?: string;
  /**
   * 🎤 V3.2 ének-hangolás: a klip a telefonon hangolt fájlra mutat; itt az eredeti forrás és a beállítások
   * (újraszerkesztés az eredetiből, „Eredeti visszaállítása”). Hiányzó = nincs hangolva.
   */
  tune?: { sourceUri: string; sourceAssetId?: string; root: number; minor: boolean; strength: number; harmonySteps?: number };
  /**
   * 🔇 V8: AI-zajszűrés (RNNoise a telefonon) — a klip a tisztított fájlra mutat, az eredeti itt marad
   * (újra-alkalmazás az eredetiből, visszaállítás). Hiányzó = nincs AI-zajszűrve.
   */
  aiDenoise?: { sourceUri: string; sourceAssetId?: string; strength: number };
  /**
   * 🎹🥁 a hangszer-minta (`project.instrumentDocs`), amiből a klip hangja sütve lett — a minta
   * újraszerkeszthető, az újrasütés minden rá hivatkozó klipet frissít. Hiányzó = sima hangfájl.
   */
  instrumentDocId?: string;
  /** 0–1 */
  volume: number;
  /** sztereó pásztázás −1 (bal) … 0 (közép) … 1 (jobb); hiányzó = közép. A renderben */
  pan?: number;
  /** 🎛️ per-klip audio-effekt lánc (Pro audio) — a renderben */
  audioFx?: AudioFx;
  /** fade hossz mp-ben */
  fadeIn: number;
  fadeOut: number;
  source: 'imported' | 'voiceover';
  /** Voice Studio: zajszűrés + kompresszor + loudness a renderben (hiányzó = ki) */
  voiceEnhance?: boolean;
  /** Voice Studio: visszhang-csökkentés (szobahang) — a renderben */
  deReverb?: boolean;
  /** auto-ducking: a klip halkul, amíg beszéd szól (zenéhez; hiányzó = ki) */
  autoDuck?: boolean;
  /** hangerő-automáció (volume csatorna) — P0‑5 bővítés */
  keyframes?: ClipKeyframes;
}
