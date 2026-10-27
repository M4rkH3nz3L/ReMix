import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';

// 📲 áruház-linkek (go-live előtt még üresek → a gombok rejtve maradnak)
const IOS_STORE_URL = process.env.EXPO_PUBLIC_IOS_STORE_URL ?? '';
const ANDROID_STORE_URL = process.env.EXPO_PUBLIC_ANDROID_STORE_URL ?? '';

/**
 * 📱 „Szerkesztés az appban" — a stúdió-útvonalak (`/studio`, `/editor`, `/collab`,
 * `/live/studio`) webes csonkja. A böngészős változat nézegető-felület (SEO/AEO,
 * tartalom-böngészés, Live-nézés); szerkeszteni csak az appban lehet.
 */
export default function OpenInAppScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <Ionicons name="phone-portrait-outline" size={56} color={palette.accent} />
        <Text style={styles.title}>{t('web.appOnlyTitle')}</Text>
        <Text style={styles.body}>{t('web.appOnlyBody')}</Text>
        <View style={styles.row}>
          {IOS_STORE_URL ? (
            <Pressable style={styles.store} onPress={() => void Linking.openURL(IOS_STORE_URL)}>
              <Ionicons name="logo-apple" size={18} color={palette.text} />
              <Text style={styles.storeText}>App Store</Text>
            </Pressable>
          ) : null}
          {ANDROID_STORE_URL ? (
            <Pressable style={styles.store} onPress={() => void Linking.openURL(ANDROID_STORE_URL)}>
              <Ionicons name="logo-google-playstore" size={18} color={palette.text} />
              <Text style={styles.storeText}>Google Play</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.home} onPress={() => router.replace('/')}>
          <Text style={styles.homeText}>{t('web.backToFeed')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  title: { color: palette.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: palette.textDim, fontSize: 14, textAlign: 'center', maxWidth: 420, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  store: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  storeText: { color: palette.text, fontWeight: '700' },
  home: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: palette.accent },
  homeText: { color: '#fff', fontWeight: '800' },
});
