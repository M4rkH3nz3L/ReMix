import { t as tr } from 'i18next';
import { create } from 'zustand';

import { MAX_ZOOM, MIN_CLIP_DURATION, MIN_ZOOM } from '@/constants/editor';
import {
  applyBatchPatch,
  batchablePatch,
  extractStyle,
  styleTransferPatch,
} from '@/lib/batchEdit';
import { applyCommand } from '@/lib/commands';
import type { EditorCommand, EventActor, ProjectEvent } from '@/lib/commands';
import { makeId } from '@/lib/id';
import { setProxyConfig } from '@/lib/proxy';
import { findClip, maxVideoDuration, projectDuration } from '@/lib/projectUtils';
import { buildRippleDeletePlan, buildRippleResizePlan } from '@/lib/ripple';
import { clamp } from '@/lib/time';
import type { BrushStyle } from '@/lib/draw';
import type { PacingInsight } from '@/lib/pacingClient';
import type { Asset, Chapter, ChapterKind, Clip, Project, TimelineRegion, TrackType } from '@/types/project';

/** 🎯 proxy minőség-tier → a proxy leghosszabb oldala (px) */
export type ProxyQuality = 'low' | 'medium' | 'high';
export const PROXY_MAX_SIDE: Record<ProxyQuality, number> = { low: 640, medium: 960, high: 1280 };

/** 🔎 melyik „insight" sáv látszik az idővonal fölött (egyszerre egy — kevesebb chrome) */
export type InsightLane = 'story' | 'map' | 'pacing';

/** 🧲 idővonal-illesztés erőssége: ki / normál / erős (a küszöböt skálázza) */
export type SnapStrength = 'off' | 'normal' | 'strong';
/** erősség → SNAP_PX szorzó (0 = nincs illesztés) */
export const SNAP_FACTOR: Record<SnapStrength, number> = { off: 0, normal: 1, strong: 2 };

/**
 * ✂️ Trim-mód (profi vágó-viselkedés). A `normal` a hagyományos trim/mozgatás;
 * a `ripple` a mögötte lévőket tolja; a `roll`, `slip`, `slide` a szomszédos
 * klipekkel dolgozik (lásd `rollEdit`/`slipEdit`/`slideEdit`). A trim-fogantyú
 * a roll/ripple/normal szerint viselkedik, a klip-test húzása a slip/slide/normal
 * szerint — így egy módválasztóval az összes profi vágás elérhető.
 */
export type TrimMode = 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';
export const TRIM_MODES: TrimMode[] = ['normal', 'ripple', 'roll', 'slip', 'slide'];

/**
 * 🧲 Illesztési CÉLPONTOK: melyik fajtára kapjon a klip-él/lejátszófej. A magnet
 * gomb hosszú nyomása kapcsolja őket; a `snapStrength: 'off'` mindent kikapcsol.
 */
export interface SnapTargets {
  playhead: boolean;
  clips: boolean;
  markers: boolean;
  beats: boolean;
  regions: boolean;
}
export const DEFAULT_SNAP_TARGETS: SnapTargets = {
  playhead: true,
  clips: true,
  markers: true,
  beats: true,
  regions: true,
};

/** 🏷️ timeline-régió színek — új régió ciklikusan kap, az átszínezés ezen lépked */
const REGION_COLORS = ['#7c5cff', '#4a9eff', '#2ecc8f', '#ffb454', '#ff5ca8', '#ff6b6b'];

export type PanelId =
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
  | 'workflow'
  | null;

/** Kijelöléshez nem kötött panelek — nyitva maradnak kijelölés nélkül is. */
const STANDALONE_PANELS: PanelId[] = [
  'audio',
  'export',
  'imagedoc',
  'captions',
  'sticker',
  'assistant',
  'library',
  'transcript',
  'multicam',
  'creatorPreset',
  'workflow',
];

const HISTORY_LIMIT = 50;
/** ennyi eseményt őrzünk meg projektenként (AI-memória nyersanyag) */
const EVENT_LIMIT = 300;

interface EditorState {
  project: Project | null;
  selectedClipId: string | null;
  /**
   * 🧩 Több-kijelölés: az elsődleges klipen FELÜL kijelölt klipek. Az
   * `selectedClipId` marad a „főszereplő" (a panelek azt szerkesztik) — a
   * panelek NEM tudnak a több-kijelölésről, mert az `updateClip` fanoutolja a
   * stílus-jellegű mezőket ide is (lásd batchEdit.ts).
   */
  multiSelectIds: string[];
  /** ha aktív, a klipre koppintás hozzáad/elvesz a kijelölésből */
  multiSelectMode: boolean;
  /** 📋 stílus-vágólap: a másolt megjelenés + a klip fajtája (csak azonosra megy) */
  styleClipboard: { kind: Clip['kind']; style: Partial<Clip> } | null;
  /**
   * 🎚️ Sáv-monitorozás — SZÁNDÉKOSAN session-szintű: NEM kerül a projektbe és
   * NEM hat a renderre. Így a némítás sosem lesz „miért hiányzik a zene az
   * exportból?" csapda; a végleges elnémításra a klip hangereje való.
   * A zárolás szerkesztés-védelem (nem mozdítható/trimmelhető/kijelölhető).
   */
  mutedTracks: TrackType[];
  soloTracks: TrackType[];
  lockedTracks: TrackType[];
  /** 🔽 összecsukott sávok (session-szintű; a klip-terület elrejtve, thin lane marad) */
  collapsedTracks: TrackType[];
  /** 📏 sáv-magasság szorzó (session-szintű; hiányzó = 1×) — precíz munkához nagyítható */
  trackHeightScale: Partial<Record<TrackType, number>>;
  /** ✂️ AI/heurisztika által javasolt vágáspontok (mp) — szaggatottan, NEM alkalmazva */
  suggestedCuts: number[];
  /** 📈 AI tempó-elemzés eredménye (lassú szakaszok + összefoglaló); null = nincs */
  pacingInsight: PacingInsight | null;
  /** 🔎 Smart Search találat-időpontok (idővonal-mp) — az idővonalon kiemelve */
  searchMatchTimes: number[];
  /**
   * ⏭️ Ripple mód: a törlés és a hossz-változás nem hagy lyukat — a mögötte
   * lévő klipek MINDEN (nem zárolt) sávon csúsznak, hogy a felirat/zene/SFX
   * szinkronban maradjon a képpel.
   */
  rippleMode: boolean;
  /**
   * ✏️ Rajzoló-mód: ha aktív, a vásznon a húzás VONALAT rajzol (nem klipet
   * mozgat), és felengedéskor forma-klip lesz belőle. `null` = kikapcsolva.
   */
  drawBrush: { color: string; width: number; style: BrushStyle; glow: boolean } | null;
  /**
   * ✂️ Szabadkézi maszk-mód: ha aktív, a vásznon az ujjal/tollal húzott zárt
   * pálya a kijelölt videó/kép klip POLIGON-MASZKJÁVÁ válik (nem forma-klip).
   */
  drawMaskMode: boolean;
  /** 📐 vászon-rács osztása a snaphez (0 = nincs rács); session-szintű */
  snapGrid: number;
  /** 🧲 idővonal-illesztés erőssége (klip-él → beat/marker/playhead); session-szintű */
  snapStrength: SnapStrength;
  /** 🧲 mely célpont-fajtákra illeszt (playhead/klip-élek/marker/beat/régió); session-szintű */
  snapTargets: SnapTargets;
  /** ✂️ Borotva-mód: az idővonalra koppintás elvágja az alatta lévő klipet; session-szintű */
  razorMode: boolean;
  /** ✂️ Trim-mód (normal/ripple/roll/slip/slide) — a fogantyú és a test-húzás viselkedése; session-szintű */
  trimMode: TrimMode;
  /**
   * 👁️ Elrejtett (vizuális) sávok — az ELŐNÉZETBŐL kimaradnak (monitorozás,
   * mint a hang mute-ja); NEM kerül a projektbe, NEM hat a renderre.
   */
  hiddenTracks: TrackType[];
  /** 📏 automatikus sáv-magasság: a magasság a sáv tartalom-típusából jön, a kézi szorzót felülírja; session-szintű */
  autoTrackHeight: boolean;
  /** ⏯️ shuttle-sebesség (J/K/L): negatív = visszafelé, 0 = áll; a lejátszó-óra ezzel skálázza a dt-t */
  playbackRate: number;
  /** 🅸🅾 tartomány-kijelölés kezdete/vége (idővonal-mp); null = nincs. A hurok és a tartomány-műveletek alapja */
  rangeIn: number | null;
  rangeOut: number | null;
  /** 🛡️ safe-zone overlay az előnézeten (TikTok/Reels/YT UI-zónák); session-szintű */
  showSafeZones: boolean;
  /** 🎯 fókusz mód: kijelöléskor a TÖBBI idővonal-klip elhalványul; session-szintű */
  focusMode: boolean;
  /** 🅱️ before/after: nyomva tartva az előnézet a NYERS forrást mutatja (look nélkül) */
  comparingOriginal: boolean;
  /** 🅱️ before/after SLIDER: null = ki; 0–1 = elválasztó helye (bal=eredeti, jobb=szerkesztett) */
  compareSplit: number | null;
  /** 🔎 az idővonal fölötti insight-sáv aktív nézete (story / minimap / pacing) */
  insightLane: InsightLane;
  /** ✂️ maszk-fogantyúk a vásznon (a Szűrők panelről kapcsolva) */
  maskEdit: boolean;
  /**
   * 🎬 Rotoszkóp-mód: ha aktív, a maszk vászon-szerkesztése a LEJÁTSZÓFEJNÉL
   * kulcskockát ír (ClipMask.track), nem az alap-maszkot — így a maszk
   * képkockánként újrarajzolható / követhet egy témát.
   */
  rotoMask: boolean;
  /**
   * 🎙️ Szól-e épp a videóklip JAVÍTOTT hangja külön lejátszóról. Ilyenkor a
   * videó saját hangját némítani kell, különben duplán szólna.
   */
  videoVoiceActive: boolean;
  playhead: number;
  isPlaying: boolean;
  /** lejátszás újrakezdése a végén */
  loop: boolean;
  /** a zenesáv beat-rácsa idővonal-időben (jelölők + snap) */
  beatTimes: number[];
  downbeatTimes: number[];
  /**
   * ▶ Auto Edit változat-előnézet: ha nem null, a lejátszó-óra ezeken a
   * sávokon ugrálva játszik (a lista sorrendjében) — a projekt nem módosul.
   */
  variantPreview: { start: number; end: number }[] | null;
  /**
   * 🎯 Téma-kijelölő mód: ha aktív, a vászonra koppintás NEM kijelöl, hanem
   * a koppintás pontját adja vissza (követés indítópontja). A callback a
   * panelé, ami bekapcsolta.
   */
  pickTarget: ((point: { x: number; y: number }) => void) | null;
  zoom: number;
  activePanel: PanelId;
  past: Project[];
  future: Project[];
  /** van-e nem mentett módosítás (az autosave figyeli) */
  dirty: boolean;
  /** a projekt eseménynaplója — az undo NEM törli, az autosave menti */
  events: ProjectEvent[];

