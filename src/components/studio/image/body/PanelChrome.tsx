import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 📎 Fül a munkaterület szélén: az összecsukott sín vagy rétegpanel visszanyitása. Keskeny,
 * hogy a vászonból ne vegyen el, de a találati területe a teljes 44 pont.
 */
export function EdgeTab({
  side,
  icon,
  label,
  onPress,
}: {
  side: 'left' | 'right';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: side === 'left' ? 0 : 16, right: side === 'right' ? 0 : 16 }}
      style={[styles.tab, side === 'left' ? styles.left : styles.right]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tab: {
    position: 'absolute',
    top: '50%',
    marginTop: -32,
    width: 28,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    zIndex: 5,
  },
  left: { left: 0, borderLeftWidth: 0, borderTopRightRadius: 10, borderBottomRightRadius: 10 },
  right: { right: 0, borderRightWidth: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10 },
});
