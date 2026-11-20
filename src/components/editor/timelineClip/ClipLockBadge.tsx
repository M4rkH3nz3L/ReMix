import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colorForUser } from '@/lib/collabLive';
import type { ClipLock } from '@/lib/clipLock';

/** 🔒 collab: a klipet MÁS szerkeszti — a tulaj színével és nevével jelölve. */
export function ClipLockBadge({ clipLock }: { clipLock: ClipLock | undefined }) {
  return (
    <View
      style={[styles.lockBadge, { backgroundColor: colorForUser(clipLock!.ownerId) }]}
      accessibilityLabel={clipLock?.ownerName ?? 'locked'}
    >
      <Ionicons name="lock-closed" size={9} color="#fff" />
      {clipLock?.ownerName ? (
        <Text style={styles.lockBadgeText} numberOfLines={1}>
          {clipLock.ownerName}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lockBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: '70%',
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    zIndex: 2,
  },
  lockBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
});
