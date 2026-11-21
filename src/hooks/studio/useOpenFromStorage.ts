import { router, useLocalSearchParams } from 'expo-router';
import type { TFunction } from 'i18next';
import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { fileKindOf, studioForKind } from '@/lib/remixFiles';
import { importFromStorage } from '@/lib/storageImport';
import type { Asset, ProjectKind } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 🗂️→🎬 „Új projekt ebből” a Tárhelyemből (REFACTOR: a useStudio-ból, az eredeti hook-sorrendben):
 * a route-paraméterekből egyszer megnyitja a kitöltött Új projekt űrlapot.
 */
export function useOpenFromStorage({
  t,
  resetCreateForm,
  setKind,
  setName,
  setSources,
  setCreating,
}: {
  t: TFunction;
  resetCreateForm: () => void;
  setKind: Dispatch<SetStateAction<ProjectKind>>;
  setName: Dispatch<SetStateAction<string>>;
  setSources: Dispatch<SetStateAction<Asset[]>>;
  setCreating: Dispatch<SetStateAction<boolean>>;
}) {
  // 🗂️→🎬 „Új projekt ebből" a Tárhelyemből: a fájl forrásként, a fajtájának megfelelő
  // stúdióval és a fájlnévből képzett névvel nyitja az Új projekt űrlapot (a SEO-mezőket
  // a user tölti ki). A fájl a projekt első megnyitásakor a projekt-mappájába kerül.
  const openParams = useLocalSearchParams<{ openLoc?: string; openPath?: string; openUri?: string }>();
  const handledOpen = useRef<string | null>(null);
  useEffect(() => {
    const { openLoc, openPath, openUri } = openParams;
    if (!openPath || (openLoc !== 'device' && openLoc !== 'remix')) {
      return;
    }
    const key = `${openLoc}:${openPath}`;
    if (handledOpen.current === key) {
      return;
    }
    handledOpen.current = key;
    const fileName = openPath.slice(openPath.lastIndexOf('/') + 1);
    const studio = studioForKind(fileKindOf(fileName));
    if (!studio) {
      return;
    }
    void importFromStorage({ location: openLoc, path: openPath, name: fileName, isFolder: false, uri: openUri })
      .then((asset) => {
        if (!asset) {
          return;
        }
        resetCreateForm();
        setKind(studio);
        setName(fileName.replace(/\.[^.]+$/, ''));
        setSources([asset]);
        setCreating(true);
      })
      .catch((e: Error) => { logCaught('hooks/useStudio.ts:useStudio', e); return Alert.alert(t('common.error'), e.message); })
      .finally(() => router.setParams({ openLoc: undefined, openPath: undefined, openUri: undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a paraméter-kulcsok a valódi trigger; a resetCreateForm stabil setterekből áll, a t stabil
  }, [openParams.openLoc, openParams.openPath, openParams.openUri]);
}