  loadProject: (project: Project, events?: ProjectEvent[]) => void;
  /** 🕓 egy mentett verzió visszaállítása (teljes projekt-csere, undo-zható) */
  restoreProject: (snapshot: Project) => void;
  closeProject: () => void;
  /**
   * Minden szerkesztő-művelet ezen megy át: validál, history-t és eventet ír.
   * Az AI is ezt használja (actor: 'ai'). false = érvénytelen/no-op.
   */
  dispatch: (command: EditorCommand, actor?: EventActor) => boolean;
  /** több command EGY undo-lépésként (pl. teljes AI-köteg → egy visszavonás, #57) */
  applyBatch: (commands: EditorCommand[], actor?: EventActor) => number;
  addClip: (trackType: TrackType, clip: Clip, asset?: Asset) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  splitClipAt: (clipId: string, time: number) => boolean;
  selectClip: (clipId: string | null) => void;
  toggleMultiSelect: (clipId: string) => void;
  /** 🔎 több klip együttes kijelölése (pl. AI smart-select találatokból); az első
   *  lesz az elsődleges, a többi (azonos fajtájú) a köteg */
  selectClips: (ids: string[]) => void;
  copyStyle: () => boolean;
  pasteStyle: () => number;
  toggleTrackFlag: (type: TrackType, flag: 'mute' | 'solo' | 'lock' | 'collapse' | 'hidden') => void;
  /** sáv-magasság léptetése: 1× → 1.6× → 2.4× → 1× */
  cycleTrackHeight: (type: TrackType) => void;
  /** látszik-e a (vizuális) sáv az ELŐNÉZETBEN (hiddenTracks alapján) */
  isTrackVisible: (type: TrackType) => boolean;
  /** 📏 automatikus sáv-magasság ki/be */
  toggleAutoTrackHeight: () => void;
  /** a TÖBB-kijelölt klipek együttes eltolása az idővonalon (csoport-mozgatás) */
  nudgeSelectedBy: (deltaSec: number) => void;
  /** megadott klipek együttes eltolása (csoport-clamppal) — link/selection közös magja */
  nudgeClipsBy: (ids: string[], deltaSec: number) => void;
  /** a klip link-csoportja (együtt mozgó klipek), vagy null */
  linkGroupOf: (clipId: string) => string[] | null;
  /** a jelenlegi több-kijelölés linkelése egy csoporttá (min. 2 klip) */
  linkSelected: () => void;
  /** 🧱 pre-compose: a kijelölt klipeket EGY compound (beágyazott kompozíciós) videóklippé fogja össze */
  preCompose: () => void;
  /** a klipet tartalmazó link-csoport feloldása */
  unlinkClip: (clipId: string) => void;
  /** 🎬 story-fejezet hozzáadása a lejátszófejnél (adott fajtával) */
  addChapterAt: (kind: ChapterKind) => void;
  /** fejezet fajtájának léptetése: hook → context → value → cta → other → hook */
  cycleChapterKind: (id: string) => void;
  /** fejezet törlése */
  removeChapter: (id: string) => void;
  /** 🎬 AI-felismert story-fejezetek alkalmazása (a meglévőket lecseréli, egy undo-lépés) */
  applyAiChapters: (chapters: { start: number; kind: ChapterKind }[]) => void;
  /** 🏷️ timeline-régió a kijelölt klip tartományából (vagy alap-hossz a playheadnél) */
  addRegion: () => void;
  /** régió törlése */
  removeRegion: (id: string) => void;
  /** régió átszínezése a következő palettaszínre */
  recolorRegion: (id: string) => void;
  /** ✂️ javasolt vágáspontok beállítása (szaggatott jelölés, nem alkalmazva) */
  setSuggestedCuts: (times: number[]) => void;
  /** a javaslatok elvetése */
  clearSuggestedCuts: () => void;
  /** 📈 AI tempó-elemzés eredményének beállítása/törlése (null = törlés) */
  setPacingInsight: (insight: PacingInsight | null) => void;
  /** 🔎 Smart Search találat-időpontok beállítása (üres = kiemelés törlése) */
  setSearchMatchTimes: (times: number[]) => void;
  /** a javasolt vágások alkalmazása (a lefedő videóklipek splitelése), majd elvetés */
  applySuggestedCuts: () => void;
  setRippleMode: (on: boolean) => void;
  /** ✂️ borotva-mód ki/be (az idővonalra koppintás vág) */
  setRazorMode: (on: boolean) => void;
  toggleRazorMode: () => void;
  /** ✂️ trim-mód beállítása / léptetése (normal→ripple→roll→slip→slide→normal) */
  setTrimMode: (mode: TrimMode) => void;
  cycleTrimMode: () => void;
  setDrawBrush: (brush: EditorState['drawBrush']) => void;
  /** ✂️ szabadkézi maszk-mód ki/be (kizárja a rajzoló-módot és a borotvát) */
  setDrawMaskMode: (on: boolean) => void;
  setSnapGrid: (grid: number) => void;
  /** 🎯 proxy (vágási munka-példány) be/ki + minőség-tier */
  proxyEnabled: boolean;
  proxyQuality: ProxyQuality;
  setProxyEnabled: (on: boolean) => void;
  setProxyQuality: (q: ProxyQuality) => void;
  toggleSafeZones: () => void;
  /** 🧲 illesztés-erősség léptetése: normál → erős → ki → normál */
  cycleSnapStrength: () => void;
  /** 🧲 egy illesztési célpont-fajta ki/bekapcsolása */
  toggleSnapTarget: (key: keyof SnapTargets) => void;
  /** ⏯️ shuttle: sebesség beállítása (J/K/L) — a lejátszás ehhez igazodik */
  setPlaybackRate: (rate: number) => void;
  /** ⏯️ shuttle-léptetés: dir<0 = J (vissza), dir>0 = L (előre); ismételve gyorsít */
  shuttle: (dir: -1 | 1) => void;
  /** 🅸 tartomány kezdete a lejátszófejnél */
  setRangeIn: () => void;
  /** 🅾 tartomány vége a lejátszófejnél */
  setRangeOut: () => void;
  /** tartomány-kijelölés törlése */
  clearRange: () => void;
  /** a kijelölt tartomány ripple-törlése (a rés bezárul minden nem-zárolt sávon) */
  deleteRange: () => boolean;
  /** régió létrehozása a kijelölt tartományból */
  regionFromRange: () => void;
  /** 🌀 roll-vágás: a klip és a szomszéd közti VÁGÁSPONT eltolása (a projekt-hossz marad) */
  rollEdit: (clipId: string, edge: 'left' | 'right', deltaSec: number) => void;
  /** 🌀 slip-vágás: csak a forrás be/ki-pont csúszik (a klip helye/hossza marad) — csak videón */
  slipEdit: (clipId: string, deltaSec: number) => void;
  /** 🌀 slide-vágás: a klip elcsúszik, a szomszédok elnyelik (a projekt-hossz marad) */
  slideEdit: (clipId: string, deltaSec: number) => void;
  toggleFocusMode: () => void;
  setComparingOriginal: (on: boolean) => void;
  setCompareSplit: (v: number | null) => void;
  setInsightLane: (lane: InsightLane) => void;
  setMaskEdit: (on: boolean) => void;
  /** 🎬 rotoszkóp-mód ki/be (a maszk-szerkesztés a lejátszófejnél kulcskockát ír) */
  setRotoMask: (on: boolean) => void;
  setVideoVoiceActive: (on: boolean) => void;
  /** ripple-törlés: a klipek eltűnnek és a lyuk bezárul (false = nem futott) */
  rippleDelete: (clipIds: string[]) => boolean;
  /** ripple-hossz: a klip új hosszt kap, a mögötte lévők csúsznak */
  rippleResize: (clipId: string, nextDuration: number) => boolean;
  /** a klip ELŐTTI hézag bezárása: a klip és a sávon utána lévők balra csúsznak (false = nincs hézag) */
  closeGapBefore: (clipId: string) => boolean;
  /** hallható-e a sáv az ELŐNÉZETBEN (solo felülírja a némítást) */
  isTrackAudible: (type: TrackType) => boolean;
  setMultiSelectMode: (on: boolean) => void;
  /** minden kijelölt klip azonosítója (elsődleges + a többi) */
  allSelectedIds: () => string[];
  setPlayhead: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setLoop: (loop: boolean) => void;
  setBeatGrid: (beatTimes: number[], downbeatTimes: number[]) => void;
  /** 🥁 markerek a beat-rácsból (minden beat vagy csak az ütemegy); @returns hány új jelölő */
  markersFromBeats: (mode: 'beat' | 'downbeat') => number;
  /** 🥁 javasolt vágáspontok a beat-rácsból (nem-destruktív; az applySuggestedCuts alkalmazza) */
  cutsFromBeats: (mode: 'beat' | 'downbeat') => number;
  setVariantPreview: (ranges: { start: number; end: number }[] | null) => void;
  setPickTarget: (fn: ((point: { x: number; y: number }) => void) | null) => void;
  setZoom: (zoom: number) => void;
  setPanel: (panel: PanelId) => void;
  /** 🖼️ Kép Stúdió (teljes képernyős, on-device képszerkesztő) cél-klipje */
  imageStudioClipId: string | null;
  openImageStudio: (clipId: string) => void;
  closeImageStudio: () => void;
  /** 🎧 Hang Stúdió (teljes képernyős, on-device audio-szerkesztő) cél-klipje */
  audioStudioClipId: string | null;
  openAudioStudio: (clipId: string) => void;
  closeAudioStudio: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
  /** a renderelt változat rögzítése a projekten (artefaktum — nem undo/dirty) */
  setRendered: (rendered: Project['rendered']) => void;
}

