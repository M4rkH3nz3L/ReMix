import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import type { ShapeLayer } from '@/types/project';

type ShapeKind = Exclude<ShapeLayer['shape'], 'path'>;

const SHAPES: { kind: ShapeKind; icon: keyof typeof Ionicons.glyphMap; labelKey: string }[] = [
  { kind: 'rectangle', icon: 'square-outline', labelKey: 'studio.image.shapes.rectangle' },
  { kind: 'ellipse', icon: 'ellipse-outline', labelKey: 'studio.image.shapes.ellipse' },
  { kind: 'line', icon: 'remove-outline', labelKey: 'studio.image.shapes.line' },
  { kind: 'arrow', icon: 'arrow-forward-outline', labelKey: 'studio.image.shapes.arrow' },
  { kind: 'star', icon: 'star-outline', labelKey: 'studio.image.shapes.star' },
];

/** 🔷 Forma-választó — a vászonra kerülő forma TÍPUSA (nem csak téglalap). */
export function ShapePickerSheet({
  onPick,
  onClose,
}: {
  onPick: (kind: ShapeKind) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StudioSheet title={t('studio.image.shapes.title')} icon="shapes" onClose={onClose}>
      <View style={styles.grid}>
        {SHAPES.map((s) => (
          <Pressable
            key={s.kind}
            style={styles.btn}
            onPress={() => onPick(s.kind)}
            accessibilityRole="button"
            accessibilityLabel={t(s.labelKey)}
          >
            <Ionicons name={s.icon} size={28} color={palette.text} />
            <Text style={styles.label}>{t(s.labelKey)}</Text>
          </Pressable>
        ))}
      </View>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  btn: {
    width: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  label: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
  },
});
