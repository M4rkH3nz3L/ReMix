import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/profile/storage/storageStyles';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { MANUAL_FIELDS } from '@/lib/storageCardOps';

/** 🔌 manuális (WebDAV/S3) bekötő űrlap (a StorageCard.tsx-ből kiemelve) */
export function ManualProviderModal({
  manualType,
  setManualType,
  manualLabel,
  setManualLabel,
  manualCfg,
  setManualCfg,
  busy,
  onConnectManual,
}: {
  manualType: 'webdav' | 's3' | null;
  setManualType: (v: 'webdav' | 's3' | null) => void;
  manualLabel: string;
  setManualLabel: (v: string) => void;
  manualCfg: Record<string, string>;
  setManualCfg: Dispatch<SetStateAction<Record<string, string>>>;
  busy: boolean;
  onConnectManual: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={!!manualType} transparent animationType="slide" onRequestClose={() => setManualType(null)}>
      <View style={styles.modalWrap}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {t('profile.storage.connect')} · {manualType === 's3' ? 'S3 / MinIO / R2' : 'WebDAV / NAS'}
          </Text>
          <TextInput
            value={manualLabel}
            onChangeText={setManualLabel}
            placeholder={t('profile.storage.labelPlaceholder')}
            placeholderTextColor={palette.textDim}
            style={styles.input}
          />
          {(manualType ? MANUAL_FIELDS[manualType] : []).map((fld) => (
            <TextInput
              key={fld.key}
              value={manualCfg[fld.key] ?? ''}
              onChangeText={(v) => setManualCfg((prev) => ({ ...prev, [fld.key]: v }))}
              placeholder={fld.label}
              placeholderTextColor={palette.textDim}
              secureTextEntry={fld.secret}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          ))}
          <View style={{ gap: 8, marginTop: 6 }}>
            <PrimaryButton
              icon="link"
              label={busy ? t('profile.storage.working') : t('profile.storage.connect')}
              onPress={onConnectManual}
              disabled={busy}
            />
            <Pressable onPress={() => setManualType(null)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
