import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Model3DEditSheet } from '@/components/studio/model3d/Model3DEditSheet';
import { Model3DExportSheet } from '@/components/studio/model3d/Model3DExportSheet';
import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { ModelViewport } from '@/components/studio/model3d/render/ModelViewport';
import { ViewerInfoPanel } from '@/components/studio/model3d/render/ViewerInfoPanel';
import { ViewerToolbar } from '@/components/studio/model3d/render/ViewerToolbar';
import { createViewportHandlers } from '@/components/studio/model3d/render/viewportHandlers';
import type { Phase, SetState } from '@/components/studio/model3d/studioTypes';
import { boundsSize } from '@/lib/model3d';
import { setEnvironment } from '@/lib/model3dDoc';
import { lookOptionsJson, type SimplifyLevel } from '@/lib/model3dLook';
import { BACKGROUNDS, nextInCycle } from '@/lib/model3dStudioOps';
import type { ModelViewHandle, Remix3DModelView, WireframeMode } from '@/lib/remix3dNative';
import { useEditorStore } from '@/store/editorStore';
import type { MeshFormat, Model3DDoc, Model3DMesh, Vec3 } from '@/types/model3d';
import type { Asset, Project } from '@/types/project';

export interface Model3DViewerProps {
  header: ReactNode;
  ModelView: NonNullable<typeof Remix3DModelView>;
  project: Project | null;
  doc: Model3DDoc | undefined;
  mesh: Model3DMesh;
  asset: Asset;
  viewRef: RefObject<ModelViewHandle | null>;
  posterTried: { current: string | null };
  loadFailed: boolean;
  setLoadFailedUri: SetState<string | null>;
  measuring: boolean;
  setMeasuring: SetState<boolean>;
  pendingPoint: Vec3 | null;
  setPendingPoint: SetState<Vec3 | null>;
  editOpen: boolean;
  setEditOpen: SetState<boolean>;
  exportOpen: boolean;
  setExportOpen: SetState<boolean>;
  cutPreviewY: number | null;
  setCutPreviewY: SetState<number | null>;
  autoRotate: boolean;
  setAutoRotate: SetState<boolean>;
  wireframe: WireframeMode;
  setWireframe: SetState<WireframeMode>;
  setPicking: SetState<boolean>;
  setPhase: SetState<Phase>;
  applyProcess: (op: { cutY?: number; simplify?: SimplifyLevel }) => Promise<void>;
  changeStorageFormat: (pref: MeshFormat) => Promise<void>;
  openAR: () => Promise<void>;
  exportFloorPlan: () => Promise<void>;
  snapshotCurrentView: () => Promise<string>;
}

/** 👀 NÉZŐ (forgatás, nagyítás, automatikus forgás, háttér) + szerkesztő- és export-lap */
export function Model3DViewer(p: Model3DViewerProps) {
  const { header, ModelView, project, doc, mesh, asset, viewRef, posterTried, loadFailed, setLoadFailedUri, measuring, pendingPoint, setPendingPoint, editOpen, setEditOpen, exportOpen, setExportOpen, cutPreviewY, setCutPreviewY, autoRotate, wireframe } = p;
  const { t } = useTranslation();
  const bg = doc?.environment.background ?? null;
  const size = boundsSize(mesh.bounds);
  const cycleBackground = () => {
    if (!doc) return;
    const next = nextInCycle(BACKGROUNDS, bg);
    useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: setEnvironment(doc, { background: next }), label: t('model3d.viewer.background') }, 'user');
  };
  const viewport = createViewportHandlers({ t, doc, mesh, asset, pendingPoint, setPendingPoint, setLoadFailedUri, posterTried, viewRef });
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      {header}
      <ModelViewport
        ModelView={ModelView}
        viewRef={viewRef}
        asset={asset}
        doc={doc}
        bg={bg}
        autoRotate={autoRotate && !measuring && !editOpen}
        cutPreviewY={cutPreviewY}
        measuring={measuring}
        pendingPoint={pendingPoint}
        wireframe={wireframe}
        loadFailed={loadFailed}
        onTapPoint={viewport.onTapPoint}
        onLoad={viewport.onLoad}
        onError={viewport.onError}
      />
      <ViewerInfoPanel doc={doc} mesh={mesh} size={size} measuring={measuring} pendingPoint={pendingPoint} onFloorPlan={p.exportFloorPlan} />
      <ViewerToolbar
        autoRotate={autoRotate}
        setAutoRotate={p.setAutoRotate}
        editOpen={editOpen}
        setEditOpen={setEditOpen}
        wireframe={wireframe}
        setWireframe={p.setWireframe}
        measuring={measuring}
        setMeasuring={p.setMeasuring}
        setPendingPoint={setPendingPoint}
        setExportOpen={setExportOpen}
        isPoints={!!mesh.points}
        onAR={p.openAR}
        setPicking={p.setPicking}
        setPhase={p.setPhase}
      />
      {doc ? (
        <Model3DEditSheet
          visible={editOpen}
          onClose={() => setEditOpen(false)}
          doc={doc}
          mesh={mesh}
          onDoc={(next, label) => useEditorStore.getState().dispatch({ type: 'SET_MODEL3D_DOC', doc: next, label }, 'user')}
          onCutPreview={setCutPreviewY}
          onProcess={p.applyProcess}
          onBackground={cycleBackground}
          onStorageFormat={p.changeStorageFormat}
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
          onCurrentView={p.snapshotCurrentView}
        />
      ) : null}
    </SafeAreaView>
  );
}
