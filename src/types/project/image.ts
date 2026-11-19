import type { PhotoDevelop } from '@/lib/photoDevelop';
import type { PixelArt } from '@/lib/pixelArt';
import type { BlendMode, ClipAdjust, ClipMask } from './clipBase';
import type { AspectRatio, FilterId } from './common';
import type { ShapeClip, ShapeGradient, TextClip } from './graphicClips';
import type { GradeId } from './timeline';

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
  /** zárolt réteg: nem mozdítható, nem méretezhető, nem törölhető */
  locked?: boolean;
  /** 0–1 (hiányzó = 1) */
  opacity?: number;
  /** 🎨 keverési mód az ALATTA lévő rétegekkel (multiply/screen/overlay/…). Hiányzó = normál
   *  (source-over). A render (`/imagedoc`) ffmpeg `blend`-del, a réteg alfájával maszkolva égeti be. */
  blendMode?: BlendMode;
  /** 🎭 lineáris gradient-maszk: a réteg a megadott irányba FOKOZATOSAN átlátszóvá fade-el
   *  (pl. 'right' = bal átlátszatlan → jobb átlátszó). A render geq alfa-rámpával égeti. */
  maskGradient?: MaskGradientDir;
  /** 🌑 vetett árnyék (bármely pozícionált rétegre: fotó/forma/szöveg) — a render a réteg
   *  elmosott, eltolt sziluettjét teszi MÖGÉ. `true` = alap szép paraméterek; objektum = egyedi
   *  (color + dx/dy eltolás + blur a vászon törtje + opacity 0–1). */
  dropShadow?: boolean | { color?: string; dx?: number; dy?: number; blur?: number; opacity?: number };
  /** ✨ külső ragyogás (neon-halo) — a réteg paddelt, elmosott, színes sziluettje MÖGÉ.
   *  (Nem keverendő a forma `glow` mezőjével, ami a forma körvonalára hat.) `true` = alap accent-glow;
   *  objektum = egyedi (color + size a vászon törtje + opacity 0–1). */
  outerGlow?: boolean | { color?: string; size?: number; opacity?: number };
  /** 🖊️ kontúr/körvonal (bármely pozícionált rétegre): a réteg színezett, N px-rel megnövelt
   *  sziluettje MÖGÉ — keretként jelenik meg. `width` a vászonszélesség törtje (0–~0.05). */
  stroke?: { color: string; width: number };
  /** 🎨 színátfedés (IMAGE-PROD S13 · DS5): a réteg a saját alakján belül egy színnel átfestve (0–1 erővel) */
  colorOverlay?: { color: string; opacity?: number };
  /** 🌘 belső árnyék: a réteg szélén BELÜL, eltolva (dx/dy/blur a vászon törtje, mint a vetett árnyéknál) */
  innerShadow?: { color?: string; dx?: number; dy?: number; blur?: number; opacity?: number };
  /** 🌕 belső ragyogás: a réteg szélén belül, minden irányban (size a vászonszélesség törtje) */
  innerGlow?: { color?: string; size?: number; opacity?: number };
  /** 🗂️ csoport-tagság: a réteg EHHEZ a `ImageGroup`-hoz tartozik (lapos modell — a rajzolási
   *  sorrend a `layers` tömbé marad; az azonos groupId-jú rétegeket a panel egy mappába fogja). */
  groupId?: string;
}

/**
 * 🗂️ Réteg-csoport (mappa) — a KÉP-dokumentum lapos `groups` listájában él; a hozzá tartozó
 * rétegeket a `layer.groupId` köti be. A csoport közös `hidden`/`opacity`-t ad (a render és a
 * preview a tag-rétegekre alkalmazza), és panel-szinten összecsukható. NINCS beágyazás (v1 lapos).
 */
export interface ImageGroup {
  id: string;
  name: string;
  /** a csoport összes tagja rejtve (a render kihagyja) */
  hidden?: boolean;
  /** a panelben összecsukva (a tagok nem látszanak a listában) */
  collapsed?: boolean;
  /** 0–1 közös áttetszőség — a tag-rétegek saját opacity-jére RÁszorzódik (render + preview) */
  opacity?: number;
  /** 🗂️ S18: a szülő-csoport (beágyazás); a rejtettség és az áttetszőség végigöröklődik a láncon */
  parentId?: string;
}

