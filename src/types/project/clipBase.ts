export interface ClipBase {
  id: string;
  /** kezdet a projekt-idővonalon (mp) */
  start: number;
  /** hossz az idővonalon (mp) */
  duration: number;
  /** 🤖 ha az AI hozta létre: a művelet indoklása („miért van ez itt?" — #34) */
  aiReason?: string;
}

/**
 * Maszk (P0‑10): a klip csak a formán belül látszik (invert: kívül). Vászon-
 * normalizált középpont+méret; a feather a lágy szél szélessége (a méret
 * arányában). Freeform később, a Creative Canvas rétegmodellel.
 */
export interface ClipMask {
  shape: 'rectangle' | 'ellipse' | 'polygon';
  /** freeform maszk csúcsai (vászon-normalizált, min. 3) — polygon esetén. A
   *  szabadkézi rajz és a bezier-simítás is ide sűrűsödik (a render poligonként
   *  értelmezi, egyetlen szürke kockán). */
  points?: { x: number; y: number }[];
  /** 🖌️ festett maszk: szürke PNG a (x, y, w, h) dobozban, fehér = látszik, fekete = rejtett; kívül rejtett */
  image?: string;
  /** ✂️ kijelölésből készült maszk: sorban alkalmazott műveletek, lyuk és homorú forma is pontos */
  ops?: { op: 'add' | 'subtract' | 'intersect'; points: { x: number; y: number }[] }[];
  /** középpont, 0–1 */
  x: number;
  y: number;
  /** teljes szélesség/magasság, 0–1 */
  w: number;
  h: number;
  /** lágy szél (0–0.3, hiányzó = 0.05) */
  feather?: number;
  invert?: boolean;
  /**
   * 🩹 Kiterjesztés (dilate/erode): a maszk élének kifelé (+) / befelé (−)
   * tolása. Ellipszisnél/téglalapnél él-eltolás, poligonnál a súlypontból
   * skálázás. −0.3…0.3, hiányzó/0 = nincs hatás. A renderben.
   */
  expand?: number;
  /**
   * 🌓 Maszk-átlátszóság: a KIMASZKOLT (elrejtett) terület megtartott
   * átlátszatlansága (0 = teljesen levágva, 1 = nincs vágás). Hiányzó = 0.
   * A renderben az alfa-rámpa alsó szintjét emeli meg.
   */
  opacity?: number;
  /**
   * 🎬 Rotoszkóp / követés: a maszk GEOMETRIÁJÁNAK kulcskockái klip-lokális
   * időben. Ha van (≥1 keret), a maszk a `track`-ból interpolálódik (a fenti
   * x/y/w/h/points a kulcskocka nélküli alap). Így a maszk követhet egy témát,
   * vagy képkockánként újrarajzolható (rotoszkóp). A `shape`/`invert`/`opacity`
   * a `track`-tól függetlenül, a klip szintjén él.
   */
  track?: MaskFrame[];
}

/**
 * 🎬 Egy maszk-kulcskocka: a geometria pillanatképe egy klip-lokális időpontban.
 * A `shape`-et NEM hordozza (az a ClipMason állandó); a poligon-pontok
 * interpolációja csak AZONOS pontszámú szomszédos keretek közt fut (különben az
 * előző keret pontjait tartja — „stepped" rotoszkóp).
 */
export interface MaskFrame {
  /** klip-lokális idő (mp) */
  time: number;
  x: number;
  y: number;
  w: number;
  h: number;
  feather?: number;
  expand?: number;
  points?: { x: number; y: number }[];
}

/**
 * Képjavítás (Creative Canvas): videón és képen közös motor — az előnézet
 * közelít, a végleges korrekció a renderben készül (eq/colorbalance/vignette).
 * Minden érték 0 = semleges.
 */
