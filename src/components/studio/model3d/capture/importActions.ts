import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import type { Phase, SetState } from '@/components/studio/model3d/studioTypes';
import { haptics } from '@/design';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { createModel3DDoc, replaceModel } from '@/lib/model3dDoc';
import { storedFormatFor } from '@/lib/model3dExport';
import { importExtOf, importProblem, nameFromFile, storableSourceFormat } from '@/lib/model3dImport';
import { lookOptionsJson } from '@/lib/model3dLook';
import { model3dAsset } from '@/lib/model3dMedia';
import { importReadErrorKey, posterFileUri } from '@/lib/model3dStudioOps';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { Remix3D, remix3dErrorKey } from '@/lib/remix3dNative';
import { useEditorStore } from '@/store/editorStore';
import type { Model3DDoc, Model3DMesh } from '@/types/model3d';
import type { Project } from '@/types/project';

export interface ImportActionDeps {
  t: TFunction;
  projectId: string;
  project: Project | null;
  doc: Model3DDoc | undefined;
  importing: boolean;
  setImporting: SetState<boolean>;
  setPicking: SetState<boolean>;
  setPhase: SetState<Phase>;
}

/** 📥 A 3D-fájl importja hook nélkül (REFACTOR: a Model3DStudio.tsx-ből) — a modell bevitele */
export function createImportActions({ t, projectId, project, doc, importing, setImporting, setPicking, setPhase }: ImportActionDeps) {
  /**
   * 📥 3D-fájl importja (GLB/glTF, FBX, OBJ, USDZ/USD, PLY, STL, zip) — a modell a projekt
   * TÁROLÁSI formátumába kerül a projekt mappájában (a tárolható forrás változatlanul
   * másolódik, a többi a natív írókkal alakul át). Az új modell lecseréli a régit (undo).
   */
  const importFromFile = async (incoming?: { uri: string; name: string }) => {
    if (!project || !Remix3D || importing) {
      return;
    }
    let file = incoming;
    if (!file) {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || picked.assets.length === 0) {
        return;
      }
      file = picked.assets[0];
    }
    const problem = importProblem(file.name);
    if (problem) {
      Alert.alert(
        t('model3d.import.title'),
        problem.code === 'nativeApp'
          ? t('model3d.import.nativeApp', { app: problem.app })
          : t('model3d.import.unsupported', { ext: problem.code === 'unsupported' ? problem.ext : '' })
      );
      return;
    }
    const ext = importExtOf(file.name)!;
    setImporting(true);
    setPicking(false);
    try {
      // a natív olvasók a kiterjesztésből döntenek → a cache-fájl a saját kiterjesztésével
      const src = new File(Paths.cache, `m3d_import_${makeId('imp')}.${ext}`);
      new File(file.uri).copy(src);
      let info;
      try {
        info = await Remix3D.inspectModel(src.uri);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(importReadErrorKey(msg, ext));
      }
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      const kind = { textured: !!info.textured, points: (info.points ?? 0) > 0 };
      const want = storedFormatFor(useEditorStore.getState().project?.model3d?.storageFormat ?? doc?.storageFormat, kind);
      const assetId = makeId('ast');
      const target = model3dAsset({ assetId, format: want, documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: nameFromFile(file.name), textured: kind.textured });
      let uri: string;
      if (storableSourceFormat(ext) === want) {
        src.copy(new File(target.uri));
        uri = target.uri;
      } else {
        uri = await Remix3D.exportModel(src.uri, target.uri, JSON.stringify({ format: want }));
      }
      try {
        src.delete();
      } catch (caught) {
        logCaught('components/studio/model3d/Model3DStudio.tsx:importFromFile', caught);
        // a cache-t a rendszer is takarítja
      }
      const stored = await Remix3D.inspectModel(uri);
      const posterUri = posterFileUri(projectMediaDir().uri, assetId);
      const poster = await Remix3D.snapshotFile(uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:importFromFile', caught); return null; });
      const m: Model3DMesh = {
        id: makeId('mesh'),
        assetId,
        format: want,
        triangles: stored.triangles,
        bounds: { min: stored.min, max: stored.max },
        textured: kind.textured,
        ...(kind.points ? { points: info.points } : {}),
      };
      const base: Model3DDoc = useEditorStore.getState().project?.model3d ?? doc ?? createModel3DDoc();
      const { doc: next, removedAssetIds } = replaceModel({ ...base, capture: undefined }, m, nameFromFile(file.name));
      useEditorStore.getState().applyBatch(
        [
          { type: 'ADD_ASSET', asset: { ...target, uri } },
          ...removedAssetIds.map((id) => ({ type: 'REMOVE_ASSET' as const, assetId: id })),
          { type: 'SET_MODEL3D_DOC', doc: { ...next, poster: poster ?? undefined }, label: t('model3d.import.done') },
        ],
        'user'
      );
      haptics.success();
      setPhase('viewer');
    } catch (e) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:importFromFile', e);
      Alert.alert(t('model3d.import.title'), t(remix3dErrorKey(e)));
    } finally {
      setImporting(false);
    }
  };

  return { importFromFile };
}
