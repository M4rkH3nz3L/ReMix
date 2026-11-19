import { File } from 'expo-file-system';
import type { SkImage } from '@shopify/react-native-skia';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { NewerSchemaBanner } from '@/components/NewerSchemaBanner';
import { keepRenderedInProject, RenderStage, ensureTextClipMasks } from '@/components/studio/image/RenderStage';
import { type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { ImageAdjustStrip } from '@/components/studio/image/ImageAdjustStrip';
import { EmptyCanvasHint } from '@/components/studio/image/EmptyCanvasHint';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import {
  ImageStudioSheets,
  isInlineSheet,
  type SheetKind,
} from '@/components/studio/image/body/ImageStudioSheets';
import { AssistantBar } from '@/components/studio/image/body/AssistantBar';
import { BrushBar } from '@/components/studio/image/body/BrushBar';
import { CornerPinBar, CropBar, GuidesBar, LassoBar, PathEditBar, PenBar, WandBar } from '@/components/studio/image/body/ModeBars';
import { PageStrip } from '@/components/studio/image/body/PageStrip';
import { ActiveSelectionRow, ExportingRow, StatusHintRow } from '@/components/studio/image/body/StatusRows';
import { StudioTopBar } from '@/components/studio/image/body/StudioTopBar';
import { useImageExport } from '@/components/studio/image/body/useImageExport';
import { useImageImports } from '@/components/studio/image/body/useImageImports';
import { useImagePages } from '@/components/studio/image/body/useImagePages';
import { useLayerRasterOps } from '@/components/studio/image/body/useLayerRasterOps';
import { useSelectionOps } from '@/components/studio/image/body/useSelectionOps';
import { applyImageCommands, type ImageCommand } from '@/lib/imageIntent';
import { type SelectionAction, SelectionBar, type SelectTool } from '@/components/studio/image/body/SelectionBar';
import { docFromTemplate, type ImageTemplate } from '@/lib/imageTemplates';
import { useBrandStyle, copyBrandLogoInto } from '@/store/brandStyleStore';
import { haptics } from '@/design';
import { type LayerMenuAction } from '@/components/studio/image/LayerMenuSheet';
import { MultiSelectBar, type MultiAction } from '@/components/studio/image/body/MultiSelectBar';
import { duplicateLayers, removeLayers, toggleId } from '@/lib/imageMulti';
import { alignLayersInDoc, canAlignLayer } from '@/lib/imageLayerLayout';
import { pixelLayerBox, type PixelArt } from '@/lib/pixelArt';
import { variantDoc } from '@/lib/imageVariants';
import { layerOnlyDoc } from '@/lib/imageExportCheck';
import { DEFAULT_GRID } from '@/lib/imageGrid';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { centeredPhotoLayer, defaultLayer, defaultShapeLayer, fullCanvasImageMask, paintedPhotoLayer } from '@/lib/imageLayerDefaults';
import { selectionTarget } from '@/lib/imageSelectionOps';
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
import { flattenTargets, mergeDownTargets } from '@/lib/imageCanvasOps';
import { compositionGuides, mergeGuides } from '@/lib/rulers';
import { deleteAnchor, type NodeType, pathEditPatch, pathEditView, reversePath, setNodeType } from '@/lib/vectorPath';
import {
  addLayer,
  createGroup,
  createImageDoc,
  docIsEmpty,
  duplicateLayer,
  moveLayerTo,
  removeLayer,
  reorderLayer,
  toggleLayerLocked,
  updateLayer,
} from '@/lib/imageDoc';
import { imageDocContentKey } from '@/lib/imageExport';
import { type ImageWorkspace, railGroups, type ToolKey, selectionMenu } from '@/lib/imageMenu';
import { registerDevAction } from '@/lib/devActions';
import { loadProjectFonts } from '@/lib/projectFontsClient';
import { shapeToPathPoints } from '@/lib/shapeGeometry';
import { panelState, workspaceLayout } from '@/lib/imageWorkspaceLayout';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { EdgeTab } from '@/components/studio/image/body/PanelChrome';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { StudioSheetFrameContext } from '@/components/studio/image/StudioSheet';
import { makeId } from '@/lib/id';
import { pickImage } from '@/lib/media';
import { brandLogoLayer } from '@/lib/imageBrand';
import { useEditorStore } from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import type { Asset, ClipMask, ImageDoc, ImageGrid, ImageLayer, PathPoint, PhotoLayer, ShapeLayer } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

// a Skia csak megnyitáskor töltődik be, mint az ecsetnél
const PixelStudio = lazy(() =>
  import('@/components/studio/image/PixelStudio').then((m) => ({ default: m.PixelStudio }))
);

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
  const projectFonts = useEditorStore((st) => st.project?.fonts);
  const [fontsVersion, setFontsVersion] = useState(0);
  useEffect(() => {
    if (!projectFonts?.length) return;
    let alive = true;
    void loadProjectFonts(projectFonts).then(() => alive && setFontsVersion((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [projectFonts]);
  // 🧪 füstteszt: a munkaterület és a sín első szerszámai (a Design belépési pont mérése)
  useEffect(
    () =>
      registerDevAction('image.workspace', (arg) => {
        if (arg === 'image' || arg === 'design') setWorkspaceTab(arg);
        return { ws: workspaceTab, tools: railGroups(workspaceTab)[0].tools };
      }),
    [workspaceTab]
  );
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
  const brushRef = useRef<BrushHandle>(null);
  const canvasRef = useRef<View>(null);

  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = () => useEditorStore.getState().undo();
  const redo = () => useEditorStore.getState().redo();

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
  const activeThumbKey = doc && mode === 'project' ? imageDocContentKey(doc) : null;
  useEffect(() => {
    if (!doc || !activeThumbKey || doc.thumbKey === activeThumbKey || doc.layers.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      // offline first: a bélyegkép is a telefonon készül (CORE K1)
      void (renderStageRef.current?.render(doc, 256) ?? Promise.resolve(null))
        .then((rendered) => {
          if (!rendered) {
            return;
          }
          const uri = keepRenderedInProject(rendered, `thumb_${doc.id}_${activeThumbKey}`);
          const previous = doc.thumbUri;
          useEditorStore.getState().setDocThumb(doc.id, uri, activeThumbKey);
          if (previous && previous !== uri) {
            deleteLocalFile(previous);
          }
        })
        .catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:timer', caught); });
    }, THUMB_IDLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a doc a kulcson át számít: csak valódi tartalom-változásra indul újra
  }, [activeThumbKey]);

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
  // 🏷️ S11: a márka-logó a lapra — a projektbe MÁSOLVA (a márka-fájl a helyén marad), egy visszavonás
  const insertBrandLogo = (uri: string) => {
    if (!doc) return;
    const copy = copyBrandLogoInto(projectMediaDir(), uri);
    if (!copy) {
      Alert.alert(t('studio.image.brand.logos'), t('studio.image.brand.logoMissing'));
      return;
    }
    const id = makeId('lyr');
    commit(addLayer(doc, brandLogoLayer(copy, id, effectiveCanvas(doc), t('studio.image.brand.logoName'))), t('studio.image.brand.logoInsert'));
    setSelectedId(id);
  };
  // 🧪 füstteszt: ugyanaz a beszúrás, a lap nélkül
  const insertBrandLogoRef = useRef(insertBrandLogo);
  insertBrandLogoRef.current = insertBrandLogo;
  useEffect(() => registerDevAction('image.insertBrandLogo', (arg) => {
    insertBrandLogoRef.current(String(arg));
    return true;
  }), []);
  const addTemplatePage = (tpl: ImageTemplate) => addDocPage(docFromTemplate(tpl, t(`studio.image.templates.${tpl.key}`), () => makeId('lyr'), useBrandStyle.getState()));
  const addVariantPage = (width: number, height: number, label: string) => {
    if (doc) {
      addDocPage(variantDoc(doc, width, height, label, () => makeId('lyr')));
    }
  };

  const add = (kind: ImageLayer['kind']) => {
    if (!doc) {
      return;
    }
    if (kind === 'photo') {
      void pickImage().then((picked) => {
        if (!picked) {
          return;
        }
        const l: PhotoLayer = centeredPhotoLayer(makeId('lyr'), picked.uri);
        commit(addLayer(doc, l), t('studio.image.undoAddPhoto'));
        setSelectedId(l.id);
      });
      return;
    }
    const id = makeId('lyr');
    const l: ImageLayer = defaultLayer(kind, id, t('studio.image.newText'));
    commit(addLayer(doc, l), t('studio.image.undoAddLayer'));
    setSelectedId(id);
  };

  // 🔷 a KIVÁLASZTOTT formatípus hozzáadása (nem csak téglalap) — alap-méret + fill
  const addShapeType = (shape: Exclude<ShapeLayer['shape'], 'path'>) => {
    if (!doc) {
      return;
    }
    const id = makeId('lyr');
    const l: ShapeLayer = defaultShapeLayer(shape, id);
    commit(addLayer(doc, l), t('studio.image.undoAddLayer'));
    setSelectedId(id);
    setSheet(null);
  };

  // 🗂️ forrás-mappából a vászonra: a KÉP-forrás egy fotó-rétegként kerül be
  const insertSource = (asset: Asset) => {
    if (!doc || asset.kind !== 'image') {
      return;
    }
    const l: PhotoLayer = centeredPhotoLayer(makeId('lyr'), asset.uri, asset.id);
    commit(addLayer(doc, l), t('studio.image.undoAddPhoto'));
    setSelectedId(l.id);
    setSheet(null);
  };

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
  // 🧩 S9: a sablon média-helyőrzője koppintásra a galériát nyitja; a kép a helyőrző helyén és
  // méretében, kitöltéssel (`cover`) jelenik meg — a kompozíció megmarad, egy visszavonás
  const placeImage = (layerId: string, uri: string): boolean => {
    const fresh = useEditorStore.getState().project?.imageDocs?.find((d) => d.id === doc?.id) ?? doc;
    const target = fresh?.layers.find((l) => l.id === layerId);
    if (!fresh || !target || target.kind !== 'photo' || !target.placeholder) {
      return false;
    }
    commit(updateLayer<PhotoLayer>(fresh, layerId, { uri, placeholder: undefined, fit: 'cover' }), t('studio.image.undoAddPhoto'));
    return true;
  };
  const fillPlaceholder = (layerId: string) => {
    void pickImage().then((picked) => {
      if (picked) {
        placeImage(layerId, picked.uri);
      }
    });
  };
  // 🧪 füstteszt: a galéria (rendszer-felület) helyett a kép közvetlenül, ugyanazzal a paranccsal
  const placeImageRef = useRef(placeImage);
  placeImageRef.current = placeImage;
  useEffect(() => registerDevAction('image.fillPlaceholder', (arg) => {
    const a = arg as { layerId: string; uri: string };
    return placeImageRef.current(a.layerId, a.uri);
  }), []);
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
  const onMultiAction = (action: MultiAction) => {
    if (!doc || !multiIds) {
      return;
    }
    if (action === 'delete') {
      commit(removeLayers(doc, multiIds), t('studio.image.undoDelete'));
      setMultiIds(null);
    } else if (action === 'duplicate') {
      commit(duplicateLayers(doc, multiIds, () => makeId('lyr')), t('studio.image.undoDuplicate'));
    } else if (action === 'group') {
      commit(createGroup(doc, multiIds, makeId('grp'), t('studio.image.multi.group')), t('studio.image.multi.group'));
      setMultiIds(null);
    } else {
      commit(alignLayersInDoc(doc, multiIds, action), t(`studio.image.multi.${action}`));
    }
  };

  // 👾 a pixel-munka szerkeszthető rétegként kerül a dokumentumba, egy undo-lépésben
  const onPixelDone = (art: PixelArt, uri: string) => {
    setPixelOpen(false);
    if (!doc) {
      return;
    }
    if (pixelLayerId) {
      commit(updateLayer(doc, pixelLayerId, { uri, pixelArt: art } as Partial<ImageLayer>), t('studio.image.pixel.title'));
      return;
    }
    const { width, height } = effectiveCanvas(doc);
    const id = makeId('lyr');
    const layer: PhotoLayer = { kind: 'photo', id, name: t('studio.image.pixel.title'), uri, position: { x: 0.5, y: 0.5 }, ...pixelLayerBox(art.width, art.height, width, height), fit: 'stretch', pixelArt: art };
    commit(addLayer(doc, layer), t('studio.image.pixel.title'));
    setSelectedId(id);
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

  const { mergeLayers, removeBackground, pathOperation } = useLayerRasterOps({
    doc,
    busy,
    setBusy,
    isPro,
    commit,
    rasterize,
    setSelectedId,
  });

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
  }), []);
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

  // ✏️ v3: a KIJELÖLT node típusa (görbe/sarok) — bezier-fogók létrehozása/törlése
  const pe = pathEditId && doc ? doc.layers.find((l) => l.id === pathEditId) ?? null : null;
  const rawPathShape = pe && pe.kind === 'shape' && pe.shape === 'path' ? pe : null;
  const pathEditShape = rawPathShape ? pathEditView(rawPathShape, pathEditRing) : null;
  const ringCount = rawPathShape?.subpaths?.length ?? 0;
  const writePath = (points: PathPoint[]) => pathEditPatch(rawPathShape ?? {}, pathEditRing, points);
  // nyitott útvonalnak vonal kell, különben láthatatlan volna
  const togglePathClosed = () => {
    if (doc && pathEditShape) {
      const closed = !pathEditShape.closed;
      commit(updateLayer<ShapeLayer>(doc, pathEditShape.id, { closed, strokeWidth: closed ? pathEditShape.strokeWidth : pathEditShape.strokeWidth ?? 0.9 }), 'path-closed');
    }
  };
  const reverseEditedPath = () => {
    if (doc && pathEditShape?.points) {
      commit(updateLayer<ShapeLayer>(doc, pathEditShape.id, writePath(reversePath(pathEditShape.points))), 'path-reverse');
      setPathEditNode(null);
    }
  };
  const setNodeKind = (type: NodeType) => {
    if (doc && pathEditShape?.points && pathEditNode != null) {
      commit(
        updateLayer(doc, pathEditShape.id, writePath(setNodeType(pathEditShape.points, pathEditNode, type, !!pathEditShape.closed))),
        `node-${type}`
      );
    }
  };
  // ✏️ v4: a kijelölt node törlése (legalább 2 pont marad)
  const deleteNode = () => {
    if (doc && pathEditShape?.points && pathEditNode != null && pathEditShape.points.length > 2) {
      commit(
        updateLayer(doc, pathEditShape.id, writePath(deleteAnchor(pathEditShape.points, pathEditNode))),
        'node-delete'
      );
      setPathEditNode(null);
    }
  };

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
      groups={railGroups(workspaceTab)}
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

          {/* ✂️ kivágás-sáv (crop-módban a toolbar HELYETT) */}
          {cropRect ? (
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
