import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accentGradient, palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export function Chip({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        active && { backgroundColor: color ?? palette.accent, borderColor: color ?? palette.accent },
        active && styles.chipGlow,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function ColorDot({
  color,
  active,
  onPress,
}: {
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.colorDot,
        { backgroundColor: color },
        active && { borderColor: palette.text, borderWidth: 2 },
      ]}
    />
  );
}

export function Stepper({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable onPress={onDec} style={styles.stepperButton}>
          <Ionicons name="remove" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable onPress={onInc} style={styles.stepperButton}>
          <Ionicons name="add" size={16} color={palette.text} />
        </Pressable>
      </View>
    </View>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function ToolButton({
  icon,
  label,
  onPress,
  active,
  danger,
  disabled,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const L = useLayout();
  const color = disabled
    ? palette.textDim
    : danger
      ? palette.danger
      : active
        ? palette.accent
        : palette.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={[
        styles.toolButton,
        // 44pt-os érintés-minimum (Apple HIG) + méret-osztályhoz igazított szélesség
        { minWidth: L.editor.toolButtonMinWidth, minHeight: L.touchMin },
        active ? styles.toolButtonActive : null,
      ]}
    >
      <Ionicons name={icon} size={L.isCompact ? 20 : 23} color={color} />
      <Text style={[styles.toolLabel, { color, fontSize: L.font(10) }]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
}: {
  label: string;
  onPress: () => void;
  icon?: IoniconName;
}) {
  return (
    <Pressable onPress={onPress} style={styles.primaryPressable}>
      <LinearGradient
        colors={[...accentGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.primaryButton}
      >
        {icon ? <Ionicons name={icon} size={16} color={palette.text} /> : null}
        <Text style={styles.primaryButtonText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: palette.surfaceHigh,
  },
  chipGlow: {
    shadowColor: palette.accent,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  chipText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: palette.text,
  },
  colorDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: palette.border,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  stepperLabel: {
    color: palette.text,
    fontSize: 13,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  stepperValue: {
    color: palette.text,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    minWidth: 48,
    textAlign: 'center',
  },
  section: {
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  toolButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 3,
    borderRadius: 14,
  },
  toolButtonActive: {
    backgroundColor: palette.accentSoft,
  },
  toolLabel: {
    fontWeight: '600',
  },
  primaryPressable: {
    borderRadius: 14,
    shadowColor: palette.accent,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: palette.text,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.2,
  },
});
