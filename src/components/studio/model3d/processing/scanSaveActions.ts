import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import type { TFunction } from 'i18next';
import type { RefObject } from 'react';
import { Alert } from 'react-native';

import { captureDirFor } from '@/components/studio/model3d/capture/captureDir';
import type { Phase, SetState } from '@/components/studio/model3d/studioTypes';
import { haptics } from '@/design';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { createModel3DDoc, replaceModel } from '@/lib/model3dDoc';
import { storedFormatFor } from '@/lib/model3dExport';
import { lookOptionsJson } from '@/lib/model3dLook';
import { model3dAsset } from '@/lib/model3dMedia';
import { captureMetaOf, posterFileUri } from '@/lib/model3dStudioOps';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { Remix3D, remix3dErrorKey, type MeshScanHandle, type RoomScanHandle, type WireframeMode } from '@/lib/remix3dNative';
import { summarizeRoom } from '@/lib/roomPlanSummary';
import { useEditorStore } from '@/store/editorStore';
import type { CaptureMode, MeshFormat, Model3DCapture, Model3DDoc, Model3DMesh } from '@/types/model3d';
import type { Asset, Project } from '@/types/project';

export interface ScanSaveDeps {
  t: TFunction;
  projectId: string;
  project: Project | null;
  doc: Model3DDoc | undefined;
  asset: Asset | undefined;
  scanMode: 'mesh' | 'points';
  roomBusy: boolean;
  savingMesh: boolean;
  meshRef: RefObject<MeshScanHandle | null>;
  roomRef: RefObject<RoomScanHandle | null>;
  scanStartedAt: { current: string };
  reconstructing: { current: boolean };
  setPhase: SetState<Phase>;
  setRoomBusy: SetState<boolean>;
  setSavingMesh: SetState<boolean>;
  setWireframe: SetState<WireframeMode>;
  setProgress: SetState<number>;
}

/**
 * ⚙️ A szkenek FELDOLGOZÁSA hook nélkül (REFACTOR: a Model3DStudio.tsx-ből): a natív
 * szkenner-kimenet → tárolási formátum → poszter → `ADD_ASSET` + `SET_MODEL3D_DOC` egy
 * `applyBatch`-ben (egy undo-lépés); a fotogrammetria rekonstrukciója.
 */
