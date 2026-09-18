import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationSheet } from '@/components/NotificationSheet';
import { palette } from '@/constants/editor';
import { useAuth } from '@/store/authStore';
import { useNotifications } from '@/store/notificationStore';

/**
 * 📱 Alsó navigáció — a TikTok-szerű fő felületek közt vált: FEED (home) ·
 * STUDIO (projektek/létrehozás) · CSATORNA (a saját profilom/posztjaim) ·
 * ÉRTESÍTŐK (értesítés-lista, olvasatlan-badge-dzsel). Az értesítések így
 * esztétikusan a menüben élnek — nem külön a projekt-oldalon. A feeden áttetsző
 * (a videó fölött lebeg), a világos felületeken tömör.
 */

export const BOTTOM_NAV_HEIGHT = 56;

type NavKey = 'feed' | 'studio' | 'channel';

export function BottomNav({ active, translucent }: { active: NavKey; translucent?: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const myId = useAuth((s) => s.user?.id ?? null);
  const unread = useNotifications((s) => s.unread);
  const [notifOpen, setNotifOpen] = useState(false);

  const go = (key: NavKey) => {
    if (key === active) {
      return;
    }
    if (key === 'feed') {
      router.replace('/feed');
    } else if (key === 'studio') {
      router.replace('/');
    } else if (myId) {
      router.replace(`/channel/${myId}`);
    }
  };

  const inactive = translucent ? '#ffffff99' : palette.textDim;
  const tint = (key: NavKey) => (key === active ? (translucent ? '#fff' : palette.accent) : inactive);

  const item = (key: NavKey, icon: React.ComponentProps<typeof Ionicons>['name'], label: string) => (
    <Pressable style={styles.item} onPress={() => go(key)} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={24} color={tint(key)} />
      <Text style={[styles.label, { color: tint(key) }]}>{label}</Text>
    </Pressable>
  );

  // 🔔 az olvasatlan értesítés kiemeli az ikont (accent), a badge a darabszámot mutatja
  const notifColor = unread > 0 ? palette.accent : inactive;

  return (
    <>
      <View
        style={[
          styles.bar,
          {
            height: BOTTOM_NAV_HEIGHT + insets.bottom,
            paddingBottom: insets.bottom,
            backgroundColor: translucent ? 'transparent' : palette.surface,
            borderTopColor: translucent ? 'transparent' : palette.border,
          },
        ]}
      >
        {item('feed', active === 'feed' ? 'play' : 'play-outline', t('nav.feed'))}
        {item('studio', active === 'studio' ? 'grid' : 'grid-outline', t('nav.studio'))}
        {item('channel', active === 'channel' ? 'person' : 'person-outline', t('nav.channel'))}
        <Pressable
          style={styles.item}
          onPress={() => setNotifOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('nav.notifications')}
        >
          <View>
            <Ionicons name="notifications-outline" size={24} color={notifColor} />
            {unread > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.label, { color: notifColor }]}>{t('nav.notifications')}</Text>
        </Pressable>
      </View>

      <NotificationSheet visible={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    zIndex: 20,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 10, fontWeight: '700' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
