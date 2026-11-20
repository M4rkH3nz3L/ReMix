import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { NewerSchemaBanner } from '@/components/NewerSchemaBanner';
import { RenderStage, ensureTextClipMasks } from '@/components/studio/image/RenderStage';
import { type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { EmptyCanvasHint } from '@/components/studio/image/EmptyCanvasHint';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { ImageStudioSheets } from '@/components/studio/image/body/ImageStudioSheets';
import { ActiveModeBar } from '@/components/studio/image/body/ActiveModeBar';
import { DockedLayerPanel } from '@/components/studio/image/body/DockedLayerPanel';
import { PageStrip } from '@/components/studio/image/body/PageStrip';
import { ActiveSelectionRow, ExportingRow, StatusHintRow } from '@/components/studio/image/body/StatusRows';
import { StudioTopBar } from '@/components/studio/image/body/StudioTopBar';
import { createLayerEditActions } from '@/components/studio/image/body/layerEditActions';
import { createModeActions } from '@/components/studio/image/body/modeActions';
import { createPathEditActions } from '@/components/studio/image/body/pathEditActions';
import { createToolDispatch } from '@/components/studio/image/body/toolDispatch';
import { useImageExport } from '@/components/studio/image/body/useImageExport';
import { useImageImports } from '@/components/studio/image/body/useImageImports';
import { useImagePages } from '@/components/studio/image/body/useImagePages';
import { useLayerRasterOps } from '@/components/studio/image/body/useLayerRasterOps';
import { useSelectionOps } from '@/components/studio/image/body/useSelectionOps';
import { useEnsureImageDoc, usePageThumbnail, useProjectFonts } from '@/components/studio/image/body/useStudioLifecycle';
import { useStudioModeState } from '@/components/studio/image/body/useStudioModeState';
import { useStudioPanels } from '@/components/studio/image/body/useStudioPanels';
import { type SelectionAction } from '@/components/studio/image/body/SelectionBar';
import { palette } from '@/constants/editor';
import { useBackLayer } from '@/hooks/useBackLayer';
import { layoutBudget } from '@/lib/panelLayout';
// 🪄 magicWandClient (Skia-függő) SZÁNDÉKOSAN NINCS statikusan importálva — lustán
// töltjük (lásd onWandSeed), hogy a @shopify/react-native-skia natív modul hiánya
// (régi dev-kliens) ne crash-eltesse az EGÉSZ kép-stúdiót; a vászon/forma/szöveg/
// gradient/export Skia nélkül is megy, csak a varázspálca igényli.
import { docIsEmpty, moveLayerTo } from '@/lib/imageDoc';
import { imageDocContentKey } from '@/lib/imageExport';
import { type ImageWorkspace, railGroups, type ToolKey } from '@/lib/imageMenu';
import { isPrecisionMode } from '@/lib/imageStudioOps';
import { registerDevAction } from '@/lib/devActions';
import { applyRing, type Point } from '@/lib/selection';
import { ImageStudioToolbar } from '@/components/studio/image/body/ImageStudioToolbar';
import { EdgeTab } from '@/components/studio/image/body/PanelChrome';
import { useEditorStore } from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import type { ImageDoc, PhotoLayer } from '@/types/project';

// a Skia csak megnyitáskor töltődik be, mint az ecsetnél
const PixelStudio = lazy(() =>
  import('@/components/studio/image/PixelStudio').then((m) => ({ default: m.PixelStudio }))
);

/**
 * 🖼️ A Kép Stúdió TÖRZSE — store-vezérelt, UI-only, a hang-stúdióval AZONOS
 * megosztott-törzs mintára. `project` mód: a projekt `imageDocs[0]` réteg-fáján
 * dolgozik (a `/studio/image/[id]` képernyő). `scoped` mód: a videó-editorból
 * nyíló Modal, egy adott kép-klip dokumentumán (docId), és a `onSave` visszaírja
 * a klipre. Minden szerkesztés a command-buson megy (undo).
 *
 * REFACTOR: a gyökér a közös állapotot, a hookokat (eredeti sorrendben), a füstteszt-akciókat és a
 * kompozíciót tartja; a részek a `body/` alatt — panelek, módállapot, életciklus-effektek, a hook
 * nélküli akció-gyárak (réteg-szerkesztés, módok, path-szerkesztés, szerszám-útválasztás), az alsó
 * mód-sáv és a dokkolt rétegpanel.
 */
export function ImageStudioBody({
  mode,
  title,
  docId,
  initialPageId,
  initialWorkspace = 'image',
  onExit,
  onSave,
}: {
  mode: 'project' | 'scoped';
  title: string;
  docId?: string;
  /** project mód: az induló lap (pl. album-borító) — érvénytelen id → első lap */
  initialPageId?: string;
  /** 🎨 a nyitó munkaterület (Design-projektnél / `?ws=design`): sablon, méret, tipográfia elöl */
  initialWorkspace?: ImageWorkspace;
  onExit: () => void;
  onSave?: (doc: ImageDoc, renderedUri: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  // 🔒 reaktív Pro-állapot a PSD-import gombhoz (free → letiltva + upsell)
  const isPro = useEntitlement((s) => s.isPro());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(initialPageId ?? null);
  const [workspaceTab, setWorkspaceTab] = useState<ImageWorkspace>(initialWorkspace);
  // 🔤 S10: a projekt saját fontjai betöltve a megnyitáskor; a betöltés után a vászon újrarajzol
  const fontsVersion = useProjectFonts();
  // 🧪 füstteszt: a munkaterület és a sín első szerszámai (a Design belépési pont mérése)
  useEffect(
    () =>
      registerDevAction('image.workspace', (arg) => {
        if (arg === 'image' || arg === 'design') setWorkspaceTab(arg);
        return { ws: workspaceTab, tools: railGroups(workspaceTab)[0].tools };
      }),
    [workspaceTab]
  );
  const { sheet, setSheet, sheetDetent, onSheetDetent, workH, setWorkH, workspace, panels, railYieldsToPanel, setRailOpen, setLayersOpen } =
    useStudioPanels();
  const [orderPreview, setOrderPreview] = useState<{ id: string; to: number } | null>(null);
  const ms = useStudioModeState();
  const { busy, setBusy, capturing, setCapturing, cropRect, setCropRect, cropPreset, penPoints, setPenPoints } = ms;
  const { pathEditId, pathEditRing, pathEditNode, setPathEditNode, lassoActive, setLassoActive } = ms;
  const { selection, setSelection, selectTool, selectMode, selectTargetId, setSelectTargetId, maskTarget, setMaskTarget } = ms;
  const { wandActive, setWandActive, wandTolerance, cornerPinId, wandContiguous, brushActive, pixelOpen, setPixelOpen, multiIds } = ms;
  const { pixelLayerId, brush, brushLayerId, brushMaskMode, brushSource, needSource, setNeedSource, onBrushHistory } = ms;
  const { guidesActive, quickAdjust, setQuickAdjust } = ms;
  const brushRef = useRef<BrushHandle>(null);
  const canvasRef = useRef<View>(null);

  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = () => useEditorStore.getState().undo();
  const redo = () => useEditorStore.getState().redo();

  // project módban gondoskodunk róla, hogy legyen legalább egy kép-dokumentum
  useEnsureImageDoc(mode);

  // 🖼️📄 project mód: a galéria lapjai közül az AKTÍV lapon dolgozunk (nem fixen a [0]-n).
  // A gallériát a `project.imageDocs` adja; az aktív lap id-ja állapot — invalid/null id-ra
  // render közben az ELSŐ lapra esik vissza (nincs effect-setState, nincs kaszkád-render).
  const pages = mode === 'project' ? project?.imageDocs ?? [] : [];
  const effectiveActivePageId =
    activePageId && pages.some((d) => d.id === activePageId) ? activePageId : pages[0]?.id ?? null;

  const doc =
    mode === 'scoped'
      ? project?.imageDocs?.find((d) => d.id === docId) ?? null
      : pages.find((d) => d.id === effectiveActivePageId) ?? pages[0] ?? null;

  const scopedOpenKey = useRef<string | null>(null);
  if (mode === 'scoped' && doc && scopedOpenKey.current === null) {
    scopedOpenKey.current = imageDocContentKey(doc);
  }

  const commit = (next: ImageDoc, label?: string) =>
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: next, label });

  const {
    renderStageRef,
    exportAbort,
    exporting,
    rasterize,
    captureCanvas,
    exportPart,
    exportPack,
    exportImage,
    exportSvg,
    exportPdf,
    exportVectorPdf,
    exportPsdFile,
    insertIntoVideo,
    confirmShare,
    saveScoped,
  } = useImageExport({ doc, project, pages, busy, setBusy, setCapturing, canvasRef, onSave, onExit });


  // 🖼️ I41: élő bélyegkép az aktív lapról, szerkesztési szünetben (a régi fájl törlődik)
  usePageThumbnail({ doc, mode, renderStageRef });

  // a kijelölés levezetve — ha a réteg eltűnik (törlés/undo), null-ra esik
  const selectedLayer = doc?.layers.find((l) => l.id === selectedId) ?? null;
  const effectiveSelectedId = selectedLayer ? selectedId : null;
  // ↩️ a gyors korrekció-sáv csak fotó-kijelölésnél látszik — a vissza is csak akkor nyeli el
  useBackLayer(quickAdjust && selectedLayer?.kind === 'photo' ? () => setQuickAdjust(false) : null);

  const { addDocPage, addPage, duplicateActivePage, deleteActivePage, movePage, activeIdx } = useImagePages({
    doc,
    pages,
    setActivePageId,
    setSelectedId,
  });
  const { insertBrandLogo, addTemplatePage, addVariantPage, add, addShapeType, insertSource, placeImage, fillPlaceholder, onMultiAction, onPixelDone } =
    createLayerEditActions({ t, doc, commit, setSelectedId, setSheet, addDocPage, ms });
  // 🧪 füstteszt: ugyanaz a beszúrás, a lap nélkül
  const insertBrandLogoRef = useRef(insertBrandLogo);
  insertBrandLogoRef.current = insertBrandLogo;
  useEffect(() => registerDevAction('image.insertBrandLogo', (arg) => {
    insertBrandLogoRef.current(String(arg));
    return true;
  }), []);

  const { importImageFile, importSvg, importPsdDoc, importPdfDocs } = useImageImports({
    mode,
    doc,
    project,
    busy,
    setBusy,
    commit,
    setSelectedId,
    setSheet,
    setActivePageId,
  });

  // 🧪 füstteszt: a galéria (rendszer-felület) helyett a kép közvetlenül, ugyanazzal a paranccsal
  const placeImageRef = useRef(placeImage);
  placeImageRef.current = placeImage;
  useEffect(() => registerDevAction('image.fillPlaceholder', (arg) => {
    const a = arg as { layerId: string; uri: string };
    return placeImageRef.current(a.layerId, a.uri);
  }), []);

  const { mergeLayers, removeBackground, pathOperation } = useLayerRasterOps({
    doc,
    busy,
    setBusy,
    isPro,
    commit,
    rasterize,
    setSelectedId,
  });

  const modeActions = createModeActions({ t, doc, commit, captureCanvas, selectedId, setSelectedId, setSheet, brushRef, ms });
  const { commitPen, startRetouch, startSelect, clearSelection, startMaskDraw } = modeActions;
  const { onWandSeed, addSelectionRing, selectionAction, refineSelection, commitLasso } = useSelectionOps({
    doc,
    busy,
    setBusy,
    commit,
    rasterize,
    exportPart,
    setSelectedId,
    selection,
    setSelection,
    selectTool,
    selectMode,
    selectTargetId,
    setSelectTargetId,
    clearSelection,
    wandTolerance,
    wandContiguous,
    setWandActive,
    maskTarget,
    setMaskTarget,
    setLassoActive,
  });
  useEffect(() => registerDevAction('image.selectionRefine', (arg) => {
    const a = arg as { ring: Point[]; targetId: string };
    setSelectTargetId(a.targetId);
    setSelection(applyRing(null, a.ring, 'new', 0));
    return true;
    // a két setter a useState stabil függvénye (a módállapot-hookból) — egyszer fut, mint eddig
  }), [setSelectTargetId, setSelection]);
  const refineRef = useRef(refineSelection);
  refineRef.current = refineSelection;
  const selectionNowRef = useRef(selection);
  selectionNowRef.current = selection;
  useEffect(() => registerDevAction('image.getSelection', () => selectionNowRef.current), []);
  useEffect(() => registerDevAction('image.selectionRefineRun', () => {
    refineRef.current();
    return true;
  }), []);

  // ✂️🔤 S18: a szöveg-vágás maszkja a szöveg változásakor (gépelés közben késleltetve) újra elkészül
  useEffect(() => {
    if (!doc || !doc.layers.some((l) => l.kind === 'photo' && l.clipTo)) return;
    const timer = setTimeout(() => {
      void ensureTextClipMasks(doc);
    }, 350);
    return () => clearTimeout(timer);
  }, [doc]);

  // 🎯 precíziós mód (kivágás, toll, node, lasszó, pálca, ecset, vonalzó): a felső
  // sáv és a lap-strip elrejtve → a vászon kapja a helyet; a mód-sáv a kilépés (§3.3)
  const precisionMode = isPrecisionMode({ cropRect, penPoints, pathEditId, selectTool, lassoActive, wandActive, brushActive, guidesActive });
  const { onTool, onLayerLongPress, onCanvasSelect, onLayerMenu, applyAssistant } = createToolDispatch({
    t,
    doc,
    selectedId,
    selectedLayer,
    commit,
    setSheet,
    setSelectedId,
    ms,
    precisionMode,
    add,
    fillPlaceholder,
    startSelect,
    startRetouch,
    pathOperation,
    removeBackground,
    exportPart,
    importImageFile,
    importSvg,
    importPsdDoc,
    importPdfDocs,
  });

  // 🧪 füstteszt: egy réteg-művelet indítása (mintha a sávon koppintanák)
  const onToolRef = useRef<(k: ToolKey) => void>(() => {});
  onToolRef.current = onTool;
  useEffect(() => registerDevAction('image.tool', (arg) => {
    onToolRef.current(arg as ToolKey);
    return true;
  }), []);
  // 🧪 füstteszt: réteg kijelölése (a kijelölő keret és a fogói képernyőképhez)
  useEffect(() => registerDevAction('image.selectLayer', (arg) => {
    setSelectedId(typeof arg === 'string' ? arg : null);
    return true;
  }), []);
  // 🧪 füstteszt: kijelölés-művelet a valódi kezelőn át (a szöveg/forma raszterizálásával együtt)
  const selectionActionRef = useRef(selectionAction);
  selectionActionRef.current = selectionAction;
  useEffect(() => registerDevAction('image.selectionAction', (arg) => {
    const a = arg as { action: SelectionAction; ring: Point[]; targetId: string };
    selectionActionRef.current(a.action, applyRing(null, a.ring, 'new', 0), a.targetId);
    return true;
  }), []);

  const pathEdit = createPathEditActions({ doc, commit, pathEditId, pathEditRing, pathEditNode, setPathEditNode });

  const openExportMenu = () => setSheet('export');

  // I42: a videóból nyitott szerkesztő X-e sem hagyhatja a klipet a régi képen
  const exitStudio = () => {
    if (mode === 'scoped' && doc && scopedOpenKey.current !== imageDocContentKey(doc)) {
      void saveScoped();
      return;
    }
    onExit();
  };

  if (!project) {
    return null;
  }

  const sheetDetents = layoutBudget({
    bodyHeight: workH,
    tier: 'sheet',
    detent: sheetDetent,
    hasTimeline: false,
    hasTransport: false,
  }).detents;

  const rail = (
    <ImageStudioToolbar
      onTool={onTool}
      groups={railGroups(workspaceTab)}
      width={workspace.railWidth}
      onCollapse={() => setRailOpen(false)}
    />
  );
  const layerPanel = doc ? (
    <DockedLayerPanel
      doc={doc}
      selectedId={effectiveSelectedId}
      onSelect={setSelectedId}
      mergeLayers={mergeLayers}
      onOrderPreview={setOrderPreview}
      commit={commit}
      onClose={() => setLayersOpen(false)}
    />
  ) : null;

  return (
    <View style={styles.root}>
      {/* 🖨️ a telefonos render rejtett színpada — első gyerek, a stúdió eltakarja */}
      <RenderStage ref={renderStageRef} />
      <NewerSchemaBanner />
      {/* felső sáv */}
      <StudioTopBar
        mode={mode}
        title={title}
        doc={doc}
        workspaceTab={workspaceTab}
        busy={busy}
        hidden={precisionMode}
        onExit={exitStudio}
        onToggleWorkspace={() => setWorkspaceTab((w) => (w === 'design' ? 'image' : 'design'))}
        onHistory={() => setSheet('history')}
        onCanvas={() => setSheet('canvas')}
        onPrimary={mode === 'scoped' ? saveScoped : openExportMenu}
      />

      {/* 🖼️📄 galéria lap-strip (project mód): több kép → diavetítés/lapozható megosztás */}
      {mode === 'project' && pages.length > 0 && !precisionMode ? (
        <PageStrip
          pages={pages}
          activeId={doc?.id}
          activeIdx={activeIdx}
          onSelect={(id) => {
            setActivePageId(id);
            setSelectedId(null);
          }}
          onAdd={addPage}
          onMove={movePage}
          onDuplicate={duplicateActivePage}
          onDelete={deleteActivePage}
        />
      ) : null}

      {/* 📐 munkaterület: vászon + mód-sávok + inline lap — a mért magasság a detentek alapja */}
      <View
        style={[styles.work, styles.workRow]}
        onLayout={(e) => setWorkH(e.nativeEvent.layout.height)}
      >
        {panels.rail && !precisionMode && !railYieldsToPanel ? rail : null}
        <View style={styles.work}>
          <View style={styles.work}>
          {/* vászon */}
          {doc ? (
            <ImageCanvas
              // 🔤 a saját font betöltése után újra (a már kirajzolt szöveg a tartalék-fonttal maradna)
              key={`canvas-${fontsVersion}`}
              doc={orderPreview ? moveLayerTo(doc, orderPreview.id, orderPreview.to) : doc}
              selectedId={effectiveSelectedId}
              onSelect={onCanvasSelect}
              onRequestEdit={(id) => {
                setSelectedId(id);
                setSheet('style');
              }}
              commit={commit}
              canvasRef={canvasRef}
              capturing={capturing}
              cropAspect={cropPreset}
              onLayerLongPress={onLayerLongPress}
              multiIds={multiIds ?? undefined}
              onUndo={() => void (brushActive ? brushRef.current?.undo() : undo())}
              onRedo={() => void (brushActive ? brushRef.current?.redo() : redo())}
              cropRect={cropRect}
              onCropRectChange={setCropRect}
              penPoints={penPoints}
              onPenAddPoint={(p) => setPenPoints((prev) => [...(prev ?? []), p])}
              onPenClose={() => commitPen(true)}
              pathEditId={pathEditId}
              cornerPinId={cornerPinId}
              pathEditRing={pathEditRing}
              selectedNode={pathEditNode}
              onSelectNode={setPathEditNode}
              selection={selection}
              marquee={selectTool === 'rect' || selectTool === 'ellipse' ? selectTool : null}
              onSelectionRing={addSelectionRing}
              lassoActive={lassoActive}
              onLassoComplete={commitLasso}
              onLassoCancel={() => {
                setLassoActive(false);
                setMaskTarget(null);
              }}
              wandActive={wandActive}
              onWandSeed={onWandSeed}
              brushActive={brushActive}
              brushSettings={brush}
              brushLayerId={brushLayerId}
              brushMaskMode={brushMaskMode}
              brushSource={brushSource}
              onBrushNeedSource={setNeedSource}
              onBrushHistory={onBrushHistory}
              brushRef={brushRef}
              guidesActive={guidesActive}
            />
          ) : (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.accent} />
            </View>
          )}
          {/* 👋 S22: üres lapon egy mondatos vezetés (az első réteggel eltűnik) */}
          {doc && docIsEmpty(doc) && !sheet && !brushActive && !lassoActive && !wandActive && !cropRect && !penPoints ? (
            <EmptyCanvasHint onTool={(k) => onTool(k)} />
          ) : null}

          {/* telefonon a rétegpanel a vászon fölé nyílik; az összecsukott oldalt fül hozza vissza */}
          {!precisionMode ? (
            <>
              {workspace.mode === 'overlay' && panels.layers ? (
                <View style={[styles.overlayRight, { width: workspace.panelWidth }, orderPreview ? styles.overlayDragging : null]}>{layerPanel}</View>
              ) : null}
              {!panels.rail && !railYieldsToPanel ? <EdgeTab side="left" icon="construct-outline" label={t('studio.image.toolsShow')} onPress={() => setRailOpen(true)} /> : null}
              {!panels.layers ? <EdgeTab side="right" icon="layers-outline" label={t('studio.image.layersShow')} onPress={() => setLayersOpen(true)} /> : null}
            </>
          ) : null}
          </View>

          {exporting ? <ExportingRow onCancel={() => exportAbort.current?.abort()} /> : null}

          {selection && !selectTool ? (
            /* ✂️ a kijelölés a többi eszköz alatt is él: innen szerkeszthető vagy szüntethető meg */
            <ActiveSelectionRow onEdit={() => startSelect('rect')} onClear={clearSelection} />
          ) : null}

          {/* kijelölés-jelző */}
          <StatusHintRow
            selectedLayer={selectedLayer}
            guidesActive={guidesActive}
            brushActive={brushActive}
            retouch={!!brush.tool}
            needSource={needSource}
            selectTool={selectTool}
            wandActive={wandActive}
            lassoActive={lassoActive}
            pathEditing={!!pathEditId}
            penDrawing={!!penPoints}
            cropping={!!cropRect}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
          />

          <ActiveModeBar
            doc={doc}
            sheet={sheet}
            selectedId={selectedId}
            selectedLayer={selectedLayer}
            effectiveSelectedId={effectiveSelectedId}
            commit={commit}
            setSheet={setSheet}
            onTool={onTool}
            brushRef={brushRef}
            ms={ms}
            pathEdit={pathEdit}
            modeActions={modeActions}
            refineSelection={refineSelection}
            selectionAction={selectionAction}
            onMultiAction={onMultiAction}
            applyAssistant={applyAssistant}
          />
          <ImageStudioSheets
            sheet={sheet}
            doc={doc}
            selectedLayer={selectedLayer}
            effectiveSelectedId={effectiveSelectedId}
            mode={mode}
            pageCount={pages.length}
            busy={busy}
            commit={commit}
            setSheet={setSheet}
            setSelectedId={setSelectedId}
            onAddShapeType={addShapeType}
            onImport={onTool}
            onInsertSource={insertSource}
            onDrawMask={startMaskDraw}
            onRaster={(o) => void exportImage(o)}
            onPack={(o) => void exportPack(o)}
            onTemplate={addTemplatePage}
            onBrandLogo={insertBrandLogo}
            onVariant={addVariantPage}
            onLayerMenu={onLayerMenu}
            onSvg={() => void exportSvg()}
            onPdf={() => void exportPdf()}
            onVectorPdf={() => void exportVectorPdf()}
            onPsd={() => void exportPsdFile()}
            canPsd={isPro}
            onVideo={() => void insertIntoVideo()}
            onShareSlideshow={mode === 'project' ? () => confirmShare('slideshow') : undefined}
            onShareCarousel={mode === 'project' ? () => confirmShare('carousel') : undefined}
            detents={workH > 0 ? sheetDetents : undefined}
            detent={sheetDetent}
            onDetentChange={onSheetDetent}
          />
        </View>
        {workspace.mode === 'inline' && panels.layers && !precisionMode ? (
          <View style={[styles.inlineRight, { width: workspace.panelWidth }]}>{layerPanel}</View>
        ) : null}
      </View>
      {pixelOpen ? (
        <Suspense fallback={null}>
          <PixelStudio
            initial={(doc?.layers.find((l) => l.id === pixelLayerId) as PhotoLayer | undefined)?.pixelArt ?? null}
            onDone={onPixelDone}
            onClose={() => setPixelOpen(false)}
          />
        </Suspense>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
  work: { flex: 1 },
  workRow: { flexDirection: 'row' },
  overlayRight: { position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 6, backgroundColor: palette.surface },
  overlayDragging: { opacity: 0.55 },
  inlineRight: { alignSelf: 'stretch', backgroundColor: palette.surface, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.border },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
