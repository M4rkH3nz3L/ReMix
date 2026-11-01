import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import type { SkImage } from '@shopify/react-native-skia';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Image, PixelRatio, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { Chip } from '@/components/ui/controls';
import { type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { ImageAdjustStrip } from '@/components/studio/image/ImageAdjustStrip';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import {
  ImageStudioSheets,
  isInlineSheet,
  type SheetKind,
} from '@/components/studio/image/body/ImageStudioSheets';
import { BrushBar } from '@/components/studio/image/body/BrushBar';
import { type SelectionAction, SelectionBar, type SelectTool } from '@/components/studio/image/body/SelectionBar';
import { requestCutout } from '@/lib/bgremove';
import { foregroundMask } from '@/lib/foregroundMask';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { layerBoxToCanvas } from '@/lib/imageLayerGeometry';
import { adjustSelection, copySelectionToLayer, deleteSelection, maskFromSelection, selectionTarget } from '@/lib/imageSelectionOps';
import { applyRing, invertSelection, type Point, type Selection, type SelectionMode } from '@/lib/selection';
import { DEFAULT_BRUSH, isPaintLayer } from '@/lib/brushEngine';
import { ImageStudioToolbar } from '@/components/studio/image/body/ImageStudioToolbar';
import { SelectionActionBar } from '@/components/studio/image/body/SelectionActionBar';
import { palette } from '@/constants/editor';
import { useBackLayer } from '@/hooks/useBackLayer';
import { useLayout } from '@/hooks/useLayout';
import { layoutBudget, type Detent } from '@/lib/panelLayout';
import { IMAGE_SHEET_SPECS, type ImageSheetId } from '@/lib/panelSpecs';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { canBoolean } from '@/lib/imageBoolean';
import { aspectCropRect, type CropRect, cropImageDoc } from '@/lib/imageCrop';
// 🪄 magicWandClient (Skia-függő) SZÁNDÉKOSAN NINCS statikusan importálva — lustán
// töltjük (lásd onWandSeed), hogy a @shopify/react-native-skia natív modul hiánya
// (régi dev-kliens) ne crash-eltesse az EGÉSZ kép-stúdiót; a vászon/forma/szöveg/
// gradient/export Skia nélkül is megy, csak a varázspálca igényli.
import { type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
import { flattenTargets, mergeDownTargets, rasterSubDoc, replaceWithRaster } from '@/lib/imageCanvasOps';
import { compositionGuides, mergeGuides } from '@/lib/rulers';
import { deleteAnchor, type NodeType, reversePath, setNodeType } from '@/lib/vectorPath';
import {
  addLayer,
  createImageDoc,
  duplicateLayer,
  layerLabel,
  moveLayerTo,
  removeLayer,
  reorderLayer,
  toggleLayerLocked,
  updateLayer,
} from '@/lib/imageDoc';
import { canAlignLayer } from '@/lib/imageLayerLayout';
import { canRemovePage, duplicatePage, pageIndexAfterRemoval, reorderPages } from '@/lib/imageProjectPages';
import { publishImageProject } from '@/lib/feed';
import type { ImageShareMode } from '@/lib/imageShare';
import { exportPsd, importPdf, importPsd, renderImageDoc, renderSvgPdf } from '@/lib/imageDocClient';
import { ImageRenderRejected, imageDocContentKey, isRenderFresh } from '@/lib/imageExport';
import { type ToolKey, selectionMenu } from '@/lib/imageMenu';
import { shapeToPathPoints } from '@/lib/shapeGeometry';
import { panelState, workspaceLayout } from '@/lib/imageWorkspaceLayout';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { EdgeTab } from '@/components/studio/image/body/PanelChrome';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { StudioSheetFrameContext } from '@/components/studio/image/StudioSheet';
import { healRegionFromPoints } from '@/lib/imageLayerGeometry';
import { makeId } from '@/lib/id';
import { pickImage, pickPdf, pickPsd, pickSvg } from '@/lib/media';
import { imageDocToSvg, svgDocSize } from '@/lib/svgExport';
import { parseSvg } from '@/lib/svgImport';
import { createEmptyProject, trackEnd, trackOf } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import { guardPro, usePaywall } from '@/store/paywallStore';
import type { Asset, ClipMask, ImageClip, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';
import type { PostVisibility } from '@/types/social';
import { logCaught } from '@/lib/logCaught';

/** ✂️ induló kivágás-téglalap: enyhén behúzva, hogy a sarok-fogók látszódjanak */
const START_CROP: CropRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

function deleteLocalFile(uri: string) {
  try {
    new File(uri).delete();
  } catch (caught) {
    logCaught('components/studio/image/ImageStudioBody.tsx:deleteLocalFile', caught);
    /* takarítás — best-effort */
  }
}

/** a rétegpanel a munkaterület oszlopa: nincs detent, a lap kitölti a helyét */
const DOCKED_FRAME = { inline: true, docked: true, detents: { peek: 0, half: 0, full: 0 }, detent: 'peek' as const, onDetentChange: () => {} };

/** ecset-színek + -méretek (px) a sávban */
/** ennyi tétlenség után frissül a lap bélyegképe */
const THUMB_IDLE_MS = 2000;
/** varázspálca-tűrés: mennyire eltérő színek tartoznak még a kijelölésbe */
const WAND_TOLERANCES = [
  { value: 16, labelKey: 'studio.image.wand.tight' },
  { value: 32, labelKey: 'studio.image.wand.normal' },
  { value: 64, labelKey: 'studio.image.wand.wide' },
];

/** kivágás-arány presetek (pixel-arány w:h; null = szabad/teljes) */
const CROP_PRESETS: { label: string; labelKey?: string; ratio: number | null }[] = [
  { label: '', labelKey: 'studio.image.crop.free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

/**
 * 🖼️ A Kép Stúdió TÖRZSE — store-vezérelt, UI-only, a hang-stúdióval AZONOS
 * megosztott-törzs mintára. `project` mód: a projekt `imageDocs[0]` réteg-fáján
 * dolgozik (a `/studio/image/[id]` képernyő). `scoped` mód: a videó-editorból
 * nyíló Modal, egy adott kép-klip dokumentumán (docId), és a `onSave` visszaírja
 * a klipre. Minden szerkesztés a command-buson megy (undo).
 */
export function ImageStudioBody({
  mode,
  title,
  docId,
  initialPageId,
  onExit,
  onSave,
}: {
  mode: 'project' | 'scoped';
  title: string;
  docId?: string;
  /** project mód: az induló lap (pl. album-borító) — érvénytelen id → első lap */
  initialPageId?: string;
  onExit: () => void;
  onSave?: (doc: ImageDoc, renderedUri: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  // 🔒 reaktív Pro-állapot a PSD-import gombhoz (free → letiltva + upsell)
  const isPro = useEntitlement((s) => s.isPro());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(initialPageId ?? null);
  const [sheet, setSheetRaw] = useState<SheetKind>(null);
  // 📐 MOBILE-UI §6.6: az inline lap detentje + a felhasználó utolsó választása laponként
  const [sheetDetent, setSheetDetent] = useState<Detent>('peek');
  const detentMemory = useRef<Partial<Record<ImageSheetId, Detent>>>({});
  const [workH, setWorkH] = useState(0);
  // 🧭 bal: szerszámsín, közép: vászon + eszköz-beállítások, jobb: rétegek. A sín mindig a
  // sorban van; a rétegpanel telefonon a vászon fölé nyílik, tableten a sorba épül
  const L = useLayout();
  const workspace = workspaceLayout(L.sizeClass, L.width);
  const imagePanels = useEditorPrefs((s) => s.imagePanels);
  const panels = panelState(workspace.mode, imagePanels);
  // telefonon a nyitott rétegpanel mellett a sín behúzódik, hogy a vászon látsszon rendezés közben
  const railYieldsToPanel = workspace.mode === 'overlay' && panels.layers;
  const [orderPreview, setOrderPreview] = useState<{ id: string; to: number } | null>(null);
  const setRailOpen = (rail: boolean) => useEditorPrefs.getState().setImagePanel(workspace.mode, { rail });
  const setLayersOpen = (layers: boolean) => useEditorPrefs.getState().setImagePanel(workspace.mode, { layers });
  const setSheet = (next: SheetKind) => {
    if (next === 'layers') {
      setLayersOpen(true);
      setSheetRaw(null);
      return;
    }
    if (next) {
      setSheetDetent(detentMemory.current[next] ?? IMAGE_SHEET_SPECS[next].initialDetent ?? 'peek');
    }
    setSheetRaw(next);
  };
  const onSheetDetent = (detent: Detent) => {
    setSheetDetent(detent);
    if (sheet) {
      detentMemory.current[sheet] = detent;
    }
  };
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropPreset, setCropPreset] = useState<number | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[] | null>(null);
  const [pathEditId, setPathEditId] = useState<string | null>(null);
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
  const [brushActive, setBrushActive] = useState(false);
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
  const brushRef = useRef<BrushHandle>(null);
  const canvasRef = useRef<View>(null);

  /**
   * 🖼️ A dokumentum PNG-vé raszterizálása. ELSŐ a worker-Chromium (teljes
   * felbontás, pontos), és ha az nem elérhető (weben, vagy nem fut a render-worker),
   * ESZKÖZÖN a vászon `captureRef`-je a fallback — így a MENTÉS worker nélkül is
   * működik (offline/Expo Go). A kijelölés-króm elrejtve, hogy ne kerüljön a képbe.
   */
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = () => useEditorStore.getState().undo();
  const redo = () => useEditorStore.getState().redo();
  const rejectedRef = useRef(false);
  const rasterize = async (
    target: ImageDoc,
    opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number }
  ): Promise<string | null> => {
    rejectedRef.current = false;
    const height = opts?.height ?? target.height ?? 1280;
    try {
      const viaWorker = await renderImageDoc(target, height, {
        format: opts?.format,
        quality: opts?.quality,
        onMissingLayers: (count) =>
          Alert.alert(t('studio.image.missingInExport.title'), t('studio.image.missingInExport.body', { count })),
      });
      if (viaWorker) {
        return viaWorker;
      }
    } catch (e) {
      // 🚫 I13: szándékos elutasítás — a fallback a user elől rejtené el az okot
      if (e instanceof ImageRenderRejected) {
        rejectedRef.current = true;
        Alert.alert(t('studio.image.renderFailTitle'), e.message);
        return null;
      }
      throw e;
    }
    // ⚠️ I12: a vászon csak az AKTÍV dokumentumot mutatja — másik lapot nem szabad lefotózni
    if (target.id !== doc?.id) {
      return null;
    }
    return captureCanvas(target, height, opts);
  };

  /** A vászon képe az eszközön, a dokumentum felbontásán, vízjel és kijelölés-króm nélkül. */
  const captureCanvas = async (target: ImageDoc, height: number, opts?: { format?: 'png' | 'jpg' | 'webp'; quality?: number }) => {
    setCapturing(true);
    await new Promise((r) => setTimeout(r, 90)); // egy render-kör, kijelölés-króm nélkül
    try {
      const canvas = effectiveCanvas(target);
      const ratio = PixelRatio.get();
      // a view-shot a méretet képpontban várja — a dokumentum felbontására kérjük a képet
      return await captureRef(canvasRef, {
        format: opts?.format === 'jpg' ? 'jpg' : 'png',
        quality: opts?.quality ?? 1,
        width: Math.round((height * (canvas.width / canvas.height)) / ratio),
        height: Math.round(height / ratio),
      });
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:rasterize', caught);
      return null;
    } finally {
      setCapturing(false);
    }
  };

  /** az általános hibaablak — ha a szerver már megmondta az okot, nem duplázzuk */
  const alertRenderFail = () => {
    if (!rejectedRef.current) {
      Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
    }
  };

  // project módban gondoskodunk róla, hogy legyen legalább egy kép-dokumentum
  useEffect(() => {
    if (mode !== 'project') {
      return;
    }
    const s = useEditorStore.getState();
    if (s.project && !(s.project.imageDocs && s.project.imageDocs.length > 0)) {
      // a fallback-doc is EXPLICIT vászonméretet kap (a projekt arányából) → a
      // dokumentumnak mindig van W×H-ja, amit a vászon-lap megmutat/szerkeszt
      const size = effectiveCanvas({ aspectRatio: s.project.aspectRatio });
      const nd = createImageDoc(s.project.name, s.project.aspectRatio, () => makeId('lyr'), {
        width: size.width,
        height: size.height,
      });
      s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: nd });
    }
  }, [mode]);

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

  // 💾 I4: a kész renderelt kép a store FRISS doc-jára kerül — a render alatt tett
  // szerkesztések nem állnak vissza az `await` előtt elkapott állapotra
  const commitRendered = (docIdToUpdate: string, renderedUri: string) => {
    const s = useEditorStore.getState();
    const fresh = s.project?.imageDocs?.find((d) => d.id === docIdToUpdate);
    if (fresh) {
      s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: { ...fresh, renderedUri, renderedKey: imageDocContentKey(fresh) }, label: 'render' });
    }
  };

  // 🖼️ I41: élő bélyegkép az aktív lapról, szerkesztési szünetben (a régi fájl törlődik)
  const activeThumbKey = doc && mode === 'project' ? imageDocContentKey(doc) : null;
  useEffect(() => {
    if (!doc || !activeThumbKey || doc.thumbKey === activeThumbKey || doc.layers.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      void renderImageDoc(doc, 256)
        .then((uri) => {
          if (!uri) {
            return;
          }
          const previous = doc.thumbUri;
          useEditorStore.getState().setDocThumb(doc.id, uri, activeThumbKey);
          if (previous && previous !== uri) {
            deleteLocalFile(previous);
          }
        })
        .catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:timer', caught); });
    }, THUMB_IDLE_MS);
    return () => clearTimeout(timer);
    // a doc a kulcson át számít: csak valódi tartalom-változásra indul újra
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThumbKey]);

  // a kijelölés levezetve — ha a réteg eltűnik (törlés/undo), null-ra esik
  const selectedLayer = doc?.layers.find((l) => l.id === selectedId) ?? null;
  const effectiveSelectedId = selectedLayer ? selectedId : null;
  // ↩️ a gyors korrekció-sáv csak fotó-kijelölésnél látszik — a vissza is csak akkor nyeli el
  useBackLayer(quickAdjust && selectedLayer?.kind === 'photo' ? () => setQuickAdjust(false) : null);

  // ── 🖼️📄 Galéria-lapok (project mód): új/duplikál/töröl/mozgat az aktív lapon ──
  const addPage = () => {
    const s = useEditorStore.getState();
    if (!s.project) {
      return;
    }
    const size = effectiveCanvas({ aspectRatio: s.project.aspectRatio });
    const nd = createImageDoc(t('studio.image.pageName', { n: pages.length + 1 }), s.project.aspectRatio, () => makeId('lyr'), {
      width: size.width,
      height: size.height,
    });
    s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: nd });
    setActivePageId(nd.id);
    setSelectedId(null);
  };

  const duplicateActivePage = () => {
    if (!doc) {
      return;
    }
    const dup = duplicatePage(doc, makeId('img'));
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: dup, label: t('studio.image.pageDuplicated', { name: dup.name }) });
    setActivePageId(dup.id);
    setSelectedId(null);
  };

  const deleteActivePage = () => {
    if (!doc || !canRemovePage({ imageDocs: pages })) {
      return;
    }
    const idx = pages.findIndex((d) => d.id === doc.id);
    const remaining = pages.filter((d) => d.id !== doc.id);
    const nextIdx = pageIndexAfterRemoval(idx, pages.length);
    Alert.alert(t('common.delete'), t('studio.image.pageDeleteConfirm', { name: doc.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          useEditorStore.getState().dispatch({ type: 'REMOVE_IMAGE_DOC', docId: doc.id });
          setActivePageId(remaining[nextIdx]?.id ?? null);
          setSelectedId(null);
        },
      },
    ]);
  };

  const movePage = (dir: -1 | 1) => {
    if (!doc) {
      return;
    }
    const idx = pages.findIndex((d) => d.id === doc.id);
    const reordered = reorderPages(pages, idx, idx + dir);
    if (reordered === pages) {
      return;
    }
    useEditorStore.getState().dispatch({ type: 'REORDER_IMAGE_DOCS', order: reordered.map((d) => d.id) });
  };

  const activeIdx = doc ? pages.findIndex((d) => d.id === doc.id) : -1;

  const add = (kind: ImageLayer['kind']) => {
    if (!doc) {
      return;
    }
    if (kind === 'photo') {
      void pickImage().then((picked) => {
        if (!picked) {
          return;
        }
        const l: PhotoLayer = {
          kind: 'photo',
          id: makeId('lyr'),
          uri: picked.uri,
          position: { x: 0.5, y: 0.5 },
          w: 0.7,
          h: 0.5,
          fit: 'cover',
        };
        commit(addLayer(doc, l), t('studio.image.undoAddPhoto'));
        setSelectedId(l.id);
      });
      return;
    }
    const id = makeId('lyr');
    const l: ImageLayer =
      kind === 'text'
        ? {
            kind: 'text',
            id,
            text: t('studio.image.newText'),
            color: '#ffffff',
            backgroundColor: null,
            fontSize: 9,
            fontWeight: 'bold',
            // saját font: a rendszer-font az előnézetben és az exportban eltérő lenne
            fontFamily: 'Poppins',
            position: { x: 0.5, y: 0.5 },
            stylePreset: 'outline',
          }
        : kind === 'fill'
          ? { kind: 'fill', id, fill: '#12121a' }
          : kind === 'adjust'
            ? { kind: 'adjust', id, adjust: {} }
            : {
                kind: 'shape',
                id,
                shape: 'rectangle',
                position: { x: 0.5, y: 0.5 },
                w: 0.4,
                h: 0.24,
                fill: '#ff2d95',
                cornerRadius: 0.12,
              };
    commit(addLayer(doc, l), t('studio.image.undoAddLayer'));
    setSelectedId(id);
  };

  // 🔷 a KIVÁLASZTOTT formatípus hozzáadása (nem csak téglalap) — alap-méret + fill
  const addShapeType = (shape: Exclude<ShapeLayer['shape'], 'path'>) => {
    if (!doc) {
      return;
    }
    const id = makeId('lyr');
    const base = { kind: 'shape' as const, id, position: { x: 0.5, y: 0.5 }, fill: '#ff2d95' };
    const l: ShapeLayer =
      shape === 'line'
        ? ({ ...base, shape: 'line', w: 0.6, h: 0.02, fill: '#ffffff', strokeWidth: 0.012 } as ShapeLayer)
        : shape === 'rectangle'
          ? ({ ...base, shape: 'rectangle', w: 0.4, h: 0.28, cornerRadius: 0.12 } as ShapeLayer)
          : ({ ...base, shape, w: 0.4, h: 0.4, ...(shape === 'polygon' ? { sides: 6 } : {}) } as ShapeLayer);
    commit(addLayer(doc, l), t('studio.image.undoAddLayer'));
    setSelectedId(id);
    setSheet(null);
  };

  // 🗂️ forrás-mappából a vászonra: a KÉP-forrás egy fotó-rétegként kerül be
  const insertSource = (asset: Asset) => {
    if (!doc || asset.kind !== 'image') {
      return;
    }
    const l: PhotoLayer = {
      kind: 'photo',
      id: makeId('lyr'),
      uri: asset.uri,
      assetId: asset.id,
      position: { x: 0.5, y: 0.5 },
      w: 0.7,
      h: 0.5,
      fit: 'cover',
    };
    commit(addLayer(doc, l), t('studio.image.undoAddPhoto'));
    setSelectedId(l.id);
    setSheet(null);
  };

  /**
   * 📥 SVG-fájl importja rétegekké (`svgImport` mag): a `.svg`-t beolvassuk,
   * ImageDoc-rétegekre bontjuk, és EGY köteg-műveletként (egy undo-lépés) a
   * command-buson betesszük — a vászonon azonnal megjelennek.
   */
  const importSvg = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const svg = await pickSvg();
      if (svg == null) {
        return;
      }
      const { layers, unsupported } = parseSvg(svg);
      if (layers.length === 0) {
        Alert.alert(t('studio.image.svgFailTitle'), t('studio.image.svgFailBody'));
        return;
      }
      // ⚠️ I25: amit nem tudtunk beolvasni, azt megmondjuk (nem tűnik el csendben)
      const skipped = Object.entries(unsupported).map(([tag, count]) => `<${tag}> ×${count}`);
      if (skipped.length > 0) {
        Alert.alert(t('studio.image.svgPartialTitle'), t('studio.image.svgPartialBody', { items: skipped.join(', ') }));
      }
      let next = doc;
      for (const l of layers) {
        next = addLayer(next, l);
      }
      commit(next, t('studio.image.undoImportSvg'));
      setSelectedId(layers[layers.length - 1].id);
      setSheet('layers');
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:importSvg', caught);
      Alert.alert(t('studio.image.svgFailTitle'), t('studio.image.svgFailBody'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 🖼️ PSD-import (IMAGE 01.1): egy .psd-t a workerrel réteges `ImageDoc`-ká
   * olvasunk (ag-psd, réteg-megőrzés), és EGY `UPSERT_IMAGE_DOC` parancsként
   * tesszük a projektbe (undo-barát) — a meglévő dokumentumok érintetlenek. Pro-
   * gated: free usernél a gomb letiltva, de ha mégis ide jutunk, a `guardPro`
   * elkapja a `ProRequiredError`-t és felhozza a paywallt.
   */
  const importPsdDoc = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const file = await pickPsd();
      if (!file) {
        return;
      }
      const psdDoc = await guardPro(
        () => importPsd(file, project?.id),
        (e) => Alert.alert(t('studio.image.psdFailTitle'), e.message || t('studio.image.psdFailBody'))
      );
      if (!psdDoc) {
        return; // lemondás / Pro-paywall / hiba (a guardPro már jelzett)
      }
      // EGY command: a réteges doc a projektbe (sosem közvetlen doc-írás)
      useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: psdDoc, label: t('studio.image.undoImportPsd') });
      // I22: az importált lapra ugrunk, különben úgy tűnik, nem történt semmi
      if (mode === 'project') {
        setActivePageId(psdDoc.id);
        setSelectedId(null);
      }
      setSheet('layers');
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:importPsdDoc', e);
      Alert.alert(t('studio.image.psdFailTitle'), (e as Error)?.message || t('studio.image.psdFailBody'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 📄 PDF-import (IMAGE 01.3): egy .pdf-et a workerrel OLDALANKÉNT egy `ImageDoc`-ká
   * olvasunk (pdf-lib struktúra + pdfjs+canvas raszter), és a kész lapokat EGY
   * `applyBatch` köteg-paranccsal tesszük a projekt-galériába (az egész import EGY
   * undo-lépés — a meglévő lapok érintetlenek). Pro-gated: free usernél a gomb
   * letiltva, de ha mégis ide jutunk, a `guardPro` felhozza a paywallt.
   */
  const importPdfDocs = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const file = await pickPdf();
      if (!file) {
        return;
      }
      const pdfDocs = await guardPro(
        () => importPdf(file, project?.id),
        (e) => Alert.alert(t('studio.image.pdfFailTitle'), e.message || t('studio.image.pdfFailBody'))
      );
      if (!pdfDocs || pdfDocs.length === 0) {
        return; // lemondás / Pro-paywall / hiba / üres (a guardPro már jelzett)
      }
      // EGY köteg-command (applyBatch): oldalanként egy UPSERT_IMAGE_DOC, de az
      // egész import EGY undo-lépés (sosem közvetlen doc-írás)
      useEditorStore
        .getState()
        .applyBatch(
          pdfDocs.map((d) => ({ type: 'UPSERT_IMAGE_DOC', doc: d, label: t('studio.image.undoImportPdf') })),
          'user'
        );
      // az ÚJ első lapra ugrunk (project módban), hogy a felhasználó rögtön lássa
      if (mode === 'project') {
        setActivePageId(pdfDocs[0].id);
        setSelectedId(null);
      }
      setSheet('layers');
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:importPdfDocs', e);
      Alert.alert(t('studio.image.pdfFailTitle'), (e as Error)?.message || t('studio.image.pdfFailBody'));
    } finally {
      setBusy(false);
    }
  };

  const onTool = (key: ToolKey) => {
    if (!doc) {
      return;
    }
    switch (key) {
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
      case 'toPath':
        // 🔷 forma → szerkeszthető pontok (a kinézet nem változik)
        if (selectedLayer?.kind === 'shape') {
          const points = shapeToPathPoints(selectedLayer);
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

  // 🪄 varázspálca: a koppintott fotó-régió szín-szelekciója (Skia) → ZÁRT path-forma
  //    a fotó dobozán (féligátlátszó kiemelés). A mag tesztelt; a Skia glue új build után fut.
  const onWandSeed = (
    uri: string,
    u: number,
    v: number,
    source: PhotoLayer
  ) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        // Skia-függő mag → lustán töltjük; ha a natív modul hiányzik, a catch kezeli
        const { magicWandSelect } = await import('@/lib/magicWandClient');
        const canvas = effectiveCanvas(doc);
        const boxAspect = (source.w * canvas.width) / (source.h * canvas.height);
        const outline = await magicWandSelect(uri, u, v, wandTolerance, { boxAspect, fit: source.fit });
        if (outline && outline.length >= 3 && selectTool === 'wand') {
          addSelectionRing(outline.map((p) => layerBoxToCanvas(p, source, canvas)));
        } else if (outline && outline.length >= 3 && doc) {
          const shape: ShapeLayer = {
            kind: 'shape',
            id: makeId('lyr'),
            shape: 'path',
            points: outline,
            closed: true,
            position: source.position,
            w: source.w,
            h: source.h,
            rotation: source.rotation,
            flipH: source.flipH,
            flipV: source.flipV,
            fill: '#7c5cff',
            opacity: 0.5,
          };
          commit(addLayer(doc, shape), t('studio.image.undoWand'));
          setSelectedId(shape.id);
        } else {
          Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.wand.failBody'));
        }
      } catch (caught) {
        logCaught('components/studio/image/ImageStudioBody.tsx:onWandSeed', caught);
        // a @shopify/react-native-skia natív modul hiányzik a dev-kliensből → új build kell
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.skiaMissing'));
      } finally {
        setBusy(false);
        setWandActive(false);
      }
    })();
  };

  /**
   * 🧱 Rétegek egyesítése / raszterizálása a valódi renderrel (a preview-nál pontosabb).
   * Pro: a Free render vízjeles, az a réteg pixeleibe égne; a vízjelet pedig kliens nem
   * kapcsolhatja ki. Szerver nélkül nem megy, ezt megmondjuk.
   */
  const mergeLayers = async (ids: string[], label: string) => {
    if (!doc || busy || ids.length === 0) {
      return;
    }
    if (!isPro) {
      usePaywall.getState().open();
      return;
    }
    setBusy(true);
    try {
      const uri = await renderImageDoc(rasterSubDoc(doc, ids), effectiveCanvas(doc).height);
      if (!uri) {
        Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.mergeNeedsServer'));
        return;
      }
      const fresh = useEditorStore.getState().project?.imageDocs?.find((d) => d.id === doc.id) ?? doc;
      const id = makeId('lyr');
      commit(replaceWithRaster(fresh, ids, uri, id, label), label);
      setSelectedId(id);
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:mergeLayers', e);
      Alert.alert(t('studio.image.renderFailTitle'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 🖌️ ecset: a Skia-festés pillanatképe PNG-fájlként → FOTÓ-réteg a vásznon
  const commitBrush = () => {
    if (doc && brushRef.current?.hasStrokes()) {
      const canvas = effectiveCanvas(doc);
      const uri = brushRef.current.exportPng(canvas.width, canvas.height);
      if (brushMaskMode && brushLayerId) {
        if (uri) {
          const mask: ClipMask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: uri };
          commit(updateLayer<PhotoLayer>(doc, brushLayerId, { mask }), t('studio.image.undoMaskPaint'));
        } else {
          Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.maskPaintFail'));
        }
        setSelectedId(brushLayerId);
      } else if (uri && brushLayerId) {
        commit({ ...doc, layers: doc.layers.map((l) => (l.id === brushLayerId ? { ...l, uri, paint: true } : l)) } as ImageDoc, t('studio.image.undoBrush'));
        setSelectedId(brushLayerId);
      } else if (uri) {
        const l: PhotoLayer = {
          kind: 'photo',
          id: makeId('lyr'),
          uri,
          paint: true,
          position: { x: 0.5, y: 0.5 },
          w: 1,
          h: 1,
          fit: 'contain',
        };
        commit(addLayer(doc, l), t('studio.image.undoBrush'));
        setSelectedId(l.id);
      }
    }
    setBrushActive(false);
  };

  // ✂️ háttér ki: eszközön, ha lehet (ingyenes); különben a felhő-út. A maszk festett maszkként
  // kerül a rétegre, így roncsolásmentes és ecsettel javítható.
  const removeBackground = async (layer: PhotoLayer) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const { Skia } = await import('@shopify/react-native-skia');
      const { projectMaskToCanvas } = await import('@/components/studio/image/projectMask');
      const output = new File(projectMediaDir(), `fg_${Date.now().toString(36)}.png`).uri;
      const local = await foregroundMask(layer.uri, output);
      if (local.status === 'no-subject') {
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.bgRemove.noSubject'));
        return;
      }
      let maskUri: string | null = local.status === 'ok' ? local.uri : null;
      if (local.status !== 'ok') {
        if (!isPro) {
          Alert.alert(t('studio.image.bgRemove.proTitle'), t('studio.image.bgRemove.proBody'));
          return;
        }
        maskUri = (await requestCutout(layer.uri))?.uri ?? null;
      }
      const [photo, mask] = await Promise.all([Skia.Data.fromURI(layer.uri), maskUri ? Skia.Data.fromURI(maskUri) : null]);
      const [photoImg, maskImg] = [Skia.Image.MakeImageFromEncoded(photo), mask ? Skia.Image.MakeImageFromEncoded(mask) : null];
      const canvas = effectiveCanvas(doc);
      const image = photoImg && maskImg ? projectMaskToCanvas(maskImg, layer, { width: photoImg.width(), height: photoImg.height() }, canvas, local.status !== 'ok') : null;
      if (!image) {
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.bgRemove.failBody'));
        return;
      }
      const next: ClipMask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image };
      commit(updateLayer<PhotoLayer>(doc, layer.id, { mask: next }), t('studio.image.bgRemove.undo'));
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:removeBackground', caught);
      Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.bgRemove.failBody'));
    } finally {
      setBusy(false);
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
  const addSelectionRing = (ring: Point[]) => setSelection((sel) => applyRing(sel, ring, selectMode));
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
  const selectionAction = (action: SelectionAction) => {
    if (!doc || !selection) {
      return;
    }
    const id = makeId('lyr');
    let next: ImageDoc | null = null;
    if (action === 'copy') {
      next = copySelectionToLayer(doc, selectTargetId, selection, id);
    } else if (action === 'delete') {
      next = deleteSelection(doc, selectTargetId, selection);
    } else if (action === 'mask') {
      next = maskFromSelection(doc, selectTargetId, selection);
    } else if (action === 'adjust') {
      next = adjustSelection(doc, selection, id);
    } else if (selection.ops.length === 1 && !selection.invert) {
      const shape = pathShapeFromCanvasPoints(selection.ops[0].points, true, id);
      next = shape ? addLayer(doc, shape) : null;
    }
    if (!next) {
      Alert.alert(t('studio.image.select.failTitle'), t('studio.image.select.failBody'));
      return;
    }
    commit(next, t('studio.image.select.undo'));
    // a törlés után a kijelölés marad (mehet a következő lépés), a többi egy új réteget szerkeszt tovább
    if (action !== 'delete') {
      clearSelection();
      setSelectedId(action === 'mask' ? selectTargetId : id);
    }
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

  // 🪢 lasszó: a szabadkézi pontokból ZÁRT path-forma — VAGY (maszk-módban) a kijelölt réteg maszkja
  const commitLasso = (points: CanvasPoint[]) => {
    if (selectTool === 'lasso') {
      addSelectionRing(points);
      return;
    }
    if (doc && points.length >= 3 && maskTarget) {
      // 🎭 szelekció → maszk (poligon): a vászon-normalizált pontok + bbox
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      if (maskTarget.target === 'heal') {
        // 🩹 folt-javítás: a lasszó bbox-át a FOTÓ dobozába transzformáljuk (0–1 box-lokális) → heal-régió
        const cur = doc.layers.find((l) => l.id === maskTarget.id);
        if (cur && cur.kind === 'photo') {
          // I18: a réteg forgatása/tükrözése is számít — a heal a réteg saját terében fut
          const region = healRegionFromPoints(points, cur, effectiveCanvas(doc));
          commit(
            updateLayer<PhotoLayer>(doc, maskTarget.id, { heal: [...(cur.heal ?? []), region] }),
            t('studio.image.undoHeal', { defaultValue: 'Folt-javítás' })
          );
        }
        setMaskTarget(null);
        setLassoActive(false);
        return;
      }
      const mask: ClipMask = {
        shape: 'polygon',
        points: points.map((p) => ({ x: p.x, y: p.y })),
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        w: Math.max(0.02, maxX - minX),
        h: Math.max(0.02, maxY - minY),
        feather: 0.02,
      };
      if (maskTarget.target === 'local') {
        // a meglévő lokális grade/adjust megmarad, csak a maszk cserélődik
        const cur = doc.layers.find((l) => l.id === maskTarget.id);
        const prev = cur && 'localAdjust' in cur ? (cur as PhotoLayer).localAdjust : undefined;
        commit(
          updateLayer(doc, maskTarget.id, { localAdjust: { ...prev, mask } } as Partial<ImageLayer>),
          t('studio.image.undoMask', { defaultValue: 'Maszk' })
        );
      } else {
        commit(updateLayer(doc, maskTarget.id, { mask } as Partial<ImageLayer>), t('studio.image.undoMask', { defaultValue: 'Maszk' }));
      }
      setMaskTarget(null);
      setLassoActive(false);
      return;
    }
    if (doc && points.length >= 3) {
      const shape = pathShapeFromCanvasPoints(points, true, makeId('lyr'));
      if (shape) {
        commit(addLayer(doc, shape), t('studio.image.undoLasso'));
        setSelectedId(shape.id);
      }
    }
    setMaskTarget(null);
    setLassoActive(false);
  };

  // ✏️ v3: a KIJELÖLT node típusa (görbe/sarok) — bezier-fogók létrehozása/törlése
  const pe = pathEditId && doc ? doc.layers.find((l) => l.id === pathEditId) ?? null : null;
  const pathEditShape = pe && pe.kind === 'shape' && pe.shape === 'path' ? pe : null;
  // nyitott útvonalnak vonal kell, különben láthatatlan volna
  const togglePathClosed = () => {
    if (doc && pathEditShape) {
      const closed = !pathEditShape.closed;
      commit(updateLayer<ShapeLayer>(doc, pathEditShape.id, { closed, strokeWidth: closed ? pathEditShape.strokeWidth : pathEditShape.strokeWidth ?? 0.9 }), 'path-closed');
    }
  };
  const reverseEditedPath = () => {
    if (doc && pathEditShape?.points) {
      commit(updateLayer<ShapeLayer>(doc, pathEditShape.id, { points: reversePath(pathEditShape.points) }), 'path-reverse');
      setPathEditNode(null);
    }
  };
  const setNodeKind = (type: NodeType) => {
    if (doc && pathEditShape?.points && pathEditNode != null) {
      commit(
        updateLayer(doc, pathEditShape.id, {
          points: setNodeType(pathEditShape.points, pathEditNode, type, !!pathEditShape.closed),
        }),
        `node-${type}`
      );
    }
  };
  // ✏️ v4: a kijelölt node törlése (legalább 2 pont marad)
  const deleteNode = () => {
    if (doc && pathEditShape?.points && pathEditNode != null && pathEditShape.points.length > 2) {
      commit(
        updateLayer(doc, pathEditShape.id, { points: deleteAnchor(pathEditShape.points, pathEditNode) }),
        'node-delete'
      );
      setPathEditNode(null);
    }
  };

  const exportImage = async (opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number }) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const uri = await rasterize(doc, opts);
      if (!uri) {
        alertRenderFail();
        return;
      }
      commitRendered(doc.id, uri);
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportImage', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(uri).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportImage', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * 🧩 ÖNÁLLÓ SVG a dokumentumból ([svgExport](@/lib/svgExport)): a fotó-rétegeket
   * base64 data-URI-ba ágyazzuk, hogy a kimenet önmagában megálljon (SVG + PDF közös).
   */
  const buildExportSvg = (d: ImageDoc): string => {
    const embedded = {
      ...d,
      layers: d.layers.map((l) => {
        if (l.kind === 'photo' && typeof l.uri === 'string' && l.uri.startsWith('file://')) {
          try {
            const src = new File(l.uri);
            if (src.exists) {
              const ext = (l.uri.split('.').pop() ?? 'jpg').toLowerCase();
              const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
              return { ...l, uri: `data:${mime};base64,${src.base64()}` };
            }
          } catch (caught) {
            logCaught('components/studio/image/ImageStudioBody.tsx:buildExportSvg', caught);
            // nem olvasható fotó → marad a hivatkozás (nem self-contained)
          }
        }
        return l;
      }),
    };
    return imageDocToSvg(embedded);
  };

  /**
   * 🧩 VEKTOR-export: a dokumentum SVG-ként, hogy a formák/szöveg/gradiensek
   * vektorként maradjanak (nem raszter-PNG-be égetve) → ÖNÁLLÓ, megosztható .svg.
   */
  const exportSvg = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const svg = buildExportSvg(doc);
      const dir = new Directory(Paths.cache, 'export');
      if (!dir.exists) {
        dir.create();
      }
      const safe = (doc.name || 'image').replace(/[^\w.-]+/g, '_');
      const file = new File(dir, `${safe}.svg`);
      try {
        if (file.exists) {
          file.delete();
        }
      } catch (caught) {
        logCaught('components/studio/image/ImageStudioBody.tsx:exportSvg', caught);
        // a write úgyis felülírja
      }
      file.write(svg);
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportSvg', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'image/svg+xml', dialogTitle: t('studio.export') }).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportSvg', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * 📄 VEKTOR-PDF export: ugyanaz az önálló SVG → a worker Chromiumja nyomdakész
   * PDF-be nyomtatja (`renderSvgPdf` → `/svg/pdf`). A lap pontosan a vászon mérete.
   */
  const exportPdf = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const svg = buildExportSvg(doc);
      const { width, height } = svgDocSize(doc);
      const uri = await renderSvgPdf(svg, width, height);
      if (!uri) {
        Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
        return;
      }
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPdf', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('studio.export') }).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPdf', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * 🖼️ PSD-export (IMAGE 01.2): a réteg-fát a workerrel RÉTEG-MEGŐRZÉSSEL (NEM
   * flatten!) .psd-vé építjük (`exportPsd` → `/psd/export`), és megosztjuk. Pro-
   * gated: free usernél az ExportSheet gombja letiltva (`canPsd`), de ha ide jutunk,
   * a `guardPro` elkapja a `ProRequiredError`-t és felhozza a paywallt.
   */
  const exportPsdFile = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const uri = await guardPro(
        () => exportPsd(doc, project?.id),
        (e) => Alert.alert(t('studio.image.psdExportFailTitle'), e.message || t('studio.image.psdExportFailBody'))
      );
      if (!uri) {
        return; // lemondás / Pro-paywall / hiba (a guardPro már jelzett)
      }
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPsdFile', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/vnd.adobe.photoshop',
          dialogTitle: t('studio.export'),
        }).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPsdFile', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:exportPsdFile', e);
      Alert.alert(t('studio.image.psdExportFailTitle'), (e as Error)?.message || t('studio.image.psdExportFailBody'));
    } finally {
      setBusy(false);
    }
  };

  // 🖼️→🎬 a kirasterizált kép ÚJ videó-projektbe (ReMix cél: „kép → videó")
  const insertIntoVideo = async () => {
    if (!doc || !project || busy) {
      return;
    }
    setBusy(true);
    try {
      const uri = await rasterize(doc);
      if (!uri) {
        alertRenderFail();
        return;
      }
      const vid = createEmptyProject(
        t('studio.image.videoName', { name: project.name }),
        project.aspectRatio,
        undefined,
        'video'
      );
      const clip: ImageClip = {
        kind: 'image',
        id: makeId('clip'),
        start: trackEnd(trackOf(vid, 'video')),
        duration: 4,
        uri,
        filterId: 'none',
      };
      const withClip: typeof vid = {
        ...vid,
        tracks: vid.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [clip] } : tr)),
        assets: [{ id: makeId('ast'), kind: 'image', uri, provider: 'local', name: doc.name }],
      };
      await saveProject(withClip);
      router.replace(`/editor/${withClip.id}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 🖼️➡️📲 A galéria megosztása a FEEDBE — diavetítés (videó) vagy lapozható (carousel).
   * Előbb MINDEN lapot rasterizálunk (renderelt PNG), majd a `publishImageProject` a megfelelő
   * poszttá alakítja. (Felhő-funkció: a render/feltöltés a workert/tárat igényli — a free a
   * telefonon marad; a hiba barátságosan jelenik meg.)
   */
  // I43: a megosztás nem azonnal nyilvános — a user választ láthatóságot
  const confirmShare = (shareMode: ImageShareMode) => {
    Alert.alert(t('studio.image.shareFeed.confirmTitle'), t('studio.image.shareFeed.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.image.shareFeed.followers'), onPress: () => void shareToFeed(shareMode, 'followers') },
      { text: t('studio.image.shareFeed.public'), onPress: () => void shareToFeed(shareMode, 'public') },
    ]);
  };

  const shareToFeed = async (shareMode: ImageShareMode, visibility: PostVisibility) => {
    const s = useEditorStore.getState();
    if (!s.project || busy) {
      return;
    }
    setBusy(true);
    try {
      for (const p of pages) {
        // I41: a szerkesztés után elavult képet nem osztjuk meg
        if (!isRenderFresh(p)) {
          const uri = await rasterize(p);
          if (!uri) {
            // I12: inkább nem osztunk meg semmit, mint rossz lapot
            alertRenderFail();
            return;
          }
          commitRendered(p.id, uri);
        }
      }
      const fresh = useEditorStore.getState().project;
      if (!fresh) {
        return;
      }
      await publishImageProject(fresh, shareMode, { visibility });
      Alert.alert(
        t('studio.image.shareFeed.doneTitle', { defaultValue: 'Megosztva' }),
        t('studio.image.shareFeed.doneBody', { defaultValue: 'A poszt felkerült a feedbe.' })
      );
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:shareToFeed', e);
      Alert.alert(t('common.error'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openExportMenu = () => setSheet('export');

  const saveScoped = async () => {
    if (!doc || busy) {
      onExit();
      return;
    }
    if (!onSave) {
      onExit();
      return;
    }
    setBusy(true);
    try {
      const uri = await rasterize(doc);
      await onSave(doc, uri);
    } finally {
      setBusy(false);
    }
  };

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

  // 🎯 precíziós mód (kivágás, toll, node, lasszó, pálca, ecset, vonalzó): a felső
  // sáv és a lap-strip elrejtve → a vászon kapja a helyet; a mód-sáv a kilépés (§3.3)
  const precisionMode =
    !!cropRect || !!penPoints || !!pathEditId || !!selectTool || lassoActive || wandActive || brushActive || guidesActive;
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
      width={workspace.railWidth}
      onCollapse={() => setRailOpen(false)}
    />
  );
  const layerPanel = doc ? (
    <StudioSheetFrameContext.Provider value={DOCKED_FRAME}>
      <LayerPanel
        doc={doc}
        selectedId={effectiveSelectedId}
        onSelect={setSelectedId}
        onMergeDown={(id) => {
          const pair = mergeDownTargets(doc, id);
          if (pair) {
            void mergeLayers(pair, t('studio.image.mergeDown'));
          }
        }}
        onRasterize={(id) => void mergeLayers([id], t('studio.image.rasterize'))}
        onFlatten={() => void mergeLayers(flattenTargets(doc), t('studio.image.flatten'))}
        onOrderPreview={setOrderPreview}
        commit={commit}
        onClose={() => setLayersOpen(false)}
      />
    </StudioSheetFrameContext.Provider>
  ) : null;

  return (
    <View style={styles.root}>
      {/* felső sáv */}
      <View style={[styles.topBar, precisionMode ? styles.hidden : null]}>
        <Pressable onPress={exitStudio} hitSlop={10} style={styles.topBtn}>
          <Ionicons name={mode === 'scoped' ? 'close' : 'chevron-back'} size={26} color={palette.text} />
        </Pressable>
        <View style={styles.titleWrap}>
          <View style={styles.kindTag}>
            <Ionicons name="image" size={12} color={palette.accent} />
            <Text style={styles.kindTagText}>{t('studio.kind.image')}</Text>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {doc ? (
          <Pressable
            onPress={() => setSheet('history')}
            hitSlop={8}
            style={styles.canvasBtn}
            accessibilityRole="button"
            accessibilityLabel={t('studio.image.historyTitle', { defaultValue: 'Előzmények' })}
          >
            <Ionicons name="time-outline" size={15} color={palette.textDim} />
          </Pressable>
        ) : null}
        {doc ? (
          <Pressable
            onPress={() => setSheet('canvas')}
            hitSlop={8}
            style={styles.canvasBtn}
            accessibilityRole="button"
            accessibilityLabel={t('studio.image.canvasTitle')}
          >
            <Ionicons name="resize-outline" size={14} color={palette.textDim} />
            <Text style={styles.canvasBtnText}>
              {effectiveCanvas(doc).width}×{effectiveCanvas(doc).height}
              {doc.format === 'vector' ? ' · SVG' : ''}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={mode === 'scoped' ? saveScoped : openExportMenu}
          hitSlop={10}
          style={styles.exportBtn}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name={mode === 'scoped' ? 'checkmark' : 'share-outline'} size={16} color="#fff" />
          )}
          <Text style={styles.exportText}>
            {mode === 'scoped' ? t('common.done') : t('studio.export')}
          </Text>
        </Pressable>
      </View>

      {/* 🖼️📄 galéria lap-strip (project mód): több kép → diavetítés/lapozható megosztás */}
      {mode === 'project' && pages.length > 0 && !precisionMode ? (
        <View style={styles.pageStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pageStripContent}
          >
            {pages.map((p, i) => {
              const active = p.id === doc?.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setActivePageId(p.id);
                    setSelectedId(null);
                  }}
                  style={[styles.pageChip, active && styles.pageChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name} (${i + 1})`}
                >
                  {p.thumbUri ?? p.renderedUri ? (
                    <Image source={{ uri: p.thumbUri ?? p.renderedUri }} style={styles.pageThumb} resizeMode="cover" />
                  ) : (
                    <View style={styles.pageThumbEmpty}>
                      <Ionicons name="image-outline" size={16} color={palette.textDim} />
                    </View>
                  )}
                  <Text style={styles.pageChipNum}>{i + 1}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={addPage} style={styles.pageAdd} accessibilityRole="button" accessibilityLabel={t('common.add')}>
              <Ionicons name="add" size={22} color={palette.accent} />
            </Pressable>
          </ScrollView>
          <View style={styles.pageActions}>
            <Pressable onPress={() => movePage(-1)} disabled={activeIdx <= 0} hitSlop={6} style={styles.pageActionBtn}>
              <Ionicons name="chevron-back" size={16} color={activeIdx <= 0 ? palette.border : palette.textDim} />
            </Pressable>
            <Pressable
              onPress={() => movePage(1)}
              disabled={activeIdx < 0 || activeIdx >= pages.length - 1}
              hitSlop={6}
              style={styles.pageActionBtn}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={activeIdx < 0 || activeIdx >= pages.length - 1 ? palette.border : palette.textDim}
              />
            </Pressable>
            <Pressable onPress={duplicateActivePage} hitSlop={6} style={styles.pageActionBtn}>
              <Ionicons name="copy-outline" size={15} color={palette.textDim} />
            </Pressable>
            <Pressable
              onPress={deleteActivePage}
              disabled={!canRemovePage({ imageDocs: pages })}
              hitSlop={6}
              style={styles.pageActionBtn}
            >
              <Ionicons
                name="trash-outline"
                size={15}
                color={canRemovePage({ imageDocs: pages }) ? palette.textDim : palette.border}
              />
            </Pressable>
          </View>
        </View>
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
              doc={orderPreview ? moveLayerTo(doc, orderPreview.id, orderPreview.to) : doc}
              selectedId={effectiveSelectedId}
              onSelect={setSelectedId}
              onRequestEdit={(id) => {
                setSelectedId(id);
                setSheet('style');
              }}
              commit={commit}
              canvasRef={canvasRef}
              capturing={capturing}
              cropAspect={cropPreset}
              onUndo={undo}
              cropRect={cropRect}
              onCropRectChange={setCropRect}
              penPoints={penPoints}
              onPenAddPoint={(p) => setPenPoints((prev) => [...(prev ?? []), p])}
              onPenClose={() => commitPen(true)}
              pathEditId={pathEditId}
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

          {selection && !selectTool ? (
            /* ✂️ a kijelölés a többi eszköz alatt is él: innen szerkeszthető vagy szüntethető meg */
            <View style={styles.statusRow}>
              <Ionicons name="scan-outline" size={12} color={palette.accent} />
              <Text style={styles.statusText} numberOfLines={1}>
                {t('studio.image.select.active')}
              </Text>
              <Pressable onPress={() => startSelect('rect')} hitSlop={6} accessibilityRole="button">
                <Text style={styles.selectLink}>{t('studio.image.select.edit')}</Text>
              </Pressable>
              <Pressable onPress={clearSelection} hitSlop={6} accessibilityRole="button">
                <Text style={styles.selectLink}>{t('studio.image.select.clear')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* kijelölés-jelző */}
          <View style={styles.statusRow}>
            <Ionicons
              name={selectedLayer ? 'ellipse' : 'ellipse-outline'}
              size={9}
              color={selectedLayer ? palette.accent : palette.textDim}
            />
            <Text style={styles.statusText} numberOfLines={2}>
              {guidesActive
                ? t('studio.image.guides.hint')
                : brushActive
                ? brush.tool
                  ? t(needSource ? 'studio.image.retouch.pickHint' : 'studio.image.retouch.hint')
                  : t('studio.image.brush.hint')
                : selectTool === 'rect' || selectTool === 'ellipse'
                ? t('studio.image.select.hint')
                : wandActive
                ? t('studio.image.wand.hint')
                : lassoActive
                ? t('studio.image.lasso.hint')
                : pathEditId
                  ? t('studio.image.pen.editHint')
                  : penPoints
                    ? t('studio.image.pen.hint')
                    : cropRect
                      ? t('studio.image.crop.hint')
                      : selectedLayer
                        ? t('studio.image.selected', { name: layerLabel(selectedLayer) })
                        : t('studio.image.tapToSelect')}
            </Text>
            {/* ↩️ mindig kézre esik, a precíziós módokban is */}
            <Pressable style={styles.historyBtn} onPress={undo} disabled={!canUndo} accessibilityRole="button" accessibilityLabel={t('studio.image.undo')} accessibilityState={{ disabled: !canUndo }}>
              <Ionicons name="arrow-undo" size={20} color={canUndo ? palette.text : palette.border} />
            </Pressable>
            <Pressable style={styles.historyBtn} onPress={redo} disabled={!canRedo} accessibilityRole="button" accessibilityLabel={t('studio.image.redo')} accessibilityState={{ disabled: !canRedo }}>
              <Ionicons name="arrow-redo" size={20} color={canRedo ? palette.text : palette.border} />
            </Pressable>
          </View>

          {/* ✂️ kivágás-sáv (crop-módban a toolbar HELYETT) */}
          {cropRect ? (
            <View style={styles.cropBar}>
              <Pressable onPress={() => setCropRect(null)} style={styles.cropBtn} hitSlop={6}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cropPresets}>
                {CROP_PRESETS.map((p) => (
                  <Chip
                    key={p.labelKey ?? p.label}
                    label={p.labelKey ? t(p.labelKey) : p.label}
                    active={cropPreset === p.ratio}
                    onPress={() => {
                      setCropPreset(p.ratio);
                      if (doc) {
                        setCropRect(aspectCropRect(doc, p.ratio));
                      }
                    }}
                  />
                ))}
              </ScrollView>
              <Pressable onPress={applyCrop} style={styles.cropApply} hitSlop={6}>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.cropApplyText}>{t('common.apply')}</Text>
              </Pressable>
            </View>
          ) : penPoints ? (
            /* ✏️ toll-sáv (toll-módban a toolbar HELYETT) */
            <View style={styles.cropBar}>
              <Pressable onPress={() => setPenPoints(null)} style={styles.cropBtn} hitSlop={6}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
              <Pressable
                onPress={() => setPenPoints((prev) => (prev && prev.length ? prev.slice(0, -1) : prev))}
                style={styles.cropBtn}
                hitSlop={6}
                disabled={!penPoints.length}
              >
                <Ionicons
                  name="arrow-undo-outline"
                  size={18}
                  color={penPoints.length ? palette.text : palette.border}
                />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => commitPen(true)}
                style={[styles.penClose, penPoints.length < 3 ? styles.penDisabled : null]}
                hitSlop={6}
                disabled={penPoints.length < 3}
              >
                <Text style={styles.penCloseText}>{t('studio.image.pen.close')}</Text>
              </Pressable>
              <Pressable
                onPress={() => commitPen(false)}
                style={[styles.cropApply, penPoints.length < 2 ? styles.penDisabled : null]}
                hitSlop={6}
                disabled={penPoints.length < 2}
              >
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.cropApplyText}>{t('common.done')}</Text>
              </Pressable>
            </View>
          ) : pathEditId ? (
            /* ✏️ node-szerkesztő sáv (toll v2/v3 — a toolbar HELYETT) */
            <View style={styles.cropBar}>
              <Pressable onPress={() => setPathEditId(null)} style={styles.cropBtn} hitSlop={6}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
              <View style={{ flex: 1 }} />
              {/* ✏️ v4: a kijelölt node törlése */}
              <Pressable
                onPress={deleteNode}
                style={[styles.cropBtn, pathEditNode == null ? styles.penDisabled : null]}
                hitSlop={6}
                disabled={pathEditNode == null}
              >
                <Ionicons name="trash-outline" size={18} color={palette.danger} />
              </Pressable>
              {/* ✏️ a kijelölt node típusa, az útvonal iránya és nyitása */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.brushScroll}>
                {(['smooth', 'mirrored', 'broken', 'corner'] as const).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setNodeKind(type)}
                    style={[styles.penClose, pathEditNode == null ? styles.penDisabled : null]}
                    hitSlop={6}
                    disabled={pathEditNode == null}
                  >
                    <Text style={styles.penCloseText}>{t(`studio.image.pen.${type}`)}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={togglePathClosed} style={styles.penClose} hitSlop={6}>
                  <Text style={styles.penCloseText}>{t(pathEditShape?.closed ? 'studio.image.pen.open' : 'studio.image.pen.closePath')}</Text>
                </Pressable>
                <Pressable onPress={reverseEditedPath} style={styles.penClose} hitSlop={6}>
                  <Text style={styles.penCloseText}>{t('studio.image.pen.reverse')}</Text>
                </Pressable>
              </ScrollView>
              <Pressable onPress={() => setPathEditId(null)} style={styles.cropApply} hitSlop={6}>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.cropApplyText}>{t('common.done')}</Text>
              </Pressable>
            </View>
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
              onFeather={(feather) => setSelection((sel) => (sel ? { ...sel, feather } : sel))}
              onAction={selectionAction}
              onClear={clearSelection}
              onDone={closeSelectTool}
            />
          ) : lassoActive ? (
            /* 🪢 lasszó-sáv (húzás a vásznon rajzol; felengedésre zár) */
            <View style={styles.cropBar}>
              <Pressable onPress={cancelLasso} style={styles.cropBtn} hitSlop={6}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
              <Text style={styles.lassoLabel} numberOfLines={1}>
                {t('studio.image.lasso.hint')}
              </Text>
            </View>
          ) : wandActive ? (
            /* 🪄 varázspálca-sáv (fotóra koppintva szín-szelekció) */
            <View style={styles.cropBar}>
              <Pressable onPress={() => setWandActive(false)} style={styles.cropBtn} hitSlop={6}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
              {busy ? <ActivityIndicator size="small" color={palette.accent} /> : null}
              <View style={styles.brushRow}>
                {WAND_TOLERANCES.map((w) => (
                  <Chip key={w.value} label={t(w.labelKey)} active={wandTolerance === w.value} onPress={() => setWandTolerance(w.value)} />
                ))}
              </View>
            </View>
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
          ) : guidesActive ? (
            /* 📐 vonalzók/segédvonalak sáv (Harmadok / Törlés + kilépés) */
            <View style={styles.cropBar}>
              <Pressable onPress={() => setGuidesActive(false)} style={styles.cropBtn} hitSlop={6}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
              <Pressable
                onPress={() => doc && commit({ ...doc, guides: mergeGuides(doc.guides, compositionGuides()) }, t('studio.image.undoGuides'))}
                style={styles.penClose}
                hitSlop={6}
              >
                <Text style={styles.penCloseText}>{t('studio.image.guides.thirds')}</Text>
              </Pressable>
              <Pressable
                onPress={() => doc && commit({ ...doc, guides: [] }, t('studio.image.undoGuides'))}
                style={styles.penClose}
                hitSlop={6}
              >
                <Text style={styles.penCloseText}>{t('studio.image.guides.clear')}</Text>
              </Pressable>
              <Text style={styles.lassoLabel} numberOfLines={1}>
                {t('studio.image.guides.hint')}
              </Text>
            </View>
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
          ) : selectedLayer && doc ? (
            <SelectionActionBar
              menu={selectionMenu(selectedLayer, { canAlign: canAlignLayer(selectedLayer), canBoolean: canBoolean(doc, effectiveSelectedId) })}
              onAction={onTool}
              onDelete={() => onTool('delete')}
            />
          ) : null}
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
            onSvg={() => void exportSvg()}
            onPdf={() => void exportPdf()}
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
  hidden: { display: 'none' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  // 🖼️📄 galéria lap-strip
  pageStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  pageStripContent: { alignItems: 'center', gap: 8, paddingRight: 8 },
  pageChip: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: palette.border,
    overflow: 'hidden',
    backgroundColor: '#0d0f16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageChipActive: { borderColor: palette.accent },
  pageThumb: { width: '100%', height: '100%' },
  pageThumbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageChipNum: {
    position: 'absolute',
    bottom: 1,
    right: 3,
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    textShadowColor: '#000',
    textShadowRadius: 2,
  },
  pageAdd: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pageActionBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, gap: 2 },
  kindTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindTagText: { color: palette.accent, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700' },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 84,
    justifyContent: 'center',
  },
  exportText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  canvasBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: palette.surface,
  },
  canvasBtnText: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 0,
  },
  historyBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  statusText: { flex: 1, color: palette.textDim, fontSize: 11, fontWeight: '600' },
  cropBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cropBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropPresets: { alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  cropApply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 40,
    justifyContent: 'center',
  },
  cropApplyText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  penClose: {
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  penCloseText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  penDisabled: { opacity: 0.4 },
  lassoLabel: { flex: 1, color: palette.textDim, fontSize: 12, fontWeight: '600', paddingLeft: 4 },
  brushRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brushScroll: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6 },
  brushDotHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  brushDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: palette.border },
  brushDotActive: { borderColor: palette.text, borderWidth: 3 },
  selectLink: { color: palette.accent, fontSize: 12, fontWeight: '700' },
  brushSizeBtn: {
    width: 44,
    height: 44,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brushSizeActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}22` },
});
