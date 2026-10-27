import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';

/**
 * ✏️ A projekt-átnevezés alsó-sheet modalja. Tisztán prezentációs: az értéket és
 * a mentés/mégse akciókat a szülő (useStudio) adja át.
 */
export function RenameModal({
  visible,
  value,
  onChangeValue,
  onSave,
  onCancel,
  title,
  placeholder,
}: {
  visible: boolean;
  /** alap: projekt-átnevezés; a Tárhelyem mappa-/fájlnévre is használja */
  title?: string;
  placeholder?: string;
  value: string;
  onChangeValue: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide">
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalGrabber} />
          <Text style={styles.modalTitle}>{title ?? t('home.renameTitle')}</Text>
          <TextInput
            value={value}
            onChangeText={onChangeValue}
            placeholder={placeholder ?? t('home.projectNamePlaceholder')}
            placeholderTextColor={palette.textDim}
            style={styles.input}
            autoFocus
          />
          <PrimaryButton icon="checkmark" label={t('common.save')} onPress={onSave} />
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: palette.border,
    padding: 20,
    paddingBottom: 34,
    gap: 14,
  },
  modalGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 2,
  },
  modalTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '800',
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 15,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  cancelText: {
    color: palette.textDim,
    fontSize: 13,
  },
});
