import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { t as tr } from 'i18next';
import { backupProjectToCloud } from '@/lib/cloudSync';
import {
  clearRecovery,
  readRecovery,
  recordAutoVersion,
  recoveryIsFresher,
  saveProjectAndEvents,
  writeRecovery,
} from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { logCaught } from '@/lib/logCaught';

/** szünet az utolsó módosítás után, mielőtt mentünk */
export const AUTOSAVE_MS = 800;

/** a következő mentési próba késleltetése: 0,8 s → 1,6 s → 3,2 s … max 10 s */
export function autosaveDelay(attempt: number): number {
  return attempt === 0 ? AUTOSAVE_MS : Math.min(AUTOSAVE_MS * 2 ** attempt, 10_000);
}

/** Azonnali, atomi mentés recovery-pillanatképpel (háttérbe lépés / kilépés / „Mentés most"). */
export function flushProjectSave(): Promise<boolean> {
  const state = useEditorStore.getState();
  if (!state.project || !state.dirty) {
    return Promise.resolve(true);
  }
  const snap = state.project;
  writeRecovery(snap, state.events);
  return saveProjectAndEvents(snap, state.events)
    .then(() => {
      useEditorStore.getState().markSaved(snap);
      void clearRecovery(snap.id);
      backupProjectToCloud(snap);
      return true;
    })
    .catch((caught) => { logCaught('hooks/useProjectAutosave.ts:flushProjectSave', caught); return false; });
}

/**
 * 💾 Közös autosave a store-vezérelt stúdió-képernyőknek (a videó-editor mintájára):
 *  - minden módosítás után rövid szünettel ATOMI mentés (projekt + események),
 *    előtte recovery-pillanatkép; bukásnál exponenciális újrapróba + `saveFailed`;
 *  - sikeres mentés után throttle-olt auto-verzió + felhő-backup;
 *  - 📱 háttérbe lépéskor AZONNALI mentés (az iOS bármikor kilőheti az appot);
 *  - 🛟 betöltéskor a mentettnél frissebb recovery-pillanatkép visszaállítását felajánlja.
 * `enabled=false` (még tölt / nincs projekt) → semmit nem csinál.
 */
export function useProjectAutosave(projectId: string | undefined, enabled: boolean) {
  const dirty = useEditorStore((s) => s.dirty);
  const project = useEditorStore((s) => s.project);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const active = enabled && !!projectId && project?.id === projectId;

  useEffect(() => {
    if (!active || !dirty) {
      return;
    }
    const timer = setTimeout(() => {
      const state = useEditorStore.getState();
      if (!state.project || !state.dirty || state.project.id !== projectId) {
        return;
      }
      const snap = state.project;
      writeRecovery(snap, state.events);
      saveProjectAndEvents(snap, state.events)
        .then(() => {
          // a snap-et adjuk át: ha a mentés alatt szerkesztettek, piszkos marad
          useEditorStore.getState().markSaved(snap);
          setSaveFailed(false);
          setSaveAttempt(0);
          void clearRecovery(snap.id);
          recordAutoVersion(snap).catch((caught) => { logCaught('hooks/useProjectAutosave.ts:timer', caught); });
          backupProjectToCloud(snap);
        })
        .catch((caught) => {
        logCaught('hooks/useProjectAutosave.ts:timer', caught);
          setSaveFailed(true);
          setSaveAttempt((n) => n + 1); // újrapróba; a recovery MARAD
        });
    }, autosaveDelay(saveAttempt));
    return () => clearTimeout(timer);
  }, [active, dirty, project, saveAttempt, projectId]);

  // 📱 háttérbe lépés → azonnali mentés
  useEffect(() => {
    if (!active) {
      return;
    }
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background' || st === 'inactive') {
        void flushProjectSave();
      }
    });
    return () => sub.remove();
  }, [active]);

  // 🛟 recovery-ajánlat — projektenként egyszer
  const offeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !projectId || offeredRef.current === projectId) {
      return;
    }
    offeredRef.current = projectId;
    const savedAt = useEditorStore.getState().project?.updatedAt;
    void readRecovery(projectId).then((rec) => {
      if (!rec || !recoveryIsFresher(rec.at, savedAt)) {
        return;
      }
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      Alert.alert(tr('editor.recovery.title'), tr('editor.recovery.message'), [
        { text: tr('editor.recovery.discard'), style: 'cancel', onPress: () => void clearRecovery(projectId) },
        {
          text: tr('editor.recovery.restore'),
          onPress: () => {
            if (useEditorStore.getState().project?.id === projectId) {
              useEditorStore.getState().restoreProject(rec.project);
            }
            void clearRecovery(projectId);
          },
        },
      ]);
    });
  }, [active, projectId]);

  return { saveFailed, dirty: active && dirty };
}