/**
 * Az ÁTMENETI szerkesztő-módok alaphelyzete. Projekt betöltésekor ÉS
 * bezárásakor UGYANEZT kell nullázni — a lista két helyre másolása már kétszer
 * okozott beragadt módot (a zárolás/rajzoló-mód átragadt a következő
 * projektre), ezért közös konstans.
 *
 * A `styleClipboard` SZÁNDÉKOSAN nincs benne: a másolt megjelenés projektek
 * közt is átvihető.
 */
const SESSION_RESET = {
  multiSelectIds: [] as string[],
  multiSelectMode: false,
  drawBrush: null,
  drawMaskMode: false,
  rippleMode: false,
  razorMode: false,
  trimMode: 'normal' as TrimMode,
  snapGrid: 0,
  snapStrength: 'normal' as SnapStrength,
  snapTargets: { ...DEFAULT_SNAP_TARGETS },
  hiddenTracks: [] as TrackType[],
  autoTrackHeight: false,
  playbackRate: 1,
  rangeIn: null as number | null,
  rangeOut: null as number | null,
  showSafeZones: false,
  focusMode: false,
  comparingOriginal: false,
  compareSplit: null as number | null,
  insightLane: 'story' as InsightLane,
  maskEdit: false,
  rotoMask: false,
  videoVoiceActive: false,
  mutedTracks: [] as TrackType[],
  soloTracks: [] as TrackType[],
  lockedTracks: [] as TrackType[],
  collapsedTracks: [] as TrackType[],
  trackHeightScale: {} as Partial<Record<TrackType, number>>,
  suggestedCuts: [] as number[],
  pacingInsight: null as PacingInsight | null,
  searchMatchTimes: [] as number[],
  beatTimes: [] as number[],
  downbeatTimes: [] as number[],
  variantPreview: null,
  pickTarget: null,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  selectedClipId: null,
  styleClipboard: null,
  playhead: 0,
  isPlaying: false,
  loop: false,
  zoom: 1,
  activePanel: null,
  imageStudioClipId: null,
  audioStudioClipId: null,
  past: [],
  future: [],
  dirty: false,
  events: [],
  // 🎯 teljesítmény: NEM session-reset, hogy projektváltáskor is megmaradjon
  proxyEnabled: true,
  proxyQuality: 'medium',
  ...SESSION_RESET,

  loadProject: (project, events) =>
    set({
      project,
      selectedClipId: null,
      playhead: 0,
      isPlaying: false,
      activePanel: null,
      past: [],
      future: [],
      dirty: false,
      events: events ?? [],
      ...SESSION_RESET,
    }),

  restoreProject: (snapshot) => {
    const { project, past } = get();
    if (!project) {
      return;
    }
    // a jelenlegi állapot a history-ba kerül → a visszaállítás egy undóval visszavonható
    set({
      project: snapshot,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      dirty: true,
      selectedClipId: null,
      multiSelectIds: [],
      multiSelectMode: false,
      playhead: 0,
      isPlaying: false,
    });
  },

  closeProject: () =>
    set({
      project: null,
      selectedClipId: null,
      playhead: 0,
      isPlaying: false,
      activePanel: null,
      past: [],
      future: [],
      dirty: false,
      events: [],
      ...SESSION_RESET,
    }),

  dispatch: (command, actor = 'user') => {
    const { project, past, events } = get();
    if (!project) {
      return false;
    }
    const next = applyCommand(project, command);
    if (next === null) {
      return false;
    }
    const event: ProjectEvent = {
      id: makeId('evt'),
      at: new Date().toISOString(),
      actor,
      command,
    };
    set({
      project: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      dirty: true,
      events: [...events.slice(-EVENT_LIMIT + 1), event],
    });
    return true;
  },

  applyBatch: (commands, actor = 'ai') => {
    const { project, past, events } = get();
    if (!project) {
      return 0;
    }
    let cur = project;
    const batchEvents: ProjectEvent[] = [];
    for (const command of commands) {
      const next = applyCommand(cur, command);
      if (next !== null) {
        cur = next;
        batchEvents.push({ id: makeId('evt'), at: new Date().toISOString(), actor, command });
      }
    }
    if (batchEvents.length === 0) {
      return 0;
    }
    // EGYETLEN pre-batch pillanatkép a history-ba → egy undo visszavonja az egészet
    set({
      project: cur,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      dirty: true,
      events: [...events, ...batchEvents].slice(-EVENT_LIMIT),
    });
    return batchEvents.length;
  },

  addClip: (trackType, clip, asset) => {
    if (get().dispatch({ type: 'ADD_CLIP', trackType, clip, asset })) {
      set({ selectedClipId: clip.id });
    }
  },

  updateClip: (clipId, patch) => {
    const { project, selectedClipId, multiSelectIds } = get();
    // kötegelt szerkesztés: az elsődleges klip stílus-változásai a többi
    // kijelöltre is rámennek — EGY undo-lépésben, sávonként újraépítve
    const batch =
      project && clipId === selectedClipId && multiSelectIds.length > 0
        ? batchablePatch(patch)
        : null;
    if (!batch) {
      get().dispatch({ type: 'UPDATE_CLIP', clipId, patch });
      return;
    }
    const primary = findClip(project!, clipId)?.clip;
    if (!primary) {
      get().dispatch({ type: 'UPDATE_CLIP', clipId, patch });
      return;
    }
    const ids = new Set(multiSelectIds);
    const tracks: { trackType: TrackType; clips: Clip[] }[] = [];
    for (const track of project!.tracks) {
      const applied = applyBatchPatch(track.clips, ids, batch, primary.kind);
      // az elsődleges klip a TELJES patchet kapja, a többi csak a stílus-részt
      const withPrimary = applied.clips.map((c) =>
        c.id === clipId ? ({ ...c, ...patch } as Clip) : c
      );
      if (applied.changed > 0 || track.clips.some((c) => c.id === clipId)) {
        tracks.push({ trackType: track.type, clips: withPrimary });
      }
    }
    if (tracks.length === 0) {
      get().dispatch({ type: 'UPDATE_CLIP', clipId, patch });
      return;
    }
    get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks,
      label: tr('store.editor.batchEdit', { count: multiSelectIds.length + 1 }),
    });
  },

  removeClip: (clipId) => {
    get().dispatch({ type: 'REMOVE_CLIP', clipId });
    const { selectedClipId, multiSelectIds } = get();
    if (selectedClipId === clipId) {
      set({ selectedClipId: null, activePanel: null, multiSelectIds: [], multiSelectMode: false });
    } else if (multiSelectIds.includes(clipId)) {
      set({ multiSelectIds: multiSelectIds.filter((id) => id !== clipId) });
    }
  },

  splitClipAt: (clipId, time) => {
    return get().dispatch({ type: 'SPLIT_CLIP', clipId, time });
  },

  selectClip: (clipId) => {
    const { activePanel } = get();
    const standalone = STANDALONE_PANELS.includes(activePanel);
    set({
      selectedClipId: clipId,
      // új elsődleges klip → a köteg-kijelölés elévül
      multiSelectIds: [],
      multiSelectMode: false,
      activePanel: clipId || standalone ? activePanel : null,
    });
  },

  toggleMultiSelect: (clipId) => {
    const { selectedClipId, multiSelectIds, project } = get();
    if (!project || clipId === selectedClipId) {
      return;
    }
    if (!selectedClipId) {
      get().selectClip(clipId);
      return;
    }
    // csak azonos fajtájú klip vehető a köteghez — a stílus-fanout is így megy
    const primary = findClip(project, selectedClipId)?.clip;
    const next = findClip(project, clipId)?.clip;
    if (!primary || !next || next.kind !== primary.kind) {
      return;
    }
    set({
      multiSelectIds: multiSelectIds.includes(clipId)
        ? multiSelectIds.filter((id) => id !== clipId)
        : [...multiSelectIds, clipId],
    });
  },

  selectClips: (ids) => {
    const { project } = get();
    if (!project || ids.length === 0) {
      return;
    }
    // csak létező klipek; az első az elsődleges, a köteg csak azonos fajtájú
    const clips = ids
      .map((id) => findClip(project, id)?.clip)
      .filter((c): c is Clip => !!c);
    if (clips.length === 0) {
      return;
    }
    const primary = clips[0];
    const rest = clips.slice(1).filter((c) => c.kind === primary.kind).map((c) => c.id);
    set({
      selectedClipId: primary.id,
      multiSelectIds: rest,
      multiSelectMode: rest.length > 0,
    });
  },

  /** a kijelölt klip megjelenésének vágólapra másolása */
  copyStyle: () => {
    const { project, selectedClipId } = get();
    const clip = project && selectedClipId ? findClip(project, selectedClipId)?.clip : null;
    if (!clip) {
      return false;
    }
    set({ styleClipboard: { kind: clip.kind, style: extractStyle(clip) } });
    return true;
  },

  /**
   * A vágólapon lévő stílus beillesztése MINDEN kijelölt, azonos fajtájú
   * klipre — egy undo-lépésben. @returns hány klip kapta meg
   */
  pasteStyle: () => {
    const state = get();
    const { project, styleClipboard } = state;
    if (!project || !styleClipboard) {
      return 0;
    }
    const ids = new Set(state.allSelectedIds());
    if (ids.size === 0) {
      return 0;
    }
    let changed = 0;
    const tracks: { trackType: TrackType; clips: Clip[] }[] = [];
    for (const track of project.tracks) {
      let touched = false;
      const clips = track.clips.map((c) => {
        if (!ids.has(c.id) || c.kind !== styleClipboard.kind) {
          return c;
        }
        touched = true;
        changed += 1;
        return { ...c, ...styleTransferPatch(styleClipboard.style, c) } as Clip;
      });
      if (touched) {
        tracks.push({ trackType: track.type, clips });
      }
    }
    if (changed === 0) {
      return 0;
    }
    get().dispatch(
      { type: 'REPLACE_TRACKS', tracks, label: tr('store.editor.pasteStyle', { count: changed }) },
      'user'
    );
    return changed;
  },

  toggleTrackFlag: (type, flag) => {
    const key =
      flag === 'mute'
        ? 'mutedTracks'
        : flag === 'solo'
          ? 'soloTracks'
          : flag === 'collapse'
            ? 'collapsedTracks'
            : flag === 'hidden'
              ? 'hiddenTracks'
              : 'lockedTracks';
    const list = get()[key];
    const next = list.includes(type) ? list.filter((t) => t !== type) : [...list, type];
    // zároláskor a sávon lévő kijelölés elévül (különben zárolt klipet
    // szerkesztenének a panelek)
    if (flag === 'lock' && !list.includes(type)) {
      const { project, selectedClipId } = get();
      const sel = project && selectedClipId ? findClip(project, selectedClipId) : null;
      if (sel?.track.type === type) {
        set({ selectedClipId: null, multiSelectIds: [], multiSelectMode: false, activePanel: null });
      }
    }
    set({ [key]: next } as never);
  },

  cycleTrackHeight: (type) => {
    const steps = [1, 1.6, 2.4];
    const cur = get().trackHeightScale[type] ?? 1;
    const idx = steps.indexOf(cur);
    const next = steps[(idx + 1) % steps.length] ?? 1;
    // kézi léptetés kikapcsolja az automatikus magasságot (a user átvette az irányítást)
    set((s) => ({ autoTrackHeight: false, trackHeightScale: { ...s.trackHeightScale, [type]: next } }));
  },

  isTrackVisible: (type) => !get().hiddenTracks.includes(type),

  toggleAutoTrackHeight: () => set((s) => ({ autoTrackHeight: !s.autoTrackHeight })),

  nudgeClipsBy: (idList, deltaSec) => {
    const { project } = get();
    if (!project || idList.length === 0) {
      return;
    }
    const ids = new Set(idList);
    // csoport-clamp: a legkorábbi klip se csússzon 0 alá (a relatív rend marad)
    let minStart = Infinity;
    for (const tk of project.tracks) {
      for (const c of tk.clips) {
        if (ids.has(c.id)) {
          minStart = Math.min(minStart, c.start);
        }
      }
    }
    if (!Number.isFinite(minStart)) {
      return;
    }
    const delta = Math.max(deltaSec, -minStart);
    if (Math.abs(delta) < 0.001) {
      return;
    }
    const tracks = project.tracks
      .filter((tk) => tk.clips.some((c) => ids.has(c.id)))
      .map((tk) => ({
        trackType: tk.type,
        clips: tk.clips.map((c) =>
          ids.has(c.id)
            ? { ...c, start: Math.max(0, Math.round((c.start + delta) * 1000) / 1000) }
            : c
        ),
      }));
    get().dispatch({ type: 'REPLACE_TRACKS', tracks, label: tr('store.editor.groupMove') });
  },

  nudgeSelectedBy: (deltaSec) => {
    const { selectedClipId, multiSelectIds } = get();
    if (!selectedClipId || multiSelectIds.length === 0) {
      return;
    }
    get().nudgeClipsBy([selectedClipId, ...multiSelectIds], deltaSec);
  },

  linkGroupOf: (clipId) => (get().project?.links ?? []).find((g) => g.includes(clipId)) ?? null,

  linkSelected: () => {
    const { project, selectedClipId, multiSelectIds } = get();
    if (!project || !selectedClipId || multiSelectIds.length === 0) {
      return; // legalább 2 klip kell a linkeléshez
    }
    // az új csoport + a beleérő MEGLÉVŐ csoportok összeolvasztása
    const merged = new Set<string>([selectedClipId, ...multiSelectIds]);
    const rest = (project.links ?? []).filter((g) => {
      if (g.some((id) => merged.has(id))) {
        g.forEach((id) => merged.add(id));
        return false;
      }
      return true;
    });
    get().dispatch({ type: 'SET_LINKS', links: [...rest, [...merged]] });
  },

  preCompose: () => {
    const { project } = get();
    if (!project) {
      return;
    }
    const ids = new Set(get().allSelectedIds());
    if (ids.size < 1) {
      return;
    }
    // a kijelölt klipek + sávjuk begyűjtése, a csoport idő-tartománya
    const picked: { type: TrackType; clip: Clip }[] = [];
    let minStart = Infinity;
    let maxEnd = 0;
    for (const tk of project.tracks) {
      for (const c of tk.clips) {
        if (ids.has(c.id)) {
          picked.push({ type: tk.type, clip: c });
          minStart = Math.min(minStart, c.start);
          maxEnd = Math.max(maxEnd, c.start + c.duration);
        }
      }
    }
    if (picked.length === 0 || !Number.isFinite(minStart)) {
      return;
    }
    const span = Math.max(0.1, Math.round((maxEnd - minStart) * 1000) / 1000);
    // beágyazott kompozíció sávjai: a klipek 0-hoz igazítva, fajtánként csoportosítva
    const byType = new Map<TrackType, Clip[]>();
    for (const { type, clip } of picked) {
      const shifted = { ...clip, start: Math.round((clip.start - minStart) * 1000) / 1000 } as Clip;
      byType.set(type, [...(byType.get(type) ?? []), shifted]);
    }
    const compTracks = [...byType].map(([type, clips]) => ({ id: makeId('trk'), type, name: type, clips }));
    // durva előnézeti uri: az első videó/kép klip forrása (a pontos előnézet renderelt proxy — follow-up)
    const media = picked.map((p) => p.clip).find((c) => c.kind === 'video' || c.kind === 'image');
    const compound = {
      kind: 'video',
      id: makeId('clip'),
      start: Math.round(minStart * 1000) / 1000,
      duration: span,
      uri: media && 'uri' in media ? (media as { uri: string }).uri : '',
      trimIn: 0,
      sourceDuration: span,
      speed: 1,
      volume: 1,
      filterId: 'none',
      comp: { aspectRatio: project.aspectRatio, assets: project.assets, duration: span, tracks: compTracks },
    } as Clip;
    // a kijelölt klipek eltávolítva minden érintett sávról; a compound a videó-sávra
    const affected = new Set<TrackType>(picked.map((p) => p.type));
    affected.add('video');
    const tracks = project.tracks
      .filter((tk) => affected.has(tk.type))
      .map((tk) => {
        let clips = tk.clips.filter((c) => !ids.has(c.id));
        if (tk.type === 'video') {
          clips = [...clips, compound];
        }
        return { trackType: tk.type, clips };
      });
    if (get().dispatch({ type: 'REPLACE_TRACKS', tracks, label: tr('store.editor.preCompose', { count: picked.length }) })) {
      set({ selectedClipId: compound.id, multiSelectIds: [], multiSelectMode: false });
    }
  },

  unlinkClip: (clipId) => {
    const { project } = get();
    if (!project) {
      return;
    }
    get().dispatch({
      type: 'SET_LINKS',
      links: (project.links ?? []).filter((g) => !g.includes(clipId)),
    });
  },

  addChapterAt: (kind) => {
    const { project, playhead } = get();
    if (!project) {
      return;
    }
    const start = Math.max(0, Math.round(playhead * 100) / 100);
    // ugyanannál a startnál ne legyen két fejezet — a meglévőt felülírjuk
    const chapters: Chapter[] = [
      ...(project.chapters ?? []).filter((c) => Math.abs(c.start - start) > 0.05),
      { id: makeId('chp'), start, kind },
    ];
    get().dispatch({ type: 'SET_CHAPTERS', chapters });
  },

  cycleChapterKind: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    const order: ChapterKind[] = ['hook', 'context', 'value', 'cta', 'other'];
    const chapters = (project.chapters ?? []).map((c) =>
      c.id === id ? { ...c, kind: order[(order.indexOf(c.kind) + 1) % order.length] } : c
    );
    get().dispatch({ type: 'SET_CHAPTERS', chapters });
  },

  removeChapter: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    get().dispatch({
      type: 'SET_CHAPTERS',
      chapters: (project.chapters ?? []).filter((c) => c.id !== id),
    });
  },

  addRegion: () => {
    const { project, selectedClipId, playhead } = get();
    if (!project) {
      return;
    }
    // a kijelölt klip tartománya, vagy alap 3 mp-es sáv a lejátszófejnél
    let start = Math.max(0, playhead);
    let end = start + 3;
    if (selectedClipId) {
      const c = findClip(project, selectedClipId)?.clip;
      if (c) {
        start = c.start;
        end = c.start + c.duration;
      }
    }
    const regions = project.regions ?? [];
    const region: TimelineRegion = {
      id: makeId('rgn'),
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      label: tr('store.editor.regionDefault', { n: regions.length + 1 }),
      color: REGION_COLORS[regions.length % REGION_COLORS.length],
    };
    get().dispatch({ type: 'SET_REGIONS', regions: [...regions, region] });
  },

  removeRegion: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    get().dispatch({
      type: 'SET_REGIONS',
      regions: (project.regions ?? []).filter((r) => r.id !== id),
    });
  },

  recolorRegion: (id) => {
    const { project } = get();
    if (!project) {
      return;
    }
    get().dispatch({
      type: 'SET_REGIONS',
      regions: (project.regions ?? []).map((r) =>
        r.id === id
          ? { ...r, color: REGION_COLORS[(REGION_COLORS.indexOf(r.color) + 1) % REGION_COLORS.length] }
          : r
      ),
    });
  },

  applyAiChapters: (input) => {
    const { project } = get();
    if (!project) {
      return;
    }
    // időrend + közeli dedup, majd id-hozzárendelés — a régi fejezeteket cseréli
    const sorted = [...input].sort((a, b) => a.start - b.start);
    const chapters: Chapter[] = [];
    for (const c of sorted) {
      if (!chapters.some((d) => Math.abs(d.start - c.start) < 0.05)) {
        chapters.push({ id: makeId('chp'), start: Math.max(0, c.start), kind: c.kind });
      }
    }
    // provenance: az esemény-naplóban 'ai'-ként jelenik meg (mint az AI-parancsok)
    get().dispatch({ type: 'SET_CHAPTERS', chapters }, 'ai');
  },

  setSuggestedCuts: (times) =>
    set({ suggestedCuts: [...new Set(times.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b) }),

  clearSuggestedCuts: () => set({ suggestedCuts: [] }),

  setPacingInsight: (insight) => set({ pacingInsight: insight }),

  setSearchMatchTimes: (times) =>
    set({ searchMatchTimes: [...times].sort((a, b) => a - b) }),

  applySuggestedCuts: () => {
    const times = [...get().suggestedCuts].sort((a, b) => a - b);
    for (const t of times) {
      // minden vágásnál újraolvassuk a projektet (a split megváltoztatja a klipeket)
      const project = get().project;
      const videoTrack = project?.tracks.find((tk) => tk.type === 'video');
      const clip = videoTrack?.clips.find((c) => c.start + 0.05 < t && t < c.start + c.duration - 0.05);
      if (clip) {
        get().splitClipAt(clip.id, t);
      }
    }
    set({ suggestedCuts: [] });
  },

  markersFromBeats: (mode) => {
    const { project, beatTimes, downbeatTimes } = get();
    if (!project) {
      return 0;
    }
    const times = mode === 'downbeat' ? downbeatTimes : beatTimes;
    if (times.length === 0) {
      return 0;
    }
    const markers = [...(project.markers ?? [])];
    let added = 0;
    for (const time of times) {
      const t2 = Math.round(time * 100) / 100;
      // már meglévő jelölő közelébe (±0.05 mp) ne tegyünk másikat
      if (markers.some((m) => Math.abs(m.time - t2) < 0.05)) {
        continue;
      }
      markers.push({ id: makeId('mk'), time: t2, label: tr('store.editor.beatMarker'), color: '#4a9eff' });
      added += 1;
    }
    if (added === 0) {
      return 0;
    }
    get().dispatch({ type: 'SET_MARKERS', markers });
    return added;
  },

  cutsFromBeats: (mode) => {
    const { beatTimes, downbeatTimes } = get();
    const times = mode === 'downbeat' ? downbeatTimes : beatTimes;
    // nem-destruktív: szaggatott jelölés; a felhasználó az applySuggestedCuts-tal alkalmazza
    get().setSuggestedCuts(times);
    return times.length;
  },

  setRippleMode: (on) => set({ rippleMode: on }),

  // borotva és rajzoló-mód kizárja egymást (mindkettő a vászon/idővonal koppintását foglalja)
  setRazorMode: (on) => set(on ? { razorMode: true, drawBrush: null } : { razorMode: false }),
  toggleRazorMode: () => set((s) => (s.razorMode ? { razorMode: false } : { razorMode: true, drawBrush: null })),

  setTrimMode: (mode) => set({ trimMode: mode }),
  cycleTrimMode: () =>
    set((s) => ({ trimMode: TRIM_MODES[(TRIM_MODES.indexOf(s.trimMode) + 1) % TRIM_MODES.length] })),

  setDrawBrush: (brush) => set(brush ? { drawBrush: brush, drawMaskMode: false } : { drawBrush: brush }),

  setProxyEnabled: (on) => {
    setProxyConfig({ enabled: on });
    set({ proxyEnabled: on });
  },
  setProxyQuality: (q) => {
    setProxyConfig({ maxSide: PROXY_MAX_SIDE[q] });
    set({ proxyQuality: q });
  },

  // szabadkézi maszk kizárja a forma-rajzolót és a borotvát (mind a vászon/idővonal koppintását foglalja)
  setDrawMaskMode: (on) =>
    set(on ? { drawMaskMode: true, drawBrush: null, razorMode: false } : { drawMaskMode: false }),

  setSnapGrid: (grid) => set({ snapGrid: grid }),
  toggleSafeZones: () => set((s) => ({ showSafeZones: !s.showSafeZones })),

  cycleSnapStrength: () =>
    set((s) => ({
      snapStrength:
        s.snapStrength === 'normal' ? 'strong' : s.snapStrength === 'strong' ? 'off' : 'normal',
    })),
  toggleSnapTarget: (key) =>
    set((s) => ({ snapTargets: { ...s.snapTargets, [key]: !s.snapTargets[key] } })),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  setComparingOriginal: (on) => set({ comparingOriginal: on }),
  setCompareSplit: (v) => set({ compareSplit: v }),
  setInsightLane: (lane) => set({ insightLane: lane }),

  setMaskEdit: (on) => set({ maskEdit: on }),

  setRotoMask: (on) => set(on ? { rotoMask: true, maskEdit: true } : { rotoMask: false }),

  setVideoVoiceActive: (on) => set({ videoVoiceActive: on }),

  rippleDelete: (clipIds) => {
    const { project, lockedTracks } = get();
    if (!project) {
      return false;
    }
    const plan = buildRippleDeletePlan(project, clipIds, { lockedTracks });
    if (!plan) {
      return false;
    }
    const ok = get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks: plan.tracks,
      label: tr('store.editor.rippleDelete', { count: clipIds.length, moved: plan.moved }),
    });
    if (ok) {
      set({ selectedClipId: null, multiSelectIds: [], multiSelectMode: false, activePanel: null });
    }
    return ok;
  },

  rippleResize: (clipId, nextDuration) => {
    const { project, lockedTracks } = get();
    if (!project) {
      return false;
    }
    const plan = buildRippleResizePlan(project, clipId, nextDuration, { lockedTracks });
    if (!plan) {
      return false;
    }
    return get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks: plan.tracks,
      label: tr('store.editor.rippleLength', { count: plan.moved }),
    });
  },

  closeGapBefore: (clipId) => {
    const { project } = get();
    if (!project) {
      return false;
    }
    const track = project.tracks.find((tk) => tk.clips.some((c) => c.id === clipId));
    const target = track?.clips.find((c) => c.id === clipId);
    if (!track || !target) {
      return false;
    }
    // az előző (target előtt végződő) klip vége ezen a sávon, vagy 0 (vezető hézag)
    const prevEnd = track.clips
      .filter((c) => c.id !== clipId && c.start + c.duration <= target.start + 0.001)
      .reduce((max, c) => Math.max(max, c.start + c.duration), 0);
    const gap = target.start - prevEnd;
    if (gap <= 0.01) {
      return false;
    }
    // a target és a sávon utána lévők balra csúsznak a hézag méretével (csak ez a sáv változik)
    const clips = track.clips.map((c) =>
      c.start >= target.start - 0.001
        ? { ...c, start: Math.max(0, Math.round((c.start - gap) * 1000) / 1000) }
        : c
    );
    return get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks: [{ trackType: track.type, clips }],
      label: tr('store.editor.closeGap'),
    });
  },

  setRangeIn: () => {
    const { playhead, rangeOut } = get();
    const t = Math.round(playhead * 100) / 100;
    set({ rangeIn: t, rangeOut: rangeOut != null && rangeOut > t ? rangeOut : null });
  },
  setRangeOut: () => {
    const { playhead, rangeIn } = get();
    const t = Math.round(playhead * 100) / 100;
    set({ rangeOut: t, rangeIn: rangeIn != null && rangeIn < t ? rangeIn : null });
  },
  clearRange: () => set({ rangeIn: null, rangeOut: null }),

  regionFromRange: () => {
    const { project, rangeIn, rangeOut } = get();
    if (!project || rangeIn == null || rangeOut == null || rangeOut - rangeIn < 0.05) {
      return;
    }
    const regions = project.regions ?? [];
    const region: TimelineRegion = {
      id: makeId('rgn'),
      start: rangeIn,
      end: rangeOut,
      label: tr('store.editor.regionDefault', { n: regions.length + 1 }),
      color: REGION_COLORS[regions.length % REGION_COLORS.length],
    };
    if (get().dispatch({ type: 'SET_REGIONS', regions: [...regions, region] })) {
      set({ rangeIn: null, rangeOut: null });
    }
  },

  deleteRange: () => {
    const { project, rangeIn, rangeOut, lockedTracks } = get();
    if (!project || rangeIn == null || rangeOut == null) {
      return false;
    }
    const inT = rangeIn;
    const outT = rangeOut;
    const span = outT - inT;
    if (span < 0.05) {
      return false;
    }
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const trackPatches: { trackType: TrackType; clips: Clip[] }[] = [];
    for (const track of project.tracks) {
      if (lockedTracks.includes(track.type)) {
        continue;
      }
      let changed = false;
      const out: Clip[] = [];
      for (const c of track.clips) {
        const s = c.start;
        const e = c.start + c.duration;
        if (e <= inT + 0.001) {
          out.push(c); // teljesen a range előtt — marad
          continue;
        }
        if (s >= outT - 0.001) {
          out.push({ ...c, start: round(s - span) }); // teljesen utána — balra csúszik
          changed = true;
          continue;
        }
        // a range-be lóg: a metszet kiesik, a bal/jobb szegmens marad
        changed = true;
        const leftDur = Math.min(e, inT) - s;
        const keepLeft = leftDur >= MIN_CLIP_DURATION;
        if (keepLeft) {
          out.push({ ...c, duration: round(leftDur) });
        }
        const rStart = Math.max(s, outT);
        const rDur = e - rStart;
        if (rDur >= MIN_CLIP_DURATION) {
          const seg = { ...c, start: round(rStart - span), duration: round(rDur) } as Clip;
          // a jobb szegmens forrás-be-pontja a kivágott rész UTÁNI tartalomra ugrik
          if (seg.kind === 'video' && c.kind === 'video') {
            seg.id = makeId('clip');
            seg.trimIn = round(c.trimIn + (rStart - s) * c.speed);
          } else if (keepLeft) {
            seg.id = makeId('clip'); // ha a bal is megmarad, a jobbnak új id kell
          }
          out.push(seg);
        }
      }
      if (changed) {
        trackPatches.push({ trackType: track.type, clips: out });
      }
    }
    if (trackPatches.length === 0) {
      return false;
    }
    const ok = get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks: trackPatches,
      label: tr('store.editor.deleteRange', { seconds: span.toFixed(1) }),
    });
    if (ok) {
      set({
        rangeIn: null,
        rangeOut: null,
        selectedClipId: null,
        multiSelectIds: [],
        multiSelectMode: false,
        playhead: inT,
      });
    }
    return ok;
  },

  rollEdit: (clipId, edge, deltaSec) => {
    const { project } = get();
    if (!project) {
      return;
    }
    const found = findClip(project, clipId);
    if (!found) {
      return;
    }
    const track = found.track;
    const c = found.clip;
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((x) => x.id === clipId);
    const round = (n: number) => Math.round(n * 1000) / 1000;
    if (edge === 'right') {
      const next = sorted[idx + 1];
      if (!next || Math.abs(next.start - (c.start + c.duration)) > 0.05) {
        return; // roll csak érintkező szomszéddal
      }
      let d = clamp(deltaSec, MIN_CLIP_DURATION - c.duration, next.duration - MIN_CLIP_DURATION);
      if (c.kind === 'video') {
        d = Math.min(d, maxVideoDuration(c) - c.duration); // c forrás-vége
      }
      if (next.kind === 'video') {
        d = Math.max(d, -next.trimIn / next.speed); // next forrás-eleje
      }
      if (Math.abs(d) < 0.001) {
        return;
      }
      const newC = { ...c, duration: round(c.duration + d) } as Clip;
      const newNext = { ...next, start: round(next.start + d), duration: round(next.duration - d) } as Clip;
      if (newNext.kind === 'video' && next.kind === 'video') {
        newNext.trimIn = round(next.trimIn + d * next.speed);
      }
      const clips = track.clips.map((x) => (x.id === c.id ? newC : x.id === next.id ? newNext : x));
      get().dispatch({ type: 'REPLACE_TRACKS', tracks: [{ trackType: track.type, clips }], label: tr('store.editor.rollEdit') });
    } else {
      const prev = sorted[idx - 1];
      if (!prev || Math.abs(prev.start + prev.duration - c.start) > 0.05) {
        return;
      }
      let d = clamp(deltaSec, MIN_CLIP_DURATION - prev.duration, c.duration - MIN_CLIP_DURATION);
      if (prev.kind === 'video') {
        d = Math.min(d, maxVideoDuration(prev) - prev.duration); // prev forrás-vége
      }
      if (c.kind === 'video') {
        d = Math.max(d, -c.trimIn / c.speed); // c forrás-eleje
      }
      if (Math.abs(d) < 0.001) {
        return;
      }
      const newPrev = { ...prev, duration: round(prev.duration + d) } as Clip;
      const newC = { ...c, start: round(c.start + d), duration: round(c.duration - d) } as Clip;
      if (newC.kind === 'video' && c.kind === 'video') {
        newC.trimIn = round(c.trimIn + d * c.speed);
      }
      const clips = track.clips.map((x) => (x.id === prev.id ? newPrev : x.id === c.id ? newC : x));
      get().dispatch({ type: 'REPLACE_TRACKS', tracks: [{ trackType: track.type, clips }], label: tr('store.editor.rollEdit') });
    }
  },

  slipEdit: (clipId, deltaSec) => {
    const { project } = get();
    if (!project) {
      return;
    }
    const c = findClip(project, clipId)?.clip;
    if (!c || c.kind !== 'video') {
      return; // slip csak videón értelmes (forrás-ablak csúsztatás)
    }
    // drag jobbra → korábbi forrás-tartalom (trimIn csökken); a látható ablak = duration*speed
    const windowSrc = c.duration * c.speed;
    const newTrimIn = clamp(c.trimIn - deltaSec * c.speed, 0, Math.max(0, c.sourceDuration - windowSrc));
    if (Math.abs(newTrimIn - c.trimIn) < 0.001) {
      return;
    }
    get().updateClip(clipId, { trimIn: Math.round(newTrimIn * 1000) / 1000 });
  },

  slideEdit: (clipId, deltaSec) => {
    const { project } = get();
    if (!project) {
      return;
    }
    const found = findClip(project, clipId);
    if (!found) {
      return;
    }
    const track = found.track;
    const c = found.clip;
    const sorted = [...track.clips].sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((x) => x.id === clipId);
    const prev = sorted[idx - 1];
    const next = sorted[idx + 1];
    const touchingPrev = !!prev && Math.abs(prev.start + prev.duration - c.start) <= 0.05;
    const touchingNext = !!next && Math.abs(next.start - (c.start + c.duration)) <= 0.05;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    let d = deltaSec;
    if (touchingPrev) {
      d = Math.max(d, MIN_CLIP_DURATION - prev!.duration);
      if (prev!.kind === 'video') {
        d = Math.min(d, maxVideoDuration(prev!) - prev!.duration);
      }
    } else {
      d = Math.max(d, -c.start); // szomszéd nélkül csak a 0 a korlát
    }
    if (touchingNext) {
      d = Math.min(d, next!.duration - MIN_CLIP_DURATION);
      if (next!.kind === 'video') {
        d = Math.max(d, -next!.trimIn / next!.speed);
      }
    }
    if (Math.abs(d) < 0.001) {
      return;
    }
    const clips = track.clips.map((x) => {
      if (x.id === c.id) {
        return { ...x, start: round(x.start + d) } as Clip;
      }
      if (touchingPrev && x.id === prev!.id) {
        return { ...x, duration: round(x.duration + d) } as Clip;
      }
      if (touchingNext && x.id === next!.id) {
        const n = { ...x, start: round(x.start + d), duration: round(x.duration - d) } as Clip;
        if (n.kind === 'video' && x.kind === 'video') {
          n.trimIn = round(x.trimIn + d * x.speed);
        }
        return n;
      }
      return x;
    });
    get().dispatch({ type: 'REPLACE_TRACKS', tracks: [{ trackType: track.type, clips }], label: tr('store.editor.slideEdit') });
  },

  isTrackAudible: (type) => {
    const { mutedTracks, soloTracks } = get();
    // ha bármi solóban van, CSAK az szól — ez a szokásos keverőpult-logika
    return soloTracks.length > 0 ? soloTracks.includes(type) : !mutedTracks.includes(type);
  },

  setMultiSelectMode: (on) =>
    set(on ? { multiSelectMode: true } : { multiSelectMode: false, multiSelectIds: [] }),

  allSelectedIds: () => {
    const { selectedClipId, multiSelectIds } = get();
    return selectedClipId ? [selectedClipId, ...multiSelectIds] : [];
  },

  setPlayhead: (t) => {
    const { project } = get();
    const max = project ? Math.max(projectDuration(project), 0) : 0;
    set({ playhead: clamp(t, 0, Math.max(max, 0)) });
  },

  setPlaying: (playing) => set({ isPlaying: playing }),

  setLoop: (loop) => set({ loop }),

  setPlaybackRate: (rate) => set({ playbackRate: rate }),

  shuttle: (dir) => {
    // sebesség-létra: 1× → 2× → 4× (irány szerint előjelezve). Ellentétes irányba
    // koppintva először 1×-re vált, csak azonos irányban gyorsít tovább.
    const LADDER = [1, 2, 4];
    const cur = get().playbackRate;
    const sameDir = dir > 0 ? cur >= 1 : cur <= -1;
    const mag = sameDir ? LADDER[Math.min(LADDER.indexOf(Math.abs(cur)) + 1, LADDER.length - 1)] ?? 1 : 1;
    set({ playbackRate: dir * mag, isPlaying: true });
  },

  setBeatGrid: (beatTimes, downbeatTimes) => set({ beatTimes, downbeatTimes }),
  setVariantPreview: (ranges) => set({ variantPreview: ranges }),
  setPickTarget: (fn) => set({ pickTarget: fn }),

  setZoom: (zoom) => set({ zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) }),

  setPanel: (panel) => set({ activePanel: panel }),

  undo: () => {
    const { past, project, future } = get();
    if (!project || past.length === 0) {
      return;
    }
    const previous = past[past.length - 1];
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      // a kijelöléssel EGYÜTT a köteg is elévül: az undo után a klip-készlet
      // már más lehet (törölt/összevont klipek), árva köteg-id-k maradnának
      selectedClipId: null,
      multiSelectIds: [],
      multiSelectMode: false,
    });
  },

  redo: () => {
    const { past, project, future } = get();
    if (!project || future.length === 0) {
      return;
    }
    const [next, ...rest] = future;
    set({
      project: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: rest,
      dirty: true,
      // a kijelöléssel EGYÜTT a köteg is elévül: az undo után a klip-készlet
      // már más lehet (törölt/összevont klipek), árva köteg-id-k maradnának
      selectedClipId: null,
      multiSelectIds: [],
      multiSelectMode: false,
    });
  },

  openImageStudio: (clipId) => set({ imageStudioClipId: clipId }),
  closeImageStudio: () => set({ imageStudioClipId: null }),

  openAudioStudio: (clipId) => set({ audioStudioClipId: clipId }),
  closeAudioStudio: () => set({ audioStudioClipId: null }),

  markSaved: () => set({ dirty: false }),

  setRendered: (rendered) =>
    set((s) => (s.project ? { project: { ...s.project, rendered } } : s)),
}));

/** A kijelölt klip kényelmi selectora. */
export function selectSelectedClip(state: EditorState): Clip | null {
  if (!state.project || !state.selectedClipId) {
    return null;
  }
  return findClip(state.project, state.selectedClipId)?.clip ?? null;
}

/** Látszik-e ténylegesen panel — a képernyő ez alapján cseréli az idővonalat a panelre. */
export function selectPanelVisible(state: EditorState): boolean {
  if (!state.activePanel) {
    return false;
  }
  if (STANDALONE_PANELS.includes(state.activePanel)) {
    return true;
  }
  const clip = selectSelectedClip(state);
  if (!clip) {
    return false;
  }
  switch (state.activePanel) {
    case 'text':
      return clip.kind === 'text';
    case 'filter':
    case 'transition':
      return clip.kind === 'video' || clip.kind === 'image';
    case 'speed':
      return clip.kind === 'video';
    case 'hotspot':
      return clip.kind === 'interactive';
    case 'precision':
      return true;
    default:
      return false;
  }
}
