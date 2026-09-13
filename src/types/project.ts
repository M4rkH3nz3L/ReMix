/**
 * A vided projekt-modell: Project → Track → Clip.
 * Minden idő másodpercben, minden pozíció/méret 0–1 közé normalizálva
 * (az előnézeti felület méretétől független).
 */

export type AspectRatio = '16:9' | '9:16' | '1:1';

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
  | 'sfx';

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

/**
 * Asset: a projekt által hivatkozott médiafájl. A projekt nem birtokolja a
 * nyers fájlt — hivatkozik rá; később provider-alapú (Drive/S3/…) elérés és
 * hash-alapú relink épül rá (full-plan F2).
 */
export interface Asset {
  id: string;
  kind: 'video' | 'image' | 'audio';
  /** aktuális elérés (helyi másolat vagy stream-URL) */
  uri: string;
  provider: 'local' | 'library' | 'remote';
  name?: string;
  /** mp — videó/hang esetén */
  duration?: number;
  width?: number;
  height?: number;
  /** relinkhez (F2) */
  hash?: string;
  size?: number;
}

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
  /** freeform maszk csúcsai (vászon-normalizált, min. 3) — polygon esetén */
  points?: { x: number; y: number }[];
  /** középpont, 0–1 */
  x: number;
  y: number;
  /** teljes szélesség/magasság, 0–1 */
  w: number;
  h: number;
  /** lágy szél (0–0.3, hiányzó = 0.05) */
  feather?: number;
  invert?: boolean;
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
}

/** Green screen (P0‑10): a kulcs-szín átlátszóvá válik a renderben. */
export interface ChromaKey {
  /** hex, pl. #00ff00 */
  color: string;
  /** tűrés 0.05–0.45 */
  similarity: number;
  /** él-lágyítás 0–0.3 (hiányzó = 0.05) */
  blend?: number;
}

/**
 * Keverési mód (blend): a réteg a mögötte lévő képpel keveredik (nem takar).
 * Az RN `mixBlendMode` ÉS az ffmpeg `blend=all_mode` is ismeri mindegyiket.
 */
export type BlendMode = 'multiply' | 'screen' | 'overlay' | 'difference' | 'lighten';

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

export interface VideoClip extends ClipBase {
  kind: 'video';
  /** a hivatkozott asset; az uri denormalizált gyorsítás */
  assetId?: string;
  uri: string;
  /** a forrásfájlon belüli kezdőpont (mp) */
  trimIn: number;
  /** a forrásfájl teljes hossza (mp) */
  sourceDuration: number;
  /** 0.1–10 */
  speed: number;
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
  /** Voice Studio: visszhang-csökkentés (szobahang) — a renderben */
  deReverb?: boolean;
  filterId: FilterId;
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
  filterId: FilterId;
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
}

/**
 * A kulcskocka easingje: az EBBŐL a kulcskockából induló átmenet görbéje.
 * A `bezier` egyéni köbös Bézier-görbe — a vezérpontokat a `Keyframe.bezier`
 * hordozza (CSS `cubic-bezier(x1,y1,x2,y2)` konvenció, végpontok 0,0 és 1,1).
 */
export type KeyframeEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier';

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
}

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
  /** középpont, 0–1 normalizálva */
  position: { x: number; y: number };
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
}

/**
 * Forma-réteg (Creative Canvas): vektoros grafikai elem az overlay sávon.
 * Az előnézet natívan rajzolja, a render a Chromium-raszter útvonalon égeti be
 * — a kettő vizuálisan egyezik.
 */
