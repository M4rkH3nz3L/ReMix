import { type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { BrushHandle } from '@/components/studio/image/BrushOverlay';
import { ImageAdjustStrip } from '@/components/studio/image/ImageAdjustStrip';
import { AssistantBar } from '@/components/studio/image/body/AssistantBar';
import { BrushBar } from '@/components/studio/image/body/BrushBar';
import { isInlineSheet, type SheetKind } from '@/components/studio/image/body/ImageStudioSheets';
import { CornerPinBar, CropBar, GuidesBar, LassoBar, PathEditBar, PenBar, WandBar } from '@/components/studio/image/body/ModeBars';
import { MultiSelectBar, type MultiAction } from '@/components/studio/image/body/MultiSelectBar';
import { SelectionActionBar } from '@/components/studio/image/body/SelectionActionBar';
import { SelectionBar } from '@/components/studio/image/body/SelectionBar';
import type { createModeActions } from '@/components/studio/image/body/modeActions';
import type { createPathEditActions } from '@/components/studio/image/body/pathEditActions';
import type { useSelectionOps } from '@/components/studio/image/body/useSelectionOps';
import type { StudioModeState } from '@/components/studio/image/body/useStudioModeState';
import { canBoolean } from '@/lib/imageBoolean';
import { aspectCropRect } from '@/lib/imageCrop';
import { updateLayer } from '@/lib/imageDoc';
import type { ImageCommand } from '@/lib/imageIntent';
import { canAlignLayer } from '@/lib/imageLayerLayout';
import { selectionMenu, type ToolKey } from '@/lib/imageMenu';
import { compositionGuides, mergeGuides } from '@/lib/rulers';
import { invertSelection } from '@/lib/selection';
import type { ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

type SelectionOps = ReturnType<typeof useSelectionOps>;

/**
 * 🎛️ Az alsó sáv: EGYETLEN aktív mód-sáv, prioritás szerint — kivágás › toll › node › asszisztens ›
 * kijelölés › lasszó › pálca › ecset › sarokpontok › vonalzó › (inline lap: semmi) › gyors korrekció ›
 * többes kijelölés › a kijelölt réteg művelet-sávja. VISELKEDÉS-MEGŐRZŐ kiemelés az
 * `ImageStudioBody`-ból — minden írás a body `commit`-ján (command-bus) át.
 */
export function ActiveModeBar({
  doc,
  sheet,
  selectedId,
  selectedLayer,
  effectiveSelectedId,
  commit,
  setSheet,
  onTool,
  brushRef,
  ms,
  pathEdit,
  modeActions,
  refineSelection,
  selectionAction,
  onMultiAction,
  applyAssistant,
}: {
  doc: ImageDoc | null;
  sheet: SheetKind;
  selectedId: string | null;
  selectedLayer: ImageLayer | null;
  effectiveSelectedId: string | null;
  commit: (next: ImageDoc, label?: string) => void;
  setSheet: (next: SheetKind) => void;
  onTool: (key: ToolKey) => void;
  brushRef: RefObject<BrushHandle | null>;
  ms: StudioModeState;
  pathEdit: ReturnType<typeof createPathEditActions>;
  modeActions: ReturnType<typeof createModeActions>;
  refineSelection: SelectionOps['refineSelection'];
  selectionAction: SelectionOps['selectionAction'];
  onMultiAction: (action: MultiAction) => void;
  applyAssistant: (commands: ImageCommand[]) => void;
}) {
  const { t } = useTranslation();
  const {
    busy,
    cropRect,
    setCropRect,
    cropPreset,
    setCropPreset,
    penPoints,
    setPenPoints,
    pathEditId,
    setPathEditId,
    pathEditRing,
    setPathEditRing,
    assistantOpen,
    setAssistantOpen,
    pathEditNode,
    setPathEditNode,
    lassoActive,
    selection,
    setSelection,
    selectTool,
    selectMode,
    setSelectMode,
    selectTargetId,
    wandActive,
    setWandActive,
    wandTolerance,
    setWandTolerance,
    cornerPinId,
    setCornerPinId,
    wandContiguous,
    setWandContiguous,
    multiIds,
    setMultiIds,
    brush,
    setBrush,
    brushActive,
    brushMaskMode,
    brushHistory,
    guidesActive,
    setGuidesActive,
    quickAdjust,
    setQuickAdjust,
  } = ms;
  const { pathEditShape, ringCount, togglePathClosed, reverseEditedPath, setNodeKind, deleteNode } = pathEdit;
  const { applyCrop, commitPen, cancelLasso, cancelBrush, commitBrush, updateGrid, openSelectTool, clearSelection, closeSelectTool } = modeActions;
  // ✂️ kivágás-sáv (crop-módban a toolbar HELYETT)
  return cropRect ? (
    <CropBar
      cropPreset={cropPreset}
      onPreset={(ratio) => {
        setCropPreset(ratio);
        if (doc) {
          setCropRect(aspectCropRect(doc, ratio));
        }
      }}
      onCancel={() => setCropRect(null)}
      onApply={applyCrop}
    />
  ) : penPoints ? (
    <PenBar
      pointCount={penPoints.length}
      onCancel={() => setPenPoints(null)}
      onUndoPoint={() => setPenPoints((prev) => (prev && prev.length ? prev.slice(0, -1) : prev))}
      onClosePath={() => commitPen(true)}
      onDone={() => commitPen(false)}
    />
  ) : pathEditId ? (
    <PathEditBar
      nodeSelected={pathEditNode != null}
      ringCount={ringCount}
      ring={pathEditRing}
      closed={!!pathEditShape?.closed}
      onClose={() => setPathEditId(null)}
      onDeleteNode={deleteNode}
      onNodeKind={setNodeKind}
      onNextRing={() => {
        setPathEditRing((r) => (r + 1) % ringCount);
        setPathEditNode(null);
      }}
      onToggleClosed={togglePathClosed}
      onReverse={reverseEditedPath}
    />
  ) : assistantOpen && doc ? (
    <AssistantBar doc={doc} selectedId={selectedId} onApply={applyAssistant} onClose={() => setAssistantOpen(false)} />
  ) : selectTool ? (
    <SelectionBar
      tool={selectTool}
      mode={selectMode}
      selection={selection}
      canUseLayer={!!selectTargetId}
      canShape={!!selection && selection.ops.length === 1 && !selection.invert}
      onTool={openSelectTool}
      onMode={setSelectMode}
      onInvert={() => setSelection((sel) => (sel ? invertSelection(sel) : sel))}
      onRefine={refineSelection}
      onFeather={(feather) => setSelection((sel) => (sel ? { ...sel, feather } : sel))}
      onAction={selectionAction}
      onClear={clearSelection}
      onDone={closeSelectTool}
    />
  ) : lassoActive ? (
    <LassoBar onCancel={cancelLasso} />
  ) : wandActive ? (
    <WandBar
      busy={busy}
      tolerance={wandTolerance}
      onTolerance={setWandTolerance}
      showContiguous={selectTool === 'wand'}
      contiguous={wandContiguous}
      onToggleContiguous={() => setWandContiguous((c) => !c)}
      onClose={() => setWandActive(false)}
    />
  ) : brushActive ? (
    <BrushBar
      brush={brush}
      onChange={(patch) => setBrush((b) => ({ ...b, ...patch }))}
      canUndo={brushHistory.canUndo}
      canRedo={brushHistory.canRedo}
      onUndo={() => brushRef.current?.undo()}
      onRedo={() => brushRef.current?.redo()}
      onCancel={cancelBrush}
      onDone={commitBrush}
      maskMode={brushMaskMode}
      retouch={!!brush.tool}
      onPickSource={() => brushRef.current?.pickSource()}
    />
  ) : cornerPinId && doc ? (
    <CornerPinBar
      onReset={() => commit(updateLayer<PhotoLayer>(doc, cornerPinId, { corners: undefined }), t('studio.image.cornerPin.reset'))}
      onDone={() => setCornerPinId(null)}
    />
  ) : guidesActive ? (
    <GuidesBar
      grid={doc?.grid}
      onClose={() => setGuidesActive(false)}
      onThirds={() => doc && commit({ ...doc, guides: mergeGuides(doc.guides, compositionGuides()) }, t('studio.image.undoGuides'))}
      onClearGuides={() => doc && commit({ ...doc, guides: [] }, t('studio.image.undoGuides'))}
      onGrid={updateGrid}
    />
  ) : isInlineSheet(sheet) ? null : quickAdjust && doc && selectedLayer?.kind === 'photo' ? (
    <ImageAdjustStrip
      doc={doc}
      layer={selectedLayer}
      commit={commit}
      onDetails={() => {
        setQuickAdjust(false);
        setSheet('adjust');
      }}
      onHsl={() => {
        setQuickAdjust(false);
        setSheet('hsl');
      }}
      onClose={() => setQuickAdjust(false)}
    />
  ) : multiIds && doc ? (
    <MultiSelectBar count={multiIds.length} onAction={onMultiAction} onClose={() => setMultiIds(null)} />
  ) : selectedLayer && doc ? (
    <SelectionActionBar
      menu={selectionMenu(selectedLayer, { canAlign: canAlignLayer(selectedLayer), canBoolean: canBoolean(doc, effectiveSelectedId) })}
      onAction={onTool}
      onDelete={() => onTool('delete')}
    />
  ) : null;
}
