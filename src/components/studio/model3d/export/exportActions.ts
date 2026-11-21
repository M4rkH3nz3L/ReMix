import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { RefObject } from 'react';
import { Alert } from 'react-native';

import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { hasRotation, lookOptionsJson } from '@/lib/model3dLook';
import { formatArea } from '@/lib/model3dMeasure';
import { createEmptyProject } from '@/lib/projectUtils';
import { Remix3D, remix3dErrorKey, type ModelViewHandle } from '@/lib/remix3dNative';
import { floorPlanImageDoc } from '@/lib/roomFloorPlan';
import { saveProject } from '@/lib/storage';
import type { Model3DDoc, Model3DMesh } from '@/types/model3d';
import type { Asset, Project } from '@/types/project';

export interface ExportActionDeps {
  t: TFunction;
  project: Project | null;
  doc: Model3DDoc | undefined;
  mesh: Model3DMesh | undefined;
  asset: Asset | undefined;
  viewRef: RefObject<ModelViewHandle | null>;
}

/**
 * 📤 A modell KIVITELE a stúdióból hook nélkül (REFACTOR: a Model3DStudio.tsx-ből): alaprajz
 * kép-projektként, AR Gyorsnézet, a látható nézet képe az export-lapnak. (A fájl-export
 * maga a Model3DExportSheet-ben él.)
 */
export function createExportActions({ t, project, doc, mesh, asset, viewRef }: ExportActionDeps) {
  /** 🏠→🖼️ az alaprajz SZERKESZTHETŐ kép-projektként (falhosszakkal, alapterülettel) */
  const exportFloorPlan = async () => {
    const room = doc?.capture?.room;
    if (!room || !project) {
      return;
    }
    const planDoc = floorPlanImageDoc(room, project.name, `${t('model3d.room.area')}: ${formatArea(room.floorArea)}`, () => makeId('lyr'));
    if (!planDoc) {
      Alert.alert(t('model3d.room.title'), t('model3d.room.floorPlanFail'));
      return;
    }
    const base = createEmptyProject(`${project.name} — ${t('model3d.room.area')}`, '1:1', undefined, 'image');
    const imageProject = { ...base, imageDocs: [planDoc] };
    await saveProject(imageProject);
    router.push(`/studio/image/${imageProject.id}`);
  };

  /** 🥽 AR Gyorsnézet: a modell USDZ-ként (forgatással) a valós térbe — valós méretben */
  const openAR = async () => {
    if (!Remix3D?.presentAR || !asset) {
      Alert.alert(t('model3d.ar.title'), t('model3d.error.needsNewBuild'));
      return;
    }
    try {
      const usdz =
        mesh?.format === 'usdz' && !hasRotation(doc)
          ? asset.uri
          : await Remix3D.exportModel(asset.uri, new File(Paths.cache, `m3d_ar_${asset.id}.usdz`).uri, JSON.stringify({ ...JSON.parse(lookOptionsJson(doc)), format: 'usdz' }));
      await Remix3D.presentAR(usdz);
    } catch (e) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:openAR', e);
      Alert.alert(t('model3d.ar.title'), t(remix3dErrorKey(e)));
    }
  };

  /** 📸 a LÁTHATÓ néző képe (az export-lap „jelenlegi nézet” forrása) */
  const snapshotCurrentView = async () => {
    if (!viewRef.current) throw new Error('model3d.error.unsupported');
    return viewRef.current.snapshot(new File(Paths.cache, `m3d_view_${makeId('img')}.png`).uri, 1440, 1440, true);
  };

  return { exportFloorPlan, openAR, snapshotCurrentView };
}