/** A gradient-maszk fade-irány (amerre a réteg átlátszóvá válik). */
export type MaskGradientDir = 'left' | 'right' | 'up' | 'down';

/** háttér-réteg: tömör szín vagy gradiens, a teljes vásznon */
export interface FillLayer extends ImageLayerBase {
  kind: 'fill';
  fill: string;
  fillGradient?: { from: string; to: string };
  /** 🌈 fejlett gradient (multi-stop lineáris / radiális / konikus) — felülírja a fillGradient-et */
  gradient?: ShapeGradient;
}

/** 🎚️ non-destruktív korrekciós-verem (adjustment layers) fajtái */
export type AdjustmentKind =
  | 'exposure'
  | 'contrast'
  | 'whiteBalance'
  | 'saturation'
  | 'vibrance'
  | 'hsl'
  | 'curves'
  | 'colorBalance'
  | 'vignette'
  | 'lut'
  | 'custom';

/** egy korrekciós réteg a veremben (a mag: `src/lib/adjustmentStack.ts`) */
export interface AdjustmentLayer {
  id: string;
  kind: AdjustmentKind;
  name: string;
  /** ki/be — a kikapcsolt megmarad, de nem hat (non-destruktív) */
  enabled: boolean;
  /** 0…1 erősség (a hatás skálázása) */
  amount: number;
  /** a korrekció paraméterei (a ClipAdjust mezők részhalmaza) */
  adjust: ClipAdjust;
}

/** fotó-réteg: a kép + a videóból ismert képjavítás/szűrő/maszk */
/** 🔲 Rács: a méret dokumentum-pixelben. */
export interface ImageGrid {
  size: number;
  show: boolean;
  snap: boolean;
}

/** 🎨 Színsávok a színenkénti HSL-hez; mindhárom érték −1…1. */
export type HslBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export type HslBands = Partial<Record<HslBand, { h?: number; s?: number; l?: number }>>;

