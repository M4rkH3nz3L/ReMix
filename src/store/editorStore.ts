import { t as tr } from 'i18next';
import { create } from 'zustand';

import { MAX_ZOOM, MIN_ZOOM } from '@/constants/editor';
import {
  applyBatchPatch,
  batchablePatch,
  extractStyle,
  styleTransferPatch,
} from '@/lib/batchEdit';
import { applyCommand } from '@/lib/commands';
import type { EditorCommand, EventActor, ProjectEvent } from '@/lib/commands';
import { makeId } from '@/lib/id';
import { findClip, projectDuration } from '@/lib/projectUtils';
import { buildRippleDeletePlan, buildRippleResizePlan } from '@/lib/ripple';
import { clamp } from '@/lib/time';
import type { BrushStyle } from '@/lib/draw';
import type { Asset, Clip, Project, TrackType } from '@/types/project';

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
  /** 🔗 link-csoportok (session-szintű): az egy csoportban lévő klipek együtt mozognak */
  linkGroups: string[][];
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
  /** 📐 vászon-rács osztása a snaphez (0 = nincs rács); session-szintű */
  snapGrid: number;
  /** 🛡️ safe-zone overlay az előnézeten (TikTok/Reels/YT UI-zónák); session-szintű */
  showSafeZones: boolean;
  /** 🎯 fókusz mód: kijelöléskor a TÖBBI idővonal-klip elhalványul; session-szintű */
  focusMode: boolean;
  /** ✂️ maszk-fogantyúk a vásznon (a Szűrők panelről kapcsolva) */
  maskEdit: boolean;
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
  closeProject: () => void;
  /**
   * Minden szerkesztő-művelet ezen megy át: validál, history-t és eventet ír.
   * Az AI is ezt használja (actor: 'ai'). false = érvénytelen/no-op.
   */
  dispatch: (command: EditorCommand, actor?: EventActor) => boolean;
  addClip: (trackType: TrackType, clip: Clip, asset?: Asset) => void;
  updateClip: (clipId: string, patch: Partial<Clip>) => void;
  removeClip: (clipId: string) => void;
  splitClipAt: (clipId: string, time: number) => boolean;
  selectClip: (clipId: string | null) => void;
  toggleMultiSelect: (clipId: string) => void;
  copyStyle: () => boolean;
  pasteStyle: () => number;
  toggleTrackFlag: (type: TrackType, flag: 'mute' | 'solo' | 'lock' | 'collapse') => void;
  /** sáv-magasság léptetése: 1× → 1.6× → 2.4× → 1× */
  cycleTrackHeight: (type: TrackType) => void;
  /** a TÖBB-kijelölt klipek együttes eltolása az idővonalon (csoport-mozgatás) */
  nudgeSelectedBy: (deltaSec: number) => void;
  /** megadott klipek együttes eltolása (csoport-clamppal) — link/selection közös magja */
  nudgeClipsBy: (ids: string[], deltaSec: number) => void;
  /** a klip link-csoportja (együtt mozgó klipek), vagy null */
  linkGroupOf: (clipId: string) => string[] | null;
  /** a jelenlegi több-kijelölés linkelése egy csoporttá (min. 2 klip) */
  linkSelected: () => void;
  /** a klipet tartalmazó link-csoport feloldása */
  unlinkClip: (clipId: string) => void;
  setRippleMode: (on: boolean) => void;
  setDrawBrush: (brush: EditorState['drawBrush']) => void;
  setSnapGrid: (grid: number) => void;
  toggleSafeZones: () => void;
  toggleFocusMode: () => void;
  setMaskEdit: (on: boolean) => void;
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
  rippleMode: false,
  snapGrid: 0,
  showSafeZones: false,
  focusMode: false,
  maskEdit: false,
  videoVoiceActive: false,
  mutedTracks: [] as TrackType[],
  soloTracks: [] as TrackType[],
  lockedTracks: [] as TrackType[],
  collapsedTracks: [] as TrackType[],
  trackHeightScale: {} as Partial<Record<TrackType, number>>,
  linkGroups: [] as string[][],
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
    set((s) => ({ trackHeightScale: { ...s.trackHeightScale, [type]: next } }));
  },

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

  linkGroupOf: (clipId) => get().linkGroups.find((g) => g.includes(clipId)) ?? null,

  linkSelected: () => {
    const { selectedClipId, multiSelectIds, linkGroups } = get();
    if (!selectedClipId || multiSelectIds.length === 0) {
      return; // legalább 2 klip kell a linkeléshez
    }
    // az új csoport + a beleérő MEGLÉVŐ csoportok összeolvasztása
    const merged = new Set<string>([selectedClipId, ...multiSelectIds]);
    const rest = linkGroups.filter((g) => {
      if (g.some((id) => merged.has(id))) {
        g.forEach((id) => merged.add(id));
        return false;
      }
      return true;
    });
    set({ linkGroups: [...rest, [...merged]] });
  },

  unlinkClip: (clipId) =>
    set((s) => ({ linkGroups: s.linkGroups.filter((g) => !g.includes(clipId)) })),

  setRippleMode: (on) => set({ rippleMode: on }),

  setDrawBrush: (brush) => set({ drawBrush: brush }),

  setSnapGrid: (grid) => set({ snapGrid: grid }),
  toggleSafeZones: () => set((s) => ({ showSafeZones: !s.showSafeZones })),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  setMaskEdit: (on) => set({ maskEdit: on }),

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
