/**
 * 🧰 Eszköztár-spec — melyik eszköz legyen ELÖL (max 4) és melyik a „Több" alatt
 * (MOBILE-UI.md §6.4).
 *
 * MIÉRT: a kontextusfüggő eszköztárban kontextusonként 15–20 egyenrangú gomb volt
 * egy vízszintes görgetősorban; a gyakori művelet (vágás, sebesség) ugyanúgy
 * görgetés mögé kerülhetett, mint a ritka (pre-compose, stílus-másolás). Itt a
 * kontextus → (elsődleges, többi) leképezés pure adat:
 *
 *  • az ELSŐDLEGES lista rögzített prioritás (izommemória — a 4. hely sem adaptív);
 *  • a nem elérhető eszköz (pl. beillesztés üres vágólappal) kimarad, és a
 *    következő lép a helyére;
 *  • a „Kész" (kijelölés vége) és a „Törlés" KRÓM, nem számít bele a 4-be.
 *
 * Expo-mentes → önmagában tesztelhető.
 */

/** Klip-fajták (a `Clip['kind']` tükre — a mag nem függ a projekt-típusoktól). */
export type ToolClipKind = 'video' | 'image' | 'audio' | 'text' | 'shape' | 'adjust' | 'interactive';

export type ToolId =
  // — kijelölés nélkül (hozzáadás / projekt-szintű) —
  | 'addVideo'
  | 'addImage'
  | 'addText'
  | 'music'
  | 'captions'
  | 'transcript'
  | 'sticker'
  | 'addPip'
  | 'record'
  | 'source'
  | 'multicam'
  | 'addGrade'
  | 'imagedoc'
  | 'library'
  | 'addHotspot'
  | 'assistant'
  | 'creatorPreset'
  | 'workflow'
  | 'help'
  // — kijelölt klip —
  | 'split'
  | 'speed'
  | 'filter'
  | 'transition'
  | 'pip'
  | 'frameCapture'
  | 'text'
  | 'shape'
  | 'grade'
  | 'mix'
  | 'action'
  | 'precision'
  | 'duplicate'
  | 'copyClip'
  | 'cutClip'
  | 'pasteClip'
  | 'copyStyle'
  | 'pasteStyle'
  | 'moveTrack'
  | 'multiSelect'
  | 'ripple'
  | 'link'
  | 'precompose'
  | 'unlink';

/**
 * 🎚️ Szerkesztési mód (PRO-VIDEO-EDITOR D5): Gyors = csak a leggyakoribb műveletek
 * (kezdőknek, gyors vágás), Haladó = minden eszköz (az eddigi eszköztár), AI = az
 * AI-munkafolyamatok elöl. A klip-kijelölés eszközei Gyors módban rövidülnek.
 */
export type EditMode = 'quick' | 'advanced' | 'ai';
export const EDIT_MODES: readonly EditMode[] = ['quick', 'advanced', 'ai'];

export interface ToolContext {
  /** a szerkesztési mód; hiányzó = haladó (a teljes eszköztár) */
  mode?: EditMode;
  /** a kijelölt klip fajtája; null = nincs kijelölés */
  selectionKind: ToolClipKind | null;
  /** multi-kijelölés mód aktív ÉS van legalább egy további kijelölt klip */
  multi: boolean;
  /** a kijelölt klip a PiP-sávon van */
  onPipTrack: boolean;
  /** linkelt csoport tagja */
  linked: boolean;
  hasClipClipboard: boolean;
  /** stílus-vágólap van és a fajta egyezik */
  canPasteStyle: boolean;
  /** több kompatibilis sáv van a fajtához */
  canMoveTrack: boolean;
}

export interface ToolbarLayout {
  primary: ToolId[];
  overflow: ToolId[];
}

export const MAX_PRIMARY_TOOLS = 4;

/** Kijelölés nélkül: a leggyakoribb hozzáadás-műveletek elöl. */
const IDLE_ORDER: ToolId[] = [
  'addVideo',
  'addText',
  'music',
  'captions',
  // — Több —
  'addImage',
  'addPip',
  'record',
  'source',
  'sticker',
  'transcript',
  'addGrade',
  'imagedoc',
  'library',
  'multicam',
  'addHotspot',
  'assistant',
  'creatorPreset',
  'workflow',
  'help',
];

/** Gyors mód, kijelölés nélkül: a hozzáadás alapjai. */
const QUICK_IDLE: ToolId[] = ['addVideo', 'addText', 'music', 'captions', 'addImage', 'sticker', 'record', 'source', 'help'];

