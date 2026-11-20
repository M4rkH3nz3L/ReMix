import type { TFunction } from 'i18next';
import { type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';

import type { SheetKind } from '@/components/studio/image/body/ImageStudioSheets';
import type { SelectTool } from '@/components/studio/image/body/SelectionBar';
import type { useImageExport } from '@/components/studio/image/body/useImageExport';
import type { useImageImports } from '@/components/studio/image/body/useImageImports';
import type { useLayerRasterOps } from '@/components/studio/image/body/useLayerRasterOps';
import type { StudioModeState } from '@/components/studio/image/body/useStudioModeState';
import type { LayerMenuAction } from '@/components/studio/image/LayerMenuSheet';
import { haptics } from '@/design';
import { isPaintLayer } from '@/lib/brushEngine';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { makeId } from '@/lib/id';
import { duplicateLayer, removeLayer, reorderLayer, toggleLayerLocked, updateLayer } from '@/lib/imageDoc';
import { layerOnlyDoc } from '@/lib/imageExportCheck';
import { type CropRect } from '@/lib/imageCrop';
import { applyImageCommands, type ImageCommand } from '@/lib/imageIntent';
import type { ToolKey } from '@/lib/imageMenu';
import { toggleId } from '@/lib/imageMulti';
import { logCaught } from '@/lib/logCaught';
import { shapeToPathPoints } from '@/lib/shapeGeometry';
import type { ImageDoc, ImageLayer, ShapeLayer } from '@/types/project';

/** ✂️ induló kivágás-téglalap: enyhén behúzva, hogy a sarok-fogók látszódjanak */
const START_CROP: CropRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

type RasterOps = ReturnType<typeof useLayerRasterOps>;
type Imports = ReturnType<typeof useImageImports>;

export interface ToolDispatchDeps {
  t: TFunction;
  doc: ImageDoc | null;
  selectedId: string | null;
  selectedLayer: ImageLayer | null;
  commit: (next: ImageDoc, label?: string) => void;
  setSheet: (next: SheetKind) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  ms: StudioModeState;
  /** a precíziós módban a hosszú nyomás nem nyit menüt */
  precisionMode: boolean;
  add: (kind: ImageLayer['kind']) => void;
  fillPlaceholder: (layerId: string) => void;
  startSelect: (tool: SelectTool) => void;
  startRetouch: () => Promise<void>;
  pathOperation: RasterOps['pathOperation'];
  removeBackground: RasterOps['removeBackground'];
  exportPart: ReturnType<typeof useImageExport>['exportPart'];
  importImageFile: Imports['importImageFile'];
  importSvg: Imports['importSvg'];
  importPsdDoc: Imports['importPsdDoc'];
  importPdfDocs: Imports['importPdfDocs'];
}

/**
 * 🧰 A felhasználói szándékok útválasztása: a szerszám-gombok (`onTool` — sín, kijelölés-sáv, réteg-
 * menü, üres-vászon tipp), a vászon-koppintás / hosszú nyomás, a réteg-menü és az asszisztens lépései.
 * VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból, hook nélküli gyárként — minden írás a body
 * `commit`-ján (command-bus) át. `.tsx`: a fordítás-paritás őr innen is gyűjti a `t()`-kulcsokat.
 */
export function createToolDispatch(deps: ToolDispatchDeps) {
  const { t, doc, selectedId, selectedLayer, commit, setSheet, setSelectedId, ms, precisionMode } = deps;
  const { add, fillPlaceholder, startSelect, startRetouch, pathOperation, removeBackground, exportPart } = deps;
  const { importImageFile, importSvg, importPsdDoc, importPdfDocs } = deps;
  const {
    setCropRect,
    setPenPoints,
    setPathEditId,
    setPathEditRing,
    setAssistantOpen,
    setPathEditNode,
    setLassoActive,
    setSelectTool,
    setMaskTarget,
    setWandActive,
    setCornerPinId,
    setPixelOpen,
    multiIds,
    setMultiIds,
    setPixelLayerId,
    setBrush,
    setBrushLayerId,
    setBrushMaskMode,
    setBrushSource,
    setBrushActive,
    setGuidesActive,
    setQuickAdjust,
  } = ms;

  const onTool = (key: ToolKey) => {
    if (!doc) {
      return;
    }
    switch (key) {
      case 'templates':
        setSheet('templates');
        break;
      case 'size':
        setSheet('canvas');
        break;
      case 'import':
        setSheet('import');
        break;
      case 'source':
        setSheet('source');
        break;
      case 'addFill':
        add('fill');
        break;
      case 'addAdjust':
        add('adjust');
        break;
      case 'unlock':
        if (selectedLayer) {
          commit(toggleLayerLocked(doc, selectedLayer.id), t('studio.image.undoLock'));
        }
        break;
      case 'outlineStroke':
      case 'offsetOut':
      case 'offsetIn':
        if (selectedLayer?.kind === 'shape') {
          void pathOperation(selectedLayer, key);
        }
        break;
      case 'cornerPin':
        // 🔲 S18: 4-sarkos perspektíva — a sarokfogók a vásznon
        if (selectedLayer?.kind === 'photo') {
          setSheet(null);
          setCornerPinId(selectedLayer.id);
        }
        break;
      case 'toPath':
        // 🔷 forma → szerkeszthető pontok (a kinézet nem változik)
        if (selectedLayer?.kind === 'shape') {
          const cv = effectiveCanvas(doc);
          // S18: a lekerekített sarok is görbe lesz (a sugárhoz a doboz képpont-aránya kell)
          const points = shapeToPathPoints(selectedLayer, (selectedLayer.w * cv.width) / Math.max(1e-6, selectedLayer.h * cv.height));
          if (points) {
            commit(updateLayer<ShapeLayer>(doc, selectedLayer.id, { shape: 'path', points, closed: true, cornerRadius: undefined }), t('studio.imageTools.toPath'));
          }
        }
        break;
      case 'editPath':
        // ✏️ a kijelölt path pontjainak szerkesztése
        setSheet(null);
        setCropRect(null);
        setPenPoints(null);
        setPathEditNode(null);
        setPathEditRing(0);
        setPathEditId(selectedLayer?.id ?? null);
        break;
      case 'photo':
        add('photo');
        break;
      case 'text':
        add('text');
        break;
      case 'shape':
        setSheet('shapePicker'); // 🔷 forma-TÍPUS választó (nem csak téglalap)
        break;
      case 'marquee':
        startSelect('rect');
        break;
      case 'lasso':
        startSelect('lasso');
        break;
      case 'wand':
        startSelect('wand');
        break;
      case 'retouch':
        void startRetouch();
        break;
      case 'assistant':
        setSheet(null);
        setAssistantOpen(true);
        break;
      case 'pixel': {
        const target = doc.layers.find((l) => l.id === selectedId);
        setPixelLayerId(target?.kind === 'photo' && target.pixelArt ? target.id : null);
        setPixelOpen(true);
        break;
      }
      case 'brush':
        // 🖌️ ecset-mód: Skia raszter-festés → snapshot fotó-rétegként. A Skia-függő
        // overlay-t előbb LEPROBÁLJUK betölteni; ha a natív modul hiányzik (régi
        // dev-kliens), barátságos üzenet jön a lazy-reject crash HELYETT.
        void (async () => {
          try {
            await import('@/components/studio/image/BrushOverlay');
          } catch (caught) {
            logCaught('components/studio/image/ImageStudioBody.tsx:onTool', caught);
            Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.skiaMissing'));
            return;
          }
          // a kijelölt festett réteget folytatjuk (a radír is azon dolgozik), különben új réteg lesz
          const target = doc?.layers.find((l) => l.id === selectedId);
          setBrushLayerId(target && isPaintLayer(target) ? target.id : null);
          setBrushMaskMode(false);
          setBrushSource(null);
          setBrush((b) => ({ ...b, tool: undefined }));
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
        })();
        break;
      case 'pen':
        // ✏️ új toll-rajz (a meglévő path pontjait az alsó sáv „Pontok" gombja nyitja)
        setSheet(null);
        setSelectedId(null);
        setCropRect(null);
        setPathEditId(null);
        setPenPoints([]);
        break;
      case 'file':
        void importImageFile();
        break;
      case 'svg':
        void importSvg();
        break;
      case 'psd':
        // 🖼️ PSD-import (Pro). Free usernél a gomb letiltva (toolDisabled) + ha
        // mégis ide jut, a guardPro a paywallt hozza fel.
        void importPsdDoc();
        break;
      case 'pdf':
        // 📄 PDF-import (Pro). Free usernél a gomb letiltva (toolDisabled) + ha
        // mégis ide jut, a guardPro a paywallt hozza fel.
        void importPdfDocs();
        break;
      case 'style':
        // 🎛️ a kijelölt réteg gazdag tulajdonság-lapja KÖZVETLENÜL (felfedezhetőség)
        setSheet('style');
        break;
      case 'adjust':
        // ⚡ előbb a gyors sáv (a kép teljes méretben látszik); a teljes verem a „Részletek"-ből
        setSheet(null);
        setQuickAdjust(true);
        break;
      case 'exportLayer':
        if (selectedLayer) {
          void exportPart(layerOnlyDoc(doc, selectedLayer.id));
        }
        break;
      case 'bgRemove':
        if (selectedLayer?.kind === 'photo') {
          void removeBackground(selectedLayer);
        }
        break;
      case 'develop':
        // 📸 RAW-develop (non-destruktív előhívás) — csak fotó-rétegre
        setSheet('develop');
        break;
      case 'fx':
        // ✨ réteg-effektek (ragyogás/árnyék/körvonal) — csak forma-rétegre
        setSheet('fx');
        break;
      case 'pattern':
        // 🧩 geometrikus csempe-minta — csak forma-rétegre
        setSheet('pattern');
        break;
      case 'crop':
        // ✂️ kivágás-mód indítása (a kijelölés + lapok bezárva)
        setSheet(null);
        setSelectedId(null);
        setGuidesActive(false);
        setCropRect(START_CROP);
        break;
      case 'guides':
        // 📐 vonalzók + segédvonalak mód be/ki (a modal módok bezárva)
        setSheet(null);
        setCropRect(null);
        setPenPoints(null);
        setPathEditId(null);
        setLassoActive(false);
        setWandActive(false);
        setBrushActive(false);
        setGuidesActive((v) => !v);
        break;
      case 'align':
        setSheet('align');
        break;
      case 'boolean':
        setSheet('boolean');
        break;
      case 'duplicate':
        if (selectedLayer) {
          commit(duplicateLayer(doc, selectedLayer.id, () => makeId('lyr')), t('studio.image.undoDuplicate'));
        }
        break;
      case 'forward':
        if (selectedLayer) {
          commit(reorderLayer(doc, selectedLayer.id, 1), t('studio.image.undoOrder'));
        }
        break;
      case 'back':
        if (selectedLayer) {
          commit(reorderLayer(doc, selectedLayer.id, -1), t('studio.image.undoOrder'));
        }
        break;
      case 'rotate':
        if (selectedLayer && selectedLayer.kind !== 'fill') {
          const rot = (((selectedLayer as { rotation?: number }).rotation ?? 0) + 90) % 360;
          commit(updateLayer(doc, selectedLayer.id, { rotation: rot } as Partial<ImageLayer>), t('studio.image.undoRotate'));
        }
        break;
      case 'flipH':
        if (selectedLayer && selectedLayer.kind !== 'fill') {
          const flipH = !(selectedLayer as { flipH?: boolean }).flipH;
          commit(updateLayer(doc, selectedLayer.id, { flipH } as Partial<ImageLayer>), t('studio.image.undoFlip'));
        }
        break;
      case 'flipV':
        if (selectedLayer && selectedLayer.kind !== 'fill') {
          const flipV = !(selectedLayer as { flipV?: boolean }).flipV;
          commit(updateLayer(doc, selectedLayer.id, { flipV } as Partial<ImageLayer>), t('studio.image.undoFlip'));
        }
        break;
      case 'delete':
        if (selectedLayer) {
          commit(removeLayer(doc, selectedLayer.id), t('studio.image.undoDelete'));
          setSelectedId(null);
        }
        break;
    }
  };

  // 🖐️ hosszú nyomás: a réteg kijelölve, a menüje nyitva; a „Több” után a koppintás gyűjt
  const onLayerLongPress = (id: string) => {
    if (multiIds || precisionMode) {
      return;
    }
    haptics.impact();
    setSelectedId(id);
    setSheet('layerMenu');
  };
  const onCanvasSelect = (id: string | null) => {
    if (!multiIds) {
      setSelectedId(id);
      const hit = id ? doc?.layers.find((l) => l.id === id) : undefined;
      if (hit?.kind === 'photo' && hit.placeholder && !hit.locked) {
        fillPlaceholder(hit.id);
      }
    } else if (id) {
      setMultiIds(toggleId(multiIds, id));
    }
  };
  const onLayerMenu = (action: LayerMenuAction) => {
    setSheet(null);
    if (action === 'multi') {
      setMultiIds(selectedId ? [selectedId] : []);
      setSelectedId(null);
    } else {
      onTool(action);
    }
  };

  // 🤖 asszisztens: egy visszavonható lépés; a natív és a lapot nyitó lépések utána futnak
  const applyAssistant = (commands: ImageCommand[]) => {
    if (!doc) {
      return;
    }
    const { doc: next, followUps } = applyImageCommands(doc, commands, () => makeId('lyr'));
    if (next !== doc) {
      commit(next, t('studio.image.assistant.undo'));
    }
    for (const step of followUps) {
      const layer = step.type === 'REMOVE_BG' ? next.layers.find((l) => l.id === step.layerId) : null;
      if (layer?.kind === 'photo') {
        void removeBackground(layer);
      } else if (step.type === 'EXPORT') {
        setSheet('export');
      }
    }
    setAssistantOpen(false);
  };

  return { onTool, onLayerLongPress, onCanvasSelect, onLayerMenu, applyAssistant };
}
