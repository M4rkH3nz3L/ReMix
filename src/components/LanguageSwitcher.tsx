import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { currentLanguage, setLanguage } from '@/i18n';
import { SUPPORTED_LANGUAGES } from '@/i18n/languages';

/**
 * 🌍 Nyelvválasztó — alul felcsúszó lap a támogatott nyelvekkel.
 * A nyelvek a saját nevükön jelennek meg (a `SUPPORTED_LANGUAGES.native`),
 * hogy a nem a jelenlegi nyelvet beszélő is felismerje a sajátját.
 */
export function LanguageSwitcher({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const active = currentLanguage();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{t('language.title')}</Text>
          <Text style={styles.subtitle}>{t('language.subtitle')}</Text>
          <View style={styles.list}>
            {SUPPORTED_LANGUAGES.map((lang) => {
              const selected = lang.code === active;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => {
                    void setLanguage(lang.code);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.row, selected && styles.rowActive]}
                >
                  <Text style={styles.flag}>{lang.flag}</Text>
                  <Text style={[styles.name, selected && styles.nameActive]}>{lang.native}</Text>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={22} color={palette.accent} />
                  ) : (
                    <View style={styles.checkPlaceholder} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 6,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 10,
  },
  title: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.textDim,
    fontSize: 13,
    marginBottom: 8,
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  rowActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  flag: {
    fontSize: 24,
  },
  name: {
    flex: 1,
    color: palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  nameActive: {
    color: palette.text,
  },
  checkPlaceholder: {
    width: 22,
    height: 22,
  },
});
