import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { SourceSheet } from '@/components/SourceSheet';
import { Chip } from '@/components/ui/controls';
import { type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { AdjustStackSheet } from '@/components/studio/image/AdjustStackSheet';
import { EffectsSheet } from '@/components/studio/image/EffectsSheet';
import { PatternSheet } from '@/components/studio/image/PatternSheet';
import { AlignSheet } from '@/components/studio/image/AlignSheet';
import { BooleanSheet } from '@/components/studio/image/BooleanSheet';
import { CanvasSheet } from '@/components/studio/image/CanvasSheet';
import { ExportSheet } from '@/components/studio/image/ExportSheet';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { LayerStyleSheet } from '@/components/studio/image/LayerStyleSheet';
import { ShapePickerSheet } from '@/components/studio/image/ShapePickerSheet';
import { palette } from '@/constants/editor';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { canBoolean } from '@/lib/imageBoolean';
import { aspectCropRect, type CropRect, cropImageDoc } from '@/lib/imageCrop';
// 🪄 magicWandClient (Skia-függő) SZÁNDÉKOSAN NINCS statikusan importálva — lustán
// töltjük (lásd onWandSeed), hogy a @shopify/react-native-skia natív modul hiánya
// (régi dev-kliens) ne crash-eltesse az EGÉSZ kép-stúdiót; a vászon/forma/szöveg/
// gradient/export Skia nélkül is megy, csak a varázspálca igényli.
import { type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
import { compositionGuides } from '@/lib/rulers';
import { deleteAnchor, setNodeType } from '@/lib/vectorPath';
import {
  addLayer,
  createImageDoc,
  duplicateLayer,
  layerLabel,
  removeLayer,
  reorderLayer,
  updateLayer,
} from '@/lib/imageDoc';
import { canAlignLayer } from '@/lib/imageLayerLayout';
import { canRemovePage, duplicatePage, pageIndexAfterRemoval, reorderPages } from '@/lib/imageProjectPages';
import { publishImageProject } from '@/lib/feed';
import type { ImageShareMode } from '@/lib/imageShare';
import { renderImageDoc, renderSvgPdf } from '@/lib/imageDocClient';
import { makeId } from '@/lib/id';
import { pickImage, pickSvg } from '@/lib/media';
import { imageDocToSvg, svgDocSize } from '@/lib/svgExport';
import { parseSvg } from '@/lib/svgImport';
import { createEmptyProject, trackEnd, trackOf } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, ClipMask, ImageClip, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

type ToolKey =
  | 'layers'
  | 'photo'
  | 'text'
  | 'shape'
  | 'pen'
  | 'lasso'
  | 'wand'
  | 'brush'
  | 'svg'
  | 'style'
  | 'adjust'
  | 'fx'
  | 'pattern'
  | 'crop'
  | 'guides'
  | 'align'
  | 'boolean'
  | 'forward'
  | 'back'
  | 'rotate'
  | 'flipH'
  | 'flipV'
  | 'duplicate'
  | 'delete';

interface Tool {
  key: ToolKey;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}

/** ✂️ induló kivágás-téglalap: enyhén behúzva, hogy a sarok-fogók látszódjanak */
const START_CROP: CropRect = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

/** ecset-színek + -méretek (px) a sávban */
const BRUSH_COLORS = ['#ffffff', '#0b0b18', '#ff2d95', '#ffd166', '#39d98a', '#4d9dff'];
const BRUSH_SIZES = [4, 10, 20];

/** kivágás-arány presetek (pixel-arány w:h; null = szabad/teljes) */
const CROP_PRESETS: { label: string; labelKey?: string; ratio: number | null }[] = [
  { label: '', labelKey: 'studio.image.crop.free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
];

/**
 * 📱 Telefon-optimalizált, CSOPORTOSÍTOTT eszköztár (vízszintesen görgethető) —
 * a lapos 9-elemű sor helyett kategóriák (Hozzáadás / Rendezés / Stílus / Réteg),
 * így a teljes eszközkészlet kézre esik a kis kijelzőn is.
 */
const TOOL_GROUPS: { labelKey: string; tools: Tool[] }[] = [
  {
    labelKey: 'studio.imageGroups.add',
    tools: [
      { key: 'photo', icon: 'image-outline', labelKey: 'studio.imageTools.photo' },
      { key: 'text', icon: 'text-outline', labelKey: 'studio.imageTools.text' },
      { key: 'shape', icon: 'shapes-outline', labelKey: 'studio.imageTools.shape' },
      { key: 'pen', icon: 'pencil-outline', labelKey: 'studio.imageTools.pen' },
      { key: 'lasso', icon: 'ellipse-outline', labelKey: 'studio.imageTools.lasso' },
      { key: 'wand', icon: 'color-wand-outline', labelKey: 'studio.imageTools.wand' },
      { key: 'brush', icon: 'brush-outline', labelKey: 'studio.imageTools.brush' },
      { key: 'svg', icon: 'download-outline', labelKey: 'studio.imageTools.svg' },
    ],
  },
  {
    labelKey: 'studio.imageGroups.arrange',
    tools: [
      { key: 'crop', icon: 'crop-outline', labelKey: 'studio.imageTools.crop' },
      { key: 'guides', icon: 'grid-outline', labelKey: 'studio.imageTools.guides' },
      { key: 'align', icon: 'magnet-outline', labelKey: 'studio.imageTools.align' },
      { key: 'boolean', icon: 'git-merge-outline', labelKey: 'studio.imageTools.boolean' },
      { key: 'rotate', icon: 'refresh-outline', labelKey: 'studio.imageTools.rotate' },
      { key: 'flipH', icon: 'swap-horizontal-outline', labelKey: 'studio.imageTools.flipH' },
      { key: 'flipV', icon: 'swap-vertical-outline', labelKey: 'studio.imageTools.flipV' },
      { key: 'forward', icon: 'chevron-up-outline', labelKey: 'studio.imageTools.forward' },
      { key: 'back', icon: 'chevron-down-outline', labelKey: 'studio.imageTools.back' },
    ],
  },
  {
    labelKey: 'studio.imageGroups.style',
    tools: [
      { key: 'style', icon: 'options-outline', labelKey: 'studio.imageTools.style' },
      { key: 'fx', icon: 'sparkles-outline', labelKey: 'studio.imageTools.fx' },
      { key: 'pattern', icon: 'grid-outline', labelKey: 'studio.imageTools.pattern' },
      { key: 'adjust', icon: 'contrast-outline', labelKey: 'studio.imageTools.adjust' },
    ],
  },
  {
    labelKey: 'studio.imageGroups.layer',
    tools: [
      { key: 'layers', icon: 'layers-outline', labelKey: 'studio.imageTools.layers' },
      { key: 'duplicate', icon: 'copy-outline', labelKey: 'studio.imageTools.duplicate' },
      { key: 'delete', icon: 'trash-outline', labelKey: 'studio.imageTools.delete' },
    ],
  },
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
  onExit,
  onSave,
}: {
  mode: 'project' | 'scoped';
  title: string;
  docId?: string;
  onExit: () => void;
  onSave?: (doc: ImageDoc, renderedUri: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<
    | 'layers'
    | 'style'
    | 'adjust'
    | 'fx'
    | 'pattern'
    | 'align'
    | 'boolean'
    | 'shapePicker'
    | 'canvas'
    | 'source'
    | 'export'
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[] | null>(null);
  const [pathEditId, setPathEditId] = useState<string | null>(null);
  const [pathEditNode, setPathEditNode] = useState<number | null>(null);
  const [lassoActive, setLassoActive] = useState(false);
  // 🎭 ha be van állítva, a következő lasszó-rajz NEM új formát, hanem erre a rétegre MASZKOT készít
  const [maskTargetId, setMaskTargetId] = useState<string | null>(null);
  const [wandActive, setWandActive] = useState(false);
  const [brushActive, setBrushActive] = useState(false);
  const [brushColor, setBrushColor] = useState('#ff2d95');
  const [brushSize, setBrushSize] = useState(8);
  const [guidesActive, setGuidesActive] = useState(false);
  const brushRef = useRef<BrushHandle>(null);
  const canvasRef = useRef<View>(null);

  /**
   * 🖼️ A dokumentum PNG-vé raszterizálása. ELSŐ a worker-Chromium (teljes
   * felbontás, pontos), és ha az nem elérhető (weben, vagy nem fut a render-worker),
   * ESZKÖZÖN a vászon `captureRef`-je a fallback — így a MENTÉS worker nélkül is
   * működik (offline/Expo Go). A kijelölés-króm elrejtve, hogy ne kerüljön a képbe.
   */
  const rasterize = async (
    doc: ImageDoc,
    opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number }
  ): Promise<string | null> => {
    const viaWorker = await renderImageDoc(doc, opts?.height ?? doc.height ?? 1280, {
      format: opts?.format,
      quality: opts?.quality,
    });
    if (viaWorker) {
      return viaWorker;
    }
    setCapturing(true);
    await new Promise((r) => setTimeout(r, 90)); // egy render-kör, kijelölés-króm nélkül
    try {
      return await captureRef(canvasRef, { format: 'png', quality: 1 });
    } catch {
      return null;
    } finally {
      setCapturing(false);
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

  const commit = (next: ImageDoc, label?: string) =>
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: next, label });

  // a kijelölés levezetve — ha a réteg eltűnik (törlés/undo), null-ra esik
  const selectedLayer = doc?.layers.find((l) => l.id === selectedId) ?? null;
  const effectiveSelectedId = selectedLayer ? selectedId : null;

  // ── 🖼️📄 Galéria-lapok (project mód): új/duplikál/töröl/mozgat az aktív lapon ──
  const addPage = () => {
    const s = useEditorStore.getState();
    if (!s.project) {
      return;
    }
    const size = effectiveCanvas({ aspectRatio: s.project.aspectRatio });
    const nd = createImageDoc(`Lap ${pages.length + 1}`, s.project.aspectRatio, () => makeId('lyr'), {
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
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: dup, label: `Lap duplikálva: ${dup.name}` });
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
    Alert.alert(t('common.delete'), `„${doc.name}" lap törlése?`, [
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
            position: { x: 0.5, y: 0.5 },
            stylePreset: 'outline',
          }
        : kind === 'fill'
          ? { kind: 'fill', id, fill: '#12121a' }
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
          : ({ ...base, shape, w: 0.4, h: 0.4 } as ShapeLayer);
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
      const { layers } = parseSvg(svg);
      if (layers.length === 0) {
        Alert.alert(t('studio.image.svgFailTitle'), t('studio.image.svgFailBody'));
        return;
      }
      let next = doc;
      for (const l of layers) {
        next = addLayer(next, l);
      }
      commit(next, t('studio.image.undoImportSvg'));
      setSelectedId(layers[layers.length - 1].id);
      setSheet('layers');
    } catch {
      Alert.alert(t('studio.image.svgFailTitle'), t('studio.image.svgFailBody'));
    } finally {
      setBusy(false);
    }
  };

  const onTool = (key: ToolKey) => {
    if (!doc) {
      return;
    }
    switch (key) {
      case 'layers':
        setSheet('layers');
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
      case 'lasso':
        // 🪢 lasszó-mód: szabadkézi húzás → zárt path-forma (más módok bezárva)
        setSheet(null);
        setSelectedId(null);
        setCropRect(null);
        setPenPoints(null);
        setPathEditId(null);
        setWandActive(false);
        setLassoActive(true);
        break;
      case 'wand':
        // 🪄 varázspálca-mód: fotóra koppintva szín-szelekció (Skia)
        setSheet(null);
        setSelectedId(null);
        setCropRect(null);
        setPenPoints(null);
        setPathEditId(null);
        setLassoActive(false);
        setBrushActive(false);
        setWandActive(true);
        break;
      case 'brush':
        // 🖌️ ecset-mód: Skia raszter-festés → snapshot fotó-rétegként. A Skia-függő
        // overlay-t előbb LEPROBÁLJUK betölteni; ha a natív modul hiányzik (régi
        // dev-kliens), barátságos üzenet jön a lazy-reject crash HELYETT.
        void (async () => {
          try {
            await import('@/components/studio/image/BrushOverlay');
          } catch {
            Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.skiaMissing'));
            return;
          }
          setSheet(null);
          setSelectedId(null);
          setCropRect(null);
          setPenPoints(null);
          setPathEditId(null);
          setLassoActive(false);
          setWandActive(false);
          setBrushActive(true);
        })();
        break;
      case 'pen':
        // ✏️ kijelölt path-forma → NODE-szerkesztő; különben ÚJ toll-rajz (üres path)
        if (
          selectedLayer?.kind === 'shape' &&
          selectedLayer.shape === 'path' &&
          (selectedLayer.points?.length ?? 0) >= 2
        ) {
          setSheet(null);
          setCropRect(null);
          setPenPoints(null);
          setPathEditNode(null);
          setPathEditId(selectedLayer.id);
        } else {
          setSheet(null);
          setSelectedId(null);
          setCropRect(null);
          setPathEditId(null);
          setPenPoints([]);
        }
        break;
      case 'svg':
        void importSvg();
        break;
      case 'style':
        // 🎛️ a kijelölt réteg gazdag tulajdonság-lapja KÖZVETLENÜL (felfedezhetőség)
        if (selectedLayer) {
          setSheet('style');
        } else {
          Alert.alert(t('studio.image.style.needTitle'), t('studio.image.style.needBody'));
        }
        break;
      case 'adjust':
        if (selectedLayer?.kind === 'photo') {
          setSheet('adjust');
        } else {
          Alert.alert(t('studio.image.needPhotoTitle'), t('studio.image.needPhotoBody'));
        }
        break;
      case 'fx':
        // ✨ réteg-effektek (ragyogás/árnyék/körvonal) — csak forma-rétegre
        if (selectedLayer?.kind === 'shape') {
          setSheet('fx');
        } else {
          Alert.alert(t('studio.image.fx.needTitle'), t('studio.image.fx.needBody'));
        }
        break;
      case 'pattern':
        // 🧩 geometrikus csempe-minta — csak forma-rétegre
        if (selectedLayer?.kind === 'shape') {
          setSheet('pattern');
        } else {
          Alert.alert(t('studio.image.pattern.needTitle'), t('studio.image.pattern.needBody'));
        }
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
        if (canAlignLayer(selectedLayer)) {
          setSheet('align');
        } else {
          Alert.alert(t('studio.image.align.needLayerTitle'), t('studio.image.align.needLayerBody'));
        }
        break;
      case 'boolean':
        if (canBoolean(doc, effectiveSelectedId)) {
          setSheet('boolean');
        } else {
          Alert.alert(t('studio.image.boolean.needTitle'), t('studio.image.boolean.needBody'));
        }
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

  // melyik eszköz legyen letiltva (kijelölés/réteg-fajta szerint)
  const toolDisabled = (key: ToolKey): boolean => {
    switch (key) {
      case 'delete':
      case 'duplicate':
      case 'forward':
      case 'back':
        return !selectedLayer;
      case 'rotate':
      case 'flipH':
      case 'flipV':
        return !selectedLayer || selectedLayer.kind === 'fill';
      case 'style':
        return !selectedLayer;
      case 'adjust':
        return selectedLayer?.kind !== 'photo';
      case 'align':
        return !canAlignLayer(selectedLayer);
      case 'boolean':
        return !canBoolean(doc, effectiveSelectedId);
      default:
        return false;
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
    box: { position: { x: number; y: number }; w: number; h: number }
  ) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        // Skia-függő mag → lustán töltjük; ha a natív modul hiányzik, a catch kezeli
        const { magicWandSelect } = await import('@/lib/magicWandClient');
        const outline = await magicWandSelect(uri, u, v);
        if (outline && outline.length >= 3 && doc) {
          const shape: ShapeLayer = {
            kind: 'shape',
            id: makeId('lyr'),
            shape: 'path',
            points: outline,
            closed: true,
            position: box.position,
            w: box.w,
            h: box.h,
            fill: '#7c5cff',
            opacity: 0.5,
          };
          commit(addLayer(doc, shape), t('studio.image.undoWand'));
          setSelectedId(shape.id);
        } else {
          Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.wand.failBody'));
        }
      } catch {
        // a @shopify/react-native-skia natív modul hiányzik a dev-kliensből → új build kell
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.skiaMissing'));
      } finally {
        setBusy(false);
        setWandActive(false);
      }
    })();
  };

  // 🖌️ ecset: a Skia-festés pillanatképe PNG-fájlként → FOTÓ-réteg a vásznon
  const commitBrush = () => {
    if (doc && brushRef.current?.hasStrokes()) {
      const uri = brushRef.current.exportPng();
      if (uri) {
        const l: PhotoLayer = {
          kind: 'photo',
          id: makeId('lyr'),
          uri,
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

  // 🎭 lasszó-maszk indítása a kijelölt rétegre: a következő lasszó-rajz maszkot készít
  const startMaskDraw = (layerId: string) => {
    setSelectedId(layerId);
    setMaskTargetId(layerId);
    setLassoActive(true);
    setSheet(null); // a panel bezárul, hogy a vászon látsszon a rajzoláshoz
  };

  // 🪢 lasszó: a szabadkézi pontokból ZÁRT path-forma — VAGY (maszk-módban) a kijelölt réteg maszkja
  const commitLasso = (points: CanvasPoint[]) => {
    if (doc && points.length >= 3 && maskTargetId) {
      // 🎭 szelekció → réteg-maszk (poligon): a vászon-normalizált pontok + bbox
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const mask: ClipMask = {
        shape: 'polygon',
        points: points.map((p) => ({ x: p.x, y: p.y })),
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        w: Math.max(0.02, maxX - minX),
        h: Math.max(0.02, maxY - minY),
        feather: 0.02,
      };
      commit(updateLayer(doc, maskTargetId, { mask } as Partial<ImageLayer>), t('studio.image.undoMask', { defaultValue: 'Maszk' }));
      setMaskTargetId(null);
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
    setMaskTargetId(null);
    setLassoActive(false);
  };

  // ✏️ v3: a KIJELÖLT node típusa (görbe/sarok) — bezier-fogók létrehozása/törlése
  const pe = pathEditId && doc ? doc.layers.find((l) => l.id === pathEditId) ?? null : null;
  const pathEditShape = pe && pe.kind === 'shape' && pe.shape === 'path' ? pe : null;
  const setNodeKind = (type: 'smooth' | 'corner') => {
    if (doc && pathEditShape?.points && pathEditNode != null) {
      commit(
        updateLayer(doc, pathEditShape.id, {
          points: setNodeType(pathEditShape.points, pathEditNode, type, !!pathEditShape.closed),
        }),
        type === 'corner' ? 'node-corner' : 'node-smooth'
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
        Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
        return;
      }
      commit({ ...doc, renderedUri: uri }, 'render');
      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare) {
        await Sharing.shareAsync(uri).catch(() => {});
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
          } catch {
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
      } catch {
        // a write úgyis felülírja
      }
      file.write(svg);
      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'image/svg+xml', dialogTitle: t('studio.export') }).catch(() => {});
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
      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('studio.export') }).catch(() => {});
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
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
        Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
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
  const shareToFeed = async (shareMode: ImageShareMode) => {
    const s = useEditorStore.getState();
    if (!s.project || busy) {
      return;
    }
    setBusy(true);
    try {
      for (const p of pages) {
        if (!p.renderedUri) {
          const uri = await rasterize(p);
          if (uri) {
            s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: { ...p, renderedUri: uri } });
          }
        }
      }
      const fresh = useEditorStore.getState().project;
      if (!fresh) {
        return;
      }
      await publishImageProject(fresh, shareMode, { visibility: 'public' });
      Alert.alert(
        t('studio.image.shareFeed.doneTitle', { defaultValue: 'Megosztva' }),
        t('studio.image.shareFeed.doneBody', { defaultValue: 'A poszt felkerült a feedbe.' })
      );
    } catch (e) {
      Alert.alert(t('common.error', { defaultValue: 'Hiba' }), (e as Error).message);
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

  if (!project) {
    return null;
  }

  return (
    <View style={styles.root}>
      {/* felső sáv */}
      <View style={styles.topBar}>
        <Pressable onPress={onExit} hitSlop={10} style={styles.topBtn}>
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
            onPress={() => setSheet('source')}
            hitSlop={8}
            style={styles.canvasBtn}
            accessibilityRole="button"
            accessibilityLabel={t('source.title')}
          >
            <Ionicons name="folder-open-outline" size={15} color={palette.textDim} />
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
      {mode === 'project' && pages.length > 0 ? (
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
                  {p.renderedUri ? (
                    <Image source={{ uri: p.renderedUri }} style={styles.pageThumb} resizeMode="cover" />
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

      {/* vászon */}
      {doc ? (
        <ImageCanvas
          doc={doc}
          selectedId={effectiveSelectedId}
          onSelect={setSelectedId}
          onRequestEdit={(id) => {
            setSelectedId(id);
            setSheet('layers');
          }}
          commit={commit}
          canvasRef={canvasRef}
          capturing={capturing}
          cropRect={cropRect}
          onCropRectChange={setCropRect}
          penPoints={penPoints}
          onPenAddPoint={(p) => setPenPoints((prev) => [...(prev ?? []), p])}
          onPenClose={() => commitPen(true)}
          pathEditId={pathEditId}
          selectedNode={pathEditNode}
          onSelectNode={setPathEditNode}
          lassoActive={lassoActive}
          onLassoComplete={commitLasso}
          onLassoCancel={() => {
            setLassoActive(false);
            setMaskTargetId(null);
          }}
          wandActive={wandActive}
          onWandSeed={onWandSeed}
          brushActive={brushActive}
          brushColor={brushColor}
          brushSize={brushSize}
          brushRef={brushRef}
          guidesActive={guidesActive}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.accent} />
        </View>
      )}

      {/* kijelölés-jelző */}
      <View style={styles.statusRow}>
        <Ionicons
          name={selectedLayer ? 'ellipse' : 'ellipse-outline'}
          size={9}
          color={selectedLayer ? palette.accent : palette.textDim}
        />
        <Text style={styles.statusText} numberOfLines={1}>
          {guidesActive
            ? t('studio.image.guides.hint')
            : brushActive
            ? t('studio.image.brush.hint')
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
                active={false}
                onPress={() => doc && setCropRect(aspectCropRect(doc, p.ratio))}
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
          {/* ✏️ v3: a kijelölt node görbévé / sarokká (bezier-fogók) */}
          <Pressable
            onPress={() => setNodeKind('smooth')}
            style={[styles.penClose, pathEditNode == null ? styles.penDisabled : null]}
            hitSlop={6}
            disabled={pathEditNode == null}
          >
            <Text style={styles.penCloseText}>{t('studio.image.pen.smooth')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setNodeKind('corner')}
            style={[styles.penClose, pathEditNode == null ? styles.penDisabled : null]}
            hitSlop={6}
            disabled={pathEditNode == null}
          >
            <Text style={styles.penCloseText}>{t('studio.image.pen.corner')}</Text>
          </Pressable>
          <Pressable onPress={() => setPathEditId(null)} style={styles.cropApply} hitSlop={6}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.cropApplyText}>{t('common.done')}</Text>
          </Pressable>
        </View>
      ) : lassoActive ? (
        /* 🪢 lasszó-sáv (húzás a vásznon rajzol; felengedésre zár) */
        <View style={styles.cropBar}>
          <Pressable onPress={() => setLassoActive(false)} style={styles.cropBtn} hitSlop={6}>
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
          <Text style={styles.lassoLabel} numberOfLines={1}>
            {t('studio.image.wand.hint')}
          </Text>
        </View>
      ) : brushActive ? (
        /* 🖌️ ecset-sáv (szín + méret + Kész) */
        <View style={styles.cropBar}>
          <Pressable onPress={() => setBrushActive(false)} style={styles.cropBtn} hitSlop={6}>
            <Ionicons name="close" size={20} color={palette.text} />
          </Pressable>
          <View style={styles.brushRow}>
            {BRUSH_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setBrushColor(c)}
                style={[styles.brushDot, { backgroundColor: c }, brushColor === c ? styles.brushDotActive : null]}
              />
            ))}
          </View>
          <View style={styles.brushRow}>
            {BRUSH_SIZES.map((s) => (
              <Pressable
                key={s}
                onPress={() => setBrushSize(s)}
                style={[styles.brushSizeBtn, brushSize === s ? styles.brushSizeActive : null]}
              >
                <View style={{ width: s * 0.7 + 3, height: s * 0.7 + 3, borderRadius: 99, backgroundColor: palette.text }} />
              </Pressable>
            ))}
          </View>
          <Pressable onPress={commitBrush} style={styles.cropApply} hitSlop={6}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.cropApplyText}>{t('common.done')}</Text>
          </Pressable>
        </View>
      ) : guidesActive ? (
        /* 📐 vonalzók/segédvonalak sáv (Harmadok / Törlés + kilépés) */
        <View style={styles.cropBar}>
          <Pressable onPress={() => setGuidesActive(false)} style={styles.cropBtn} hitSlop={6}>
            <Ionicons name="close" size={20} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={() => doc && commit({ ...doc, guides: compositionGuides() }, t('studio.image.undoGuides'))}
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
      ) : (
      /* 📱 telefon-optimalizált, csoportosított, vízszintesen görgethető eszköztár */
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolBar}
        contentContainerStyle={styles.toolBarContent}
      >
        {TOOL_GROUPS.map((group, gi) => (
          <View key={group.labelKey} style={styles.toolGroupRow}>
            <View style={styles.toolGroup}>
              <Text style={styles.groupLabel}>{t(group.labelKey)}</Text>
              <View style={styles.groupTools}>
                {group.tools.map((tool) => {
                  const disabled = toolDisabled(tool.key);
                  const danger = tool.key === 'delete';
                  const color = disabled ? palette.border : danger ? palette.danger : palette.textDim;
                  return (
                    <Pressable
                      key={tool.key}
                      style={styles.tool}
                      onPress={() => onTool(tool.key)}
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityLabel={t(tool.labelKey)}
                    >
                      <Ionicons name={tool.icon} size={22} color={color} />
                      <Text
                        style={[styles.toolLabel, { color: disabled ? palette.border : palette.textDim }]}
                        numberOfLines={1}
                      >
                        {t(tool.labelKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {gi < TOOL_GROUPS.length - 1 ? <View style={styles.groupDivider} /> : null}
          </View>
        ))}
      </ScrollView>
      )}

      {sheet === 'layers' && doc ? (
        <LayerPanel
          doc={doc}
          selectedId={effectiveSelectedId}
          onSelect={setSelectedId}
          onAdd={add}
          commit={commit}
          onClose={() => setSheet(null)}
          onOpenAdjust={() => {
            if (selectedLayer?.kind === 'photo') {
              setSheet('adjust');
            }
          }}
          onDrawMask={startMaskDraw}
        />
      ) : null}
      {sheet === 'style' && doc && selectedLayer ? (
        <LayerStyleSheet
          doc={doc}
          layer={selectedLayer}
          commit={commit}
          onOpenAdjust={() => {
            if (selectedLayer.kind === 'photo') {
              setSheet('adjust');
            }
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'adjust' && doc && selectedLayer?.kind === 'photo' ? (
        <AdjustStackSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'fx' && doc && selectedLayer?.kind === 'shape' ? (
        <EffectsSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'pattern' && doc && selectedLayer?.kind === 'shape' ? (
        <PatternSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'align' && doc && selectedLayer && canAlignLayer(selectedLayer) ? (
        <AlignSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'boolean' && doc && effectiveSelectedId && canBoolean(doc, effectiveSelectedId) ? (
        <BooleanSheet
          doc={doc}
          selectedId={effectiveSelectedId}
          commit={commit}
          onResult={setSelectedId}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'shapePicker' && doc ? (
        <ShapePickerSheet onPick={addShapeType} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'canvas' && doc ? (
        <CanvasSheet doc={doc} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'source' ? (
        <SourceSheet onInsert={insertSource} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'export' && doc ? (
        <ExportSheet
          doc={doc}
          busy={busy}
          pageCount={mode === 'project' ? pages.length : 1}
          onRaster={(o) => void exportImage(o)}
          onSvg={() => void exportSvg()}
          onPdf={() => void exportPdf()}
          onVideo={() => void insertIntoVideo()}
          onShareSlideshow={mode === 'project' ? () => void shareToFeed('slideshow') : undefined}
          onShareCarousel={mode === 'project' ? () => void shareToFeed('carousel') : undefined}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
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
  pageActionBtn: { padding: 6 },
  topBtn: { padding: 2 },
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
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  statusText: { flex: 1, color: palette.textDim, fontSize: 11, fontWeight: '600' },
  toolBar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    flexGrow: 0,
  },
  toolBarContent: {
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 8,
  },
  toolGroupRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  toolGroup: {
    paddingHorizontal: 6,
  },
  groupLabel: {
    color: palette.textDim,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginLeft: 6,
    marginBottom: 2,
    opacity: 0.7,
  },
  groupTools: {
    flexDirection: 'row',
  },
  groupDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: palette.border,
    marginVertical: 4,
    marginHorizontal: 2,
  },
  tool: { width: 60, alignItems: 'center', gap: 4, paddingVertical: 2 },
  toolLabel: { fontSize: 10, fontWeight: '600' },
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
    width: 40,
    height: 40,
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
  brushDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: palette.border },
  brushDotActive: { borderColor: palette.text, borderWidth: 3 },
  brushSizeBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brushSizeActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}22` },
});
