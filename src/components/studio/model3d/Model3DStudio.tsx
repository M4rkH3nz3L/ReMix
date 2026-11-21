import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { CaptureModePicker } from '@/components/studio/model3d/capture/CaptureModePicker';
import { createCaptureActions } from '@/components/studio/model3d/capture/captureActions';
import { createImportActions } from '@/components/studio/model3d/capture/importActions';
import { MeshScanScreen } from '@/components/studio/model3d/capture/MeshScanScreen';
import { ObjectCaptureScreen } from '@/components/studio/model3d/capture/ObjectCaptureScreen';
import { RoomScanScreen } from '@/components/studio/model3d/capture/RoomScanScreen';
import { createExportActions } from '@/components/studio/model3d/export/exportActions';
import { createModelProcessActions } from '@/components/studio/model3d/processing/modelProcessActions';
import { ReconstructingScreen } from '@/components/studio/model3d/processing/ReconstructingScreen';
import { createScanSaveActions } from '@/components/studio/model3d/processing/scanSaveActions';
import { Model3DViewer } from '@/components/studio/model3d/render/Model3DViewer';
import { StudioHeader } from '@/components/studio/model3d/render/StudioHeader';
import type { Phase } from '@/components/studio/model3d/studioTypes';
import { useBackLayer } from '@/hooks/useBackLayer';
import { currentModel } from '@/lib/model3dMedia';
import { goBackOrHome } from '@/lib/nav';
import {
  Remix3D,
  Remix3DCaptureView,
  Remix3DModelView,
  Remix3DMeshScanView,
  Remix3DRoomScanView,
  type CaptureStateEvent,
  type CaptureViewHandle,
  type MeshScanHandle,
  type MeshScanStateEvent,
  type ModelViewHandle,
  type RoomScanHandle,
  type WireframeMode,
} from '@/lib/remix3dNative';
import { useEditorStore } from '@/store/editorStore';
import type { Vec3 } from '@/types/model3d';
import { logCaught } from '@/lib/logCaught';

