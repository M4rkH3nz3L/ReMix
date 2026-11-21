import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/admin/adminStyles';
import { palette } from '@/constants/editor';
import { goBackOrHome } from '@/lib/nav';

/** 🛡️ Az admin-panel fejléce: vissza + cím (REFACTOR: a src/app/admin.tsx Header-je). */
export function AdminHeader({ t }: { t: (k: string) => string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => goBackOrHome()} hitSlop={10} style={{ width: 32 }}>
        <Ionicons name="chevron-back" size={22} color={palette.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{t('admin.title')}</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}
