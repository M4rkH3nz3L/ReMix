import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';

import { backupProjectToCloud } from '@/lib/cloudSync';
import { autosaveDelay } from '@/lib/editorScreenOps';
import { logCaught } from '@/lib/logCaught';
import {
  clearRecovery,
  duplicateProject,
  recordAutoVersion,
  saveProjectAndEvents,
  writeRecovery,
} from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/**
 * 💾 Mentés a szerkesztőben: autosave újrapróbálkozással, kilépéskori végső mentés,
 * „Mentés most" és „Mentés másként". A szerkesztő-képernyőből kiemelve — a két
 * effekt sorrendje az eredeti (a kilépő takarítás zárja a projektet).
 */
export function useAutosave({ dirty, project, t }: { dirty: boolean; project: Project | null; t: TFunction }) {
  // 💾 mentés-állapot: bukott-e az utolsó autosave, és hányadik újrapróbánál tartunk
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);

  // autosave: minden módosítás után rövid szünettel mentünk.
  // ⚠️ A mentés bukását NEM nyeljük el: a `saveAttempt` növelése újraindítja ezt
  // az effectet (a `dirty` és a `project` referencia ilyenkor változatlan, tehát
  // enélkül SOHA nem lenne újrapróbálkozás), a `saveFailed` pedig láthatóvá
  // teszi a felhasználónak, hogy a munkája nincs elmentve.
  useEffect(() => {
    if (!dirty || !project) {
      return;
    }
    // exponenciális visszalépés: 0,8 s → 1,6 s → 3,2 s … max 10 s
    const delay = autosaveDelay(saveAttempt);
    const timer = setTimeout(() => {
      const state = useEditorStore.getState();
      if (!state.project || !state.dirty) {
        return;
      }
      const snap = state.project;
      // 🛟 a FŐ (atomi) mentés ELŐTT recovery-pillanatkép — ha a mentés elhasal vagy
      // az app meghal, a legutóbbi állapot megmarad, és a következő indításkor felajánljuk
      writeRecovery(snap, state.events);
      // ⚛️ ATOMI: projekt + index + események egy írásban (vagy mind, vagy semmi)
      saveProjectAndEvents(snap, state.events)
        .then(() => {
          // a snap-et adjuk át: ha a mentés alatt szerkesztettek, piszkos marad (B6)
          useEditorStore.getState().markSaved(snap);
          setSaveFailed(false);
          setSaveAttempt(0);
          clearRecovery(snap.id); // a munka biztonságban → a recovery-kulcs törölhető
          // 🕓 autosave-előzmény (throttle-olt auto-verzió a történethez)
          recordAutoVersion(snap).catch((caught) => { logCaught('app/editor/[id].tsx:timer', caught); });
          // 🗄️ INGYENES felhő-backup (best-effort) — a projekt userhez mentve, ne vesszen el
          backupProjectToCloud(snap);
        })
        .catch((caught) => {
        logCaught('app/editor/[id].tsx:timer', caught);
          setSaveFailed(true);
          setSaveAttempt((n) => n + 1); // ← újrapróbálkozás; a recovery MARAD (nem mentett munka)
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [dirty, project, saveAttempt]);

  // kilépéskor végső mentés
  useEffect(() => {
    return () => {
      const state = useEditorStore.getState();
      if (state.project && state.dirty) {
        const p = state.project;
        writeRecovery(p, state.events);
        saveProjectAndEvents(p, state.events).then(() => clearRecovery(p.id)).catch((caught) => { logCaught('app/editor/[id].tsx:EditorScreen', caught); });
        backupProjectToCloud(p);
      }
      state.setPlaying(false);
      state.closeProject();
    };
  }, []);

  // 💾 explicit „Mentés most" — az autosave mellé (az atomi mentést AZONNAL hívja)
  const saveNow = () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const p = state.project;
    writeRecovery(p, state.events);
    saveProjectAndEvents(p, state.events)
      .then(() => {
        useEditorStore.getState().markSaved(p);
        setSaveFailed(false);
        setSaveAttempt(0);
        clearRecovery(p.id);
      })
      .catch((caught) => { logCaught('app/editor/[id].tsx:saveNow', caught); return setSaveFailed(true); });
  };

  // 🧬 „Mentés másként" — a jelenlegi mentése után egy MÁSOLAT, és ugrás rá
  const saveAsCopy = () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const p = state.project;
    saveProjectAndEvents(p, state.events)
      .then(() => duplicateProject(p.id, t('editorScreen.copySuffix')))
      .then((copy) => {
        if (copy) {
          router.replace(`/editor/${copy.id}`);
        }
      })
      .catch((caught) => { logCaught('app/editor/[id].tsx:saveAsCopy', caught); });
  };

  return { saveFailed, saveNow, saveAsCopy };
}
