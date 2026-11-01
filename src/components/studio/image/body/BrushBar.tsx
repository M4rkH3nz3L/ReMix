import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Slider } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { palette } from '@/constants/editor';
import type { BrushSettings } from '@/lib/brushEngine';

const COLORS = ['#ffffff', '#0b0b18', '#ff2d95', '#ffd166', '#39d98a', '#4d9dff'];
const percent = (v: number) => `${Math.round(v * 100)}%`;

/** 🖌️ Az ecset beállításai: telefonon és tableten ugyanaz; a ritkább csúszkák lenyithatók, hogy a vászon nagy maradjon. */
export function BrushBar({
  brush,
  onChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCancel,
  onDone,
}: {
  brush: BrushSettings;
  onChange: (patch: Partial<BrushSettings>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [more, setMore] = useState(false);
  const [custom, setCustom] = useState(false);
  const icon = (name: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, active = false, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.iconBtn, active && styles.iconActive, disabled && styles.disabled]}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
    >
      <Ionicons name={name} size={18} color={active ? palette.accent : palette.text} />
    </Pressable>
  );
  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        {icon('close', t('common.cancel'), onCancel)}
        {icon('brush-outline', t('studio.image.brushBar.paint'), () => onChange({ eraser: false }), !brush.eraser)}
        {icon('remove-circle-outline', t('studio.image.brushBar.eraser'), () => onChange({ eraser: true }), brush.eraser)}
        {icon('arrow-undo', t('studio.image.brushBar.undo'), onUndo, false, !canUndo)}
        {icon('arrow-redo', t('studio.image.brushBar.redo'), onRedo, false, !canRedo)}
        {icon('options-outline', t('studio.image.brushBar.more'), () => setMore((m) => !m), more)}
        <View style={styles.flex} />
        <Pressable onPress={onDone} style={styles.done} hitSlop={6} accessibilityRole="button">
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </View>
      {brush.eraser ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colors}>
          {COLORS.map((c) => (
            <Pressable key={c} onPress={() => onChange({ color: c })} style={styles.dotHit} accessibilityRole="button" accessibilityLabel={c} accessibilityState={{ selected: brush.color === c }}>
              <View style={[styles.dot, { backgroundColor: c }, brush.color === c && styles.dotActive]} />
            </Pressable>
          ))}
          <Pressable onPress={() => setCustom((v) => !v)} style={styles.dotHit} accessibilityRole="button" accessibilityLabel={t('studio.image.brushBar.customColor')} accessibilityState={{ selected: custom }}>
            <View style={[styles.dot, styles.customDot, { backgroundColor: brush.color }]}>
              <Ionicons name="add" size={14} color="#fff" />
            </View>
          </Pressable>
        </ScrollView>
      )}
      {custom && !brush.eraser ? <ColorField label={t('studio.image.brushBar.customColor')} value={brush.color} onChange={(color) => onChange({ color })} /> : null}
      <View style={styles.sliders}>
        <View style={styles.flex}>
          <Slider label={t('studio.image.brushBar.size')} value={brush.size} min={1} max={120} onChange={(size) => onChange({ size: Math.round(size) })} format={(v) => `${Math.round(v)}`} />
        </View>
        <View style={styles.flex}>
          <Slider label={t('studio.image.brushBar.opacity')} value={brush.opacity} min={0.05} max={1} onChange={(opacity) => onChange({ opacity })} format={percent} />
        </View>
      </View>
      {more ? (
        <View style={styles.sliders}>
          <View style={styles.flex}>
            <Slider label={t('studio.image.brushBar.hardness')} value={brush.hardness} min={0} max={1} onChange={(hardness) => onChange({ hardness })} format={percent} />
          </View>
          <View style={styles.flex}>
            <Slider label={t('studio.image.brushBar.smoothing')} value={brush.smoothing} min={0} max={1} onChange={(smoothing) => onChange({ smoothing })} format={percent} />
          </View>
        </View>
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
  disabled: { opacity: 0.35 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.accent, borderRadius: 10, paddingHorizontal: 12, height: 36 },
  doneText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  colors: { alignItems: 'center', gap: 2 },
  dotHit: { padding: 6 },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: palette.border },
  dotActive: { borderWidth: 2, borderColor: palette.accent },
  customDot: { alignItems: 'center', justifyContent: 'center' },
  sliders: { flexDirection: 'row', gap: 12 },
});
