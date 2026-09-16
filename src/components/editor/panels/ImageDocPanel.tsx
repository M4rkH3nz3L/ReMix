import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton, Stepper } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import {
  addLayer,
  createImageDoc,
  duplicateLayer,
  layerIcon,
  layerLabel,
  removeLayer,
  reorderLayer,
  toggleLayerHidden,
  updateLayer,
} from '@/lib/imageDoc';
import { renderImageDoc } from '@/lib/imageDocClient';
import { pickImage } from '@/lib/media';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, ImageLayer } from '@/types/project';

const TEXT_COLORS = ['#ffffff', '#ffd166', '#ff2d95', '#00e5ff', '#0b0b18'];

/**
 * 🎨 Kép-dokumentum panel (Creative Canvas V1).
 *
 * A kép itt RÉTEG-FA, nem bitmap: a rétegek sorrendje, láthatósága és
 * tartalma bármikor módosítható, és minden módosítás a command-rétegen megy át
 * (tehát undo-zható). A kirasterizált PNG csak az eredmény — az idővonalra az
 * kerül képklipként, de a dokumentum megmarad, így bármikor újraszerkeszthető.
 */
export function ImageDocPanel() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const docs = project?.imageDocs;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doc = docs?.find((d) => d.id === activeId) ?? docs?.[0] ?? null;
  const layer = doc?.layers.find((l) => l.id === selectedLayer) ?? null;

  /** minden dokumentum-változás EGY parancson megy át → undo működik */
  const commit = (next: ImageDoc, label?: string) => {
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: next, label });
  };

  const createDoc = () => {
    if (!project) {
      return;
    }
    const next = createImageDoc(
      t('panels.imageDoc.docName', { index: (docs?.length ?? 0) + 1 }),
      project.aspectRatio,
      () => makeId('lyr')
    );
    commit(next, t('panels.imageDoc.undoNewDoc'));
    setActiveId(next.id);
    setSelectedLayer(null);
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
        const l: ImageLayer = {
          kind: 'photo',
          id: makeId('lyr'),
          uri: picked.uri,
          position: { x: 0.5, y: 0.5 },
          w: 0.8,
          h: 0.45,
          fit: 'cover',
        };
        commit(addLayer(doc, l), t('panels.imageDoc.undoPhotoLayer'));
        setSelectedLayer(l.id);
      });
      return;
    }
    const id = makeId('lyr');
    const l: ImageLayer =
      kind === 'text'
        ? {
            kind: 'text',
            id,
            text: t('panels.imageDoc.newTextLayerContent'),
            color: '#ffffff',
            backgroundColor: null,
            fontSize: 8,
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
              h: 0.2,
              fill: '#ff2d95',
              cornerRadius: 0.15,
            };
    commit(addLayer(doc, l), t('panels.imageDoc.undoAddLayer', { kind }));
    setSelectedLayer(id);
  };

  /** 🖼️ a kirasterizált kép az idővonalra — a dokumentum megmarad */
  const insertToTimeline = async () => {
    const state = useEditorStore.getState();
    if (!doc || !state.project || busy) {
      return;
    }
    setBusy(true);
    try {
      const uri = await renderImageDoc(doc);
      if (!uri) {
        Alert.alert(
          t('panels.imageDoc.renderFailTitle'),
          t('panels.imageDoc.renderFailMessage')
        );
        return;
      }
      const s2 = useEditorStore.getState();
      s2.addClip(
        'video',
        {
          kind: 'image',
          id: makeId('clip'),
          start: trackEnd(trackOf(s2.project!, 'video')),
          duration: 4,
          uri,
          filterId: 'none',
        },
        { id: makeId('ast'), kind: 'image', uri, provider: 'local', name: doc.name }
      );
      // a friss PNG útja a dokumentumra is felkerül (cache + későbbi frissítés)
      commit({ ...doc, renderedUri: uri }, t('panels.imageDoc.undoImageInserted'));
      Alert.alert(
        t('common.done'),
        t('panels.imageDoc.insertedMessage', { name: doc.name })
      );
    } finally {
      setBusy(false);
    }
  };

  if (!project) {
    return null;
  }

  return (
    <View>
      <PanelSection title={t('panels.imageDoc.sectionDoc')}>
        <View style={styles.row}>
          {(docs ?? []).map((d) => (
            <Chip
              key={d.id}
              label={`${d.name} (${d.layers.length})`}
              active={d.id === doc?.id}
              onPress={() => {
                setActiveId(d.id);
                setSelectedLayer(null);
              }}
            />
          ))}
          <Chip label={t('panels.imageDoc.newDocChip')} active={false} onPress={createDoc} />
        </View>
        {!doc ? (
          <Text style={styles.note}>{t('panels.imageDoc.emptyNote')}</Text>
        ) : null}
      </PanelSection>

      {doc ? (
        <>
          <PanelSection title={t('panels.imageDoc.sectionLayers')}>
            {[...doc.layers].reverse().map((l) => (
              <Pressable
                key={l.id}
                onPress={() => setSelectedLayer(l.id === selectedLayer ? null : l.id)}
                style={[styles.layerRow, l.id === selectedLayer ? styles.layerActive : null]}
              >
                <Text style={styles.layerIcon}>{layerIcon(l)}</Text>
                <Text
                  style={[styles.layerName, l.hidden ? styles.layerHidden : null]}
                  numberOfLines={1}
                >
                  {layerLabel(l)}
                </Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => commit(toggleLayerHidden(doc, l.id), t('panels.imageDoc.undoLayerVisibility'))}
                >
                  <Ionicons
                    name={l.hidden ? 'eye-off-outline' : 'eye-outline'}
                    size={16}
                    color={l.hidden ? palette.textDim : palette.text}
                  />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => commit(reorderLayer(doc, l.id, 1), t('panels.imageDoc.undoLayerForward'))}
                >
                  <Ionicons name="chevron-up" size={16} color={palette.textDim} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => commit(reorderLayer(doc, l.id, -1), t('panels.imageDoc.undoLayerBackward'))}
                >
                  <Ionicons name="chevron-down" size={16} color={palette.textDim} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    commit(duplicateLayer(doc, l.id, () => makeId('lyr')), t('panels.imageDoc.undoLayerDuplicated'))
                  }
                >
                  <Ionicons name="copy-outline" size={15} color={palette.textDim} />
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    commit(removeLayer(doc, l.id), t('panels.imageDoc.undoLayerRemoved'));
                    setSelectedLayer(null);
                  }}
                >
                  <Ionicons name="trash-outline" size={15} color={palette.accent2} />
                </Pressable>
              </Pressable>
            ))}
            <View style={styles.row}>
              <Chip label={t('panels.imageDoc.addText')} active={false} onPress={() => add('text')} />
              <Chip label={t('panels.imageDoc.addShape')} active={false} onPress={() => add('shape')} />
              <Chip label={t('panels.imageDoc.addPhoto')} active={false} onPress={() => add('photo')} />
              <Chip label={t('panels.imageDoc.addFill')} active={false} onPress={() => add('fill')} />
            </View>
          </PanelSection>

          {layer ? (
            <PanelSection title={t('panels.imageDoc.sectionSelected', { name: layerLabel(layer) })}>
              {layer.kind === 'text' ? (
                <>
                  <View style={styles.row}>
                    {TEXT_COLORS.map((c) => (
                      <Pressable
                        key={c}
                        onPress={() => commit(updateLayer(doc, layer.id, { color: c }))}
                        style={[
                          styles.swatch,
                          { backgroundColor: c },
                          layer.color === c ? styles.swatchActive : null,
                        ]}
                      />
                    ))}
                  </View>
                  <Stepper
                    label={t('panels.imageDoc.fontSize')}
                    value={`${layer.fontSize.toFixed(1)}%`}
                    onDec={() =>
                      commit(
                        updateLayer(doc, layer.id, {
                          fontSize: Math.max(2, layer.fontSize - 0.5),
                        })
                      )
                    }
                    onInc={() =>
                      commit(
                        updateLayer(doc, layer.id, {
                          fontSize: Math.min(24, layer.fontSize + 0.5),
                        })
                      )
                    }
                  />
                  <Text style={styles.note}>{t('panels.imageDoc.textEditNote')}</Text>
                </>
              ) : null}
              {layer.kind === 'photo' ? (
                <View style={styles.row}>
                  <Chip
                    label={t('panels.imageDoc.fitCover')}
                    active={layer.fit !== 'contain'}
                    onPress={() => commit(updateLayer(doc, layer.id, { fit: 'cover' }))}
                  />
                  <Chip
                    label={t('panels.imageDoc.fitContain')}
                    active={layer.fit === 'contain'}
                    onPress={() => commit(updateLayer(doc, layer.id, { fit: 'contain' }))}
                  />
                </View>
              ) : null}
              {layer.kind === 'shape' || layer.kind === 'fill' ? (
                <View style={styles.row}>
                  {TEXT_COLORS.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => commit(updateLayer(doc, layer.id, { fill: c }))}
                      style={[
                        styles.swatch,
                        { backgroundColor: c },
                        layer.fill === c ? styles.swatchActive : null,
                      ]}
                    />
                  ))}
                </View>
              ) : null}
              <Stepper
                label={t('panels.imageDoc.opacity')}
                value={`${Math.round((layer.opacity ?? 1) * 100)}%`}
                onDec={() =>
                  commit(
                    updateLayer(doc, layer.id, {
                      opacity: Math.max(0.05, (layer.opacity ?? 1) - 0.1),
                    })
                  )
                }
                onInc={() =>
                  commit(
                    updateLayer(doc, layer.id, {
                      opacity: Math.min(1, (layer.opacity ?? 1) + 0.1),
                    })
                  )
                }
              />
            </PanelSection>
          ) : null}

          <PanelSection title={t('panels.imageDoc.sectionInsert')}>
            <PrimaryButton
              icon="image-outline"
              label={busy ? t('panels.imageDoc.rendering') : t('panels.imageDoc.insertButton')}
              onPress={() => {
                void insertToTimeline();
              }}
            />
            <Text style={styles.note}>{t('panels.imageDoc.insertNote')}</Text>
          </PanelSection>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: 6,
  },
  layerActive: {
    borderColor: palette.accent,
    backgroundColor: `${palette.accent}1a`,
  },
  layerIcon: {
    fontSize: 14,
  },
  layerName: {
    flex: 1,
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
  },
  layerHidden: {
    color: palette.textDim,
    textDecorationLine: 'line-through',
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
  },
  swatchActive: {
    borderColor: palette.text,
    borderWidth: 3,
  },
});
