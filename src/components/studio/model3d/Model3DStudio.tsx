import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Model3DEditSheet } from '@/components/studio/model3d/Model3DEditSheet';
import { Model3DExportSheet } from '@/components/studio/model3d/Model3DExportSheet';
import { palette } from '@/constants/editor';
import { haptics } from '@/design';
import { useBackLayer } from '@/hooks/useBackLayer';
import { availableCaptureModes } from '@/lib/deviceCaps';
import { makeId } from '@/lib/id';
import { boundsSize, formatLength } from '@/lib/model3d';
import { addMeasurement, createModel3DDoc, removeMeasurement, replaceModel, setEnvironment } from '@/lib/model3dDoc';
import { bakeProcessedMesh, hasRotation, lookOptionsJson, modelRotation, simplifyCell, type SimplifyLevel } from '@/lib/model3dLook';
import { formatArea, measurementValue } from '@/lib/model3dMeasure';
import { createEmptyProject } from '@/lib/projectUtils';
import { floorPlanImageDoc } from '@/lib/roomFloorPlan';
import { roomStats, summarizeRoom } from '@/lib/roomPlanSummary';
import { saveProject } from '@/lib/storage';
import { storedFormatFor } from '@/lib/model3dExport';
import { importExtOf, importProblem, nameFromFile, storableSourceFormat } from '@/lib/model3dImport';
import { currentModel, model3dAsset } from '@/lib/model3dMedia';
import { goBackOrHome } from '@/lib/nav';
import {
  Remix3D,
  Remix3DCaptureView,
  Remix3DModelView,
  Remix3DMeshScanView,
  Remix3DRoomScanView,
  remix3dErrorKey,
  type CaptureStateEvent,
  type CaptureViewHandle,
  type MeshScanHandle,
  type MeshScanStateEvent,
  type ModelViewHandle,
  type RoomScanHandle,
  type WireframeMode,
} from '@/lib/remix3dNative';
import { useEditorStore } from '@/store/editorStore';
import type { CaptureMode, MeshFormat, Model3DCapture, Model3DDoc, Model3DMesh, Vec3 } from '@/types/model3d';
import type { Asset } from '@/types/project';
import { projectMediaDir } from '@/lib/projectFolderClient';

/** létezik-e a helyi fájl (pl. a poszter — újratelepítés / törlés után hiányozhat) */
function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

type Phase = 'empty' | 'capturing' | 'meshScanning' | 'roomScanning' | 'reconstructing' | 'viewer';

/** a háló-megjelenítés ciklusa a nézőben */
const WIREFRAME_CYCLE: WireframeMode[] = ['off', 'overlay', 'only'];
/** ARKit környezeti fény alatta „kevés a fény" (normál beltér ~1000) */
const DARK_LIGHT = 300;

/** a háttér-ciklus: sötét → világos → átlátszó (a néző a SceneKit-háttérrel) */
const BACKGROUNDS: (string | null)[] = ['#111420', '#f2f2f5', null];

const captureDirFor = (projectId: string) => new Directory(Paths.cache, `m3dcap_${projectId}`);

/**
 * 🧊 3D Stúdió (3D-Studio.md §2.1, §7, §8.1) — 3D-1: Tárgy-szken → rekonstrukció → néző.
 *
 *  • A projekt a KÖZÖS `useEditorStore`-ban él; minden változás a command buson
 *    (`ADD_ASSET` + `SET_MODEL3D_DOC`, egy `applyBatch`-ben → egy undo-lépés).
 *  • A rögzítés Focus-szintű (teljes képernyő, élő útmutatás), a vissza-gomb
 *    megerősítéssel vet el (a vissza-verem tetején).
 *  • A képkészlet IDEIGLENES (cache), a kész USDZ a lapos `media/`-ba kerül (§15.8).
 */
