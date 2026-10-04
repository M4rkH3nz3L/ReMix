import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { listLiveFollowing, subscribeLiveList, type LiveSession } from '@/lib/live';

/**
 * 🔴 „LIVE now" sáv (Fázis D) — a KÖVETETT hostok épp futó élő adásait mutatja
 * avatar-körökkel; koppintásra a néző-szobába visz. Önálló: a saját adatát tölti
 * (listLiveFollowing) + realtime frissül (subscribeLiveList); ÜRESEN NEM renderel
 * (semmit nem foglal), így bárhova betehető egy sorral (pl. a feed tetejére).
 */
export function LiveNowStrip() {
  const { t } = useTranslation();
  const [live, setLive] = useState<LiveSession[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => {
      listLiveFollowing()
        .then((rows) => active && setLive(rows))
        .catch(() => {});
    };
    load();
    const unsub = subscribeLiveList(load); // insert/update a live_sessions-ön → újratöltés
    return () => {
      active = false;
      unsub();
    };
  }, []);

  if (live.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {live.map((s) => (
          <Pressable key={s.id} style={styles.item} onPress={() => router.push(`/live/${s.id}`)}>
            <View style={styles.ring}>
              {s.hostAvatar ? (
                <Image source={{ uri: s.hostAvatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={20} color={palette.textDim} />
                </View>
              )}
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t('live.badge', { defaultValue: 'LIVE' })}</Text>
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {s.hostName || s.hostUsername || '—'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const RING = 62;
const AV = 54;

const styles = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  row: { gap: 14, paddingHorizontal: 14 },
  item: { alignItems: 'center', width: RING + 10, gap: 4 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2.5,
    borderColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: AV, height: AV, borderRadius: AV / 2, backgroundColor: palette.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    bottom: -4,
    backgroundColor: palette.danger,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '900', letterSpacing: 0.3 },
  name: { color: '#fff', fontSize: 11, fontWeight: '600', maxWidth: RING + 8 },
});
