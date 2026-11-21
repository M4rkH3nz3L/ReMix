import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/profile/storage/storageStyles';
import { palette } from '@/constants/editor';

/** ➖➕ egész-léptető (a StorageCard.tsx-ből kiemelve) */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="remove" size={16} color={palette.text} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="add" size={16} color={palette.text} />
      </Pressable>
    </View>
  );
}
