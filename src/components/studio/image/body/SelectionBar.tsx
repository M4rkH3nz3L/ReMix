import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Slider } from '@/components/studio/audio/primitives';
import { palette } from '@/constants/editor';
import type { Selection, SelectionMode } from '@/lib/selection';

export type SelectTool = 'rect' | 'ellipse' | 'lasso' | 'wand';
export type SelectionAction = 'copy' | 'delete' | 'adjust' | 'mask' | 'shape' | 'export';

const TOOLS: { key: SelectTool; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'rect', icon: 'square-outline' },
  { key: 'ellipse', icon: 'ellipse-outline' },
  { key: 'lasso', icon: 'analytics-outline' },
  { key: 'wand', icon: 'color-wand-outline' },
];
const MODES: SelectionMode[] = ['new', 'add', 'subtract', 'intersect'];
const ACTIONS: { key: SelectionAction; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'copy', icon: 'copy-outline' },
  { key: 'delete', icon: 'trash-outline' },
  { key: 'adjust', icon: 'contrast-outline' },
  { key: 'mask', icon: 'eye-off-outline' },
  { key: 'shape', icon: 'shapes-outline' },
  { key: 'export', icon: 'share-outline' },
];

/** ✂️ A kijelölés sávja: fent az eszköz, alatta a mód, és ha van kijelölés, a vele végezhető műveletek. */
export function SelectionBar({
  tool,
  mode,
  selection,
  canUseLayer,
  canShape,
  onTool,
  onMode,
  onInvert,
  onFeather,
  onAction,
  onClear,
  onDone,
}: {
  tool: SelectTool;
  mode: SelectionMode;
  selection: Selection | null;
  /** van fotó, amin a réteg-művelet dolgozhat */
  canUseLayer: boolean;
  canShape: boolean;
  onTool: (tool: SelectTool) => void;
  onMode: (mode: SelectionMode) => void;
  onInvert: () => void;
  onFeather: (feather: number) => void;
  onAction: (action: SelectionAction) => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const enabled = (a: SelectionAction) => (a === 'adjust' ? true : a === 'shape' ? canShape : canUseLayer);
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Pressable onPress={onClear} style={styles.iconBtn} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('studio.image.select.clear')}>
          <Ionicons name="close" size={18} color={palette.text} />
        </Pressable>
        {TOOLS.map(({ key, icon }) => (
          <Pressable
            key={key}
            onPress={() => onTool(key)}
            style={[styles.iconBtn, tool === key && styles.iconActive]}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t(`studio.image.select.tool.${key}`)}
            accessibilityState={{ selected: tool === key }}
          >
            <Ionicons name={icon} size={18} color={tool === key ? palette.accent : palette.text} />
          </Pressable>
        ))}
        <View style={styles.flex} />
        <Pressable onPress={onDone} style={styles.done} hitSlop={6} accessibilityRole="button">
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => onMode(m)} style={[styles.chip, mode === m && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: mode === m }}>
            <Text style={[styles.chipText, mode === m && styles.chipTextActive]}>{t(`studio.image.select.mode.${m}`)}</Text>
          </Pressable>
        ))}
        {selection ? (
          <Pressable onPress={onInvert} style={[styles.chip, selection.invert && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: selection.invert }}>
            <Text style={[styles.chipText, selection.invert && styles.chipTextActive]}>{t('studio.image.select.invert')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {selection ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {ACTIONS.map(({ key, icon }) => (
              <Pressable
                key={key}
                onPress={() => onAction(key)}
                disabled={!enabled(key)}
                style={[styles.action, !enabled(key) && styles.disabled]}
                accessibilityRole="button"
                accessibilityState={{ disabled: !enabled(key) }}
              >
                <Ionicons name={icon} size={16} color={palette.text} />
                <Text style={styles.chipText}>{t(`studio.image.select.action.${key}`)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Slider label={t('studio.image.select.feather')} value={selection.feather} min={0} max={0.1} onChange={onFeather} format={(v) => `${Math.round(v * 1000) / 10}%`} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 10, paddingVertical: 6, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, backgroundColor: palette.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: `${palette.accent}22` },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.accent, borderRadius: 10, paddingHorizontal: 12, height: 36 },
  doneText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  chips: { alignItems: 'center', gap: 6 },
  chip: { paddingHorizontal: 12, height: 30, borderRadius: 15, borderWidth: 1, borderColor: palette.border, justifyContent: 'center' },
  chipActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}22` },
  chipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: palette.accent },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 32, borderRadius: 10, backgroundColor: palette.border },
  disabled: { opacity: 0.35 },
});
