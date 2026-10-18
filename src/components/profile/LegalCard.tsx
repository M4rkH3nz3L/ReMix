import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { profileStyles as styles } from './styles';

/**
 * 📜 Jogi / Adatvédelem (GDPR): adatvédelmi tájékoztató + ÁSZF linkek, és a saját
 * adatok exportja. Prezentációs — az export-handler propból jön (saját fetch nincs).
 */
export function LegalCard({ onExportData }: { onExportData: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.legalSection')}</Text>
      <View style={styles.card}>
        <Pressable
          onPress={() => router.push('/legal?doc=privacy')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
        >
          <Ionicons name="shield-outline" size={18} color={palette.textDim} />
          <Text style={{ flex: 1, color: palette.text, fontSize: 14 }}>{t('legal.privacyTitle')}</Text>
          <Ionicons name="chevron-forward" size={15} color={palette.textDim} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/legal?doc=terms')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
        >
          <Ionicons name="document-text-outline" size={18} color={palette.textDim} />
          <Text style={{ flex: 1, color: palette.text, fontSize: 14 }}>{t('legal.termsTitle')}</Text>
          <Ionicons name="chevron-forward" size={15} color={palette.textDim} />
        </Pressable>
        <Pressable
          onPress={onExportData}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
        >
          <Ionicons name="download-outline" size={18} color={palette.textDim} />
          <Text style={{ flex: 1, color: palette.text, fontSize: 14 }}>{t('gdpr.exportTitle')}</Text>
          <Ionicons name="chevron-forward" size={15} color={palette.textDim} />
        </Pressable>
      </View>
    </>
  );
}