export interface PhotoLayer extends ImageLayerBase {
  kind: 'photo';
  uri: string;
  /**
   * 🧩 sablon média-helyőrzője (IMAGE-PROD S9 · DS1): még nincs kép (`uri` üres) — a vásznon
   * szaggatott keret, koppintásra a galéria; a kész képből (export, render) kimarad
   */
  placeholder?: boolean;
  /** 🖌️ ecsettel festett réteg: újra megnyitható, a radír is rajta dolgozik */
  paint?: boolean;
  /** 👾 pixel art: a szerkeszthető rács; a `uri` ennek az első kockája */
  pixelArt?: PixelArt;
  /** 🎨 színenkénti HSL */
  hsl?: HslBands;
  assetId?: string;
  /** középpont, 0–1 normalizálva */
  position: { x: number; y: number };
  w: number;
  h: number;
  rotation?: number;
  /** 🔁 tükrözés (kép-stúdió): vízszintes / függőleges */
  flipH?: boolean;
  flipV?: boolean;
  /** 'cover' kitölti a keretet (vág), 'contain' belefér (üres szél marad),
   *  'stretch' nem-arányosan a keretre nyújt (szabad transzform — torzíthat) */
  fit?: 'cover' | 'contain' | 'stretch';
  /** 📐 perspektíva/3D-dőlés −1…1: X>0 a jobb él dől hátra (X<0 bal), Y>0 az alsó él (Y<0 felső).
   *  A render ffmpeg `perspective`-vel (átlátszó OOB), a preview 3D rotate-tel közelít. */
  perspectiveX?: number;
  perspectiveY?: number;
  filterId?: FilterId;
  filterIntensity?: number;
  /** 🎬 filmes look-preset (LUT-szerű grade) a fotóra — a videó grade-rétegével AZONOS térkép
   *  (`server/grades.js`); a render split-tone eq+colorbalance láncot éget a korrekció UTÁN */
  grade?: GradeId;
  /** 🎞️ saját 3D LUT (.cube) a fotóra — szerkesztő-local fájl-uri; a render feltölti és `lut3d`-del
   *  égeti be (a grade UTÁN). A kliens `parseCubeLut` validál import-kor. */
  lut?: string;
  /** a `lut` emberi neve a UI-nak (pl. a fájlnév) */
  lutName?: string;
  /** 🎨 gradient-map (egyedi-színű duotone): a luminanciát a `shadow`→`highlight` szín közötti
   *  átmenetre képezi (sötét→shadow, világos→highlight). A render geq-vel égeti (a grade/lut UTÁN). */
  gradientMap?: { shadow: string; highlight: string };
  /** 🎛️ struktúra-szűrő verem (blur/sharpen/zaj/szürke/szépia) — a renderben (ffmpeg), a korrekció UTÁN */
  filters?: ImageFilter[];
  /** a render-input EGYETLEN korrekciója (a verem ebbe laposodik — `flattenAdjustments`) */
  adjust?: ClipAdjust;
  /** 🎚️ non-destruktív korrekciós-verem (az UI forrás-igazsága; → `adjust`) */
  adjustmentStack?: AdjustmentLayer[];
  /**
   * 📸 RAW-develop (S-PHOTO): non-destruktív fotó-előhívás a fájl mellett — tónus/szín
   * (base: `ClipAdjust`) + RAW-detail (clarity/texture/dehaze/élesítés/zaj/CA/torzítás).
   * A render a `developToFilterPlan` lépéseit a korrekció-lánc UTÁN égeti be
   * (`@/lib/photoDevelop` + `server/imagedoc.js` `developFilterPlan` — contract-locked).
   * Hiányzó / neutrális = nincs hatás (a `adjust`/`adjustmentStack` mellett, additív).
   */
  develop?: PhotoDevelop;
  /**
   * ✂️ S18: vágómaszk — a fotó csak az ALATTA lévő forma-réteg (ennek az id-je) alakján belül látszik.
   * Élő kapcsolat: a forma mozgatása/átalakítása a vágást is viszi. A render előtt `resolveClipMasks`
   * (`imageClip.ts`) a forma körvonalából maszkot képez — a vászon és a szerver ugyanazt kapja.
   */
  clipTo?: string;
  /** 📐 S18: kiegyenesítés — a tartalom elforgatása a dobozon belül (fok, −45…45), üres sarok nélkül */
  straighten?: number;
  /** 🔲 S18: 4-sarkos perspektíva — a doboz sarkai (bal felső, jobb felső, jobb alsó, bal alsó; 0–1) */
  corners?: { x: number; y: number }[];
  mask?: ClipMask;
  /** 🎯 kijelölés-alapú (lokális) korrekció: a `grade`/`adjust` CSAK a `mask` régión BELÜL hat,
   *  kívül az eredeti marad (a render `maskedmerge`-del keveri). A `mask` vászon-normalizált — a worker
   *  a réteg dobozába transzformálja. Független a vágó `mask`-tól. */
  localAdjust?: { mask: ClipMask; adjust?: ClipAdjust; grade?: GradeId };
  /** 🩹 folt-javítás / objektum-eltávolítás: doboz-lokális (0–1) téglalapok, amiket a render a
   *  környezetükből interpolálva eltüntet (ffmpeg `delogo`). A felhasználó lasszóval jelöli (bbox). */
  heal?: { x: number; y: number; w: number; h: number }[];
  /** 📊 szintek (levels): fekete-pont (0–0.9) / fehér-pont (…–1) / gamma (0.1–5). A render
   *  `lutrgb`-vel remapeli: out = clip((val−black)/(white−black),0,1)^(1/gamma). Identitás = nincs hatás. */
  levels?: { black: number; white: number; gamma: number };
  /** 🎨 csatorna-mixer: minden KIMENETI csatorna a bemenetek lineáris kombinációja (3×3 együttható).
   *  A render `colorchannelmixer`-rel égeti; identitás (rr=gg=bb=1, többi 0) = nincs hatás. */
  channelMix?: { rr?: number; rg?: number; rb?: number; gr?: number; gg?: number; gb?: number; br?: number; bg?: number; bb?: number };
}

