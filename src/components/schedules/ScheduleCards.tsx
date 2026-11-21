import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import type { IconName } from '@/components/schedules/scheduleMeta';
import { styles } from '@/components/schedules/schedulesStyles';
import { palette } from '@/constants/editor';

/** 🗓️ A render-sor képernyő kis kártyái: összesítő-szám és info-kártya (a src/app/schedules.tsx-ből). */

export function SummaryStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function InfoCard({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.infoCard}>
      <Ionicons name={icon} size={30} color={palette.textDim} />
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.infoBody}>{body}</Text>
      {children}
    </View>
  );
}