export function Model3DStudio({ projectId, importUri }: { projectId: string; importUri?: string }) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const doc = project?.model3d;
  // az AKTUÁLIS modell = a legutóbbi szken (korábban a meshes[0] → „Új szken” után a régi látszott)
  const current = currentModel(doc?.meshes, project?.assets ?? []);
  const mesh = current?.mesh;
  const asset = current?.asset;
  const [exportOpen, setExportOpen] = useState(false);
  // 🩹 a néző nem tudta betölteni a modellfájlt (hiányzik / sérült) → ne üres vászon legyen
  const [loadFailedUri, setLoadFailedUri] = useState<string | null>(null);
  const loadFailed = !!asset && loadFailedUri === asset.uri;
  // 🖼️ poszter-pótlás: a régebbi / sikertelen-poszteres modellnek is legyen előnézeti képe
  const posterTried = useRef<string | null>(null);
  const viewRef = useRef<ModelViewHandle>(null);
  // 📏 mérés: a mód ki/be + az első (még pár nélküli) pont
  const [measuring, setMeasuring] = useState(false);
  const [pendingPoint, setPendingPoint] = useState<Vec3 | null>(null);
  // ✏️ szerkesztés: a lap + a padló-vágósík élő előnézete
  const [editOpen, setEditOpen] = useState(false);
  const [cutPreviewY, setCutPreviewY] = useState<number | null>(null);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  const [phaseState, setPhase] = useState<Phase>(asset ? 'viewer' : 'empty');
  // a hálóval rendelkező projekt a nézőben nyílik (pl. visszatérés után) — levezetett, nem effekt
  // „Új szken" meglévő modellnél: a módválasztó EXPLICIT kérésre látszik (különben a néző)
  const [picking, setPicking] = useState(false);
  const phase: Phase = phaseState === 'empty' && asset && !picking ? 'viewer' : phaseState;
  const [capState, setCapState] = useState<CaptureStateEvent>({ state: 'initializing', feedback: [] });
  const [progress, setProgress] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState<WireframeMode>('off');
  const [scanState, setScanState] = useState<MeshScanStateEvent>({ tracking: 'initializing', triangles: 0, light: 1000 });
  const [savingMesh, setSavingMesh] = useState(false);
  const [importing, setImporting] = useState(false);
  const meshRef = useRef<MeshScanHandle>(null);
  const roomRef = useRef<RoomScanHandle>(null);
  // ☁️ a hálós szkenner módja: élő háló ('mesh') vagy színes pontfelhő ('points')
  const [scanMode, setScanMode] = useState<'mesh' | 'points'>('mesh');
  const [roomBusy, setRoomBusy] = useState(false);
  const scanStartedAt = useRef<string>(new Date().toISOString());
  /** a rögzítés metaadata (mód, eszköz, kezdés) — a projekt-dokumentumba kerül */
  const captureMeta = (mode: CaptureMode): Model3DCapture => ({
    mode,
    quality: 'medium',
    status: 'ready',
    device: Device.modelName ?? '',
    startedAt: scanStartedAt.current,
  });
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
      } catch {
        // a régi (natív) fájlt a mappa-takarítás is viszi
      }
      return { uri: out, format: want, asset: target };
    } catch {
      Alert.alert(t('model3d.title'), t('model3d.storage.convertFailed', { format: want.toUpperCase(), fallback: native.toUpperCase() }));
      return { uri, format: native, asset: asAsset(native) };
    }
  };
  const captureRef = useRef<CaptureViewHandle>(null);
  // ⏱️ ha a kamera nem tud tájékozódni (sötét, takart, mozdulatlan), az „inicializálás"
  // nem ér véget — néhány mp után érthető útmutatás a pörgő jelző helyett (élő teszt)
  const [initElapsed, setInitElapsed] = useState(0);
  useEffect(() => {
    if (phaseState !== 'capturing' || capState.state !== 'initializing') {
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setInitElapsed(Date.now() - started), 1000);
    return () => {
      clearInterval(timer);
      setInitElapsed(0);
    };
  }, [phaseState, capState.state]);
  const reconstructing = useRef(false);

  const discardCapture = () => {
    void captureRef.current?.command('cancel').catch(() => {});
    try {
      captureDirFor(projectId).delete();
    } catch {
      // nincs mit törölni
    }
    setPhase(asset ? 'viewer' : 'empty');
  };

  const confirmCancel = () =>
    Alert.alert(t('model3d.capture.cancelTitle'), t('model3d.capture.cancelBody'), [
      { text: t('model3d.capture.keep'), style: 'cancel' },
      { text: t('model3d.capture.discard'), style: 'destructive', onPress: discardCapture },
    ]);

  // ↩️ rögzítés közben a vissza megerősítéssel vet el; rekonstrukció közben megszakít
  useBackLayer(
    phase === 'meshScanning'
      ? () => {
          void meshRef.current?.pause();
          setPhase(asset ? 'viewer' : 'empty');
        }
      : null
  );
  useBackLayer(
    phase === 'capturing' ? confirmCancel : phase === 'reconstructing' ? () => void Remix3D?.cancelReconstruct() : null
  );
  // 🏠 szoba-szken közben a vissza megszakít (feldolgozás közben nem)
  useBackLayer(phase === 'roomScanning' && !roomBusy ? () => cancelRoomScan() : null);

  // ── 🕸️ szabad szken: élő LiDAR-háló a kameraképen ─────────────────────────
  const startMeshScan = (mode: 'mesh' | 'points') => {
    setPicking(false);
    setScanMode(mode);
    scanStartedAt.current = new Date().toISOString();
    setScanState({ tracking: 'initializing', triangles: 0, light: 1000, points: 0 });
    setPhase('meshScanning');
    requestAnimationFrame(() => {
      void meshRef.current?.start(mode).catch((e) => Alert.alert(t('model3d.title'), t(remix3dErrorKey(e))));
    });
  };

  // ── 🏠 szoba-szken (RoomPlan): falak, nyílások, bútorok élőben ─────────────
  const startRoomScan = () => {
    setPicking(false);
    scanStartedAt.current = new Date().toISOString();
    setPhase('roomScanning');
    requestAnimationFrame(() => {
      void roomRef.current?.start().catch((e) => {
        Alert.alert(t('model3d.title'), t(remix3dErrorKey(e)));
        setPhase(asset ? 'viewer' : 'empty');
      });
    });
  };

  const cancelRoomScan = () => {
    void roomRef.current?.cancel();
    setPhase(asset ? 'viewer' : 'empty');
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
      const info = await Remix3D.inspectModel(stored.uri).catch(() => null);
      const posterUri = `${projectMediaDir().uri.replace(/\/?$/, '/')}m3d_${assetId}_poster.png`;
      const poster = await Remix3D.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 4, false, lookOptionsJson(undefined)).catch(() => null);
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
      Alert.alert(t('model3d.room.title'), t(remix3dErrorKey(e)));
    } finally {
      setRoomBusy(false);
    }
  };

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
        const posterUri = `${projectMediaDir().uri.replace(/\/?$/, '/')}m3d_${assetId}_poster.png`;
        const poster = await Remix3D?.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch(() => null);
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
      const posterUri = `${projectMediaDir().uri.replace(/\/?$/, '/')}m3d_${assetId}_poster.png`;
      const poster = await Remix3D?.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch(() => null);
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
      Alert.alert(t('model3d.title'), t(remix3dErrorKey(e)));
    } finally {
      setSavingMesh(false);
    }
  };

  const startCapture = () => {
    setPicking(false);
    const dir = captureDirFor(projectId);
    try {
      dir.delete();
    } catch {
      // friss könyvtár
    }
    setCapState({ state: 'initializing', feedback: [] });
    setPhase('capturing');
    // a natív nézet a következő frame-ben mountol → utána indítjuk a munkamenetet
    requestAnimationFrame(() => {
      void captureRef.current?.start(dir.uri).catch((e) => Alert.alert(t('model3d.title'), t(remix3dErrorKey(e))));
    });
  };

  const discardImages = () => {
    try {
      captureDirFor(projectId).delete();
    } catch {
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
      const posterUri = `${projectMediaDir().uri.replace(/\/?$/, '/')}m3d_${assetId}_poster.png`;
      const poster = await Remix3D.snapshotFile(stored.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch(() => null);
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

  // a stúdió elhagyásakor a futó rekonstrukció leáll (különben a háttérben dolgozna tovább)
  useEffect(
    () => () => {
      if (reconstructing.current) {
        void Remix3D?.cancelReconstruct();
      }
    },
    []
  );

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
      const res = await Remix3D.processMesh(
        asset.uri,
        target.uri,
        JSON.stringify({
          rotation: [q.x, q.y, q.z, q.w],
          ...(op.cutY !== undefined ? { cutY: op.cutY } : {}),
          ...(op.simplify ? { cell: simplifyCell(mesh.bounds, op.simplify) } : {}),
        })
      );
      if (useEditorStore.getState().project?.id !== projectId) {
        return;
      }
      const latest = useEditorStore.getState().project?.model3d ?? doc;
      const baked = bakeProcessedMesh(latest, mesh, q);
      const m: Model3DMesh = { id: makeId('mesh'), assetId, format, triangles: res.triangles, bounds: { min: res.min, max: res.max }, textured: false };
      const { doc: next, removedAssetIds } = replaceModel(latest, m, project.name);
      const posterUri = `${projectMediaDir().uri.replace(/\/?$/, '/')}m3d_${assetId}_poster.png`;
      const poster = await Remix3D.snapshotFile(res.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(next)).catch(() => null);
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
      Alert.alert(t('model3d.storage.title'), t(remix3dErrorKey(e)));
    }
  };

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
        throw new Error(
          msg.includes('fbxAscii')
            ? 'model3d.import.fbxAscii'
            : msg.includes('zipNoModel')
              ? 'model3d.import.zipNoModel'
              : ext === 'gltf'
                ? 'model3d.import.gltfExternal'
                : 'model3d.import.unreadable'
        );
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
      } catch {
        // a cache-t a rendszer is takarítja
      }
      const stored = await Remix3D.inspectModel(uri);
      const posterUri = `${projectMediaDir().uri.replace(/\/?$/, '/')}m3d_${assetId}_poster.png`;
      const poster = await Remix3D.snapshotFile(uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(undefined)).catch(() => null);
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
      Alert.alert(t('model3d.import.title'), t(remix3dErrorKey(e)));
    } finally {
      setImporting(false);
    }
  };

  // 📲 „Megnyitás a ReMix-szel": a bejövő fájlt a projekt betöltése után EGYSZER importáljuk
  const incomingDone = useRef(false);
  useEffect(() => {
    if (!importUri || incomingDone.current || !project || project.id !== projectId) {
      return;
    }
    incomingDone.current = true;
    // a router a paramétert már dekódolta → az eredeti file:// URI (a %-kódolás a helyén marad)
    const uri = importUri;
    let name = uri.split('/').pop() ?? 'model';
    try {
      name = decodeURIComponent(name);
    } catch {
      // hibás %-kódolás → a nyers név
    }
    void importFromFile({ uri, name });
    // az import egyszeri — a függőségek közül csak a projekt megérkezése számít
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importUri, project?.id, projectId]);

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
      Alert.alert(t('model3d.ar.title'), t(remix3dErrorKey(e)));
    }
  };

  // ↩️ a fejléc vissza-gombja rekonstrukció közben megerősítést kér
  const goBack = () => {
    if (!reconstructing.current) {
      goBackOrHome();
      return;
    }
    Alert.alert(t('model3d.reconstruct.leaveTitle'), t('model3d.reconstruct.leaveBody'), [
      { text: t('model3d.reconstruct.stay'), style: 'cancel' },
      {
        text: t('model3d.reconstruct.leave'),
        style: 'destructive',
        onPress: () => {
          void Remix3D?.cancelReconstruct();
          goBackOrHome();
        },
      },
    ]);
  };

  const onCaptureState = (e: CaptureStateEvent) => {
    setCapState(e);
    if (e.state === 'completed') {
      void reconstruct();
    }
  };

  const primaryAction = () => {
    haptics.selection();
    const c = captureRef.current;
    if (!c) return;
    if (capState.state === 'ready') void c.command('detect');
    else if (capState.state === 'detecting') void c.command('capture');
    else if (capState.state === 'capturing') void c.command('finish');
  };

  // ── nem LiDAR / nincs natív modul: ide az útvonal-őr miatt nem jutunk, de biztonságból ──
  if (!Remix3D || !Remix3DModelView || !Remix3DCaptureView) {
    return null;
  }

  // ── 🕸️ SZABAD SZKEN (Focus: élő háló a kameraképen) ─────────────────────────
  if (phase === 'roomScanning' && Remix3DRoomScanView) {
    const RoomView = Remix3DRoomScanView;
    return (
      <View style={styles.fill}>
        <RoomView ref={roomRef} style={StyleSheet.absoluteFill} />
        <SafeAreaView style={styles.fill} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.capTop} pointerEvents="box-none">
            <Pressable onPress={cancelRoomScan} hitSlop={10} style={styles.capBtn} accessibilityRole="button" accessibilityLabel={t('model3d.capture.cancel')}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.fill} pointerEvents="none" />
          <View style={styles.capBottom}>
            <Text style={styles.capHint} accessibilityLiveRegion="polite">
              {roomBusy ? t('model3d.room.saving') : t('model3d.room.hint')}
            </Text>
            {roomBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Pressable onPress={() => void finishRoomScan()} style={styles.capPrimary} accessibilityRole="button">
                <Text style={styles.capPrimaryText}>{t('model3d.room.done')}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (phase === 'meshScanning' && Remix3DMeshScanView) {
    const MeshView = Remix3DMeshScanView;
    const dark = scanState.light < DARK_LIGHT;
    const hint = dark ? t('model3d.mesh.dark') : t(`model3d.mesh.tracking_${scanState.tracking}`);
    return (
      <View style={styles.fill}>
        <MeshView ref={meshRef} style={StyleSheet.absoluteFill} onScanState={(ev) => setScanState(ev.nativeEvent)} />
        <SafeAreaView style={styles.fill} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.capTop} pointerEvents="box-none">
            <Pressable
              onPress={() => {
                void meshRef.current?.pause();
                setPhase(asset ? 'viewer' : 'empty');
              }}
              hitSlop={10}
              style={styles.capBtn}
              accessibilityRole="button"
              accessibilityLabel={t('model3d.capture.cancel')}
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
            <View style={styles.fill} />
            <View style={styles.meshCount}>
              <Text style={styles.meshCountText}>
                {scanMode === 'points'
                  ? t('model3d.mesh.points', { count: scanState.points ?? 0 })
                  : t('model3d.mesh.triangles', { count: scanState.triangles })}
              </Text>
            </View>
          </View>
          <View style={styles.fill} pointerEvents="none" />
          <View style={styles.capBottom}>
            <Text style={styles.capHint} accessibilityLiveRegion="polite">
              {savingMesh ? t('model3d.mesh.saving') : hint}
            </Text>
            {savingMesh ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Pressable
                onPress={() => void finishMeshScan()}
                disabled={scanMode === 'points' ? !scanState.points : scanState.triangles === 0}
                style={[styles.capPrimary, (scanMode === 'points' ? !scanState.points : scanState.triangles === 0) ? styles.disabled : null]}
                accessibilityRole="button"
              >
                <Text style={styles.capPrimaryText}>{t('model3d.mesh.done')}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── 🎯 RÖGZÍTÉS (Focus: teljes képernyő, élő útmutatás) ─────────────────────
  if (phase === 'capturing') {
    const CaptureView = Remix3DCaptureView;
    const fb = capState.feedback[0];
    const stuckHint =
      capState.state === 'initializing' && initElapsed >= 20000
        ? t('model3d.capture.hint_stuck')
        : capState.state === 'initializing' && initElapsed >= 5000
          ? t('model3d.capture.hint_slowStart')
          : null;
    const hint =
      stuckHint ??
      (fb
        ? t(`model3d.feedback.${fb}`, { defaultValue: t(`model3d.capture.hint_${capState.state}`) })
        : t(`model3d.capture.hint_${capState.state}`, { defaultValue: '' }));
    const primaryLabel =
      capState.state === 'ready'
        ? t('model3d.capture.select')
        : capState.state === 'detecting'
          ? t('model3d.capture.start')
          : capState.state === 'capturing'
            ? t('model3d.capture.finish')
            : null;
    return (
      <View style={styles.fill}>
        <CaptureView ref={captureRef} style={StyleSheet.absoluteFill} onCaptureState={(ev) => onCaptureState(ev.nativeEvent)} />
        <SafeAreaView style={styles.fill} pointerEvents="box-none" edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.capTop} pointerEvents="box-none">
            <Pressable onPress={confirmCancel} hitSlop={10} style={styles.capBtn} accessibilityRole="button" accessibilityLabel={t('model3d.capture.cancel')}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          <View style={styles.fill} pointerEvents="none" />
          <View style={styles.capBottom}>
            {hint ? (
              <Text style={styles.capHint} accessibilityLiveRegion="polite">
                {hint}
              </Text>
            ) : null}
            <View style={styles.capRow}>
              {capState.state === 'capturing' ? (
                <Pressable onPress={() => void captureRef.current?.command('newPass')} style={styles.capSecondary} accessibilityRole="button">
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.capSecondaryText}>{t('model3d.capture.newPass')}</Text>
                </Pressable>
              ) : null}
              {primaryLabel ? (
                <Pressable onPress={primaryAction} style={styles.capPrimary} accessibilityRole="button">
                  <Text style={styles.capPrimaryText}>{primaryLabel}</Text>
                </Pressable>
              ) : (
                <ActivityIndicator color="#fff" />
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.back')}>
        <Ionicons name="chevron-back" size={26} color={palette.text} />
      </Pressable>
      <View style={styles.headerTitle}>
        <Text style={styles.kindTag}>🧊 {t('model3d.title')}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {project?.name ?? ''}
        </Text>
      </View>
      {phase === 'viewer' ? (
        <View style={styles.headerActions}>
          {/* ⚙️ projekt-beállítások: mappa, ReMix Storage-szinkron, borító */}
          <Pressable
            onPress={() => router.push(`/collab/${projectId}`)}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('model3d.viewer.projectSettings')}
          >
            <Ionicons name="settings-outline" size={22} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={() => useEditorStore.getState().undo()}
            disabled={!canUndo}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('model3d.viewer.undo')}
            accessibilityState={{ disabled: !canUndo }}
          >
            <Ionicons name="arrow-undo" size={22} color={canUndo ? palette.text : palette.border} />
          </Pressable>
          <Pressable
            onPress={() => useEditorStore.getState().redo()}
            disabled={!canRedo}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t('model3d.viewer.redo')}
            accessibilityState={{ disabled: !canRedo }}
          >
            <Ionicons name="arrow-redo" size={22} color={canRedo ? palette.text : palette.border} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  // ── ⏳ REKONSTRUKCIÓ ────────────────────────────────────────────────────────
  if (phase === 'reconstructing') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.accent} />
          <Text style={styles.bigText}>{t('model3d.reconstruct.title')}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.dim}>{Math.round(progress * 100)}%</Text>
          <Text style={[styles.dim, styles.centerText]}>{t('model3d.reconstruct.hint')}</Text>
          <Pressable onPress={() => void Remix3D?.cancelReconstruct()} style={styles.secondaryBtn} accessibilityRole="button">
            <Text style={styles.secondaryText}>{t('model3d.reconstruct.cancel')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── 🧭 ÜRES: módválasztó (csak a támogatott módok — §1.1) ──────────────────
  if (phase === 'empty' || !asset || !mesh) {
    const modes = availableCaptureModes();
    // az eredmény TÉNYLEGES formátuma a projekt tárolási beállítása szerint (adatvesztés nélkül)
    const fmt = (kind: { textured: boolean; points: boolean }) => storedFormatFor(doc?.storageFormat, kind).toUpperCase();
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        {header}
        <ScrollView contentContainerStyle={styles.pickerScroll}>
          <Text style={styles.emoji}>🧊</Text>
          <Text style={styles.bigText}>{t('model3d.empty.title')}</Text>
          <Text style={[styles.dim, styles.centerText]}>{t('model3d.empty.body')}</Text>
          {modes.includes('freeform') && Remix3DMeshScanView ? (
            <ModeCard icon="grid-outline" mode="freeform" format={fmt({ textured: false, points: false })} onPress={() => startMeshScan('mesh')} />
          ) : null}
          {modes.includes('room') && Remix3DRoomScanView ? (
            <ModeCard icon="home-outline" mode="room" format={fmt({ textured: false, points: false })} onPress={startRoomScan} />
          ) : null}
          {modes.includes('pointcloud') && Remix3DMeshScanView ? (
            <ModeCard icon="sparkles-outline" mode="pointcloud" format={fmt({ textured: false, points: true })} onPress={() => startMeshScan('points')} />
          ) : null}
          {modes.includes('object') ? (
            <ModeCard icon="cube-outline" mode="object" format={fmt({ textured: true, points: false })} onPress={startCapture} />
          ) : null}
          {/* 📥 meglévő 3D-fájl (Blender, Sketchfab, más szkenner-app, CAD …) */}
          <ModeCard icon="download-outline" mode="import" format={fmt({ textured: true, points: false })} onPress={() => void importFromFile()} />
          {importing ? <ActivityIndicator color={palette.accent} /> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 👀 NÉZŐ (forgatás, nagyítás, automatikus forgás, háttér) ────────────────
  const ModelView = Remix3DModelView;
  const bg = doc?.environment.background ?? null;
  const size = boundsSize(mesh.bounds);
  const cycleBackground = () => {
    if (!doc) return;
    const i = BACKGROUNDS.indexOf(bg);
    const next = BACKGROUNDS[(i + 1) % BACKGROUNDS.length];
    useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: setEnvironment(doc, { background: next }), label: t('model3d.viewer.background') }, 'user');
  };
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      {header}
      <View style={[styles.viewer, { backgroundColor: bg ?? palette.bg }]}>
        <ModelView
          ref={viewRef}
          style={StyleSheet.absoluteFill}
          modelUri={asset.uri}
          background={bg}
          autoRotate={autoRotate && !measuring && !editOpen}
          modelRotation={(() => {
            const q = modelRotation(doc);
            return [q.x, q.y, q.z, q.w];
          })()}
          lightingPreset={doc?.environment.preset ?? 'studio'}
          exposure={doc?.environment.exposure ?? 1}
          cutPlaneY={cutPreviewY}
          measureMode={measuring}
          measureLines={(doc?.measurements ?? [])
            .filter((m) => m.kind === 'distance' && m.points.length >= 2)
            .flatMap((m) => [m.points[0].x, m.points[0].y, m.points[0].z, m.points[1].x, m.points[1].y, m.points[1].z])}
          measureDots={pendingPoint ? [pendingPoint.x, pendingPoint.y, pendingPoint.z] : []}
          onTapPoint={(e) => {
            const p = e.nativeEvent;
            if (!pendingPoint) {
              haptics.selection();
              setPendingPoint({ x: p.x, y: p.y, z: p.z });
              return;
            }
            const latest = useEditorStore.getState().project?.model3d;
            if (latest) {
              haptics.success();
              useEditorStore.getState().dispatch(
                { type: 'SET_MODEL3D_DOC', doc: addMeasurement(latest, { kind: 'distance', points: [pendingPoint, { x: p.x, y: p.y, z: p.z }] }), label: t('model3d.viewer.measure') },
                'user'
              );
            }
            setPendingPoint(null);
          }}
          wireframe={wireframe}
          onLoad={() => {
            setLoadFailedUri(null);
            // 🔢 a régebbi szkenek 0 háromszöggel mentődtek (a natív számláló a felső szintet
            // nézte) → a javított számlálóval egyszer pótoljuk
            if (mesh.triangles === 0 && Remix3D) {
              const meshId = mesh.id;
              Remix3D.inspectModel(asset.uri)
                .then((info) => {
                  const latest = useEditorStore.getState().project?.model3d;
                  if (!latest || info.triangles <= 0) return;
                  const meshes = latest.meshes.map((x) => (x.id === meshId ? { ...x, triangles: info.triangles } : x));
                  useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: { ...latest, meshes } }, 'system');
                })
                .catch(() => {});
            }
            // nincs (vagy üres) poszter → egyszer (modellenként) elkészítjük a lista előnézeti képét
            if (doc && Remix3D && posterTried.current !== asset.uri) {
              posterTried.current = asset.uri;
              void (async () => {
                // hiányzó VAGY üres (régi / háttérben renderelt) poszter → újra
                const current = doc.poster && fileExists(doc.poster) ? doc.poster : null;
                if (current && !(await Remix3D.imageIsBlank?.(current).catch(() => false))) {
                  return;
                }
                // új fájlnév: a doc változik (mentés + a lista-bélyegkép frissül), a régi üres
                // poszter a mappa-takarításnál kiesik
                const posterUri = `${projectMediaDir().uri.replace(/\/?$/, '/')}m3d_${asset.id}_poster_${Date.now().toString(36)}.png`;
                const poster =
                  (await Remix3D.snapshotFile(asset.uri, posterUri, 512, 512, Math.PI / 6, Math.PI / 9, false, lookOptionsJson(doc)).catch(() => null)) ??
                  // tartalék: a LÁTHATÓ néző képe (a képernyőn lévő GPU-kontextus biztosan rajzol)
                  (await viewRef.current?.snapshot(posterUri, 512, 512, false).catch(() => null)) ??
                  null;
                const latest = useEditorStore.getState().project?.model3d;
                if (poster && latest) {
                  useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: { ...latest, poster } }, 'system');
                }
              })();
            }
          }}
          onError={() => setLoadFailedUri(asset.uri)}
        />
        {loadFailed ? (
          <View style={styles.loadFailed} pointerEvents="none">
            <Text style={[styles.dim, styles.centerText]}>{t('model3d.viewer.loadFailed')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.dim, styles.centerText, styles.stats]}>
        {t('model3d.viewer.stats', {
          tris: mesh.points ? t('model3d.mesh.points', { count: mesh.points }) : mesh.triangles.toLocaleString(),
          size: `${formatLength(size.x)} × ${formatLength(size.y)} × ${formatLength(size.z)}`,
        })}
      </Text>
      {measuring ? (
        <View style={styles.measurePanel}>
          <Text style={[styles.dim, styles.centerText]}>
            {t(pendingPoint ? 'model3d.viewer.measureSecond' : 'model3d.viewer.measureFirst')}
            {(doc?.measurements.length ?? 0) > 0 ? ` ${t('model3d.viewer.measureTapToDelete')}` : ''}
          </Text>
          <View style={styles.measureList}>
            {(doc?.measurements ?? []).map((m) => {
              const v = measurementValue(m);
              return (
                <Pressable
                  key={m.id}
                  style={styles.measureChip}
                  accessibilityRole="button"
                  accessibilityLabel={`${v != null ? formatLength(v) : '—'} — ${t('model3d.viewer.measureTapToDelete')}`}
                  onPress={() => {
                    const latest = useEditorStore.getState().project?.model3d;
                    if (latest) {
                      useEditorStore
                        .getState()
                        .dispatch({ type: 'SET_MODEL3D_DOC', doc: removeMeasurement(latest, m.id), label: t('model3d.viewer.measureDelete') }, 'user');
                    }
                  }}
                >
                  <Ionicons name="resize-outline" size={14} color={palette.accent} />
                  <Text style={styles.measureText}>{v != null ? formatLength(v) : '—'}</Text>
                  <Ionicons name="close" size={14} color={palette.textDim} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : doc?.capture?.room ? (
        <View style={styles.measurePanel}>
          <Text style={[styles.roomLine, styles.centerText]}>
            {`${t('model3d.room.area')}: ${formatArea(doc.capture.room.floorArea)} · ${t('model3d.room.walls')}: ${formatLength(roomStats(doc.capture.room).wallLength, 'm')} · ${t('model3d.room.ceiling')}: ${formatLength(roomStats(doc.capture.room).ceilingHeight, 'm')}`}
          </Text>
          <Text style={[styles.dim, styles.centerText]}>
            {t('model3d.room.counts', {
              doors: doc.capture.room.openings.filter((o) => o.kind === 'door').length,
              windows: doc.capture.room.openings.filter((o) => o.kind === 'window').length,
              objects: doc.capture.room.objects.length,
            })}
          </Text>
          <Pressable onPress={() => void exportFloorPlan()} style={styles.measureChip} accessibilityRole="button">
            <Ionicons name="map-outline" size={16} color={palette.accent} />
            <Text style={styles.measureText}>{t('model3d.room.floorPlan')}</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.dim, styles.centerText]}>{t('model3d.viewer.hint')}</Text>
      )}
      <View style={styles.toolbar}>
        <Tool icon={autoRotate ? 'pause-circle-outline' : 'sync-outline'} label={t('model3d.viewer.autoRotate')} active={autoRotate} onPress={() => setAutoRotate((v) => !v)} />
        <Tool icon="options-outline" label={t('model3d.viewer.edit')} active={editOpen} onPress={() => setEditOpen(true)} />
        <Tool
          icon="grid-outline"
          label={t(`model3d.viewer.wireframe_${wireframe}`)}
          active={wireframe !== 'off'}
          onPress={() => setWireframe(WIREFRAME_CYCLE[(WIREFRAME_CYCLE.indexOf(wireframe) + 1) % WIREFRAME_CYCLE.length])}
        />
        <Tool
          icon="resize-outline"
          label={t('model3d.viewer.measure')}
          active={measuring}
          onPress={() => {
            setMeasuring((v) => !v);
            setPendingPoint(null);
          }}
        />
        <Tool icon="share-outline" label={t('model3d.export.title')} onPress={() => setExportOpen(true)} />
        {/* 🥽 AR Gyorsnézet — pontfelhőt az AR nem jelenít meg (USDZ háló kell) */}
        {mesh.points ? null : <Tool icon="cube-outline" label={t('model3d.ar.short')} onPress={() => void openAR()} />}
        <Tool
          icon="scan-outline"
          label={t('model3d.viewer.newScan')}
          onPress={() => {
            setPicking(true);
            setPhase('empty');
          }}
        />
      </View>
      {doc ? (
        <Model3DEditSheet
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          doc={doc}
          mesh={mesh}
          onDoc={(next, label) => useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: next, label }, 'user')}
          onCutPreview={setCutPreviewY}
          onProcess={applyProcess}
          onBackground={cycleBackground}
          onStorageFormat={changeStorageFormat}
        />
      ) : null}
      {project && doc ? (
        <Model3DExportSheet
          visible={exportOpen}
          onClose={() => setExportOpen(false)}
          modelUri={asset.uri}
          mesh={mesh}
          project={project}
          doc={doc}
          background={bg}
          lookJson={lookOptionsJson(doc)}
          onCurrentView={async () => {
            if (!viewRef.current) throw new Error('model3d.error.unsupported');
            return viewRef.current.snapshot(new File(Paths.cache, `m3d_view_${makeId('img')}.png`).uri, 1440, 1440, true);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** 🧭 egy rögzítési mód kártyája: mire jó · hogyan · mi lesz az eredmény (a valós formátummal) */
function ModeCard({
  icon,
  mode,
  format,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  mode: 'object' | 'freeform' | 'room' | 'pointcloud' | 'import';
  format: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
      accessibilityRole="button"
      accessibilityLabel={t(`model3d.mode.${mode}`)}
      accessibilityHint={t(`model3d.mode.${mode}Desc`)}
    >
      <Ionicons name={icon} size={26} color={palette.accent} style={styles.modeIcon} />
      <View style={styles.fill}>
        <Text style={styles.modeTitle}>{t(`model3d.mode.${mode}`)}</Text>
        <Text style={styles.modeDesc}>{t(`model3d.mode.${mode}Desc`)}</Text>
        <Text style={styles.modeHow}>
          <Text style={styles.modeHowLabel}>{t('model3d.mode.howLabel')} </Text>
          {t(`model3d.mode.${mode}How`)}
        </Text>
        <Text style={styles.modeResult}>{t(`model3d.mode.${mode}Result`, { format })}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={palette.textDim} />
    </Pressable>
  );
}

function Tool({ icon, label, onPress, active }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={styles.tool} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={active ? palette.accent : palette.text} />
      <Text style={[styles.toolLabel, active ? { color: palette.accent } : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  root: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  headerTitle: { flex: 1 },
  kindTag: { color: palette.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  centerText: { textAlign: 'center' },
  loadFailed: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emoji: { fontSize: 48 },
  bigText: { color: palette.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  dim: { color: palette.textDim, fontSize: 13, lineHeight: 19 },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    alignSelf: 'stretch',
    minHeight: 72,
    padding: 16,
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  modeTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  modeDesc: { color: palette.text, fontSize: 13, lineHeight: 18, marginTop: 2 },
  modeHow: { color: palette.textDim, fontSize: 12, lineHeight: 17, marginTop: 6 },
  modeHowLabel: { color: palette.textDim, fontWeight: '700' },
  modeResult: { color: palette.accent, fontSize: 12, lineHeight: 17, marginTop: 4, fontWeight: '600' },
  modeIcon: { alignSelf: 'flex-start', marginTop: 2 },
  modeCardPressed: { opacity: 0.75 },
  pickerScroll: { alignItems: 'center', padding: 20, paddingBottom: 40, gap: 6 },
  progressTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: palette.surfaceHigh, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: palette.accent },
  secondaryBtn: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: palette.border },
  secondaryText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  viewer: { flex: 1, marginHorizontal: 12, borderRadius: 18, overflow: 'hidden' },
  stats: { marginTop: 10 },
  toolbar: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.border, marginTop: 10 },
  tool: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 },
  headerActions: { flexDirection: 'row', gap: 4, marginLeft: 'auto' },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  measurePanel: { gap: 8, paddingHorizontal: 12 },
  measureList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  measureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: palette.surfaceHigh,
  },
  measureText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  roomLine: { color: palette.text, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  toolLabel: { color: palette.text, fontSize: 11, fontWeight: '600' },
  capTop: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  meshCount: { paddingHorizontal: 12, height: 32, justifyContent: 'center', borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)' },
  meshCountText: { color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  disabled: { opacity: 0.4 },
  capBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  capBottom: { padding: 16, gap: 12, alignItems: 'center' },
  capHint: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  capPrimary: { minHeight: 52, paddingHorizontal: 28, borderRadius: 26, backgroundColor: palette.accent, justifyContent: 'center' },
  capPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  capSecondary: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)' },
  capSecondaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
