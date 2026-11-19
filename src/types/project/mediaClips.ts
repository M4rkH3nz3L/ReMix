import type { ChromaKey, ClipAdjust, ClipBase, ClipMask, ClipMatte, PipFrame, Stabilize } from './clipBase';
import type { DepthFocus, DepthParallax, FaceBlur, FilterId, LightingPreset, SelectiveEdit, Tilt3D, TransitionOut } from './common';
import type { NestedComposition } from './timeline';

export interface VideoClip extends ClipBase {
  kind: 'video';
  /**
   * 🧱 Compound clip / pre-compose: ha van, ez a klip egy BEÁGYAZOTT kompozíció
   * (al-idővonal) — a render REKURZÍVAN legyártja MP4-be, és azt használja
   * forrásként (a `uri` a nyers/proxy előnézethez marad). Így sok klip EGY
   * kezelhető blokká fogható össze (hosszú projekt), effekt/blend/trim rá is hat.
   */
  comp?: NestedComposition;
  /** a hivatkozott asset; az uri denormalizált gyorsítás */
  assetId?: string;
  uri: string;
  /**
   * ⏳ Live-VOD feldolgozás alatt: a forrás (az egress-felvétel) MÉG töltődik fel
   * (R2), a `uri` csak hamarosan lesz elérhető. Az editor ilyenkor loadert mutat +
   * pollozza a `uri`-t, és elérhetővé váláskor törli a flaget (UPDATE_CLIP) → a
   * lejátszó újratölti. Hiányzó = kész forrás. (LIVE/05.1)
   */
  pending?: boolean;
  /** a forrásfájlon belüli kezdőpont (mp) */
  trimIn: number;
  /** a forrásfájl teljes hossza (mp) */
  sourceDuration: number;
  /** 0.1–10 */
  speed: number;
  /**
   * ⏪ Fordított lejátszás (audit §6.3): a klip a forrást visszafelé játssza. A
   * `sourceTimeAt` tükrözi (az idővonal-hossz változatlan); a renderben FFmpeg
   * `reverse`/`areverse` filter. Hiányzó = normál irány. (A freeze-frame külön
   * mechanizmus: `@/lib/freeze` `buildFreezePlan` — állókocka kép-klipként.)
   */
  reversed?: boolean;
  /** 0–1 */
  volume: number;
  /** Voice Studio: zajszűrés + kompresszor + loudness a renderben (hiányzó = ki) */
  voiceEnhance?: boolean;
  /**
   * 🌀 mozgás-elmosás / sima lassítás ereje (0–1). Gyorsításnál a kihagyott
   * forráskockákat elmossa, lassításnál köztes kockákat számol — csak a
   * renderben (az előnézet a nyers sebességet mutatja).
   */
  motionBlur?: number;
  /**
   * ⏱️ Idő-interpoláció (time remapping minőség) lassításnál/gyorsításnál:
   * `flow` = optical flow / mozgásbecslés (minterpolate mci — a legsimább),
   * `blend` = képkocka-keverés (frame blending), `none`/hiányzó = kockadobás/-
   * duplázás (a régi motionBlur-alapú auto). A renderben; az előnézet a nyerset mutatja.
   */
  timeInterp?: 'none' | 'blend' | 'flow';
  /**
   * 🎯 Videó-stabilizálás (a renderben, `deshake`): a bemozdulást képkockánként
   * kompenzálja. A meglévő minőség-vizsgálat (qualityScan) csak MÉR — ez a
   * tényleges stabilizálás.
   */
  stabilize?: Stabilize;
  /** Voice Studio: visszhang-csökkentés (szobahang) — a renderben */
  deReverb?: boolean;
  filterId: FilterId;
  /** 🎛️ effekt-lánc (audit §6.5) — a megjelenés-lánc UTÁN, sorrend-függő (additív) */
  effects?: VideoEffect[];
  /** a szűrő erőssége 0–1 (hiányzó = 1) */
  filterIntensity?: number;
  /** áttűnés feketéből/feketébe a klip szélein (mp, hiányzó = 0) */
  fadeInSec?: number;
  fadeOutSec?: number;
  /** kitöltés arány-eltérésnél: 'black' (alap) vagy 'blur' (elmosott cover) */
  backgroundFill?: 'black' | 'blur';
  /** vászon-transzform: scale 1 = illesztett; x/y a vászonméret arányában */
  transform?: CanvasTransform;
  /** 🎬 PiP-keret (webcam-bubble): lekerekítés + keret + árnyék — csak pip-sávon */
  pipFrame?: PipFrame;
  /** animált zoom/pan — felülírja a transform scale/x/y értékeit */
  keyframes?: ClipKeyframes;
  /** 0–1 (hiányzó = 1) */
  opacity?: number;
  /** maszk (transform nélküli klipen érvényesül a renderben) */
  mask?: ClipMask;
  /** 🎭 track/luma/alpha matte: külső média fényereje/alfája adja az átlátszóságot */
  matte?: ClipMatte;
  /** green screen kulcsolás */
  chromaKey?: ChromaKey;
  /** képjavítás (fényerő/kontraszt/szaturáció/hőmérséklet/vignetta) */
  adjust?: ClipAdjust;
  /** térbeli döntés (🧊 3D V1) — maszkkal nem kombinálódik */
  tilt3d?: Tilt3D;
  /** 💡 hangulat-világítás (🧊 3D V2) — a képjavítás UTÁN fut a renderben */
  lighting?: LightingPreset;
  /** 🙈 arc-elmosás (adatvédelem) — a renderben ég be */
  faceBlur?: FaceBlur;
  /** 🎯 AI Select: a képjavítás csak a témára/háttérre hasson */
  selective?: SelectiveEdit;
  /** 3D/dinamikus átmenet a következő klipre */
  transitionOut?: TransitionOut;
}

