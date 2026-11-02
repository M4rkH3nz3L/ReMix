import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { flushProjectSave, useProjectAutosave } from '@/hooks/useProjectAutosave';
import { pullProject } from '@/lib/cloudSync';
import { logCaught } from '@/lib/logCaught';
import { mediaRemoteMap, restoreMissingMedia } from '@/lib/mediaSync';
import { goBackOrHome } from '@/lib/nav';
import { findMissingMedia, pickRelinkPairs, relinkCommandsFor, type MissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';

/**
 * 💾 Közös stúdió-munkamenet: autosave és helyreállítás, kilépés mentéssel, hiányzó média
 * visszatöltése a szerver-másolatból. Ami így sem jön vissza, azt a hívó sávja jelzi.
 */
export function useStudioSession(id: string, loading: boolean) {
  const { t } = useTranslation();
  const { saveFailed } = useProjectAutosave(id, !loading);
  const [missing, setMissing] = useState<MissingMedia[]>([]);
  const [relinking, setRelinking] = useState(false);

  useEffect(() => {
    if (loading) {
      return;
    }
    let alive = true;
    void (async () => {
      const proj = useEditorStore.getState().project;
      if (!proj || proj.id !== id || findMissingMedia(proj).length === 0) {
        return;
      }
      let remote = mediaRemoteMap(proj);
      if (Object.keys(remote).length === 0) {
        const cloud = await pullProject(proj.id).catch((caught) => { logCaught('hooks/useStudioSession.ts:pull', caught); return null; });
        remote = cloud ? mediaRemoteMap(cloud) : remote;
      }
      const { pairs } = await restoreMissingMedia(proj, remote);
      const store = useEditorStore.getState();
      if (!alive || store.project?.id !== id) {
        return;
      }
      if (pairs.length > 0) {
        store.applyBatch(relinkCommandsFor(store.project, pairs), 'system');
      }
      setMissing(findMissingMedia(useEditorStore.getState().project!));
    })();
    return () => {
      alive = false;
    };
  }, [loading, id]);

  const relink = async () => {
    if (relinking) {
      return;
    }
    setRelinking(true);
    try {
      const pairs = await pickRelinkPairs(missing);
      const store = useEditorStore.getState();
      if (store.project?.id !== id) {
        return;
      }
      if (pairs.length > 0) {
        store.applyBatch(relinkCommandsFor(store.project, pairs), 'user');
      }
      setMissing(findMissingMedia(useEditorStore.getState().project!));
    } finally {
      setRelinking(false);
    }
  };

  // 🚪 kilépés előtt azonnali mentés; ha nem sikerül, a user dönt (nem vész el csendben)
  const exit = () => {
    void flushProjectSave().then((ok) => {
      if (ok) {
        goBackOrHome();
        return;
      }
      Alert.alert(t('studio.image.unsaved.title'), t('studio.image.unsaved.message'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('studio.image.unsaved.leave'), style: 'destructive', onPress: () => goBackOrHome() },
      ]);
    });
  };

  return { saveFailed, missing, relinking, relink, exit };
}
