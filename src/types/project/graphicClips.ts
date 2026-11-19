import type { BlendMode, ClipBase } from './clipBase';
import type { Text3D, TextAnimation, TextStylePreset } from './common';
import type { ClipKeyframes } from './mediaClips';

export interface TextClip extends ClipBase {
  kind: 'text';
  text: string;
  color: string;
  backgroundColor: string | null;
  /** az előnézet magasságának %-ában (pl. 7 = 7%) */
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  /** választott betűtípus (family-név, egyezik a renderrel); hiányzó = rendszer-alap */
  fontFamily?: string;
  /** dőlt (a beépített fontoknak nincs dőlt változata, ezért döntött betűkép) */
  fontStyle?: 'normal' | 'italic';
  /** sorok igazítása a szövegdobozon belül; hiányzó = közép */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  /** szövegdoboz szélessége a vászon törtjében: ebbe tördel; hiányzó = a szöveg saját szélessége */
  boxWidth?: number;
  /** középpont, 0–1 normalizálva */
  position: { x: number; y: number };
  /**
   * 🔄 Forgatás fokban a KÖZÉPPONT körül (hiányzó = 0). A KÉP-STÚDIÓ szöveg-réteg
   * forgatása használja; az előnézet a szöveg-blokk wrap-transformjával, a kép-doc
   * render a szöveg-PNG elforgatásával érvényesíti.
   */
  rotation?: number;
  /** 🔁 tükrözés (kép-stúdió): vízszintes / függőleges */
  flipH?: boolean;
  flipV?: boolean;
  animation: TextAnimation;
  /** hiányzó érték = 'plain' (régebbi mentett projektek) */
  stylePreset?: TextStylePreset;
  /** követés/animált pozíció: x/y csatornák felülírják a position-t (P0‑6) */
  keyframes?: ClipKeyframes;
  /** 3D megjelenés (extrúzió + döntés + anyag) — felülírja a stylePreset-et */
  text3d?: Text3D;
  /**
   * ✨ Caption Studio: a kiemelt szavak indexei (whitespace-szerinti bontásban)
   * — a kiemelt szó nagyobb, félkövér és accent-színű, előnézetben és
   * renderben is (karaoke-val kombinálva a kiemelés marad a nyerő).
   */
  emphasis?: number[];
  /**
   * 🎤 Szó-szintű karaoke-időzítés: szavanként {t, d} a klip elejéhez képest.
   * A Whisper szó-átiratából igazítva — hiányában a karaoke a klip hosszát
   * osztja el egyenletesen (a régi viselkedés).
   */
  wordTimings?: { t: number; d: number }[];
  // ── Pro tipográfia (motion graphics) ───────────────────────────────────
  /** 🔡 Betűköz (tracking): em-arány, pl. 0.1 = +10%. Renderben `letter-spacing`. */
  letterSpacing?: number;
  /** 📏 Sorköz (leading): szorzó, 1 = szoros … 2 = laza. Renderben `line-height`. */
  lineHeight?: number;
  /** ↕️ Alapvonal-eltolás (baseline shift): em-arány, + = felfelé. */
  baselineShift?: number;
  /** 🔠 Kerning (betűpár-illesztés) ki/be — renderben `font-kerning`. Hiányzó = be. */
  kerning?: boolean;
  /** 🎨 Granuláris szöveg-stílus (a `stylePreset` FÖLÉ rétegződik). */
  textStyle?: TextStyle;
  /**
   * 🎬 Kinetic typography: per-karakter/szó/sor animáció. Ha van, FELÜLÍRJA az
   * egyszerű `animation`-t — a render per-frame Chromium-szekvenciát éget
   * (`renderTextSequence`), az előnézet a lejátszófejből közelít.
   */
  textMotion?: TextMotion;
  /**
   * 🛤️ Szöveg görbe mentén (text path): a betűk egy ív/völgy/hullám/kör mentén
   * futnak. A render SVG `textPath`-tal égeti be; az előnézet laposan közelít.
   */
  textPath?: TextPath;
  /**
   * 🪟 Szöveg-maszk (mask text / „videó a betűkben"): a szöveg alakja ABLAK az
   * alatta lévő kompozitra — a betűkben az éles videó látszik, körülötte a
   * kompozit elmosott + sötétített változata. Csak a klip idővonal-ablakában.
   * A renderben `alphaextract` + `pad` + `alphamerge` + `overlay`.
   */
  maskReveal?: boolean;
}

