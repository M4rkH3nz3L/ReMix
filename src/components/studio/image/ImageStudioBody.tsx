import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { SourceSheet } from '@/components/SourceSheet';
import { AdjustSheet } from '@/components/studio/image/AdjustSheet';
import { AlignSheet } from '@/components/studio/image/AlignSheet';
import { CanvasSheet } from '@/components/studio/image/CanvasSheet';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { palette } from '@/constants/editor';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { addLayer, createImageDoc, layerLabel, removeLayer } from '@/lib/imageDoc';
import { canAlignLayer } from '@/lib/imageLayerLayout';
import { renderImageDoc } from '@/lib/imageDocClient';
import { makeId } from '@/lib/id';
import { pickImage, pickSvg } from '@/lib/media';
import { parseSvg } from '@/lib/svgImport';
import { createEmptyProject, trackEnd, trackOf } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, ImageClip, ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

const TOOLS: {
  key: 'layers' | 'photo' | 'text' | 'shape' | 'svg' | 'adjust' | 'align' | 'delete';
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
}[] = [
  { key: 'layers', icon: 'layers-outline', labelKey: 'studio.imageTools.layers' },
  { key: 'photo', icon: 'image-outline', labelKey: 'studio.imageTools.photo' },
  { key: 'text', icon: 'text-outline', labelKey: 'studio.imageTools.text' },
  { key: 'shape', icon: 'shapes-outline', labelKey: 'studio.imageTools.shape' },
  { key: 'svg', icon: 'download-outline', labelKey: 'studio.imageTools.svg' },
  { key: 'adjust', icon: 'contrast-outline', labelKey: 'studio.imageTools.adjust' },
  { key: 'align', icon: 'magnet-outline', labelKey: 'studio.imageTools.align' },
  { key: 'delete', icon: 'trash-outline', labelKey: 'studio.imageTools.delete' },
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
  const [sheet, setSheet] = useState<'layers' | 'adjust' | 'align' | 'canvas' | 'source' | null>(null);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
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

  const onTool = (key: (typeof TOOLS)[number]['key']) => {
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
        add('shape');
        break;
      case 'svg':
        void importSvg();
        break;
      case 'adjust':
        if (selectedLayer?.kind === 'photo') {
          setSheet('adjust');
        } else {
          Alert.alert(t('studio.image.needPhotoTitle'), t('studio.image.needPhotoBody'));
        }
        break;
      case 'align':
        if (canAlignLayer(selectedLayer)) {
          setSheet('align');
        } else {
          Alert.alert(t('studio.image.align.needLayerTitle'), t('studio.image.align.needLayerBody'));
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
          {selectedLayer
            ? t('studio.image.selected', { name: layerLabel(selectedLayer) })
            : t('studio.image.tapToSelect')}
        </Text>
      </View>

      {/* eszköz-sor */}
      <View style={styles.toolBar}>
        {TOOLS.map((tool) => {
          const disabled =
            (tool.key === 'delete' && !selectedLayer) ||
            (tool.key === 'adjust' && selectedLayer?.kind !== 'photo');
          const danger = tool.key === 'delete';
          const color = disabled ? palette.border : danger ? palette.danger : palette.textDim;
          return (
            <Pressable
              key={tool.key}
              style={styles.tool}
              onPress={() => onTool(tool.key)}
              disabled={disabled}
            >
              <Ionicons name={tool.icon} size={22} color={color} />
              <Text style={[styles.toolLabel, { color: disabled ? palette.border : palette.textDim }]}>
                {t(tool.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
      {sheet === 'adjust' && doc && selectedLayer?.kind === 'photo' ? (
        <AdjustSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'align' && doc && selectedLayer && canAlignLayer(selectedLayer) ? (
        <AlignSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
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
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    paddingTop: 10,
    paddingBottom: 6,
  },
  tool: { flex: 1, alignItems: 'center', gap: 4 },
  toolLabel: { fontSize: 10, fontWeight: '600' },
});