export interface ClipAdjust {
  /** -0.3 … 0.3 */
  brightness?: number;
  /** -0.4 … 0.4 (0 = alap kontraszt) */
  contrast?: number;
  /** -1 … 1 (−1 = fekete-fehér) */
  saturation?: number;
  /** -0.3 … 0.3 (meleg ↔ hideg) */
  temperature?: number;
  /** 0 … 1 */
  vignette?: number;
  // ── Pro Basic-grade (Lightroom-szerű tónusvezérlők) ────────────────────
  /** 🌞 Expozíció, stop-ban. -1 … 1 (renderben `exposure`). */
  exposure?: number;
  /** ☀️ Csúcsfények (a felső tónusok). -1 … 1 (renderben `curves`). */
  highlights?: number;
  /** 🌑 Árnyékok (az alsó tónusok). -1 … 1 (renderben `curves`). */
  shadows?: number;
  /** ⬜ Fehérek (a legvilágosabb tónusok). -1 … 1 (renderben `curves`). */
  whites?: number;
  /** ⬛ Feketék (a legsötétebb tónusok). -1 … 1 (renderben `curves`). */
  blacks?: number;
  /** 💜 Színárnyalat: zöld ↔ magenta. -0.3 … 0.3 (renderben `colorchannelmixer` gg). */
  tint?: number;
  /** 🌈 Élénkség (a kevésbé telített színeket emeli jobban). -1 … 1 (renderben `vibrance`). */
  vibrance?: number;
  /** 📈 Tónusgörbék (RGB + csatornánként). Renderben `curves`. */
  curves?: ToneCurves;
  // ── HSL / Hue-Saturation (globális, Photoshop „Master") ────────────────
  /** 🎨 Színforgatás: -1…1 → ±180°. Renderben `hue=h`. */
  hue?: number;
  /** 🎨 HSL-telítettség (szorzó). -1…1 (0 = szürke, +1 = dupla). Renderben `hue=s`. */
  hslSaturation?: number;
  /** 🎨 HSL-világosság (additív). -1…1. Renderben `hue=b`. */
  hslLuminance?: number;
  /**
   * 🎨 3-way color balance (color wheels): az árnyékok / középtónusok / csúcsfények
   * RGB-eltolása, komponensenként -1…1. Renderben `colorbalance` (rs/gs/bs ·
   * rm/gm/bm · rh/gh/bh); az előnézet nettó tinttel közelít.
   */
  balance?: {
    sh?: { r?: number; g?: number; b?: number };
    mid?: { r?: number; g?: number; b?: number };
    hi?: { r?: number; g?: number; b?: number };
  };
  /**
   * 🎞️ 3D LUT (.cube) — kreatív „look" a grade-lánc végén (vignette előtt).
   * A renderben `lut3d`; az `uri` a lokalizált .cube fájl. A worker-render a
   * .cube-ot a médiával együtt kapja meg (mint a klip-uri-kat).
   */
  lut?: ClipLut;
  // ── 🖼️ Kép-paritás: a Kép Stúdióval AZONOS szín-eszközök a video/image-klipre ──
  /** 📊 szintek (levels): fekete/fehér-pont + gamma. Renderben `lutrgb` (a kép `levelsFilter`-ével azonos). */
  levels?: { black: number; white: number; gamma: number };
  /** 🎨 csatorna-mixer: 3×3 együttható (rr..bb). Renderben `colorchannelmixer` (a kép `channelMixFilter`-ével azonos). */
  channelMix?: { rr?: number; rg?: number; rb?: number; gr?: number; gg?: number; gb?: number; br?: number; bg?: number; bb?: number };
  /** 🎨 gradient-map (egyedi-színű duotone): luminancia → `shadow`→`highlight` átmenet. Renderben `geq`. */
  gradientMap?: { shadow: string; highlight: string };
  /** 🎨 split-toning: az árnyékokat `shadow`, a csúcsfényeket `highlight` felé tintálja (kép-struktúra marad,
   *  additív); `strength` 0–1. Renderben `geq` (luminancia-súlyozott), a kép `splitToneFilter`-ével azonos. */
  splitTone?: { shadow: string; highlight: string; strength?: number };
}

/** Importált 3D LUT (.cube). */
export interface ClipLut {
  uri: string;
  name: string;
}

/** Egy tónusgörbe kontrollpontja (x = bemenet, y = kimenet, mindkettő 0…1). */
export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * 📈 Tónusgörbék (Curves): az `rgb` mindhárom csatornára (luma-jellegű), a
 * `red`/`green`/`blue` csatornánként hat. Kontrollpont-listák (≥2 pont,
 * x szerint rendezve); hiányzó/identitás görbe = nincs hatás. A renderben a
 * `curves` szűrő (természetes köbös spline a pontokon át) — a szerkesztő
 * Catmull-Rom spline-nal közelíti a görbét.
 */
export interface ToneCurves {
  rgb?: CurvePoint[];
  red?: CurvePoint[];
  green?: CurvePoint[];
  blue?: CurvePoint[];
}

