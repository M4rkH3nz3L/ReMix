import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';

/**
 * 🔴 Élő-képernyő — a feed felső sorának ÉLŐ-ikonja nyitja. Az élő közvetítés
 * back-endje még nem él; ez a felület a belépési pont: „Élő indítása" hero +
 * „Most élőben" (jelenleg üres) szekció. A gomb őszintén jelzi, hogy hamarosan
 * érkezik — így a route létezik és navigálható, félrevezetés nélkül.
 */
export default function LiveScreen() {
  const { t } = useTranslation();

  const onGoLive = () => Alert.alert(t('live.title'), t('live.comingSoon'));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('live.title')}
        </Text>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.livePillText}>{t('live.title').toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* 🎬 Élő indítása — hero-kártya */}
        <LinearGradient
          colors={['#241a3a', '#0c0d12']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            <Ionicons name="radio" size={30} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>{t('live.heroTitle')}</Text>
          <Text style={styles.heroBody}>{t('live.heroBody')}</Text>
          <Pressable style={styles.goLiveBtn} onPress={onGoLive} accessibilityRole="button">
            <Ionicons name="videocam" size={18} color="#fff" />
            <Text style={styles.goLiveText}>{t('live.goLive')}</Text>
          </Pressable>
        </LinearGradient>

        {/* 📡 Most élőben — jelenleg üres */}
        <Text style={styles.sectionTitle}>{t('live.nowTitle')}</Text>
        <View style={styles.emptyCard}>
          <Ionicons name="radio-outline" size={40} color={palette.border} />
          <Text style={styles.emptyText}>{t('live.empty')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  livePillText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },

  body: { padding: 16, gap: 18 },
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 22,
    alignItems: 'center',
    gap: 10,
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: palette.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  heroBody: { color: '#ffffffcc', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  goLiveBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  goLiveText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  sectionTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  emptyCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: 24,
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  emptyText: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
