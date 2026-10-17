/**
 * 🧱 selection-slice — kijelölés (elsődleges + több-kijelölés) és vágólapok.
 *
 * Stílus-vágólap (copyStyle/pasteStyle) és egész-klip vágólap (copy/cut/pasteClips).
 * A projekt-írás itt is `get().dispatch(...)`-en megy (REPLACE_TRACKS / ADD_CLIPS).
 */
import { t as tr } from 'i18next';

import { extractStyle, styleTransferPatch } from '@/lib/batchEdit';
import { makeId } from '@/lib/id';
import { projectFps, snapToFrame } from '@/lib/frames';
import { canHostClip, findClip } from '@/lib/projectUtils';
import type { Clip, TrackType } from '@/types/project';

import { SESSION_RESET, STANDALONE_PANELS, type EditorState } from '../editorState';
import type { EditorSlice } from './types';

type SelectionSlice = Pick<
  EditorState,
  | 'selectedClipId'
  | 'multiSelectIds'
  | 'multiSelectMode'
  | 'styleClipboard'
  | 'clipClipboard'
  | 'selectClip'
  | 'toggleMultiSelect'
  | 'selectClips'
  | 'setMultiSelectMode'
  | 'allSelectedIds'
  | 'copyStyle'
  | 'pasteStyle'
  | 'copyClips'
  | 'cutClips'
  | 'pasteClipsAt'
  | 'canPasteTo'
>;

export const createSelectionSlice: EditorSlice<SelectionSlice> = (set, get) => ({
  selectedClipId: null,
  styleClipboard: null,
  clipClipboard: null,
  multiSelectIds: SESSION_RESET.multiSelectIds,
  multiSelectMode: SESSION_RESET.multiSelectMode,

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

  // ── 📋 klip-vágólap (egész klip cut/copy/paste; projektek közt is) ─────────
  copyClips: () => {
    const { project } = get();
    const ids = get().allSelectedIds();
    if (!project || ids.length === 0) {
      return 0;
    }
    const clips = ids
      .map((id) => findClip(project, id)?.clip)
      .filter((c): c is Clip => !!c)
      .map((c) => ({ ...c })); // a forrás-projekttől független másolat
    if (clips.length === 0) {
      return 0;
    }
    set({ clipClipboard: { kind: clips[0].kind, clips } });
    return clips.length;
  },

  cutClips: () => {
    const n = get().copyClips();
    if (n === 0) {
      return 0;
    }
    const { project } = get();
    if (!project) {
      return 0;
    }
    const ids = new Set(get().allSelectedIds());
    // a kijelölt klipek eltávolítása a sávjukról EGY undo-lépésben (nem ripple)
    const tracks = project.tracks
      .filter((tk) => tk.clips.some((c) => ids.has(c.id)))
      .map((tk) => ({ trackType: tk.type, clips: tk.clips.filter((c) => !ids.has(c.id)) }));
    const ok = get().dispatch({
      type: 'REPLACE_TRACKS',
      tracks,
      label: tr('store.editor.cutClips', { count: n, defaultValue: `Cut ${n} clip(s)` }),
    });
    if (ok) {
      set({ selectedClipId: null, multiSelectIds: [], multiSelectMode: false, activePanel: null });
    }
    return ok ? n : 0;
  },

  pasteClipsAt: (trackType, time) => {
    const { clipClipboard, project } = get();
    if (!clipClipboard || !project) {
      return 0;
    }
    const compatible = clipClipboard.clips.filter((c) => canHostClip(trackType, c.kind));
    if (compatible.length === 0) {
      return 0;
    }
    const minStart = Math.min(...compatible.map((c) => c.start));
    const base = Math.max(0, snapToFrame(time, projectFps(project)));
    // a horgony (legkorábbi klip) a frame-illesztett `base`-re ül; a többi a saját
    // relatív távolságát tartja (a `base` frame-pontossága nem rontható el kerekítéssel)
    const pasted = compatible.map(
      (c) =>
        ({
          ...c,
          id: makeId('clip'),
          start: Math.max(0, base + (c.start - minStart)),
        }) as Clip
    );
    const ok = get().dispatch({ type: 'ADD_CLIPS', trackType, clips: pasted });
    if (ok) {
      set({
        selectedClipId: pasted[0].id,
        multiSelectIds: pasted.slice(1).map((c) => c.id),
        multiSelectMode: pasted.length > 1,
      });
    }
    return ok ? pasted.length : 0;
  },

  canPasteTo: (trackType) => {
    const cb = get().clipClipboard;
    return !!cb && cb.clips.some((c) => canHostClip(trackType, c.kind));
  },

  setMultiSelectMode: (on) =>
    set(on ? { multiSelectMode: true } : { multiSelectMode: false, multiSelectIds: [] }),

  allSelectedIds: () => {
    const { selectedClipId, multiSelectIds } = get();
    return selectedClipId ? [selectedClipId, ...multiSelectIds] : [];
  },
});
