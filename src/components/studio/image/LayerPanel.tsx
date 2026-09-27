import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import {
  duplicateLayer,
  layerIcon,
  layerLabel,
  removeLayer,
  reorderLayer,
  toggleLayerHidden,
  updateLayer,
} from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import type {
  BlendMode,
  FillLayer,
  ImageDoc,
  ImageLayer,
  PhotoLayer,
  ShapeLayer,
  TextLayer,
} from '@/types/project';

const BLENDS: (BlendMode | 'normal')[] = ['normal', 'multiply', 'screen', 'overlay', 'softlight'];
const SHAPES: ShapeLayer['shape'][] = ['rectangle', 'ellipse', 'line', 'arrow', 'star'];

/**
 * 🎨 Réteg-panel (alsó lap) — a réteg-fa listája (sorrend/láthatóság/duplázás/
 * törlés) + a kijelölt réteg tulajdonság-szerkesztője (szín, betűméret, kitöltés,
 * blend, átlátszóság, forgatás). Minden módosítás a command-buson (undo).
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

      {/* kijelölt réteg tulajdonságai */}
      {layer ? (
        <View style={styles.inspector}>
          <Text style={styles.inspectorTitle}>{layerLabel(layer)}</Text>

          {layer.kind === 'text' ? (
            <>
              <TextInput
                style={styles.textInput}
                value={layer.text}
                onChangeText={(text) =>
                  commit(updateLayer<TextLayer>(doc, layer.id, { text }), t('studio.image.undoText'))
                }
                placeholder={t('studio.image.newText')}
                placeholderTextColor={palette.textDim}
                multiline
              />
              <ColorField
                label={t('studio.image.color')}
                value={layer.color}
                onChange={(color) => commit(updateLayer<TextLayer>(doc, layer.id, { color }))}
              />
              <Slider
                label={t('studio.image.fontSize')}
                value={layer.fontSize}
                min={2}
                max={40}
                onChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { fontSize: v }))}
                format={(v) => `${v.toFixed(1)}%`}
              />
              <View style={styles.chipRow}>
                {(['plain', 'outline', 'neon', 'bubble'] as const).map((p) => (
                  <Chip
                    key={p}
                    label={t(`studio.image.preset.${p}`)}
                    active={(layer.stylePreset ?? 'plain') === p}
                    onPress={() => commit(updateLayer<TextLayer>(doc, layer.id, { stylePreset: p }))}
                  />
                ))}
              </View>
              <ToggleRow
                icon="text"
                label={t('studio.image.bold')}
                value={layer.fontWeight === 'bold'}
                onValueChange={(v) =>
                  commit(updateLayer<TextLayer>(doc, layer.id, { fontWeight: v ? 'bold' : 'normal' }))
                }
              />
              <Slider
                label={t('studio.image.tracking')}
                value={layer.letterSpacing ?? 0}
                min={-0.05}
                max={0.5}
                onChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { letterSpacing: v }))}
                format={(v) => v.toFixed(2)}
              />
              <Slider
                label={t('studio.image.leading')}
                value={layer.lineHeight ?? 1.2}
                min={0.8}
                max={2.5}
                onChange={(v) => commit(updateLayer<TextLayer>(doc, layer.id, { lineHeight: v }))}
                format={(v) => v.toFixed(2)}
              />
              <ToggleRow
                icon="ellipse-outline"
                label={t('studio.image.outline')}
                value={!!layer.textStyle?.stroke}
                onValueChange={(v) =>
                  commit(
                    updateLayer<TextLayer>(doc, layer.id, {
                      textStyle: {
                        ...layer.textStyle,
                        stroke: v ? { color: '#000000', width: 0.06 } : undefined,
                      },
                    })
                  )
                }
              />
              {layer.textStyle?.stroke ? (
                <Slider
                  label={t('studio.image.outlineWidth')}
                  value={layer.textStyle.stroke.width}
                  min={0.01}
                  max={0.2}
                  onChange={(v) =>
                    commit(
                      updateLayer<TextLayer>(doc, layer.id, {
                        textStyle: {
                          ...layer.textStyle,
                          stroke: { color: layer.textStyle?.stroke?.color ?? '#000000', width: v },
                        },
                      })
                    )
                  }
                  format={(v) => v.toFixed(2)}
                />
              ) : null}
              <ToggleRow
                icon="contrast"
                label={t('studio.image.shadow')}
                value={!!layer.textStyle?.shadow}
                onValueChange={(v) =>
                  commit(
                    updateLayer<TextLayer>(doc, layer.id, {
                      textStyle: {
                        ...layer.textStyle,
                        shadow: v ? { color: '#000000aa', dx: 0, dy: 0.03, blur: 0.05 } : undefined,
                      },
                    })
                  )
                }
              />
            </>
          ) : null}

          {layer.kind === 'photo' ? (
            <>
              <View style={styles.chipRow}>
                <Chip
                  label={t('studio.image.fitCover')}
                  active={layer.fit !== 'contain'}
                  onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { fit: 'cover' }))}
                />
                <Chip
                  label={t('studio.image.fitContain')}
                  active={layer.fit === 'contain'}
                  onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { fit: 'contain' }))}
                />
                <Chip label={t('studio.image.corrections')} active={false} onPress={onOpenAdjust} />
              </View>
              <Slider
                label={t('studio.image.rotation')}
                value={layer.rotation ?? 0}
                min={-180}
                max={180}
                onChange={(v) =>
                  commit(updateLayer<PhotoLayer>(doc, layer.id, { rotation: Math.round(v) }))
                }
                format={(v) => `${Math.round(v)}°`}
              />
            </>
          ) : null}

          {layer.kind === 'shape' ? (
            <>
              <ColorField
                label={t('studio.image.fill')}
                value={layer.fill}
                onChange={(fill) => commit(updateLayer<ShapeLayer>(doc, layer.id, { fill }))}
              />
              <View style={styles.chipRow}>
                {SHAPES.map((s) => (
                  <Chip
                    key={s}
                    label={t(`studio.image.shape.${s}`)}
                    active={layer.shape === s}
                    onPress={() => commit(updateLayer<ShapeLayer>(doc, layer.id, { shape: s }))}
                  />
                ))}
              </View>
              <View style={styles.chipRow}>
                {BLENDS.map((b) => (
                  <Chip
                    key={b}
                    label={t(`studio.image.blend.${b}`)}
                    active={(layer.blendMode ?? 'normal') === b}
                    onPress={() =>
                      commit(
                        updateLayer<ShapeLayer>(doc, layer.id, {
                          blendMode: b === 'normal' ? undefined : b,
                        })
                      )
                    }
                  />
                ))}
              </View>
              {layer.shape === 'rectangle' ? (
                <Slider
                  label={t('studio.image.cornerRadius')}
                  value={layer.cornerRadius ?? 0}
                  min={0}
                  max={0.5}
                  onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { cornerRadius: v }))}
                  format={(v) => v.toFixed(2)}
                />
              ) : null}
              <Slider
                label={t('studio.image.strokeWidth')}
                value={layer.borderWidth ?? 0}
                min={0}
                max={2}
                onChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { borderWidth: v }))}
                format={(v) => v.toFixed(2)}
              />
              {(layer.borderWidth ?? 0) > 0 ? (
                <ColorField
                  label={t('studio.image.borderColor')}
                  value={layer.borderColor ?? '#ffffff'}
                  onChange={(borderColor) => commit(updateLayer<ShapeLayer>(doc, layer.id, { borderColor }))}
                />
              ) : null}
              <ToggleRow
                icon="contrast"
                label={t('studio.image.shadow')}
                value={!!layer.shadow}
                onValueChange={(v) => commit(updateLayer<ShapeLayer>(doc, layer.id, { shadow: v }))}
              />
              <ToggleRow
                icon="sparkles-outline"
                label={t('studio.image.glow')}
                value={!!layer.glow}
                onValueChange={(v) =>
                  commit(
                    updateLayer<ShapeLayer>(doc, layer.id, {
                      glow: v ? { color: layer.fill, size: 2 } : undefined,
                    })
                  )
                }
              />
            </>
          ) : null}

          {layer.kind === 'fill' ? (
            <ColorField
              label={t('studio.image.fill')}
              value={layer.fill}
              onChange={(fill) => commit(updateLayer<FillLayer>(doc, layer.id, { fill }))}
            />
          ) : null}

          <Slider
            label={t('studio.image.opacity')}
            value={layer.opacity ?? 1}
            min={0.05}
            max={1}
            onChange={(v) => commit(updateLayer(doc, layer.id, { opacity: v }))}
            format={(v) => `${Math.round(v * 100)}%`}
          />
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
  textInput: {
    color: palette.text,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 44,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
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
