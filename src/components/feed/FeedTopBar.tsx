import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { goBackOrHome } from '@/lib/nav';
import { LiveNowStrip } from '@/components/live/LiveNowStrip';
import type { FeedMode } from '@/types/social';

import { styles } from './feedStyles';

/**
 * 🧭 A FEED felső chrome-ja (Health/02.4 prezentációs al-komponens): mód-váltó
 * ([Követett | Neked | Felkapott]) + ÉLŐ/Kereső ikon-gombok + a LIVE-now csík —
 * VAGY channel-módban a csatorna-fejléc (vissza-gomb + cím). Props-ból renderel,
 * saját fetch NINCS; a navigáció/mód-váltás a szülőtől kapott handlereken megy.
 */
export function FeedTopBar({
  channelId,
  channelTitle,
  mode,
  contentW,
  onChangeMode,
}: {
  channelId: string | undefined;
  channelTitle: string;
  mode: FeedMode;
  contentW: number;
  onChangeMode: (m: FeedMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.topBar} pointerEvents="box-none">
      {channelId ? (
        <View style={styles.channelBar}>
          <Pressable onPress={() => goBackOrHome()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </Pressable>
          <Text style={styles.channelTitle} numberOfLines={1}>
            @{channelTitle}
          </Text>
          <View style={{ width: 26 }} />
        </View>
      ) : (
        <>
          {/* 🖥️ a felső sort a KÖZÉPRE igazított videó-oszlophoz kötjük (contentW) —
              különben weben (isWideWeb) az ikonok a böngésző két távoli szélére
              kerülnének (a rail/felirat is az oszlophoz igazodik). */}
          <View style={[styles.topRow, { width: contentW }]}>
            {/* 🔴 bal: ÉLŐ — a mód-váltóval egy vonalban (külön route) */}
            <Pressable
              style={styles.topIconBtn}
              onPress={() => router.push('/live')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('feed.live')}
            >
              <Ionicons name="radio-outline" size={24} color="#fff" />
              <View style={styles.liveDot} pointerEvents="none" />
            </Pressable>

            <View style={styles.modeRow}>
              <Pressable onPress={() => onChangeMode('following')}>
                <Text style={[styles.modeText, mode === 'following' && styles.modeActive]}>
                  {t('feed.following')}
                </Text>
              </Pressable>
              <Text style={styles.modeSep}>|</Text>
              <Pressable onPress={() => onChangeMode('foryou')}>
                <Text style={[styles.modeText, mode === 'foryou' && styles.modeActive]}>
                  {t('feed.forYou')}
                </Text>
              </Pressable>
              <Text style={styles.modeSep}>|</Text>
              <Pressable onPress={() => onChangeMode('trending')}>
                <Text style={[styles.modeText, mode === 'trending' && styles.modeActive]}>
                  {t('feed.trending')}
                </Text>
              </Pressable>
            </View>

            {/* 🔎 jobb: KERESŐ — a mód-váltóval egy vonalban (külön route) */}
            <Pressable
              style={styles.topIconBtn}
              onPress={() => router.push('/search')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('feed.search')}
            >
              <Ionicons name="search" size={24} color="#fff" />
            </Pressable>
          </View>
          {/* 🔴 LIVE now — a követett hostok élő adásai (üresen nem renderel) */}
          <View style={{ width: contentW }}>
            <LiveNowStrip />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
