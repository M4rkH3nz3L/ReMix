import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { legalText, type LegalDoc } from '@/constants/legal';

/**
 * 📜 Jogi képernyő — Adatkezelési tájékoztató (GDPR) / Felhasználási feltételek.
 * A `?doc=privacy|terms` paraméter dönti el, melyik szöveg. Kijelentkezve is
 * elérhető (a regisztráció linkeli), és a Profilból is.
 */
export default function LegalScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ doc?: string }>();
  const doc: LegalDoc = params.doc === 'terms' ? 'terms' : 'privacy';
  const title = doc === 'terms' ? t('legal.termsTitle') : t('legal.privacyTitle');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 32 }}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.body}>{legalText(doc)}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '800' },
  scroll: { padding: 18, paddingBottom: 48 },
  body: { color: palette.text, fontSize: 13, lineHeight: 20 },
});