/** Green screen (P0‑10): a kulcs-szín átlátszóvá válik a renderben. */
export interface ChromaKey {
  /** hex, pl. #00ff00 */
  color: string;
  /** tűrés 0.05–0.45 */
  similarity: number;
  /** él-lágyítás 0–0.3 (hiányzó = 0.05) */
  blend?: number;
  /**
   * 🟢 Spill-suppression: a kulcs-szín (zöld/kék) visszaverődésének eltávolítása
   * a téma pereméről. 0/hiányzó = ki, 0.1–1 = erősség. A renderben `despill`.
   */
  spill?: number;
  /**
   * ✂️ Él-igazítás (matte choke/grow): a kulcsolt alfa élének befelé (−, a perem
   * „megevése") / kifelé (+) tolása. −1…1, 0/hiányzó = ki. A renderben az alfán
   * `erosion`/`dilation` (|edge|·4 menet) — a zöld/kék maradék-perem eltüntetésére.
   */
  edge?: number;
}

/**
 * 🎭 Track/luma/alpha matte: egy KÜLSŐ média (kép) fényereje (`luma`) vagy alfája
 * (`alpha`) adja a klip átlátszóságát — a klip csak ott látszik, ahol a matte
 * világos (luma) / átlátszatlan (alpha). Az `invert` megfordítja. A renderben a
 * matte a WxH-ra skálázva, gray/alphaextract → a fg-alfával szorozva (alphamerge).
 * Így „clipping mask" / luma-matte effekt tetszőleges média-formával.
 */
export interface ClipMatte {
  /** a matte média elérése (kép; a videó-matte az első kockára fagy — v1) */
  uri: string;
  /** `luma` = a fényerő az alfa; `alpha` = a matte saját alfája */
  type: 'luma' | 'alpha';
  invert?: boolean;
}

/**
 * Keverési mód (blend): a réteg a mögötte lévő képpel keveredik (nem takar).
 * Az RN `mixBlendMode` ÉS az ffmpeg `blend=all_mode` is ismeri mindegyiket.
 */
/**
 * Keverési módok — a preview RN `mixBlendMode`-ja (CSS-név a `cssBlendMode`-dal)
 * ÉS az ffmpeg `blend=all_mode` is ismeri mindet (a colordodge/colorburn az
 * ffmpeg-ben `dodge`/`burn`, a preview-ban `color-dodge`/`color-burn`).
 */
export type BlendMode =
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'hardlight'
  | 'softlight'
  | 'colordodge'
  | 'colorburn';

/**
 * PiP-keret („webcam-bubble"): a pip-sávos klip lekerekített sarka/köre + kerete
 * + árnyéka + keverési módja. Az előnézet natívan (borderRadius/border/shadow/
 * mixBlendMode), a render `pad` (keret, BELÜL) + `geq` lekerekített alfa +
 * `blend=all_mode` útján — a kettő vizuálisan egyezik. Csak a pip-sávon hat.
 */
export interface PipFrame {
  /** sarok-lekerekítés a rövidebb él arányában, 0–0.5 (0.5 ≈ kör négyzetes PiP-en) */
  radius?: number;
  /** keret vastagsága a vászonmagasság arányában (0–0.03); 0/hiányzó = nincs keret */
  borderWidth?: number;
  borderColor?: string;
  /** lágy vetett árnyék a buborék mögé (előnézetben ÉS renderben) */
  shadow?: boolean;
  /** keverési mód a fő videóval (light-leak/screen-overlay/dupla-expozíció) */
  blendMode?: BlendMode;
}

/**
 * 🎯 Videó-stabilizálás beállításai (a renderben `deshake`-kel). Az `automatic`
 * flag csak azt jelzi, hogy be van kapcsolva (a `deshake` maga automatikus
 * mozgásbecslést végez). A `rollingShutter` finomabb blokk-becslést + clamp
 * élt kér a görgő-zár wobble csökkentésére (a teljes RS-korrekció ffmpeg-ben
 * korlátozott — nincs dedikált szűrő).
 */
export interface Stabilize {
  /** be van-e kapcsolva */
  automatic: boolean;
  /** erősség 0…1 → a keresési tartomány (rx/ry 16…64) */
  strength?: number;
  /** simaság 0…1 → a mozgásbecslő blokkmérete (nagyobb = simább, kevésbé precíz) */
  smoothness?: number;
  /** kivágás/zoom 0…1 → a képet befelé nagyítja, hogy a bemozduló szélek eltűnjenek */
  crop?: number;
  /** görgő-zár (rolling shutter) korrekció (közelítő) */
  rollingShutter?: boolean;
}