export interface ShapeClip extends ClipBase {
  kind: 'shape';
  shape: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'star' | 'path';
  /** középpont, 0–1 normalizálva */
  position: { x: number; y: number };
  /** méret a vászon arányában (0–1) */
  w: number;
  h: number;
  /** kitöltő szín (hex) — gradiens esetén a tartalék */
  fill: string;
  /**
   * ✏️ Szabadkézi vonal (`shape: 'path'`) pontjai — a klip SAJÁT dobozához
   * normalizálva (0–1), nem a vászonhoz. A vonal a `fill` színével és
   * `strokeWidth` vastagsággal rajzolódik; a `fill` itt vonalszín, nem kitöltés.
   */
  points?: { x: number; y: number }[];
  /** a vonal vastagsága a vászon MAGASSÁGÁNAK %-ában */
  strokeWidth?: number;
  /** két-színű lineáris gradiens (135°) */
  fillGradient?: { from: string; to: string };
  /** kép-kitöltés (logó/watermark, PNG/JPG/SVG) — felülírja a fill/gradienst */
  imageUri?: string;
  /** blend-mód a alatta lévő rétegekkel (hiányzó = normál rárakás) */
  blendMode?: BlendMode;
  borderColor?: string;
  /** a vászon magasságának %-ában (0–2) */
  borderWidth?: number;
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
}

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
  /** 3-sávos EQ erősítés dB-ben (-12…12); mind 0 = ki */
  eq?: { low: number; mid: number; high: number };
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
  /** visszhang-tér mértéke 0–1 (aecho) */
  reverb?: number;
  /** echo/delay mértéke 0–1 (aecho) */
  delay?: number;
}