/** 🛤️ Görbe, amely mentén a szöveg fut. `curve` = görbület/amplitúdó (0…1). */
export interface TextPath {
  shape: 'arc' | 'valley' | 'wave' | 'circle';
  curve: number;
}

/** Kinetic typography preset (a mozgás jellege egységenként). */
export type TextMotionPreset =
  | 'reveal' // beúszás + emelkedés
  | 'popIn' // rugós pop (túllövéssel)
  | 'slideIn' // becsúszás oldalról
  | 'typeOn' // egységenkénti megjelenés (általánosított gépelés)
  | 'wave' // hullámzás (folyamatos, kinetic)
  | 'bounce'; // pattanó beérkezés

/**
 * 🎬 Kinetic typography konfiguráció. A `by` az animáció EGYSÉGE (karakter/szó/
 * sor), a `stagger` az egységenkénti késleltetés (mp), a `dur` egy egység
 * animáció-hossza (mp). A `wave` folyamatos (loop), a többi beérkező (egyszeri,
 * majd a szöveg állva marad).
 */
export interface TextMotion {
  preset: TextMotionPreset;
  by: 'char' | 'word' | 'line';
  /** egységenkénti késleltetés (mp), pl. 0.05 */
  stagger?: number;
  /** egy egység animáció-hossza (mp), pl. 0.4 */
  dur?: number;
}

/**
 * 🎨 Granuláris szöveg-stílus (motion graphics) — bármelyik mező opcionális, és
 * a `stylePreset` FÖLÉ rétegződik (ha van, felülírja a preset adott aspektusát).
 * A render CSS-ben égeti be (gradient text = background-clip:text; stroke =
 * -webkit-text-stroke; shadow/glow = text-shadow; background = doboz). Az
 * előnézet közelít (RN Text-korlátok: a gradient/stroke a renderben pontos).
 */
export interface TextStyle {
  /** szöveg-kitöltő gradiens (a `color` helyett) */
  gradient?: { from: string; to: string; angle?: number };
  /** kontúr: szín + vastagság az em arányában (0…0.2) */
  stroke?: { color: string; width: number };
  /** vetett árnyék: szín + eltolás (em) + életlenség (em) */
  shadow?: { color: string; dx: number; dy: number; blur: number };
  /** külső ragyogás: szín + méret az em arányában (0…1) */
  glow?: { color: string; size: number; /** csak a vászon: egyrétegű (a réteg `outerGlow`-jából — a szerver sziluett-ragyogása egy réteg) */ single?: boolean };
  /** háttér-doboz: szín + padding (em) + lekerekítés (em) */
  background?: { color: string; padding: number; radius: number };
}

/**
 * Forma-réteg (Creative Canvas): vektoros grafikai elem az overlay sávon.
 * Az előnézet natívan rajzolja, a render a Chromium-raszter útvonalon égeti be
 * — a kettő vizuálisan egyezik.
 */
/** 🌈 Gradient-stop: szín + pozíció (0…1). */
export interface GradientStop {
  color: string;
  at: number;
}

/**
 * 🌈 Fejlett gradient (Shape / ImageDoc): multi-stop, lineáris / radiális /
 * konikus. Az `angle` a lineáris/konikus szög (CSS-konvenció, fok); a `stops`
 * legalább 2, `at` szerint növekvő.
 */
export interface ShapeGradient {
  type: 'linear' | 'radial' | 'conic';
  angle?: number;
  stops: GradientStop[];
}

