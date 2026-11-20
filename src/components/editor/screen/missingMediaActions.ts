import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { logCaught } from '@/lib/logCaught';
import { findAutoRelinkPairs, findMissingMedia, pickRelinkPairs, relinkCommandsFor } from '@/lib/videdFile';
import type { MissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🩹 A hiányzó média kézi helyreállításának akciói (CORE §2.8): újracsatolás
 * (mind / egyenként), pótlás az átviteli tárból és .rp csomagból — mind
 * undo-safe, a command buson. A szerkesztő-képernyőből kiemelve; a képernyő
 * minden renderben újra létrehozza (mint korábban a záródásokat).
 */
export function createMissingMediaActions({
  t,
  missingMedia,
  relinking,
  setRelinking,
  setMissingMedia,
  setMissingSheetOpen,
  setTransferSize,
}: {
  t: TFunction;
  missingMedia: MissingMedia[];
  relinking: boolean;
  setRelinking: (relinking: boolean) => void;
  setMissingMedia: (missing: MissingMedia[]) => void;
  setMissingSheetOpen: (open: boolean) => void;
  setTransferSize: (size: number | null) => void;
}) {
  /** Újracsatolás: előbb tartalom-egyezés alapján automatikusan, a maradékra kézi választó. */
  const relinkMissing = async () => {
    const state = useEditorStore.getState();
    if (!state.project || relinking) {
      return;
    }
    setRelinking(true);
    try {
      const auto = await findAutoRelinkPairs(state.project, missingMedia);
      // 🔗 ADR-012: a média-relink asset-centrikus (RELINK_ASSET), a shape-imageUri RELINK_URI
      for (const cmd of relinkCommandsFor(state.project, auto)) {
        state.dispatch(cmd, 'system');
      }
      let current = useEditorStore.getState().project;
      let remaining = current ? findMissingMedia(current) : [];
      if (remaining.length > 0) {
        const manual = await pickRelinkPairs(remaining);
        const proj = useEditorStore.getState().project;
        if (proj) {
          for (const cmd of relinkCommandsFor(proj, manual)) {
            useEditorStore.getState().dispatch(cmd, 'user');
          }
        }
        current = useEditorStore.getState().project;
        remaining = current ? findMissingMedia(current) : [];
      }
      setMissingMedia(remaining);
      if (remaining.length === 0) {
        setMissingSheetOpen(false);
      }
    } finally {
      setRelinking(false);
    }
  };

  /** 🩹 Per-fájl kézi újracsatolás (CORE §2.8): egyetlen hiányzó fájl relinkje —
   *  egy fájl bukása/hiánya nem akasztja a többit. A `relinkMissing` auto+kézi
   *  flow-ját tükrözi, de csak a kiválasztott elemre. */
  const relinkOne = async (item: MissingMedia) => {
    const state = useEditorStore.getState();
    if (!state.project || relinking) {
      return;
    }
    setRelinking(true);
    try {
      const pairs = await pickRelinkPairs([item]);
      const proj = useEditorStore.getState().project;
      if (proj && pairs.length > 0) {
        for (const cmd of relinkCommandsFor(proj, pairs)) {
          useEditorStore.getState().dispatch(cmd, 'user');
        }
      }
      const current = useEditorStore.getState().project;
      const remaining = current ? findMissingMedia(current) : [];
      setMissingMedia(remaining);
      if (remaining.length === 0) {
        setMissingSheetOpen(false);
      }
    } finally {
      setRelinking(false);
    }
  };

  const restoreFromTransfer = () => {
    // 📲 átviteli tár: a másik eszközön feltöltött .rp letöltése + pontos pótlás
    const run = async () => {
      const proj = useEditorStore.getState().project;
      if (!proj) {
        return;
      }
      setRelinking(true);
      try {
        const res = await import('@/lib/transferClient').then((m) =>
          m.restoreProjectFromTransfer(proj)
        );
        if (!res) {
          setTransferSize(null); // lejárt/eltűnt — a gomb tűnjön el
          Alert.alert(t('editor.missingSheet.title'), t('editor.missingSheet.transferGone'));
          return;
        }
        const store = useEditorStore.getState();
        if (res.pairs.length > 0 && store.project?.id === proj.id) {
          store.applyBatch(
            res.pairs.map((p) => ({
              type: 'RELINK_URI' as const,
              oldUri: p.oldUri,
              newUri: p.newUri,
            })),
            'system'
          );
        }
        const remaining = findMissingMedia(useEditorStore.getState().project!);
        setMissingMedia(remaining);
        setTransferSize(null); // sikeres átvétel után a csomag törlődik
        if (remaining.length === 0) {
          setMissingSheetOpen(false);
        }
        Alert.alert(
          t('editor.missingSheet.title'),
          t('editor.missingSheet.fromRpResult', {
            count: res.pairs.length,
            remaining: remaining.length,
          })
        );
      } catch (e) {
        logCaught('app/editor/[id].tsx:run', e);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      } finally {
        setRelinking(false);
      }
    };
    void run();
  };

  const restoreFromRp = () => {
    // 📲 felhő nélküli eszközváltás: a másik eszközről (AirDrop/Fájlok)
    // áthozott .rp csomagból PONT a hiányzók pótlódnak, undo-safe relinkkel
    const run = async () => {
      const proj = useEditorStore.getState().project;
      if (!proj) {
        return;
      }
      setRelinking(true);
      try {
        const res = await import('@/lib/rpFile').then((m) =>
          m.pickAndRestoreMissingFromRp(proj)
        );
        if (!res) {
          return; // mégse
        }
        const store = useEditorStore.getState();
        if (res.pairs.length > 0 && store.project?.id === proj.id) {
          store.applyBatch(
            res.pairs.map((p) => ({
              type: 'RELINK_URI' as const,
              oldUri: p.oldUri,
              newUri: p.newUri,
            })),
            'system'
          );
        }
        const remaining = findMissingMedia(useEditorStore.getState().project!);
        setMissingMedia(remaining);
        if (remaining.length === 0) {
          setMissingSheetOpen(false);
        }
        Alert.alert(
          t('editor.missingSheet.fromRp'),
          t('editor.missingSheet.fromRpResult', {
            count: res.pairs.length,
            remaining: remaining.length,
          })
        );
      } catch (e) {
        logCaught('app/editor/[id].tsx:run', e);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      } finally {
        setRelinking(false);
      }
    };
    void run();
  };

  return { relinkMissing, relinkOne, restoreFromTransfer, restoreFromRp };
}
