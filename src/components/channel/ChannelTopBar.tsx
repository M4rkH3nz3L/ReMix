import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { goBackOrHome } from '@/lib/nav';

/** A csatorna-képernyő fejléce: vissza + @handle (REFACTOR: a src/app/channel/[id].tsx-ből) */
export function ChannelTopBar({ username }: { username: string }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={() => goBackOrHome()} hitSlop={10} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={palette.text} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        @{username}
      </Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 32 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '800' },
});