/** 🧩 Geometrikus csempe-minta preset-jei (forma-kitöltés). */
export type PatternPreset = 'dots' | 'grid' | 'stripes' | 'checker';

/**
 * 🧩 Forma-minta (shape pattern) — ismétlődő geometrikus kitöltés. A `size` a
 * doboz MAGASSÁGÁNAK %-a (felbontás-független). A render-parity magja a
 * [shapePattern](../lib/shapePattern.ts) (itt él a típus a körkörös import ellen,
 * az `AdjustmentLayer` mintájára). Ha van, FELÜLÍRJA a sima `fill`-t.
 */
export interface ShapePattern {
  preset: PatternPreset;
  fg: string;
  bg?: string;
  size: number;
  rotation?: number;
  opacity?: number;
}

/**
 * ✏️ Path-horgonypont (Bézier). `x`/`y` a horgony (0…1 a klip-dobozban); `h1` a
 * BEJÖVŐ, `h2` a KIMENŐ Bézier-fogó abszolút normalizált pozíciója (nem relatív).
 * Fogók nélkül a szegmens egyenes.
 */
export interface PathPoint {
  x: number;
  y: number;
  h1?: { x: number; y: number };
  h2?: { x: number; y: number };
}

/**
 * 🎞️ Path-animáció. `drawOn`: a stroke a klip elején megrajzolódik (`dur` mp),
 * majd áll; `morph`: a `points` a `dur` alatt átinterpolál a `to` alakba (a
 * kettőt egyenlő pontszámra újramintázzuk).
 */
export interface PathAnim {
  mode: 'drawOn' | 'morph';
  /** időtartam (mp) */
  dur: number;
  /** morph-célalak (path-pontok, a klip dobozához normalizálva) — csak `morph` */
  to?: PathPoint[];
}