/** AI mód, kijelölés nélkül: az AI-munkafolyamatok elöl, utánuk a hozzáadás alapjai. */
const AI_IDLE: ToolId[] = [
  'assistant',
  'captions',
  'transcript',
  'workflow',
  'creatorPreset',
  'addVideo',
  'addText',
  'music',
  'help',
];

/** Gyors mód, kijelölt klip: a fajta elsődlegesein túl csak a legalapvetőbb műveletek. */
const QUICK_SELECTED: ToolId[] = ['duplicate', 'copyClip', 'pasteClip'];

/** Fajtánként az elsődleges eszközök (prioritási sorrendben). */
const KIND_PRIMARY: Record<ToolClipKind, ToolId[]> = {
  video: ['split', 'speed', 'filter', 'transition'],
  image: ['split', 'filter', 'transition', 'duplicate'],
  text: ['text', 'split', 'duplicate', 'precision'],
  audio: ['split', 'mix', 'duplicate', 'precision'],
  shape: ['shape', 'split', 'duplicate', 'precision'],
  adjust: ['grade', 'split', 'duplicate', 'precision'],
  interactive: ['action', 'split', 'duplicate', 'precision'],
};

/** Fajta-specifikus, de nem elsődleges eszközök. */
const KIND_EXTRA: Partial<Record<ToolClipKind, ToolId[]>> = {
  video: ['pip', 'frameCapture'],
  image: ['pip'],
};

/** Minden kijelölt klipre közös másodlagos eszközök (a „Több" sorrendje). */
const COMMON_SELECTED: ToolId[] = [
  'duplicate',
  'precision',
  'copyClip',
  'cutClip',
  'pasteClip',
  'copyStyle',
  'pasteStyle',
  'moveTrack',
  'unlink',
  'multiSelect',
  'ripple',
];

/** Multi-kijelölésnél ezek kerülnek előre. */
const MULTI_PRIMARY: ToolId[] = ['link', 'precompose', 'duplicate', 'pasteStyle', 'copyClip'];

/** Elérhető-e az eszköz a kontextusban? (ugyanazok a feltételek, mint a Toolbar JSX-ében) */
export function isToolAvailable(tool: ToolId, ctx: ToolContext): boolean {
  const k = ctx.selectionKind;
  switch (tool) {
    case 'split':
      return k !== null && !ctx.multi;
    case 'link':
    case 'precompose':
      return ctx.multi;
    case 'unlink':
      return ctx.linked;
    case 'pasteClip':
      return ctx.hasClipClipboard;
    case 'pasteStyle':
      return ctx.canPasteStyle;
    case 'moveTrack':
      return ctx.canMoveTrack;
    case 'pip':
      return (k === 'video' || k === 'image') && ctx.onPipTrack;
    case 'frameCapture':
    case 'speed':
      return k === 'video';
    case 'filter':
    case 'transition':
      return k === 'video' || k === 'image';
    case 'text':
      return k === 'text';
    case 'shape':
      return k === 'shape';
    case 'grade':
      return k === 'adjust';
    case 'mix':
      return k === 'audio';
    case 'action':
      return k === 'interactive';
    default:
      return true;
  }
}

const unique = (ids: ToolId[]) => [...new Set(ids)];

/** A kontextus eszköztára: max 4 elsődleges + a többi a „Több" alatt. */
export function toolbarFor(ctx: ToolContext): ToolbarLayout {
  const kind = ctx.selectionKind;
  let ordered: ToolId[];
  if (kind === null) {
    ordered = ctx.mode === 'quick' ? QUICK_IDLE : ctx.mode === 'ai' ? AI_IDLE : IDLE_ORDER;
  } else if (ctx.mode === 'quick') {
    const head = ctx.multi ? MULTI_PRIMARY : KIND_PRIMARY[kind];
    ordered = unique([...head, ...KIND_PRIMARY[kind], ...QUICK_SELECTED]);
  } else {
    const head = ctx.multi ? MULTI_PRIMARY : KIND_PRIMARY[kind];
    ordered = unique([...head, ...KIND_PRIMARY[kind], ...(KIND_EXTRA[kind] ?? []), ...COMMON_SELECTED]);
  }
  const available = ordered.filter((tool) => isToolAvailable(tool, ctx));
  return {
    primary: available.slice(0, MAX_PRIMARY_TOOLS),
    overflow: available.slice(MAX_PRIMARY_TOOLS),
  };
}
