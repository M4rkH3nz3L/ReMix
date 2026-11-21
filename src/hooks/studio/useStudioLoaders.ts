import { useFocusEffect } from 'expo-router';
import type { TFunction } from 'i18next';
import { type Dispatch, type SetStateAction, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';

import { isMyAccountDeleted, reactivateAccount } from '@/lib/account';
import { listSharedWithMe, type SharedProject } from '@/lib/collab';
import { syncProjectsFromCloud } from '@/lib/cloudSync';
import { listProjects } from '@/lib/storage';
import { visibleProjects } from '@/lib/projectKinds';
import { projectStorageMap } from '@/lib/storageQuota';
import type { ProjectMeta } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 🔄 A projekt-lista betöltése (fókuszkor), az egyszeri felhő-visszatöltés és a deaktivált-fiók
 * prompt (REFACTOR: a useStudio-ból, az eredeti hook- és effekt-sorrendben). Visszaadja a `refresh`-t.
 */
export function useStudioLoaders({
  t,
  setProjects,
  setShared,
  setStorageMap,
}: {
  t: TFunction;
  setProjects: Dispatch<SetStateAction<ProjectMeta[]>>;
  setShared: Dispatch<SetStateAction<SharedProject[]>>;
  setStorageMap: Dispatch<SetStateAction<Record<string, number>>>;
}) {
  const refresh = useCallback(() => {
    // ⚡ fókuszkor csak a HELYI lista (olcsó); a felhő-visszatöltés egyszer, mountkor fut
    // 🔒 az ezen az eszközön nem elérhető fajták (LiDAR nélkül a 3D) rejtve — nem törölve
    listProjects().then((all) => setProjects(visibleProjects(all))).catch((caught) => { logCaught('hooks/useStudio.ts:refresh', caught); });
    // 👥 velem megosztott projektek (felhő, ha be van jelentkezve; egyébként [])
    listSharedWithMe().then(setShared).catch((caught) => { logCaught('hooks/useStudio.ts:refresh', caught); });
    // 🗄️ per-projekt MI-tárhely-használat (a MI tárolónkon foglalt pontos bájt)
    projectStorageMap().then(setStorageMap).catch((caught) => { logCaught('hooks/useStudio.ts:refresh', caught); });
  }, [setProjects, setShared, setStorageMap]);

  useFocusEffect(refresh);

  // 🗄️ EGYSZERI felhő-visszatöltés belépéskor (NEM minden fókuszkor — perf): a
  // helyileg HIÁNYZÓ projekteket hozza vissza (újratelepítés/eszközváltás után).
  useEffect(() => {
    syncProjectsFromCloud()
      .then((n) => {
        if (n > 0) {
          refresh();
        }
      })
      .catch((caught) => { logCaught('hooks/useStudio.ts:useStudio', caught); });
  }, [refresh]);

  // 🗑️ deaktivált fiók → helyreállítás-prompt belépés után (a tartalom addig rejtve)
  useEffect(() => {
    isMyAccountDeleted()
      .then((d) => {
        if (!d) {
          return;
        }
        Alert.alert(t('gdpr.deactivatedTitle'), t('gdpr.deactivatedBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('gdpr.reactivate'),
            onPress: () => reactivateAccount().then(refresh).catch((caught) => { logCaught('hooks/useStudio.ts:useStudio', caught); }),
          },
        ]);
      })
      .catch((caught) => { logCaught('hooks/useStudio.ts:useStudio', caught); });
  }, [refresh, t]);

  return refresh;
}
