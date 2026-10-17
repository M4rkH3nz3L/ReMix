/**
 * 🧱 Az EditorState TÍPUSA + a store-szintű konstansok egyetlen helyen.
 *
 * MIÉRT külön a `editorStore.ts`-től: az állapotot ma felelősség-alapú
 * zustand-slice-ok adják (`./slices/*`), és MINDEN slice ugyanezt az `EditorState`
 * típust + ugyanezeket a konstansokat (SESSION_RESET, HISTORY_LIMIT, …) használja.
 * Egy közös, neutrális modul elkerüli a slice↔store körkörös importot.
 *
 * A publikus szimbólumokat (PanelId, SnapStrength, SNAP_FACTOR, …) a `editorStore.ts`
 * tovább-exportálja, hogy a `@/store/editorStore` importok változatlanok maradjanak.
 */
import { findClip } from '@/lib/projectUtils';
import type { EditorCommand, EventActor, ProjectEvent } from '@/lib/commands';
import type { LockBroadcast, LockMap } from '@/lib/clipLock';
import type { BrushStyle } from '@/lib/draw';
import type { PacingInsight } from '@/lib/pacingClient';
import type { Asset, ChapterKind, Clip, Project, TrackType } from '@/types/project';

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
export const REGION_COLORS = ['#7c5cff', '#4a9eff', '#2ecc8f', '#ffb454', '#ff5ca8', '#ff6b6b'];

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
export const STANDALONE_PANELS: PanelId[] = [
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

export const HISTORY_LIMIT = 50;
/** ennyi eseményt őrzünk meg projektenként (AI-memória nyersanyag) */
export const EVENT_LIMIT = 300;

/** a sáv-kapcsolók state-kulcsai — mind `TrackType[]`-et tárol */
export type TrackFlagKey =
  | 'mutedTracks'
  | 'soloTracks'
  | 'collapsedTracks'
  | 'hiddenTracks'
  | 'lockedTracks';

export interface EditorState {
  project: Project | null;
  selectedClipId: string | null;
  /** 🔒 élő klip-zárak (collab): clipId → zár. A realtime-broadcast tölti; a UI jelzi. */
  clipLocks: LockMap;
  /** a saját collab-identitás (a zár-tulajhoz); null = nincs élő collab */
  collabSelf: { id: string; name?: string } | null;
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
   * 📋 KLIP-vágólap (egész klip cut/copy/paste) — a `styleClipboard`-hoz hasonlóan
   * SZÁNDÉKOSAN nincs a SESSION_RESET-ben: projektek KÖZT is átvihető (a másolt
   * klipeket egy másik projektben is be lehet illeszteni). Azonos fajtájú klipek.
   */
  clipClipboard: { kind: Clip['kind']; clips: Clip[] } | null;
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
  /** 🔊 fő (master) lejátszási hangerő 0–1 — a preview/player minden hangját skálázza */
  masterVolume: number;
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
  /** 🕓 a history-lépések ember-olvasható címkéi (a past/future-rel LÉPÉSENKÉNT igazítva —
   *  tisztán kozmetikai a history-panelhez; az esetleges elcsúszás az undo HELYESSÉGÉT nem érinti) */
  pastLabels: string[];
  futureLabels: string[];
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
  /** 🗂️→🎬 a forrás-mappa egy assetét klipként a timeline-ra (opcionális `atSec` drop-pozíció) → az új klip id-je */
  insertSourceAsset: (asset: Asset, atSec?: number) => string | null;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  splitClipAt: (clipId: string, time: number) => boolean;
  /** klip másik (kompatibilis) sávra mozgatása + frame-illesztett új kezdet */
  moveClip: (clipId: string, toTrackType: TrackType, start: number) => boolean;
  /** a kijelölt klipet a KÖVETKEZŐ kompatibilis sávra lépteti (a kezdetét megtartva) → a cél-sáv típusa vagy null */
  moveSelectedClipToNextTrack: () => TrackType | null;
  /** ↕️ a klip EGY lépéssel a kompatibilis sávok közt a megadott irányba (drag-to-track);
   *  a szélen (nincs hova) no-op — NEM ciklikus, a fizikai húzás-szándékhoz illően. @returns az új sáv vagy null */
  moveClipByTrackStep: (clipId: string, dir: -1 | 1) => TrackType | null;
  selectClip: (clipId: string | null) => void;
  /** 🔒 collab klip-zár: identitás + zár-műveletek (broadcast + térkép-frissítés) */
  setCollabSelf: (self: { id: string; name?: string } | null) => void;
  applyRemoteLock: (msg: LockBroadcast) => void;
  acquireClipLock: (clipId: string) => void;
  releaseClipLock: (clipId: string) => void;
  pruneClipLocks: () => void;
  canEditClip: (clipId: string) => boolean;
  toggleMultiSelect: (clipId: string) => void;
  /** 🔎 több klip együttes kijelölése (pl. AI smart-select találatokból); az első
   *  lesz az elsődleges, a többi (azonos fajtájú) a köteg */
  selectClips: (ids: string[]) => void;
  copyStyle: () => boolean;
  pasteStyle: () => number;
  /** 📋 a kijelölt klip(ek) a KLIP-vágólapra (egész klip, nem csak stílus) — @returns darabszám */
  copyClips: () => number;
  /** 📋 a kijelölt klip(ek) kivágása: vágólapra + törlés a sávjukról — @returns darabszám */
  cutClips: () => number;
  /** 📋 a vágólap klipjei a cél-sávra a megadott időnél (új id-k, frame-illesztve) — @returns beillesztett darab */
  pasteClipsAt: (trackType: TrackType, time: number) => number;
  /** van-e a cél-sávra illeszthető klip a vágólapon (a UI Beilleszt-gombjához) */
  canPasteTo: (trackType: TrackType) => boolean;
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
  setMasterVolume: (v: number) => void;
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
  /** a lejátszófej beállítása; `snap:true` → a projekt frame-rácsára ül (scrub/koppintás) */
  setPlayhead: (t: number, snap?: boolean) => void;
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
  /** 🕓 ugrás a history-ban: delta<0 = ennyi undo, delta>0 = ennyi redo (egy állapot-cserében) */
  jumpHistory: (delta: number) => void;
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
export const SESSION_RESET = {
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
  masterVolume: 1,
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

/**
 * 🔒 Egy command által ÉRINTETT sáv-típus(ok) — a core-guardhoz (zárolt sáv).
 * Üres tömb = a parancs nem sáv-scope-os (pl. SET_FPS, markerek) → sosem blokkolt.
 */
export function touchedTrackTypes(project: Project, cmd: EditorCommand): TrackType[] {
  switch (cmd.type) {
    case 'ADD_CLIP':
    case 'ADD_CLIPS':
    case 'REPLACE_TRACK_CLIPS':
    case 'SET_TRACK_GAIN':
      return [cmd.trackType];
    case 'REPLACE_TRACKS':
      return cmd.tracks.map((t) => t.trackType);
    case 'UPDATE_CLIP':
    case 'REMOVE_CLIP':
    case 'SPLIT_CLIP': {
      const t = findClip(project, cmd.clipId)?.track.type;
      return t ? [t] : [];
    }
    case 'MOVE_CLIP': {
      // a mozgatás a FORRÁS és a CÉL sávot is érinti — bármelyik zárolt → tiltott
      const from = findClip(project, cmd.clipId)?.track.type;
      return from ? [from, cmd.toTrackType] : [cmd.toTrackType];
    }
    default:
      return [];
  }
}
