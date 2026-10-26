/**
 * 🧱 Szerkesztő-store — a felelősség-alapú zustand-slice-ok EGYETLEN kompozíciója.
 *
 * Az állapot és a metódusok a `./slices/*`-ben élnek (history/selection/clipEdit/
 * timelineMeta/collab/playback/view); mindegyik ugyanazt a teljes `EditorState`-et
 * látja a `set`/`get`-en át, így a felosztás pusztán SZERVEZÉSI — a publikus
 * hook-API (`useEditorStore`) bitre azonos a korábbi egyetlen `create()`-tel.
 *
 * MIÉRT: a store korábban egyetlen 1700+ soros fájl volt, egyszerre 6+ felelősséggel.
 * A slice-ozás a kohéziót állítja helyre a command-bus-invariáns megtartásával:
 * a projektet KIZÁRÓLAG a history-slice `dispatch`/`applyBatch`-e írja.
 */
import { create } from 'zustand';

import { videoPanelSpec } from '@/lib/panelSpecs';
import { findClip } from '@/lib/projectUtils';
import type { Clip } from '@/types/project';

import { STANDALONE_PANELS, type EditorState } from './editorState';
import { createClipEditSlice } from './slices/clipEditSlice';
import { createCollabSlice } from './slices/collabSlice';
import { createHistorySlice } from './slices/historySlice';
import { createPlaybackSlice } from './slices/playbackSlice';
import { createSelectionSlice } from './slices/selectionSlice';
import { createTimelineMetaSlice } from './slices/timelineMetaSlice';
import { createViewSlice } from './slices/viewSlice';

// ── Publikus re-exportok ─────────────────────────────────────────────────────
// A `@/store/editorStore` importok VÁLTOZATLANOK maradnak (a szimbólumok fizikailag
// a `./editorState` / `./broadcasters` modulokba kerültek, de innen is elérhetők).
export {
  PROXY_MAX_SIDE,
  SNAP_FACTOR,
  TRIM_MODES,
  DEFAULT_SNAP_TARGETS,
  type ProxyQuality,
  type InsightLane,
  type SnapStrength,
  type TrimMode,
  type SnapTargets,
  type PanelId,
  type EditorState,
} from './editorState';
export { setLiveBroadcaster, setLockBroadcaster } from './broadcasters';

export const useEditorStore = create<EditorState>()((...a) => ({
  ...createHistorySlice(...a),
  ...createSelectionSlice(...a),
  ...createClipEditSlice(...a),
  ...createTimelineMetaSlice(...a),
  ...createCollabSlice(...a),
  ...createPlaybackSlice(...a),
  ...createViewSlice(...a),
}));

/** A kijelölt klip kényelmi selectora. */
export function selectSelectedClip(state: EditorState): Clip | null {
  if (!state.project || !state.selectedClipId) {
    return null;
  }
  return findClip(state.project, state.selectedClipId)?.clip ?? null;
}

/**
 * 📐 A nyitott panel felület-szintje (MOBILE-UI §3): `null` = nincs látható panel.
 * A Strip csak akkor él, ha a gyors változat értelmes (pl. hangerő-strip csak
 * kijelölt hangklipre — klip nélkül a zene-hozzáadás lap jön sheet-ként).
 */
export function selectSurfaceTier(state: EditorState): 'strip' | 'sheet' | 'focus' | null {
  if (!selectPanelVisible(state)) {
    return null;
  }
  const spec = videoPanelSpec(state.activePanel);
  if (!spec) {
    return 'sheet';
  }
  if (spec.tier === 'focus' || (state.panelFocus && spec.canFocus)) {
    return 'focus';
  }
  if (spec.tier === 'strip' && !state.panelExpanded) {
    const clip = selectSelectedClip(state);
    if (state.activePanel === 'audio' && clip?.kind !== 'audio') {
      return 'sheet';
    }
    return 'strip';
  }
  return 'sheet';
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
