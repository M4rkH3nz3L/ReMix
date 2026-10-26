/**
 * 🗂️ Panel-regiszter — melyik szerkesztő-felület milyen SZINTEN nyílik
 * (MOBILE-UI.md §5). A panel-viselkedés ADAT, nem szétszórt JSX-feltétel.
 *
 *  • `strip` — gyors beállítás az eszköztár helyén (élő eredmény, nincs scrim);
 *              a „Részletek" ugyanazt a panelt `sheet`-szinten nyitja.
 *  • `sheet` — nem-modális, detentes alsó lap; a vászon újraméreteződik.
 *  • `focus` — precíziós mód: a vászon kapja a teljes helyet.
 *  • `workspace` — önálló, teljes képernyős szerkesztő-mód (piano roll, dobgép).
 *
 * `modal: true` = NEM-élő feladat (export, forrásválasztó) → ott a scrim + Modal
 * rendben van, mert a felhasználó nem a vásznat nézi közben.
 *
 * Expo-mentes; a stúdiók csak típus-szinten hivatkoznak ide.
 */
import type { Detent } from '@/lib/panelLayout';

export type PanelTier = 'strip' | 'sheet' | 'focus' | 'workspace';

export interface PanelSpec {
  tier: PanelTier;
  /** `sheet` (vagy a strip „Részletek"-je) kezdő detentje */
  initialDetent?: Detent;
  /** nem-élő feladat → Modal + scrim megengedett */
  modal?: boolean;
}

/** A videó-szerkesztő panel-azonosítói (= `PanelId` a store-ban, `null` nélkül). */
export type VideoPanelId =
  | 'text'
  | 'filter'
  | 'speed'
  | 'audio'
  | 'hotspot'
  | 'captions'
  | 'sticker'
  | 'transition'
  | 'precision'
  | 'assistant'
  | 'library'
  | 'transcript'
  | 'shape'
  | 'adjust'
  | 'pip'
  | 'imagedoc'
  | 'export'
  | 'multicam'
  | 'creatorPreset'
  | 'workflow';

export const VIDEO_PANEL_SPECS: Record<VideoPanelId, PanelSpec> = {
  // ⚡ gyors: egy-két vezérlő, a hatás a preview-n azonnal látszik
  speed: { tier: 'strip', initialDetent: 'half' },
  filter: { tier: 'strip', initialDetent: 'half' },
  transition: { tier: 'strip', initialDetent: 'half' },
  audio: { tier: 'strip', initialDetent: 'half' },
  // 🎯 precíziós: a vásznon történik
  precision: { tier: 'focus' },
  pip: { tier: 'focus' },
  // 📄 részletes
  adjust: { tier: 'sheet', initialDetent: 'half' },
  hotspot: { tier: 'sheet', initialDetent: 'peek' },
  text: { tier: 'sheet', initialDetent: 'peek' },
  shape: { tier: 'sheet', initialDetent: 'peek' },
  sticker: { tier: 'sheet', initialDetent: 'peek' },
  captions: { tier: 'sheet', initialDetent: 'half' },
  transcript: { tier: 'sheet', initialDetent: 'half' },
  library: { tier: 'sheet', initialDetent: 'half' },
  assistant: { tier: 'sheet', initialDetent: 'half' },
  multicam: { tier: 'sheet', initialDetent: 'half' },
  creatorPreset: { tier: 'sheet', initialDetent: 'half' },
  workflow: { tier: 'sheet', initialDetent: 'half' },
  imagedoc: { tier: 'sheet', initialDetent: 'half' },
  // 📦 nem-élő feladat
  export: { tier: 'sheet', initialDetent: 'full', modal: true },
};

/** A Kép Stúdió lap-azonosítói (= `SheetKind` az `ImageStudioSheets`-ben, `null` nélkül). */
export type ImageSheetId =
  | 'layers'
  | 'style'
  | 'adjust'
  | 'develop'
  | 'fx'
  | 'pattern'
  | 'align'
  | 'boolean'
  | 'shapePicker'
  | 'canvas'
  | 'source'
  | 'export'
  | 'history';

export const IMAGE_SHEET_SPECS: Record<ImageSheetId, PanelSpec> = {
  // élő korrekció: a kép scrim NÉLKÜL, nagyban látszik húzás közben
  adjust: { tier: 'sheet', initialDetent: 'half' },
  develop: { tier: 'sheet', initialDetent: 'half' },
  layers: { tier: 'sheet', initialDetent: 'peek' },
  style: { tier: 'sheet', initialDetent: 'half' },
  fx: { tier: 'sheet', initialDetent: 'half' },
  pattern: { tier: 'sheet', initialDetent: 'half' },
  history: { tier: 'sheet', initialDetent: 'half' },
  align: { tier: 'sheet', initialDetent: 'peek' },
  boolean: { tier: 'sheet', initialDetent: 'peek' },
  shapePicker: { tier: 'sheet', initialDetent: 'peek' },
  canvas: { tier: 'sheet', initialDetent: 'full', modal: true },
  source: { tier: 'sheet', initialDetent: 'full', modal: true },
  export: { tier: 'sheet', initialDetent: 'full', modal: true },
};

/** A Hang Stúdió lapjai (a body mód-flagjei). */
export type AudioSheetId =
  | 'clipEdit'
  | 'mixer'
  | 'master'
  | 'pianoRoll'
  | 'drumMachine'
  | 'sampler'
  | 'addMedia'
  | 'tts'
  | 'source'
  | 'album';

export const AUDIO_SHEET_SPECS: Record<AudioSheetId, PanelSpec> = {
  clipEdit: { tier: 'sheet', initialDetent: 'half' },
  mixer: { tier: 'sheet', initialDetent: 'half' },
  master: { tier: 'sheet', initialDetent: 'half' },
  // önálló szerkesztő-módok: teljes munkafelület
  pianoRoll: { tier: 'workspace' },
  drumMachine: { tier: 'workspace' },
  sampler: { tier: 'workspace' },
  // nem-élő feladat
  addMedia: { tier: 'sheet', initialDetent: 'half', modal: true },
  tts: { tier: 'sheet', initialDetent: 'half', modal: true },
  source: { tier: 'sheet', initialDetent: 'full', modal: true },
  album: { tier: 'sheet', initialDetent: 'full', modal: true },
};

/** A videó-panel szintje; ismeretlen/`null` → `null` (nincs panel). */
export function videoPanelSpec(id: VideoPanelId | null | undefined): PanelSpec | null {
  return id ? (VIDEO_PANEL_SPECS[id] ?? null) : null;
}

/** A felület-szint, amin a panel NYÍLIK (a strip „Részletek"-je után sheet). */
export function openingTier(spec: PanelSpec | null, expanded: boolean): PanelTier | null {
  if (!spec) {
    return null;
  }
  if (spec.tier === 'strip' && expanded) {
    return 'sheet';
  }
  return spec.tier;
}