/**
 * 🧊 3D Stúdió (3D-Studio.md §2.1, §7, §8.1) — 3D-1: Tárgy-szken → rekonstrukció → néző.
 *
 *  • A projekt a KÖZÖS `useEditorStore`-ban él; minden változás a command buson
 *    (`ADD_ASSET` + `SET_MODEL3D_DOC`, egy `applyBatch`-ben → egy undo-lépés).
 *  • A rögzítés Focus-szintű (teljes képernyő, élő útmutatás), a vissza-gomb
 *    megerősítéssel vet el (a vissza-verem tetején).
 *  • A képkészlet IDEIGLENES (cache), a kész USDZ a lapos `media/`-ba kerül (§15.8).
 *
 * A gyökér az állapotot (hookok eredeti sorrendben), a vissza-réteget, a fázis szerinti
 * elágazást és a navigációt tartja; felelősség szerint (REFACTOR): `capture/` (szken-módok,
 * rögzítés, import), `processing/` (szken-mentés, rekonstrukció, háló-feldolgozás),
 * `render/` (néző, fejléc, eszközsor), `export/` (alaprajz, AR, nézet-kép).
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

  // ⚙️ feldolgozás: szken → tárolási formátum → poszter → egy undo-lépés; rekonstrukció
  const { finishRoomScan, finishMeshScan, reconstruct } = createScanSaveActions({
    t,
    projectId,
    project,
    doc,
    asset,
    scanMode,
    roomBusy,
    savingMesh,
    meshRef,
    roomRef,
    scanStartedAt,
    reconstructing,
    setPhase,
    setRoomBusy,
    setSavingMesh,
    setWireframe,
    setProgress,
  });
  // 🎯 rögzítés: szken-módok indítása / megszakítása, objektum-rögzítés vezérlése
  const capture = createCaptureActions({
    t,
    projectId,
    asset,
    capState,
    captureRef,
    meshRef,
    roomRef,
    scanStartedAt,
    setPhase,
    setPicking,
    setScanMode,
    setScanState,
    setCapState,
    reconstruct,
  });
  const { confirmCancel, cancelRoomScan } = capture;

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

  // a stúdió elhagyásakor a futó rekonstrukció leáll (különben a háttérben dolgozna tovább)
  useEffect(
    () => () => {
      if (reconstructing.current) {
        void Remix3D?.cancelReconstruct();
      }
    },
    []
  );

  const { applyProcess, changeStorageFormat } = createModelProcessActions({ t, projectId, project, doc, mesh, asset });
  const { importFromFile } = createImportActions({ t, projectId, project, doc, importing, setImporting, setPicking, setPhase });

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
    } catch (caught) {
      logCaught('components/studio/model3d/Model3DStudio.tsx:Model3DStudio', caught);
      // hibás %-kódolás → a nyers név
    }
    void importFromFile({ uri, name });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- az import egyszeri; a függőségek közül csak a projekt megérkezése számít
  }, [importUri, project?.id, projectId]);

  // 📤 kivitel: alaprajz kép-projektként, AR Gyorsnézet, a látható nézet képe
  const { exportFloorPlan, openAR, snapshotCurrentView } = createExportActions({ t, project, doc, mesh, asset, viewRef });

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

  // ── nem LiDAR / nincs natív modul: ide az útvonal-őr miatt nem jutunk, de biztonságból ──
  if (!Remix3D || !Remix3DModelView || !Remix3DCaptureView) {
    return null;
  }

  // ── 🕸️ SZABAD SZKEN (Focus: élő háló a kameraképen) ─────────────────────────
  if (phase === 'roomScanning' && Remix3DRoomScanView) {
    return <RoomScanScreen RoomView={Remix3DRoomScanView} roomRef={roomRef} roomBusy={roomBusy} onCancel={cancelRoomScan} onFinish={finishRoomScan} />;
  }

  if (phase === 'meshScanning' && Remix3DMeshScanView) {
    return (
      <MeshScanScreen
        MeshView={Remix3DMeshScanView}
        meshRef={meshRef}
        scanState={scanState}
        setScanState={setScanState}
        scanMode={scanMode}
        savingMesh={savingMesh}
        onCancel={capture.cancelMeshScan}
        onFinish={finishMeshScan}
      />
    );
  }

  // ── 🎯 RÖGZÍTÉS (Focus: teljes képernyő, élő útmutatás) ─────────────────────
  if (phase === 'capturing') {
    return (
      <ObjectCaptureScreen
        CaptureView={Remix3DCaptureView}
        captureRef={captureRef}
        capState={capState}
        initElapsed={initElapsed}
        onCaptureState={capture.onCaptureState}
        onCancel={confirmCancel}
        onPrimary={capture.primaryAction}
      />
    );
  }

  const header = (
    <StudioHeader projectId={projectId} projectName={project?.name ?? ''} showActions={phase === 'viewer'} canUndo={canUndo} canRedo={canRedo} onBack={goBack} />
  );

  // ── ⏳ REKONSTRUKCIÓ ────────────────────────────────────────────────────────
  if (phase === 'reconstructing') {
    return <ReconstructingScreen header={header} progress={progress} />;
  }

  // ── 🧭 ÜRES: módválasztó (csak a támogatott módok — §1.1) ──────────────────
  if (phase === 'empty' || !asset || !mesh) {
    return (
      <CaptureModePicker
        header={header}
        doc={doc}
        importing={importing}
        onMeshScan={capture.startMeshScan}
        onRoomScan={capture.startRoomScan}
        onCapture={capture.startCapture}
        onImport={importFromFile}
      />
    );
  }

  // ── 👀 NÉZŐ (forgatás, nagyítás, automatikus forgás, háttér) ────────────────
  return (
    <Model3DViewer
      header={header}
      ModelView={Remix3DModelView}
      project={project}
      doc={doc}
      mesh={mesh}
      asset={asset}
      viewRef={viewRef}
      posterTried={posterTried}
      loadFailed={loadFailed}
      setLoadFailedUri={setLoadFailedUri}
      measuring={measuring}
      setMeasuring={setMeasuring}
      pendingPoint={pendingPoint}
      setPendingPoint={setPendingPoint}
      editOpen={editOpen}
      setEditOpen={setEditOpen}
      exportOpen={exportOpen}
      setExportOpen={setExportOpen}
      cutPreviewY={cutPreviewY}
      setCutPreviewY={setCutPreviewY}
      autoRotate={autoRotate}
      setAutoRotate={setAutoRotate}
      wireframe={wireframe}
      setWireframe={setWireframe}
      setPicking={setPicking}
      setPhase={setPhase}
      applyProcess={applyProcess}
      changeStorageFormat={changeStorageFormat}
      openAR={openAR}
      exportFloorPlan={exportFloorPlan}
      snapshotCurrentView={snapshotCurrentView}
    />
  );
}