export interface ShapeClip extends ClipBase {
  kind: 'shape';
  shape: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'star' | 'polygon' | 'path';
  /** sokszög oldalszáma (3–12) */
  sides?: number;
  /** csillag ágainak száma (3–12); hiányzó = az alap ötágú */
  starPoints?: number;
  /** csillag belső sugara a külsőhöz képest (0,1–0,9) */
  innerRadius?: number;
  /** középpont, 0–1 normalizálva */
  position: { x: number; y: number };
  /** méret a vászon arányában (0–1) */
  w: number;
  h: number;
  /**
   * 🔄 Forgatás fokban a KÖZÉPPONT körül (hiányzó = 0). A KÉP-STÚDIÓ réteg-
   * forgatása használja (a videó-klip a `transform.rotation`-t); az előnézet a
   * wrap-transformmal, a kép-doc render a forma-PNG elforgatásával érvényesíti.
   */
  rotation?: number;
  /** 🔁 tükrözés (kép-stúdió): vízszintes / függőleges — a forgatás ELŐTT (helyi tér) */
  flipH?: boolean;
  flipV?: boolean;
  /** kitöltő szín (hex) — gradiens esetén a tartalék */
  fill: string;
  /**
   * ✏️ Path (`shape: 'path'`) horgonypontjai — a klip SAJÁT dobozához
   * normalizálva (0–1). Bézier-fogók nélkül egyenes (polyline); `h1`/`h2`
   * fogókkal köbös Bézier-görbe. Nyitott path = `strokeWidth` vonal a `fill`
   * színével; `closed` path = kitöltött forma (fill/gradient) + opcionális kontúr.
   */
  points?: PathPoint[];
  /** zárt path (kitöltött forma) — a toll-eszköz zárt sokszöge/görbéje */
  closed?: boolean;
  /**
   * 🔗 Összetett path (boolean-művelet eredménye): több zárt al-path egy
   * formában, `fillRule` szerint kitöltve. Ha van, a `points` helyett ezt
   * rajzoljuk. A boolean teljes vászon-térben dolgozik → a shape `w=h=1`.
   */
  subpaths?: PathPoint[][];
  /** kitöltési szabály az összetett path-hoz (union=nonzero, exclude=evenodd) */
  fillRule?: 'nonzero' | 'evenodd';
  /**
   * 🎞️ Path-animáció: `drawOn` = a vonal „megrajzolja magát" (stroke-reveal +
   * kitöltés-beúszás); `morph` = a `points` átalakul a `to` alakba. A render
   * per-frame Chromium-képsort éget; az előnézet a lejátszófejből közelít.
   */
  pathAnim?: PathAnim;
  /** a vonal vastagsága a vászon MAGASSÁGÁNAK %-ában */
  strokeWidth?: number;
  /** ✂️ szaggatás: a kötőjel + rés hossza a vonalvastagság arányában (0/hiányzó = folytonos) */
  strokeDash?: number;
  /** vonalvég (path): 'round' (alap) | 'butt' | 'square' */
  strokeCap?: 'butt' | 'round' | 'square';
  /** vonal-illesztés (path/kontúr): 'round' (alap) | 'miter' | 'bevel' */
  strokeJoin?: 'miter' | 'round' | 'bevel';
  /** két-színű lineáris gradiens (135°) — LEGACY; új: `gradient` */
  fillGradient?: { from: string; to: string };
  /**
   * 🌈 Fejlett gradient-kitöltés (multi-stop lineáris / radiális / konikus). Ha
   * van, FELÜLÍRJA a `fillGradient`-et és a `fill`-t. A renderben CSS/SVG
   * gradient, az előnézetben expo-linear-gradient (lineáris) / react-native-svg
   * (radiális); a konikus a renderben pontos, előnézetben közelít.
   */
  gradient?: ShapeGradient;
  /** kép-kitöltés (logó/watermark, PNG/JPG/SVG) — felülírja a fill/gradienst */
  imageUri?: string;
  /**
   * 🧩 Geometrikus csempe-minta (pöttyök/rács/csíkok/sakktábla). Ha van,
   * FELÜLÍRJA a sima `fill`-t. Render-parity: a worker az SVG `<pattern>`
   * stringet, az előnézet UGYANAZOKAT a primitíveket (react-native-svg) rajzolja.
   */
  pattern?: ShapePattern;
  /** blend-mód a alatta lévő rétegekkel (hiányzó = normál rárakás) */
  blendMode?: BlendMode;
  borderColor?: string;
  /** a vászon magasságának %-ában (0–2) */
  borderWidth?: number;
  /** 🖊️ S18: a körvonal igazítása (hiányzó = a régi: téglalap/ellipszis belül, sokszög kívül, görbe középen) */
  borderAlign?: 'inside' | 'center' | 'outside';
  /** lekerekítés a rövidebb oldal arányában (0–0.5; ellipszisnél nem számít) */
  cornerRadius?: number;
  /** 0–1 (hiányzó = 1) */
  opacity?: number;
  /** lágy vetett árnyék — a renderben a forma sziluettjét követi */
  shadow?: boolean;
  /**
   * ✨ Külső ragyogás. A `size` a vászon MAGASSÁGÁNAK %-a. A renderben
   * egymásra fűzött, eltolás nélküli drop-shadow-k adják — így a sziluettet
   * követi, és a clip-path-os formákon (nyíl/csillag) meg a kép-kitöltésű
   * logókon is működik, ahol a `border` nem.
   */
  glow?: { color: string; size: number };
  /**
   * 🖊️ Sziluett-kontúr. A `width` a vászon MAGASSÁGÁNAK %-a. A `borderWidth`
   * csak téglalapon/ellipszisen jó (a clip-path levágná) — ez viszont bármilyen
   * alakzatot és kép-kitöltést körberajzol.
   */
  outline?: { color: string; width: number };
  /**
   * 🎯 Animált pozíció/méret: x/y (0–1) + scale csatornák — a forma (és a
   * shape-alapú 3D-matrica) így követhet egy objektumot / animálható. A render
   * a szöveg-overlay-el KÖZÖS keyframe-úton kezeli (kfChannelExpr a position-re).
   */
  keyframes?: ClipKeyframes;
}
