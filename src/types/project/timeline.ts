import type { Asset } from './assets';
import type { AudioClip } from './audioClips';
import type { ClipAdjust, ClipBase } from './clipBase';
import type { AspectRatio, TrackType } from './common';
import type { ShapeClip, TextClip } from './graphicClips';
import type { ImageClip, VideoClip } from './mediaClips';

/** Interaktív művelet — a lejátszó értelmezi, a videóba nem "sül bele". */
export type HotspotAction =
  | { type: 'url'; url: string }
  | { type: 'seek'; toTime: number }
  | { type: 'quiz'; question: string; answers: string[]; correctIndex: number };

export interface InteractiveClip extends ClipBase {
  kind: 'interactive';
  label: string;
  /** bal-felső sarok + méret, 0–1 normalizálva */
  rect: { x: number; y: number; w: number; h: number };
  action: HotspotAction;
}

/**
 * Filmes grade-presetek (LUT-szerű „look"-ok): egy koppintásra kész színvilág a
 * grade-rétegen. A render split-tone color-grade láncot (eq + colorbalance
 * s/m/h + vignette) alkalmaz, a `constants/grades.ts` és a `server/render.js`
 * GRADES-térképe a közös forrás. A `none` = nincs preset (csak a kézi `adjust`).
 */
export type GradeId =
  | 'none'
  | 'teal-orange'
  | 'moody'
  | 'vintage'
  | 'noir'
  | 'warm-film'
  | 'cold'
  | 'vibrant'
  | 'dreamy';

/**
 * Adjustment-réteg (grade-réteg): egy idővonal-szakaszra színkorrekciót ad az
 * ALATTA lévő teljes kompozitra (nem-destruktív, CapCut-minta). A render előbb a
 * `grade` presetet (ha van), majd a kézi `adjust` láncot (eq/colorbalance/
 * vignette) alkalmazza `enable`-ablakkal; saját forrása nincs (hatás-réteg).
 */
export interface AdjustClip extends ClipBase {
  kind: 'adjust';
  adjust: ClipAdjust;
  /** filmes look-preset (a kézi adjust ERRE rétegződik finomhangolásként) */
  grade?: GradeId;
  /** a teljes grade-hatás erőssége 0–1 (hiányzó = 1 = teljes) */
  strength?: number;
  /** a grade fokozatos ERŐSÖDÉSE a klip elején (mp) — idő szerinti look-építés */
  fadeInSec?: number;
  /** a grade fokozatos HALVÁNYULÁSA a klip végén (mp) */
  fadeOutSec?: number;
}

export type Clip =
  | VideoClip
  | ImageClip
  | TextClip
  | AudioClip
  | InteractiveClip
  | ShapeClip
  | AdjustClip;

/**
 * 🧱 Beágyazott kompozíció (compound clip / pre-compose): egy önálló al-idővonal,
 * amit a render rekurzívan MP4-be renderel, majd a szülő-klip forrásaként használ.
 * Újraszerkeszthető (a klipek itt maradnak), és a compound klip effektjei/trimje
 * a kész beágyazott képre hatnak.
 */
export interface NestedComposition {
  aspectRatio: AspectRatio;
  tracks: Track[];
  assets: Asset[];
  /** a beágyazott idővonal teljes hossza (mp) */
  duration: number;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  clips: Clip[];
}

/**
 * ✨ Részecske-réteg (🧊 3D V2): projekt-szintű overlay — a worker generálja
 * (Chromium-canvas), a render a feliratok ALÁ komponálja; beat-syncnél a
 * burstök a zene ütemeire esnek. Az előnézet nem mutatja (render-only v1).
 */
export type ParticlesPreset = 'confetti' | 'sparkle' | 'snow' | 'embers';

export interface ParticlesConfig {
  preset: ParticlesPreset;
  /** burstök a zene downbeatjeire (zene nélkül ambient marad) */
  beatSync: boolean;
  /** sűrűség-szorzó 0.4–1.6 (hiányzó = 1) */
  intensity?: number;
}

/**
 * 🔖 Marker: nevesített időpont az idővonalon (szerkezet, refrén, CTA…).
 * A vonalzón látszik, a klip-húzás rá is snappel, és a projekttel mentődik.
 */
export interface Marker {
  id: string;
  /** idővonal-mp */
  time: number;
  label: string;
  /** jelölő-szín (hex); hiányzik = alapértelmezett. Csak szerkesztő-navigáció,
   *  nem renderelődik → tetszőlegesen színezhető paritás-gond nélkül. */
  color?: string;
  /** szabad-szöveges megjegyzés (rendezői jegyzet) — csak szerkesztő-oldali */
  note?: string;
}

/**
 * 🏷️ Timeline-régió: névvel + színnel jelölt idő-tartomány az idővonalon
 * (szervezés/navigáció — pl. „Intró", „B-roll blokk"). CSAK szerkesztő-oldali,
 * NEM renderelődik → tetszőlegesen színezhető paritás-gond nélkül.
 */
export interface TimelineRegion {
  id: string;
  /** idővonal-mp */
  start: number;
  end: number;
  label: string;
  color: string;
}

/** 🎬 Story-fejezet fajtája (short-form dramaturgia): Hook→Context→Value→CTA. */
export type ChapterKind = 'hook' | 'context' | 'value' | 'cta' | 'other';

/**
 * 🎬 Story-struktúra fejezet: a `start`-tól a KÖVETKEZŐ fejezet startjáig (ill.
 * a projekt végéig) tart. A ReMix a videó „térképét" adja — a user nem csak
 * klipeket lát, hanem a videója történetét (Hook / Context / Value / CTA).
 */
export interface Chapter {
  id: string;
  /** kezdet az idővonalon (mp) */
  start: number;
  kind: ChapterKind;
}
