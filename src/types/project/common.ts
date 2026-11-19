export type AspectRatio = '16:9' | '9:16' | '1:1';

/**
 * 🎛️ A projekt FAJTÁJA = melyik „stúdió” hozza létre / szerkeszti. A három
 * stúdió EGYÜTT alkotja a Studiót:
 * - `video`: a teljes idővonalas videószerkesztő (a `/editor/[id]` útvonal);
 * - `image`: réteg-fás képszerkesztő (a projekt egy `ImageDoc`-ot hordoz);
 * - `audio`: hang-/zeneszerkesztő.
 *
 * A kép- és hang-projekt KIMENETE a videó-editorban is felhasználható médiaként.
 * Hiányzó érték = `video` (a séma-6 előtti, régi projektek mind videók).
 */
export type ProjectKind =
  // ── KÉSZ stúdiók (az „Új projekt" választója ezekből épül) ────────────────
  | 'video'
  | 'image'
  | 'audio'
  // ── CreativeDocument-bővítés (PM1 — MASTER §16, záró-szakasz): a `Project`
  //    egy DOKUMENTUMTÍPUS a sok közül. Ezek ADAT-szinten léteznek (Workspace/
  //    Creative Graph/Memory/⌘K hordozza és címkézi őket), de MÉG NINCS kész
  //    szerkesztő-stúdiójuk → nem hozhatók létre UI-ból (lásd
  //    `@/lib/projectKinds` `isEditableKind`/`CREATABLE_KINDS`). Additív union-
  //    bővítés; migráció nem kell (a `kind` szabad string-mező, a régi
  //    projektek `video`-ra esnek vissza). ──────────────────────────────────
  | 'writing'
  | 'code'
  | 'music'
  | 'design'
  // ── 🎥 Live Studio (OBS-stílusú élő produkció) — saját stúdiója a
  //    `/live/studio/[id]` route (lásd devs/tasks/LIVE.md). A Live-hubból
  //    („Go live") jön létre, NEM a generikus „Új projekt" választóból
  //    (ezért nem `creatable` a projectKinds-ban). ──────────────────────────
  | 'live'
  // ── 🧊 3D Stúdió (LiDAR-szken → 3D-modell) — CSAK LiDAR-os eszközön létezik
  //    (3D-Studio.md §1.1); amíg a stúdió nincs kész, `editable: false`. ─────
  | 'model3d';

/**
 * Sávok (full-plan F0.5): a tartalom-típusok kapnak sávot; a transition/filter/
 * mask/animáció a klip property-je marad. A hang három sávra bomlik (zene /
 * voiceover / SFX — egyszerre szólhatnak), a felirat és a matrica/grafika
 * külön réteg a címektől.
 */
export type TrackType =
  | 'video'
  | 'pip'
  | 'adjust'
  | 'text'
  | 'captions'
  | 'overlay'
  | 'interactive'
  | 'music'
  | 'voiceover'
  | 'sfx'
  // 🎚️ további általános hangsávok (Hang Stúdió „+ Sáv”; a név a `Track.name`)
  | 'aux1'
  | 'aux2'
  | 'aux3'
  | 'aux4'
  | 'aux5';

export type FilterId =
  | 'none'
  | 'warm'
  | 'cool'
  | 'mono'
  | 'vivid'
  | 'fade'
  | 'night'
  | 'retro'
  | 'sunset'
  | 'forest';

export type TextAnimation =
  | 'none'
  | 'fade'
  | 'slide'
  | 'pulse'
  | 'typewriter'
  | 'pop'
  | 'shake'
  | 'karaoke';

/** Feliratstílus-preset — a megjelenítő értelmezi (kontúr, buborék, neon…). */
export type TextStylePreset = 'plain' | 'bubble' | 'outline' | 'neon';

/**
 * Térbeli döntés a videó/kép klipen (🧊 3D V1): CSS-konvenció szerinti
 * perspektivikus rotateX/rotateY. Az előnézet RN-transformmal közelít, a
 * render ffmpeg perspective-warppal égeti be.
 */
export interface Tilt3D {
  /** döntés fokban (-45…45): + = a felső él hátradől */
  rotX: number;
  /** döntés fokban (-45…45): + = a jobb él hátradől */
  rotY: number;
}

/**
 * 💡 Lighting-preset (🧊 3D V2): hangulat-világítás color-grade-ként — a
 * render split-tone színkorrekciót éget (árnyék/középtónus/csúcsfény külön),
 * az előnézet tintával közelít.
 */
export type LightingPreset = 'studio' | 'sunset' | 'neon' | 'cyberpunk';