/** 🎛️ Kép-struktúra-szűrő (a foto-réteg renderében). Az `amount` 0–1 (erősség).
 *  `clarity`/`dehaze` a RAW-develop fő eszközei (lokális ill. globális kontraszt). */
export type ImageFilterType =
  | 'blur'
  | 'sharpen'
  | 'noise'
  | 'grayscale'
  | 'sepia'
  | 'clarity'
  | 'dehaze'
  | 'pixelate'
  | 'posterize'
  | 'duotone';
export interface ImageFilter {
  type: ImageFilterType;
  amount: number;
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

/**
 * 🎚️ Korrekció-réteg (adjustment layer) — nincs saját tartalma; az ALATTA lévő KOMPOZITRA
 * hat (CapCut/Photoshop-minta). A render a réteg rajzolási pozíciójánál alkalmazza a
 * `grade` presetet + `adjust` láncot az addig felépült képre; `mask` esetén csak a maszkolt
 * régióra. A preview tint-réteggel közelít a rajzolási sorrendben. NINCS position/w/h (teljes vászon).
 */
export type AdjustmentImageLayer = ImageLayerBase & {
  kind: 'adjust';
  grade?: GradeId;
  adjust?: ClipAdjust;
  /** 🎨 S17: színenkénti HSL az alatta lévő kompozitra (a lánc: grade → adjust → HSL) */
  hsl?: HslBands;
  mask?: ClipMask;
};

export type ImageLayer = FillLayer | PhotoLayer | ShapeLayer | TextLayer | AdjustmentImageLayer;

/** 📐 kézzel húzott segédvonal (szerkesztő-only) — szerkezetileg a rulers.ts `Guide` */
export interface ImageGuide {
  id: string;
  axis: 'x' | 'y';
  /** 0…1 normalizált pozíció a vásznon */
  pos: number;
}

export interface ImageDoc {
  id: string;
  name: string;
  /** ugyanaz az arány-készlet, mint a projekté */
  aspectRatio: AspectRatio;
  /** 🖼️ vászon pixel-mérete (opcionális; hiányzó = a renderer az aspectRatio +
   *  alap-felbontásból számol). Megadva EZ a mérvadó (szabad W×H, nem a 3 arány).
   *  A létrehozáskor a kép-editor „Új dokumentum” mezői töltik. */
  width?: number;
  height?: number;
  /** 🖼️ dokumentum-típus: 'raster' (PNG-kimenet) vagy 'vector' (SVG). Hiányzó = raster. */
  format?: 'raster' | 'vector';
  /** ALULRÓL FÖLFELÉ: a lista első eleme van leghátul */
  layers: ImageLayer[];
  /** 🗂️ réteg-csoportok (mappák) — a tagokat a `layer.groupId` köti be (lapos modell) */
  groups?: ImageGroup[];
  /** 📐 kézzel húzott segédvonalak (szerkesztő-only; a render NEM égeti be) */
  guides?: ImageGuide[];
  /** 🔲 rács (szerkesztő-only) */
  grid?: ImageGrid;
  /** 🎞️ dokumentum-szintű filmszemcse 0–1 (a TELJES kész képre; cinematic/retró finish). A render égeti. */
  grain?: number;
  /** 🔦 dokumentum-szintű vignetta 0–1 (a sarkokat sötétíti a teljes képen; cinematic). A render égeti. */
  vignette?: number;
  /** 🎬 dokumentum-szintű GLOBÁLIS filmes look-preset a TELJES kompozitra (a videó grade-térképe). A render égeti. */
  grade?: GradeId;
  /** 🎚️ dokumentum-szintű GLOBÁLIS korrekció (exposure/kontraszt/telítettség…) a TELJES kompozitra. A render égeti. */
  adjust?: ClipAdjust;
  /** a legutóbb kirasterizált PNG (cache; a réteg-fa az igazság) */
  renderedUri?: string;
  /** a `renderedUri` melyik tartalomból készült (`imageDocContentKey`) — elavulás-észlelés */
  renderedKey?: string;
  /** kis élő bélyegkép a lap-sávhoz / album-borítóhoz + a tartalom, amiből készült */
  thumbUri?: string;
  thumbKey?: string;
}
