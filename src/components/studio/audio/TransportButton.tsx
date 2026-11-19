import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/editor';

/** Kompakt transport-gomb (ikon és/vagy rövid címke; aktív/tiltott állapot). */
export function TBtn({
  icon,
  label,
  onPress,
  disabled,
  active,
  ...press
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  onLongPress?: () => void;
  onPressOut?: () => void;
  delayLongPress?: number;
  testID?: string;
  /** csak ikonos gombnál kötelező értelme van (VoiceOver/TalkBack) */
  accessibilityLabel?: string;
}) {
  const color = disabled ? palette.border : active ? palette.accent : palette.text;
  return (
    <Pressable
      {...press}
      style={[styles.tBtn, active && styles.tBtnActive]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      {label ? (
        <Text style={[styles.tBtnLabel, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 30, height: 32, paddingHorizontal: 7, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, justifyContent: 'center' },
  tBtnActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}22` },
  tBtnLabel: { fontSize: 11, fontWeight: '800' },
});
