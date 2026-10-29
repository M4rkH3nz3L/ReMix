/**
 * 🧱 history-slice — a command-/undo-motor + projekt-életciklus.
 *
 * Ez a store MAGJA: minden projekt-írás ezen a `dispatch`/`applyBatch`-en megy át
 * (a többi slice `get().dispatch(...)`-et hív, sosem ír közvetlenül a `project`-be).
 * A history teljes projekt-pillanatképeket tárol (max HISTORY_LIMIT), az
 * eseménynapló az AI-memória nyersanyaga (max EVENT_LIMIT).
 */
import { applyCommand, describeCommand } from '@/lib/commands';
import type { ProjectEvent } from '@/lib/commands';
import { isHeavyCommand, slimForLog } from '@/lib/eventLog';
import { coalesceKey, shouldCoalesce, type LastCommit } from '@/lib/historyCoalesce';
import { makeId } from '@/lib/id';
import { undoSyncCommands } from '@/lib/historySync';
import { findClip } from '@/lib/projectUtils';
import type { Project } from '@/types/project';

import { getLiveBroadcaster } from '../broadcasters';
import {
  EVENT_LIMIT,
  HISTORY_LIMIT,
  SESSION_RESET,
  touchedTrackTypes,
  type EditorState,
} from '../editorState';
import type { EditorSlice } from './types';

/** 👥 állapot-ugrás (undo/redo) broadcastja a társ-szerkesztőknek */
function broadcastStateJump(from: Project, to: Project): void {
  const send = getLiveBroadcaster();
  if (!send) return;
  const commands = undoSyncCommands(from, to);
  if (commands.length > 0) send(commands);
}

type HistorySlice = Pick<
  EditorState,
  | 'project'
  | 'past'
  | 'future'
  | 'pastLabels'
  | 'futureLabels'
  | 'dirty'
  | 'events'
  | 'loadProject'
  | 'restoreProject'
  | 'closeProject'
  | 'dispatch'
  | 'applyBatch'
  | 'undo'
  | 'redo'
  | 'jumpHistory'
  | 'markSaved'
  | 'setRendered'
>;

/**
 * 🔗 az utolsó (felhasználói) commit összevonási kulcsa + ideje — egy csúszka-húzás
 * egy history-lépés legyen (`@/lib/historyCoalesce`). Undo/redo/betöltés megszakítja.
 */
let lastCommit: LastCommit | null = null;

/**
 * Undo/redo utáni kijelölés: ami a célállapotban is létezik, az marad kijelölve; a
 * megszűnt klipek (törölt/összevont) kiesnek — így nem maradnak árva köteg-id-k.
 */
function keptSelection(
  state: Pick<EditorState, 'selectedClipId' | 'multiSelectIds' | 'multiSelectMode'>,
  target: Project
): Pick<EditorState, 'selectedClipId' | 'multiSelectIds' | 'multiSelectMode'> {
  const exists = (id: string) => findClip(target, id) !== null;
  const selectedClipId = state.selectedClipId && exists(state.selectedClipId) ? state.selectedClipId : null;
  const multiSelectIds = selectedClipId ? state.multiSelectIds.filter(exists) : [];
  return {
    selectedClipId,
    multiSelectIds,
    multiSelectMode: state.multiSelectMode && multiSelectIds.length > 0,
  };
}