export interface AudioClip extends ClipBase {
  kind: 'audio';
  /** a hivatkozott asset; az uri denormalizált gyorsítás */
  assetId?: string;
  uri: string;
  label: string;
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

/**
 * 🎨 KÉP-DOKUMENTUM (Creative Canvas V1) — a kép RÉTEG-FA, nem bitmap.
 *
 * Az elv: a rétegek szerkezetileg AZONOSAK a meglévő klipekkel (csak az
 * idő-mezők nélkül), így a worker ugyanazzal a Chromium-raszterrel rajzolja
 * őket, mint az idővonal formáit/feliratait — nem kell külön render-motor,
 * és amit a videóban látsz, azt látod a képben is.
 *
 * A dokumentum NEM destruktív: a kész PNG csak az eredmény, a réteg-fa
 * megmarad az asseten, így bármikor újraszerkeszthető. Ez a 2.5D
 * (mélység-rétegek) alapja is.
 */
export interface ImageLayerBase {
  id: string;
  /** a réteglistában megjelenő név (hiányzik → a tartalomból képezzük) */
  name?: string;
  /** kikapcsolt réteg: megmarad, de nem rajzolódik */
  hidden?: boolean;
  /** 0–1 (hiányzó = 1) */
  opacity?: number;
}

/** háttér-réteg: tömör szín vagy gradiens, a teljes vásznon */
export interface FillLayer extends ImageLayerBase {
  kind: 'fill';
  fill: string;
  fillGradient?: { from: string; to: string };
}

/** fotó-réteg: a kép + a videóból ismert képjavítás/szűrő/maszk */
export interface PhotoLayer extends ImageLayerBase {
  kind: 'photo';
  uri: string;
  assetId?: string;
  /** középpont, 0–1 normalizálva */
  position: { x: number; y: number };
  w: number;
  h: number;
  rotation?: number;
  /** 'cover' kitölti a keretet (vág), 'contain' belefér (üres szél marad) */
  fit?: 'cover' | 'contain';
  filterId?: FilterId;
  filterIntensity?: number;
  adjust?: ClipAdjust;
  mask?: ClipMask;
}

/** forma-réteg — a ShapeClip minden megjelenés-mezője, idő nélkül */
export type ShapeLayer = ImageLayerBase & { kind: 'shape' } & Omit<
  ShapeClip,
  'kind' | 'id' | 'start' | 'duration' | 'opacity'
>;

/** szöveg-réteg — a TextClip mezői, idő és animáció nélkül */
export type TextLayer = ImageLayerBase & { kind: 'text' } & Omit<
  TextClip,
  'kind' | 'id' | 'start' | 'duration' | 'animation' | 'keyframes'
>;

export type ImageLayer = FillLayer | PhotoLayer | ShapeLayer | TextLayer;

export interface ImageDoc {
  id: string;
  name: string;
  /** ugyanaz az arány-készlet, mint a projekté */
  aspectRatio: AspectRatio;
  /** ALULRÓL FÖLFELÉ: a lista első eleme van leghátul */
  layers: ImageLayer[];
  /** a legutóbb kirasterizált PNG (cache; a réteg-fa az igazság) */
  renderedUri?: string;
}

/**
 * 🔎 SEO / közzétételi meta — a felfedezéshez: a TikTok/Reels felirat + hashtag
 * és a YouTube cím/leírás/kulcsszavak. A projekt LÉTREHOZÁSAKOR kötelezően
 * kitöltött (lásd az „Új projekt” űrlapot a főképernyőn); a social `FeedPost`
 * (title/description/hashtags) egy-az-egyben erre képződik le. A hashtagek és a
 * kulcsszavak `#` nélkül, trimmelve, duplikátum-mentesen tárolódnak.
 */
export interface ProjectSeo {
  /** közzétételi cím (kulcsszavas; a `name`-től eltérhet) */
  title: string;
  /** leírás/felirat kulcsszavakkal */
  description: string;
  /** hashtagek `#` nélkül */
  hashtags: string[];
  /** kulcsszavak (YouTube-tagek) */
  keywords: string[];
}

/**
 * 🎞️ A projekt RENDERELT VÁLTOZATA — a kész MP4, a projekthez tárolva. A `uri`
 * a helyi, perzisztált fájl (azonnali lejátszás/újramegosztás); a `url` a
 * feltöltött publikus cím (a feed / cross-device lejátszáshoz). Újrarenderelésig
 * érvényes.
 */
export interface RenderedVersion {
  uri: string;
  url?: string;
  posterUri?: string;
  posterUrl?: string;
  renderedAt: string;
  durationSec: number;
  width?: number;
  height?: number;
}

export interface Project {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  /** 🔎 SEO / közzétételi meta (a létrehozáskor kötelező — lásd ProjectSeo) */
  seo?: ProjectSeo;
  /** 🎞️ a legutóbb renderelt kész MP4 (a projekthez tárolva; lásd RenderedVersion) */
  rendered?: RenderedVersion;
  tracks: Track[];
  /** a projekt által hivatkozott médiafájlok */
  assets: Asset[];
  /** ✨ render-oldali részecske-réteg (hiányzó = nincs) */
  particles?: ParticlesConfig;
  /** 🔖 szerkezeti jelölők az idővonalon */
  markers?: Marker[];
  /** 🏷️ névvel jelölt idő-tartományok (szervezés/navigáció; nem renderelődik) */
  regions?: TimelineRegion[];
  /** 🎬 story-struktúra fejezetek (Hook/Context/Value/CTA) — a videó „térképe" */
  chapters?: Chapter[];
  /** 🔀 remix-forrás: miből készült ez a projekt (duplikálás/remix). A lineage-
   *  lánc a szülő-hivatkozások (remixOf.projectId) mentén bejárható. */
  remixOf?: { projectId: string; name: string };
  /** 🔗 link-csoportok: az egy csoportban lévő klipek együtt mozognak (persisztált) */
  links?: string[][];
  /**
   * 🎨 Kép-dokumentumok (Creative Canvas): a projekthez tartozó réteg-fák.
   * A vászonra kirasterizált PNG-jük képklipként kerül az idővonalra, de a
   * réteg-fa itt marad — ezért bármikor újraszerkeszthető.
   */
  imageDocs?: ImageDoc[];
  createdAt: string;
  updatedAt: string;
  /** 1: assets nélkül · 2: asset-registry · 3: sáv-bővítés · 4: kulcskockák (a betöltés migrál) */
  schemaVersion: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  duration: number;
  clipCount: number;
  updatedAt: string;
}
