import type { TFunction } from 'i18next';
import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';

import type { BrushHandle } from '@/components/studio/image/BrushOverlay';
import type { SheetKind } from '@/components/studio/image/body/ImageStudioSheets';
import type { SelectTool } from '@/components/studio/image/body/SelectionBar';
import type { useImageExport } from '@/components/studio/image/body/useImageExport';
import type { StudioModeState } from '@/components/studio/image/body/useStudioModeState';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { makeId } from '@/lib/id';
import { cropImageDoc } from '@/lib/imageCrop';
import { addLayer, updateLayer } from '@/lib/imageDoc';
import { DEFAULT_GRID } from '@/lib/imageGrid';
import { fullCanvasImageMask, paintedPhotoLayer } from '@/lib/imageLayerDefaults';
import { selectionTarget } from '@/lib/imageSelectionOps';
import { logCaught } from '@/lib/logCaught';
import { pathShapeFromCanvasPoints } from '@/lib/penPath';
import type { ClipMask, ImageDoc, ImageGrid, PhotoLayer } from '@/types/project';

export interface ModeActionDeps {
  t: TFunction;
  doc: ImageDoc | null;
  commit: (next: ImageDoc, label?: string) => void;
  captureCanvas: ReturnType<typeof useImageExport>['captureCanvas'];
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSheet: (next: SheetKind) => void;
  brushRef: RefObject<BrushHandle | null>;
  ms: StudioModeState;
}

/**
 * 🎯 A precíziós módok be- és kilépése és lezárása: kivágás, toll, ecset (+ festett maszk, retus),
 * rács, lasszó, kijelölő-eszközök, maszk-rajz. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból,
 * hook nélküli gyárként — minden dokumentum-írás a body `commit`-ján (command-bus) át. `.tsx`: a
 * fordítás-paritás őr innen is gyűjti a `t()`-kulcsokat.
 */
