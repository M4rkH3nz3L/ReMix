import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';

/** 🚫 A projekt nem található (se helyben, se a felhőben) — vissza-linkkel. A szerkesztő-képernyőből kiemelve. */
export function MissingProjectView({ goBack }: { goBack: () => void }) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.missing}>
        <Text style={styles.missingText}>{t('editorScreen.projectNotFound')}</Text>
        <Pressable onPress={goBack}>
          <Text style={styles.missingLink}>{t('common.back')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  missingText: {
    color: palette.text,
    fontSize: 15,
  },
  missingLink: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
  },
});
