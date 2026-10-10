import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LayerInspector } from '@/components/studio/image/LayerInspector';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import {
  duplicateLayer,
  layerIcon,
  layerLabel,
  removeLayer,
  reorderLayer,
  toggleLayerHidden,
} from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import type { ImageDoc, ImageLayer } from '@/types/project';

/**
 * 🎨 Réteg-panel (alsó lap) — a réteg-fa listája (sorrend/láthatóság/duplázás/
 * törlés) + a kijelölt réteg tulajdonság-szerkesztője (a megosztott
 * [LayerInspector](./LayerInspector.tsx): szín, betűméret, kitöltés, blend,
 * átlátszóság, kontúr/árnyék/glow). Minden módosítás a command-buson (undo).
 */
export function LayerPanel({
  doc,
  selectedId,
  onSelect,
  onAdd,
  commit,
  onClose,
  onOpenAdjust,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (kind: ImageLayer['kind']) => void;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
  onOpenAdjust: () => void;
}) {
  const { t } = useTranslation();
  const layer = doc.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <StudioSheet
      title={t('studio.image.layersTitle')}
      icon="layers"
      onClose={onClose}
      footer={
        <View style={styles.addRow}>
          <AddChip icon="text" label={t('studio.imageTools.text')} onPress={() => onAdd('text')} />
          <AddChip icon="shapes" label={t('studio.imageTools.shape')} onPress={() => onAdd('shape')} />
          <AddChip icon="image" label={t('studio.imageTools.photo')} onPress={() => onAdd('photo')} />
          <AddChip icon="color-fill" label={t('studio.imageTools.fill')} onPress={() => onAdd('fill')} />
        </View>
      }
    >
      {/* réteg-lista (fölül a legfelső réteg) */}
      <View style={{ gap: 6 }}>
        {[...doc.layers].reverse().map((l) => {
          const sel = l.id === selectedId;
          return (
            <Pressable
              key={l.id}
              onPress={() => onSelect(sel ? null : l.id)}
              style={[styles.layerRow, sel ? styles.layerActive : null]}
            >
              <Text style={styles.layerIcon}>{layerIcon(l)}</Text>
              <Text style={[styles.layerName, l.hidden ? styles.hidden : null]} numberOfLines={1}>
                {layerLabel(l)}
              </Text>
              <IconBtn
                icon={l.hidden ? 'eye-off-outline' : 'eye-outline'}
                color={l.hidden ? palette.textDim : palette.text}
                onPress={() => commit(toggleLayerHidden(doc, l.id), t('studio.image.undoVisibility'))}
              />
              <IconBtn icon="chevron-up" onPress={() => commit(reorderLayer(doc, l.id, 1))} />
              <IconBtn icon="chevron-down" onPress={() => commit(reorderLayer(doc, l.id, -1))} />
              <IconBtn
                icon="copy-outline"
                onPress={() =>
                  commit(duplicateLayer(doc, l.id, () => makeId('lyr')), t('studio.image.undoDuplicate'))
                }
              />
              <IconBtn
                icon="trash-outline"
                color={palette.accent2}
                onPress={() => {
                  commit(removeLayer(doc, l.id), t('studio.image.undoDelete'));
                  if (sel) {
                    onSelect(null);
                  }
                }}
              />
            </Pressable>
          );
        })}
      </View>

      {/* kijelölt réteg tulajdonságai — a megosztott inspector */}
      {layer ? (
        <View style={styles.inspector}>
          <Text style={styles.inspectorTitle}>{layerLabel(layer)}</Text>
          <LayerInspector doc={doc} layer={layer} commit={commit} onOpenAdjust={onOpenAdjust} />
        </View>
      ) : (
        <Text style={styles.hint}>{t('studio.image.selectHint')}</Text>
      )}
    </StudioSheet>
  );
}

function AddChip({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.addChip} onPress={onPress}>
      <Ionicons name={icon} size={16} color={palette.accent} />
      <Text style={styles.addChipText}>{label}</Text>
    </Pressable>
  );
}

function IconBtn({
  icon,
  color = palette.textDim,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable hitSlop={8} onPress={onPress}>
      <Ionicons name={icon} size={16} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  layerActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}1a` },
  layerIcon: { fontSize: 14 },
  layerName: { flex: 1, color: palette.text, fontSize: 12, fontWeight: '600' },
  hidden: { color: palette.textDim, textDecorationLine: 'line-through' },
  inspector: {
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 12,
    marginTop: 4,
  },
  inspectorTitle: { color: palette.text, fontSize: 13, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  addRow: { flexDirection: 'row', gap: 8 },
  addChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
  },
  addChipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
});