export interface ImageClip extends ClipBase {
  kind: 'image';
  /** a hivatkozott asset; az uri denormalizált gyorsítás */
  assetId?: string;
  uri: string;
  /**
   * 🎨 Vissza-hivatkozás a szerkeszthető RÉTEG-FÁRA (Kép Stúdió). Ha van, az
   * `uri` a `project.imageDocs`-ban lévő ilyen id-jű `ImageDoc` renderelt PNG-je
   * — a Kép Stúdió NEM destruktívan, a réteg-fán szerkeszti tovább (a régi,
   * destruktív egy-kép szerkesztő helyett). Hiányzik → sima (nem réteges) kép.
   */
  docId?: string;
  filterId: FilterId;
  /** 🎛️ effekt-lánc (audit §6.5) — a megjelenés-lánc UTÁN, sorrend-függő (additív) */
  effects?: VideoEffect[];
  /** a szűrő erőssége 0–1 (hiányzó = 1) */
  filterIntensity?: number;
  /** áttűnés feketéből/feketébe a klip szélein (mp, hiányzó = 0) */
  fadeInSec?: number;
  fadeOutSec?: number;
  /** kitöltés arány-eltérésnél: 'black' (alap) vagy 'blur' (elmosott cover) */
  backgroundFill?: 'black' | 'blur';
  /** vászon-transzform: scale 1 = illesztett; x/y a vászonméret arányában */
  transform?: CanvasTransform;
  /** 🎬 PiP-keret (webcam-bubble): lekerekítés + keret + árnyék — csak pip-sávon */
  pipFrame?: PipFrame;
  /** animált zoom/pan — felülírja a transform scale/x/y értékeit */
  keyframes?: ClipKeyframes;
  /** 0–1 (hiányzó = 1) */
  opacity?: number;
  /** maszk (transform nélküli klipen érvényesül a renderben) */
  mask?: ClipMask;
  /** 🎭 track/luma/alpha matte: külső média fényereje/alfája adja az átlátszóságot */
  matte?: ClipMatte;
  /** green screen kulcsolás */
  chromaKey?: ChromaKey;
  /** képjavítás (fényerő/kontraszt/szaturáció/hőmérséklet/vignetta) */
  adjust?: ClipAdjust;
  /** térbeli döntés (🧊 3D V1) — maszkkal nem kombinálódik */
  tilt3d?: Tilt3D;
  /** 💡 hangulat-világítás (🧊 3D V2) — a képjavítás UTÁN fut a renderben */
  lighting?: LightingPreset;
  /** 🙈 arc-elmosás (adatvédelem) — a renderben ég be */
  faceBlur?: FaceBlur;
  /** 🎯 AI Select: a képjavítás csak a témára/háttérre hasson */
  selective?: SelectiveEdit;
  /** 2.5D mélység-parallaxis (🧊 3D V1) — a renderben kel életre */
  depthParallax?: DepthParallax;
  /** mélység-fókusz: portré-blur vagy fókusz-húzás (parallax mellett nem él) */
  depthFocus?: DepthFocus;
  /** 3D/dinamikus átmenet a következő klipre */
  transitionOut?: TransitionOut;
}

export interface CanvasTransform {
  scale: number;
  x: number;
  y: number;
  /** fokban (hiányzó = 0) */
  rotation?: number;
  /**
   * ⚓ Rögzítési pont (pivot) a forgatáshoz/méretezéshez, 0–1 a klip-dobozon
   * (0=bal/fent, 1=jobb/lent). Hiányzó = 0.5 (közép) — a mai viselkedés. A
   * preview `transformOrigin`-ként, a render a forgatás-középpont eltolásaként
   * alkalmazza. (audit §6.6)
   */
  anchorX?: number;
  anchorY?: number;
  /**
   * ⬛ Nyírás (skew/shear) fokban (hiányzó = 0). A preview RN `skewX`/`skewY`,
   * a render a meglévő perspektíva-filter 4-sarok-warpjával (paritás). (audit §6.6)
   */
  skewX?: number;
  skewY?: number;
  /**
   * 📐 Perspektíva / 3D-dőlés −1…1 (corner-pin): X>0 a jobb él dől hátra (X<0 bal),
   * Y>0 az alsó él (Y<0 felső). A render a Kép Stúdió `perspectiveFilter`-ével (átlátszó
   * out-of-quad → a mögötti réteg látszik); a preview 3D rotate-tel közelít. (VIDEOT §4)
   */
  perspectiveX?: number;
  perspectiveY?: number;
}

