import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { IS_WEB_VIEWER } from '@/lib/webGate';
import type { FeedMode } from '@/types/social';

import { styles } from './feedStyles';

/**
 * ⏳ A FEED betöltés-indikátora (Health/02.4 prezentációs al-komponens). Props-ból
 * renderel, saját fetch NINCS.
 */
export function FeedLoading() {
  return (
    <View style={styles.loadingBox}>
      <ActivityIndicator color={palette.accent} />
    </View>
  );
}

/**
 * 🕳️ Üres-állapot: nincs megjeleníthető poszt (mód szerint más szöveg) + „készíts
 * egyet" CTA a stúdióra. Props-ból renderel, saját fetch NINCS.
 */
export function FeedEmpty({ mode }: { mode: FeedMode }) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyBox}>
      <Ionicons name="videocam-outline" size={48} color={palette.border} />
      <Text style={styles.emptyText}>
        {mode === 'following' ? t('feed.emptyFollowing') : t('feed.empty')}
      </Text>
      {/* 🌐 weben nincs stúdió → nincs „készíts egyet" CTA */}
      {!IS_WEB_VIEWER && (
        <Pressable style={styles.emptyCta} onPress={() => router.push('/studio')}>
          <Text style={styles.emptyCtaText}>{t('feed.createCta')}</Text>
        </Pressable>
      )}
    </View>
  );
}
