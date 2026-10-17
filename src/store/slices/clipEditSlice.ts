/**
 * 🧱 clipEdit-slice — klip CRUD + geometria + struktúra.
 *
 * Facade a command-bus fölött: minden metódus `get().dispatch(...)`-et hív (vagy
 * egy másik facade-metódust), SOHA nem ír közvetlenül a `project`-be. A trim-matek
 * (roll/slip/slide/ripple) a `src/lib/`-ben él (store-mentes, tesztelt); itt a
 * projekt-keresés + dispatch marad.
 */
import { t as tr } from 'i18next';

import { applyBatchPatch, batchablePatch } from '@/lib/batchEdit';
import { makeId } from '@/lib/id';
import { projectFps, snapToFrame } from '@/lib/frames';
import { buildPreComposePlan } from '@/lib/preCompose';
import {
  compatibleTracksFor,
  findClip,
  trackEnd,
  trackOf,
} from '@/lib/projectUtils';
import { buildDeleteRangePlan } from '@/lib/rangeEdit';
import { buildRippleDeletePlan, buildRippleResizePlan } from '@/lib/ripple';
import { buildSourceClip } from '@/lib/sourceInsert';
import { buildRollEdit, buildSlideEdit, buildSlipEdit } from '@/lib/trimEdit';
import type { Clip, TrackType } from '@/types/project';

import type { EditorState } from '../editorState';
import type { EditorSlice } from './types';

type ClipEditSlice = Pick<
  EditorState,
  | 'addClip'
  | 'insertSourceAsset'
  | 'updateClip'
  | 'removeClip'
  | 'splitClipAt'
  | 'moveClip'
  | 'moveSelectedClipToNextTrack'
  | 'moveClipByTrackStep'
  | 'nudgeClipsBy'
  | 'nudgeSelectedBy'
  | 'linkGroupOf'
  | 'linkSelected'
  | 'preCompose'
  | 'unlinkClip'
  | 'rippleDelete'
  | 'rippleResize'
  | 'closeGapBefore'
  | 'deleteRange'
  | 'rollEdit'
  | 'slipEdit'
  | 'slideEdit'
>;

export const createClipEditSlice: EditorSlice<ClipEditSlice> = (set, get) => ({
  addClip: (trackType, clip, asset) => {
    if (get().dispatch({ type: 'ADD_CLIP', trackType, clip, asset })) {
      set({ selectedClipId: clip.id });
    }
  },

  insertSourceAsset: (asset, atSec) => {
    const { project, playhead } = get();
    if (!project) {
      return null;
    }
    // alap-pozíció (a korábbi Toolbar-insert viselkedése): videó/kép a video-sáv
    // végére, hang a lejátszófejnél; az `atSec` (pl. a drop-pozíció) felülírja
    const defaultStart = asset.kind === 'audio' ? playhead : trackEnd(trackOf(project, 'video'));
    const built = buildSourceClip(asset, atSec ?? defaultStart, () => makeId('clip'));
    if (!built) {
      return null;
    }
    get().addClip(built.trackType, built.clip, asset);
    return built.clip.id;
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
    // 🎞️ a vágás a projekt frame-rácsára ül (fél kocka csúszás már látszik)
    const snapped = snapToFrame(time, projectFps(get().project));
    return get().dispatch({ type: 'SPLIT_CLIP', clipId, time: snapped });
  },

  moveClip: (clipId, toTrackType, start) => {
    // 🎞️ a cél-kezdet a frame-rácsra ül (mint a split); 0 alá nem
    const snapped = Math.max(0, snapToFrame(start, projectFps(get().project)));
    return get().dispatch({ type: 'MOVE_CLIP', clipId, toTrackType, start: snapped });
  },

  moveSelectedClipToNextTrack: () => {
    const { project, selectedClipId } = get();
    if (!project || !selectedClipId) {
      return null;
    }
    const found = findClip(project, selectedClipId);
    if (!found) {
      return null;
    }
    // a klip-fajtát fogadó sávok körbe-léptetve; a klip a saját kezdetén marad
    const compat = compatibleTracksFor(found.clip.kind);
    if (compat.length < 2) {
      return null; // nincs másik kompatibilis sáv
    }
    const next = compat[(compat.indexOf(found.track.type) + 1) % compat.length];
    if (next === found.track.type) {
      return null;
    }
    return get().moveClip(selectedClipId, next, found.clip.start) ? next : null;
  },

  moveClipByTrackStep: (clipId, dir) => {
    const { project } = get();
    if (!project) {
      return null;
    }
    const found = findClip(project, clipId);
    if (!found) {
      return null;
    }
    const compat = compatibleTracksFor(found.clip.kind);
    const idx = compat.indexOf(found.track.type);
    if (idx < 0) {
      return null;
    }
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= compat.length) {
      return null; // a kompatibilis sávok szélén: nincs hova lépni (nem ciklikus)
    }
    const next = compat[nextIdx];
    return get().moveClip(clipId, next, found.clip.start) ? next : null;
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
    const plan = buildPreComposePlan(project, get().allSelectedIds());
    if (!plan) {
      return;
    }
    const label = tr('store.editor.preCompose', { count: plan.count });
    if (get().dispatch({ type: 'REPLACE_TRACKS', tracks: plan.tracks, label })) {
      set({ selectedClipId: plan.compound.id, multiSelectIds: [], multiSelectMode: false });
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

  deleteRange: () => {
    const { project, rangeIn, rangeOut, lockedTracks } = get();
    if (!project || rangeIn == null || rangeOut == null) {
      return false;
    }
    const tracks = buildDeleteRangePlan(project, rangeIn, rangeOut, lockedTracks);
    if (!tracks) {
      return false;
    }
    const seconds = (rangeOut - rangeIn).toFixed(1);
    const ok = get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks,
      label: tr('store.editor.deleteRange', { seconds }),
    });
    if (ok) {
      set({
        rangeIn: null,
        rangeOut: null,
        selectedClipId: null,
        multiSelectIds: [],
        multiSelectMode: false,
        playhead: rangeIn,
      });
    }
    return ok;
  },

  // ✂️ A trim-matematika a `lib/trimEdit.ts`-ben él (tesztelhető, store-mentes);
  // itt már csak a projekt-keresés és a dispatch marad.
  rollEdit: (clipId, edge, deltaSec) => {
    const { project } = get();
    const found = project ? findClip(project, clipId) : null;
    if (!found) {
      return;
    }
    const clips = buildRollEdit(found.track, clipId, edge, deltaSec);
    if (!clips) {
      return;
    }
    get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks: [{ trackType: found.track.type, clips }],
      label: tr('store.editor.rollEdit'),
    });
  },

  slipEdit: (clipId, deltaSec) => {
    const { project } = get();
    const c = project ? findClip(project, clipId)?.clip : null;
    if (!c || c.kind !== 'video') {
      return; // slip csak videón értelmes (forrás-ablak csúsztatás)
    }
    const trimIn = buildSlipEdit(c, deltaSec);
    if (trimIn === null) {
      return;
    }
    get().updateClip(clipId, { trimIn });
  },

  slideEdit: (clipId, deltaSec) => {
    const { project } = get();
    const found = project ? findClip(project, clipId) : null;
    if (!found) {
      return;
    }
    const clips = buildSlideEdit(found.track, clipId, deltaSec);
    if (!clips) {
      return;
    }
    get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks: [{ trackType: found.track.type, clips }],
      label: tr('store.editor.slideEdit'),
    });
  },
});
