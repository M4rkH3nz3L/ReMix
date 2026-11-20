import type { TFunction } from 'i18next';
import { router } from 'expo-router';
import { type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';

import { commitRendered } from '@/components/studio/image/body/exportCommon';
import type { createExportRasterizer } from '@/components/studio/image/body/exportRasterizer';
import { flushProjectSave } from '@/hooks/useProjectAutosave';
import { publishImageProject } from '@/lib/feed';
import { isRenderFresh } from '@/lib/imageExport';
import { linkableVideoProjects } from '@/lib/imageExportPlan';
import type { ImageShareMode } from '@/lib/imageShare';
import { sendStillToVideo } from '@/lib/linkedAssetClient';
import { logCaught } from '@/lib/logCaught';
import { listProjects, loadProject } from '@/lib/storage';
import { useActionMenu } from '@/store/actionMenuStore';
import { useEditorStore } from '@/store/editorStore';
import { useSeoGate } from '@/store/seoGateStore';
import type { ImageDoc, Project } from '@/types/project';
import type { PostVisibility } from '@/types/social';

type Rasterizer = ReturnType<typeof createExportRasterizer>;

export interface PublishDeps {
  t: TFunction;
  doc: ImageDoc | null;
  project: Project | null;
  pages: ImageDoc[];
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  rasterize: Rasterizer['rasterize'];
  alertRenderFail: Rasterizer['alertRenderFail'];
  onSave?: (doc: ImageDoc, renderedUri: string | null) => Promise<void>;
  onExit: () => void;
}

/**
 * 📲 A kép továbbadása: videóba küldés (új vagy meglévő projekt), feed-megosztás láthatóság-
 * választással és a scoped mentés. VISELKEDÉS-MEGŐRZŐ kiemelés a `useImageExport`-ból, hook nélküli
 * gyárként. `.tsx`: a fordítás-paritás őr innen is gyűjt.
 */
export function createPublishActions({ t, doc, project, pages, busy, setBusy, rasterize, alertRenderFail, onSave, onExit }: PublishDeps) {
  // 🖼️→🎬 CORE K2 (IMAGE-PROD C2): a lap HIVATKOZÁSKÉNT egy új vagy meglévő videó-projektbe. A kép a
  // telefonon készül, a klip a rétegeket is hordozza; a lap későbbi módosítása a videóban
  // „Frissítés elérhető” → egy koppintás, egy visszavonás.
  const sendToVideo = async (target: Awaited<ReturnType<typeof loadProject>>) => {
    if (!doc || !project || busy) {
      return;
    }
    setBusy(true);
    try {
      // előbb a kép-projekt mentése: a hivatkozás verziója a TÁROLT laphoz igazodjon
      await flushProjectSave();
      const fresh = useEditorStore.getState().project?.imageDocs?.find((d) => d.id === doc.id) ?? doc;
      const uri = await rasterize(fresh);
      if (!uri) {
        alertRenderFail();
        return;
      }
      const vid = await sendStillToVideo(project, fresh, uri, target, { newName: t('studio.image.videoName', { name: project.name }) });
      router.replace(`/editor/${vid.id}`);
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:sendToVideo', caught);
      Alert.alert(t('studio.image.toVideo.title'), (caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pickVideoProject = async () => {
    const metas = linkableVideoProjects(await listProjects(), project?.id);
    if (metas.length === 0) {
      Alert.alert(t('studio.image.toVideo.title'), t('studio.image.toVideo.noVideos'));
      return;
    }
    useActionMenu.getState().open(
      t('studio.image.toVideo.pickTitle'),
      metas.map((m) => ({
        label: m.name,
        icon: 'videocam-outline',
        onPress: () => {
          void loadProject(m.id).then((p) => (p ? sendToVideo(p) : undefined));
        },
      }))
    );
  };
  const insertIntoVideo = () => {
    useActionMenu.getState().open(t('studio.image.toVideo.title'), [
      { label: t('studio.image.toVideo.newLinked'), icon: 'link-outline', onPress: () => void sendToVideo(null) },
      { label: t('studio.image.toVideo.existing'), icon: 'film-outline', onPress: () => void pickVideoProject() },
    ]);
  };

  /**
   * 🖼️➡️📲 A galéria megosztása a FEEDBE — diavetítés (videó) vagy lapozható (carousel).
   * Előbb MINDEN lapot rasterizálunk (renderelt PNG), majd a `publishImageProject` a megfelelő
   * poszttá alakítja. (Felhő-funkció: a render/feltöltés a workert/tárat igényli — a free a
   * telefonon marad; a hiba barátságosan jelenik meg.)
   */
  // I43: a megosztás nem azonnal nyilvános — a user választ láthatóságot
  const confirmShare = (shareMode: ImageShareMode) => {
    Alert.alert(t('studio.image.shareFeed.confirmTitle'), t('studio.image.shareFeed.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.image.shareFeed.followers'), onPress: () => void shareToFeed(shareMode, 'followers') },
      { text: t('studio.image.shareFeed.public'), onPress: () => void shareToFeed(shareMode, 'public') },
    ]);
  };

  const shareToFeed = async (shareMode: ImageShareMode, visibility: PostVisibility) => {
    const s = useEditorStore.getState();
    if (!s.project || busy) {
      return;
    }
    // 📣 S22: a SEO a megosztáskor kell (létrehozáskor elhagyható volt) — hiányzik → bekéri
    if (!(await useSeoGate.getState().ensureSeo(s.project))) {
      return;
    }
    setBusy(true);
    try {
      for (const p of pages) {
        // I41: a szerkesztés után elavult képet nem osztjuk meg
        if (!isRenderFresh(p)) {
          const uri = await rasterize(p);
          if (!uri) {
            // I12: inkább nem osztunk meg semmit, mint rossz lapot
            alertRenderFail();
            return;
          }
          commitRendered(p.id, uri);
        }
      }
      const fresh = useEditorStore.getState().project;
      if (!fresh) {
        return;
      }
      await publishImageProject(fresh, shareMode, { visibility });
      Alert.alert(
        t('studio.image.shareFeed.doneTitle', { defaultValue: 'Megosztva' }),
        t('studio.image.shareFeed.doneBody', { defaultValue: 'A poszt felkerült a feedbe.' })
      );
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:shareToFeed', e);
      Alert.alert(t('common.error'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveScoped = async () => {
    if (!doc || busy) {
      onExit();
      return;
    }
    if (!onSave) {
      onExit();
      return;
    }
    setBusy(true);
    try {
      const uri = await rasterize(doc);
      await onSave(doc, uri);
    } finally {
      setBusy(false);
    }
  };

  return { insertIntoVideo, confirmShare, saveScoped };
}