export function createScanSaveActions(d: ScanSaveDeps) {
  const { t, projectId, project, doc, asset, scanMode, roomBusy, savingMesh, meshRef, roomRef, scanStartedAt, reconstructing, setPhase, setRoomBusy, setSavingMesh, setWireframe, setProgress } = d;

  /** a rögzítés metaadata (mód, eszköz, kezdés) — a projekt-dokumentumba kerül */
  const captureMeta = (mode: CaptureMode): Model3DCapture => captureMetaOf(mode, Device.modelName ?? '', scanStartedAt.current);
  /**
   * 🗄️ A friss szken a projekt választott TÁROLÁSI formátumába (USDZ / GLB / OBJ / PLY —
   * `storedFormatFor` a fajta szerint, adatvesztés nélkül). Ha az átalakítás nem sikerül,
   * a szkenner natív fájlja marad (a szken SOSEM vész el) — és ezt őszintén jelezzük.
   */
  const toStorageFormat = async (
    uri: string,
    native: MeshFormat,
    assetId: string,
    kind: { textured: boolean; points: boolean }
  ): Promise<{ uri: string; format: MeshFormat; asset: Asset }> => {
    const name = project?.name ?? '';
    const asAsset = (format: MeshFormat) =>
      model3dAsset({ assetId, format, documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name, textured: kind.textured });
    const want = storedFormatFor(useEditorStore.getState().project?.model3d?.storageFormat ?? doc?.storageFormat, kind);
    if (want === native || !Remix3D) {
      return { uri, format: native, asset: asAsset(native) };
    }
    const target = asAsset(want);
    try {
      const out = await Remix3D.exportModel(uri, target.uri, JSON.stringify({ format: want }));
      try {
        new File(uri).delete();
      } catch (caught) {
        logCaught('components/studio/model3d/Model3DStudio.tsx:toStorageFormat', caught);
        // a régi (natív) fájlt a mappa-takarítás is viszi
      }
      return { uri: out, format: want, asset: target };
    } catch (caught) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:toStorageFormat', caught);
      Alert.alert(t('model3d.title'), t('model3d.storage.convertFailed', { format: want.toUpperCase(), fallback: native.toUpperCase() }));
      return { uri, format: native, asset: asAsset(native) };
    }
  };

  const finishRoomScan = async () => {
    if (!project || !roomRef.current || roomBusy || !Remix3D) {
      return;
    }
    setRoomBusy(true);
    const assetId = makeId('ast');
    const target = model3dAsset({ assetId, format: 'usdz', documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: project.name, textured: false });
    try {
      const res = await roomRef.current.finish(target.uri);
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      const stored = await toStorageFormat(res.uri, 'usdz', assetId, { textured: false, points: false });
      const info = await Remix3D.inspectModel(stored.uri).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:finishRoomScan', caught); return null; });
      const posterUri = posterFileUri(projectMediaDir().uri, assetId);
      const poster = await Remix3D.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 4, false, lookOptionsJson(undefined)).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:finishRoomScan', caught); return null; });
      const m: Model3DMesh = {
        id: makeId('mesh'),
        assetId,
        format: stored.format,
        triangles: info?.triangles ?? 0,
        bounds: info ? { min: info.min, max: info.max } : { min: res.min, max: res.max },
        textured: false,
      };
      const base: Model3DDoc = doc ?? createModel3DDoc();
      const { doc: next, removedAssetIds } = replaceModel({ ...base, capture: undefined }, m, project.name);
      useEditorStore.getState().applyBatch(
        [
          { type: 'ADD_ASSET', asset: { ...stored.asset, uri: stored.uri } },
          ...removedAssetIds.map((id) => ({ type: 'REMOVE_ASSET' as const, assetId: id })),
          {
            type: 'SET_MODEL3D_DOC',
            doc: { ...next, capture: { ...captureMeta('room'), room: summarizeRoom(res.room) }, poster: poster ?? undefined },
            label: t('model3d.reconstruct.done'),
          },
        ],
        'user'
      );
      haptics.success();
      setPhase('viewer');
    } catch (e) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:finishRoomScan', e);
      Alert.alert(t('model3d.room.title'), t(remix3dErrorKey(e)));
    } finally {
      setRoomBusy(false);
    }
  };

  const finishMeshScan = async () => {
    if (!project || !meshRef.current || savingMesh) {
      return;
    }
    setSavingMesh(true);
    const assetId = makeId('ast');
    if (scanMode === 'points') {
      try {
        const target = model3dAsset({ assetId, format: 'ply', documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: project.name, textured: false });
        const res = await meshRef.current.exportPoints(target.uri);
        void meshRef.current.pause();
        if (useEditorStore.getState().project?.id !== projectId) {
          return;
        }
        const stored = await toStorageFormat(res.uri, 'ply', assetId, { textured: false, points: true });
        const posterUri = posterFileUri(projectMediaDir().uri, assetId);
        const poster = await Remix3D?.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:finishMeshScan', caught); return null; });
        const m: Model3DMesh = { id: makeId('mesh'), assetId, format: stored.format, triangles: 0, points: res.points, bounds: { min: res.min, max: res.max }, textured: false };
        const base: Model3DDoc = doc ?? createModel3DDoc();
        const { doc: next, removedAssetIds } = replaceModel({ ...base, capture: undefined }, m, project.name);
        useEditorStore.getState().applyBatch(
          [
            { type: 'ADD_ASSET', asset: { ...stored.asset, uri: stored.uri } },
            ...removedAssetIds.map((id) => ({ type: 'REMOVE_ASSET' as const, assetId: id })),
            { type: 'SET_MODEL3D_DOC', doc: { ...next, capture: captureMeta('pointcloud'), poster: poster ?? undefined }, label: t('model3d.reconstruct.done') },
          ],
          'user'
        );
        haptics.success();
        setPhase('viewer');
      } catch (e) {
        logCaught('components/studio/model3d/Model3DStudio.tsx:finishMeshScan', e);
        Alert.alert(t('model3d.title'), t(remix3dErrorKey(e)));
      } finally {
        setSavingMesh(false);
      }
      return;
    }
    try {
      // USDZ, ha a ModelIO ezen az eszközön tud ilyet írni; különben OBJ (textúra nélkül egy fájl)
      let format: 'usdz' | 'obj' = 'usdz';
      let target = model3dAsset({ assetId, format, documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: project.name, textured: false });
      let res;
      try {
        res = await meshRef.current.exportMesh(target.uri);
      } catch (e) {
        if (remix3dErrorKey(e) !== 'model3d.error.unsupported') throw e;
        logCaught('components/studio/model3d/Model3DStudio.tsx:exportMesh', e);
        format = 'obj';
        target = model3dAsset({ assetId, format, documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: project.name, textured: false });
        res = await meshRef.current.exportMesh(target.uri);
      }
      void meshRef.current.pause();
      // 🔒 közben elhagyták a stúdiót / másik projekt nyílt → az eredmény NEM íródhat máshova
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      const stored = await toStorageFormat(res.uri, format, assetId, { textured: false, points: false });
      const posterUri = posterFileUri(projectMediaDir().uri, assetId);
      const poster = await Remix3D?.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:finishMeshScan', caught); return null; });
      const m: Model3DMesh = {
        id: makeId('mesh'),
        assetId,
        format: stored.format,
        triangles: res.triangles,
        bounds: { min: res.min, max: res.max },
        textured: false,
      };
      const base: Model3DDoc = doc ?? createModel3DDoc();
      // „Új szken”: az új háló LECSERÉLI a régit (a régi asset is kikerül — egy undo-lépés)
      const { doc: next, removedAssetIds } = replaceModel({ ...base, capture: undefined }, m, project.name);
      useEditorStore.getState().applyBatch(
        [
          { type: 'ADD_ASSET', asset: { ...stored.asset, uri: stored.uri } },
          ...removedAssetIds.map((id) => ({ type: 'REMOVE_ASSET' as const, assetId: id })),
          { type: 'SET_MODEL3D_DOC', doc: { ...next, capture: captureMeta('freeform'), poster: poster ?? undefined }, label: t('model3d.reconstruct.done') },
        ],
        'user'
      );
      // a nyers szken-háló a hálós nézettel nyílik — látszik a szerkezete
      setWireframe('overlay');
      haptics.success();
      setPhase('viewer');
    } catch (e) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:finishMeshScan', e);
      Alert.alert(t('model3d.title'), t(remix3dErrorKey(e)));
    } finally {
      setSavingMesh(false);
    }
  };

  const discardImages = () => {
    try {
      captureDirFor(projectId).delete();
    } catch (caught) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:discardImages', caught);
      // a képkészlet ideiglenes — ha nem törölhető, a cache-ürítés viszi
    }
  };

  const reconstruct = async () => {
    if (!Remix3D || reconstructing.current || !project) {
      return;
    }
    reconstructing.current = true;
    setPhase('reconstructing');
    setProgress(0);
    const sub = Remix3D.addListener('onReconstructProgress', (e) => setProgress(e.progress));
    const assetId = makeId('ast');
    const target = model3dAsset({ assetId, format: 'usdz', documentDir: Paths.document.uri, mediaDirUri: projectMediaDir().uri, name: project.name });
    try {
      const uri = await Remix3D.reconstruct(captureDirFor(projectId).uri, target.uri, 'medium');
      // 🔒 a rekonstrukció alatt elhagyták a stúdiót → az eredmény nem íródhat más projektbe
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      const stored = await toStorageFormat(uri, 'usdz', assetId, { textured: true, points: false });
      const info = await Remix3D.inspectModel(stored.uri);
      const posterUri = posterFileUri(projectMediaDir().uri, assetId);
      const poster = await Remix3D.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch((caught) => { logCaught('components/studio/model3d/Model3DStudio.tsx:reconstruct', caught); return null; });
      const m: Model3DMesh = {
        id: makeId('mesh'),
        assetId,
        format: stored.format,
        triangles: info.triangles,
        bounds: { min: info.min, max: info.max },
        textured: true,
      };
      const base: Model3DDoc = doc ?? createModel3DDoc();
      // „Új szken”: az új háló LECSERÉLI a régit (a régi asset is kikerül — egy undo-lépés)
      const { doc: next, removedAssetIds } = replaceModel({ ...base, capture: undefined }, m, project.name);
      useEditorStore.getState().applyBatch(
        [
          { type: 'ADD_ASSET', asset: { ...stored.asset, uri: stored.uri } },
          ...removedAssetIds.map((id) => ({ type: 'REMOVE_ASSET' as const, assetId: id })),
          { type: 'SET_MODEL3D_DOC', doc: { ...next, poster: poster ?? undefined }, label: t('model3d.reconstruct.done') },
        ],
        'user'
      );
      discardImages();
      haptics.success();
      setPhase('viewer');
    } catch (e) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:reconstruct', e);
      setPhase(asset ? 'viewer' : 'empty');
      const key = remix3dErrorKey(e);
      if (key === 'model3d.error.cancelled') {
        // a user szakította meg → nem hiba, a képek sem kellenek
        discardImages();
      } else {
        // a képek MEGMARADNAK → újrapróbálható (a fotózást nem kell megismételni)
        Alert.alert(t('model3d.title'), t(key), [
          { text: t('model3d.reconstruct.discard'), style: 'destructive', onPress: discardImages },
          { text: t('model3d.reconstruct.retry'), onPress: () => void reconstruct() },
        ]);
      }
    } finally {
      sub.remove();
      reconstructing.current = false;
    }
  };

  return { toStorageFormat, finishRoomScan, finishMeshScan, discardImages, reconstruct };
}