export const createHistorySlice: EditorSlice<HistorySlice> = (set, get) => ({
  project: null,
  past: [],
  future: [],
  pastLabels: [],
  futureLabels: [],
  dirty: false,
  events: [],

  loadProject: (project, events) => {
    lastCommit = null;
    set({
      project,
      selectedClipId: null,
      playhead: 0,
      isPlaying: false,
      activePanel: null,
      past: [],
      future: [],
      pastLabels: [],
      futureLabels: [],
      dirty: false,
      events: events ?? [],
      ...SESSION_RESET,
    });
  },

  restoreProject: (snapshot) => {
    const { project, past, pastLabels } = get();
    if (!project) {
      return;
    }
    // a jelenlegi állapot a history-ba kerül → a visszaállítás egy undóval visszavonható
    set({
      project: snapshot,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      pastLabels: [...pastLabels.slice(-HISTORY_LIMIT + 1), 'Verzió visszaállítása'],
      futureLabels: [],
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
      pastLabels: [],
      futureLabels: [],
      dirty: false,
      events: [],
      ...SESSION_RESET,
    }),

  dispatch: (command, actor = 'user') => {
    const { project, past, pastLabels, events, lockedTracks } = get();
    if (!project) {
      return false;
    }
    // 🔒 core-guard: a zárolt sávra írás a MAGBAN is no-op — így az AI (actor:'ai')
    // és a programozott hívók sem kerülhetik meg a sáv-védelmet (eddig csak a UI tiltotta).
    // A 'remote' collab-visszajátszás kivétel: a társ-szerkesztő edítje authoritatív,
    // a saját lokális sáv-zárunk nem blokkolhatja (különben széthúzna a közös állapot).
    if (actor !== 'remote' && lockedTracks.length > 0) {
      const touched = touchedTrackTypes(project, command);
      if (touched.some((t) => lockedTracks.includes(t))) {
        return false;
      }
    }
    const next = applyCommand(project, command);
    if (next === null) {
      // 🪧 dev-only jelzés: a néma no-op (semmi nem változott) eddig nehezen volt
      // debugolható. Prodban néma (az API továbbra is sima `false`).
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[editor] no-op parancs (semmi nem változott): ${describeCommand(command)}`);
      }
      return false;
    }
    // 📉 a naplóba a KÖNNYÍTETT változat megy (a teljes klip-tömbök mérve 1,2 MB-ot
    // írtak újra minden autosave-nél); a `project`/`past` természetesen teljes marad
    const event: ProjectEvent = {
      id: makeId('evt'),
      at: new Date().toISOString(),
      actor,
      command: slimForLog(command),
      ...(isHeavyCommand(command) ? { slim: true as const } : {}),
    };
    // 🔗 összevonás: ugyanannak a folytonos szerkesztésnek a következő lépése (csúszka-húzás,
    // gyors léptetés) NEM új history-lépés — a húzás előtti állapot marad a visszaállítási pont
    const key = actor === 'user' ? coalesceKey(command) : null;
    const now = Date.now();
    if (past.length > 0 && shouldCoalesce(lastCommit, key, now)) {
      lastCommit = { key, at: now };
      set({
        project: next,
        future: [],
        futureLabels: [],
        dirty: true,
        events: [...events.slice(-EVENT_LIMIT + 1), event],
      });
      if (actor !== 'remote') {
        getLiveBroadcaster()?.([command]);
      }
      return true;
    }
    lastCommit = key ? { key, at: now } : null;
    // 🕓 history-címke: a parancs saját `label`-je (pl. UPSERT_IMAGE_DOC), vagy a leírása
    const stepLabel = (command as { label?: string }).label || describeCommand(command);
    set({
      project: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      pastLabels: [...pastLabels.slice(-HISTORY_LIMIT + 1), stepLabel],
      futureLabels: [],
      dirty: true,
      events: [...events.slice(-EVENT_LIMIT + 1), event],
    });
    // 👥 élő collab: a saját szerkesztést broadcastoljuk (a 'remote' visszajátszást nem)
    if (actor !== 'remote') {
      getLiveBroadcaster()?.([command]);
    }
    return true;
  },

  applyBatch: (commands, actor = 'ai') => {
    lastCommit = null;
    const { project, past, pastLabels, events, lockedTracks } = get();
    if (!project) {
      return 0;
    }
    let cur = project;
    const batchEvents: ProjectEvent[] = [];
    for (const command of commands) {
      // 🔒 core-guard: a zárolt sávot érintő parancsot kihagyjuk (user+ai); a 'remote' kivétel
      if (
        actor !== 'remote' &&
        lockedTracks.length > 0 &&
        touchedTrackTypes(cur, command).some((t) => lockedTracks.includes(t))
      ) {
        continue;
      }
      const next = applyCommand(cur, command);
      if (next !== null) {
        cur = next;
        batchEvents.push({
          id: makeId('evt'),
          at: new Date().toISOString(),
          actor,
          command: slimForLog(command),
          ...(isHeavyCommand(command) ? { slim: true as const } : {}),
        });
      }
    }
    if (batchEvents.length === 0) {
      return 0;
    }
    // EGYETLEN pre-batch pillanatkép a history-ba → egy undo visszavonja az egészet
    const batchLabel =
      (commands[commands.length - 1] as { label?: string } | undefined)?.label ||
      `${batchEvents.length} művelet`;
    set({
      project: cur,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      pastLabels: [...pastLabels.slice(-HISTORY_LIMIT + 1), batchLabel],
      futureLabels: [],
      dirty: true,
      events: [...events, ...batchEvents].slice(-EVENT_LIMIT),
    });
    // 👥 élő collab: a köteget EGY üzenetként broadcastoljuk (távoli oldalon is egy undo)
    if (actor !== 'remote') {
      getLiveBroadcaster()?.(commands);
    }
    return batchEvents.length;
  },

  undo: () => {
    lastCommit = null;
    const { past, project, future, pastLabels, futureLabels } = get();
    if (!project || past.length === 0) {
      return;
    }
    const previous = past[past.length - 1];
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future].slice(0, HISTORY_LIMIT),
      pastLabels: pastLabels.slice(0, -1),
      futureLabels: [pastLabels[pastLabels.length - 1] ?? '', ...futureLabels].slice(0, HISTORY_LIMIT),
      dirty: true,
      // a kijelölés MEGMARAD, ha a klip a visszaállított állapotban is létezik (a
      // felhasználó ugyanott folytathatja — élő teszt U1); a megszűnt klipek kiesnek
      ...keptSelection(get(), previous),
    });
    // 👥 élő collab: a visszavonás a társaknál is (célzott parancsok / pillanatkép — B7)
    broadcastStateJump(project, previous);
  },

  redo: () => {
    lastCommit = null;
    const { past, project, future, pastLabels, futureLabels } = get();
    if (!project || future.length === 0) {
      return;
    }
    const [next, ...rest] = future;
    const [nextLabel, ...restLabels] = futureLabels;
    set({
      project: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: rest,
      pastLabels: [...pastLabels.slice(-HISTORY_LIMIT + 1), nextLabel ?? ''],
      futureLabels: restLabels,
      dirty: true,
      ...keptSelection(get(), next),
    });
    broadcastStateJump(project, next);
  },

  // 🕓 ugrás a history-ban: delta<0 → |delta| undo, delta>0 → delta redo (lépésenként, biztonsággal)
  jumpHistory: (delta) => {
    const n = Math.trunc(delta);
    if (n < 0) {
      for (let i = 0; i < -n; i++) {
        get().undo();
      }
    } else {
      for (let i = 0; i < n; i++) {
        get().redo();
      }
    }
  },

  // 💾 B6: csak akkor „mentett", ha a mentett pillanatkép MÉG az aktuális állapot — a
  // mentés ALATT tett módosítás piszkos marad (különben bezáráskor elveszhetne)
  markSaved: (saved) => set((s) => (saved && s.project !== saved ? s : { dirty: false })),

  setRendered: (rendered) =>
    set((s) => (s.project ? { project: { ...s.project, rendered } } : s)),
});