/**
 * 🎯 AI Select (CC V2): a képjavítás CSAK a kijelölésre hat — a worker
 * téma-maszkjával (u2net). `target: 'subject'` = a téma, `'background'` = a
 * háttér. A maszk a bgremove md5-cache-éből jön (id), a render onnan olvassa.
 */
export interface SelectiveEdit {
  /** a maszk-készlet azonosítója (a forráskép md5-e a bgremove cache-ben) */
  id: string;
  target: 'subject' | 'background';
}

/**
 * 🙈 Arc-elmosás (adatvédelem, 🧊 3D V2 face effects): a detektált arcok
 * befoglaló területe elmosódik a renderben. A régió vászon-normalizált és
 * STATIKUS (a mintavett arc-pozíciók uniója + margó) — így a render gyors
 * marad, és a fejmozgást is lefedi.
 */
export interface FaceBlur {
  /** középpont + méret, vászon-normalizálva */
  x: number;
  y: number;
  w: number;
  h: number;
  /** elmosás erőssége 0.3–2 (hiányzó = 1) */
  strength?: number;
  /** pixeles (mozaik) elmosás a lágy helyett */
  pixelate?: boolean;
  /**
   * 🎯 Objektum-követés: a blur-régió KÖZÉPPONTJÁNAK klip-lokális pont-sora — ha
   * van, a régió (fix mérettel) képkockánként a követett objektumhoz mozog a
   * renderben (crop/overlay `t`-kifejezés). A szélek előtt/után az érték tartva.
   */
  track?: { t: number; x: number; y: number }[];
}

/**
 * 🏔️ 2.5D mélység-parallaxis fotón (🧊 3D V1): a worker mélységbecslésből
 * fg/mid/bg rétegeket készít (id = a kép md5-e, a rétegek a workeren élnek),
 * a render a rétegeket eltérő erejű kameramozgással kompozitálja. Az előnézet
 * a lapos fotót mutatja a kameramozgással — az igazi mélység a renderben.
 */
export interface DepthParallax {
  /** a worker-oldali réteg-készlet azonosítója (a forráskép md5-e) */
  id: string;
  /** a parallaxis ereje 0.3–1.5 (hiányzó = 1) */
  strength?: number;
}

/**
 * 🌫️/🎬 Mélység-fókusz fotón (depth-extra): 'portrait' = a távoli tartalom
 * portré-blurt kap; 'toFar'/'toNear' = fókusz-húzás animáció a két fókusz-
 * állapot közt (a renderben; az előnézet a previewUri állóképét mutatja).
 */
export interface DepthFocus {
  /** a worker-oldali mélység-készlet azonosítója (a forráskép md5-e) */
  id: string;
  mode: 'portrait' | 'toFar' | 'toNear';
  /** a közeli-fókusz változat helyi másolata az előnézethez */
  previewUri?: string;
}

/** 3D/dinamikus átmenet a KÖVETKEZŐ klipre (🧊 3D V1) — a render égeti be. */
export interface TransitionOut {
  type:
    | 'zoom'
    | 'spin'
    | 'flip'
    | 'cube'
    | 'circle'
    | 'dissolve'
    | 'wipeLeft'
    | 'wipeRight'
    | 'wipeUp'
    | 'wipeDown'
    | 'slideLeft'
    | 'slideRight'
    | 'pixelize'
    | 'blur'
    | 'fadeBlack'
    | 'fadeWhite'
    | 'radial';
  /** mp (0.2–1.5) */
  duration: number;
  /** 🧭 irány (irányos átmeneteknél az xfade-variánst választja) */
  direction?: 'left' | 'right' | 'up' | 'down';
  /** időzítés-görbe (a crossfade-nél eased progress; a többinél tárolt) */
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  /** globális erősség 0…1 — a blur/zoom/rotation flourisököt skálázza (hiányzó = 1) */
  intensity?: number;
  /** 🌫️ elmosás-flourish az átmenet-ablakban 0…1 (a renderben `gblur`) */
  blur?: number;
  /** 🔍 zoom-lökés az átmenet-ablakban 0…1 (crop-pulzus) */
  zoom?: number;
  /** 🔄 forgás-lökés az átmenet-ablakban 0…1 (`rotate`-pulzus) */
  rotation?: number;
}

/**
 * 3D szöveg (🧊 3D V1): extrudált mélység + perspektivikus döntés + anyag.
 * Az előnézet RN-transformmal közelít, a render CSS-3D-vel égeti be.
 */
export interface Text3D {
  /** extrúzió-mélység 0–1 */
  depth: number;
  /** döntés fokban (-45…45) */
  tiltX: number;
  tiltY: number;
  material: 'chrome' | 'gold' | 'neon' | 'plastic';
}
