import { Paths } from 'expo-file-system';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { haptics } from '@/design';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { replaceModel } from '@/lib/model3dDoc';
import { storedFormatFor } from '@/lib/model3dExport';
import { bakeProcessedMesh, lookOptionsJson, modelRotation, type SimplifyLevel } from '@/lib/model3dLook';
import { model3dAsset } from '@/lib/model3dMedia';
import { posterFileUri, processMeshOptionsJson } from '@/lib/model3dStudioOps';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { Remix3D, remix3dErrorKey } from '@/lib/remix3dNative';
import { useEditorStore } from '@/store/editorStore';
import type { MeshFormat, Model3DDoc, Model3DMesh } from '@/types/model3d';
import type { Asset, Project } from '@/types/project';

export interface ModelProcessDeps {
  t: TFunction;
  projectId: string;
  project: Project | null;
  doc: Model3DDoc | undefined;
  mesh: Model3DMesh | undefined;
  asset: Asset | undefined;
}

/**
 * ✂️/🗄️ A meglévő modell natív FELDOLGOZÁSA hook nélkül (REFACTOR: a Model3DStudio.tsx-ből):
 * padló-vágás / egyszerűsítés és a tárolási formátum váltása — mindkettő új assetet ad,
 * a régi kikerül (egy undo-lépés).
 */
export function createModelProcessActions({ t, projectId, project, doc, mesh, asset }: ModelProcessDeps) {
  /**
   * ✂️/🔻 Háló-feldolgozás (natív `processMesh`): a forgatás beég, a padló levágódik /
   * a háló egyszerűsödik → ÚJ OBJ-asset, a régi kikerül (egy undo-lépés), a mérések
   * átszámolódnak. Csak textúra nélküli (hálós) szkennél.
   */
  const applyProcess = async (op: { cutY?: number; simplify?: SimplifyLevel }) => {
    if (!Remix3D || !project || !doc || !mesh || !asset) {
      return;
    }
    const q = modelRotation(doc);
    const assetId = makeId('ast');
    // az új háló is a projekt tárolási formátumában készül (textúra nélküli háló → bármelyik)
    const format = storedFormatFor(doc.storageFormat, { textured: false, points: false });
    const target = model3dAsset({ assetId, format, documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: project.name, textured: false });
    try {
      const res = await Remix3D.processMesh(asset.uri, target.uri, processMeshOptionsJson(q, op, mesh.bounds));
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      const latest = useEditorStore.getState().project?.model3d ?? doc;
      const baked = bakeProcessedMesh(latest, mesh, q);
      const m: Model3DMesh = { id: makeId('mesh'), assetId, format, triangles: res.triangles, bounds: { min: res.min, max: res.max }, textured: false };
      const { doc: next, removedAssetIds } = replaceModel(latest, m, project.name);
      const posterUri = posterFileUri(projectMediaDir().uri, assetId);
      const poster = await Remix3D.snapshotFile(res.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(next)).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:applyProcess', caught); return null; });
      useEditorStore.getState().applyBatch(
        [
          { type: 'ADD_ASSET', asset: { ...target, uri: res.uri } },
          ...removedAssetIds.map((id) => ({ type: 'REMOVE_ASSET' as const, assetId: id })),
          {
            type: 'SET_MODEL3D_DOC',
            doc: { ...next, measurements: baked.measurements, annotations: baked.annotations, poster: poster ?? undefined },
            label: t('model3d.viewer.edit'),
          },
        ],
        'user'
      );
      haptics.success();
      Alert.alert(t('model3d.viewer.edit'), t('model3d.viewer.editDone', { tris: res.triangles.toLocaleString() }));
    } catch (e) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:applyProcess', e);
      Alert.alert(t('model3d.viewer.edit'), t(remix3dErrorKey(e)));
    }
  };

  /**
   * 🗄️ Tárolási formátum váltása: a beállítás (a következő szkenekre) + a JELENLEGI modell
   * átalakítása új fájlba (a régi asset kikerül — egy undo-lépés). Az átalakítás hibája
   * semmit nem módosít (a meglévő fájl marad).
   */
  const changeStorageFormat = async (pref: MeshFormat) => {
    if (!project || !doc || !mesh || !asset) {
      return;
    }
    const want = storedFormatFor(pref, { textured: mesh.textured, points: !!mesh.points });
    if (want === mesh.format || !Remix3D) {
      useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: { ...doc, storageFormat: pref }, label: t('model3d.storage.title') }, 'user');
      return;
    }
    const assetId = makeId('ast');
    const target = model3dAsset({ assetId, format: want, documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: project.name, textured: mesh.textured });
    try {
      const uri = await Remix3D.exportModel(asset.uri, target.uri, JSON.stringify({ format: want }));
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      const latest = useEditorStore.getState().project?.model3d ?? doc;
      useEditorStore.getState().applyBatch(
        [
          { type: 'ADD_ASSET', asset: { ...target, uri } },
          { type: 'REMOVE_ASSET', assetId: asset.id },
          {
            type: 'SET_MODEL3D_DOC',
            doc: {
              ...latest,
              storageFormat: pref,
              meshes: latest.meshes.map((m) => (m.id === mesh.id ? { ...m, assetId, format: want } : m)),
            },
            label: t('model3d.storage.title'),
          },
        ],
        'user'
      );
      haptics.success();
    } catch (e) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:changeStorageFormat', e);
      Alert.alert(t('model3d.storage.title'), t(remix3dErrorKey(e)));
    }
  };

  return { applyProcess, changeStorageFormat };
}
