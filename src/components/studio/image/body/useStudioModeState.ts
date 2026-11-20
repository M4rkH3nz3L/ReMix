import type { SkImage } from '@shopify/react-native-skia';
import { useCallback, useState } from 'react';

import type { SelectTool } from '@/components/studio/image/body/SelectionBar';
import { useBackLayer } from '@/hooks/useBackLayer';
import { DEFAULT_BRUSH } from '@/lib/brushEngine';
import type { CropRect } from '@/lib/imageCrop';
import type { CanvasPoint } from '@/lib/penPath';
import type { Selection, SelectionMode } from '@/lib/selection';

/**
 * 🎯 A szerkesztés átmeneti állapota: foglaltság, a precíziós módok (kivágás, toll, node, kijelölés,
 * lasszó, pálca, ecset, vonalzó), a többes kijelölés és a pixel-stúdió — plusz a vissza-gomb, ami a
 * MÓDBÓL lép ki. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból — a hookok sorrendje azonos.
 */
export function useStudioModeState() {
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropPreset, setCropPreset] = useState<number | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[] | null>(null);
  const [pathEditId, setPathEditId] = useState<string | null>(null);
  const [pathEditRing, setPathEditRing] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [pathEditNode, setPathEditNode] = useState<number | null>(null);
  const [lassoActive, setLassoActive] = useState(false);
  // ✂️ a kijelölés a szerkesztés állapota, nem a dokumentumé: nem kerül az undo-ba és a mentésbe
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectTool, setSelectTool] = useState<SelectTool | null>(null);
  const [selectMode, setSelectMode] = useState<SelectionMode>('new');
  const [selectTargetId, setSelectTargetId] = useState<string | null>(null);
  // 🎭 ha be van állítva, a következő lasszó-rajz: vágó-maszk ('clip'), lokális korrekció-maszk
  // ('local'), vagy 🩹 folt-javítás régió ('heal' — a bbox-ot delogo-zza a render)
  const [maskTarget, setMaskTarget] = useState<{ id: string; target: 'clip' | 'local' | 'heal' | 'paint' } | null>(null);
  const [wandActive, setWandActive] = useState(false);
  const [wandTolerance, setWandTolerance] = useState(32);
  const [cornerPinId, setCornerPinId] = useState<string | null>(null);
  // S17: ki = színtartomány (a kép minden hasonló színű képpontja, nem csak az összefüggő régió)
  const [wandContiguous, setWandContiguous] = useState(true);
  const [brushActive, setBrushActive] = useState(false);
  const [pixelOpen, setPixelOpen] = useState(false);
  const [multiIds, setMultiIds] = useState<string[] | null>(null);
  const [pixelLayerId, setPixelLayerId] = useState<string | null>(null);
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  const [brushLayerId, setBrushLayerId] = useState<string | null>(null);
  const [brushMaskMode, setBrushMaskMode] = useState(false);
  // 🩹 retus: a vászon pillanatképe a forrás; az eredmény új festett rétegbe kerül
  const [brushSource, setBrushSource] = useState<SkImage | null>(null);
  const [needSource, setNeedSource] = useState(false);
  const [brushHistory, setBrushHistory] = useState({ canUndo: false, canRedo: false });
  const onBrushHistory = useCallback((canUndo: boolean, canRedo: boolean) => setBrushHistory({ canUndo, canRedo }), []);
  const [guidesActive, setGuidesActive] = useState(false);
  // ⚡ gyors korrekció-sáv (az eszköztár helyén) — a „Részletek" a teljes verem-lapot nyitja
  const [quickAdjust, setQuickAdjust] = useState(false);
  // ↩️ precíziós módban a vissza a MÓDBÓL lép ki (nem a stúdióból) — mint a sáv ✕-e
  useBackLayer(
    cropRect || penPoints || pathEditId || !!selectTool || lassoActive || wandActive || brushActive || guidesActive
      ? () => {
          setCropRect(null);
          setPenPoints(null);
          setPathEditId(null);
          setSelectTool(null);
          setLassoActive(false);
          setMaskTarget(null);
          setWandActive(false);
          setBrushActive(false);
          setGuidesActive(false);
        }
      : null
  );
  return {
    busy, setBusy,
    capturing, setCapturing,
    cropRect, setCropRect,
    cropPreset, setCropPreset,
    penPoints, setPenPoints,
    pathEditId, setPathEditId,
    pathEditRing, setPathEditRing,
    assistantOpen, setAssistantOpen,
    pathEditNode, setPathEditNode,
    lassoActive, setLassoActive,
    selection, setSelection,
    selectTool, setSelectTool,
    selectMode, setSelectMode,
    selectTargetId, setSelectTargetId,
    maskTarget, setMaskTarget,
    wandActive, setWandActive,
    wandTolerance, setWandTolerance,
    cornerPinId, setCornerPinId,
    wandContiguous, setWandContiguous,
    brushActive, setBrushActive,
    pixelOpen, setPixelOpen,
    multiIds, setMultiIds,
    pixelLayerId, setPixelLayerId,
    brush, setBrush,
    brushLayerId, setBrushLayerId,
    brushMaskMode, setBrushMaskMode,
    brushSource, setBrushSource,
    needSource, setNeedSource,
    brushHistory, onBrushHistory,
    guidesActive, setGuidesActive,
    quickAdjust, setQuickAdjust,
  };
}

/** a módállapot — a hook-mentes akció-gyárak ezt kapják */
export type StudioModeState = ReturnType<typeof useStudioModeState>;