export function createModeActions({ t, doc, commit, captureCanvas, selectedId, setSelectedId, setSheet, brushRef, ms }: ModeActionDeps) {
  const {
    busy,
    setBusy,
    cropRect,
    setCropRect,
    penPoints,
    setPenPoints,
    setPathEditId,
    setLassoActive,
    setSelection,
    setSelectTool,
    setSelectTargetId,
    setMaskTarget,
    setWandActive,
    setBrushActive,
    setBrush,
    brushLayerId,
    setBrushLayerId,
    brushMaskMode,
    setBrushMaskMode,
    setBrushSource,
  } = ms;

  // ✂️ a kivágás alkalmazása (egy undo-lépés) / elvetése
  const applyCrop = () => {
    if (doc && cropRect) {
      commit(cropImageDoc(doc, cropRect), t('studio.image.undoCrop'));
    }
    setCropRect(null);
  };

  // ✏️ a toll-path lezárása FORMA-réteggé (zárt = kitöltött, nyitott = vonal) / elvetése
  const commitPen = (closed: boolean) => {
    if (doc && penPoints && penPoints.length >= 2) {
      const shape = pathShapeFromCanvasPoints(penPoints, closed, makeId('lyr'));
      if (shape) {
        commit(addLayer(doc, shape), t('studio.image.undoPen'));
        setSelectedId(shape.id);
      }
    }
    setPenPoints(null);
  };

  // 🖌️ ecset: a Skia-festés pillanatképe PNG-fájlként → FOTÓ-réteg a vásznon
  const commitBrush = () => {
    if (doc && brushRef.current?.hasStrokes()) {
      const canvas = effectiveCanvas(doc);
      const uri = brushRef.current.exportPng(canvas.width, canvas.height);
      if (brushMaskMode && brushLayerId) {
        if (uri) {
          const mask: ClipMask = fullCanvasImageMask(uri);
          commit(updateLayer<PhotoLayer>(doc, brushLayerId, { mask }), t('studio.image.undoMaskPaint'));
        } else {
          Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.maskPaintFail'));
        }
        setSelectedId(brushLayerId);
      } else if (uri && brushLayerId) {
        commit({ ...doc, layers: doc.layers.map((l) => (l.id === brushLayerId ? { ...l, uri, paint: true } : l)) } as ImageDoc, t('studio.image.undoBrush'));
        setSelectedId(brushLayerId);
      } else if (uri) {
        const l: PhotoLayer = paintedPhotoLayer(makeId('lyr'), uri);
        commit(addLayer(doc, l), t('studio.image.undoBrush'));
        setSelectedId(l.id);
      }
    }
    setBrushActive(false);
  };

  const updateGrid = (patch: Partial<ImageGrid>) => {
    if (doc) {
      commit({ ...doc, grid: { ...DEFAULT_GRID, show: false, snap: false, ...doc.grid, ...patch } }, t('studio.image.guides.grid'));
    }
  };

  // 🩹 retus: előbb a vászon képe, utána indul a munkamenet (a pillanatkép az overlay-t levenné)
  const startRetouch = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const { Skia } = await import('@shopify/react-native-skia');
      const uri = await captureCanvas(doc, effectiveCanvas(doc).height);
      const image = uri ? Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri)) : null;
      if (!image) {
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.retouch.failBody'));
        return;
      }
      setBrushSource(image);
      setBrush((b) => ({ ...b, tool: 'clone', opacity: 1 }));
      setBrushLayerId(null);
      setBrushMaskMode(false);
      setSheet(null);
      setSelectedId(null);
      setCropRect(null);
      setPenPoints(null);
      setPathEditId(null);
      setSelectTool(null);
      setLassoActive(false);
      setMaskTarget(null);
      setWandActive(false);
      setBrushActive(true);
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:startRetouch', caught);
      Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.retouch.failBody'));
    } finally {
      setBusy(false);
    }
  };

  // I34: a mégse a maszk-célt is törli, különben a következő sima lasszó a régi rétegre írna
  const cancelLasso = () => {
    setLassoActive(false);
    setMaskTarget(null);
  };

  // 🚪 I8: a kész vonások nem vesznek el kérdés nélkül a ✕-re
  const cancelBrush = () => {
    if (!brushRef.current?.hasStrokes()) {
      setBrushActive(false);
      return;
    }
    Alert.alert(t('studio.image.brushDiscard.title'), t('studio.image.brushDiscard.message'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.image.brushDiscard.confirm'), style: 'destructive', onPress: () => setBrushActive(false) },
    ]);
  };

  // ✂️ kijelölés: eszköz választása; a többi mód bezárul, a meglévő kijelölés megmarad
  const openSelectTool = (tool: SelectTool) => {
    setSelectTool(tool);
    setLassoActive(tool === 'lasso');
    setWandActive(tool === 'wand');
  };
  const startSelect = (tool: SelectTool) => {
    if (!doc) {
      return;
    }
    setSelectTargetId(selectionTarget(doc, selectedId));
    setSheet(null);
    setSelectedId(null);
    setCropRect(null);
    setPenPoints(null);
    setPathEditId(null);
    setMaskTarget(null);
    setBrushActive(false);
    openSelectTool(tool);
  };
  const closeSelectTool = () => {
    setSelectTool(null);
    setLassoActive(false);
    setWandActive(false);
  };
  const clearSelection = () => {
    setSelection(null);
    closeSelectTool();
  };

  // 🎭 lasszó-maszk indítása a kijelölt rétegre: a következő lasszó-rajz maszkot készít
  // (target: 'clip' = vágó-maszk, 'local' = kijelölés-alapú korrekció maszkja)
  const startMaskDraw = (layerId: string, target: 'clip' | 'local' | 'heal' | 'paint' = 'clip') => {
    if (target === 'paint') {
      // 🖌️ festett maszk: az ecset-motor a réteg maszkján dolgozik
      setSheet(null);
      setSelectedId(null);
      setSelectTool(null);
      setLassoActive(false);
      setWandActive(false);
      setBrushLayerId(layerId);
      setBrushMaskMode(true);
      setBrushActive(true);
      return;
    }
    setSelectedId(layerId);
    setMaskTarget({ id: layerId, target });
    setLassoActive(true);
    setSheet(null); // a panel bezárul, hogy a vászon látsszon a rajzoláshoz
  };

  return {
    applyCrop,
    commitPen,
    commitBrush,
    updateGrid,
    startRetouch,
    cancelLasso,
    cancelBrush,
    openSelectTool,
    startSelect,
    closeSelectTool,
    clearSelection,
    startMaskDraw,
  };
}