/**
 * 🎛️ Effekt-lánc (audit §6.5): rendezhető, sorrend-függő effektek a klipen. A
 * `type` a katalógusból ([lib/videoEffects.ts](../lib/videoEffects.ts)), az `amount`
 * 0–1 a parametrikus effektekhez, `enabled` hiányzó/true = aktív. A lánc a meglévő
 * megjelenés (filter/adjust/lut) UTÁN fut — additív, hiányzó/üres = nincs hatás.
 */
export type VideoEffectType =
  | 'blur'
  | 'sharpen'
  | 'vignette'
  | 'grain'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'chromaticAberration'
  | 'lightLeak'
  | 'motionBlur'
  | 'deflicker'
  | 'clarity'
  | 'dehaze'
  | 'pixelate'
  | 'posterize'
  | 'scanlines'
  | 'halftone';
export interface VideoEffect {
  id: string;
  type: VideoEffectType;
  /** 0–1 a parametrikus effektekhez (blur/sharpen/vignette/grain); fixnél nincs hatása. */
  amount?: number;
  /** hiányzó = aktív; `false` = átmenetileg kikapcsolva (a láncban marad). */
  enabled?: boolean;
}

/**
 * A kulcskocka easingje: az EBBŐL a kulcskockából induló átmenet görbéje.
 * A `bezier` egyéni köbös Bézier-görbe — a vezérpontokat a `Keyframe.bezier`
 * hordozza (CSS `cubic-bezier(x1,y1,x2,y2)` konvenció, végpontok 0,0 és 1,1).
 */
export type KeyframeEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold' | 'bezier';

export interface Keyframe {
  /** idő a klip kezdetétől (mp, idővonal-időben) */
  time: number;
  value: number;
  easing: KeyframeEasing;
  /**
   * Egyéni köbös Bézier vezérpontok `[x1,y1,x2,y2]` (0–1 időben, az érték
   * túllőhet 0–1-en = „overshoot"). Csak `easing: 'bezier'` esetén él; a render
   * finom lineáris al-kulcskockákra „süti" (paritás, mert az FFmpeg nem tud
   * zárt alakban Bézier-időt visszafejteni).
   */
  bezier?: [number, number, number, number];
}

/**
 * Kulcskockázható csatornák: vászon-transzform zoom/pan (scale/x/y), forgatás
 * (rotation), átlátszóság (opacity) és hangerő-automáció (volume). Az első
 * kulcskocka előtt / az utolsó után az érték tartva; csatorna nélkül a klip
 * statikus értéke él. A render UGYANEZEKET a görbéket alkalmazza (paritás) —
 * a rotation/opacity per-frame is a megjelenés-láncban (guarded: kulcskocka
 * nélkül a viselkedés a régi statikus úttal bitre azonos).
 */
export interface ClipKeyframes {
  scale?: Keyframe[];
  x?: Keyframe[];
  y?: Keyframe[];
  /**
   * forgatás fokban (videó/kép; a statikus transform.rotation az alap). A render
   * a megjelenés-láncban per-frame `rotate` kifejezéssel animálja.
   */
  rotation?: Keyframe[];
  /**
   * átlátszóság 0–1 (videó/kép; a statikus clip.opacity az alap). A render
   * per-frame alfával animálja — kulcskocka nélkül a klip végig átlátszatlan.
   */
  opacity?: Keyframe[];
  /** hangerő-automáció 0–1 (videó- és hangklipen; a statikus volume az alap) */
  volume?: Keyframe[];
  /** pásztázás-automáció −1…1 (hangklipen; a statikus pan az alap). A render per-frame
   *  (aeval) sztereó-balanszként égeti be — kulcskocka nélkül a statikus pan érvényes. */
  pan?: Keyframe[];
  /**
   * 🎛️ effekt-automáció (hangklipen; a klip `audioFx` statikus értéke az alap): az alul-/
   * felüláteresztő frekvenciája (Hz), a zengés és a visszhang mértéke (0–1), a három EQ-sáv
   * erősítése (dB, ±12). A közös DSP 64 mintánként frissít (előnézet = export).
   */
  fxLowpass?: Keyframe[];
  fxHighpass?: Keyframe[];
  fxReverb?: Keyframe[];
  fxDelay?: Keyframe[];
  fxEqLow?: Keyframe[];
  fxEqMid?: Keyframe[];
  fxEqHigh?: Keyframe[];
  /** 🎛️ V7.4: az EQ-sávok frekvenciája (Hz) — söprés; a tartomány a `fxParams.ts` EQ_BAND_SPEC-je */
  fxEqLowFreq?: Keyframe[];
  fxEqMidFreq?: Keyframe[];
  fxEqHighFreq?: Keyframe[];
}
