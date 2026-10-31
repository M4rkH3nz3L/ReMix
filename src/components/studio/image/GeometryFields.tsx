import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { updateLayer } from '@/lib/imageDoc';
import { applyLayerBoxPx, layerBoxPx, type LayerBoxPx } from '@/lib/imageLayerGeometry';
import type { ImageDoc, PhotoLayer, ShapeLayer } from '@/types/project';

/**
 * 📏 Pontos számértékek a kijelölt rétegre: X/Y/Sz/M képpontban és szög fokban, kapcsolható
 * aránytartással. A mező a szerkesztés végén ír (egy undo-lépés mezőnként).
 */
export function GeometryFields({
  doc,
  layer,
  commit,
}: {
  doc: ImageDoc;
  layer: PhotoLayer | ShapeLayer;
  commit: (next: ImageDoc, label?: string) => void;
}) {
  const { t } = useTranslation();
  const [lockAspect, setLockAspect] = useState(true);
  const canvas = effectiveCanvas(doc);
  const box = layerBoxPx(layer, canvas);
  const set = (key: keyof LayerBoxPx, raw: string) => {
    const value = Number(raw.replace(',', '.'));
    if (Number.isFinite(value) && value !== box[key]) {
      commit(updateLayer(doc, layer.id, applyLayerBoxPx(layer, { [key]: value }, canvas, lockAspect)), `geometry-${key}`);
    }
  };
  const field = (key: keyof LayerBoxPx, label: string) => (
    <View style={styles.field} key={`${key}-${box[key]}`}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        defaultValue={String(box[key])}
        onEndEditing={(e) => set(key, e.nativeEvent.text)}
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        selectTextOnFocus
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
  return (
    <View style={styles.grid}>
      {field('x', 'X')}
      {field('y', 'Y')}
      {field('w', t('studio.image.geometry.width'))}
      {field('h', t('studio.image.geometry.height'))}
      <Pressable
        onPress={() => setLockAspect((v) => !v)}
        style={styles.lock}
        accessibilityRole="switch"
        accessibilityState={{ checked: lockAspect }}
        accessibilityLabel={t('studio.image.geometry.lockAspect')}
      >
        <Ionicons name={lockAspect ? 'link' : 'unlink'} size={16} color={lockAspect ? palette.accent : palette.textDim} />
      </Pressable>
      {field('rotation', t('studio.image.geometry.angle'))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 },
  field: { width: 64, gap: 3 },
  label: { color: palette.textDim, fontSize: 11, fontWeight: '600' },
  input: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    color: palette.text,
    fontSize: 14,
    paddingHorizontal: 8,
  },
  lock: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
