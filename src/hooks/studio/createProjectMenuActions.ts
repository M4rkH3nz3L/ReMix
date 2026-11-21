import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { deleteCloudProject } from '@/lib/cloudSync';
import { deletePostsForProject, publishRenderedProject } from '@/lib/feed';
import { makeId } from '@/lib/id';
import { deleteProject, loadProject, saveProject } from '@/lib/storage';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import { useSeoGate } from '@/store/seoGateStore';
import type { ProjectMeta } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 📋 A projekt-kártya menüje (REFACTOR: a useStudio-ból) — hook-mentes csoport, minden renderben
 * újra létrehozva: törlés, duplikálás, átnevezés, feed-megosztás, maga a menü.
 */
export function createProjectMenuActions({
  t,
  refresh,
  renaming,
  setRenaming,
  renameValue,
  setRenameValue,
}: {
  t: TFunction;
  refresh: () => void;
  renaming: ProjectMeta | null;
  setRenaming: Dispatch<SetStateAction<ProjectMeta | null>>;
  renameValue: string;
  setRenameValue: Dispatch<SetStateAction<string>>;
}) {
  const confirmDelete = (meta: ProjectMeta) => {
    Alert.alert(t('home.deleteTitle'), t('home.deleteMessage', { name: meta.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          // „nincs projekt → nincs videó": helyi törlés + a projekthez tartozó
          // feed-posztok törlése + a felhő-projekt törlése (a DB-trigger defenzíven
          // szintén törli a posztokat, pl. még-nem-mentett felhő esetén is fedve).
          deleteProject(meta.id)
            .then(() => Promise.all([deletePostsForProject(meta.id), deleteCloudProject(meta.id)]))
            .then(refresh)
            .catch((caught) => { logCaught('hooks/useStudio.ts:confirmDelete', caught); });
        },
      },
    ]);
  };

  const duplicate = (meta: ProjectMeta) => {
    loadProject(meta.id)
      .then((p) => {
        if (!p) {
          return;
        }
        return saveProject({
          ...p,
          id: makeId('prj'),
          name: `${p.name}${t('home.copySuffix')}`,
          createdAt: new Date().toISOString(),
          // 🔀 remix-lineage: az új projekt az eredetiből készült
          remixOf: { projectId: p.id, name: p.name },
          // 📁 a másolat SAJÁT mappát kap a betöltéskor (a fájlokat átmásolja), a
          // szinkron projektenként külön döntés → alapból ki
          folder: undefined,
          syncToRemix: undefined,
        });
      })
      .then(refresh)
      .catch((caught) => { logCaught('hooks/useStudio.ts:duplicate', caught); return Alert.alert(t('common.error'), t('home.duplicateFailed')); });
  };

  const startRename = (meta: ProjectMeta) => {
    setRenaming(meta);
    setRenameValue(meta.name);
  };

  const saveRename = () => {
    const meta = renaming;
    const nextName = renameValue.trim();
    setRenaming(null);
    if (!meta || !nextName || nextName === meta.name) {
      return;
    }
    loadProject(meta.id)
      .then((p) => (p ? saveProject({ ...p, name: nextName }) : undefined))
      .then(refresh)
      .catch((caught) => { logCaught('hooks/useStudio.ts:saveRename', caught); return Alert.alert(t('common.error'), t('home.renameFailed')); });
  };

  const shareToFeed = (meta: ProjectMeta, remixTracks?: boolean) => {
    // 🔀 C3: hang-projektnél az alkotó dönt — a remix a sávokat is megkapja-e (alapból nem)
    if (meta.kind === 'audio' && remixTracks === undefined) {
      Alert.alert(t('feed.remixTracksTitle'), t('feed.remixTracksBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('feed.remixTracksNo'), onPress: () => shareToFeed(meta, false) },
        { text: t('feed.remixTracksYes'), onPress: () => shareToFeed(meta, true) },
      ]);
      return;
    }
    loadProject(meta.id)
      .then(async (loaded) => {
        // 📣 S22: a SEO a megosztáskor kell — hiányzik → bekéri, megszakításkor nem posztol
        const p = loaded ? await useSeoGate.getState().ensureSeo(loaded) : null;
        if (!p) {
          return;
        }
        // render (ha kell) → feltöltés → posztolás; Pro-kapu a felhő-renderre
        return guardPro(
          () =>
            withProgress(t('feed.rendering'), (report) => publishRenderedProject(p, report, remixTracks ? { remixTracks } : undefined)).then(
              (res) => {
                if (res) {
                  refresh();
                  Alert.alert(t('feed.shareToFeed'), t('feed.sharedOk'), [
                    { text: t('common.ok') },
                    { text: t('nav.feed'), onPress: () => router.push('/') },
                  ]);
                }
              }
            ),
          (e) => Alert.alert(t('common.error'), e.message)
        );
      })
      .catch((e: Error) => { logCaught('hooks/useStudio.ts:shareToFeed', e); return Alert.alert(t('common.error'), e.message); });
  };

  const projectMenu = (meta: ProjectMeta) => {
    Alert.alert(meta.name, undefined, [
      // 🧊 a 3D-projektnek nincs idővonala → a feed-megosztás (render) üres lenne; a modell
      // képként/videóként a 3D Stúdió Export lapjáról vagy a videószerkesztőből osztható
      ...(meta.kind === 'model3d' ? [] : [{ text: t('feed.shareToFeed'), onPress: () => shareToFeed(meta) }]),
      { text: t('common.rename'), onPress: () => startRename(meta) },
      { text: t('common.duplicate'), onPress: () => duplicate(meta) },
      { text: t('collab.share'), onPress: () => router.push(`/collab/${meta.id}`) },
      {
        text: t('storage.projectStorage'),
        onPress: () => router.push({ pathname: '/storage', params: { project: meta.id } } as Href),
      },
      { text: t('common.delete'), style: 'destructive', onPress: () => confirmDelete(meta) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  return { confirmDelete, duplicate, startRename, saveRename, shareToFeed, projectMenu };
}
