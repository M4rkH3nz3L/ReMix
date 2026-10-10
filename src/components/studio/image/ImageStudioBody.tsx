import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { SourceSheet } from '@/components/SourceSheet';
import { Chip } from '@/components/ui/controls';
import { AdjustSheet } from '@/components/studio/image/AdjustSheet';
import { AlignSheet } from '@/components/studio/image/AlignSheet';
import { BooleanSheet } from '@/components/studio/image/BooleanSheet';
import { CanvasSheet } from '@/components/studio/image/CanvasSheet';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { LayerStyleSheet } from '@/components/studio/image/LayerStyleSheet';
import { ShapePickerSheet } from '@/components/studio/image/ShapePickerSheet';
import { palette } from '@/constants/editor';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { canBoolean } from '@/lib/imageBoolean';
import { aspectCropRect, type CropRect, cropImageDoc } from '@/lib/imageCrop';
import { type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
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
import { renderImageDoc } from '@/lib/imageDocClient';
import { makeId } from '@/lib/id';
import { pickImage, pickSvg } from '@/lib/media';
import { parseSvg } from '@/lib/svgImport';
import { createEmptyProject, trackEnd, trackOf } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, ImageClip, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

type ToolKey =
  | 'layers'
  | 'photo'
  | 'text'
  | 'shape'
  | 'pen'
  | 'svg'
  | 'style'
  | 'adjust'
  | 'crop'
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
      { key: 'svg', icon: 'download-outline', labelKey: 'studio.imageTools.svg' },
    ],
  },
  {
    labelKey: 'studio.imageGroups.arrange',
    tools: [
      { key: 'crop', icon: 'crop-outline', labelKey: 'studio.imageTools.crop' },
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
  const [sheet, setSheet] = useState<
    'layers' | 'style' | 'adjust' | 'align' | 'boolean' | 'shapePicker' | 'canvas' | 'source' | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [penPoints, setPenPoints] = useState<CanvasPoint[] | null>(null);
  const [pathEditId, setPathEditId] = useState<string | null>(null);
  const canvasRef = useRef<View>(null);

  /**
   * 🖼️ A dokumentum PNG-vé raszterizálása. ELSŐ a worker-Chromium (teljes
   * felbontás, pontos), és ha az nem elérhető (weben, vagy nem fut a render-worker),
   * ESZKÖZÖN a vászon `captureRef`-je a fallback — így a MENTÉS worker nélkül is
   * működik (offline/Expo Go). A kijelölés-króm elrejtve, hogy ne kerüljön a képbe.
   */
  const rasterize = async (doc: ImageDoc): Promise<string | null> => {
    const viaWorker = await renderImageDoc(doc);
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

  const doc =
    mode === 'scoped'
      ? project?.imageDocs?.find((d) => d.id === docId) ?? null
      : project?.imageDocs?.[0] ?? null;

  const commit = (next: ImageDoc, label?: string) =>
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: next, label });

  // a kijelölés levezetve — ha a réteg eltűnik (törlés/undo), null-ra esik
  const selectedLayer = doc?.layers.find((l) => l.id === selectedId) ?? null;
  const effectiveSelectedId = selectedLayer ? selectedId : null;

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
      case 'crop':
        // ✂️ kivágás-mód indítása (a kijelölés + lapok bezárva)
        setSheet(null);
        setSelectedId(null);
        setCropRect(START_CROP);
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

  const exportImage = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const uri = await rasterize(doc);
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

  const openExportMenu = () =>
    Alert.alert(t('studio.export'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.image.exportShare'), onPress: () => void exportImage() },
      { text: t('studio.image.exportToVideo'), onPress: () => void insertIntoVideo() },
    ]);

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
          {pathEditId
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
        /* ✏️ node-szerkesztő sáv (toll v2 — a toolbar HELYETT) */
        <View style={styles.cropBar}>
          <Pressable onPress={() => setPathEditId(null)} style={styles.cropBtn} hitSlop={6}>
            <Ionicons name="close" size={20} color={palette.text} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => setPathEditId(null)} style={styles.cropApply} hitSlop={6}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.cropApplyText}>{t('common.done')}</Text>
          </Pressable>
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
        <AdjustSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
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
});
