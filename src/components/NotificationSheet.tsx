import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { NotificationType } from '@/lib/notifications';
import { useNotifications } from '@/store/notificationStore';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const TYPE_ICON: Record<NotificationType, IoniconName> = {
  info: 'information-circle-outline',
  comment: 'chatbubble-ellipses-outline',
  invite: 'person-add-outline',
  mention: 'at-outline',
  render: 'film-outline',
  system: 'settings-outline',
};

/** ISO → HH:MM */
function shortTime(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : '';
}

/**
 * 🔔 Értesítés-csengő + badge — a fejlécben. Koppintásra lista modal; egy elemre
 * koppintva olvasottá válik és a `route` deep-linkre navigál (oda jut a user,
 * ahová az értesítés szól). Realtime frissül (notificationStore).
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const items = useNotifications((s) => s.items);
  const unread = useNotifications((s) => s.unread);
  const markOneRead = useNotifications((s) => s.markOneRead);
  const markAll = useNotifications((s) => s.markAll);
  const [open, setOpen] = useState(false);

  const openItem = (id: string, route?: string) => {
    markOneRead(id);
    setOpen(false);
    if (route) {
      router.push(route as Parameters<typeof router.push>[0]);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={styles.bellBtn}
        accessibilityRole="button"
        accessibilityLabel={t('notifications.title')}
      >
        <Ionicons name="notifications-outline" size={20} color={palette.textDim} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.grabber} />
            <View style={styles.head}>
              <Text style={styles.title}>{t('notifications.title')}</Text>
              {unread > 0 ? (
                <Pressable onPress={markAll} hitSlop={6}>
                  <Text style={styles.markAll}>{t('notifications.markAll')}</Text>
                </Pressable>
              ) : null}
            </View>
            {items.length === 0 ? (
              <Text style={styles.empty}>{t('notifications.empty')}</Text>
            ) : (
              <FlatList
                data={items}
                keyExtractor={(n) => n.id}
                style={styles.list}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => (
                  <Pressable
                    style={[styles.row, item.read ? null : styles.rowUnread]}
                    onPress={() => openItem(item.id, item.route)}
                  >
                    <Ionicons
                      name={TYPE_ICON[item.type] ?? 'information-circle-outline'}
                      size={18}
                      color={item.read ? palette.textDim : palette.accent}
                    />
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.body ? (
                        <Text style={styles.rowBody} numberOfLines={2}>
                          {item.body}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.time}>{shortTime(item.createdAt)}</Text>
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: { padding: 4 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: palette.text, fontSize: 18, fontWeight: '800' },
  markAll: { color: palette.accent, fontSize: 12, fontWeight: '700' },
  empty: { color: palette.textDim, fontSize: 13, paddingVertical: 16, textAlign: 'center' },
  list: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowUnread: { backgroundColor: palette.accentSoft },
  rowText: { flex: 1 },
  rowTitle: { color: palette.text, fontSize: 13, fontWeight: '600' },
  rowBody: { color: palette.textDim, fontSize: 12, marginTop: 1 },
  time: { color: palette.textDim, fontSize: 11, fontVariant: ['tabular-nums'] },
});
